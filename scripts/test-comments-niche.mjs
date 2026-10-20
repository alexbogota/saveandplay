// Tests for the comment search of the niche accounts Cozy and Retro (Bluesky) and for the one-phrase step "all accounts at once". No internet, no real account.
//   npm run comments:test
//
// Checked: the real settings of cozy and retro are valid and separate (own queries, own memory); they search under the login of the main account (loginAs)
// and read their own replies from their own public feed; Retro does not drop console posts, Cozy still does; people with "games" in the nickname are not
// taken for studios, creators and piles of hashtags are; football is not a video game; a feed accepts only questions; "comments-show --all" shows every
// enabled account in the order of the settings with its own limit and its own memory, writes one shown file per account, and handles a stale or missing
// list (all-or-nothing, or --partial); the workflow runs every enabled account and the copy in .github is the same file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commentAccounts, configProblems, evaluate, file } from './lib/comments.mjs';

const NOW = Date.now();
const ago = (h) => new Date(NOW - h * 36e5).toISOString();
let n = 0;
const post = (o = {}) => {
  const id = ++n;
  return {
    uri: `at://did:plc:n${id}/app.bsky.feed.post/3n${id}`,
    author: { handle: o.handle ?? `person${id}.bsky.social`, displayName: o.name ?? 'Some Person', labels: [] },
    record: { text: o.text ?? 'Can anyone recommend a cozy game like Stardew Valley for my Steam Deck?', createdAt: ago(o.age ?? 3), langs: ['en'], facets: o.facets },
    likeCount: o.likes ?? 1, replyCount: o.replies ?? 0, labels: [],
  };
};
const cfg = (id) => commentAccounts(id)[0].account;
const cozy = cfg('cozy');
const retro = cfg('retro');
const prices = cfg('prices');
const judge = (account, p, group) => evaluate(p, account, { now: NOW, group: group ?? Object.keys(account.groups)[0], query: 'q' });
const verdict = (account, text, extra = {}, group) => { const r = judge(account, post({ text, ...extra }), group); return r.keep ? 'kept' : r.reason; };

test('the real settings: cozy and retro are valid, enabled, separate from each other and from the main account', () => {
  for (const id of ['cozy', 'retro']) {
    const a = cfg(id);
    assert.deepEqual(configProblems(a), [], id);
    assert.equal(a.enabled, true);
    assert.equal(a.platform, 'bluesky');
    assert.equal(a.language, 'en');
    assert.equal(a.loginAs, 'saveandplay.com', `${id} searches under the login of the main account`);
    assert.equal(a.passwordEnv, 'BSKY_APP_PASSWORD', 'no new password');
    assert.ok(a.queriesPerRun < prices.queriesPerRun, `${id}: fewer queries than the main account while the niche is quiet`);
    assert.equal(a.showLimit, 8);
    assert.equal(a.minScore, prices.minScore, 'the threshold is the main one');
    assert.notDeepEqual(a.groups, prices.groups, 'its own query groups');
    assert.ok(Object.keys(a.groups).length >= 5);
  }
  assert.equal(cozy.handle, 'cozygame.bsky.social');
  assert.equal(retro.handle, 'retrogamedeals.bsky.social');
  assert.deepEqual(Object.keys(cozy.groups).filter((g) => Object.keys(retro.groups).includes(g)), [], 'cozy and retro share no group');
  assert.equal(prices.showLimit, 15);
  assert.equal(cfg('mastodon-prices').showLimit, 8);
  assert.equal(cfg('prices').loginAs, undefined);
});

test('the filters fit the niche: Retro keeps console talk, Cozy still drops console-only posts', () => {
  const nes = 'Which NES game did you play the most as a kid? Mine was Contra, we never got past the third level.';
  assert.equal(verdict(retro, nes, {}, 'childhood'), 'kept', 'Retro does not drop consoles');
  assert.equal(verdict(prices, nes, {}, 'waitForSale'), 'console only', 'the main account would');
  assert.deepEqual(retro.consoleWords, []);
  assert.equal(verdict(cozy, 'Is Animal Crossing worth it on Switch 2 for a cozy evening? Looking for ideas.', {}, 'askCozy'), 'console only');
  assert.equal(verdict(cozy, 'Looking for a cozy game like Stardew Valley on Steam Deck, any ideas?', {}, 'askCozy'), 'kept');
});

test('a normal person with "games" in the nickname is not a studio; creators, hashtag piles and sports are dropped', () => {
  const ask = 'Looking for a cozy game like Stardew Valley for the evening, any ideas?';
  assert.equal(verdict(cozy, ask, { handle: 'mellowgames.bsky.social', name: 'Mellow' }, 'askCozy'), 'kept', 'the word games in a nickname is allowed');
  assert.equal(verdict(prices, 'Should I buy this game on Steam or wait for a sale? Any tips?', { handle: 'mellowgames.bsky.social', name: 'Mellow' }, 'waitForSale'), 'bot, shop or studio', 'the main block is unchanged');
  assert.equal(verdict(cozy, ask, { handle: 'honeypiegaming.bsky.social', name: 'Honeypie Gaming | Cozy Gamer' }, 'askCozy'), 'bot, shop or studio', 'a creator account');
  assert.equal(verdict(cozy, `${ask} #cozygames #stardew #farming #games #pcgaming`, {}, 'askCozy'), 'too many hashtags');
  assert.equal(verdict(retro, 'Does anyone remember this classic Seahawks game from 1989? Those were the days.', {}, 'nostalgia'), 'not about games');
  assert.equal(verdict(retro, 'Anyone else who played old DOS games as a kid and still remembers the sound card setup menus?', {}, 'classicPC'), 'kept');
  assert.equal(verdict(retro, 'Selling my restored Game Boy for sale on ebay, old games included, retro bundle.', {}, 'nostalgia'), 'skip word');
});

test('a feed accepts only posts that ask something; a search group does not need a question', () => {
  const statement = 'Spent the whole evening in my cozy farm game, the sunset looks amazing today.';
  assert.equal(verdict(cozy, statement, {}, 'cozyFeed'), 'not a question');
  assert.equal(cozy.feeds[0].requireQuestion, true);
  assert.equal(retro.feeds[0].requireQuestion, true);
  const ask = 'Anyone know a cozy farming game with a nice soundtrack for Steam Deck?';
  assert.equal(verdict(cozy, ask, {}, 'cozyFeed'), 'kept');
  // other accounts have no such rule
  assert.equal(prices.maxHashtags, undefined);
  assert.equal(prices.feeds.some((f) => f.requireQuestion), false);
});

// ---- the whole program against a fake Bluesky server -------------------------------------------------------------
const PASSWORD = 'test-password-not-real';
function fakeServer() {
  const logins = [];
  const authorFeeds = [];
  const searched = [];
  const found = post({ handle: 'goodperson.bsky.social', text: 'Looking for a cozy game like Stardew Valley for the weekend, any ideas?' });
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (url.pathname.endsWith('createSession')) {
        const b = JSON.parse(body || '{}');
        logins.push(b.identifier);
        return b.password === PASSWORD ? send(200, { accessJwt: 'jwt-test' }) : send(401, { error: 'AuthenticationRequired', message: 'Invalid identifier or password' });
      }
      if (req.headers.authorization !== 'Bearer jwt-test') return send(401, { error: 'AuthenticationRequired', message: 'login needed' });
      if (url.pathname.endsWith('searchPosts')) { searched.push(url.searchParams.get('q')); return send(200, { posts: [found] }); }
      if (url.pathname.endsWith('resolveHandle')) return send(200, { did: 'did:plc:fakefeed' });
      if (url.pathname.endsWith('getFeed')) return send(200, { feed: [] });
      if (url.pathname.endsWith('getAuthorFeed')) { authorFeeds.push(url.searchParams.get('actor')); return send(200, { feed: [] }); }
      return send(404, { error: 'NotFound' });
    });
  });
  return { server, logins, authorFeeds, searched, found };
}
function run(script, env, args = []) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}
function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'niche-'));
  mkdirSync(join(root, 'data'));
  copyFileSync(file('data', 'comments-accounts.json'), join(root, 'data', 'comments-accounts.json'));
  return root;
}

test('end to end: cozy searches under the login of the main account, reads its OWN replies, and keeps its own files', async () => {
  const { server, logins, authorFeeds, searched, found } = fakeServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const root = tempRoot();
  const env = { COMMENTS_ROOT: root, BSKY_API_BASE: `http://127.0.0.1:${server.address().port}`, BSKY_APP_PASSWORD: PASSWORD, COMMENTS_RETRY_MS: '1' };
  try {
    const r = await run('./comment-candidates.mjs', env, ['--account', 'cozy']);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual([...new Set(logins)], ['saveandplay.com'], 'the login is the main account, no second password');
    assert.deepEqual([...new Set(authorFeeds)], ['cozygame.bsky.social'], 'the answered posts are read from the niche account itself');
    assert.ok(searched.length >= 1 && searched.length <= cozy.queriesPerRun * (cozy.queriesPerGroup ?? 1), 'only its own, smaller set of queries');
    assert.ok(Object.values(cozy.groups).flatMap((g) => g.queries).some((q) => searched.includes(q)), 'the queries are cozy queries');
    assert.ok(readFileSync(join(root, 'drafts', 'comments-cozy.md'), 'utf8').includes(found.author.handle));
    const files = readdirSync(join(root, 'drafts')).sort();
    assert.deepEqual(files, ['comments-cozy.json', 'comments-cozy.md', 'comments-state-cozy.json']);
    for (const f of files) assert.ok(!readFileSync(join(root, 'drafts', f), 'utf8').includes(PASSWORD));
    assert.ok(!r.out.includes(PASSWORD));
    // retro does the same with its own files, and does not touch the cozy ones
    const r2 = await run('./comment-candidates.mjs', env, ['--account', 'retro']);
    assert.equal(r2.code, 0, r2.out);
    assert.ok(existsSync(join(root, 'drafts', 'comments-retro.md')) && existsSync(join(root, 'drafts', 'comments-state-retro.json')));
    assert.deepEqual([...new Set(authorFeeds)].sort(), ['cozygame.bsky.social', 'retrogamedeals.bsky.social']);
    // the memory of cozy does not hide the same post in retro's lists, and the other way round
    writeFileSync(join(root, 'drafts', 'comments-shown-retro-20261016-1000.json'), JSON.stringify([found.uri]));
    const r3 = await run('./comment-candidates.mjs', env, ['--account', 'cozy']);
    assert.equal(r3.code, 0, r3.out);
    assert.ok(readFileSync(join(root, 'drafts', 'comments-cozy.md'), 'utf8').includes(found.author.handle), 'a post shown for retro is still new for cozy');
  } finally {
    server.close();
  }
});

test('a wrong password names the account that logs in (the main one), not the niche', async () => {
  const { server } = fakeServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const root = tempRoot();
  try {
    const r = await run('./comment-candidates.mjs', { COMMENTS_ROOT: root, BSKY_API_BASE: `http://127.0.0.1:${server.address().port}`, BSKY_APP_PASSWORD: 'wrong-password-123', COMMENTS_RETRY_MS: '1' }, ['--account', 'retro']);
    assert.equal(r.code, 1);
    assert.match(r.out, /login as @saveandplay\.com failed/);
    assert.ok(!r.out.includes('wrong-password-123'));
  } finally {
    server.close();
  }
});

test('loginAs is checked: only a Bluesky handle, only for Bluesky', () => {
  assert.deepEqual(configProblems({ ...cozy, loginAs: 'saveandplay.com' }), []);
  assert.match(configProblems({ ...cozy, loginAs: '' }).join(), /loginAs must be a Bluesky handle/);
  assert.match(configProblems({ ...cfg('mastodon-prices'), loginAs: 'x.bsky.social' }).join(), /loginAs must be a Bluesky handle/);
  assert.match(configProblems({ ...cozy, showLimit: 0 }).join(), /showLimit/);
});

// ---- comments-show --all ----------------------------------------------------------------------------------------
const listPost = (id, k, ageH = 2) => ({
  uri: `at://did:plc:${id}${k}/app.bsky.feed.post/3${id}${k}`, url: `https://bsky.app/profile/${id}${k}.bsky.social/post/3${id}${k}`, handle: `${id}${k}.bsky.social`, name: '',
  text: `Post ${id} ${k}: can anyone recommend a game?`, createdAt: ago(ageH), likes: 1, replies: 0, group: 'g', question: true, heated: false, media: null,
});
const IDS = ['prices', 'mastodon-prices', 'cozy', 'retro'];
function showRoot(counts, { madeAgo = {}, missing = [] } = {}) {
  const root = tempRoot();
  mkdirSync(join(root, 'drafts'));
  for (const id of IDS) {
    if (missing.includes(id)) continue;
    const normal = Array.from({ length: counts[id] ?? 0 }, (_, i) => listPost(id, i + 1));
    writeFileSync(join(root, 'drafts', `comments-${id}.json`), JSON.stringify({ madeAt: ago(madeAgo[id] ?? 1), normal, heated: [] }));
  }
  return root;
}
const show = (root, args) => run('./comments-show.mjs', { COMMENTS_ROOT: root }, args);
const STAMP = '20261016-120000';

test('show --all: every enabled account in the order of the settings, each with its own limit and its own shown file', async () => {
  const root = showRoot({ prices: 20, 'mastodon-prices': 12, cozy: 10, retro: 0 });
  const r = await show(root, ['--all', '--record-new-all', STAMP]);
  assert.equal(r.code, 0, r.out);
  const heads = [...r.out.matchAll(/^=+ ([\w-]+) \(/gm)].map((m) => m[1]);
  assert.deepEqual(heads, IDS, 'one block per account, in the order of the settings file');
  const count = (id) => (r.out.match(new RegExp(`https://bsky\\.app/profile/${id}\\d+\\.bsky\\.social`, 'g')) || []).length;
  assert.equal(count('prices'), 15, 'the main block keeps its limit of 15');
  assert.equal(count('mastodon-prices'), 8);
  assert.equal(count('cozy'), 8, 'small limit for the niche accounts, the common run stays short');
  assert.equal(count('retro'), 0);
  assert.match(r.out, /NEW POSTS: 0/, 'an empty block is allowed');
  const written = readdirSync(join(root, 'drafts')).filter((f) => f.startsWith('comments-shown-'));
  assert.deepEqual(written.sort(), [`comments-shown-cozy-${STAMP}.json`, `comments-shown-mastodon-prices-${STAMP}.json`, `comments-shown-prices-${STAMP}.json`], 'one file per account that showed posts, none for the empty one');
  assert.equal(JSON.parse(readFileSync(join(root, 'drafts', `comments-shown-cozy-${STAMP}.json`), 'utf8')).length, 8);
  // ONE command to save them all
  assert.match(r.out, new RegExp(`bash scripts/comments-branch\\.sh save drafts/comments-shown-prices-${STAMP}\\.json drafts/comments-shown-mastodon-prices-${STAMP}\\.json drafts/comments-shown-cozy-${STAMP}\\.json\\s*$`));
  // the next visit goes on with the posts not shown yet, per account
  const r2 = await show(root, ['--all', '--record-new-all', '20261016-130000']);
  assert.equal(r2.code, 0, r2.out);
  const count2 = (id) => (r2.out.match(new RegExp(`https://bsky\\.app/profile/${id}\\d+\\.bsky\\.social`, 'g')) || []).length;
  assert.deepEqual([count2('prices'), count2('mastodon-prices'), count2('cozy')], [5, 4, 2], 'only what was not shown before');
});

test('show --all: the memory of one account does not hide the posts of another', async () => {
  const root = showRoot({ cozy: 1, retro: 1 });
  // the same web address is in both lists, but only the cozy copy was shown before
  const same = listPost('x', 1);
  for (const id of ['cozy', 'retro']) writeFileSync(join(root, 'drafts', `comments-${id}.json`), JSON.stringify({ madeAt: ago(1), normal: [same], heated: [] }));
  writeFileSync(join(root, 'drafts', 'comments-shown-cozy-old.json'), JSON.stringify([same.url]));
  const r = await show(root, ['--all']);
  const cozyBlock = r.out.split(/^=+ retro /m)[0];
  assert.match(cozyBlock, /cozy[\s\S]*NEW POSTS: 0/);
  assert.match(r.out.split(/^=+ retro /m)[1], /NEW POSTS: 1/);
  assert.match(r.out, /this was a look/, 'without --record-new-all nothing is written');
  assert.deepEqual(readdirSync(join(root, 'drafts')).filter((f) => f.includes(STAMP)), []);
});

test('show --all: one stale or missing list stops everything (nothing shown, nothing remembered) unless --partial', async () => {
  const stale = showRoot({ prices: 3, cozy: 3, retro: 3, 'mastodon-prices': 3 }, { madeAgo: { retro: 20 } });
  const r = await show(stale, ['--all', '--record-new-all', STAMP]);
  assert.equal(r.code, 3);
  assert.match(r.out, /retro \(stale\)/);
  assert.match(r.out, /workflow ONCE/);
  assert.ok(!r.out.includes('bsky.app/profile'), 'no posts are shown');
  assert.deepEqual(readdirSync(join(stale, 'drafts')).filter((f) => f.startsWith('comments-shown-')), [], 'nothing remembered');
  const missing = showRoot({ prices: 3, 'mastodon-prices': 3 }, { missing: ['cozy', 'retro'] });
  const m = await show(missing, ['--all']);
  assert.equal(m.code, 2);
  assert.match(m.out, /cozy \(missing\), retro \(missing\)/);
});

test('show --all --partial: the good lists are shown and remembered, the unusable one is named and skipped', async () => {
  const root = showRoot({ prices: 3, cozy: 3, retro: 3, 'mastodon-prices': 3 }, { madeAgo: { retro: 20 }, missing: [] });
  const r = await show(root, ['--all', '--partial', '--record-new-all', STAMP]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /retro[\s\S]*SKIPPED \(STALE LIST\)/);
  assert.ok(r.out.includes('cozy1.bsky.social') && r.out.includes('prices1.bsky.social'));
  assert.ok(!r.out.includes('retro1.bsky.social'));
  const written = readdirSync(join(root, 'drafts')).filter((f) => f.startsWith('comments-shown-')).sort();
  assert.deepEqual(written, [`comments-shown-cozy-${STAMP}.json`, `comments-shown-mastodon-prices-${STAMP}.json`, `comments-shown-prices-${STAMP}.json`]);
});

test('show --all: --limit replaces every limit; a disabled account is not read; the single-account call still works as before', async () => {
  const root = showRoot({ prices: 20, 'mastodon-prices': 20, cozy: 20, retro: 20 });
  const r = await show(root, ['--all', '--limit', '3']);
  assert.equal((r.out.match(/bsky\.app\/profile\/[\w-]+\d+\.bsky\.social/g) || []).length, 12);
  // switch retro off in the copy of the settings
  const path = join(root, 'data', 'comments-accounts.json');
  const j = JSON.parse(readFileSync(path, 'utf8'));
  j.accounts.retro.enabled = false;
  writeFileSync(path, JSON.stringify(j));
  const off = await show(root, ['--all', '--limit', '3']);
  assert.ok(!/^=+ retro /m.test(off.out), 'a disabled account has no block');
  // the old call: one account, default limit = its showLimit (cozy 8, prices 15)
  const one = await show(root, ['--account', 'cozy']);
  assert.equal(one.code, 0);
  assert.equal((one.out.match(/bsky\.app\/profile\/cozy\d+/g) || []).length, 8);
  const old = await show(root, ['--limit', '2', '--record-new', join(root, 'drafts', 'comments-shown-prices-X.json')]);
  assert.match(old.out, /REMEMBERED: 2 posts as shown, in the new file/);
});

test('the workflow runs every enabled account (no --account), and the copy in .github is the same file', () => {
  const copy = readFileSync(fileURLToPath(new URL('./comments-workflow.yml', import.meta.url)), 'utf8');
  const live = readFileSync(fileURLToPath(new URL('../.github/workflows/comments.yml', import.meta.url)), 'utf8');
  assert.equal(copy.replace(/\r\n/g, '\n'), live.replace(/\r\n/g, '\n'), 'scripts/comments-workflow.yml and .github/workflows/comments.yml are the same');
  assert.match(copy, /run: node scripts\/comment-candidates\.mjs\s*$/m, 'no --account: every enabled block is searched, new ones included');
  assert.match(copy, /BSKY_APP_PASSWORD: \$\{\{ secrets\.BSKY_APP_PASSWORD \}\}/, 'the one existing secret is enough');
});

// ---- the wide mode of the main account: "комментарии saveandplay 2" (20 Oct 2026) ------------------------------------
test('prices-wide: the same account, a lower threshold, more groups, and a memory shared with the main block', () => {
  const prices = cfg('prices');
  const w = cfg('prices-wide');
  assert.deepEqual(configProblems(w), []);
  assert.equal(w.handle, prices.handle, 'replies go out from the same account');
  assert.equal(w.shownAs, 'prices', 'one memory "shown" for both modes: no post is shown twice');
  assert.equal(w.onDemand, true, 'not part of "комментарии saveandplay"');
  assert.ok(w.minScore < prices.minScore, 'a lower threshold');
  assert.ok(w.showLimit > prices.showLimit);
  for (const g of Object.keys(prices.groups)) assert.deepEqual(w.groups[g], prices.groups[g], `${g}: the main groups are inherited unchanged`);
  const extra = Object.keys(w.groups).filter((g) => !prices.groups[g]);
  assert.ok(extra.length >= 6, 'new groups with new words');
  for (const g of extra) assert.ok(w.groups[g].queries.length >= 4 && w.groups[g].queries.every((q) => !q.includes('"')), `${g}: plain words, no quotes`);
  assert.ok(w.queriesPerRun >= Object.keys(w.groups).length, 'every group is searched in every run');
  assert.deepEqual(w.skipWords, prices.skipWords, 'the safety rules (skip words, authors, promo) are the main ones');
  assert.deepEqual(w.skipAuthorWords, prices.skipAuthorWords);
});

test('prices-wide: a post the main mode showed is not shown again, the wide mode is not in --all, and it writes into the shared memory', async () => {
  const root = showRoot({ prices: 2, cozy: 1, retro: 1, 'mastodon-prices': 1 });
  const k = (i) => listPost('wide', i);
  writeFileSync(join(root, 'drafts', 'comments-prices-wide.json'), JSON.stringify({ madeAt: ago(1), normal: [k(1), k(2), k(3)], heated: [] }));
  // the main mode showed post 1 earlier (its memory file is named after `prices`)
  writeFileSync(join(root, 'drafts', 'comments-shown-prices-20261020-100000.json'), JSON.stringify([k(1).url]));
  const rec = join(root, 'drafts', 'comments-shown-prices-wide-20261020-110000.json');
  const r = await show(root, ['--account', 'prices-wide', '--record-new', rec]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /NEW POSTS: 2/);
  assert.ok(!r.out.includes('widee1') && !r.out.includes(k(1).url), 'the post shown by the main mode is gone');
  assert.ok(r.out.includes(k(2).url) && r.out.includes(k(3).url));
  // the file the wide mode writes is read by the MAIN mode as its own memory (same prefix), so the main list does not offer them either
  writeFileSync(join(root, 'drafts', 'comments-prices.json'), JSON.stringify({ madeAt: ago(1), normal: [k(2), k(4)], heated: [] }));
  const main = await show(root, ['--account', 'prices']);
  assert.ok(!main.out.includes(k(2).url), 'shown in the wide mode, so not again in the main mode');
  assert.ok(main.out.includes(k(4).url));
  // "all" does not include the wide mode
  const all = await show(root, ['--all']);
  assert.ok(!/=+ prices-wide /.test(all.out), 'the wide mode is asked for by name only');
  assert.deepEqual([...all.out.matchAll(/^=+ ([\w-]+) \(/gm)].map((m) => m[1]), IDS);
});

test('end to end: the finder run of prices-wide logs in as the main account and skips what the main mode already showed', async () => {
  const { server, logins, found } = fakeServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const root = tempRoot();
  const env = { COMMENTS_ROOT: root, BSKY_API_BASE: `http://127.0.0.1:${server.address().port}`, BSKY_APP_PASSWORD: PASSWORD, COMMENTS_RETRY_MS: '1' };
  try {
    const r = await run('./comment-candidates.mjs', env, ['--account', 'prices-wide']);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual([...new Set(logins)], ['saveandplay.com']);
    assert.ok(existsSync(join(root, 'drafts', 'comments-prices-wide.json')) && existsSync(join(root, 'drafts', 'comments-state-prices-wide.json')), 'its own list and state');
    assert.ok(!existsSync(join(root, 'drafts', 'comments-prices.json')), 'the main list is not touched');
    // the main mode showed this post: the wide mode must not list it any more (shared memory, file named after prices)
    writeFileSync(join(root, 'drafts', 'comments-shown-prices-20261020-1000.json'), JSON.stringify([found.uri]));
    const r2 = await run('./comment-candidates.mjs', env, ['--account', 'prices-wide']);
    assert.equal(r2.code, 0, r2.out);
    assert.ok(!readFileSync(join(root, 'drafts', 'comments-prices-wide.md'), 'utf8').includes(found.author.handle), 'already shown by the main mode, so gone from the wide list');
  } finally {
    server.close();
  }
});
