// Tests of the Lemmy scripts. They run offline: a small fake Lemmy server (written here, both API v3 of Lemmy 0.19 and API v4 of Lemmy 1.0) plays the real one.
//
//   npm run lemmy:test
//
// What is checked: the real settings files (valid, every community switched off, autopost off), the checks of the settings, the text of a deal post
// (only brief numbers, the "Ad:" line last, thumbnail with alt text) and of a guide post, finding out the API version (v3 / v4 / not Lemmy), login errors,
// "dry-run publishes nothing and logs in nowhere", the autopost switch, one deal a day (record, Re-run, the same deal for a community that was missing),
// a community that fails (red, the others are not posted twice, tried again), the second guard (our post is already on the server), a community
// that is only found through resolve_object, the guide rules (oldest first, every 2 days, "lemmy: false", page must be live, retry window),
// stale brief and old price, the check and profile modes, the git branch script with another record file, the secret script,
// and that the password and the login token never appear in any output.
// Nothing here touches the real data/ folder or a real server: every test works in a temporary folder.

import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

delete process.env.LEMMY_ROOT; // the test itself imports the code, which must see the real settings
const lib = await import('./lib/lemmy.mjs');
const { buildDealPost, buildArticlePost, configProblems, ownPost, createClient, buildProfile, withLemmyDefaults, DISCLOSURE, MAX_TITLE } = lib;
process.env.DAILY_BRIEF_AS_MODULE = '1';
const { withDefaults: briefDefaults } = await import('./daily-brief.mjs');

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const NOW = '2026-10-12T12:00:00Z'; // 07:00 in Bogota
const DAY = '2026-10-12';
const PASSWORD = 'pw-Zx9-secret-4711';
const JWT = 'jwt-Qv7-token-0815';
const SITE = 'https://saveandplay.com';

const realAccounts = JSON.parse(readFileSync(here('../data/accounts.json'), 'utf8'));
const realLemmy = JSON.parse(readFileSync(here('../data/lemmy-accounts.json'), 'utf8'));

const candidate = {
  id: 'indiegala-control-ultimate-edition',
  kind: 'deal',
  title: 'Control Ultimate Edition',
  store: 'IndieGala',
  price: 5.99,
  was: 39.99,
  discount: 85,
  endsAt: '2026-10-13T23:59:00Z',
  endsInHours: 36,
  priceCheckedAt: '2026-10-12T09:49:09.029Z',
  cover: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/870780/header.jpg?t=1781607969',
  coverAlt: 'Cover art for Control Ultimate Edition',
  discountRank: 10,
  link: `${SITE}/deals/indiegala/control-ultimate-edition/?utm_source=lemmy-prices&utm_medium=social&utm_campaign=deals-${DAY}`,
  whyToday: ['sale ends in 36 h', 'deepest-discount rank 10 of 38'],
};
const other = { ...candidate, id: 'gog-other-game', title: 'Other Game', store: 'GOG', price: 3.99, was: 19.99, discount: 80, link: `${SITE}/deals/gog/other-game/?utm_source=lemmy-prices&utm_medium=social&utm_campaign=deals-${DAY}` };
const brief = (list = [candidate], over = {}) => ({ account: 'Honest prices', generatedAt: '2026-10-12T11:00:00.000Z', candidates: list, warnings: [], ...over });

// ---------- fake Lemmy server ----------

const person = () => ({ name: 'saveandplay', actor_id: 'https://lemmy.example/u/saveandplay' });

function startLemmy(opts = {}) {
  const S = {
    api: opts.api ?? 'v3', // the API this server speaks; the other one answers 404 (like Lemmy 0.19 does for v4)
    html: opts.html ?? false, // not Lemmy at all: every answer is a web page
    loginError: opts.loginError ?? null,
    communities: {
      'gamedeals@lemmy.example': { id: 11 },
      'steam@lemmy.example': { id: 12 },
      'off@lemmy.example': { id: 13 },
      'pc@lemmy.example': { id: 14 },
      'only@lemmy.example': { id: 15, restricted: true },
      'gone@lemmy.example': { id: 16, removed: true },
      ...(opts.communities ?? {}),
    },
    remote: { 'deals@remote.example': { id: 21 }, ...(opts.remote ?? {}) }, // found only through resolve_object
    seeded: opts.seeded ?? [], // posts that exist before: { communityId, name, url, creator, hoursAgo }
    failPost: { ...(opts.failPost ?? {}) }, // "name@server" => error code of the server
    dropAvatar: opts.dropAvatar ?? false,
    posts: [],
    calls: [],
    profile: { name: 'saveandplay', display_name: null, bio: null, bot_account: false },
    nextId: 100,
  };
  const byId = (id) => Object.entries(S.communities).find(([, c]) => c.id === Number(id));
  const view = (name, c) => ({ community_view: { community: { id: c.id, name: name.split('@')[0], title: name, actor_id: `https://${name.split('@')[1]}/c/${name.split('@')[0]}`, posting_restricted_to_mods: Boolean(c.restricted), removed: Boolean(c.removed), deleted: false, nsfw: false }, counts: { subscribers: 1234 } } });
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://x');
    const body = raw ? JSON.parse(raw) : null;
    S.calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization ?? null, body });
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(obj === undefined ? '' : JSON.stringify(obj));
    };
    if (S.html) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html>welcome</html>');
    }
    const m = url.pathname.match(/^\/api\/(v3|v4)(\/.*)$/);
    if (!m || m[1] !== S.api) return send(404);
    const route = m[2];
    const v4 = S.api === 'v4';
    const authed = req.headers.authorization === `Bearer ${JWT}`;
    const err = (code, status = 400) => send(status, { error: code });

    if (req.method === 'GET' && route === '/site') return send(200, { version: v4 ? '1.0.0-beta.1' : '0.19.20', site_view: { site: { name: 'mock' } }, ...(authed && !v4 ? { my_user: { local_user_view: { person: S.profile } } } : {}) });
    if (req.method === 'GET' && route === '/account') return authed ? send(200, { local_user_view: { person: S.profile } }) : err('not_logged_in', 401);
    if (req.method === 'POST' && route === (v4 ? '/account/auth/login' : '/user/login')) {
      if (S.loginError) return err(S.loginError);
      if (body?.username_or_email !== 'saveandplay' || body?.password !== PASSWORD) return err('incorrect_login');
      return send(200, { jwt: JWT, registration_created: false, verify_email_sent: false });
    }
    if (req.method === 'GET' && route === '/community') {
      const c = S.communities[url.searchParams.get('name')];
      return c ? send(200, view(url.searchParams.get('name'), c)) : err('couldnt_find_community');
    }
    if (req.method === 'GET' && route === '/resolve_object') {
      if (!authed) return err('not_logged_in', 401);
      const name = (url.searchParams.get('q') ?? '').replace(/^!/, '');
      const c = S.remote[name];
      if (!c) return err('couldnt_find_object');
      S.communities[name] = c;
      return send(200, { community: view(name, c).community_view });
    }
    if (req.method === 'GET' && route === '/post/list') {
      const cid = Number(url.searchParams.get('community_id'));
      const made = S.posts.filter((p) => p.communityId === cid);
      const old = S.seeded.filter((p) => p.communityId === cid).map((p) => ({ ...p, published: new Date(Date.parse(NOW) - p.hoursAgo * 3600e3).toISOString() }));
      const all = [...made, ...old].sort((a, b) => b.published.localeCompare(a.published));
      return send(200, { posts: all.map((p) => ({ post: { id: p.id ?? 1, name: p.name, url: p.url, published: p.published }, creator: p.creator ? { name: p.creator, actor_id: `https://${p.creatorHost ?? 'lemmy.example'}/u/${p.creator}` } : person(), community: { id: cid } })) });
    }
    if (req.method === 'POST' && route === '/post') {
      if (!authed) return err('not_logged_in', 401);
      const found = byId(body.community_id);
      if (!found) return err('couldnt_find_community');
      const [name, c] = found;
      if (S.failPost[name]) return err(S.failPost[name]);
      if (c.restricted) return err('only_mods_can_post_in_community');
      if (!body.name || body.name.length > 200) return err('invalid_post_title');
      const post = { id: S.nextId++, communityId: c.id, community: name, name: body.name, url: body.url ?? null, body: body.body ?? null, published: new Date(Date.parse(NOW)).toISOString(), creator: 'saveandplay', fields: body };
      S.posts.push(post);
      return send(200, { post_view: { post: { id: post.id, ap_id: `https://lemmy.example/post/${post.id}`, name: post.name, url: post.url } } });
    }
    if (req.method === 'PUT' && route === (v4 ? '/account/settings' : '/user/save_user_settings')) {
      if (!authed) return err('not_logged_in', 401);
      const { display_name, bio, bot_account, avatar, banner } = body;
      Object.assign(S.profile, { display_name, bio, bot_account, ...(S.dropAvatar ? {} : { avatar, banner }) });
      return send(200, { success: true });
    }
    return send(404);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, S, close: () => server.close() })));
}

// The live site, faked: every page answers 200 except the paths in "down". The scripts reach it through LEMMY_PAGE_BASE.
function startPages() {
  const down = new Set();
  const server = http.createServer((req, res) => {
    res.writeHead(down.has(req.url.split('?')[0]) ? 404 : 200, { 'content-type': 'text/html' });
    res.end('page');
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, down })));
}
const pages = await startPages();

// ---------- a temporary project folder ----------

const guideFile = (fm) => `---
layout: ../../layouts/Article.astro
section: guides
${fm}
---

Text.
`;
const guideHead = (slug, n, extra = '') => `title: "Guide ${slug}: a title"
description: "What guide ${slug} is about."
updated: 2026-09-${String(10 + n).padStart(2, '0')}
image: /og/${slug}.png
imageAlt: "Picture for ${slug}"${extra ? '\n' + extra : ''}`;
const DEAL_COMMUNITIES = [
  { community: 'gamedeals@lemmy.example', kinds: ['deal'], enabled: true },
  { community: 'deals@remote.example', kinds: ['deal'], enabled: true },
  { community: 'off@lemmy.example', kinds: ['deal'], enabled: false },
];
const ART_COMMUNITIES = [{ community: 'steam@lemmy.example', kinds: ['article'], enabled: true }];

function makeRoot({ autopost = true, communities = [...DEAL_COMMUNITIES, ...ART_COMMUNITIES], briefJson = brief(), env = `LEMMY_PASSWORD=${PASSWORD}\nOTHER_SECRET=secret-ftp-1\n`, guides = { 'g-old': 0, 'g-mid': 1, 'g-new': 2 }, account = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lemmy-test-'));
  for (const d of ['data', 'drafts', 'public/og', 'src/pages/guides']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'data/accounts.json'), JSON.stringify(realAccounts, null, 2) + '\n');
  const cfg = JSON.parse(JSON.stringify(realLemmy));
  // The fake server knows the user "saveandplay", whatever name the owner has in the real settings.
  Object.assign(cfg.accounts.lemmy, { instance: 'lemmy.example', username: 'saveandplay', autopost, communities, ...account });
  writeFileSync(join(root, 'data/lemmy-accounts.json'), JSON.stringify(cfg, null, 2) + '\n');
  for (const [slug, n] of Object.entries(guides)) {
    writeFileSync(join(root, `src/pages/guides/${slug}.md`), guideFile(typeof n === 'string' ? n : guideHead(slug, n)));
    writeFileSync(join(root, `public/og/${slug}.png`), 'png');
  }
  if (briefJson) writeFileSync(join(root, 'drafts/brief-lemmy.json'), JSON.stringify(briefJson));
  writeFileSync(join(root, '.gitignore'), '.env\n');
  if (env !== null) writeFileSync(join(root, '.env'), env);
  return root;
}
const setBrief = (root, b) => writeFileSync(join(root, 'drafts/brief-lemmy.json'), JSON.stringify(b));
const setConfig = (root, fn) => {
  const f = join(root, 'data/lemmy-accounts.json');
  const cfg = JSON.parse(readFileSync(f, 'utf8'));
  fn(cfg.accounts.lemmy);
  writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n');
};

const cleanEnv = () => {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (/^(LEMMY_|GITHUB_)/.test(k)) delete e[k];
  return e;
};
const leaks = [];
// The scripts run as child processes. It must be async: the fake servers live in THIS process and would not answer while it is blocked.
function run(script, args, { root, server, now = NOW, env = {}, withPassword = false } = {}) {
  const summaryFile = join(root, `summary-${Math.random().toString(36).slice(2, 8)}.md`);
  return new Promise((done) => {
    const child = spawn(process.execPath, [here(script), ...args], {
      env: { ...cleanEnv(), LEMMY_ROOT: root, LEMMY_NOW: now, GITHUB_STEP_SUMMARY: summaryFile, LEMMY_PAGE_BASE: pages.url, LEMMY_PAUSE_MS: '0', LEMMY_RETRY_MS: '10', LEMMY_TIMEOUT_MS: '3000', ...(server ? { LEMMY_API_BASE: server.url } : {}), ...(withPassword ? { LEMMY_PASSWORD: PASSWORD } : {}), ...env },
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
const post = (root, server, kind, extra = [], opts = {}) => run('post-lemmy.mjs', ['--kind', kind, ...extra], { root, server, ...opts });
const readState = (root) => JSON.parse(readFileSync(join(root, 'drafts/posted-lemmy.json'), 'utf8'));
const nextDay = (n) => new Date(Date.parse(NOW) + n * 864e5).toISOString();
const posts = (server) => server.S.calls.filter((c) => c.method === 'POST' && /\/post$/.test(c.path));

// ---------- the tests ----------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the real settings: valid, every community switched off, autopost off, the brief block exists with its own subid', () => {
  const a = realLemmy.accounts.lemmy;
  assert.equal(a.autopost, false, 'a new channel starts with autopost off: the owner switches it on');
  assert.ok(a.communities.length >= 2 && a.communities.every((c) => c.enabled === false), 'no community is switched on before the owner has read its rules');
  const account = withLemmyDefaults('lemmy', { ...realAccounts.accounts.lemmy, ...a });
  assert.deepEqual(configProblems(account), []);
  assert.deepEqual(configProblems(withLemmyDefaults('lemmy', { ...realAccounts.accounts.lemmy, ...a, communities: a.communities.map((c) => ({ ...c, enabled: true })) })), []);
  assert.equal(realAccounts.accounts.lemmy.subid, 'lemmy-prices');
  assert.ok(!('autopost' in realAccounts.accounts.lemmy) && !('communities' in realAccounts.accounts.lemmy), 'no Lemmy-only settings in data/accounts.json');
  assert.ok(!('channels' in realAccounts.accounts.lemmy), 'no channels block: the daily brief makes no ready-to-copy post for Lemmy');
  assert.doesNotThrow(() => briefDefaults('lemmy', realAccounts.accounts.lemmy), 'the daily brief accepts the block');
  assert.deepEqual(realAccounts.accounts.lemmy.stores, ['GOG', 'IndieGala'], 'Kinguin (marketplace keys) is not offered to Lemmy');
  assert.ok(!JSON.stringify(realLemmy).match(/pass(word)?"\s*:\s*"[^"]/i), 'no password in the file');
  const profile = buildProfile(account);
  assert.equal(profile.bot_account, true, 'the account is marked as a bot');
  assert.ok(profile.bio.length <= 300 && /bot/i.test(profile.bio) && /affiliate/i.test(profile.bio) && profile.bio.includes('/go/lemmy'));
});

test('settings are checked with plain sentences', () => {
  const ok = withLemmyDefaults('lemmy', { instance: 'lemmy.zip', username: 'saveandplay', communities: [{ community: 'gamedeals@lemmy.zip', kinds: ['deal'] }] });
  assert.deepEqual(configProblems(ok), []);
  const bad = (over) => configProblems(withLemmyDefaults('lemmy', { ...ok, ...over })).join(' | ');
  assert.match(bad({ instance: 'https://lemmy.zip' }), /instance/);
  assert.match(bad({ username: '@me' }), /username/);
  assert.match(bad({ username: '' }), /username/);
  assert.match(bad({ communities: [{ community: 'gamedeals', kinds: ['deal'] }] }), /must look like name@server/);
  assert.match(bad({ communities: [{ community: 'a@b.example', kinds: ['deal'] }, { community: 'A@b.example', kinds: ['article'] }] }), /listed twice/);
  assert.match(bad({ communities: [{ community: 'a@b.example', kinds: [] }] }), /kinds/);
  assert.match(bad({ communities: [{ community: 'a@b.example', kinds: ['news'] }] }), /kinds/);
  assert.match(bad({ communities: [{ community: 'a@b.example', kinds: ['deal'], titleTemplate: '{store} {nope}' }] }), /titleTemplate/);
  assert.match(bad({ communities: [{ community: 'a@b.example', kinds: ['deal'], languageId: 'en' }] }), /languageId/);
  assert.match(bad({ articleEveryDays: 0 }), /articleEveryDays/);
  assert.match(bad({ apiVersion: 'v9' }), /apiVersion/);
});

test('deal post: only brief numbers, our own page as the link, the "Ad:" line last, the cover as thumbnail with its alt text', () => {
  const p = buildDealPost(candidate);
  assert.equal(p.name, 'Control Ultimate Edition: -85% at IndieGala ($5.99, was $39.99)');
  assert.equal(p.url, candidate.link);
  assert.equal(p.body, ['**$5.99** (was $39.99) at IndieGala, -85%.', 'Price checked 2026-10-12 09:49 UTC. Sale ends 2026-10-13 23:59 UTC.', 'Why today: sale ends in 36 h.', DISCLOSURE].join('\n\n'));
  assert.ok(p.body.trimEnd().endsWith(DISCLOSURE) && DISCLOSURE === 'Ad: we may earn a commission if you buy.');
  assert.ok(!/#ad\b/i.test(p.name + p.body), '"#ad" is not used');
  assert.equal(p.custom_thumbnail, candidate.cover);
  assert.equal(p.alt_text, 'Cover art for Control Ultimate Edition');
  assert.ok(p.url.startsWith(`${SITE}/deals/`), 'a link to our page, never a store');
  // no cover = no thumbnail and no alt; no end date; the rank is shown only for the top 3; alt text is made when the brief has none
  const bare = buildDealPost({ ...candidate, cover: null, coverAlt: null, endsAt: null, whyToday: ['deepest-discount rank 2 of 38'], discountRank: 2 });
  assert.ok(!('custom_thumbnail' in bare) && !('alt_text' in bare) && !bare.body.includes('Sale ends') && bare.body.includes('Why today: deepest-discount rank 2 of 38.'));
  assert.ok(!buildDealPost({ ...candidate, whyToday: ['deepest-discount rank 9 of 38'], discountRank: 9 }).body.includes('Why today'));
  assert.equal(buildDealPost({ ...candidate, coverAlt: undefined }).alt_text, 'Cover art for Control Ultimate Edition');
  // a title template of the community; a very long title is cut to what Lemmy takes
  assert.equal(buildDealPost(candidate, '[{store}] {title} - {price}').name, '[IndieGala] Control Ultimate Edition - $5.99');
  const long = buildDealPost({ ...candidate, title: 'X'.repeat(300) });
  assert.equal(long.name.length, MAX_TITLE);
  assert.ok(long.name.endsWith('…'));
  for (const badData of [{ price: NaN }, { link: 'http://x' }, { link: undefined }, { priceCheckedAt: 'x' }, { title: '' }, { cover: 'ftp://x' }]) assert.throws(() => buildDealPost({ ...candidate, ...badData }), /not complete|not valid/);
});

test('guide post: title and description from the header, link with the marks of the account, picture with alt text; notes when something is missing', async () => {
  const root = makeRoot({ guides: { 'g-old': 0 } });
  process.env.LEMMY_ROOT = root;
  // the same module again, this time looking at the temporary folder (the folder is fixed when the module loads)
  const l2 = await import(`./lib/lemmy.mjs?root=${encodeURIComponent(root)}`);
  delete process.env.LEMMY_ROOT;
  const [g] = l2.listGuides();
  assert.equal(g.slug, 'g-old');
  const account = { subid: 'lemmy-prices' };
  const a = l2.buildArticlePost(g, account, SITE);
  assert.deepEqual(a.post, { name: 'Guide g-old: a title', url: `${SITE}/guides/g-old/?utm_source=lemmy-prices&utm_medium=social&utm_campaign=g-old`, body: 'What guide g-old is about.', custom_thumbnail: `${SITE}/og/g-old.png`, alt_text: 'Picture for g-old' });
  assert.equal(a.path, '/guides/g-old/');
  assert.deepEqual(a.notes, []);
  assert.ok(!/Ad:/.test(JSON.stringify(a.post)), 'a guide post has no Ad line: it links to our own guide, not to a store');
  // no description, no picture
  const bare = l2.buildArticlePost({ slug: 'x', text: guideFile('title: "T"') }, account, SITE);
  assert.deepEqual(bare.post, { name: 'T', url: `${SITE}/guides/x/?utm_source=lemmy-prices&utm_medium=social&utm_campaign=x` });
  assert.equal(bare.notes.length, 2);
  assert.ok(l2.buildArticlePost({ slug: 'x', text: guideFile('title: "T"\nimage: /og/x.png\nimageAlt: "A"') }, account, SITE).notes.some((n) => /does not exist/.test(n)), 'a picture file that is not there is not used');
  const noAlt = l2.buildArticlePost({ slug: 'x', text: guideFile('title: "T"\nimage: /og/g-old.png') }, account, SITE);
  assert.ok(noAlt.notes.some((n) => /imageAlt/.test(n)) && !('custom_thumbnail' in noAlt.post), 'a picture without alt text is not used');
  assert.throws(() => l2.buildArticlePost({ slug: 'x', text: guideFile('description: "D"') }, account, SITE), /no title/);
  assert.throws(() => l2.buildArticlePost({ slug: 'bad name', text: guideFile('title: "T"') }, account, SITE), /file name/);
  assert.throws(() => l2.buildArticlePost({ slug: 'x', text: 'no header' }, account, SITE), /no header/);
  assert.throws(() => l2.buildArticlePost(g, account, 'http://saveandplay.com'), /links.site/);
  // "lemmy: false" in the header keeps a guide out
  writeFileSync(join(root, 'src/pages/guides/g-off.md'), guideFile(guideHead('g-off', 5, 'lemmy: false')));
  assert.deepEqual(l2.listGuides().map((x) => [x.slug, x.off]), [['g-old', false], ['g-off', true]]);
});

test('second guard: a post of our account with our page, young enough, counts; other users, other pages and old deals do not', () => {
  const base = { username: 'saveandplay', instance: 'lemmy.example', site: SITE, pathname: '/deals/gog/x/', now: Date.parse(NOW) };
  const mk = (over = {}) => ({ id: 1, name: 'n', url: `${SITE}/deals/gog/x/?utm_source=lemmy-prices`, published: new Date(Date.parse(NOW) - 3600e3).toISOString(), creator: 'SaveAndPlay', creatorHost: 'lemmy.example', ...over });
  assert.ok(ownPost([mk()], { ...base, maxAgeHours: 36 }));
  assert.equal(ownPost([mk({ creator: 'someone' })], { ...base, maxAgeHours: 36 }), null);
  assert.equal(ownPost([mk({ creatorHost: 'other.example' })], { ...base, maxAgeHours: 36 }), null);
  assert.equal(ownPost([mk({ url: `${SITE}/deals/gog/y/` })], { ...base, maxAgeHours: 36 }), null);
  assert.equal(ownPost([mk({ url: 'https://elsewhere.example/deals/gog/x/' })], { ...base, maxAgeHours: 36 }), null);
  assert.equal(ownPost([mk({ published: new Date(Date.parse(NOW) - 40 * 3600e3).toISOString() })], { ...base, maxAgeHours: 36 }), null);
  assert.ok(ownPost([mk({ published: new Date(Date.parse(NOW) - 400 * 3600e3).toISOString() })], { ...base, maxAgeHours: null }), 'a guide counts at any age');
  assert.equal(ownPost([mk({ url: null })], base), null);
});

test('client: finds out v3 (Lemmy 0.19) and v4 (Lemmy 1.0), refuses a server that is not Lemmy, and the error codes come with advice', async () => {
  const v3 = await startLemmy({ api: 'v3' });
  const v4 = await startLemmy({ api: 'v4' });
  const web = await startLemmy({ html: true });
  const prev = process.env.LEMMY_API_BASE;
  try {
    process.env.LEMMY_API_BASE = v3.url;
    const c3 = createClient('lemmy.example', { retryMs: 5 });
    assert.deepEqual({ api: (await c3.detect()).api, v: (await c3.detect()).version }, { api: 'v3', v: '0.19.20' });
    assert.deepEqual(v3.S.calls.slice(0, 2).map((c) => c.path), ['/api/v4/site', '/api/v3/site'], 'v4 is asked first, then v3');
    process.env.LEMMY_API_BASE = v4.url;
    const c4 = createClient('lemmy.example', { retryMs: 5 });
    const f4 = await c4.detect();
    assert.deepEqual([f4.api, f4.version], ['v4', '1.0.0-beta.1']);
    await c4.login('saveandplay', PASSWORD);
    assert.ok(v4.S.calls.some((c) => c.path === '/api/v4/account/auth/login'));
    process.env.LEMMY_API_BASE = web.url;
    await assert.rejects(createClient('lemmy.example', { retryMs: 5 }).detect(), /does not answer like a Lemmy server/);
    process.env.LEMMY_API_BASE = 'http://127.0.0.1:1';
    await assert.rejects(createClient('lemmy.example', { retryMs: 5, timeoutMs: 500 }).detect(), (e) => e.code === 'network' && /does not answer/.test(e.message));
    // forced version
    process.env.LEMMY_API_BASE = v3.url;
    const forced = createClient('lemmy.example', { retryMs: 5 });
    await forced.detect('v3');
    assert.equal(forced.api, 'v3');
  } finally {
    process.env.LEMMY_API_BASE = prev ?? '';
    if (!prev) delete process.env.LEMMY_API_BASE;
    [v3, v4, web].forEach((s) => s.close());
  }
  for (const code of ['incorrect_login', 'email_not_verified', 'registration_application_is_pending', 'rate_limit_error', 'language_not_allowed', 'only_mods_can_post_in_community', 'person_is_banned_from_community', 'site_ban', 'couldnt_find_community', 'missing_totp_token']) assert.ok(lib.hintFor(code), `advice for ${code}`);
  assert.equal(lib.hintFor('something_new'), null);
});

test('dry-run: shows every post of every community (also the switched-off one), logs in nowhere, writes no record, needs no password', async () => {
  const lemmy = await startLemmy();
  const root = makeRoot({ autopost: false, env: null });
  const r = await post(root, lemmy, 'deal', ['--dry-run']);
  assert.equal(r.code, 0, r.all);
  assert.equal(lemmy.S.calls.length, 0, 'not a single request to the server');
  for (const c of ['gamedeals@lemmy.example', 'deals@remote.example', 'off@lemmy.example (switched off)']) assert.ok(r.out.includes(c), c);
  assert.ok(r.out.includes('title: Control Ultimate Edition: -85% at IndieGala') && r.out.includes('Ad: we may earn a commission if you buy.') && r.out.includes(`link: ${candidate.link}`) && r.out.includes('alt text: Cover art for Control Ultimate Edition'));
  assert.ok(r.summary.includes('Dry run: nothing was published') && r.summary.includes('"autopost" is false'));
  assert.ok(!existsSync(join(root, 'drafts/posted-lemmy.json')));
  const a = await post(root, lemmy, 'article', ['--dry-run']);
  assert.equal(a.code, 0, a.all);
  assert.ok(a.out.includes('title: Guide g-old: a title') && a.out.includes('steam@lemmy.example') && a.out.includes('Guide: g-old'), a.all);
  assert.equal(lemmy.S.calls.length, 0);
  lemmy.close();
});

test('autopost false: a real run is skipped (green), nothing is sent; no community switched on: skipped too', async () => {
  const lemmy = await startLemmy();
  const r = await post(makeRoot({ autopost: false }), lemmy, 'deal');
  assert.equal(r.code, 0, r.all);
  assert.ok(/autopost/.test(r.out) && lemmy.S.calls.length === 0);
  const none = await post(makeRoot({ communities: [{ community: 'off@lemmy.example', kinds: ['deal'], enabled: false }] }), lemmy, 'deal');
  assert.equal(none.code, 0, none.all);
  assert.ok(/switched off|none in data/.test(none.out) && lemmy.S.calls.length === 0);
  lemmy.close();
});

test('deal: posts to every community that is switched on (a remote one is found by resolve_object), once, with the right fields', async () => {
  const lemmy = await startLemmy();
  const root = makeRoot();
  const r = await post(root, lemmy, 'deal');
  assert.equal(r.code, 0, r.all);
  const made = lemmy.S.posts;
  assert.deepEqual(made.map((p) => p.community), ['gamedeals@lemmy.example', 'deals@remote.example'], 'the switched-off community is not touched');
  assert.ok(!lemmy.S.calls.some((c) => c.query.name === 'off@lemmy.example'));
  assert.ok(lemmy.S.calls.some((c) => c.path === '/api/v3/resolve_object' && c.query.q === '!deals@remote.example'), 'the remote community was fetched through resolve_object');
  const f = made[0].fields;
  assert.equal(f.community_id, 11);
  assert.equal(f.name, 'Control Ultimate Edition: -85% at IndieGala ($5.99, was $39.99)');
  assert.equal(f.url, candidate.link);
  assert.ok(f.body.trimEnd().endsWith(DISCLOSURE));
  assert.equal(f.custom_thumbnail, candidate.cover);
  assert.equal(f.alt_text, 'Cover art for Control Ultimate Edition');
  assert.equal(f.nsfw, false);
  assert.ok(!('language_id' in f) && !('honeypot' in f));
  for (const c of posts(lemmy)) assert.equal(c.auth, `Bearer ${JWT}`, 'the token goes in the Authorization header');
  const state = readState(root);
  const rec = state.accounts.lemmy[DAY].deal;
  assert.equal(rec.id, candidate.id);
  assert.deepEqual(Object.keys(rec.communities), ['gamedeals@lemmy.example', 'deals@remote.example']);
  assert.ok(Object.values(rec.communities).every((c) => c.status === 'done' && c.postId >= 100 && c.url.startsWith('https://lemmy.example/post/')));
  assert.ok(r.summary.includes('**Posted.**') && r.summary.includes('https://lemmy.example/post/100') && r.summary.includes('https://lemmy.example/post/101'));
  // a Re-run the same day: skipped, no login, no second post
  const before = lemmy.S.calls.length;
  const again = await post(root, lemmy, 'deal');
  assert.equal(again.code, 0, again.all);
  assert.ok(/already posted today/.test(again.out));
  assert.equal(lemmy.S.calls.length, before, 'the second run did not even log in');
  assert.equal(lemmy.S.posts.length, 2);
  // the next day a new deal goes out
  setBrief(root, brief([other], { generatedAt: '2026-10-13T11:00:00.000Z' }));
  const next = await post(root, lemmy, 'deal', [], { now: nextDay(1) });
  assert.equal(next.code, 0, next.all);
  assert.equal(lemmy.S.posts.length, 4);
  assert.equal(lemmy.S.posts[2].fields.name, 'Other Game: -80% at GOG ($3.99, was $19.99)');
  lemmy.close();
});

test('deal: a community can have its own title template and language; languageId is sent only then', async () => {
  const lemmy = await startLemmy();
  const root = makeRoot({ communities: [{ community: 'gamedeals@lemmy.example', kinds: ['deal'], titleTemplate: '[{store}] {title} - {price} ({discount}% off)', languageId: 37 }] });
  const r = await post(root, lemmy, 'deal');
  assert.equal(r.code, 0, r.all);
  assert.equal(lemmy.S.posts[0].fields.name, '[IndieGala] Control Ultimate Edition - $5.99 (85% off)');
  assert.equal(lemmy.S.posts[0].fields.language_id, 37);
  lemmy.close();
});

test('deal: a community that fails makes the run red, the others are not posted twice, the missing one gets the SAME deal later', async () => {
  const lemmy = await startLemmy({ failPost: { 'deals@remote.example': 'rate_limit_error' } });
  const root = makeRoot();
  const r = await post(root, lemmy, 'deal');
  assert.equal(r.code, 1, r.all);
  assert.deepEqual(lemmy.S.posts.map((p) => p.community), ['gamedeals@lemmy.example']);
  assert.ok(r.summary.includes('did NOT get the post') && r.summary.includes('rate_limit_error') && /limits how fast/.test(r.summary), 'the reason and the advice are shown');
  assert.deepEqual(Object.keys(readState(root).accounts.lemmy[DAY].deal.communities), ['gamedeals@lemmy.example'], 'only what went through is recorded');
  // the server recovers, the brief of the day changed meanwhile: the missing community still gets the deal of the morning
  lemmy.S.failPost = {};
  setBrief(root, brief([other, candidate]));
  const again = await post(root, lemmy, 'deal');
  assert.equal(again.code, 0, again.all);
  assert.deepEqual(lemmy.S.posts.map((p) => p.community), ['gamedeals@lemmy.example', 'deals@remote.example']);
  assert.equal(lemmy.S.posts[1].fields.url, candidate.link, 'the same deal, not the new first item of the brief');
  assert.ok(again.summary.includes('Posted again to the missing communities'), again.summary);
  // and if that deal has left the brief, nothing else is offered instead
  const lemmy2 = await startLemmy({ failPost: { 'deals@remote.example': 'rate_limit_error' } });
  const root2 = makeRoot();
  assert.equal((await post(root2, lemmy2, 'deal')).code, 1);
  lemmy2.S.failPost = {};
  setBrief(root2, brief([other]));
  const gone = await post(root2, lemmy2, 'deal');
  assert.equal(gone.code, 0, gone.all);
  assert.ok(/not in the brief any more/.test(gone.out) && lemmy2.S.posts.length === 1);
  lemmy.close();
  lemmy2.close();
});

test('deal: a lost record does not bring a double post: our post is found on the server and recorded', async () => {
  const lemmy = await startLemmy({
    seeded: [
      { communityId: 11, id: 77, name: 'earlier', url: `${SITE}/deals/indiegala/control-ultimate-edition/?utm_source=lemmy-prices`, creator: 'saveandplay', hoursAgo: 3 },
      { communityId: 21, id: 78, name: 'someone else posted it', url: `${SITE}/deals/indiegala/control-ultimate-edition/`, creator: 'another_user', hoursAgo: 2 },
    ],
  });
  const root = makeRoot();
  const r = await post(root, lemmy, 'deal');
  assert.equal(r.code, 0, r.all);
  assert.deepEqual(lemmy.S.posts.map((p) => p.community), ['deals@remote.example'], 'gamedeals already had it, the other community did not (the post there is from another user)');
  const rec = readState(root).accounts.lemmy[DAY].deal.communities['gamedeals@lemmy.example'];
  assert.equal(rec.foundOnServer, true);
  assert.equal(rec.postId, 77);
  assert.ok(r.summary.includes('already there'));
  lemmy.close();
});

test('deal: stale brief, old price, no brief, no deal, not a deal: skipped (green), nothing is sent', async () => {
  const lemmy = await startLemmy();
  const cases = [
    [makeRoot({ briefJson: brief([candidate], { generatedAt: '2026-10-11T11:00:00.000Z' }) }), /brief is 25 h old/],
    [makeRoot({ briefJson: brief([{ ...candidate, priceCheckedAt: '2026-10-09T09:00:00.000Z' }]) }), /Not posting an old price/],
    [makeRoot({ briefJson: null }), /no drafts\/brief-lemmy\.json/],
    [makeRoot({ briefJson: brief([], { warnings: ['NOTHING TO OFFER today.'] }) }), /no deal passes the rules/],
    [makeRoot({ briefJson: brief([{ ...candidate, kind: 'news' }]) }), /not a deal/],
  ];
  for (const [root, re] of cases) {
    const r = await post(root, lemmy, 'deal');
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, re);
  }
  assert.equal(lemmy.S.calls.length, 0);
  // a deal that is not complete is a real problem: red
  const broken = await post(makeRoot({ briefJson: brief([{ ...candidate, link: 'http://x' }]) }), lemmy, 'deal');
  assert.equal(broken.code, 1, broken.all);
  assert.match(broken.all, /not complete or not valid/);
  lemmy.close();
});

test('login problems are red, with advice, and nothing is recorded', async () => {
  for (const [opts, env, re] of [
    [{}, `LEMMY_PASSWORD=wrong\n`, /incorrect_login[\s\S]*user name or the password is wrong/],
    [{ loginError: 'email_not_verified' }, undefined, /email_not_verified[\s\S]*confirmed its e-mail/],
    [{ loginError: 'registration_application_is_pending' }, undefined, /not approved the registration/],
    [{ loginError: 'missing_totp_token' }, undefined, /two-factor/],
  ]) {
    const lemmy = await startLemmy(opts);
    const root = makeRoot(env ? { env } : {});
    const r = await post(root, lemmy, 'deal');
    assert.equal(r.code, 1, r.all);
    assert.match(r.all, re);
    assert.equal(lemmy.S.posts.length, 0);
    assert.ok(!existsSync(join(root, 'drafts/posted-lemmy.json')), 'a failed login records nothing, the next run tries again');
    lemmy.close();
  }
  const lemmy = await startLemmy();
  const noPw = await post(makeRoot({ env: null }), lemmy, 'deal');
  assert.equal(noPw.code, 1);
  assert.match(noPw.all, /no password \(LEMMY_PASSWORD\)[\s\S]*lemmy:secret/);
  assert.equal(lemmy.S.calls.length, 0);
  // bad settings: red, before any request
  const badCfg = await post(makeRoot({ account: { username: '@x' } }), lemmy, 'deal');
  assert.equal(badCfg.code, 1);
  assert.match(badCfg.all, /username/);
  // the server is down: red, nothing recorded
  const down = await post(makeRoot(), { url: 'http://127.0.0.1:1' }, 'deal');
  assert.equal(down.code, 1, down.all);
  assert.match(down.all, /does not answer/);
  lemmy.close();
});

test('communities that cannot take the post: only moderators, removed, banned: red with advice, the others still get it', async () => {
  const lemmy = await startLemmy({ failPost: { 'steam@lemmy.example': 'person_is_banned_from_community' } });
  const root = makeRoot({
    communities: [
      { community: 'only@lemmy.example', kinds: ['deal'] },
      { community: 'gone@lemmy.example', kinds: ['deal'] },
      { community: 'gamedeals@lemmy.example', kinds: ['deal'] },
      { community: 'steam@lemmy.example', kinds: ['deal'] },
      { community: 'nothere@lemmy.example', kinds: ['deal'] },
    ],
  });
  const r = await post(root, lemmy, 'deal');
  assert.equal(r.code, 1, r.all);
  assert.deepEqual(lemmy.S.posts.map((p) => p.community), ['gamedeals@lemmy.example']);
  assert.match(r.summary, /only_mods_can_post_in_community[^|]*Only moderators may post/);
  assert.match(r.summary, /removed or deleted/);
  assert.match(r.summary, /person_is_banned_from_community[^|]*banned from this community/);
  assert.match(r.summary, /couldnt_find_object[^|]*does not know this community/);
  lemmy.close();
});

test('v4 server (Lemmy 1.0): the same run works on the /api/v4 routes', async () => {
  const lemmy = await startLemmy({ api: 'v4' });
  const root = makeRoot();
  const r = await post(root, lemmy, 'deal');
  assert.equal(r.code, 0, r.all);
  assert.equal(lemmy.S.posts.length, 2);
  assert.ok(r.out.includes('Lemmy 1.0.0-beta.1, API v4'));
  assert.ok(lemmy.S.calls.filter((c) => c.path !== '/api/v4/site').every((c) => c.path.startsWith('/api/v4/')), 'after the first question nothing goes to /api/v3');
  assert.ok(lemmy.S.calls.some((c) => c.path === '/api/v4/account/auth/login'));
  lemmy.close();
});

test('guide: the oldest first, one every 2 days, picture with alt text, link with marks; "lemmy: false" and a page that is not live wait', async () => {
  const lemmy = await startLemmy();
  const root = makeRoot({ guides: { 'g-old': 0, 'g-mid': 1, 'g-new': 2, 'g-off': guideHead('g-off', -5, 'lemmy: false') } });
  const r = await post(root, lemmy, 'article');
  assert.equal(r.code, 0, r.all);
  assert.equal(lemmy.S.posts.length, 1);
  const f = lemmy.S.posts[0].fields;
  assert.deepEqual({ ...f }, { community_id: 12, name: 'Guide g-old: a title', url: `${SITE}/guides/g-old/?utm_source=lemmy-prices&utm_medium=social&utm_campaign=g-old`, body: 'What guide g-old is about.', custom_thumbnail: `${SITE}/og/g-old.png`, alt_text: 'Picture for g-old', nsfw: false });
  assert.ok(!f.body.includes('Ad:'));
  assert.equal(readState(root).articles.lemmy['g-old'].day, DAY);
  // the same day and the next day: too early
  const same = await post(root, lemmy, 'article');
  assert.ok(/not before 2026-10-14/.test(same.out), same.out);
  const tomorrow = await post(root, lemmy, 'article', [], { now: nextDay(1) });
  assert.ok(/not before 2026-10-14/.test(tomorrow.out), tomorrow.out);
  assert.equal(lemmy.S.posts.length, 1);
  // after 2 days the next guide, but only if its page is live
  pages.down.add('/guides/g-mid/');
  const notLive = await post(root, lemmy, 'article', [], { now: nextDay(2) });
  assert.equal(notLive.code, 0, notLive.all);
  assert.ok(/page not live yet/.test(notLive.out) && lemmy.S.posts.length === 1, notLive.out);
  pages.down.clear();
  const second = await post(root, lemmy, 'article', [], { now: nextDay(2) });
  assert.equal(second.code, 0, second.all);
  assert.equal(lemmy.S.posts[1].fields.name, 'Guide g-mid: a title', 'g-off is never posted, g-mid comes before g-new');
  // when every guide is posted nothing is left
  await post(root, lemmy, 'article', [], { now: nextDay(4) });
  const done = await post(root, lemmy, 'article', [], { now: nextDay(6) });
  assert.equal(done.code, 0);
  assert.ok(/no guides waiting/.test(done.out));
  assert.deepEqual(lemmy.S.posts.map((p) => p.fields.name), ['Guide g-old: a title', 'Guide g-mid: a title', 'Guide g-new: a title']);
  lemmy.close();
});

test('guide: a community that was missing gets it again for 3 days (not a new guide), later not; a guide already on the server is not posted twice', async () => {
  const lemmy = await startLemmy();
  const root = makeRoot({ guides: { 'g-old': 0, 'g-mid': 1 }, communities: ART_COMMUNITIES });
  assert.equal((await post(root, lemmy, 'article')).code, 0);
  // a second community that takes guides is switched on the next day: it gets g-old (a retry), the 2-day rule keeps g-mid waiting
  setConfig(root, (a) => a.communities.push({ community: 'pc@lemmy.example', kinds: ['article'], enabled: true }));
  const retry = await post(root, lemmy, 'article', [], { now: nextDay(1) });
  assert.equal(retry.code, 0, retry.all);
  assert.deepEqual(lemmy.S.posts.map((p) => [p.community, p.name]), [['steam@lemmy.example', 'Guide g-old: a title'], ['pc@lemmy.example', 'Guide g-old: a title']]);
  assert.ok(/sent again to the communities that did not get it/.test(retry.summary), retry.summary);
  // a third community 4 days later: too late for a retry of g-old, so the next real guide goes to every community
  setConfig(root, (a) => a.communities.push({ community: 'gamedeals@lemmy.example', kinds: ['article'], enabled: true }));
  const late = await post(root, lemmy, 'article', [], { now: nextDay(4) });
  assert.equal(late.code, 0, late.all);
  assert.deepEqual(lemmy.S.posts.slice(2).map((p) => [p.community, p.name]), [['steam@lemmy.example', 'Guide g-mid: a title'], ['pc@lemmy.example', 'Guide g-mid: a title'], ['gamedeals@lemmy.example', 'Guide g-mid: a title']]);
  // a lost record: the guide is already on the server (any age), it is recorded and not posted again
  const lemmy2 = await startLemmy({ seeded: [{ communityId: 12, id: 55, name: 'g-old', url: `${SITE}/guides/g-old/?utm_source=lemmy-prices`, creator: 'saveandplay', hoursAgo: 24 * 20 }] });
  const lost = makeRoot({ guides: { 'g-old': 0 } });
  const r = await post(lost, lemmy2, 'article');
  assert.equal(r.code, 0, r.all);
  assert.equal(lemmy2.S.posts.length, 0);
  assert.equal(readState(lost).articles.lemmy['g-old'].communities['steam@lemmy.example'].foundOnServer, true);
  lemmy.close();
  lemmy2.close();
});

test('--kind is required and a wrong account name is a clear error', async () => {
  const lemmy = await startLemmy();
  const root = makeRoot();
  const none = await run('post-lemmy.mjs', [], { root, server: lemmy });
  assert.equal(none.code, 1);
  assert.match(none.all, /Add --kind deal or --kind article/);
  const wrong = await post(root, lemmy, 'deal', ['--account', 'nope']);
  assert.notEqual(wrong.code, 0);
  assert.match(wrong.all, /No Lemmy account "nope"/);
  assert.equal(lemmy.S.calls.length, 0);
  // the two files must agree on the account name
  setConfig(root, () => {});
  const f = join(root, 'data/lemmy-accounts.json');
  const cfg = JSON.parse(readFileSync(f, 'utf8'));
  cfg.accounts.lemmy2 = cfg.accounts.lemmy;
  writeFileSync(f, JSON.stringify(cfg));
  const mismatch = await post(root, lemmy, 'deal', ['--dry-run']);
  assert.notEqual(mismatch.code, 0);
  assert.match(mismatch.all, /"lemmy2" is in data\/lemmy-accounts.json but not in data\/accounts.json/);
  lemmy.close();
});

test('check: finds the server, logs in, looks at every community; a switched-on community that cannot take posts is a problem', async () => {
  const lemmy = await startLemmy();
  const root = makeRoot();
  const r = await run('lemmy-check.mjs', [], { root, server: lemmy });
  assert.equal(r.code, 0, r.all);
  assert.ok(r.out.includes('Lemmy 0.19.20, the program speaks API v3') && r.out.includes('Login works as @saveandplay@lemmy.example'));
  assert.ok(/ok\s+gamedeals@lemmy.example \[deal\]: found, id 11, 1234 subscribers/.test(r.out) && /deals@remote.example/.test(r.out) && /off@lemmy.example \[deal\] \(switched off\)/.test(r.out));
  assert.equal(lemmy.S.posts.length, 0, 'check never posts');
  assert.ok(r.summary.includes('All good.'));
  setConfig(root, (a) => a.communities.push({ community: 'only@lemmy.example', kinds: ['article'] }, { community: 'gone@lemmy.example', kinds: ['article'], enabled: false }, { community: 'nothere@lemmy.example', kinds: ['article'], enabled: false }));
  const bad = await run('lemmy-check.mjs', [], { root, server: lemmy });
  assert.equal(bad.code, 1, bad.all);
  assert.match(bad.out, /ONLY MODERATORS CAN POST here/);
  assert.match(bad.out, /PROBLEM: only@lemmy.example is switched on but cannot take posts/);
  assert.match(bad.out, /FAIL nothere@lemmy.example \[article\] \(switched off\)/);
  assert.match(bad.out, /REMOVED or DELETED/);
  // wrong password, no password
  const wrong = await run('lemmy-check.mjs', [], { root: makeRoot({ env: 'LEMMY_PASSWORD=nope\n' }), server: lemmy });
  assert.equal(wrong.code, 1);
  assert.match(wrong.all, /incorrect_login/);
  const none = await run('lemmy-check.mjs', [], { root: makeRoot({ env: null }), server: lemmy });
  assert.equal(none.code, 1);
  assert.match(none.all, /no password \(LEMMY_PASSWORD\)/);
  lemmy.close();
});

test('profile: display name, bio, BOT flag and pictures are saved and read back (v3 and v4); a server that drops the pictures is told so', async () => {
  for (const api of ['v3', 'v4']) {
    const lemmy = await startLemmy({ api });
    const r = await run('lemmy-check.mjs', ['--profile'], { root: makeRoot(), server: lemmy });
    assert.equal(r.code, 0, r.all);
    assert.equal(lemmy.S.profile.display_name, 'Honest prices');
    assert.equal(lemmy.S.profile.bot_account, true);
    assert.equal(lemmy.S.profile.bio, realLemmy.accounts.lemmy.profile.bio);
    assert.equal(lemmy.S.profile.avatar, 'https://saveandplay.com/avatar.png');
    assert.ok(r.out.includes('Profile saved') && /ok\s+bot_account \(the BOT badge\)/.test(r.out) && /ok\s+avatar/.test(r.out));
    assert.ok(lemmy.S.calls.some((c) => c.method === 'PUT' && c.path === (api === 'v4' ? '/api/v4/account/settings' : '/api/v3/user/save_user_settings') && c.auth === `Bearer ${JWT}`));
    lemmy.close();
  }
  const dropping = await startLemmy({ api: 'v4', dropAvatar: true });
  const d = await run('lemmy-check.mjs', ['--profile'], { root: makeRoot(), server: dropping });
  assert.equal(d.code, 0, d.all);
  assert.match(d.out, /NOT avatar: this server version did not take the picture by address, add it by hand/);
  dropping.close();
  // a profile that is too long is refused before any request
  const lemmy = await startLemmy();
  const root = makeRoot();
  setConfig(root, (a) => (a.profile.bio = 'x'.repeat(301)));
  const long = await run('lemmy-check.mjs', ['--profile'], { root, server: lemmy });
  assert.equal(long.code, 1);
  assert.match(long.all, /profile\.bio is 301 characters/);
  assert.ok(!lemmy.S.calls.some((c) => c.method === 'PUT'));
  lemmy.close();
});

test('secret: the password goes to gh through stdin only; without gh the steps are explained and the password is not shown', async () => {
  if (process.platform === 'win32') return console.log('   (skipped: uses a fake gh shell script)');
  const root = makeRoot();
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "gh version 0"; exit 0; fi\necho "$@" > "$GH_ARGS_FILE"\ncat > "$GH_STDIN_FILE"\n', { mode: 0o755 });
  const withGh = await run('lemmy-secret.mjs', [], { root, env: { PATH: `${bin}:${process.env.PATH}`, GH_ARGS_FILE: join(root, 'args.txt'), GH_STDIN_FILE: join(root, 'stdin.txt') } });
  assert.equal(withGh.code, 0, withGh.all);
  assert.equal(readFileSync(join(root, 'stdin.txt'), 'utf8').trim(), PASSWORD);
  assert.equal(readFileSync(join(root, 'args.txt'), 'utf8').trim(), 'secret set LEMMY_PASSWORD', 'the password is not in the arguments');
  const noGh = await run('lemmy-secret.mjs', [], { root, env: { PATH: '/nonexistent' } });
  assert.equal(noGh.code, 2);
  assert.ok(/Settings -> Secrets/.test(noGh.all));
  const noPw = await run('lemmy-secret.mjs', [], { root: makeRoot({ env: null }) });
  assert.equal(noPw.code, 1);
  assert.ok(/LEMMY_PASSWORD/.test(noPw.all));
});

test('the workflow: both schedules, the kind that follows from them, the record file of Lemmy, the secret, and every mode calls an existing script', () => {
  // until Claude Code moves it, the workflow lives in scripts/ (the chat cannot write to .github/)
  const path = [here('../.github/workflows/post-lemmy.yml'), here('./post-lemmy.workflow.yml')].find((p) => existsSync(p));
  assert.ok(path, 'the workflow file exists in .github/workflows/ or in scripts/');
  const yml = readFileSync(path, 'utf8');
  assert.ok(yml.includes("- cron: '0 12 * * *'") && yml.includes("- cron: '30 17 * * *'"));
  assert.ok(yml.includes("github.event.schedule == '30 17 * * *' && 'article'"), 'the later schedule is the guide, the other one the deal');
  assert.ok(yml.includes('STATE_FILE: posted-lemmy.json') && yml.includes('STATE_LABEL: Lemmy'));
  assert.ok(yml.includes('LEMMY_PASSWORD: ${{ secrets.LEMMY_PASSWORD }}'));
  assert.ok(yml.includes('bash scripts/nostr-branch.sh load') && yml.includes('bash scripts/nostr-branch.sh save'));
  for (const call of yml.match(/node scripts\/[\w.-]+/g)) assert.ok(existsSync(here(`../${call.slice(5)}`)), `${call} exists`);
  assert.ok(yml.includes('post) node scripts/post-lemmy.mjs --kind "$KIND"') && yml.includes('dry-run) node scripts/post-lemmy.mjs --kind "$KIND" --dry-run'));
  assert.ok(yml.includes('group: lemmy-post') && yml.includes('cancel-in-progress: false'), 'two runs never post at the same time');
});

test('no output of any script contains the password, the login token or the other .env values', () => {
  assert.ok(leaks.length > 25, `only ${leaks.length} outputs were collected`);
  for (const { script, all } of leaks) {
    assert.ok(!all.includes(PASSWORD), `${script} leaked the password`);
    assert.ok(!all.includes(JWT), `${script} leaked the login token`);
    assert.ok(!all.includes('secret-ftp-1'), `${script} leaked another .env value`);
  }
});

test('nostr-branch.sh with STATE_FILE=posted-lemmy.json: load gets the brief files and the Lemmy record, save puts the Lemmy record on the brief branch once; Nostr is untouched', () => {
  const git = spawnSync('git', ['--version']);
  if (git.status !== 0 || process.platform === 'win32') return console.log('   (skipped: needs git and bash)');
  const base = mkdtempSync(join(tmpdir(), 'lemmy-git-'));
  const sh = (cmd, cwd = base, env = {}) => {
    const r = spawnSync('bash', ['-ec', cmd], { cwd, encoding: 'utf8', env: { ...cleanEnv(), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', ...env } });
    assert.equal(r.status, 0, `${cmd}\n${r.stdout}\n${r.stderr}`);
    return r.stdout + r.stderr;
  };
  const LEMMY = { STATE_FILE: 'posted-lemmy.json', STATE_LABEL: 'Lemmy' };
  sh('git init -q --bare origin.git && git clone -q origin.git seed 2>/dev/null && cd seed && git checkout -q -b main && echo hi > README.md && git add . && git commit -qm init && git push -q origin main');
  sh(`cd seed && git checkout -q --orphan brief && git rm -rfq . && echo '{"candidates":[]}' > brief-lemmy.json && echo '{"accounts":{"nostr":{}}}' > posted-nostr.json && echo '{}' > brief-state.json && git add . && git commit -qm brief && git push -q origin brief`);
  sh('git clone -q origin.git run && cd run && git checkout -q main && mkdir -p scripts');
  copyFileSync(here('./nostr-branch.sh'), join(base, 'run/scripts/nostr-branch.sh'));
  const run1 = join(base, 'run');
  const out1 = sh('bash scripts/nostr-branch.sh load', run1, LEMMY);
  assert.ok(out1.includes('Loaded brief-lemmy.json') && existsSync(join(run1, 'drafts/brief-lemmy.json')));
  assert.ok(!existsSync(join(run1, 'drafts/posted-nostr.json')), 'the Nostr record is not loaded for Lemmy');
  sh(`echo '{"accounts":{"lemmy":{"${DAY}":{"deal":{"communities":{"a@b.example":{"status":"done"}}}}}}}' > drafts/posted-lemmy.json`, run1);
  const out2 = sh('bash scripts/nostr-branch.sh save', run1, LEMMY);
  assert.ok(out2.includes('Saved to the brief branch'), out2);
  const out3 = sh('bash scripts/nostr-branch.sh save', run1, LEMMY);
  assert.ok(out3.includes('The record of Lemmy posts did not change'), out3);
  assert.ok(sh('git --git-dir=../origin.git show brief:posted-lemmy.json', run1).includes('"done"'));
  assert.ok(sh('git --git-dir=../origin.git show brief:posted-nostr.json', run1).includes('"nostr"'), 'the Nostr record stays as it was');
  assert.ok(sh('git --git-dir=../origin.git log -1 --format=%s brief', run1).startsWith('Lemmy posts '));
  // without the variables the script still works for Nostr, as before
  const out4 = sh('bash scripts/nostr-branch.sh load', run1);
  assert.ok(out4.includes('Loaded posted-nostr.json') && !out4.includes('posted-lemmy.json'), out4);
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
