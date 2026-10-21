// Tests for sending the approved replies (drafts, the owner's "ок" and "стоп", the sender, the daily numbers).
// No internet and no real account: small fake Bluesky servers run on this computer.
//   npm run comments:test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commentAccounts, file } from './lib/comments.mjs';
import { sendSettings, sendProblems, replyProblems, graphemes, similarity, linkFacets, gapMs, stampOf, pendingItems, itemKey } from './lib/comments-send.mjs';

const PASSWORD = 'test-password-not-real';
const ME = { did: 'did:plc:me', handle: 'saveandplay.com' };
const main = commentAccounts('prices')[0].account;
const S = sendSettings(main);

// ---- the text rules -----------------------------------------------------------------------------------------------
test('settings: Bluesky accounts send with their own password; Mastodon inherits the settings but never sends', () => {
  const by = Object.fromEntries(commentAccounts().map(({ id, account }) => [id, sendSettings(account)]));
  assert.equal(by.prices.enabled, true);
  assert.equal(by['prices-wide'].enabled, true, 'the wide mode is the same account');
  assert.equal(by['prices-wide'].dailyLimit, 30, 'the wide mode has the same ceiling of 30 a day');
  assert.equal(by.prices.dailyLimit, 30);
  for (const [id, env] of [['cozy', 'BSKY_APP_PASSWORD_COZY'], ['retro', 'BSKY_APP_PASSWORD_RETRO'], ['cozy-wide', 'BSKY_APP_PASSWORD_COZY'], ['retro-wide', 'BSKY_APP_PASSWORD_RETRO']]) {
    assert.equal(by[id].enabled, true, `${id} sends`);
    assert.equal(by[id].passwordEnv, env, `${id} uses the app password of its own account, never the main one`);
    assert.equal(by[id].dailyLimit, 30, `${id}: the ceiling is 30 a day`);
    assert.equal(by[id].allowLinks, false, `${id} keeps the text rules of the main account`);
    assert.ok(by[id].blockNames.includes('gg.deals'), `${id} keeps the list of names that are never written`);
  }
  for (const id of ['mastodon-prices', 'mastodon-prices-wide']) {
    assert.equal(by[id].enabled, false, `${id} does not send`);
    assert.equal(by[id].inherited, true, `${id} only inherited the settings`);
  }
  for (const { id, account } of commentAccounts()) assert.deepEqual(sendProblems(account), [], id);
  assert.equal(S.passwordEnv, 'BSKY_APP_PASSWORD');
  assert.ok(S.gapSeconds[0] >= 60, 'at least a minute between replies while the repository is public');
});

test('settings: a niche account that searches under the main login cannot send with the main password', () => {
  const cozy = commentAccounts('cozy')[0].account;
  const bad = { ...cozy, send: { enabled: true, handle: cozy.handle, passwordEnv: cozy.passwordEnv } };
  assert.match(sendProblems(bad).join(' '), /app password of this account itself/);
  assert.deepEqual(sendProblems({ ...bad, send: { ...bad.send, passwordEnv: 'BSKY_APP_PASSWORD_COZY' } }), []);
  assert.match(sendProblems({ ...main, platform: 'mastodon', send: { ...main.send, handle: main.handle } }).join(' '), /only for Bluesky/);
});

test('reply rules: good replies pass', () => {
  const ok = [
    'Backlog first is a solid plan. If you do wait, look at the price history before buying so you know what a real low looks like.',
    'Nice find. Worth remembering that GOG copies are DRM-free, so you can keep the installer and play offline whenever you like.',
    "On Steam's search page you can narrow results by operating system, so you only see games with a Mac version.",
    'Waiting it out paid off, nice. Hope the scares lived up to it 👻',
    'GOG.com sells every game DRM-free, and itch.io is DRM-free too.',
  ];
  for (const t of ok) assert.deepEqual(replyProblems(t, { s: S, context: 'Should I buy it on Steam now or wait?' }), [], t);
});

test('reply rules: each problem is named', () => {
  const p = (t, context = 'Is this game worth it on Steam?', extra = {}) => replyProblems(t, { s: S, context, ...extra }).join(' | ');
  assert.match(p(''), /empty/);
  assert.match(p('a'.repeat(301)), /too long: 301 characters, the limit is 300/);
  assert.match(p('Check https://saveandplay.com/deals/gog/x/ for it'), /has a link/);
  assert.match(p('Prices on saveandplay.com are tracked daily.'), /names the site saveandplay\.com|names "saveandplay"/);
  assert.match(p('Try gg.deals to compare the prices first.'), /names "gg\.deals"/);
  assert.equal(p('gg.deals is a handy one. Check whether a price is from an official store.', 'I always use gg.deals before buying'), '', 'fine when the author named it first');
  assert.match(p('Kinguin is a marketplace, so check the seller rating first.'), /names "kinguin"/);
  assert.match(p('This one is great #pcgaming'), /hashtag/);
  assert.equal(p('My #1 pick for a long flight is a short puzzle game.'), '', '#1 is not a hashtag');
  assert.match(p('@someone.bsky.social has a good list for that'), /starts with @name/);
  assert.match(p('Ask @someone.bsky.social, they know this genre well.'), /mentions someone/);
  assert.match(p('Great pick 🎮🔥'), /2 emoji, at most 1/);
  assert.match(p('Это хорошая игра для вечера.'), /Russian letters/);
  assert.match(p('"Nice find, enjoy the game tonight."'), /in quotes/);
  assert.match(p('Reply: nice find, enjoy the game.'), /label/);
  assert.match(p('It is $9.99 on GOG right now, a good price.'), /price or a discount that is not in the post \(\$9\.99\)/);
  assert.match(p('It is 75% off on GOG this week.'), /75%/);
  assert.equal(p('At $2 that is a steal, enjoy it.', 'Found a $2 game on GOG!'), '', 'a price the author wrote is fine');
  assert.equal(p('I agree 100% with waiting for the sale.'), '', '"100%" is not a discount');
  assert.match(p('Follow us for more tips like this.'), /follow us/);
  assert.match(p('That is the lowest ever price for it.'), /lowest ever/);
});

test('reply rules: repeats and near-repeats are caught, in the batch and against earlier replies', () => {
  const a = 'Backlog first is a solid plan. If you wait, check the price history so you know what a real low looks like.';
  const b = 'Backlog first is a solid plan. If you wait, check the price history so you know what a good low looks like.';
  const c = 'Nice find. GOG copies are DRM-free, so you can keep the installer and play offline whenever you like.';
  assert.ok(similarity(a, b) >= 0.6, `a and b are near-copies (${similarity(a, b).toFixed(2)})`);
  assert.ok(similarity(a, c) < 0.2, 'different replies are not alike');
  assert.match(replyProblems(a, { s: S, earlier: [{ text: a, at: '2026-10-19T10:00:00Z' }] }).join(), /same text was already used \(2026-10-19\)/);
  assert.match(replyProblems(b, { s: S, earlier: [{ text: a, at: '2026-10-19T10:00:00Z' }] }).join(), /too similar to an earlier reply/);
  assert.match(replyProblems(b, { s: S, batch: [{ n: 1, text: a }] }).join(), /too similar to draft 1/);
  assert.deepEqual(replyProblems(c, { s: S, earlier: [{ text: a }], batch: [{ n: 1, text: a }] }), []);
});

test('helpers: characters are counted like Bluesky does, links get byte positions, pauses depend on the repository', () => {
  assert.equal(graphemes('👨‍👩‍👧 ok'), 4, 'a family emoji is one character');
  const text = 'Café 👻 https://saveandplay.com/deals/gog/x/. Ad';
  const [f] = linkFacets(text);
  const bytes = Buffer.from(text, 'utf8');
  assert.equal(bytes.subarray(f.index.byteStart, f.index.byteEnd).toString('utf8'), 'https://saveandplay.com/deals/gog/x/', 'the dot after the link is not part of it');
  const s = { gapSeconds: [60, 180], gapSecondsPrivate: [15, 30] };
  const old = process.env.COMMENTS_GAP_SCALE;
  delete process.env.COMMENTS_GAP_SCALE;
  try {
    assert.equal(gapMs(s, false, () => 0), 60000);
    assert.equal(gapMs(s, false, () => 1), 180000);
    assert.equal(gapMs(s, true, () => 0.5), 22500);
  } finally { if (old != null) process.env.COMMENTS_GAP_SCALE = old; }
  assert.match(stampOf(Date.parse('2026-10-20T15:03:09Z')), /^20261020-150309$/);
});

// ---- a folder like the chat and the workflow have after "comments-branch.sh load" ------------------------------------
let seq = 0;
function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'send-'));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'drafts'));
  copyFileSync(file('data', 'comments-accounts.json'), join(root, 'data', 'comments-accounts.json'));
  return root;
}
const put = (root, name, data) => writeFileSync(join(root, 'drafts', name), JSON.stringify(data, null, 2));
const read = (root, name) => JSON.parse(readFileSync(join(root, 'drafts', name), 'utf8'));
const files = (root, prefix) => readdirSync(join(root, 'drafts')).filter((f) => f.startsWith(prefix)).sort();

function mkPost(o = {}) {
  const id = ++seq;
  const handle = o.handle ?? `author${id}.bsky.social`;
  return {
    uri: `at://did:plc:a${id}/app.bsky.feed.post/3p${id}`,
    cid: `cid${id}`,
    author: { did: `did:plc:a${id}`, handle, viewer: o.authorViewer ?? {} },
    record: { $type: 'app.bsky.feed.post', text: o.text ?? `Should I buy game number ${id} on Steam now or wait for a sale?`, createdAt: new Date(Date.now() - (o.ageH ?? 3) * 36e5).toISOString(), ...(o.reply ? { reply: o.reply } : {}) },
    viewer: o.viewer ?? {},
    likeCount: 0, replyCount: 0,
  };
}
const webUrl = (p) => `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split('/').pop()}`;
const asCandidate = (p, extra = {}) => ({ uri: p.uri, url: webUrl(p), handle: p.author.handle, name: '', text: p.record.text, createdAt: p.record.createdAt, likes: 0, replies: 0, group: 'waitForSale', question: true, heated: false, media: null, ...extra });
const item = (n, p, text, extra = {}) => ({ n, uri: p.uri, url: webUrl(p), author: p.author.handle, context: p.record.text, text, edited: false, ...extra });
function approvedFile(root, items, { block = 'prices', agoMin = 1, stamp = '20261020-100000' } = {}) {
  const at = Date.now() - agoMin * 60000;
  const name = `comments-approved-${block}-${stamp}-${stampOf(at)}.json`;
  put(root, name, { account: block, handle: 'saveandplay.com', platform: 'bluesky', drafts: `comments-drafts-${block}-${stamp}.json`, approvedAt: new Date(at).toISOString(), items });
  return name;
}

const T = [
  'Backlog first is a solid plan. If you wait, check the price history so you know what a real low looks like.',
  'Nice find. GOG copies are DRM-free, so you can keep the installer and play offline whenever you like.',
  "Steam's search page can filter by operating system, so you only see games that run on your machine.",
  'Older RTS games are a safe bet for a low-end PC, and the store page lists the system requirements before you buy.',
  'Waiting it out paid off, nice. Hope the scares lived up to it.',
  'A controller helps a lot with that one, and the Steam Deck verified badge on the store page is worth a look.',
  'Demos are a great way to try before buying, and many of them stay up after the festival ends.',
  'Short games are perfect for a flight, and most of them save often so you can stop at any moment.',
];

function run(script, root, { env = {}, args = [], cwd } = {}) {
  const path = fileURLToPath(new URL(`./${script}`, import.meta.url));
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path, ...args], { cwd, env: { ...process.env, COMMENTS_ROOT: root, COMMENTS_RETRY_MS: '1', COMMENTS_GAP_SCALE: '0', GITHUB_STEP_SUMMARY: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}
const drafts = (root, args, env) => run('comments-drafts.mjs', root, { args, env });

// ---- the chat: drafts and the owner's "ок" ---------------------------------------------------------------------------
function chatRoot() {
  const root = tempRoot();
  const posts = [mkPost(), mkPost({ text: 'Found a $2 game on GOG, is it any good for a long flight?' }), mkPost(), mkPost()];
  put(root, 'comments-prices.json', { madeAt: new Date().toISOString(), normal: posts.map((p) => asCandidate(p)), heated: [] });
  writeFileSync(join(root, 'in.json'), JSON.stringify([
    { post: webUrl(posts[0]), text: T[0] },
    { post: webUrl(posts[1]), text: 'At $2 that is a steal. GOG copies are DRM-free, so it will run offline on the plane too.' },
    { post: posts[2].uri, text: T[2], verify: 'проверить, что фильтр по ОС есть в поиске Steam' },
    { post: webUrl(posts[3]), text: T[3] },
  ]));
  return { root, posts };
}

test('drafts: checked, numbered and saved BEFORE they are shown; the list shows the exact texts', async () => {
  const { root, posts } = chatRoot();
  const r = await drafts(root, ['new', '--account', 'prices', '--stamp', '20261020-150000', '--in', join(root, 'in.json')]);
  assert.equal(r.code, 0, r.out);
  const d = read(root, 'comments-drafts-prices-20261020-150000.json');
  assert.equal(d.items.length, 4);
  assert.deepEqual(d.items.map((x) => x.n), [1, 2, 3, 4]);
  assert.equal(d.items[2].uri, posts[2].uri, 'a post can be given by its at:// address too');
  assert.equal(d.items[2].verify, 'проверить, что фильтр по ОС есть в поиске Steam');
  assert.equal(d.handle, 'saveandplay.com');
  for (const it of d.items) assert.ok(r.out.includes(`   Reply: ${it.text}`), 'the exact text is printed');
  assert.match(r.out, /VERIFY: проверить/);
  assert.match(r.out, /Add drafts\/comments-drafts-prices-20261020-150000\.json to the SAVE command/);
  assert.match(r.out, /Room now: 30/);
  // saved drafts never change: the same stamp again is refused
  const again = await drafts(root, ['new', '--account', 'prices', '--stamp', '20261020-150000', '--in', join(root, 'in.json')]);
  assert.equal(again.code, 1);
  assert.match(again.out, /exists already/);
});

test('drafts: a draft with a problem saves nothing and says what to fix', async () => {
  const { root, posts } = chatRoot();
  const stranger = mkPost();
  writeFileSync(join(root, 'bad.json'), JSON.stringify([
    { post: webUrl(posts[0]), text: 'Check https://example.com for that.' },
    { post: webUrl(stranger), text: T[1] },
    { post: webUrl(posts[2]), text: 'Это хорошая игра.' },
  ]));
  const r = await drafts(root, ['new', '--account', 'prices', '--stamp', '20261020-150001', '--in', join(root, 'bad.json')]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /1: has a link/);
  assert.match(r.out, /2: .* is not in the list of prices/);
  assert.match(r.out, /3: has Russian letters/);
  assert.deepEqual(files(root, 'comments-drafts-'), []);
});

test('drafts: one reply per person, and an account without its own sending is sent by hand', async () => {
  const { root, posts } = chatRoot();
  const same = mkPost({ handle: posts[0].author.handle });
  const list = read(root, 'comments-prices.json');
  list.normal.push(asCandidate(same));
  put(root, 'comments-prices.json', list);
  writeFileSync(join(root, 'two.json'), JSON.stringify([{ post: webUrl(posts[0]), text: T[0] }, { post: webUrl(same), text: T[4] }]));
  const r = await drafts(root, ['new', '--account', 'prices', '--stamp', '20261020-150002', '--in', join(root, 'two.json')]);
  assert.equal(r.code, 1);
  assert.match(r.out, /2: a second draft for @author\d+\.bsky\.social in this batch/);
  const mastodon = await drafts(root, ['new', '--account', 'mastodon-prices', '--stamp', '20261020-150003', '--in', join(root, 'two.json')]);
  assert.equal(mastodon.code, 4);
  assert.match(mastodon.out, /SENT BY HAND/);
});

test('approve: "ок" takes every draft except VERIFY ones; numbers, skips and the owner\'s own texts work', async () => {
  const { root } = chatRoot();
  assert.equal((await drafts(root, ['new', '--account', 'prices', '--stamp', '20261020-150000', '--in', join(root, 'in.json')])).code, 0);
  let r = await drafts(root, ['approve', '--account', 'prices', '--ok', 'all']);
  assert.equal(r.code, 0, r.out);
  let [name] = files(root, 'comments-approved-');
  let a = read(root, name);
  assert.deepEqual(a.items.map((x) => x.n), [1, 2, 4], 'the VERIFY draft 3 is left out of a plain "ок"');
  assert.match(r.out, /VERIFY drafts the owner did not name: 3/);
  assert.match(r.out, /NEXT, ONE command: bash scripts\/comments-branch\.sh save drafts\/comments-approved-prices-20261020-150000-\d{8}-\d{6}\.json && gh workflow run "Send comments" -R alexbogota\/saveandplay --ref main/);
  // the same drafts again: nothing is approved twice
  r = await drafts(root, ['approve', '--account', 'prices', '--ok', 'all']);
  assert.match(r.out, /NOTHING TO SEND/);
  assert.match(r.out, /already approved and waiting/);

  // a fresh folder: only some numbers, one of them his own text, one VERIFY named on purpose
  const two = chatRoot();
  assert.equal((await drafts(two.root, ['new', '--account', 'prices', '--stamp', '20261020-150000', '--in', join(two.root, 'in.json')])).code, 0);
  r = await drafts(two.root, ['approve', '--account', 'prices', '--ok', '1,3', '--edit', '4', 'Older RTS games run well on a low-end PC. Keep your workers busy and scout early.']);
  assert.equal(r.code, 0, r.out);
  [name] = files(two.root, 'comments-approved-');
  a = read(two.root, name);
  assert.deepEqual(a.items.map((x) => x.n), [1, 3, 4]);
  assert.equal(a.items[2].text, 'Older RTS games run well on a low-end PC. Keep your workers busy and scout early.');
  assert.equal(a.items[2].edited, true);
  assert.ok(a.items[1].verify, 'a VERIFY draft goes when the owner names its number');

  // his own text with a problem: nothing is approved, the reason is given
  const three = chatRoot();
  assert.equal((await drafts(three.root, ['new', '--account', 'prices', '--stamp', '20261020-150000', '--in', join(three.root, 'in.json')])).code, 0);
  r = await drafts(three.root, ['approve', '--account', 'prices', '--ok', 'all', '--skip', '2', '--edit', '1', 'Get it on gg.deals, it is cheaper there.']);
  assert.equal(r.code, 1);
  assert.match(r.out, /1: names "gg\.deals"/);
  assert.deepEqual(files(three.root, 'comments-approved-'), []);
});

test('approve: old drafts cannot be approved, and the daily limit is told in advance', async () => {
  const { root, posts } = chatRoot();
  put(root, 'comments-drafts-prices-20261019-100000.json', { account: 'prices', handle: 'saveandplay.com', platform: 'bluesky', stamp: '20261019-100000', madeAt: new Date(Date.now() - 30 * 36e5).toISOString(), items: [item(1, posts[0], T[0])] });
  let r = await drafts(root, ['approve', '--account', 'prices', '--ok', 'all']);
  assert.equal(r.code, 1);
  assert.match(r.out, /TOO OLD/);
  // 29 replies went out in the last 24 h: only one more fits
  const sent = Array.from({ length: 29 }, (_, i) => ({ block: 'prices', handle: 'saveandplay.com', n: i + 1, uri: `at://did:plc:x/app.bsky.feed.post/old${i}`, author: `p${i}.bsky.social`, text: `old reply ${i}`, status: 'sent', at: new Date(Date.now() - 36e5).toISOString() }));
  put(root, 'comments-sent-20261020-090000.json', { madeAt: new Date().toISOString(), entries: sent });
  assert.equal((await drafts(root, ['new', '--account', 'prices', '--stamp', '20261020-150000', '--in', join(root, 'in.json')])).code, 0);
  r = await drafts(root, ['approve', '--account', 'prices', '--ok', '1,2,4']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /DAILY LIMIT: only 1 more fit/);
});

// ---- the sender ----------------------------------------------------------------------------------------------------
function fakeBluesky({ posts = [], thread = {}, failText = null, identity = ME, feed = [] } = {}) {
  const created = [];
  const calls = [];
  const byUri = new Map(posts.map((p) => [p.uri, p]));
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      calls.push(url.pathname.split('/').pop());
      if (url.pathname.endsWith('createSession')) {
        const b = JSON.parse(body || '{}');
        if (b.password !== PASSWORD || b.identifier !== 'saveandplay.com') return send(401, { error: 'AuthenticationRequired', message: 'Invalid identifier or password' });
        return send(200, { accessJwt: 'jwt-send', did: identity.did, handle: identity.handle, didDoc: { service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example' }] } });
      }
      if (req.headers.authorization !== 'Bearer jwt-send') return send(401, { error: 'AuthenticationRequired', message: 'login needed' });
      if (url.pathname.endsWith('getPosts')) { const p = byUri.get(url.searchParams.get('uris')); return send(200, { posts: p ? [p] : [] }); }
      if (url.pathname.endsWith('getAuthorFeed')) return send(200, { feed: url.searchParams.get('actor') === identity.did ? feed : [] });
      if (url.pathname.endsWith('getPostThread')) {
        const uri = url.searchParams.get('uri');
        if (thread[uri] === 'blocked') return send(200, { thread: { $type: 'app.bsky.feed.defs#blockedPost', uri } });
        const p = byUri.get(uri);
        if (!p) return send(400, { error: 'NotFound', message: 'Post not found' });
        const replies = (thread[uri] ?? []).map((did) => ({ $type: 'app.bsky.feed.defs#threadViewPost', post: { uri: `at://${did}/app.bsky.feed.post/r`, author: { did } } }));
        return send(200, { thread: { $type: 'app.bsky.feed.defs#threadViewPost', post: p, replies } });
      }
      if (url.pathname.endsWith('createRecord')) {
        const b = JSON.parse(body);
        if (failText && b.record.text === failText.text) return send(failText.status, { error: failText.error, message: failText.message });
        created.push(b);
        return send(200, { uri: `at://${ME.did}/app.bsky.feed.post/reply${created.length}`, cid: `rc${created.length}` });
      }
      return send(404, { error: 'NotFound' });
    });
  });
  return { server, created, calls, base: () => `http://127.0.0.1:${server.address().port}` };
}
async function withServer(fake, fn) {
  await new Promise((r) => fake.server.listen(0, '127.0.0.1', r));
  try { return await fn(fake.base()); } finally { fake.server.close(); }
}
const sendEnv = (base, extra = {}) => ({ BSKY_API_BASE: base, BSKY_APP_PASSWORD: PASSWORD, REPO_PRIVATE: 'false', ...extra });

test('sender: sends exactly the approved texts, as replies in the right thread, and skips what must not go, each with its reason', async () => {
  const root = tempRoot();
  const top = mkPost();
  const inThread = mkPost({ reply: { root: { uri: 'at://did:plc:root/app.bsky.feed.post/3root', cid: 'rootcid' }, parent: { uri: 'at://did:plc:mid/app.bsky.feed.post/3mid', cid: 'midcid' } } });
  const closed = mkPost({ viewer: { replyDisabled: true } });
  const deleted = mkPost();
  const answered = mkPost();
  const old = mkPost({ ageH: 60 });
  const sameAuthor = mkPost({ handle: top.author.handle });
  const blocks = mkPost({ authorViewer: { blockedBy: true } });
  const fake = fakeBluesky({ posts: [top, inThread, closed, answered, old, sameAuthor, blocks], thread: { [answered.uri]: [ME.did] } });
  const summaryFile = join(root, 'summary.md');
  approvedFile(root, [item(1, top, T[0]), item(2, inThread, T[1]), item(3, closed, T[2]), item(4, deleted, T[3]), item(5, answered, T[4]), item(6, old, T[5]), item(7, sameAuthor, T[6]), item(8, blocks, T[7])]);
  await withServer(fake, async (base) => {
    const r = await run('comments-send.mjs', root, { env: sendEnv(base, { GITHUB_STEP_SUMMARY: summaryFile }) });
    assert.equal(r.code, 0, r.out);
    assert.ok(!r.out.includes(PASSWORD), 'the password is never printed');
    assert.equal(fake.created.length, 2, r.out);
    const [a, b] = fake.created;
    assert.equal(a.record.text, T[0], 'the text is sent exactly as approved');
    assert.deepEqual(a.record.reply, { root: { uri: top.uri, cid: top.cid }, parent: { uri: top.uri, cid: top.cid } });
    assert.deepEqual(a.record.langs, ['en']);
    assert.equal(a.repo, ME.did);
    assert.equal(a.collection, 'app.bsky.feed.post');
    assert.deepEqual(b.record.reply, { root: { uri: 'at://did:plc:root/app.bsky.feed.post/3root', cid: 'rootcid' }, parent: { uri: inThread.uri, cid: inThread.cid } }, 'a reply to a reply keeps the top of the thread');
    assert.ok(!a.record.facets, 'no links, so no facets');
    const [name] = files(root, 'comments-sent-');
    const es = read(root, name).entries;
    const status = Object.fromEntries(es.map((e) => [e.n, `${e.status}: ${e.reason}`]));
    assert.equal(status[1], 'sent: sent');
    assert.equal(status[2], 'sent: sent');
    assert.equal(status[3], 'skipped: the author closed replies');
    assert.equal(status[4], 'skipped: the post is deleted or hidden');
    assert.equal(status[5], 'skipped: we already answered this post');
    assert.equal(status[6], 'skipped: the post is older than 48 h');
    assert.match(status[7], /^skipped: we replied to @author\d+\.bsky\.social less than 24 h ago$/);
    assert.equal(status[8], 'skipped: the author blocks us (or we block them)');
    assert.equal(es[0].replyUrl, 'https://bsky.app/profile/saveandplay.com/post/reply1');
    assert.equal(readFileSync(join(root, 'drafts', '.comments-new-files'), 'utf8'), `drafts/${name}\n`, 'the workflow knows which file to save');
    const sum = readFileSync(summaryFile, 'utf8');
    assert.match(sum, /Отправлено 2, пропущено 6/);
    assert.match(sum, /автор закрыл ответы/);
    assert.match(sum, /Паузы между ответами 60–180 с \(репозиторий открытый/);
    // a second run sends nothing again
    const r2 = await run('comments-send.mjs', root, { env: sendEnv(base) });
    assert.equal(r2.code, 0, r2.out);
    assert.equal(fake.created.length, 2, 'nothing goes twice');
    assert.match(r2.out, /0 approved replies waiting/);
  });
});

test('sender: the daily limit, an old approval, a "стоп", a changed rule and a near-repeat stop a reply', async () => {
  const root = tempRoot();
  const ps = Array.from({ length: 5 }, () => mkPost());
  const fake = fakeBluesky({ posts: ps });
  const earlier = Array.from({ length: 29 }, (_, i) => ({ block: 'prices', handle: 'saveandplay.com', n: i + 1, uri: `at://did:plc:x/app.bsky.feed.post/e${i}`, author: `e${i}.bsky.social`, text: `earlier reply number ${i} about something else entirely`, status: 'sent', at: new Date(Date.now() - 2 * 36e5).toISOString() }));
  earlier.push({ block: 'prices', handle: 'saveandplay.com', n: 99, uri: 'at://did:plc:x/app.bsky.feed.post/e99', author: 'e99.bsky.social', text: T[0], status: 'sent', at: new Date(Date.now() - 30 * 36e5).toISOString() });
  put(root, 'comments-sent-20261020-080000.json', { madeAt: new Date().toISOString(), entries: earlier });
  approvedFile(root, [item(1, ps[0], T[0].replace('real low', 'good low'))], { stamp: '20261020-090000', agoMin: 30 * 60 });
  approvedFile(root, [item(1, ps[2], 'Use code SAVE10 for this one, it works.'), item(2, ps[3], T[0].replace('real low', 'good low')), item(3, ps[1], T[1]), item(4, ps[4], T[3])], { stamp: '20261020-100000', agoMin: 5 });
  await withServer(fake, async (base) => {
    const r = await run('comments-send.mjs', root, { env: sendEnv(base) });
    assert.equal(r.code, 0, r.out);
    const es = read(root, files(root, 'comments-sent-').at(-1)).entries;
    const by = Object.fromEntries(es.map((e) => [e.uri, `${e.status}: ${e.reason}`]));
    assert.equal(by[ps[0].uri], 'skipped: approval older than 24 h');
    assert.equal(by[ps[1].uri], 'sent: sent');
    assert.match(by[ps[2].uri], /^skipped: text: has "use code"/);
    assert.match(by[ps[3].uri], /^skipped: text: too similar to an earlier reply/);
    assert.equal(by[ps[4].uri], 'waiting: daily limit (30 in 24 h)', '29 earlier ones in 24 h + 1 now = the limit of 30 (the reply of 30 h ago does not count)');
    assert.equal(fake.created.length, 1);
  });

  // "стоп": a cancel file written after the approval stops every reply approved before it
  const two = tempRoot();
  const q = [mkPost(), mkPost()];
  const fake2 = fakeBluesky({ posts: q });
  approvedFile(two, [item(1, q[0], T[0]), item(2, q[1], T[1])], { agoMin: 3 });
  put(two, 'comments-cancel-prices-20261020-120000.json', { account: 'prices', handle: 'saveandplay.com', at: new Date().toISOString(), all: true });
  await withServer(fake2, async (base) => {
    const r = await run('comments-send.mjs', two, { env: sendEnv(base) });
    assert.equal(r.code, 0, r.out);
    assert.equal(fake2.created.length, 0);
    assert.deepEqual(read(two, files(two, 'comments-sent-')[0]).entries.map((e) => e.reason), ['cancelled by the owner', 'cancelled by the owner']);
  });
});

test('pending: a reply held back by the daily limit is tried again later, a normal skip is final', () => {
  const approved = [{ name: 'a.json', data: { handle: 'x.bsky.social', account: 'cozy', approvedAt: '2026-10-20T00:00:00Z', items: [{ n: 1, uri: 'at://u/1' }, { n: 2, uri: 'at://u/2' }, { n: 3, uri: 'at://u/3' }, { n: 4, uri: 'at://u/4' }] } }];
  const e = (uri, status, reason) => ({ handle: 'x.bsky.social', uri, status, reason });
  const sent = [e('at://u/1', 'skipped', 'daily limit (10 in 24 h)'), e('at://u/2', 'waiting', 'daily limit (10 in 24 h)'), e('at://u/3', 'skipped', 'the post is deleted or hidden'), e('at://u/4', 'sent', 'sent')];
  const left = pendingItems({ approved, sent, cancels: [] }).map((i) => i.n);
  assert.deepEqual(left, [1, 2], 'old "skipped: daily limit" reports and "waiting" are tried again; a real skip and a sent reply are done');
});

test('sender: replies the owner sent by hand count too (the daily limit, one reply per person)', async () => {
  const root = tempRoot();
  const ps = [mkPost(), mkPost(), mkPost()];
  const ours = (i, to, ageH) => ({ post: { uri: `at://${ME.did}/app.bsky.feed.post/m${i}`, author: { did: ME.did, handle: ME.handle }, record: { text: `manual ${i}`, createdAt: new Date(Date.now() - ageH * 36e5).toISOString(), reply: { parent: { uri: 'x' }, root: { uri: 'x' } } } }, reply: { parent: { author: { handle: to } } } });
  // by hand today: one reply to the author of the first post, and 28 others; one more yesterday that does not count
  const feed = [ours(0, ps[0].author.handle, 3), ...Array.from({ length: 28 }, (_, i) => ours(i + 1, `m${i}.bsky.social`, 5)), ours(99, 'old.bsky.social', 30),
    { post: { uri: 'at://did:plc:me/app.bsky.feed.post/top', author: { did: ME.did }, record: { text: 'our own post', createdAt: new Date().toISOString() } } }];
  approvedFile(root, [item(1, ps[0], T[0]), item(2, ps[1], T[1]), item(3, ps[2], T[2])]);
  const fake = fakeBluesky({ posts: ps, feed });
  await withServer(fake, async (base) => {
    const r = await run('comments-send.mjs', root, { env: sendEnv(base) });
    assert.equal(r.code, 0, r.out);
    const es = read(root, files(root, 'comments-sent-')[0]).entries;
    assert.deepEqual(es.map((e) => e.status), ['skipped', 'sent', 'waiting'], r.out);
    assert.match(es[0].reason, /we replied to @author\d+\.bsky\.social less than 24 h ago/);
    assert.equal(es[2].reason, 'daily limit (30 in 24 h)', '29 by hand + 1 now = 30');
  });
});

test('sender: a dry run checks and posts nothing; a wrong password or a wrong account sends nothing', async () => {
  const root = tempRoot();
  const p = mkPost();
  approvedFile(root, [item(1, p, T[0])]);
  const fake = fakeBluesky({ posts: [p] });
  await withServer(fake, async (base) => {
    let r = await run('comments-send.mjs', root, { env: sendEnv(base), args: ['--dry-run'] });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /DRY RUN/);
    assert.equal(fake.created.length, 0);
    assert.deepEqual(files(root, 'comments-sent-'), [], 'a dry run saves nothing');
    r = await run('comments-send.mjs', root, { env: sendEnv(base, { BSKY_APP_PASSWORD: 'wrong-password-123' }) });
    assert.equal(r.code, 1);
    assert.match(r.out, /login as @saveandplay\.com failed/);
    assert.ok(!r.out.includes('wrong-password-123'));
    r = await run('comments-send.mjs', root, { env: sendEnv(base, { BSKY_APP_PASSWORD: '' }) });
    assert.equal(r.code, 1);
    assert.match(r.out, /no secret BSKY_APP_PASSWORD/);
    assert.equal(fake.created.length, 0);
  });
  const fake2 = fakeBluesky({ posts: [p], identity: { did: 'did:plc:other', handle: 'other.bsky.social' } });
  await withServer(fake2, async (base) => {
    const r = await run('comments-send.mjs', root, { env: sendEnv(base) });
    assert.equal(r.code, 1);
    assert.match(r.out, /the login is @other\.bsky\.social, not @saveandplay\.com/);
    assert.equal(fake2.created.length, 0);
  });
});

test('sender: when Bluesky says "slow down" it stops, and the next run goes on without a double reply', async () => {
  const root = tempRoot();
  const ps = [mkPost(), mkPost(), mkPost()];
  approvedFile(root, [item(1, ps[0], T[0]), item(2, ps[1], T[1]), item(3, ps[2], T[2])]);
  const fake = fakeBluesky({ posts: ps, failText: { text: T[1], status: 429, error: 'RateLimitExceeded', message: 'Rate Limit Exceeded' } });
  await withServer(fake, async (base) => {
    const r = await run('comments-send.mjs', root, { env: sendEnv(base) });
    assert.equal(r.code, 1, r.out);
    assert.equal(fake.created.length, 1);
    const es = read(root, files(root, 'comments-sent-')[0]).entries;
    assert.deepEqual(es.map((e) => e.status), ['sent', 'failed'], 'the third reply was not tried');
  });
  const fake2 = fakeBluesky({ posts: ps });
  await withServer(fake2, async (base) => {
    const r = await run('comments-send.mjs', root, { env: sendEnv(base) });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(fake2.created.map((c) => c.record.text), [T[1], T[2]], 'the first reply is not sent again');
  });
});

const hasGit = process.platform !== 'win32' && spawnSync('git', ['--version']).status === 0;
test('sender: a "стоп" pushed while a run is going stops the replies that did not go yet', { skip: !hasGit && 'needs git (not on Windows)' }, async () => {
  const base = mkdtempSync(join(tmpdir(), 'stop-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, env, encoding: 'utf8' }); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
  const remote = join(base, 'remote.git');
  git(base, 'init', '-q', '--bare', '-b', 'main', remote);
  const work = join(base, 'work');
  git(base, 'clone', '-q', remote, work);
  git(work, 'checkout', '-q', '--orphan', 'comments');
  writeFileSync(join(work, 'comments-cancel-prices-20261020-120000.json'), JSON.stringify({ account: 'prices', handle: 'saveandplay.com', at: new Date().toISOString(), all: true }));
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'stop');
  git(work, 'push', '-q', 'origin', 'comments');
  const root = tempRoot();
  const p = mkPost();
  approvedFile(root, [item(1, p, T[0])], { agoMin: 2 });
  const fake = fakeBluesky({ posts: [p] });
  await withServer(fake, async (url) => {
    const r = await run('comments-send.mjs', root, { env: sendEnv(url, { COMMENTS_CANCEL_FROM_GIT: '1' }), cwd: work });
    assert.equal(r.code, 0, r.out);
    assert.equal(fake.created.length, 0, 'the "стоп" on the branch was seen before the reply went');
    assert.equal(read(root, files(root, 'comments-sent-')[0]).entries[0].reason, 'cancelled by the owner');
  });
});

test('cancel: "стоп" writes a cancel file for the replies that are still waiting', async () => {
  const root = tempRoot();
  const ps = [mkPost(), mkPost()];
  approvedFile(root, [item(1, ps[0], T[0]), item(2, ps[1], T[1])]);
  let r = await drafts(root, ['cancel', '--account', 'prices', '--n', '2']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /STOPPED: 1 approved reply/);
  assert.match(r.out, /gh run cancel/);
  const [c] = files(root, 'comments-cancel-');
  assert.deepEqual(read(root, c).keys, [itemKey('saveandplay.com', ps[1].uri)]);
  r = await drafts(root, ['cancel', '--account', 'prices']);
  assert.match(r.out, /STOPPED: 1 approved reply/, 'without numbers: every reply still waiting (number 2 was stopped already)');
  const cancels = files(root, 'comments-cancel-');
  assert.equal(cancels.length, 2, 'two "стоп" in the same second are two files, the first is not overwritten');
  const pending = pendingItems({ approved: [{ name: 'a', data: read(root, files(root, 'comments-approved-')[0]) }], sent: [], cancels: cancels.map((name) => ({ name, data: read(root, name) })) });
  assert.deepEqual(pending.map((p) => p.cancelled), [true, true]);
});

// ---- the daily numbers and the status the chat shows -----------------------------------------------------------------
test('stats: likes and replies of our replies; reposts, own posts, old and fresh replies are counted right', async () => {
  const root = tempRoot();
  const now = Date.now();
  const ours = (i, o) => ({ post: { uri: `at://${ME.did}/app.bsky.feed.post/s${i}`, author: { handle: 'saveandplay.com' }, record: { text: o.text, createdAt: new Date(now - o.ageH * 36e5).toISOString(), reply: { parent: { uri: 'x' }, root: { uri: 'x' } } }, likeCount: o.likes ?? 0, replyCount: o.replies ?? 0 }, reply: { parent: { author: { handle: `to${i}.bsky.social` } } } });
  const feed = [
    ours(1, { text: 'A reply that worked very well', ageH: 30, likes: 3, replies: 1 }),
    ours(2, { text: 'A reply with one like', ageH: 40, likes: 1 }),
    ours(3, { text: 'A reply nobody liked', ageH: 50 }),
    ours(4, { text: 'A fresh reply', ageH: 2, likes: 5 }),
    ours(5, { text: 'A very old reply', ageH: 24 * 20, likes: 9 }),
    { post: { uri: 'at://did:plc:me/app.bsky.feed.post/own', author: { handle: 'saveandplay.com' }, record: { text: 'Our own deal post', createdAt: new Date(now - 30 * 36e5).toISOString() }, likeCount: 7 } },
    { post: { uri: 'at://did:plc:z/app.bsky.feed.post/rp', author: { handle: 'someone.bsky.social' }, record: { text: 'reposted', createdAt: new Date(now - 30 * 36e5).toISOString(), reply: {} } }, reason: { $type: 'app.bsky.feed.defs#reasonRepost' } },
  ];
  put(root, 'comments-sent-20261020-090000.json', { madeAt: new Date().toISOString(), entries: [{ handle: 'saveandplay.com', uri: 'x', status: 'sent', replyUri: `at://${ME.did}/app.bsky.feed.post/s2`, at: new Date(now - 40 * 36e5).toISOString(), author: 'to2.bsky.social', text: 'A reply with one like' }] });
  const asked = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    asked.push(url.searchParams.get('actor'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(url.searchParams.get('actor') === 'saveandplay.com' ? { feed } : { feed: [] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const summaryFile = join(root, 'summary.md');
  try {
    const r = await run('comments-stats.mjs', root, { env: { BSKY_PUBLIC_BASE: `http://127.0.0.1:${server.address().port}`, GITHUB_STEP_SUMMARY: summaryFile } });
    assert.equal(r.code, 0, r.out);
    assert.ok(asked.includes('saveandplay.com') && asked.includes('cozygame.bsky.social') && asked.includes('retrogamedeals.bsky.social'), 'every Bluesky account, once per handle');
    assert.ok(!asked.includes('saveandplay@mastodon.social'), 'not Mastodon');
    const st = read(root, files(root, 'comments-stats-prices-')[0]);
    assert.equal(st.total, 4, 'four replies in 14 days (the old one, our own post and the repost are left out)');
    assert.deepEqual(st.mature, { count: 3, withLike: 2, withReply: 1, likes: 4, replies: 1, byProgram: 1 });
    assert.equal(st.top[0].text, 'A reply that worked very well');
    assert.equal(st.top[0].to, 'to1.bsky.social');
    assert.ok(!st.top.some((t) => t.text === 'A fresh reply'), 'a fresh reply had no time yet');
    assert.match(readFileSync(summaryFile, 'utf8'), /с лайком 2 \(67%\)/);
    assert.match(readFileSync(join(root, 'drafts', '.comments-new-files'), 'utf8'), /comments-stats-prices-/);
    // the chat sees it
    const s = await drafts(root, ['status']);
    assert.equal(s.code, 0, s.out);
    assert.match(s.out, /SENDING @saveandplay\.com \(prices: limit 30 in 24 h, prices-wide: limit 30 in 24 h\)/);
    assert.match(s.out, /QUALITY .*: 3 replies, 2 with a like \(67%\), 1 got a reply from a person/);
    assert.match(s.out, /likes 3, replies 1: "A reply that worked very well" \(to @to1\.bsky\.social\)/);
    assert.match(s.out, /Last run .*: 1 sent/);
  } finally {
    server.close();
  }
});

// ---- the workflow ------------------------------------------------------------------------------------------------
test('the workflow: started by the chat or by hand (with a dry run), one at a time, saves what was sent even when stopped', () => {
  const wf = readFileSync(fileURLToPath(new URL('./comments-send-workflow.yml', import.meta.url)), 'utf8');
  assert.match(wf, /^name: Send comments$/m);
  assert.match(wf, /workflow_dispatch:\n\s+inputs:\n\s+dry_run:/);
  assert.match(wf, /group: send-comments\n\s+cancel-in-progress: false/);
  assert.match(wf, /BSKY_APP_PASSWORD: \$\{\{ secrets\.BSKY_APP_PASSWORD \}\}/);
  assert.match(wf, /REPO_PRIVATE: \$\{\{ github\.event\.repository\.private \}\}/);
  assert.match(wf, /COMMENTS_CANCEL_FROM_GIT: '1'/);
  assert.match(wf, /if: \$\{\{ always\(\) \}\}\n\s+run: \|\n\s+if \[ -s drafts\/\.comments-new-files \]/);
  assert.match(wf, /timeout-minutes: \$\{\{ github\.event\.repository\.private && 25 \|\| 90 \}\}/);
  assert.ok(!/toJSON\(secrets\)/.test(wf), 'only the named secrets reach the program');
  const live = fileURLToPath(new URL('../.github/workflows/comments-send.yml', import.meta.url));
  if (existsSync(live)) assert.equal(readFileSync(live, 'utf8').replace(/\r\n/g, '\n'), wf.replace(/\r\n/g, '\n'), 'scripts/comments-send-workflow.yml and .github/workflows/comments-send.yml are the same');
});
