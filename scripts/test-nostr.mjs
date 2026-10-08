// Tests of the Nostr scripts. They run offline: a small fake relay (a WebSocket server written here) plays the relays.
//
//   npm run nostr:test
//
// What is checked: the text template, the article queue (articles first, one a day, then deals), "dry-run publishes nothing", autopost switch, one note a day (record, relays guard, Re-run),
// partial delivery and sending the same note again, stale brief and old price, the key never appears in any output,
// keygen (.env kept, existing key never replaced, only npub printed), profile, the relay check, and the git branch script.
// Nothing here touches the real data/ folder or the real relays: every test works in a temporary folder.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSecretKey, getPublicKey, verifyEvent, finalizeEvent } from 'nostr-tools/pure';
import { matchFilters } from 'nostr-tools/filter';
import { nip19 } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';

process.env.NOSTR_ROOT = process.env.NOSTR_ROOT || ''; // the test itself imports the template code, which must see the real settings
delete process.env.NOSTR_ROOT;
const { buildNote, whyLine, nostrAccounts, buildArticleNote, articleQueue } = await import('./lib/nostr.mjs');

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const NOW = '2026-10-08T11:30:00Z';

// ---------- fake relay ----------

function startRelay(mode = 'accept', nip11 = {}) {
  const events = [];
  let invalid = 0;
  const server = http.createServer((req, res) => {
    if ((req.headers.accept || '').includes('application/nostr+json')) {
      res.writeHead(200, { 'content-type': 'application/nostr+json' });
      res.end(JSON.stringify({ name: `mock-${mode}`, software: 'mock', ...nip11 }));
    } else {
      res.writeHead(200);
      res.end('mock relay');
    }
  });
  server.on('upgrade', (req, socket) => {
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send = (obj) => {
      const p = Buffer.from(JSON.stringify(obj));
      let h;
      if (p.length < 126) h = Buffer.from([0x81, p.length]);
      else if (p.length < 65536) (h = Buffer.alloc(4)), (h[0] = 0x81), (h[1] = 126), h.writeUInt16BE(p.length, 2);
      else (h = Buffer.alloc(10)), (h[0] = 0x81), (h[1] = 127), h.writeBigUInt64BE(BigInt(p.length), 2);
      socket.write(Buffer.concat([h, p]));
    };
    const handle = (msg) => {
      if (mode === 'silent') return;
      if (msg[0] === 'EVENT') {
        const ev = msg[1];
        if (!verifyEvent(ev)) {
          invalid++;
          return send(['OK', ev.id, false, 'invalid: bad signature']);
        }
        if (mode === 'reject') return send(['OK', ev.id, false, 'blocked: not allowed to write here']);
        if (mode === 'auth') return send(['OK', ev.id, false, 'auth-required: log in first']);
        if (!events.some((e) => e.id === ev.id)) events.push(ev);
        return send(['OK', ev.id, true, '']);
      }
      if (msg[0] === 'REQ') {
        for (const ev of events) if (matchFilters(msg.slice(2), ev)) send(['EVENT', msg[1], ev]);
        send(['EOSE', msg[1]]);
      }
    };
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        const masked = (buf[1] & 0x80) !== 0;
        const total = off + (masked ? 4 : 0) + len;
        if (buf.length < total) return;
        const payload = Buffer.from(buf.subarray(off + (masked ? 4 : 0), total));
        if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= buf[off + (i % 4)];
        buf = buf.subarray(total);
        if (op === 8) return socket.end();
        if (op === 9) {
          socket.write(Buffer.from([0x8a, 0]));
          continue;
        }
        if (op === 1) handle(JSON.parse(payload.toString('utf8')));
      }
    });
    socket.on('error', () => {});
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `ws://127.0.0.1:${server.address().port}`, events, get invalid() { return invalid; }, close: () => server.close() })));
}

// A port nobody listens on.
const deadRelay = () =>
  new Promise((ok) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => {
      const url = `ws://127.0.0.1:${s.address().port}`;
      s.close(() => ok(url));
    });
  });

// ---------- helpers ----------

const secret = generateSecretKey();
const NSEC = nip19.nsecEncode(secret);
const SECRET_HEX = bytesToHex(secret);
const PUB_HEX = getPublicKey(secret);

const candidate = {
  id: 'indiegala-control-ultimate-edition',
  kind: 'deal',
  title: 'Control Ultimate Edition',
  store: 'IndieGala',
  price: 5.99,
  was: 39.99,
  discount: 85,
  endsAt: '2026-10-08T23:59:00Z',
  endsInHours: 13,
  priceCheckedAt: '2026-10-07T09:49:09.029Z',
  cover: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/870780/header.jpg?t=1781607969',
  coverAlt: 'Cover art for Control Ultimate Edition',
  discountRank: 10,
  link: 'https://saveandplay.com/deals/indiegala/control-ultimate-edition/?utm_source=nostr-prices&utm_medium=social&utm_campaign=deals-2026-10-08',
  whyToday: ['sale ends in 13 h', 'deepest-discount rank 10 of 38'],
};
const brief = (over = {}) => ({ account: 'Honest prices', generatedAt: '2026-10-08T11:00:00.000Z', candidates: [{ ...candidate, ...over }], warnings: [] });

const realAccounts = JSON.parse(readFileSync(here('../data/accounts.json'), 'utf8'));
const realArticles = JSON.parse(readFileSync(here('../data/nostr-articles.json'), 'utf8'));
const SITE = realAccounts.links.site;
const art = (over = {}) => ({ approved: true, path: '/guides/x/', campaign: 'guide-x', tags: ['steam'], lines: ['Line one.', '', 'Line two.'], ...over });
const fixture = (slugs) => ({ queues: { nostr: Object.keys(slugs) }, articles: slugs });
const nextDay = (n) => new Date(Date.parse(NOW) + n * 864e5).toISOString();
const realNostr = JSON.parse(readFileSync(here('../data/nostr-accounts.json'), 'utf8'));
const realAccount = nostrAccounts('nostr')[0].account; // the brief block of data/accounts.json + the settings of data/nostr-accounts.json, as the scripts see it
const cleanEnv = () => {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (/^(NOSTR_|GITHUB_)/.test(k)) delete e[k];
  return e;
};

function makeRoot({ relays, autopost = true, briefJson = brief(), minAccepted = 2, env = '', articles = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nostr-test-'));
  for (const d of ['data', 'drafts', 'public/.well-known']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'data/accounts.json'), JSON.stringify(realAccounts, null, 2) + '\n');
  const nostr = JSON.parse(JSON.stringify(realNostr));
  nostr.accounts.nostr.autopost = autopost;
  writeFileSync(join(root, 'data/nostr-accounts.json'), JSON.stringify(nostr, null, 2) + '\n');
  setRelays(root, relays ?? [], minAccepted);
  if (articles) writeFileSync(join(root, 'data/nostr-articles.json'), JSON.stringify(articles));
  if (briefJson) writeFileSync(join(root, 'drafts/brief-nostr.json'), JSON.stringify(briefJson));
  writeFileSync(join(root, '.gitignore'), '.env\n');
  if (env !== null) writeFileSync(join(root, '.env'), env);
  return root;
}
const setRelays = (root, urls, minAccepted = 2) => writeFileSync(join(root, 'data/nostr-relays.json'), JSON.stringify({ minAccepted, timeoutMs: 1500, relays: urls.map((url) => ({ url })) }));

const leaks = [];
// The scripts run as child processes. It must be async: the fake relays live in THIS process and would not answer while it is blocked.
function run(script, args, { root, env = {}, withKey = true } = {}) {
  const summaryFile = join(root, 'summary.md');
  return new Promise((done) => {
    const child = spawn(process.execPath, [here(script), ...args], {
      env: { ...cleanEnv(), NOSTR_ROOT: root, NOSTR_NOW: NOW, GITHUB_STEP_SUMMARY: summaryFile, NOSTR_CHECK_TIMEOUT_MS: '1500', ...(withKey ? { NOSTR_NSEC: NSEC } : {}), ...env },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const killer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.on('close', (code) => {
      clearTimeout(killer);
      const summary = existsSync(summaryFile) ? readFileSync(summaryFile, 'utf8') : '';
      const all = `${out}\n${err}\n${summary}`;
      leaks.push({ script, all });
      done({ code, out, err, summary, all });
    });
  });
}
const readState = (root) => JSON.parse(readFileSync(join(root, 'drafts/posted-nostr.json'), 'utf8'));
const day = '2026-10-08';
const readDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.parse(iso));

// ---------- the tests ----------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('template: the text has only brief numbers, #ad, picture line, link last', () => {
  const { content, tags } = buildNote(candidate, realAccount);
  assert.equal(
    content,
    [
      'Control Ultimate Edition: -85% at IndieGala',
      '$5.99 (was $39.99)',
      'Price checked 2026-10-07 09:49 UTC. Sale ends 2026-10-08 23:59 UTC.',
      'Why today: sale ends in 13 h.',
      '#ad',
      '',
      candidate.cover,
      '',
      candidate.link,
    ].join('\n'),
  );
  assert.deepEqual(tags.filter((t) => t[0] === 't'), [['t', 'ad'], ['t', 'pcgaming'], ['t', 'gamedeals']]);
  const imeta = tags.find((t) => t[0] === 'imeta');
  assert.ok(imeta.includes(`url ${candidate.cover}`) && imeta.includes('m image/jpeg') && imeta.includes('alt Cover art for Control Ultimate Edition'));
  assert.ok(content.trimEnd().endsWith(candidate.link));
});

test('template: no cover = no picture line and no imeta; no end date; rank shown only when top 3; alt always present', () => {
  const a = realAccount;
  const none = buildNote({ ...candidate, cover: null, coverAlt: null, endsAt: null, whyToday: ['deepest-discount rank 2 of 38'], discountRank: 2 }, a);
  assert.ok(!none.tags.some((t) => t[0] === 'imeta'));
  assert.ok(!none.content.includes('Sale ends') && none.content.includes('Why today: deepest-discount rank 2 of 38.'));
  assert.ok(!none.content.includes('header.jpg'));
  assert.equal(whyLine({ whyToday: ['deepest-discount rank 9 of 38'], discountRank: 9 }), null);
  const noAlt = buildNote({ ...candidate, coverAlt: undefined }, a);
  assert.ok(noAlt.tags.find((t) => t[0] === 'imeta').includes('alt Cover art for Control Ultimate Edition'));
});

test('template: broken data is refused, #ad cannot be dropped from the tags', () => {
  const a = realAccount;
  for (const bad of [{ price: NaN }, { link: 'http://x' }, { link: undefined }, { priceCheckedAt: 'x' }, { title: '' }, { cover: 'ftp://x' }]) assert.throws(() => buildNote({ ...candidate, ...bad }, a), /not complete|not valid/);
  assert.deepEqual(buildNote(candidate, { hashtags: ['pcgaming'] }).tags.filter((t) => t[0] === 't'), [['t', 'ad'], ['t', 'pcgaming']]);
});

test('dry-run: shows the note, publishes nothing, writes no record, needs no key', async () => {
  const r1 = await startRelay('accept');
  const root = makeRoot({ relays: [r1.url], autopost: false });
  const r = await run('post-nostr.mjs', ['--dry-run'], { root, withKey: false });
  assert.equal(r.code, 0, r.all);
  assert.ok(r.out.includes('Control Ultimate Edition: -85% at IndieGala') && r.out.includes('#ad'));
  assert.ok(r.summary.includes('Dry run: nothing was published'));
  assert.equal(r1.events.length, 0);
  assert.ok(!existsSync(join(root, 'drafts/posted-nostr.json')));
  r1.close();
});

test('two files: settings of the account live in data/nostr-accounts.json, the brief rules in data/accounts.json; a mismatch gives a clear error', async () => {
  assert.equal(realAccount.autopost, false, 'autopost must be false until the owner says ok');
  assert.ok(!('autopost' in realAccounts.accounts.nostr) && !('profile' in realAccounts.accounts.nostr), 'no Nostr-only settings in data/accounts.json');
  assert.equal(realAccount.subid, 'nostr-prices');
  const root = makeRoot({ relays: ['wss://relay.example.test'] });
  const broken = JSON.parse(readFileSync(join(root, 'data/accounts.json'), 'utf8'));
  delete broken.accounts.nostr;
  writeFileSync(join(root, 'data/accounts.json'), JSON.stringify(broken));
  const r = await run('post-nostr.mjs', ['--dry-run'], { root, withKey: false });
  assert.equal(r.code, 1);
  assert.ok(/nostr-accounts\.json but not in data\/accounts\.json/.test(r.all), r.all);
});

test('article note: exact text, #ad added by the program, marked link last, picture with alt, t tags; incomplete articles are refused', () => {
  const link = `${SITE}/guides/x/?utm_source=nostr-prices&utm_medium=social&utm_campaign=guide-x`;
  const n = buildArticleNote(art(), realAccount, SITE);
  assert.equal(n.content, `Line one.\n\nLine two.\n#ad\n\n${link}`);
  assert.deepEqual(n.tags, [['t', 'ad'], ['t', 'pcgaming'], ['t', 'gamedeals'], ['t', 'steam']]);
  const pic = buildArticleNote(art({ image: '/og/x.png', imageAlt: 'A diagram' }), realAccount, SITE);
  assert.equal(pic.content, `Line one.\n\nLine two.\n#ad\n\n${SITE}/og/x.png\n\n${link}`);
  assert.deepEqual(pic.tags.at(-1), ['imeta', `url ${SITE}/og/x.png`, 'm image/png', 'alt A diagram']);
  assert.ok(pic.content.trimEnd().endsWith(link));
  for (const bad of [{ image: '/og/x.png' }, { lines: [] }, { lines: ['', ' '] }, { path: 'guides/x/' }, { path: '/x/?a=b' }, { campaign: 'a b' }]) assert.throws(() => buildArticleNote(art(bad), realAccount, SITE), /not complete or not valid/, JSON.stringify(bad));
  assert.throws(() => buildArticleNote(art(), { ...realAccount, subid: '' }, SITE), /not complete or not valid/);
  assert.throws(() => buildArticleNote(art(), realAccount, 'http://saveandplay.com'), /not complete or not valid/);
  // "ad" cannot be dropped from the tags even if the account has no hashtags
  assert.deepEqual(buildArticleNote(art({ tags: [] }), { ...realAccount, hashtags: ['pcgaming'] }, SITE).tags, [['t', 'ad'], ['t', 'pcgaming']]);
});

test('articles: every article of the real queue builds a valid note (#ad, marked link, alt text on pictures); the first one is approved, the autopost switch is off', () => {
  assert.ok(realArticles.queues.nostr.length >= 1);
  for (const slug of realArticles.queues.nostr) {
    const a = { slug, ...realArticles.articles[slug] };
    const n = buildArticleNote(a, realAccount, SITE);
    assert.ok(/(^|\s)#ad(\s|$)/.test(n.content), slug);
    assert.ok(n.content.trimEnd().endsWith(n.link) && n.link.includes('utm_source=nostr-prices&utm_medium=social'), slug);
    if (a.image) assert.ok(n.tags.some((t) => t[0] === 'imeta' && t.some((f) => f.startsWith('alt ') && f.length > 8)), slug);
  }
  assert.equal(realArticles.articles[realArticles.queues.nostr[0]].approved, true);
  assert.equal(articleQueue('nostr', {}).next.slug, realArticles.queues.nostr[0]);
  assert.equal(realAccount.autopost, false);
});

test('articles: the queue skips the posted and the not approved, and an unknown name is a clear error', () => {
  const cfgRoot = makeRoot({ relays: [], articles: fixture({ one: art(), two: art({ approved: false }), three: art() }) });
  process.env.NOSTR_ROOT = cfgRoot; // only for this check: a fresh copy of the module below reads NOSTR_ROOT when it loads
  return import('./lib/nostr.mjs?q=' + Date.now()).then((m) => {
    try {
      const all = m.articleQueue('nostr', {});
      assert.equal(all.next.slug, 'one');
      assert.equal(all.later, 1);
      assert.deepEqual(all.waiting, ['two']);
      const after = m.articleQueue('nostr', { one: { day: 'x' } });
      assert.equal(after.next.slug, 'three');
      assert.equal(after.later, 0);
      assert.equal(m.articleQueue('nostr', { one: {}, three: {} }).next, null);
      assert.equal(m.articleQueue('someone-else', {}).next, null);
      writeFileSync(join(cfgRoot, 'data/nostr-articles.json'), JSON.stringify({ queues: { nostr: ['missing'] }, articles: {} }));
      assert.throws(() => m.articleQueue('nostr', {}), /has no such article/);
    } finally {
      delete process.env.NOSTR_ROOT;
    }
  });
});

test('dry-run with articles: shows the next article (text, tags, queue), publishes nothing, writes no record', async () => {
  const r1 = await startRelay('accept');
  const root = makeRoot({ relays: [r1.url], autopost: false, articles: fixture({ one: art({ lines: ['First article.'], path: '/guides/one/', campaign: 'guide-one' }), two: art({ approved: false }) }) });
  const r = await run('post-nostr.mjs', ['--dry-run'], { root, withKey: false });
  assert.equal(r.code, 0, r.all);
  assert.ok(r.out.includes('First article.\n#ad') && r.out.includes('utm_campaign=guide-one') && !r.out.includes('Control Ultimate Edition'));
  assert.ok(r.summary.includes('Article: one') && r.summary.includes('Waiting for approval') && r.summary.includes('two'), r.summary);
  assert.equal(r1.events.length, 0);
  assert.ok(!existsSync(join(root, 'drafts/posted-nostr.json')));
  // no article is approved: the deal is shown, and the summary says what waits
  const none = makeRoot({ relays: [r1.url], autopost: false, articles: fixture({ two: art({ approved: false }) }) });
  const d = await run('post-nostr.mjs', ['--dry-run'], { root: none, withKey: false });
  assert.equal(d.code, 0, d.all);
  assert.ok(d.out.includes('Control Ultimate Edition') && d.summary.includes('Waiting for approval'), d.summary);
  r1.close();
});

test('post: articles go first, one a day, a not approved one is never posted, then the deals; the record of articles survives the cleanup of old days', async () => {
  const [a, b] = [await startRelay('accept'), await startRelay('accept')];
  const root = makeRoot({
    relays: [a.url, b.url],
    articles: fixture({ one: art({ lines: ['First article.'], path: '/guides/one/', campaign: 'guide-one' }), two: art({ approved: false, lines: ['Not approved.'] }), three: art({ lines: ['Third article.'], path: '/guides/three/', campaign: 'guide-three' }) }),
  });
  const freshBrief = (n) => writeFileSync(join(root, 'drafts/brief-nostr.json'), JSON.stringify({ ...brief({ priceCheckedAt: new Date(Date.parse(nextDay(n)) - 3 * 3600e3).toISOString() }), generatedAt: new Date(Date.parse(nextDay(n)) - 0.5 * 3600e3).toISOString() }));

  // day 1: article one (no brief is needed), picture-less
  let r = await run('post-nostr.mjs', [], { root });
  assert.equal(r.code, 0, r.all);
  assert.equal(a.events.length, 1);
  assert.ok(a.events[0].content.startsWith('First article.\n#ad') && a.events[0].content.includes('utm_source=nostr-prices') && a.events[0].content.includes('utm_campaign=guide-one'));
  let st = readState(root);
  assert.equal(st.accounts.nostr[day].kind, 'article');
  assert.equal(st.accounts.nostr[day].article, 'one');
  assert.equal(st.articles.nostr.one.day, day);

  // day 1 again: skipped, nothing new
  r = await run('post-nostr.mjs', [], { root });
  assert.equal(r.code, 0, r.all);
  assert.ok(/already posted today/.test(r.summary));
  assert.equal(a.events.length, 1);

  // day 2: "two" is not approved, so "three"
  r = await run('post-nostr.mjs', [], { root, env: { NOSTR_NOW: nextDay(1) } });
  assert.equal(r.code, 0, r.all);
  assert.equal(a.events.length, 2);
  assert.ok(a.events[1].content.startsWith('Third article.') && !a.events.some((e) => e.content.includes('Not approved.')));

  // day 3: no approved article is left: the deal of the brief
  freshBrief(2);
  r = await run('post-nostr.mjs', [], { root, env: { NOSTR_NOW: nextDay(2) } });
  assert.equal(r.code, 0, r.all);
  assert.equal(a.events.length, 3);
  assert.ok(a.events[2].content.includes('Control Ultimate Edition: -85% at IndieGala'));
  st = readState(root);
  assert.equal(st.accounts.nostr[readDay(nextDay(2))].kind, 'deal');

  // 70 days later the old day records are cleaned up, the record of posted articles stays, and nothing is posted twice
  freshBrief(70);
  r = await run('post-nostr.mjs', [], { root, env: { NOSTR_NOW: nextDay(70) } });
  assert.equal(r.code, 0, r.all);
  st = readState(root);
  assert.ok(!st.accounts.nostr[day], 'the old day is cleaned up');
  assert.deepEqual(Object.keys(st.articles.nostr).sort(), ['one', 'three']);
  assert.equal(a.events.length, 4);
  assert.ok(a.events[3].content.includes('Control Ultimate Edition'), 'a deal, not an old article again');
  assert.equal(a.events.filter((e) => e.content.startsWith('First article.')).length, 1);
  [a, b].forEach((x) => x.close());
});

test('post: an article that reached too few relays is sent again as the SAME note, and stays recorded', async () => {
  const [good, bad] = [await startRelay('accept'), await startRelay('reject')];
  const root = makeRoot({ relays: [good.url, bad.url], articles: fixture({ one: art({ lines: ['First article.'], path: '/guides/one/', campaign: 'guide-one' }) }) });
  const first = await run('post-nostr.mjs', [], { root });
  assert.equal(first.code, 1, first.all);
  const st = readState(root);
  assert.equal(st.accounts.nostr[day].status, 'partial');
  assert.equal(st.articles.nostr.one.day, day);
  const n = await startRelay('accept');
  setRelays(root, [good.url, n.url]);
  const second = await run('post-nostr.mjs', [], { root });
  assert.equal(second.code, 0, second.all);
  assert.equal(n.events[0].id, st.accounts.nostr[day].id);
  assert.equal(readState(root).accounts.nostr[day].article, 'one');
  [good, bad, n].forEach((x) => x.close());
});

test('post: a reply of the owner (it has an "e" tag) does not count as the note of the day; the daily note still goes out', async () => {
  const [r1, r2] = [await startRelay('accept'), await startRelay('accept')];
  const root = makeRoot({ relays: [r1.url, r2.url] });
  const reply = finalizeEvent({ kind: 1, created_at: Math.floor(Date.parse(NOW) / 1000) - 3 * 3600, tags: [['t', 'ad'], ['e', 'a'.repeat(64)]], content: 'Thanks! Here is the deal.' }, secret);
  r1.events.push(reply);
  const r = await run('post-nostr.mjs', [], { root });
  assert.equal(r.code, 0, r.all);
  assert.equal(r1.events.length, 2);
  assert.ok(r1.events.some((e) => e.content.includes('Control Ultimate Edition')));
  assert.ok(!/already have a note/.test(r.summary));
  [r1, r2].forEach((x) => x.close());
});

test('profile: the bot flag can be switched back on in data/nostr-accounts.json', async () => {
  const a = await startRelay('accept');
  const root = makeRoot({ relays: [a.url] });
  const f = join(root, 'data/nostr-accounts.json');
  const cfg = JSON.parse(readFileSync(f, 'utf8'));
  cfg.accounts.nostr.profile.bot = true;
  writeFileSync(f, JSON.stringify(cfg));
  const d = await run('nostr-profile.mjs', ['--dry-run'], { root, withKey: false });
  assert.equal(d.code, 0, d.all);
  assert.ok(d.out.includes('"bot": true'));
  a.close();
});

test('autopost false: a real run is skipped (green), nothing is sent', async () => {
  const r1 = await startRelay('accept');
  const root = makeRoot({ relays: [r1.url, r1.url], autopost: false });
  const r = await run('post-nostr.mjs', [], { root });
  assert.equal(r.code, 0, r.all);
  assert.ok(/autopost/.test(r.summary) && r1.events.length === 0);
  r1.close();
});

test('post: 3 accept, 1 rejects, 1 is silent, 1 is dead => success, verified signature, one note a day', async () => {
  const [a, b, c, rej, silent] = [await startRelay('accept'), await startRelay('accept'), await startRelay('accept'), await startRelay('reject'), await startRelay('silent')];
  const dead = await deadRelay();
  const root = makeRoot({ relays: [a.url, b.url, c.url, rej.url, silent.url, dead] });
  const t0 = Date.now();
  const r = await run('post-nostr.mjs', [], { root });
  assert.equal(r.code, 0, r.all);
  assert.ok(Date.now() - t0 < 15000, 'one silent relay must not hold the run for long');
  for (const x of [a, b, c]) {
    assert.equal(x.events.length, 1);
    assert.ok(verifyEvent(x.events[0]));
    assert.equal(x.events[0].pubkey, PUB_HEX);
    assert.equal(x.events[0].kind, 1);
  }
  assert.equal(rej.events.length + silent.events.length, 0);
  const ev = a.events[0];
  assert.equal(ev.id, b.events[0].id, 'the same note on every relay');
  assert.ok(ev.content.includes('#ad') && ev.content.trimEnd().endsWith(candidate.link));
  assert.ok(ev.tags.some((t) => t[0] === 'imeta' && t.some((f) => f.startsWith('alt ') && f.length > 4)));
  assert.ok(Math.abs(ev.created_at - Date.parse(NOW) / 1000) < 2);
  const st = readState(root).accounts.nostr[day];
  assert.equal(st.status, 'done');
  assert.equal(st.id, ev.id);
  assert.equal(st.accepted.length, 3);
  assert.ok(r.summary.includes('accepted') && r.summary.includes('NOT accepted') && r.summary.includes(ev.id) && r.summary.includes(nip19.npubEncode(PUB_HEX)));
  assert.ok(r.summary.includes('blocked: not allowed to write here') && r.summary.includes('timeout'));

  // Re-run (same day, record present): skipped, nothing new sent
  const again = await run('post-nostr.mjs', [], { root });
  assert.equal(again.code, 0, again.all);
  assert.ok(/already posted today/.test(again.summary));
  assert.equal(a.events.length, 1);

  // The record is lost (fresh runner): the relays tell that the note exists, so no second note
  writeFileSync(join(root, 'drafts/posted-nostr.json'), '{"accounts":{}}');
  const lost = await run('post-nostr.mjs', [], { root });
  assert.equal(lost.code, 0, lost.all);
  assert.ok(/already have a note/.test(lost.summary), lost.summary);
  assert.equal(a.events.length, 1);
  assert.equal(readState(root).accounts.nostr[day].id, ev.id);
  [a, b, c, rej, silent].forEach((x) => x.close());
});

test('post: only one relay accepts => red, the same note is sent again later, not a new one', async () => {
  const [good, bad1, bad2] = [await startRelay('accept'), await startRelay('reject'), await startRelay('auth')];
  const root = makeRoot({ relays: [good.url, bad1.url, bad2.url] });
  const first = await run('post-nostr.mjs', [], { root });
  assert.equal(first.code, 1, first.all);
  const st = readState(root).accounts.nostr[day];
  assert.equal(st.status, 'partial');
  assert.ok(first.summary.includes('Only 1 relay'));
  const noteId = st.id;

  // two more relays now accept (the owner fixed data/nostr-relays.json): same note goes out again
  const [n1, n2] = [await startRelay('accept'), await startRelay('accept')];
  setRelays(root, [good.url, n1.url, n2.url]);
  const second = await run('post-nostr.mjs', [], { root });
  assert.equal(second.code, 0, second.all);
  assert.equal(n1.events[0].id, noteId);
  assert.equal(n2.events[0].id, noteId);
  assert.equal(good.events.length, 1);
  assert.equal(readState(root).accounts.nostr[day].status, 'done');
  [good, bad1, bad2, n1, n2].forEach((x) => x.close());
});

test('post: nobody accepts => red and no record (the next run may try again)', async () => {
  const [x, y] = [await startRelay('reject'), await startRelay('silent')];
  const root = makeRoot({ relays: [x.url, y.url, await deadRelay()] });
  const r = await run('post-nostr.mjs', [], { root });
  assert.equal(r.code, 1, r.all);
  assert.ok(r.summary.includes('no relay accepted'));
  assert.ok(!existsSync(join(root, 'drafts/posted-nostr.json')));
  x.close();
  y.close();
});

test('post: no key => red, never a silent skip', async () => {
  const r1 = await startRelay('accept');
  const root = makeRoot({ relays: [r1.url] });
  const r = await run('post-nostr.mjs', [], { root, withKey: false });
  assert.equal(r.code, 1, r.all);
  assert.ok(/no private key/.test(r.all) && r1.events.length === 0);
  r1.close();
});

test('post: a stale brief and an old price are skipped (green, with a warning), nothing is sent', async () => {
  const r1 = await startRelay('accept');
  const r2 = await startRelay('accept');
  const stale = makeRoot({ relays: [r1.url, r2.url], briefJson: { ...brief(), generatedAt: '2026-10-07T11:00:00.000Z' } });
  let r = await run('post-nostr.mjs', [], { root: stale });
  assert.equal(r.code, 0, r.all);
  assert.ok(/brief is 25 h old/.test(r.summary), r.summary);
  const old = makeRoot({ relays: [r1.url, r2.url], briefJson: brief({ priceCheckedAt: '2026-10-06T09:00:00Z' }) });
  r = await run('post-nostr.mjs', [], { root: old });
  assert.equal(r.code, 0, r.all);
  assert.ok(/Not posting an old price/.test(r.summary));
  const missing = makeRoot({ relays: [r1.url, r2.url], briefJson: null });
  r = await run('post-nostr.mjs', [], { root: missing });
  assert.equal(r.code, 0, r.all);
  assert.ok(/no drafts\/brief-nostr.json/.test(r.summary));
  const empty = makeRoot({ relays: [r1.url, r2.url], briefJson: { ...brief(), candidates: [], warnings: ['NOTHING TO OFFER today.'] } });
  r = await run('post-nostr.mjs', [], { root: empty });
  assert.equal(r.code, 0, r.all);
  assert.ok(/no deal passes/.test(r.summary));
  assert.equal(r1.events.length + r2.events.length, 0);
  r1.close();
  r2.close();
});

test('keygen: only npub is printed, nsec goes to .env, other lines and line endings stay, nostr.json and handle are written, a second run refuses', async () => {
  const root = makeRoot({ relays: ['wss://relay.example.test'], env: 'FOO=bar\r\nFTP_PASSWORD=secret-ftp\r\n' });
  const before = readFileSync(join(root, 'data/accounts.json'), 'utf8');
  const r = await run('nostr-keygen.mjs', [], { root, withKey: false });
  assert.equal(r.code, 0, r.all);
  const npub = r.out.match(/npub1[0-9a-z]{58}/)?.[0];
  assert.ok(npub, 'prints the npub');
  assert.ok(!/nsec1/.test(r.all), 'the private key is never printed');
  const env = readFileSync(join(root, '.env'), 'utf8');
  assert.ok(env.startsWith('FOO=bar\r\nFTP_PASSWORD=secret-ftp\r\n'), 'old lines untouched');
  const nsec = env.match(/NOSTR_NSEC=(nsec1[0-9a-z]+)\r\n/)?.[1];
  assert.ok(nsec, 'nsec saved with the same line ending');
  assert.equal(nip19.npubEncode(getPublicKey(nip19.decode(nsec).data)), npub);
  assert.ok(!r.all.includes(nsec) && !r.all.includes('secret-ftp'));
  const nip = JSON.parse(readFileSync(join(root, 'public/.well-known/nostr.json'), 'utf8'));
  assert.equal(nip.names.prices, getPublicKey(nip19.decode(nsec).data));
  assert.deepEqual(nip.relays[nip.names.prices], ['wss://relay.example.test']);
  const after = readFileSync(join(root, 'data/accounts.json'), 'utf8');
  assert.equal(JSON.parse(after).accounts.nostr.handle, npub);
  assert.equal(after.split('\n').length, before.split('\n').length);
  // second run: refuses, changes nothing
  const envBefore = env;
  const second = await run('nostr-keygen.mjs', [], { root, withKey: false });
  assert.equal(second.code, 1);
  assert.ok(/already exists/.test(second.all) && readFileSync(join(root, '.env'), 'utf8') === envBefore);
  // --force: the old key stays in .env only as a comment
  const forced = await run('nostr-keygen.mjs', ['--force'], { root, withKey: false });
  assert.equal(forced.code, 0, forced.all);
  const env2 = readFileSync(join(root, '.env'), 'utf8');
  assert.ok(env2.includes(`#replaced`) && env2.match(/^NOSTR_NSEC=nsec1/m) && env2.includes('FTP_PASSWORD=secret-ftp'));
  assert.ok(!/nsec1/.test(forced.all));
});

test('keygen: refuses if .env is not in .gitignore, and changes nothing', async () => {
  const root = makeRoot({ relays: ['wss://relay.example.test'], env: 'A=1\n' });
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
  const r = await run('nostr-keygen.mjs', [], { root, withKey: false });
  assert.equal(r.code, 1);
  assert.ok(/not listed in .gitignore/.test(r.all));
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'A=1\n');
  assert.ok(!existsSync(join(root, 'public/.well-known/nostr.json')));
});

test('profile: dry-run shows it (no bot flag, text says automated, marked website, nip05, https pictures); real run needs the matching nostr.json and publishes kind 0', async () => {
  const [a, b] = [await startRelay('accept'), await startRelay('accept')];
  const root = makeRoot({ relays: [a.url, b.url] });
  const d = await run('nostr-profile.mjs', ['--dry-run'], { root, withKey: false });
  assert.equal(d.code, 0, d.all);
  assert.ok(!d.out.includes('"bot"') && d.out.includes('Deal posts are automated') && d.out.includes('utm_source=nostr-prices&utm_medium=social&utm_campaign=profile') && d.out.includes('"nip05": "prices@saveandplay.com"') && d.out.includes('https://saveandplay.com/avatar.png') && d.out.includes('https://saveandplay.com/og-image.png'));
  assert.equal(a.events.length, 0);
  // no nostr.json: refused
  const no = await run('nostr-profile.mjs', [], { root });
  assert.equal(no.code, 1);
  assert.equal(a.events.length, 0);
  // nostr.json for another key: refused
  writeFileSync(join(root, 'public/.well-known/nostr.json'), JSON.stringify({ names: { prices: 'a'.repeat(64) } }));
  assert.equal((await run('nostr-profile.mjs', [], { root })).code, 1);
  // right file: published on both relays
  writeFileSync(join(root, 'public/.well-known/nostr.json'), JSON.stringify({ names: { prices: PUB_HEX } }));
  const ok = await run('nostr-profile.mjs', [], { root });
  assert.equal(ok.code, 0, ok.all);
  const ev = a.events[0];
  assert.equal(ev.kind, 0);
  assert.ok(verifyEvent(ev));
  const p = JSON.parse(ev.content);
  assert.equal(p.name, 'Honest prices');
  assert.equal(p.nip05, 'prices@saveandplay.com');
  assert.equal(p.bot, undefined, 'the bot flag is off: the owner also writes by hand from this account');
  assert.ok(p.about.includes('#ad') && p.about.includes('automated') && p.website.startsWith('https://saveandplay.com/?utm_source=nostr-prices'));
  assert.equal(b.events.length, 1);
  [a, b].forEach((x) => x.close());
});

test('check: relay verdicts (usable / wants payment / not reachable) and a clear problem for the missing live NIP-05', async () => {
  const [ok, pay] = [await startRelay('accept'), await startRelay('accept', { limitation: { payment_required: true } })];
  const dead = await deadRelay();
  const root = makeRoot({ relays: [ok.url, pay.url, dead] });
  writeFileSync(join(root, 'public/.well-known/nostr.json'), JSON.stringify({ names: { prices: PUB_HEX } }));
  const r = await run('nostr-check.mjs', [], { root });
  assert.equal(r.code, 1, 'the live site is not reachable from the test, and only one relay is usable: this must be red');
  assert.ok(/-> usable/.test(r.out) && /will probably refuse writes \(payment required\)/.test(r.out) && /not reachable/.test(r.out));
  assert.ok(/only 1 relay/.test(r.out));
  [ok, pay].forEach((x) => x.close());
});

test('secret: the key goes to gh through stdin only; without gh the steps are explained and the key is not shown', async () => {
  if (process.platform === 'win32') return console.log('   (skipped: uses a fake gh shell script)');
  const root = makeRoot({ relays: ['wss://relay.example.test'], env: null });
  const kg = await run('nostr-keygen.mjs', [], { root, withKey: false });
  assert.equal(kg.code, 0, kg.all);
  const nsec = readFileSync(join(root, '.env'), 'utf8').match(/NOSTR_NSEC=(nsec1[0-9a-z]+)/)[1];
  // a fake gh that writes what it gets on stdin and its arguments into files
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "gh version 0"; exit 0; fi\necho "$@" > "$GH_ARGS_FILE"\ncat > "$GH_STDIN_FILE"\n', { mode: 0o755 });
  const withGh = await run('nostr-secret.mjs', [], { root, withKey: false, env: { PATH: `${bin}:${process.env.PATH}`, GH_ARGS_FILE: join(root, 'args.txt'), GH_STDIN_FILE: join(root, 'stdin.txt') } });
  assert.equal(withGh.code, 0, withGh.all);
  assert.equal(readFileSync(join(root, 'stdin.txt'), 'utf8').trim(), nsec);
  assert.equal(readFileSync(join(root, 'args.txt'), 'utf8').trim(), 'secret set NOSTR_NSEC', 'the key is not in the arguments');
  assert.ok(!withGh.all.includes(nsec));
  const noGh = await run('nostr-secret.mjs', [], { root, withKey: false, env: { PATH: '/nonexistent' } });
  assert.equal(noGh.code, 2);
  assert.ok(/Settings -> Secrets/.test(noGh.all) && !noGh.all.includes(nsec));
  const noKey = await run('nostr-secret.mjs', [], { root: makeRoot({ relays: [], env: null }), withKey: false });
  assert.equal(noKey.code, 1);
  assert.ok(/nostr:keygen/.test(noKey.all));
  leaks.push({ script: 'nostr-secret.mjs (key from keygen)', all: `${kg.all}${withGh.all}${noGh.all}${noKey.all}`, nsec });
});

test('no output of any script contains the private key (nsec or hex) or the other .env values', () => {
  assert.ok(leaks.length > 8);
  for (const { script, all, nsec } of leaks) {
    assert.ok(!all.includes(NSEC) && !all.includes(SECRET_HEX), `${script} leaked the key`);
    if (nsec) assert.ok(!all.includes(nsec), `${script} leaked a generated key`);
    assert.ok(!all.includes('secret-ftp'), `${script} leaked another .env value`);
  }
});

test('nostr-branch.sh: load gets the brief files from the brief branch, save puts the record there once', () => {
  const git = spawnSync('git', ['--version']);
  if (git.status !== 0 || process.platform === 'win32') return console.log('   (skipped: needs git and bash)');
  const base = mkdtempSync(join(tmpdir(), 'nostr-git-'));
  const sh = (cmd, cwd = base) => {
    const r = spawnSync('bash', ['-ec', cmd], { cwd, encoding: 'utf8', env: { ...cleanEnv(), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    assert.equal(r.status, 0, `${cmd}\n${r.stdout}\n${r.stderr}`);
    return r.stdout + r.stderr;
  };
  sh('git init -q --bare origin.git && git clone -q origin.git seed 2>/dev/null && cd seed && git checkout -q -b main && echo hi > README.md && git add . && git commit -qm init && git push -q origin main');
  // the daily brief puts its files on an orphan "brief" branch
  sh(`cd seed && git checkout -q --orphan brief && git rm -rfq . && echo '{"candidates":[]}' > brief-nostr.json && echo '{}' > brief-state.json && echo x > items-nostr.json && git add . && git commit -qm brief && git push -q origin brief`);
  sh('git clone -q origin.git run && cd run && git checkout -q main && mkdir -p scripts');
  copyFileSync(here('./nostr-branch.sh'), join(base, 'run/scripts/nostr-branch.sh'));
  const out1 = sh('bash scripts/nostr-branch.sh load', join(base, 'run'));
  assert.ok(out1.includes('Loaded brief-nostr.json') && existsSync(join(base, 'run/drafts/brief-nostr.json')) && !existsSync(join(base, 'run/drafts/items-nostr.json')));
  sh(`echo '{"accounts":{"nostr":{"${day}":{"status":"done"}}}}' > drafts/posted-nostr.json`, join(base, 'run'));
  const out2 = sh('bash scripts/nostr-branch.sh save', join(base, 'run'));
  assert.ok(out2.includes('Saved to the brief branch'), out2);
  const out3 = sh('bash scripts/nostr-branch.sh save', join(base, 'run'));
  assert.ok(out3.includes('did not change'), out3);
  assert.ok(sh('git show origin/brief:posted-nostr.json || git --git-dir=../origin.git show brief:posted-nostr.json', join(base, 'run')).includes('"done"'));
  assert.ok(sh('git --git-dir=../origin.git ls-tree --name-only brief', join(base, 'run')).includes('brief-nostr.json'), 'the brief files stay on the branch');
  // a fresh runner loads the record back
  sh('git clone -q origin.git run2 && cd run2 && git checkout -q main && mkdir -p scripts');
  copyFileSync(here('./nostr-branch.sh'), join(base, 'run2/scripts/nostr-branch.sh'));
  sh('bash scripts/nostr-branch.sh load', join(base, 'run2'));
  assert.ok(readFileSync(join(base, 'run2/drafts/posted-nostr.json'), 'utf8').includes('"done"'));
});

// ---------- run ----------

let failed = 0;
const filter = process.argv[2]; // optional: run only the tests whose name contains this text
for (const { name, fn } of tests) {
  if (filter && !name.includes(filter)) continue;
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${String(e.stack || e).split('\n').slice(0, process.env.TEST_FULL ? 80 : 14).join('\n')}\n`);
  }
}
console.log(failed ? `\n${failed} of ${tests.length} tests FAILED` : `\nAll ${tests.length} tests passed.`);
process.exit(failed ? 1 : 0);
