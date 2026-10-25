// Tests for posting the posts of the daily brief to Mastodon after the owner's "ок" (scripts/post-bluesky.mjs, scripts/lib/mastodon-posts.mjs).
// No internet and no real account: one small fake server plays Mastodon and our site.
//   npm run mastodonposts:test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { file } from './lib/comments.mjs';
import { dayKey, postProblems, parseBriefPost } from './lib/bsky-posts.mjs';
import { mastodonAccounts, mastodonSettingsProblems, countedLength, idempotencyKey } from './lib/mastodon-posts.mjs';

const TOKEN = 'test-token-not-real';
const DAY = dayKey();
const FROST = '/deals/gog/frostpunk/';
const HADES = '/deals/gog/hades/';
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString();
const link = (path, day = DAY) => `https://saveandplay.com${path}?utm_source=mastodon-prices&utm_medium=social&utm_campaign=deals-${day}`;
const post = (title, price, was, path, day = DAY, extra = '') => `${title}: -85% at GOG\n$${price} (was $${was})\nYou save $${(was - price).toFixed(2)}\nDRM-free\nPrice checked Oct 25. Sale ends Oct 30.${extra}\n\n${link(path, day)}\n\n#GameDeals #PCGaming #GOG\nAd\n`;

function tempRoot({ enabled = true, deals } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mastopost-'));
  for (const d of ['data', 'drafts', 'brief']) mkdirSync(join(root, d));
  const accounts = JSON.parse(readFileSync(file('data', 'accounts.json'), 'utf8'));
  for (const id of ['prices', 'prices-kinguin']) accounts.accounts[id].channels.mastodon.publish.enabled = enabled;
  writeFileSync(join(root, 'data', 'accounts.json'), JSON.stringify(accounts, null, 2));
  copyFileSync(file('data', 'post-schedule.json'), join(root, 'data', 'post-schedule.json'));
  writeFileSync(join(root, 'data', 'deals.json'), JSON.stringify(deals ?? [
    { store: 'GOG', title: 'Frostpunk', price: 4.49, was: 29.99, discountPct: 85, endsAt: inDays(5) },
    { store: 'GOG', title: 'Hades', price: 9.99, was: 24.99, discountPct: 60, endsAt: inDays(5) },
  ]));
  return root;
}
const put = (root, sub, name, data) => writeFileSync(join(root, sub, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
const read = (root, name) => JSON.parse(readFileSync(join(root, 'drafts', name), 'utf8'));
const files = (root, prefix) => readdirSync(join(root, 'drafts')).filter((f) => f.startsWith(prefix)).sort();

function run(args, root, env = {}) {
  const path = fileURLToPath(new URL('./post-bluesky.mjs', import.meta.url));
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path, ...args], {
      env: { ...process.env, COMMENTS_ROOT: root, POSTS_BRIEF_DIR: join(root, 'brief'), ARTICLE_DRAFTS_DIR: join(root, 'articles'), COMMENTS_RETRY_MS: '1', COMMENTS_GAP_SCALE: '0', GITHUB_STEP_SUMMARY: '', DRY_RUN: '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

// ---- a fake Mastodon and a fake site -------------------------------------------------------------------------------
function fakeWorld({ acct = 'saveandplay', statuses = [], pages = {}, failCreate = null } = {}) {
  const created = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (!url.pathname.startsWith('/api/')) {
        if (url.pathname === '/og.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(Buffer.from('89504e470d0a1a0a', 'hex')); }
        const page = pages[url.pathname];
        if (page === undefined) { res.writeHead(404); return res.end('no'); }
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(page);
      }
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: 'The access token is invalid' });
      if (url.pathname === '/api/v1/accounts/verify_credentials') return json(200, { id: '42', acct, url: `https://mastodon.social/@${acct}` });
      if (url.pathname === '/api/v1/accounts/42/statuses') return json(200, statuses);
      if (url.pathname === '/api/v1/statuses' && req.method === 'POST') {
        if (failCreate) return json(failCreate.status, { error: failCreate.error });
        const b = JSON.parse(body);
        created.push({ ...b, idem: req.headers['idempotency-key'] });
        return json(200, { id: String(created.length), url: `https://mastodon.social/@${acct}/${100 + created.length}` });
      }
      return json(404, { error: 'NotFound' });
    });
  });
  return { server, created, base: () => `http://127.0.0.1:${server.address().port}` };
}
async function withWorld(world, fn) {
  await new Promise((r) => world.server.listen(0, '127.0.0.1', r));
  try { return await fn(world.base()); } finally { world.server.close(); }
}
const PAGE = (t, d) => `<html><head><title>x</title><meta property="og:title" content="${t}"><meta property="og:description" content="${d}"><meta property="og:image" content="/og.png"></head><body></body></html>`;
const pages = () => ({ [FROST]: PAGE('Frostpunk at GOG | SaveAndPlay', 'Frostpunk deal'), [HADES]: PAGE('Hades at GOG | SaveAndPlay', 'Hades deal'), '/guides/foo-guide/': PAGE('Foo guide | SaveAndPlay', 'A guide') });
const env = (base, extra = {}) => ({ MASTODON_API_BASE: base, POSTS_SITE_BASE: base, MASTODON_ACCESS_TOKEN: TOKEN, REPO_PRIVATE: 'false', ...extra });

async function approvedRoot({ both = false } = {}) {
  const root = tempRoot();
  put(root, 'brief', 'post-prices-mastodon.md', post('Frostpunk', '4.49', '29.99', FROST));
  if (both) put(root, 'brief', 'post-prices-kinguin-mastodon.md', post('Hades', '9.99', '24.99', HADES));
  const r = await run(['approve', '--ok', 'all'], root);
  assert.equal(r.code, 0, r.out);
  return root;
}

// ---- settings and rules ----------------------------------------------------------------------------------------------
test('settings: Mastodon is switched off in the repository until the token is set; the blocks of the one account are checked', () => {
  const off = mastodonAccounts();
  assert.deepEqual(off.map((a) => a.id).sort(), ['prices', 'prices-kinguin']);
  for (const a of off) { assert.equal(a.settings.enabled, false, a.id); assert.equal(a.handle, 'saveandplay@mastodon.social'); assert.equal(a.settings.tokenEnv, 'MASTODON_ACCESS_TOKEN'); }
  const on = off.map((a) => ({ ...a, settings: { ...a.settings, enabled: true } }));
  for (const a of on) assert.deepEqual(mastodonSettingsProblems(a), [], a.id);
  assert.match(mastodonSettingsProblems({ ...on[0], settings: { ...on[0].settings, tokenEnv: null } }).join(), /tokenEnv is missing/);
  assert.match(mastodonSettingsProblems({ ...on[0], acct: '' }).join(), /acct is missing/);
});

test('rules: Mastodon counts a link as 23 characters and allows 500; the other rules are the same as on Bluesky', () => {
  assert.equal(countedLength(`a ${link(FROST)}`), 2 + 23);
  const acc = { ...mastodonAccounts('prices')[0], settings: { ...mastodonAccounts('prices')[0].settings, enabled: true } };
  const deals = [{ store: 'GOG', title: 'Frostpunk', price: 4.49, was: 29.99, endsAt: inDays(5) }];
  const check = (text) => postProblems(parseBriefPost(text), { acc, deals }).join(' | ');
  assert.equal(check(post('Frostpunk', '4.49', '29.99', FROST)), '', 'longer than 300 is fine, the 300 is only Bluesky');
  assert.equal(check(post('Frostpunk', '4.49', '29.99', FROST, DAY, ` ${'x'.repeat(200)}`)), '');
  assert.match(check(post('Frostpunk', '4.49', '29.99', FROST, DAY, ` ${'x'.repeat(420)}`)), /characters, Mastodon allows 500/);
  assert.match(check(post('Frostpunk', '3.99', '29.99', FROST)), /not the current price/);
  assert.match(check(post('Frostpunk', '4.49', '29.99', FROST).replace(/Ad\n$/, 'Sponsored\n')), /last line must be "Ad"/);
  assert.match(check(post('Frostpunk', '4.49', '29.99', FROST, '2026-01-01')), /too old/);
  assert.equal(idempotencyKey('a'), idempotencyKey('a'));
  assert.notEqual(idempotencyKey('a'), idempotencyKey('b'));
});

// ---- the chat: show and approve ----------------------------------------------------------------------------------------
test('show and approve: switched off = nothing about Mastodon; switched on = numbered after the Bluesky posts, approved together with them', async () => {
  let root = tempRoot({ enabled: false });
  put(root, 'brief', 'post-prices-mastodon.md', post('Frostpunk', '4.49', '29.99', FROST));
  let r = await run(['show'], root);
  assert.equal(r.code, 0, r.out);
  assert.ok(!/MASTODON/.test(r.out), 'off: not shown');

  root = tempRoot();
  put(root, 'brief', 'post-prices-mastodon.md', post('Frostpunk', '4.49', '29.99', FROST));
  put(root, 'brief', 'post-prices-kinguin-mastodon.md', 'NO POST TODAY: Off day: this account posts every 2 days.');
  r = await run(['show'], root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /## \d+\. MASTODON prices \(@saveandplay@mastodon\.social\)[\s\S]*Frostpunk: -85% at GOG[\s\S]*OK: can be approved/);
  assert.match(r.out, /## \d+\. MASTODON prices-kinguin[\s\S]*NO POST TODAY: Off day/);
  const n = Number(r.out.match(/## (\d+)\. MASTODON prices /)[1]);
  assert.ok(n > 5, 'after all Bluesky posts (main, second deal, Kinguin, Cozy, Retro, guide)');

  r = await run(['approve', '--ok', 'all'], root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`APPROVED 1: ${n} \\(Mastodon prices\\)`));
  assert.match(r.out, /now/);
  const [name] = files(root, 'posts-approved-');
  const item = read(root, name).items[0];
  assert.equal(item.platform, 'mastodon');
  assert.equal(item.handle, 'saveandplay@mastodon.social');
  assert.equal(item.key, `mastodon:prices|${DAY}|${FROST}`);
  assert.equal(item.text.trim(), post('Frostpunk', '4.49', '29.99', FROST).trim(), 'the exact text the owner saw');
});

test('hours: the Mastodon posts have their own queue, the deal first and the second one two hours later; the Bluesky hours stay as they were', async () => {
  const root = await approvedRoot({ both: true });
  const [name] = files(root, 'posts-approved-');
  const a = read(root, name);
  const h = Object.fromEntries(a.items.map((i) => [i.account, Math.round((Date.parse(i.notBefore) - Date.parse(a.approvedAt)) / 36e5)]));
  const sp = JSON.parse(readFileSync(new URL('../data/post-schedule.json', import.meta.url), 'utf8')).spacingHours;
  assert.deepEqual(h, { prices: 0, 'prices-kinguin': sp });
});

// ---- the sender -----------------------------------------------------------------------------------------------------------------
test('sender: posts exactly the approved text as a public English status with the token of the account; a second run posts nothing', async () => {
  const root = await approvedRoot();
  const world = fakeWorld({ pages: pages() });
  const summaryFile = join(root, 'summary.md');
  await withWorld(world, async (base) => {
    const r = await run(['send'], root, env(base, { GITHUB_STEP_SUMMARY: summaryFile }));
    assert.equal(r.code, 0, r.out);
    assert.ok(!r.out.includes(TOKEN), 'the token is never printed');
    assert.equal(world.created.length, 1, r.out);
    const c = world.created[0];
    assert.equal(c.status.trim(), post('Frostpunk', '4.49', '29.99', FROST).trim());
    assert.ok(c.status.includes(link(FROST)), 'the full link stays in the text: Mastodon makes the card itself');
    assert.equal(c.visibility, 'public');
    assert.equal(c.language, 'en');
    assert.match(c.idem, /^[0-9a-f]{32}$/);
    const sent = read(root, files(root, 'posts-sent-')[0]);
    assert.equal(sent.entries[0].status, 'sent');
    assert.equal(sent.entries[0].platform, 'mastodon');
    assert.match(sent.entries[0].postUrl, /^https:\/\/mastodon\.social\/@saveandplay\/101$/);
    assert.ok(!JSON.stringify(sent).includes(TOKEN));
    assert.match(readFileSync(summaryFile, 'utf8'), /@saveandplay@mastodon\.social[\s\S]*Опубликовано 1/);
    const r2 = await run(['send'], root, env(base));
    assert.equal(r2.code, 0, r2.out);
    assert.match(r2.out, /0 approved post\(s\) to look at now/);
    assert.equal(world.created.length, 1, 'nothing is posted twice');
  });
});

test('sender: a dry run logs in and checks, posts nothing, saves nothing', async () => {
  const root = await approvedRoot();
  const world = fakeWorld({ pages: pages() });
  await withWorld(world, async (base) => {
    const r = await run(['send', '--dry-run'], root, env(base));
    assert.equal(r.code, 0, r.out);
    assert.equal(world.created.length, 0);
    assert.match(r.out, /checked/);
    assert.deepEqual(files(root, 'posts-sent-'), []);
  });
});

test('sender: the same page already on the feed (posted by hand) is not posted again; a changed price, an old approval and "стоп" are skipped', async () => {
  const feed = [{ id: '9', created_at: new Date().toISOString(), url: 'https://mastodon.social/@saveandplay/9', content: `<p>x <a href="${link(FROST)}">link</a></p>` }];
  let world = fakeWorld({ pages: pages(), statuses: feed });
  await withWorld(world, async (base) => {
    const root = await approvedRoot();
    const r = await run(['send'], root, env(base));
    assert.equal(r.code, 0, r.out);
    assert.equal(world.created.length, 0);
    assert.match(r.out, /already posted/);
  });
  world = fakeWorld({ pages: pages() });
  await withWorld(world, async (base) => {
    let root = await approvedRoot();
    writeFileSync(join(root, 'data', 'deals.json'), JSON.stringify([{ store: 'GOG', title: 'Frostpunk', price: 5.49, was: 29.99, endsAt: inDays(5) }]));
    let r = await run(['send'], root, env(base));
    assert.match(r.out, /not the current price/);
    root = await approvedRoot();
    const [name] = files(root, 'posts-approved-');
    const a = read(root, name);
    a.approvedAt = new Date(Date.now() - 30 * 36e5).toISOString();
    put(root, 'drafts', name, a);
    r = await run(['send'], root, env(base));
    assert.match(r.out, /approval older than 20 h/);
    root = await approvedRoot();
    r = await run(['cancel'], root);
    assert.match(r.out, /CANCELLED 1/);
    r = await run(['send'], root, env(base));
    assert.match(r.out, /cancelled by the owner/);
    assert.equal(world.created.length, 0);
  });
});

test('sender: our page that does not open waits for the next run; Mastodon refusing, slowing down or a bad token are told plainly', async () => {
  let world = fakeWorld({ pages: {} });
  await withWorld(world, async (base) => {
    const root = await approvedRoot();
    const r = await run(['send'], root, env(base));
    assert.match(r.out, /failed \(our page: our page answers 404/);
    assert.equal(world.created.length, 0);
    assert.equal(read(root, files(root, 'posts-sent-')[0]).entries[0].status, 'failed', 'failed is not final: the next run tries again');
  });
  world = fakeWorld({ pages: pages(), failCreate: { status: 422, error: 'Validation failed' } });
  await withWorld(world, async (base) => {
    const root = await approvedRoot();
    const r = await run(['send'], root, env(base));
    assert.match(r.out, /skipped \(Mastodon refused it: Validation failed\)/);
  });
  world = fakeWorld({ pages: pages(), failCreate: { status: 429, error: 'Too many requests' } });
  await withWorld(world, async (base) => {
    const root = await approvedRoot();
    const r = await run(['send'], root, env(base));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /slow down \(429\)/);
  });
  world = fakeWorld({ pages: pages() });
  await withWorld(world, async (base) => {
    let root = await approvedRoot();
    let r = await run(['send'], root, env(base, { MASTODON_ACCESS_TOKEN: 'wrong-token' }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /login to mastodon\.social failed/);
    assert.ok(!r.out.includes('wrong-token'));
    r = await run(['send'], root, env(base, { MASTODON_ACCESS_TOKEN: '' }));
    assert.equal(r.code, 1);
    assert.match(r.out, /no secret MASTODON_ACCESS_TOKEN/);
    assert.equal(world.created.length, 0);
  });
  world = fakeWorld({ pages: pages(), acct: 'someoneelse' });
  await withWorld(world, async (base) => {
    const root = await approvedRoot();
    const r = await run(['send'], root, env(base));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /token belongs to @someoneelse, not @saveandplay/);
    assert.equal(world.created.length, 0);
  });
});

test('check-mastodon: says whose token it is, posts nothing', async () => {
  const world = fakeWorld({ pages: pages() });
  await withWorld(world, async (base) => {
    const root = tempRoot();
    let r = await run(['check-mastodon'], root, env(base));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /@saveandplay@mastodon\.social: OK: the token is of @saveandplay@mastodon\.social/);
    r = await run(['check-mastodon'], root, env(base, { MASTODON_ACCESS_TOKEN: 'bad' }));
    assert.equal(r.code, 1);
    assert.match(r.out, /LOGIN FAILED/);
    r = await run(['check-mastodon'], root, env(base, { MASTODON_ACCESS_TOKEN: '' }));
    assert.equal(r.code, 1);
    assert.match(r.out, /no secret MASTODON_ACCESS_TOKEN/);
    assert.equal(world.created.length, 0);
    r = await run(['check-mastodon'], tempRoot({ enabled: false }), env(base));
    assert.equal(r.code, 1);
    assert.match(r.out, /not switched on/);
  });
});

// ---- the guide post -----------------------------------------------------------------------------------------------------------
test('guide post: the "Mastodon" block of the guide goes to Mastodon, with its own text and no Ad line', async () => {
  const root = tempRoot();
  const guideLink = 'https://saveandplay.com/guides/foo-guide/?utm_source=mastodon-prices&utm_medium=social&utm_campaign=guide-foo';
  const text = `A short history says little about a price.\n${guideLink}\n#PCGaming #Steam\nDo you check a price chart before you buy?`;
  mkdirSync(join(root, 'articles', '2026-10-25-foo-guide'), { recursive: true });
  writeFileSync(join(root, 'articles', '2026-10-25-foo-guide', 'article.md'), '---\ntitle: "Foo guide"\nimage: /og/foo-guide.png\nimageAlt: "x"\n---\nBody\n');
  writeFileSync(join(root, 'articles', '2026-10-25-foo-guide', 'posts.md'), `## Bluesky\n\n\`\`\`text\nB ${guideLink.replace('mastodon-prices', 'bluesky-prices')}\n\`\`\`\n\n## Mastodon\n\n\`\`\`text\n${text}\n\`\`\`\n`);
  let r = await run(['show'], root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /MASTODON GUIDE POST: Foo guide[\s\S]*A short history says little[\s\S]*OK: can be approved/);
  const n = Number(r.out.match(/## (\d+)\. MASTODON GUIDE POST/)[1]);
  r = await run(['approve', '--ok', String(n)], root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`APPROVED 1: ${n} \\(Mastodon guide\\)`));
  const world = fakeWorld({ pages: pages() });
  await withWorld(world, async (base) => {
    r = await run(['send'], root, env(base));
    assert.equal(r.code, 0, r.out);
    assert.equal(world.created.length, 1, r.out);
    assert.equal(world.created[0].status, text);
    assert.equal(read(root, files(root, 'posts-approved-')[0]).items[0].key, 'mastodon:prices|article|/guides/foo-guide/');
  });
});

test('workflow: the Mastodon token is passed to the sender as a secret, only to that step', () => {
  const wf = readFileSync(new URL('../.github/workflows/post-bluesky.yml', import.meta.url), 'utf8');
  assert.ok(wf.includes('secrets.MASTODON_ACCESS_TOKEN'));
  assert.match(wf, /check_mastodon/);
  assert.match(wf, /node scripts\/post-bluesky\.mjs check-mastodon/);
  assert.equal(wf.split('secrets.MASTODON_ACCESS_TOKEN').length - 1, 2, 'the sender step and the check step, nowhere else');
});
