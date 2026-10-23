// Tests for posting the posts of the daily brief to Bluesky after the owner's "ок" (scripts/post-bluesky.mjs, scripts/lib/bsky-posts.mjs).
// No internet and no real account: small fake servers (Bluesky and our site) run on this computer.
//   npm run bskyposts:test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { file } from './lib/comments.mjs';
import { shortLink, shortenForPost, facetsOf, parseBriefPost, postProblems, publishAccounts, publishProblems, dayKey, graphemes, scheduleItems, isDue, parseArticlePost, articleProblems } from './lib/bsky-posts.mjs';

const PW = 'test-password-not-real';
const DAY = dayKey();
const IDS = { 'saveandplay.com': 'did:plc:main', 'cozygame.bsky.social': 'did:plc:cozy', 'retrogamedeals.bsky.social': 'did:plc:retro' };
const link = (path, day = DAY, src = 'bluesky-prices') => `https://saveandplay.com${path}?utm_source=${src}&utm_medium=social&utm_campaign=deals-${day}`;
const brief = (title, store, price, was, path, tags = '#PCGaming #GameDeals', day = DAY) => `${title}: -85% at ${store}\n$${price} (was $${was})\nPrice checked Oct 20. Sale ends Oct 30.\n\n${link(path, day)}\n\n${tags}\nAd\n`;
const FROST = '/deals/gog/frostpunk/';
const HADES = '/deals/gog/hades/';
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString();

// ---- a folder like the chat and the workflow have ---------------------------------------------------------------------------
function tempRoot({ deals } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bskypost-'));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'drafts'));
  mkdirSync(join(root, 'brief'));
  copyFileSync(file('data', 'accounts.json'), join(root, 'data', 'accounts.json'));
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

// ---- fake Bluesky and a fake site ------------------------------------------------------------------------------------------------
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
function fakeWorld({ feed = {}, pages = {}, failCreate = null } = {}) {
  const created = [];
  const blobs = [];
  const fetched = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (!url.pathname.startsWith('/xrpc/')) {
        fetched.push(url.pathname);
        if (url.pathname === '/og.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
        const page = pages[url.pathname];
        if (page === undefined) { res.writeHead(404); return res.end('no'); }
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(page);
      }
      if (url.pathname.endsWith('createSession')) {
        const b = JSON.parse(body.toString() || '{}');
        const did = IDS[b.identifier];
        if (!did || b.password !== PW) return json(401, { error: 'AuthenticationRequired', message: 'Invalid identifier or password' });
        return json(200, { accessJwt: `jwt-${did}`, did, handle: b.identifier, didDoc: { service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example' }] } });
      }
      const did = (req.headers.authorization ?? '').replace('Bearer jwt-', '');
      if (!Object.values(IDS).includes(did)) return json(401, { error: 'AuthenticationRequired', message: 'login needed' });
      if (url.pathname.endsWith('getAuthorFeed')) return json(200, { feed: feed[url.searchParams.get('actor')] ?? [] });
      if (url.pathname.endsWith('uploadBlob')) { blobs.push({ mime: req.headers['content-type'], size: body.length }); return json(200, { blob: { $type: 'blob', ref: { $link: 'bafyblob' }, mimeType: req.headers['content-type'], size: body.length } }); }
      if (url.pathname.endsWith('createRecord')) {
        const b = JSON.parse(body.toString());
        if (failCreate) return json(failCreate.status, { error: failCreate.error, message: failCreate.message });
        created.push({ ...b, did });
        return json(200, { uri: `at://${did}/app.bsky.feed.post/post${created.length}`, cid: `c${created.length}` });
      }
      return json(404, { error: 'NotFound' });
    });
  });
  return { server, created, blobs, fetched, base: () => `http://127.0.0.1:${server.address().port}` };
}
async function withWorld(world, fn) {
  await new Promise((r) => world.server.listen(0, '127.0.0.1', r));
  try { return await fn(world.base()); } finally { world.server.close(); }
}
const PAGE = (t, d) => `<html><head><title>x</title><meta property="og:title" content="${t}"><meta property="og:description" content="${d}"><meta property="og:image" content="/og.png"></head><body></body></html>`;
const pages = () => ({ [FROST]: PAGE('Frostpunk at GOG | SaveAndPlay', 'Price checked today &amp; more'), [HADES]: PAGE('Hades at GOG | SaveAndPlay', 'Hades deal') });
const env = (base, extra = {}) => ({ BSKY_API_BASE: base, POSTS_SITE_BASE: base, BSKY_APP_PASSWORD: PW, BSKY_APP_PASSWORD_COZY: PW, BSKY_APP_PASSWORD_RETRO: PW, REPO_PRIVATE: 'false', ...extra });

// ---- pure helpers --------------------------------------------------------------------------------------------------------------------
test('link: shown like the app does, 25 characters; the full address goes into a facet; tags are facets; positions are bytes of UTF-8', () => {
  const l = link(FROST);
  assert.equal(shortLink(l), 'saveandplay.com/deals/...');
  assert.equal(shortLink(l).length, 25);
  assert.equal(shortLink('https://saveandplay.com/'), 'saveandplay.com');
  const text = brief('Frostpunk', 'GOG', '4.49', '29.99', FROST, '#PCGaming #Éclair');
  const finalText = shortenForPost(text, l);
  assert.ok(!finalText.includes('utm_source'), 'the long address is not in the text');
  const facets = facetsOf(finalText, l);
  const bytes = Buffer.from(finalText, 'utf8');
  const slice = (f) => bytes.subarray(f.index.byteStart, f.index.byteEnd).toString('utf8');
  const link0 = facets.find((f) => f.features[0].$type.endsWith('#link'));
  assert.equal(slice(link0), 'saveandplay.com/deals/...');
  assert.equal(link0.features[0].uri, l, 'the facet carries the full address');
  const tags = facets.filter((f) => f.features[0].$type.endsWith('#tag'));
  assert.deepEqual(tags.map((f) => [slice(f), f.features[0].tag]), [['#PCGaming', 'PCGaming'], ['#Éclair', 'Éclair']]);
  assert.equal(graphemes('👨‍👩‍👧 ok'), 4);
});

test('brief file: NO POST TODAY is told, a post gives its link, day and path', () => {
  assert.equal(parseBriefPost('NO POST TODAY: No deal passes the rules today.').noPost, 'No deal passes the rules today.');
  const p = parseBriefPost(brief('Frostpunk', 'GOG', '4.49', '29.99', FROST));
  assert.equal(p.day, DAY);
  assert.equal(p.path, FROST);
  assert.equal(p.links, 1);
});

test('settings: the five Bluesky posts (main, second deal, Kinguin, Cozy, Retro) publish with the app password of their own account; the rules are checked', () => {
  const acc = Object.fromEntries(publishAccounts().map((a) => [a.id, a]));
  assert.deepEqual(Object.keys(acc).sort(), ['cozy', 'prices', 'prices-2', 'prices-kinguin', 'retro']);
  assert.equal(acc['prices-2'].settings.passwordEnv, 'BSKY_APP_PASSWORD');
  assert.equal(acc['prices-2'].handle, acc.prices.handle, 'the second deal is posted by the main account');
  assert.equal(acc.prices.settings.passwordEnv, 'BSKY_APP_PASSWORD');
  assert.equal(acc['prices-kinguin'].settings.passwordEnv, 'BSKY_APP_PASSWORD');
  assert.equal(acc.cozy.settings.passwordEnv, 'BSKY_APP_PASSWORD_COZY');
  assert.equal(acc.retro.settings.passwordEnv, 'BSKY_APP_PASSWORD_RETRO');
  for (const a of Object.values(acc)) assert.deepEqual(publishProblems(a), [], a.id);
  assert.match(publishProblems({ ...acc.cozy, settings: { ...acc.cozy.settings, passwordEnv: null } }).join(), /passwordEnv is missing/);
});

test('post rules: each problem is named', () => {
  const acc = publishAccounts('prices')[0];
  const deals = [{ store: 'GOG', title: 'Frostpunk', price: 4.49, was: 29.99, endsAt: inDays(5) }];
  const check = (text, d = deals) => postProblems(parseBriefPost(text), { acc, deals: d }).join(' | ');
  assert.equal(check(brief('Frostpunk', 'GOG', '4.49', '29.99', FROST)), '');
  assert.match(check(brief('Frostpunk', 'GOG', '4.49', '29.99', FROST).replace(/Ad\n$/, 'Sponsored\n')), /last line must be "Ad"/);
  assert.match(check(brief('Frostpunk', 'GOG', '4.49', '29.99', FROST) + '\n#ad'), /last line|#ad/);
  assert.match(check(brief('Frostpunk', 'GOG', '3.99', '29.99', FROST)), /not the current price of the deal \(\$4\.49\)/);
  assert.match(check(brief('Frostpunk', 'GOG', '4.49', '29.99', FROST), []), /not listed any more/);
  assert.match(check(brief('Frostpunk', 'GOG', '4.49', '29.99', FROST), [{ ...deals[0], endsAt: new Date(Date.now() + 10 * 60000).toISOString() }]), /sale is over/);
  assert.match(check(brief('Frostpunk', 'GOG', '4.49', '29.99', FROST, '#PCGaming', '2026-01-01')), /too old/);
  assert.match(check(brief('Frostpunk', 'GOG', '4.49', '29.99', FROST).replace('Price checked', 'The lowest ever. Price checked')), /lowest ever/);
  assert.match(check(brief('Frostpunk', 'GOG', '4.49', '29.99', FROST) + `\n${link(HADES)}`), /exactly one link/);
  assert.match(check(brief('Frostpunk', 'GOG', '4.49', '29.99', FROST).replace('Price checked Oct 20.', 'x'.repeat(320))), /characters, Bluesky allows 300/);
});

// ---- the chat: show and approve ----------------------------------------------------------------------------------------------------------
test('show and approve: the posts are numbered, a post with a problem cannot be approved, the approval file holds the exact text', async () => {
  const root = tempRoot();
  put(root, 'brief', 'post-prices-bluesky.md', brief('Frostpunk', 'GOG', '4.49', '29.99', FROST));
  put(root, 'brief', 'post-prices-kinguin-bluesky.md', 'NO POST TODAY: No deal passes the rules today.');
  put(root, 'brief', 'post-cozy-bluesky.md', brief('Hades', 'GOG', '8.88', '24.99', HADES, '#GameDeals #PCGaming'));
  let r = await run(['show'], root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /## 1\. prices \(@saveandplay\.com\)[\s\S]*Frostpunk: -85% at GOG[\s\S]*OK: can be approved/);
  assert.match(r.out, /## 2\. prices-2[\s\S]*NO POST TODAY: no post file of the brief/);
  assert.match(r.out, /## 3\. prices-kinguin[\s\S]*NO POST TODAY: No deal passes the rules today\./);
  assert.match(r.out, /## 4\. cozy[\s\S]*PROBLEMS \(cannot be approved\): the price in the post is not the current price/);
  r = await run(['approve', '--ok', 'all'], root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /APPROVED 1: 1 \(prices\)/);
  assert.match(r.out, /Not approved: .*3\. prices-kinguin: No deal passes/);
  assert.match(r.out, /Not approved: .*4\. cozy/);
  assert.match(r.out, /6\. guide post: no guide is waiting/);
  assert.match(r.out, /bash scripts\/comments-branch\.sh save drafts\/posts-approved-\d{8}-\d{6}\.json && gh workflow run "Post to Bluesky"/);
  const [name] = files(root, 'posts-approved-');
  const a = read(root, name);
  assert.equal(a.items.length, 1);
  assert.equal(a.items[0].text.trim(), brief('Frostpunk', 'GOG', '4.49', '29.99', FROST).trim());
  assert.equal(a.items[0].key, `prices|${DAY}|${FROST}`);
  // a number the owner skips is not approved
  const r2 = await run(['approve', '--ok', 'all', '--skip', '1'], root);
  assert.equal(r2.code, 1);
  assert.match(r2.out, /NOTHING APPROVED/);
});

// ---- the sender ------------------------------------------------------------------------------------------------------------------------------
async function approvedRoot({ cozy = false, deals } = {}) {
  const root = tempRoot({ deals });
  put(root, 'brief', 'post-prices-bluesky.md', brief('Frostpunk', 'GOG', '4.49', '29.99', FROST));
  if (cozy) put(root, 'brief', 'post-cozy-bluesky.md', brief('Hades', 'GOG', '9.99', '24.99', HADES, '#GameDeals #PCGaming', DAY));
  const r = await run(['approve', '--ok', 'all'], root);
  assert.equal(r.code, 0, r.out);
  return root;
}

test('sender: posts exactly the approved text like the app, with facets and a link card with the picture; a second run posts nothing', async () => {
  const root = await approvedRoot({ cozy: true });
  const world = fakeWorld({ pages: pages() });
  const summaryFile = join(root, 'summary.md');
  await withWorld(world, async (base) => {
    const r = await run(['send'], root, env(base, { GITHUB_STEP_SUMMARY: summaryFile }));
    assert.equal(r.code, 0, r.out);
    assert.ok(!r.out.includes(PW), 'the password is never printed');
    assert.equal(world.created.length, 2, r.out);
    const main = world.created.find((c) => c.did === IDS['saveandplay.com']);
    const cozy = world.created.find((c) => c.did === IDS['cozygame.bsky.social']);
    assert.ok(main && cozy, 'each account posts as itself');
    assert.equal(main.collection, 'app.bsky.feed.post');
    assert.equal(main.record.text, shortenForPost(brief('Frostpunk', 'GOG', '4.49', '29.99', FROST).trim(), link(FROST)), 'the text is the approved one, the link shown short');
    assert.ok(main.record.text.endsWith('\nAd'), 'the disclosure is the last line');
    assert.deepEqual(main.record.langs, ['en']);
    assert.ok(!main.record.reply, 'a post, not a reply');
    const f = main.record.facets;
    assert.equal(f.filter((x) => x.features[0].$type.endsWith('#link')).length, 1);
    assert.equal(f.find((x) => x.features[0].$type.endsWith('#link')).features[0].uri, link(FROST));
    assert.equal(f.filter((x) => x.features[0].$type.endsWith('#tag')).length, 2);
    const card = main.record.embed.external;
    assert.equal(main.record.embed.$type, 'app.bsky.embed.external');
    assert.equal(card.uri, link(FROST));
    assert.equal(card.title, 'Frostpunk at GOG | SaveAndPlay');
    assert.equal(card.description, 'Price checked today & more');
    assert.ok(card.thumb?.ref, 'the picture of our page is in the card');
    assert.equal(world.blobs.length, 2);
    const sent = read(root, files(root, 'posts-sent-')[0]);
    assert.equal(sent.entries.filter((e) => e.status === 'sent').length, 2);
    assert.match(sent.entries.find((e) => e.account === 'prices').postUrl, /^https:\/\/bsky\.app\/profile\/saveandplay\.com\/post\/post\d$/);
    assert.match(readFileSync(summaryFile, 'utf8'), /Опубликовано 1/);
    assert.match(readFileSync(join(root, 'drafts', '.comments-new-files'), 'utf8'), /posts-sent-/);
    // the second run: everything is done already
    const r2 = await run(['send'], root, env(base));
    assert.equal(r2.code, 0, r2.out);
    assert.match(r2.out, /0 approved post\(s\) to look at now/);
    assert.equal(world.created.length, 2, 'nothing is posted twice');
  });
});

test('sender: a dry run checks everything and posts nothing, saves nothing', async () => {
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

test('sender: what must not go is skipped with a reason (price changed, sale over, old approval, "стоп"); our page that does not open waits for the next run', async () => {
  const world = fakeWorld({ pages: pages() });
  await withWorld(world, async (base) => {
    // the price changed after the owner saw the post
    let root = await approvedRoot();
    writeFileSync(join(root, 'data', 'deals.json'), JSON.stringify([{ store: 'GOG', title: 'Frostpunk', price: 5.49, was: 29.99, endsAt: inDays(5) }]));
    let r = await run(['send'], root, env(base));
    assert.equal(r.code, 0, r.out);
    assert.equal(world.created.length, 0);
    assert.match(readFileSync(join(root, 'drafts', files(root, 'posts-sent-')[0]), 'utf8'), /not the current price/);
    // the approval is too old
    root = await approvedRoot();
    const [name] = files(root, 'posts-approved-');
    const a = read(root, name);
    a.approvedAt = new Date(Date.now() - 30 * 36e5).toISOString();
    put(root, 'drafts', name, a);
    r = await run(['send'], root, env(base));
    assert.match(r.out, /approval older than 20 h/);
    assert.equal(world.created.length, 0);
    // the owner said "стоп"
    root = await approvedRoot();
    r = await run(['cancel'], root);
    assert.match(r.out, /CANCELLED 1/);
    r = await run(['send'], root, env(base));
    assert.match(r.out, /cancelled by the owner/);
    assert.equal(world.created.length, 0);
  });
  // our page does not open: not posted, and the next run (when the page is there) posts it
  const root = await approvedRoot();
  const closed = fakeWorld({ pages: {} });
  await withWorld(closed, async (base) => {
    const r = await run(['send'], root, env(base));
    assert.equal(r.code, 0, r.out);
    assert.equal(closed.created.length, 0);
    assert.match(r.out, /our page answers 404/);
    assert.equal(read(root, files(root, 'posts-sent-')[0]).entries[0].status, 'failed');
  });
  const open = fakeWorld({ pages: pages() });
  await withWorld(open, async (base) => {
    const r = await run(['send'], root, env(base));
    assert.equal(open.created.length, 1, r.out);
  });
});

test('sender: a post that is on the feed of the account already (made by hand) is not posted again', async () => {
  const root = await approvedRoot();
  const feed = { [IDS['saveandplay.com']]: [{ post: { uri: `at://${IDS['saveandplay.com']}/app.bsky.feed.post/hand`, author: { did: IDS['saveandplay.com'] }, record: { text: 'by hand', createdAt: new Date(Date.now() - 3 * 36e5).toISOString(), facets: [{ features: [{ $type: 'app.bsky.richtext.facet#link', uri: link(FROST, DAY, 'bluesky-prices') }] }] } } }] };
  const world = fakeWorld({ pages: pages(), feed });
  await withWorld(world, async (base) => {
    const r = await run(['send'], root, env(base));
    assert.equal(r.code, 0, r.out);
    assert.equal(world.created.length, 0);
    assert.match(r.out, /already posted/);
  });
});

test('sender: a missing or wrong password sends nothing and says why; a refusal of Bluesky is not tried twice', async () => {
  const root = await approvedRoot();
  const world = fakeWorld({ pages: pages() });
  await withWorld(world, async (base) => {
    let r = await run(['send'], root, env(base, { BSKY_APP_PASSWORD: '' }));
    assert.equal(r.code, 1);
    assert.match(r.out, /no secret BSKY_APP_PASSWORD/);
    r = await run(['send'], root, env(base, { BSKY_APP_PASSWORD: 'wrong' }));
    assert.equal(r.code, 1);
    assert.match(r.out, /login as @saveandplay\.com failed/);
    assert.ok(!r.out.includes('wrong') || !/password: wrong/.test(r.out), 'the password is hidden');
    assert.equal(world.created.length, 0);
  });
  const refusing = fakeWorld({ pages: pages(), failCreate: { status: 400, error: 'InvalidRequest', message: 'Record/text must not be longer than 300 graphemes' } });
  await withWorld(refusing, async (base) => {
    const r = await run(['send'], root, env(base));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Bluesky refused it/);
    assert.equal(read(root, files(root, 'posts-sent-')[0]).entries[0].status, 'skipped');
  });
});

// ---- the hours of the day and the post about a guide -------------------------------------------------------------------------
const GUIDE = '/guides/foo-guide/';
const guideLink = `https://saveandplay.com${GUIDE}?utm_source=bluesky-prices&utm_medium=social&utm_campaign=guide-foo`;
const guideText = `Why a cheap key can cost more than a sale.\n\n${guideLink}\n\n#PCGaming #Steam`;
function addGuide(root, text = guideText) {
  mkdirSync(join(root, 'articles', '2026-10-21-foo-guide'), { recursive: true });
  writeFileSync(join(root, 'articles', '2026-10-21-foo-guide', 'article.md'), '---\ntitle: "Foo guide"\nimage: /og/foo-guide.png\nimageAlt: "x"\n---\nBody\n');
  writeFileSync(join(root, 'articles', '2026-10-21-foo-guide', 'posts.md'), `## Bluesky\n\n\`\`\`text\n${text}\n\`\`\`\n\n## Mastodon\n\n\`\`\`text\nM\n\`\`\`\n`);
}
const pagesWithGuide = () => ({ ...pages(), [GUIDE]: PAGE('Foo guide | SaveAndPlay', 'A guide') });
function setHour(root, fn) { // moves the hour of approved posts (the tests cannot wait three hours)
  for (const name of files(root, 'posts-approved-')) {
    const a = read(root, name);
    a.items = a.items.map((it) => ({ ...it, notBefore: fn(it) ?? it.notBefore }));
    put(root, 'drafts', name, a);
  }
}

test('hours: the posts of one account go 3 hours apart in the order of data/post-schedule.json; other accounts do not wait for it; --now is all at once', () => {
  const now = Date.parse('2026-10-21T14:00:00Z');
  const sch = { spacingHours: 3, order: ['prices', 'prices-2', 'article', 'prices-kinguin'] };
  const items = [
    { n: 1, account: 'prices', kind: 'deal', handle: 'saveandplay.com' },
    { n: 2, account: 'prices-2', kind: 'deal', handle: '@saveandplay.com' },
    { n: 3, account: 'prices-kinguin', kind: 'deal', handle: 'saveandplay.com' },
    { n: 4, account: 'cozy', kind: 'deal', handle: 'cozygame.bsky.social' },
    { n: 5, account: 'prices', kind: 'article', handle: 'saveandplay.com' },
    { n: 6, account: 'unknown', kind: 'deal', handle: 'saveandplay.com' },
  ];
  const hours = (list) => Object.fromEntries(list.map((i) => [i.n, (Date.parse(i.notBefore) - now) / 36e5]));
  assert.deepEqual(hours(scheduleItems(items.map((i) => ({ ...i, handle: i.handle.replace(/^@/, '') })), { now, schedule: sch })), { 1: 0, 2: 3, 3: 9, 4: 0, 5: 6, 6: 12 }, 'deal, deal, guide, Kinguin, then the unknown one; Cozy has its own line');
  assert.ok(Object.values(hours(scheduleItems(items.map((i) => ({ ...i, handle: i.handle.replace(/^@/, '') })), { now, schedule: sch, immediate: true }))).every((h) => h === 0));
  assert.equal(isDue({ notBefore: '2026-10-21T14:00:00Z' }, now), true);
  assert.equal(isDue({ notBefore: '2026-10-21T14:00:01Z' }, now), false);
  assert.equal(isDue({}, now), true, 'an approval without an hour (made before the schedule existed) goes at once');
});

test('guide post: one link to a guide of ours with utm marks, no Ad line, English, within 300; each problem is named', () => {
  const acc = publishAccounts('prices')[0];
  const check = (t) => articleProblems(parseArticlePost(t), { acc }).join(' | ');
  assert.equal(check(guideText), '');
  assert.match(check(guideText + '\nAd'), /no "Ad" line/);
  assert.match(check(guideText.replace('/guides/foo-guide/', '/deals/gog/frostpunk/')), /exactly one link, to a guide of ours/);
  assert.match(check(guideText.replace('&utm_medium=social', '')), /utm_medium=social/);
  assert.match(check(guideText.replace(guideLink, `see ${guideLink}`)), /alone on its own line/);
  assert.match(check(guideText + ' #ad'), /#ad/);
  assert.match(check(guideText.replace('Why', 'Это lowest ever. Why').replace('Это ', '')), /lowest ever/);
  assert.match(check('Почему так: ' + guideText), /English only/);
  assert.match(check(guideText.replace('Why a cheap', 'x'.repeat(300))), /characters, Bluesky allows 300/);
  assert.equal(parseArticlePost(guideText).slug, 'foo-guide');
});

test('the morning: show lists the deals and the guide of the day, approve gives each its hour, the sender posts only what is due, and the dry run looks at all', async () => {
  const root = tempRoot();
  put(root, 'brief', 'post-prices-bluesky.md', brief('Frostpunk', 'GOG', '4.49', '29.99', FROST));
  put(root, 'brief', 'post-prices-2-bluesky.md', brief('Hades', 'GOG', '9.99', '24.99', HADES, '#PCGaming #GameDeals #Games'));
  addGuide(root);
  let r = await run(['show'], root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /## 1\. prices[\s\S]*Frostpunk[\s\S]*## 2\. prices-2[\s\S]*Hades[\s\S]*## 6\. GUIDE POST: Foo guide[\s\S]*not on the site yet[\s\S]*Why a cheap key/);
  r = await run(['approve', '--ok', 'all'], root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /APPROVED 3: 1 \(prices\), 2 \(prices-2\), 6 \(guide\)/);
  assert.match(r.out, /1\. prices \(@saveandplay\.com\): now[\s\S]*2\. prices-2 \(@saveandplay\.com\): from \d\d:\d\d[\s\S]*6\. guide post \(@saveandplay\.com\): from \d\d:\d\d/);
  const [name] = files(root, 'posts-approved-');
  const items = read(root, name).items;
  const h = Object.fromEntries(items.map((i) => [i.n, Math.round((Date.parse(i.notBefore) - Date.parse(read(root, name).approvedAt)) / 36e5)]));
  const sp = JSON.parse(readFileSync(new URL('../data/post-schedule.json', import.meta.url), 'utf8')).spacingHours; // the real setting: the test follows it
  assert.deepEqual(h, { 1: 0, 2: sp, 6: 2 * sp });
  assert.equal(items.find((i) => i.n === 6).kind, 'article');
  assert.equal(items.find((i) => i.n === 6).key, 'prices|article|/guides/foo-guide/');

  const world = fakeWorld({ pages: pagesWithGuide() });
  await withWorld(world, async (base) => {
    // a dry run looks at all three, posts nothing
    r = await run(['send', '--dry-run'], root, env(base));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /3 approved post\(s\) to look at now/);
    assert.equal(world.created.length, 0);
    // the first hour: only the first deal goes
    const summaryFile = join(root, 'summary.md');
    r = await run(['send'], root, env(base, { GITHUB_STEP_SUMMARY: summaryFile }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 approved post\(s\) to look at now, 2 wait for their hour/);
    assert.equal(world.created.length, 1);
    assert.match(world.created[0].record.text, /^Frostpunk/);
    assert.match(readFileSync(summaryFile, 'utf8'), /Ждут своего часа[\s\S]*prices-2[\s\S]*скидка[\s\S]*пост к статье/);
    // an hour later nothing new is due: nothing is posted, nothing is written
    r = await run(['send'], root, env(base));
    assert.match(r.out, /0 approved post\(s\) to look at now, 2 wait/);
    assert.equal(world.created.length, 1);
    // the second hour comes: the second deal goes, the guide still waits
    setHour(root, (it) => (it.n === 2 ? new Date(Date.now() - 60000).toISOString() : null));
    r = await run(['send'], root, env(base));
    assert.equal(world.created.length, 2, r.out);
    assert.match(world.created[1].record.text, /^Hades/);
    // the third hour: the guide, with its own card, without an Ad line
    setHour(root, (it) => (it.n === 6 ? new Date(Date.now() - 60000).toISOString() : null));
    r = await run(['send'], root, env(base));
    assert.equal(world.created.length, 3, r.out);
    const g = world.created[2];
    assert.equal(g.record.text, shortenForPost(guideText, guideLink));
    assert.ok(!/\nAd$/.test(g.record.text));
    assert.equal(g.record.embed.external.uri, guideLink);
    assert.equal(g.record.embed.external.title, 'Foo guide | SaveAndPlay');
    assert.ok(g.record.embed.external.thumb?.ref);
    assert.equal(g.record.facets.find((x) => x.features[0].$type.endsWith('#link')).features[0].uri, guideLink);
    assert.deepEqual(g.record.facets.filter((x) => x.features[0].$type.endsWith('#tag')).map((x) => x.features[0].tag), ['PCGaming', 'Steam']);
    r = await run(['send'], root, env(base));
    assert.equal(world.created.length, 3, 'nothing is posted twice');
  });
});

test('the morning: a guide that is not on the site yet waits for its page; "стоп" stops the hours that have not come; --now posts all at once', async () => {
  const root = tempRoot();
  put(root, 'brief', 'post-prices-bluesky.md', brief('Frostpunk', 'GOG', '4.49', '29.99', FROST));
  addGuide(root);
  let r = await run(['approve', '--ok', '1,6', '--now'], root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1\. prices \(@saveandplay\.com\): now[\s\S]*6\. guide post \(@saveandplay\.com\): now/);
  const closed = fakeWorld({ pages: pages() }); // the page of the guide does not open yet
  await withWorld(closed, async (base) => {
    r = await run(['send'], root, env(base, { BSKY_APP_PASSWORD_COZY: '' }));
    assert.equal(closed.created.length, 1, r.out);
    assert.match(r.out, /our page answers 404/);
    const e = read(root, files(root, 'posts-sent-')[0]).entries;
    assert.equal(e.find((x) => x.status === 'failed').key, 'prices|article|/guides/foo-guide/', 'the guide waits for the next hour');
  });
  const open = fakeWorld({ pages: pagesWithGuide() });
  await withWorld(open, async (base) => {
    r = await run(['send'], root, env(base));
    assert.equal(open.created.length, 1, r.out); // the guide goes once its page opens; the deal was posted before
    assert.equal(open.created[0].record.embed.external.uri, guideLink);
  });
  // "стоп" also stops the posts whose hour has not come
  const root2 = tempRoot();
  put(root2, 'brief', 'post-prices-bluesky.md', brief('Frostpunk', 'GOG', '4.49', '29.99', FROST));
  put(root2, 'brief', 'post-prices-2-bluesky.md', brief('Hades', 'GOG', '9.99', '24.99', HADES, '#PCGaming #GameDeals #Games'));
  assert.equal((await run(['approve', '--ok', 'all'], root2)).code, 0);
  r = await run(['cancel'], root2);
  assert.match(r.out, /CANCELLED 2/);
  const w = fakeWorld({ pages: pages() });
  await withWorld(w, async (base) => {
    r = await run(['send'], root2, env(base));
    assert.equal(w.created.length, 0, r.out);
    assert.equal(read(root2, files(root2, 'posts-sent-')[0]).entries.filter((x) => x.reason === 'cancelled by the owner').length, 2);
  });
});

test('workflow: started by the "ок" or by the hourly look at the approved hours; secrets of the three accounts; saves the report even when the run fails', () => {
  const wf = readFileSync(new URL('../.github/workflows/post-bluesky.yml', import.meta.url), 'utf8');
  assert.match(wf, /workflow_dispatch:/);
  // The hourly run posts only what the owner approved and whose hour has come; with nothing approved it does nothing.
  assert.match(wf, /schedule:\s*\n\s*- cron: '7 12-23 \* \* \*'/);
  assert.ok(!/\n\s*- cron: .*\n\s*- cron/.test(wf), 'one schedule only');
  for (const s of ['BSKY_APP_PASSWORD', 'BSKY_APP_PASSWORD_COZY', 'BSKY_APP_PASSWORD_RETRO']) assert.ok(wf.includes(`secrets.${s}`), s);
  assert.match(wf, /node scripts\/post-bluesky\.mjs send/);
  assert.match(wf, /if: \$\{\{ always\(\) \}\}/);
  assert.match(wf, /concurrency:\s*\n\s*group: post-bluesky/);
});
