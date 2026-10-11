// Tests of the Nostr scripts. They run offline: a small fake relay (a WebSocket server written here) plays the relays.
//
//   npm run nostr:test
//
// What is checked: the text template, the two kinds (one deal and one article a day, independent; kind tags; old record format; --kind required), the article queue, new guides becoming drafts (nostr-sync-articles), "dry-run publishes nothing", autopost switch, one note a day (record, relays guard, Re-run),
// partial delivery and sending the same note again, stale brief and old price, the key never appears in any output,
// keygen (.env kept, existing key never replaced, only npub printed), profile, the relay check, and the git branch script.
// Nothing here touches the real data/ folder or the real relays: every test works in a temporary folder.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSecretKey, getPublicKey, verifyEvent, finalizeEvent } from 'nostr-tools/pure';
import { matchFilters } from 'nostr-tools/filter';
import { nip19 } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';

process.env.NOSTR_ROOT = process.env.NOSTR_ROOT || ''; // the test itself imports the template code, which must see the real settings
delete process.env.NOSTR_ROOT;
const { buildNote, whyLine, nostrAccounts, buildArticleNote, articleQueue, noteKind, DISCLOSURE, BRAND_TAG } = await import('./lib/nostr.mjs');

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
const DEAL = ['--kind', 'deal'];
const ARTICLE = ['--kind', 'article'];
const tTags = (tags) => tags.filter((t) => t[0] === 't').map((t) => t[1]);
const readDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.parse(iso));

// ---------- the tests ----------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('template: the text has only brief numbers, the "Ad:" line, picture line, link last', () => {
  const { content, tags } = buildNote(candidate, realAccount);
  assert.equal(
    content,
    [
      'Control Ultimate Edition: -85% at IndieGala',
      '$5.99 (was $39.99)',
      'Price checked 2026-10-07 09:49 UTC. Sale ends 2026-10-08 23:59 UTC.',
      'Why today: sale ends in 13 h.',
      'Ad: we may earn a commission if you buy.',
      '',
      '#pcgaming #gamedeals',
      '',
      candidate.cover,
      '',
      candidate.link,
    ].join('\n'),
  );
  assert.equal(DISCLOSURE, 'Ad: we may earn a commission if you buy.');
  assert.ok(!/#ad\b/i.test(content), '"#ad" is not in the text of a deal note');
  assert.deepEqual(tags.filter((t) => t[0] === 't'), [['t', 'saveandplay'], ['t', 'saveandplay-deal'], ['t', 'pcgaming'], ['t', 'gamedeals']]);
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

test('template: broken data is refused, "ad" is never a tag, the brand tag cannot be dropped', () => {
  const a = realAccount;
  for (const bad of [{ price: NaN }, { link: 'http://x' }, { link: undefined }, { priceCheckedAt: 'x' }, { title: '' }, { cover: 'ftp://x' }]) assert.throws(() => buildNote({ ...candidate, ...bad }, a), /not complete|not valid/);
  assert.deepEqual(buildNote(candidate, { hashtags: ['pcgaming'] }).tags.filter((t) => t[0] === 't'), [['t', BRAND_TAG], ['t', 'saveandplay-deal'], ['t', 'pcgaming']]);
  // an old settings file that still lists "ad" does not bring the tag back
  assert.deepEqual(buildNote(candidate, { hashtags: ['#AD', 'pcgaming'] }).tags.filter((t) => t[0] === 't'), [['t', BRAND_TAG], ['t', 'saveandplay-deal'], ['t', 'pcgaming']]);
});

test('dry-run: shows the note, publishes nothing, writes no record, needs no key', async () => {
  const r1 = await startRelay('accept');
  const root = makeRoot({ relays: [r1.url], autopost: false });
  const r = await run('post-nostr.mjs', [...DEAL, '--dry-run'], { root, withKey: false });
  assert.equal(r.code, 0, r.all);
  assert.ok(r.out.includes('Control Ultimate Edition: -85% at IndieGala') && r.out.includes('Ad: we may earn a commission if you buy.') && !r.out.includes('#ad'));
  assert.ok(r.summary.includes('Dry run: nothing was published'));
  assert.equal(r1.events.length, 0);
  assert.ok(!existsSync(join(root, 'drafts/posted-nostr.json')));
  r1.close();
});

test('two files: settings of the account live in data/nostr-accounts.json, the brief rules in data/accounts.json; a mismatch gives a clear error', async () => {
  assert.equal(typeof realAccount.autopost, 'boolean', 'autopost is the owner\'s switch (data/nostr-accounts.json)');
  assert.ok(!('autopost' in realAccounts.accounts.nostr) && !('profile' in realAccounts.accounts.nostr), 'no Nostr-only settings in data/accounts.json');
  assert.equal(realAccount.subid, 'nostr-prices');
  const root = makeRoot({ relays: ['wss://relay.example.test'] });
  const broken = JSON.parse(readFileSync(join(root, 'data/accounts.json'), 'utf8'));
  delete broken.accounts.nostr;
  writeFileSync(join(root, 'data/accounts.json'), JSON.stringify(broken));
  const r = await run('post-nostr.mjs', [...DEAL, '--dry-run'], { root, withKey: false });
  assert.equal(r.code, 1);
  assert.ok(/nostr-accounts\.json but not in data\/accounts\.json/.test(r.all), r.all);
});

test('article note: exact text (no "Ad" line, no hashtag), marked link last, picture with alt, t tags; incomplete articles are refused', () => {
  const link = `${SITE}/guides/x/?utm_source=nostr-prices&utm_medium=social&utm_campaign=guide-x`;
  const n = buildArticleNote(art(), realAccount, SITE);
  assert.equal(n.content, `Line one.\n\nLine two.\n\n#pcgaming #gamedeals #steam\n\n${link}`);
  assert.deepEqual(n.tags, [['t', 'saveandplay'], ['t', 'saveandplay-article'], ['t', 'pcgaming'], ['t', 'gamedeals'], ['t', 'steam']]);
  const pic = buildArticleNote(art({ image: '/og/x.png', imageAlt: 'A diagram' }), realAccount, SITE);
  assert.equal(pic.content, `Line one.\n\nLine two.\n\n#pcgaming #gamedeals #steam\n\n${SITE}/og/x.png\n\n${link}`);
  assert.deepEqual(pic.tags.at(-1), ['imeta', `url ${SITE}/og/x.png`, 'm image/png', 'alt A diagram']);
  assert.ok(pic.content.trimEnd().endsWith(link));
  for (const bad of [{ image: '/og/x.png' }, { lines: [] }, { lines: ['', ' '] }, { path: 'guides/x/' }, { path: '/x/?a=b' }, { campaign: 'a b' }]) assert.throws(() => buildArticleNote(art(bad), realAccount, SITE), /not complete or not valid/, JSON.stringify(bad));
  assert.throws(() => buildArticleNote(art(), { ...realAccount, subid: '' }, SITE), /not complete or not valid/);
  assert.throws(() => buildArticleNote(art(), realAccount, 'http://saveandplay.com'), /not complete or not valid/);
  assert.throws(() => buildArticleNote(art({ tags: ['two words'] }), realAccount, SITE), /hashtag .* is not valid/);
  assert.throws(() => buildArticleNote(art({ tags: ['#x'] }), realAccount, SITE), /hashtag .* is not valid/);
  // the brand tag cannot be dropped even if the account has no hashtags, and "ad" is never a tag (not even from the article's own tags)
  assert.deepEqual(buildArticleNote(art({ tags: [] }), { ...realAccount, hashtags: ['pcgaming'] }, SITE).tags, [['t', 'saveandplay'], ['t', 'saveandplay-article'], ['t', 'pcgaming']]);
  assert.deepEqual(buildArticleNote(art({ tags: ['ad', 'steam'] }), { ...realAccount, hashtags: ['pcgaming'] }, SITE).tags, [['t', 'saveandplay'], ['t', 'saveandplay-article'], ['t', 'pcgaming'], ['t', 'steam']]);
});

test('articles: every article of the real queue builds a valid note (no #ad, hashtags in the text = t tags, marked link, picture file and alt text); the first one is approved', () => {
  assert.ok(realArticles.queues.nostr.length >= 1);
  for (const slug of realArticles.queues.nostr) {
    const a = { slug, ...realArticles.articles[slug] };
    const n = buildArticleNote(a, realAccount, SITE);
    assert.ok(!/(^|\s)#ad(\s|$)/i.test(n.content) && !n.tags.some((t) => t[0] === 't' && t[1] === 'ad'), slug);
    assert.ok(n.content.trimEnd().endsWith(n.link) && n.link.includes('utm_source=nostr-prices&utm_medium=social'), slug);
    if (a.image) assert.ok(n.tags.some((t) => t[0] === 'imeta' && t.some((f) => f.startsWith('alt ') && f.length > 8)), slug);
    // the hashtags of the text are exactly the t tags (NIP-24) plus the brand tag that is not shown
    const shown = (n.content.match(/(^|\s)#[a-z0-9_]+/g) ?? []).map((x) => x.trim().slice(1));
    assert.ok(shown.length >= 2 && shown.length <= 6, `${slug}: ${shown.length} hashtags`);
    assert.deepEqual(n.tags.filter((t) => t[0] === 't').map((t) => t[1]).filter((h) => !h.startsWith('saveandplay')), shown, slug);
    // a picture of an article is a real file of the site, a PNG of 1200x630 (so a link card and the note look right)
    if (a.image) {
      const png = readFileSync(here(`../public${a.image}`));
      assert.equal(png.subarray(1, 4).toString(), 'PNG', `${slug}: ${a.image} is not a PNG`);
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630], `${slug}: ${a.image} must be 1200x630`);
    }
  }
  assert.equal(realArticles.articles[realArticles.queues.nostr[0]].approved, true);
  assert.equal(articleQueue('nostr', {}).next.slug, realArticles.queues.nostr[0]);
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

// A tiny PNG header: pngSize only reads the signature and the IHDR width and height.
const fakePng = (w, h) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const guide = (fm) => `---\nlayout: ../../layouts/Article.astro\nsection: guides\n${fm}\n---\n\nText.\n`;
function guidesRoot(guides, articles = fixture({ old: art({ lines: ['Hand-written.'], tags: ['steam'] }) })) {
  const root = makeRoot({ relays: [], articles });
  for (const d of ['src/pages/guides', 'public/og']) mkdirSync(join(root, d), { recursive: true });
  for (const [slug, fm] of Object.entries(guides)) writeFileSync(join(root, `src/pages/guides/${slug}.md`), guide(fm));
  return root;
}
const readArticles = (root) => JSON.parse(readFileSync(join(root, 'data/nostr-articles.json'), 'utf8'));

test('sync articles: a new guide becomes a draft (approved: false) at the end of the queue; dry by default; an existing article is never changed', async () => {
  const root = guidesRoot({
    old: 'title: "Changed title"\ndescription: "Changed."',
    'new-guide': 'title: "A new guide: #ad free"\ndescription: "What it says."\nimage: /og/new-guide.png\nimageAlt: "Diagram of it."',
  });
  writeFileSync(join(root, 'public/og/new-guide.png'), fakePng(1200, 630));
  const before = readFileSync(join(root, 'data/nostr-articles.json'), 'utf8');
  const dry = await run('./nostr-sync-articles.mjs', [], { root, withKey: false });
  assert.equal(dry.code, 0, dry.all);
  assert.ok(dry.out.includes('+ new-guide') && !dry.out.includes('+ old') && dry.out.includes('Nothing was written'), dry.out);
  assert.equal(readFileSync(join(root, 'data/nostr-articles.json'), 'utf8'), before, 'the default run writes nothing');

  const w = await run('./nostr-sync-articles.mjs', ['--write'], { root, withKey: false });
  assert.equal(w.code, 0, w.all);
  const cfg = readArticles(root);
  assert.deepEqual(cfg.queues.nostr, ['old', 'new-guide']);
  assert.deepEqual(cfg.articles.old, JSON.parse(before).articles.old, 'the existing article stays exactly as it was');
  assert.deepEqual(cfg.articles['new-guide'], { approved: false, path: '/guides/new-guide/', campaign: 'new-guide', tags: [], lines: ['A new guide: free', '', 'What it says.'], image: '/og/new-guide.png', imageAlt: 'Diagram of it.' });
  // the draft is a valid article note, without any ad mark
  const n = buildArticleNote({ slug: 'new-guide', ...cfg.articles['new-guide'] }, realAccount, SITE);
  assert.ok(!/#ad\b|^Ad:/im.test(n.content) && n.tags.some((t) => t[0] === 'imeta'), n.content);
  // a second run adds nothing and changes nothing
  const again = readFileSync(join(root, 'data/nostr-articles.json'), 'utf8');
  const second = await run('./nostr-sync-articles.mjs', ['--write'], { root, withKey: false });
  assert.ok(second.out.includes('Nothing to add'), second.out);
  assert.equal(readFileSync(join(root, 'data/nostr-articles.json'), 'utf8'), again);
});

test('sync articles: tags are made a-z, 0-9, _ (2-30), bad ones are dropped and named in the report; a guide without a title is skipped with the reason', async () => {
  const root = guidesRoot({
    tagged: 'title: "Tagged"\ndescription: "D."\ntags: ["Steam Deck", "#GOG", "x", "ad", "steam-sale", "игры", "a_very_long_tag_that_is_more_than_thirty"]',
    block: 'title: "Block"\ndescription: "D."\ntags:\n  - drmfree\n  - "Indie"',
    notitle: 'description: "No title here."',
  });
  const r = await run('./nostr-sync-articles.mjs', ['--write'], { root, withKey: false });
  assert.equal(r.code, 0, r.all);
  const cfg = readArticles(root);
  assert.deepEqual(cfg.articles.tagged.tags, ['steamdeck', 'gog', 'steamsale']);
  assert.deepEqual(cfg.articles.block.tags, ['drmfree', 'indie']);
  for (const bad of ['x (only', 'ad (not a topic', 'игры (only', 'a_very_long_tag_that_is_more_than_thirty (only']) assert.ok(r.out.includes(bad), `${bad}\n${r.out}`);
  assert.ok(!cfg.articles.notitle && !cfg.queues.nostr.includes('notitle') && /notitle: skipped, the header has no title/.test(r.out), r.out);
  for (const slug of ['tagged', 'block']) buildArticleNote({ slug, ...cfg.articles[slug] }, realAccount, SITE); // the kept tags pass the note's own check
});

test('sync articles: the picture is taken only if the file exists and is a PNG of 1200x630 (and has an alt text)', async () => {
  const fm = (slug, alt = 'imageAlt: "A picture."') => `title: "T ${slug}"\ndescription: "D."\nimage: /og/${slug}.png\n${alt}`;
  const root = guidesRoot({ good: fm('good'), missing: fm('missing'), small: fm('small'), notpng: fm('notpng'), noalt: fm('noalt', '') });
  writeFileSync(join(root, 'public/og/good.png'), fakePng(1200, 630));
  writeFileSync(join(root, 'public/og/small.png'), fakePng(800, 418));
  writeFileSync(join(root, 'public/og/notpng.png'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'.padEnd(40)));
  writeFileSync(join(root, 'public/og/noalt.png'), fakePng(1200, 630));
  const r = await run('./nostr-sync-articles.mjs', ['--write'], { root, withKey: false });
  const a = readArticles(root).articles;
  assert.equal(a.good.image, '/og/good.png');
  assert.equal(a.good.imageAlt, 'A picture.');
  for (const slug of ['missing', 'small', 'notpng', 'noalt']) assert.ok(a[slug] && !('image' in a[slug]) && !('imageAlt' in a[slug]), slug);
  assert.ok(/does not exist/.test(r.out) && /800x418, needs 1200x630/.test(r.out) && /is not a PNG/.test(r.out) && /no imageAlt/.test(r.out), r.out);
});

test('sync articles --check: one warning line in Summary with the guides that have no draft, writes nothing', async () => {
  const root = guidesRoot({ old: 'title: "Old"', 'new-one': 'title: "New one"\ndescription: "D."' });
  const before = readFileSync(join(root, 'data/nostr-articles.json'), 'utf8');
  const r = await run('./nostr-sync-articles.mjs', ['--check'], { root, withKey: false });
  assert.equal(r.code, 0, r.all);
  assert.ok(r.summary.includes('Guides without a Nostr draft: new-one'), r.summary);
  assert.equal(readFileSync(join(root, 'data/nostr-articles.json'), 'utf8'), before);
  rmSync(join(root, 'src/pages/guides/new-one.md'));
  rmSync(join(root, 'summary.md'));
  const none = await run('./nostr-sync-articles.mjs', ['--check'], { root, withKey: false });
  assert.equal(none.summary, '');
});

test('no --kind: nothing is posted and the error says what to add (red)', async () => {
  const r1 = await startRelay('accept');
  const root = makeRoot({ relays: [r1.url] });
  for (const args of [[], ['--dry-run'], ['--kind', 'news']]) {
    const r = await run('post-nostr.mjs', args, { root });
    assert.equal(r.code, 1, r.all);
    assert.ok(/--kind deal or --kind article/.test(r.err) && /Nothing was posted/.test(r.summary), r.all);
  }
  assert.equal(r1.events.length, 0);
  assert.ok(!existsSync(join(root, 'drafts/posted-nostr.json')));
  r1.close();
});

test('kind tags: a deal note has saveandplay + saveandplay-deal, an article note saveandplay + saveandplay-article; not in the text, never "ad"; old notes are told apart by their text', () => {
  const d = buildNote(candidate, realAccount);
  const a = buildArticleNote(art(), realAccount, SITE);
  assert.deepEqual(tTags(d.tags).slice(0, 2), ['saveandplay', 'saveandplay-deal']);
  assert.deepEqual(tTags(a.tags).slice(0, 2), ['saveandplay', 'saveandplay-article']);
  for (const n of [d, a]) assert.ok(!n.content.includes('saveandplay-') && !tTags(n.tags).includes('ad') && !/#saveandplay/.test(n.content));
  assert.equal(noteKind({ tags: d.tags, content: d.content }), 'deal');
  assert.equal(noteKind({ tags: a.tags, content: a.content }), 'article');
  // the tag of the kind wins over the text
  assert.equal(noteKind({ tags: [['t', 'saveandplay'], ['t', 'saveandplay-article']], content: 'Ad: x' }), 'article');
  // notes made before 11 Oct 2026 (no kind tag): an "Ad:" line or "Price checked" = deal, anything else = article
  assert.equal(noteKind({ tags: [['t', 'saveandplay']], content: 'Game: -50%\nAd: we may earn a commission if you buy.' }), 'deal');
  assert.equal(noteKind({ tags: [['t', 'ad']], content: 'Game: -50%\nPrice checked 2026-10-07 09:49 UTC.' }), 'deal');
  assert.equal(noteKind({ tags: [['t', 'ad']], content: 'Is that "-75%" real? #ad' }), 'article');
  // an article cannot smuggle a kind tag in through its own tags
  assert.deepEqual(tTags(buildArticleNote(art({ tags: ['saveandplay-deal', 'steam'] }), realAccount, SITE).tags), ['saveandplay', 'saveandplay-article', 'pcgaming', 'gamedeals', 'steam']);
});

test('dry-run with articles: kind article shows the next article (text, tags, queue), kind deal shows the deal; publishes nothing, writes no record', async () => {
  const r1 = await startRelay('accept');
  const root = makeRoot({ relays: [r1.url], autopost: false, articles: fixture({ one: art({ lines: ['First article.'], path: '/guides/one/', campaign: 'guide-one' }), two: art({ approved: false }) }) });
  const r = await run('post-nostr.mjs', [...ARTICLE, '--dry-run'], { root, withKey: false });
  assert.equal(r.code, 0, r.all);
  assert.ok(r.out.includes('First article.\n\n#pcgaming #gamedeals #steam\n\nhttps://saveandplay.com/guides/one/?utm_source=nostr-prices') && !r.out.includes('#ad') && r.out.includes('utm_campaign=guide-one') && !r.out.includes('Control Ultimate Edition'));
  assert.ok(r.summary.includes('Article: one') && r.summary.includes('Waiting for approval') && r.summary.includes('two'), r.summary);
  // the deal is independent of the queue: an approved article does not hide it
  const d = await run('post-nostr.mjs', [...DEAL, '--dry-run'], { root, withKey: false });
  assert.equal(d.code, 0, d.all);
  assert.ok(d.out.includes('Control Ultimate Edition: -85% at IndieGala') && !d.out.includes('First article.'), d.out);
  assert.equal(r1.events.length, 0);
  assert.ok(!existsSync(join(root, 'drafts/posted-nostr.json')));
  // no article is approved: kind article is skipped (green) and says what waits; it never falls back to a deal
  const none = makeRoot({ relays: [r1.url], autopost: false, articles: fixture({ two: art({ approved: false }) }) });
  const s = await run('post-nostr.mjs', [...ARTICLE, '--dry-run'], { root: none, withKey: false });
  assert.equal(s.code, 0, s.all);
  assert.ok(/\*\*Skipped:\*\* no approved article/.test(s.summary) && s.summary.includes('Waiting for approval') && !s.out.includes('Control Ultimate Edition'), s.summary);
  r1.close();
});

test('post: a deal and an article on the same day both go out; a second deal or a second article that day does not; not approved is never posted; the record of articles survives the cleanup', async () => {
  const [a, b] = [await startRelay('accept'), await startRelay('accept')];
  const root = makeRoot({
    relays: [a.url, b.url],
    articles: fixture({ one: art({ lines: ['First article.'], path: '/guides/one/', campaign: 'guide-one' }), two: art({ approved: false, lines: ['Not approved.'] }), three: art({ lines: ['Third article.'], path: '/guides/three/', campaign: 'guide-three' }) }),
  });
  const kinds = () => a.events.map(noteKind);

  // day 1, 06:30: the deal
  let r = await run('post-nostr.mjs', DEAL, { root });
  assert.equal(r.code, 0, r.all);
  assert.deepEqual(kinds(), ['deal']);
  assert.ok(a.events[0].content.includes('Control Ultimate Edition: -85% at IndieGala') && tTags(a.events[0].tags).includes('saveandplay-deal'));
  // day 1, 12:00: the article goes out too (the deal of the morning does not block it, neither in the record nor on the relays)
  r = await run('post-nostr.mjs', ARTICLE, { root, env: { NOSTR_NOW: new Date(Date.parse(NOW) + 5.5 * 3600e3).toISOString() } });
  assert.equal(r.code, 0, r.all);
  assert.deepEqual(kinds(), ['deal', 'article']);
  assert.ok(a.events[1].content.startsWith('First article.\n\n#pcgaming #gamedeals #steam\n\nhttps://saveandplay.com/guides/one/') && !a.events[1].content.includes('#ad') && !tTags(a.events[1].tags).includes('ad') && tTags(a.events[1].tags).includes('saveandplay-article'));
  let st = readState(root);
  assert.equal(st.accounts.nostr[day].deal.kind, 'deal');
  assert.equal(st.accounts.nostr[day].article.article, 'one');
  assert.equal(st.articles.nostr.one.day, day);

  // day 1 again: a second deal and a second article are both skipped
  for (const k of [DEAL, ARTICLE]) {
    r = await run('post-nostr.mjs', k, { root });
    assert.equal(r.code, 0, r.all);
    assert.ok(/already posted today/.test(r.summary), r.summary);
  }
  // the record is lost (fresh runner): the relays still stop a second note of each kind
  writeFileSync(join(root, 'drafts/posted-nostr.json'), JSON.stringify({ accounts: {}, articles: { nostr: { one: st.articles.nostr.one } } }));
  for (const k of [DEAL, ARTICLE]) {
    r = await run('post-nostr.mjs', k, { root });
    assert.equal(r.code, 0, r.all);
    assert.ok(/already have a note of this kind/.test(r.summary), r.summary);
  }
  assert.equal(a.events.length, 2);

  // day 2 at 12:00 Bogota: "two" is not approved, so "three"
  const noon = (n) => new Date(Date.parse(nextDay(n)) + 5.5 * 3600e3).toISOString();
  r = await run('post-nostr.mjs', ARTICLE, { root, env: { NOSTR_NOW: noon(1) } });
  assert.equal(r.code, 0, r.all);
  assert.equal(a.events.length, 3);
  assert.ok(a.events[2].content.startsWith('Third article.') && !a.events.some((e) => e.content.includes('Not approved.')));

  // day 3: no approved article left: skipped, green, nothing sent (no deal instead)
  r = await run('post-nostr.mjs', ARTICLE, { root, env: { NOSTR_NOW: noon(2) } });
  assert.equal(r.code, 0, r.all);
  assert.ok(/Skipped:\*\* no approved article/.test(r.summary), r.summary);
  assert.equal(a.events.length, 3);

  // 70 days later the old day records are cleaned up, the record of posted articles stays, and nothing is posted twice
  writeFileSync(join(root, 'drafts/brief-nostr.json'), JSON.stringify({ ...brief({ priceCheckedAt: new Date(Date.parse(nextDay(70)) - 3 * 3600e3).toISOString() }), generatedAt: new Date(Date.parse(nextDay(70)) - 0.5 * 3600e3).toISOString() }));
  r = await run('post-nostr.mjs', DEAL, { root, env: { NOSTR_NOW: nextDay(70) } });
  assert.equal(r.code, 0, r.all);
  r = await run('post-nostr.mjs', ARTICLE, { root, env: { NOSTR_NOW: nextDay(70) } });
  assert.ok(/no approved article/.test(r.summary), r.summary);
  st = readState(root);
  assert.ok(!st.accounts.nostr[readDay(nextDay(1))], 'the old day is cleaned up');
  assert.deepEqual(Object.keys(st.articles.nostr).sort(), ['one', 'three']);
  assert.equal(a.events.length, 4);
  assert.equal(noteKind(a.events[3]), 'deal');
  assert.equal(a.events.filter((e) => e.content.startsWith('First article.')).length, 1);
  [a, b].forEach((x) => x.close());
});

test("old record format (one note a day): read as the slot of its kind; today's record is kept; the other kind still goes out", async () => {
  const [a, b] = [await startRelay('accept'), await startRelay('accept')];
  const oldDeal = { status: 'done', kind: 'deal', id: 'd'.repeat(64), deal: 'indiegala-x', title: 'X', postedAt: NOW };
  const articles = fixture({ one: art({ lines: ['First article.'] }) });
  // 1) today's old record is a deal: a deal run is skipped, an article run posts, and both are kept in the new slots
  const root = makeRoot({ relays: [a.url, b.url], articles });
  writeFileSync(join(root, 'drafts/posted-nostr.json'), JSON.stringify({ accounts: { nostr: { [day]: oldDeal, '2026-10-07': { status: 'done', kind: 'article', id: 'e'.repeat(64), article: 'old' } } }, articles: { nostr: { old: { day: '2026-10-07', id: 'e'.repeat(64) } } } }));
  let r = await run('post-nostr.mjs', DEAL, { root });
  assert.ok(/already posted today/.test(r.summary) && r.summary.includes('d'.repeat(64)), r.summary);
  r = await run('post-nostr.mjs', ARTICLE, { root });
  assert.equal(r.code, 0, r.all);
  assert.equal(a.events.length, 1);
  const st = readState(root);
  assert.deepEqual(st.accounts.nostr[day].deal, oldDeal, "today's old record is not lost");
  assert.equal(st.accounts.nostr[day].article.article, 'one');
  assert.equal(st.accounts.nostr['2026-10-07'].article.article, 'old', 'an older day is converted too');
  // 2) an old record without "kind": a record found on a relay whose id is a posted article = article; any other = deal
  const root2 = makeRoot({ relays: [a.url, b.url], articles });
  writeFileSync(join(root2, 'drafts/posted-nostr.json'), JSON.stringify({ accounts: { nostr: { [day]: { status: 'done', id: 'f'.repeat(64), foundOnRelay: true } } }, articles: { nostr: { one: { day, id: 'f'.repeat(64) } } } }));
  r = await run('post-nostr.mjs', ARTICLE, { root: root2 });
  assert.ok(/already posted today \(2026-10-08, article\)/.test(r.summary), r.summary);
  const [c, d] = [await startRelay('accept'), await startRelay('accept')]; // fresh relays: a and b already hold the article note of case 1
  const root3 = makeRoot({ relays: [c.url, d.url], articles });
  writeFileSync(join(root3, 'drafts/posted-nostr.json'), JSON.stringify({ accounts: { nostr: { [day]: { status: 'done', id: 'c'.repeat(64), foundOnRelay: true } } } }));
  r = await run('post-nostr.mjs', DEAL, { root: root3 });
  assert.ok(/already posted today/.test(r.summary), r.summary);
  r = await run('post-nostr.mjs', ARTICLE, { root: root3 });
  assert.equal(r.code, 0, r.all);
  assert.equal(readState(root3).accounts.nostr[day].deal.id, 'c'.repeat(64));
  assert.equal(readState(root3).accounts.nostr[day].article.article, 'one');
  [a, b, c, d].forEach((x) => x.close());
});

test('post: an article that reached too few relays is sent again as the SAME note, and stays recorded', async () => {
  const [good, bad] = [await startRelay('accept'), await startRelay('reject')];
  const root = makeRoot({ relays: [good.url, bad.url], articles: fixture({ one: art({ lines: ['First article.'], path: '/guides/one/', campaign: 'guide-one' }) }) });
  const first = await run('post-nostr.mjs', ARTICLE, { root });
  assert.equal(first.code, 1, first.all);
  const st = readState(root);
  assert.equal(st.accounts.nostr[day].article.status, 'partial');
  assert.equal(st.articles.nostr.one.day, day);
  const n = await startRelay('accept');
  setRelays(root, [good.url, n.url]);
  const second = await run('post-nostr.mjs', ARTICLE, { root });
  assert.equal(second.code, 0, second.all);
  assert.equal(n.events[0].id, st.accounts.nostr[day].article.id);
  assert.equal(readState(root).accounts.nostr[day].article.article, 'one');
  [good, bad, n].forEach((x) => x.close());
});

test('post: a reply of the owner (it has an "e" tag) does not count as the note of the day; the daily note still goes out', async () => {
  const [r1, r2] = [await startRelay('accept'), await startRelay('accept')];
  const root = makeRoot({ relays: [r1.url, r2.url] });
  const reply = finalizeEvent({ kind: 1, created_at: Math.floor(Date.parse(NOW) / 1000) - 3 * 3600, tags: [['t', 'ad'], ['t', 'saveandplay-deal'], ['e', 'a'.repeat(64)]], content: 'Thanks! Here is the deal.\nAd: we may earn a commission if you buy.' }, secret);
  r1.events.push(reply);
  const r = await run('post-nostr.mjs', DEAL, { root });
  assert.equal(r.code, 0, r.all);
  assert.equal(r1.events.length, 2);
  assert.ok(r1.events.some((e) => e.content.includes('Control Ultimate Edition')));
  assert.ok(!/already have a note/.test(r.summary));
  [r1, r2].forEach((x) => x.close());
});

test('post: the relay guard counts only our notes of the SAME kind (kind tag, or the text of old notes with the brand tag or the old "ad" tag); a hand-written note does not block', async () => {
  const arts = fixture({ one: art({ lines: ['First article.'] }) });
  const mk = (tags, content = 'x', t = 3) => finalizeEvent({ kind: 1, created_at: Math.floor(Date.parse(NOW) / 1000) - t * 3600, tags, content }, secret);
  const blocks = async (ev, kind) => {
    const [x, y] = [await startRelay('accept'), await startRelay('accept')];
    x.events.push(ev);
    const r = await run('post-nostr.mjs', kind, { root: makeRoot({ relays: [x.url, y.url], articles: arts }) });
    assert.equal(r.code, 0, r.all);
    const blocked = /already have a note of this kind/.test(r.summary);
    assert.equal(x.events.length, blocked ? 1 : 2, r.summary);
    [x, y].forEach((z) => z.close());
    return blocked;
  };
  // 1) a deal note of the first days (tag "ad", no brand tag, "Ad:" line): blocks a deal, not an article
  const oldDeal = mk([['t', 'ad']], 'Game: -50% at GOG\nAd: we may earn a commission if you buy.');
  assert.equal(await blocks(oldDeal, DEAL), true);
  assert.equal(await blocks(oldDeal, ARTICLE), false);
  // 2) an article note of the first days (tag "ad", no "Ad:" line): blocks an article, not a deal
  const oldArticle = mk([['t', 'ad']], 'Is that "-75%" real?');
  assert.equal(await blocks(oldArticle, ARTICLE), true);
  assert.equal(await blocks(oldArticle, DEAL), false);
  // 3) brand tag with a kind tag: only that kind
  assert.equal(await blocks(mk([['t', 'saveandplay'], ['t', 'saveandplay-deal'], ['t', 'pcgaming']]), DEAL), true);
  assert.equal(await blocks(mk([['t', 'saveandplay'], ['t', 'saveandplay-deal']]), ARTICLE), false);
  assert.equal(await blocks(mk([['t', 'saveandplay'], ['t', 'saveandplay-article']]), ARTICLE), true);
  // 4) brand tag only, before kind tags existed: by the text
  assert.equal(await blocks(mk([['t', 'saveandplay']], 'Game: -50%\nPrice checked 2026-10-07 09:49 UTC.'), DEAL), true);
  // 5) a note written by hand (no brand tag, no "ad"): not ours, the note goes out
  assert.equal(await blocks(mk([['t', 'nostr']], 'Ad: hand-written'), DEAL), false);
});

test('redo: only in an article run; the wrong note is deleted (NIP-09) and the article is posted again with the new text, once; a relay that keeps the old note does not block the new one', async () => {
  const [a, b] = [await startRelay('accept'), await startRelay('accept')];
  const root = makeRoot({ relays: [a.url, b.url], articles: fixture({ one: art({ lines: ['First article.'], path: '/guides/one/', campaign: 'guide-one' }) }) });
  let r = await run('post-nostr.mjs', ARTICLE, { root });
  assert.equal(r.code, 0, r.all);
  const oldId = a.events[0].id;
  assert.equal(readState(root).accounts.nostr[day].article.id, oldId);
  // the owner orders the redo and has fixed the text and added a picture
  const fixed = fixture({ one: art({ lines: ['First article, corrected.'], path: '/guides/one/', campaign: 'guide-one', image: '/og/one.png', imageAlt: 'A chart' }) });
  fixed.redo = { nostr: ['one'] };
  writeFileSync(join(root, 'data/nostr-articles.json'), JSON.stringify(fixed));
  // a deal run does not touch the redo: it posts the deal and deletes nothing
  r = await run('post-nostr.mjs', DEAL, { root });
  assert.equal(r.code, 0, r.all);
  assert.ok(!/Redo/.test(r.summary) && a.events.filter((e) => e.kind === 5).length === 0, r.summary);
  assert.equal(a.events.length, 2);
  // a dry run shows the NEW text and what the real run will do first; it changes nothing
  const dry = await run('post-nostr.mjs', [...ARTICLE, '--dry-run'], { root, withKey: false });
  assert.equal(dry.code, 0, dry.all);
  assert.ok(dry.out.includes('First article, corrected.') && /Redo: a real run will FIRST ask the relays to delete/.test(dry.out) && dry.out.includes(oldId), dry.out);
  assert.ok(/Redo: a real run will FIRST/.test(dry.summary));
  assert.equal(a.events.length, 2);
  assert.equal(readState(root).accounts.nostr[day].article.id, oldId);
  // the real run: deletion request first, then the new note in the article slot of the day
  r = await run('post-nostr.mjs', ARTICLE, { root });
  assert.equal(r.code, 0, r.all);
  assert.ok(/asked to delete the earlier note/.test(r.summary), r.summary);
  for (const x of [a, b]) {
    const del = x.events.find((e) => e.kind === 5);
    assert.ok(del && verifyEvent(del) && del.pubkey === PUB_HEX, 'a signed deletion request of our key');
    assert.deepEqual(del.tags.filter((t) => t[0] === 'e'), [['e', oldId]]);
    assert.ok(del.tags.some((t) => t[0] === 'k' && t[1] === '1'));
    const fresh = x.events.filter((e) => e.kind === 1 && e.id !== oldId && noteKind(e) === 'article');
    assert.equal(fresh.length, 1, 'one new article note on every relay');
    assert.ok(fresh[0].content.startsWith('First article, corrected.') && fresh[0].tags.some((t) => t[0] === 'imeta' && t.includes('alt A chart')));
  }
  const st = readState(root);
  const newId = st.accounts.nostr[day].article.id;
  assert.notEqual(newId, oldId);
  assert.equal(st.accounts.nostr[day].article.status, 'done');
  assert.equal(st.accounts.nostr[day].deal.status, 'done', 'the deal of the day is untouched');
  assert.equal(st.articles.nostr.one.id, newId);
  assert.equal(st.redone.nostr.one.deletedId, oldId);
  // once only: another run does not delete or post anything
  const count = a.events.length;
  r = await run('post-nostr.mjs', ARTICLE, { root });
  assert.equal(r.code, 0, r.all);
  assert.ok(/already posted today/.test(r.summary), r.summary);
  assert.equal(a.events.length, count);
  [a, b].forEach((x) => x.close());
});

test('redo: if too few relays accept the deletion request, nothing changes and nothing is posted (red); an article not posted yet is just posted', async () => {
  const [a, b] = [await startRelay('accept'), await startRelay('accept')];
  const root = makeRoot({ relays: [a.url, b.url], articles: fixture({ one: art({ lines: ['First article.'], path: '/guides/one/', campaign: 'guide-one' }) }) });
  assert.equal((await run('post-nostr.mjs', ARTICLE, { root })).code, 0);
  const oldId = readState(root).accounts.nostr[day].article.id;
  const fixed = fixture({ one: art({ lines: ['First article, corrected.'], path: '/guides/one/', campaign: 'guide-one' }) });
  fixed.redo = { nostr: ['one'] };
  writeFileSync(join(root, 'data/nostr-articles.json'), JSON.stringify(fixed));
  const [bad1, bad2] = [await startRelay('reject'), await startRelay('reject')];
  setRelays(root, [bad1.url, bad2.url]);
  const r = await run('post-nostr.mjs', ARTICLE, { root });
  assert.equal(r.code, 1, r.all);
  assert.ok(/Redo FAILED/.test(r.summary), r.summary);
  const st = readState(root);
  assert.equal(st.accounts.nostr[day].article.id, oldId, 'the old record is still there');
  assert.equal(st.articles.nostr.one.id, oldId);
  assert.deepEqual(st.redone.nostr, {});
  assert.equal(a.events.length, 1);
  // an order for an article that has not been posted yet: nothing to delete, it is posted normally
  const [c, d] = [await startRelay('accept'), await startRelay('accept')];
  const f2 = fixture({ one: art({ lines: ['First article.'], path: '/guides/one/', campaign: 'guide-one' }) });
  f2.redo = { nostr: ['one'] };
  const root2 = makeRoot({ relays: [c.url, d.url], articles: f2 });
  const r2 = await run('post-nostr.mjs', ARTICLE, { root: root2 });
  assert.equal(r2.code, 0, r2.all);
  assert.equal(c.events.filter((e) => e.kind === 5).length, 0);
  assert.equal(c.events.filter((e) => e.kind === 1).length, 1);
  assert.deepEqual(readState(root2).redone.nostr, {});
  // an order for an unknown article is a clear error (in an article run)
  const f3 = fixture({ one: art() });
  f3.redo = { nostr: ['nope'] };
  const r3 = await run('post-nostr.mjs', [...ARTICLE, '--dry-run'], { root: makeRoot({ relays: [c.url, d.url], articles: f3 }), withKey: false });
  assert.equal(r3.code, 1);
  assert.ok(/"redo" of "nostr" names the article "nope"/.test(r3.all), r3.all);
  [a, b, bad1, bad2, c, d].forEach((x) => x.close());
});

test('short profile links: the website of the profile is a short address that public/go/.htaccess sends to the site with the marks of the account', () => {
  const site = new URL(realAccount.profile.website);
  assert.equal(site.origin, SITE);
  assert.ok(/^\/go\/[a-z0-9-]+$/.test(site.pathname), 'a short address like /go/nostr, no marks in the text of the profile');
  const rules = readFileSync(here('../public/go/.htaccess'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^RedirectMatch\s/.test(l));
  const mine = rules.find((l) => l.split(/\s+/)[2] === `^${site.pathname}/?$`);
  assert.ok(mine, `public/go/.htaccess has no rule for ${site.pathname}`);
  const [, status, , target] = mine.split(/\s+/);
  assert.equal(status, '302');
  const t = new URL(target);
  assert.equal(t.origin, SITE);
  assert.equal(t.searchParams.get('utm_source'), realAccount.subid, 'the mark of the short link is the subid of the account');
  assert.equal(t.searchParams.get('utm_medium'), 'social');
  assert.equal(t.searchParams.get('utm_campaign'), 'profile');
  // the Bluesky address is /go/bsky and carries the subid of the Bluesky account; there is no old /go/bluesky
  const bsky = rules.find((l) => l.split(/\s+/)[2] === '^/go/bsky/?$');
  assert.ok(bsky, 'public/go/.htaccess has no rule for /go/bsky');
  assert.equal(new URL(bsky.split(/\s+/)[3]).searchParams.get('utm_source'), realAccounts.accounts.prices.subid);
  assert.ok(!rules.some((l) => l.includes('/go/bluesky')), 'the old /go/bluesky is gone');
  // every rule: our site, 302, marks present
  for (const l of rules) {
    const [, st, pat, tg] = l.split(/\s+/);
    assert.equal(st, '302');
    assert.ok(/^\^\/go\/[a-z0-9-]+\/\?\$$/.test(pat), l);
    const u = new URL(tg);
    assert.ok(u.origin === SITE && u.searchParams.get('utm_source') && u.searchParams.get('utm_medium') === 'social', l);
  }
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
  const r = await run('post-nostr.mjs', DEAL, { root });
  assert.equal(r.code, 0, r.all);
  assert.ok(/autopost/.test(r.summary) && r1.events.length === 0);
  r1.close();
});

test('post: 3 accept, 1 rejects, 1 is silent, 1 is dead => success, verified signature, one note a day', async () => {
  const [a, b, c, rej, silent] = [await startRelay('accept'), await startRelay('accept'), await startRelay('accept'), await startRelay('reject'), await startRelay('silent')];
  const dead = await deadRelay();
  const root = makeRoot({ relays: [a.url, b.url, c.url, rej.url, silent.url, dead] });
  const t0 = Date.now();
  const r = await run('post-nostr.mjs', DEAL, { root });
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
  assert.ok(ev.content.includes('\nAd: we may earn a commission if you buy.\n\n#pcgaming #gamedeals\n\n') && !/#ad\b/i.test(ev.content) && ev.content.trimEnd().endsWith(candidate.link));
  assert.ok(ev.tags.some((t) => t[0] === 't' && t[1] === 'saveandplay') && !ev.tags.some((t) => t[0] === 't' && t[1] === 'ad'));
  assert.ok(ev.tags.some((t) => t[0] === 'imeta' && t.some((f) => f.startsWith('alt ') && f.length > 4)));
  assert.ok(Math.abs(ev.created_at - Date.parse(NOW) / 1000) < 2);
  const st = readState(root).accounts.nostr[day].deal;
  assert.equal(st.status, 'done');
  assert.equal(st.id, ev.id);
  assert.equal(st.accepted.length, 3);
  assert.ok(r.summary.includes('accepted') && r.summary.includes('NOT accepted') && r.summary.includes(ev.id) && r.summary.includes(nip19.npubEncode(PUB_HEX)));
  assert.ok(r.summary.includes('blocked: not allowed to write here') && r.summary.includes('timeout'));

  // Re-run (same day, record present): skipped, nothing new sent
  const again = await run('post-nostr.mjs', DEAL, { root });
  assert.equal(again.code, 0, again.all);
  assert.ok(/already posted today/.test(again.summary));
  assert.equal(a.events.length, 1);

  // The record is lost (fresh runner): the relays tell that the note exists, so no second note
  writeFileSync(join(root, 'drafts/posted-nostr.json'), '{"accounts":{}}');
  const lost = await run('post-nostr.mjs', DEAL, { root });
  assert.equal(lost.code, 0, lost.all);
  assert.ok(/already have a note/.test(lost.summary), lost.summary);
  assert.equal(a.events.length, 1);
  assert.equal(readState(root).accounts.nostr[day].deal.id, ev.id);
  [a, b, c, rej, silent].forEach((x) => x.close());
});

test('post: only one relay accepts => red, the same note is sent again later, not a new one', async () => {
  const [good, bad1, bad2] = [await startRelay('accept'), await startRelay('reject'), await startRelay('auth')];
  const root = makeRoot({ relays: [good.url, bad1.url, bad2.url] });
  const first = await run('post-nostr.mjs', DEAL, { root });
  assert.equal(first.code, 1, first.all);
  const st = readState(root).accounts.nostr[day].deal;
  assert.equal(st.status, 'partial');
  assert.ok(first.summary.includes('Only 1 relay'));
  const noteId = st.id;

  // two more relays now accept (the owner fixed data/nostr-relays.json): same note goes out again
  const [n1, n2] = [await startRelay('accept'), await startRelay('accept')];
  setRelays(root, [good.url, n1.url, n2.url]);
  const second = await run('post-nostr.mjs', DEAL, { root });
  assert.equal(second.code, 0, second.all);
  assert.equal(n1.events[0].id, noteId);
  assert.equal(n2.events[0].id, noteId);
  assert.equal(good.events.length, 1);
  assert.equal(readState(root).accounts.nostr[day].deal.status, 'done');
  [good, bad1, bad2, n1, n2].forEach((x) => x.close());
});

test('post: nobody accepts => red and no record (the next run may try again)', async () => {
  const [x, y] = [await startRelay('reject'), await startRelay('silent')];
  const root = makeRoot({ relays: [x.url, y.url, await deadRelay()] });
  const r = await run('post-nostr.mjs', DEAL, { root });
  assert.equal(r.code, 1, r.all);
  assert.ok(r.summary.includes('no relay accepted'));
  assert.ok(!existsSync(join(root, 'drafts/posted-nostr.json')));
  x.close();
  y.close();
});

test('post: no key => red, never a silent skip', async () => {
  const r1 = await startRelay('accept');
  const root = makeRoot({ relays: [r1.url] });
  const r = await run('post-nostr.mjs', DEAL, { root, withKey: false });
  assert.equal(r.code, 1, r.all);
  assert.ok(/no private key/.test(r.all) && r1.events.length === 0);
  r1.close();
});

test('post: a stale brief and an old price are skipped (green, with a warning), nothing is sent', async () => {
  const r1 = await startRelay('accept');
  const r2 = await startRelay('accept');
  const stale = makeRoot({ relays: [r1.url, r2.url], briefJson: { ...brief(), generatedAt: '2026-10-07T11:00:00.000Z' } });
  let r = await run('post-nostr.mjs', DEAL, { root: stale });
  assert.equal(r.code, 0, r.all);
  assert.ok(/brief is 25 h old/.test(r.summary), r.summary);
  const old = makeRoot({ relays: [r1.url, r2.url], briefJson: brief({ priceCheckedAt: '2026-10-06T09:00:00Z' }) });
  r = await run('post-nostr.mjs', DEAL, { root: old });
  assert.equal(r.code, 0, r.all);
  assert.ok(/Not posting an old price/.test(r.summary));
  const missing = makeRoot({ relays: [r1.url, r2.url], briefJson: null });
  r = await run('post-nostr.mjs', DEAL, { root: missing });
  assert.equal(r.code, 0, r.all);
  assert.ok(/no drafts\/brief-nostr.json/.test(r.summary));
  const empty = makeRoot({ relays: [r1.url, r2.url], briefJson: { ...brief(), candidates: [], warnings: ['NOTHING TO OFFER today.'] } });
  r = await run('post-nostr.mjs', DEAL, { root: empty });
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
  assert.ok(!d.out.includes('"bot"') && d.out.includes('Deal posts are automated') && d.out.includes('"website": "https://saveandplay.com/go/nostr"') && d.out.includes('"nip05": "prices@saveandplay.com"') && d.out.includes('https://saveandplay.com/avatar.png') && d.out.includes('https://saveandplay.com/og-image.png'));
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
  assert.ok(p.about.includes('affiliate') && !p.about.includes('#') && p.about.includes('automated') && p.website === 'https://saveandplay.com/go/nostr');
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
