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
import { shortLink, shortenForPost, facetsOf, parseBriefPost, postProblems, publishAccounts, publishProblems, dayKey, graphemes } from './lib/bsky-posts.mjs';

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
      env: { ...process.env, COMMENTS_ROOT: root, POSTS_BRIEF_DIR: join(root, 'brief'), COMMENTS_RETRY_MS: '1', COMMENTS_GAP_SCALE: '0', GITHUB_STEP_SUMMARY: '', DRY_RUN: '', ...env },
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

test('settings: the four Bluesky accounts publish with the app password of their own account; the rules are checked', () => {
  const acc = Object.fromEntries(publishAccounts().map((a) => [a.id, a]));
  assert.deepEqual(Object.keys(acc).sort(), ['cozy', 'prices', 'prices-kinguin', 'retro']);
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
  assert.match(r.out, /## 2\. prices-kinguin[\s\S]*NO POST TODAY: No deal passes the rules today\./);
  assert.match(r.out, /## 3\. cozy[\s\S]*PROBLEMS \(cannot be approved\): the price in the post is not the current price/);
  r = await run(['approve', '--ok', 'all'], root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /APPROVED 1: 1 \(prices\)/);
  assert.match(r.out, /Not approved: 2\. prices-kinguin: .*NO POST TODAY|Not approved: .*3\. cozy/);
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
    assert.match(r2.out, /0 approved post\(s\) waiting/);
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

test('workflow: only by hand, the owner\'s "ок" starts it; secrets of the three accounts; saves the report even when the run fails', () => {
  const wf = readFileSync(new URL('../.github/workflows/post-bluesky.yml', import.meta.url), 'utf8');
  assert.match(wf, /workflow_dispatch:/);
  assert.ok(!/\n\s*schedule:/.test(wf), 'no schedule: nothing is posted without the owner');
  for (const s of ['BSKY_APP_PASSWORD', 'BSKY_APP_PASSWORD_COZY', 'BSKY_APP_PASSWORD_RETRO']) assert.ok(wf.includes(`secrets.${s}`), s);
  assert.match(wf, /node scripts\/post-bluesky\.mjs send/);
  assert.match(wf, /if: \$\{\{ always\(\) \}\}/);
  assert.match(wf, /concurrency:\s*\n\s*group: post-bluesky/);
});
