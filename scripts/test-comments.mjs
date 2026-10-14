// Tests for the comment finder. No internet and no real account: a small fake Bluesky server runs on this computer.
//   npm run comments:test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commentAccounts, parseFeedUrl, describeEmbed, evaluate, pickQueries, updatePool, renderReport, readEnvValue, configProblems, loadShown, postKey, file } from './lib/comments.mjs';

const NOW = Date.parse('2026-10-13T15:00:00Z');
const ago = (h) => new Date(NOW - h * 36e5).toISOString();
let n = 0;
const mk = (o = {}) => {
  const id = ++n;
  return {
    uri: `at://did:plc:t${id}/app.bsky.feed.post/3k${id}`,
    author: { handle: o.handle ?? `person${id}.bsky.social`, displayName: o.name ?? 'Some Person', labels: o.authorLabels ?? [] },
    record: { text: o.text ?? 'Should I buy this on Steam now or wait for a sale? Any tips?', createdAt: ago(o.age ?? 3), langs: o.langs ?? ['en'], facets: o.facets, reply: o.reply },
    likeCount: o.likes ?? 1, replyCount: o.replies ?? 0, labels: o.labels ?? [], threadgate: o.threadgate, embed: o.embed,
  };
};
const cfg = commentAccounts('prices')[0].account;
const ev = (post, extra = {}) => evaluate(post, cfg, { now: NOW, group: 'waitForSale', query: 'q', ...extra });

test('a real question about buying a game is kept', () => {
  const r = ev(mk());
  assert.equal(r.keep, true);
  assert.match(r.candidate.url, /^https:\/\/bsky\.app\/profile\/person\d+\.bsky\.social\/post\/3k\d+$/);
  assert.equal(r.candidate.question, true);
  assert.equal(r.candidate.heated, false);
});

test('posts that must be dropped, each with its reason', () => {
  const cases = [
    ['developer promoting a game', mk({ text: 'Wishlist our game on Steam, the demo is out now! #indiedev' }), 'skip word'],
    ['a bot or deals account', mk({ handle: 'loregoblins-dailydeals.bsky.social', name: 'Daily Game Deals', text: 'Escape Academy is $1.99 on Steam today, worth a look for PC players' }), 'bot, shop or studio'],
    ['a games studio by its handle', mk({ handle: 'reddeergames.bsky.social', text: 'Should we add more recipes to our cooking game on Steam?' }), 'bot, shop or studio'],
    ['older than the limit', mk({ age: 40 }), 'too old'],
    ['adult label on the post', mk({ labels: [{ val: 'porn' }] }), 'adult or graphic label'],
    ['adult label on the author', mk({ authorLabels: [{ val: 'sexual' }] }), 'adult or graphic label'],
    ['replies limited by the author', mk({ threadgate: { record: { allow: [{ $type: 'app.bsky.feed.threadgate#followerRule' }] } } }), 'replies are limited'],
    ['not English', mk({ langs: ['es'], text: 'Debería comprar este juego en Steam o esperar a una oferta?' }), 'other language'],
    ['too short', mk({ text: 'steam sale?' }), 'too short'],
    ['our own post', mk({ handle: 'saveandplay.com' }), 'own post'],
    ['adult word in the text', mk({ text: 'Should I buy this 18+ game on Steam or wait for a sale?' }), 'skip word'],
  ];
  for (const [name, post, reason] of cases) {
    const r = ev(post);
    assert.equal(r.keep, false, name);
    assert.equal(r.reason, reason, name);
  }
});

test('posts that are not about games are dropped (books, comics)', () => {
  const r = ev(mk({ text: "I'm rereading a bunch of the late Greg Bear's books thanks to Humble Bundle. Great stuff!" }), { group: 'bundles' });
  assert.equal(r.keep, false);
  assert.equal(r.reason, 'not about games');
});

test('"highly recommend" is not a question, but asking for recommendations is', () => {
  const stmt = ev(mk({ text: "I've played this Steam game for hours and I highly recommend it to everyone, great fun." }));
  assert.equal(stmt.candidate.question, false);
  const ask = ev(mk({ text: 'Can anyone recommend a cozy Steam game for the weekend' }));
  assert.equal(ask.candidate.question, true);
});

test('a threadgate without a rule list does not limit replies (hidden replies only)', () => {
  assert.equal(ev(mk({ threadgate: { record: { hiddenReplies: ['at://x'] } } })).keep, true);
});

test('a post we already answered is not offered again', () => {
  const p = mk();
  assert.equal(ev(p, { ownReplied: new Set([p.uri]) }).reason, 'already answered');
});

test('a post that was already shown to the owner is not offered again', () => {
  const p = mk();
  assert.equal(ev(p, { shown: new Set([postKey(p.uri)]) }).reason, 'already shown');
  const state = {};
  const c = ev(mk()).candidate;
  assert.equal(updatePool(state, [c], cfg, NOW, new Set(), new Set([postKey(c.uri)])).normal.length, 0);
});

test('shown posts are read from every shown file of the account, links or addresses, broken files ignored', () => {
  const root = mkdtempSync(join(tmpdir(), 'shown-'));
  mkdirSync(join(root, 'drafts'));
  const w = (name, text) => writeFileSync(join(root, 'drafts', name), text);
  w('comments-shown-prices.json', JSON.stringify(['https://bsky.app/profile/a.bsky.social/post/3KAAA']));
  w('comments-shown-prices-20261013-1000.json', JSON.stringify(['at://did:plc:x/app.bsky.feed.post/3kbbb', { url: 'https://bsky.app/profile/c.bsky.social/post/3kccc' }]));
  w('comments-shown-prices-broken.json', '{not json');
  w('comments-shown-other-20261013.json', JSON.stringify(['https://bsky.app/profile/z.bsky.social/post/3kzzz']));
  const old = process.env.COMMENTS_ROOT;
  process.env.COMMENTS_ROOT = root;
  return import(`./lib/comments.mjs?shown=${Date.now()}`).then((m) => {
    process.env.COMMENTS_ROOT = old ?? '';
    if (old === undefined) delete process.env.COMMENTS_ROOT;
    assert.deepEqual([...m.loadShown('prices')].sort(), ['3kaaa', '3kbbb', '3kccc']);
    assert.equal(m.loadShown('nobody').size, 0);
  });
});

test('a plain remark with no question and no topic scores too low', () => {
  const r = ev(mk({ text: 'Played some games this morning, the weather is lovely today.', likes: 0, replies: 9, age: 20 }), { group: 'genres' });
  assert.equal(r.keep, false);
  assert.equal(r.reason, 'low score');
});

test('AI debates are kept but marked as heated', () => {
  const r = ev(mk({ text: 'Does anyone know if Steam shows which games use generative AI on the store page?' }), { group: 'ai' });
  assert.equal(r.keep, true);
  assert.equal(r.candidate.heated, true);
  const r2 = ev(mk({ text: 'Should I buy this game, people say the art is AI slop? Not sure about it on Steam.' }));
  assert.equal(r2.candidate.heated, true);
});

test('queries rotate over different groups and then over the queries of each group', () => {
  const state = {};
  const small = { queriesPerRun: 2, groups: { a: { queries: ['a1', 'a2'] }, b: { queries: ['b1'] }, c: { queries: ['c1', 'c2'] }, off: { enabled: false, queries: ['x'] } } };
  const r1 = pickQueries(small, state, 2).map((q) => q.query);
  const r2 = pickQueries(small, state, 2).map((q) => q.query);
  const r3 = pickQueries(small, state, 2).map((q) => q.query);
  assert.deepEqual(r1, ['a1', 'b1']);
  assert.deepEqual(r2, ['c1', 'a2']);
  assert.deepEqual(r3, ['b1', 'c2']);
});

test('broad groups (general game talk) are in the settings, give usable posts, and can be switched off', () => {
  assert.ok(cfg.groups.broadPlaying?.broad && cfg.groups.broadAsk?.broad, 'both broad groups exist and are marked broad');
  const r = ev(mk({ text: 'Just finished Hades on my PC and wow, what a game. Any recommendations for another roguelike on Steam?' }), { group: 'broadAsk' });
  assert.equal(r.keep, true);
  assert.equal(r.candidate.group, 'broadAsk');
  // a plain mention of a finished game, no question: kept only if it scores enough, never crashes
  const plain = ev(mk({ text: 'Finally finished my first run of Hollow Knight on Steam, that last boss was brutal.' }), { group: 'broadPlaying' });
  assert.ok(plain.keep === true || plain.reason === 'low score', `unexpected: ${plain.reason}`);
  // switched off: the rotation never picks them
  const off = structuredClone(cfg);
  off.groups.broadPlaying.enabled = false;
  off.groups.broadAsk.enabled = false;
  const state = {};
  const groups = new Set();
  for (let i = 0; i < 6; i++) pickQueries(off, state).forEach((q) => groups.add(q.group));
  assert.ok(!groups.has('broadPlaying') && !groups.has('broadAsk'));
  assert.ok(groups.has('waitForSale'));
});

test('the pool keeps fresh candidates between runs and drops old or answered ones', () => {
  const state = {};
  const a = ev(mk({ age: 2 })).candidate;
  const b = ev(mk({ age: 25 })).candidate;
  const first = updatePool(state, [a, b], cfg, NOW);
  assert.equal(first.normal.length, 2);
  const later = NOW + 8 * 36e5; // b is now 33 hours old
  const second = updatePool(state, [], cfg, later);
  assert.deepEqual(second.normal.map((c) => c.uri), [a.uri]);
  const third = updatePool(state, [], cfg, later, new Set([a.uri]));
  assert.equal(third.normal.length, 0);
});

test('the report is short and has link, handle and text', () => {
  const c = ev(mk({ text: 'Should I buy this on Steam now or wait for a sale?' })).candidate;
  const md = renderReport('prices', cfg, { searched: [{ group: 'waitForSale', query: 'q' }], stats: { 'skip word': 3 }, picked: { normal: [c], heated: [] }, now: NOW });
  assert.match(md, /^# Comment candidates: prices \(@saveandplay\.com\)/);
  assert.match(md, new RegExp(c.url.replace(/[.]/g, '\\.')));
  assert.match(md, /skip word 3/);
  assert.ok(md.length < 1500);
});

test('the .env reader understands quotes and ignores other keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  const p = join(dir, '.env');
  writeFileSync(p, 'A=1\nBSKY_APP_PASSWORD="abcd-efgh"\nOTHER=\'x y\'\n');
  assert.equal(readEnvValue(p, 'BSKY_APP_PASSWORD'), 'abcd-efgh');
  assert.equal(readEnvValue(p, 'OTHER'), 'x y');
  assert.equal(readEnvValue(p, 'MISSING'), null);
  assert.equal(readEnvValue(join(dir, 'nope'), 'A'), null);
});

test('feed addresses are understood, wrong ones are reported', () => {
  assert.deepEqual(parseFeedUrl('https://bsky.app/profile/phusion.bsky.social/feed/aaadmtxc3akja'), { actor: 'phusion.bsky.social', rkey: 'aaadmtxc3akja' });
  assert.deepEqual(parseFeedUrl(' https://bsky.app/profile/did:plc:abc123/feed/aaa111/ '), { actor: 'did:plc:abc123', rkey: 'aaa111' });
  assert.deepEqual(parseFeedUrl('at://did:plc:abc123/app.bsky.feed.generator/aaa111'), { actor: 'did:plc:abc123', rkey: 'aaa111' });
  for (const bad of ['', null, 'https://example.com/feed/x', 'https://bsky.app/profile/phusion.bsky.social', 'https://bsky.app/profile/a/post/b']) assert.equal(parseFeedUrl(bad), null, String(bad));
  const withFeeds = (feeds) => ({ ...cfg, feeds });
  assert.deepEqual(configProblems(withFeeds([{ name: 'ok', url: 'https://bsky.app/profile/a.bsky.social/feed/b1' }])), []);
  assert.match(configProblems(withFeeds([{ name: 'bad', url: 'nonsense' }]))[0], /feed "bad": url must look like/);
  assert.match(configProblems(withFeeds([{ url: 'https://bsky.app/profile/a/feed/b' }]))[0], /feed has no name/);
  assert.match(configProblems(withFeeds([{ name: 'deck', url: 'https://bsky.app/profile/a/feed/b' }]))[0], /same name as a group/);
});

test('a post from a feed is judged by the same rules and takes the weight of its feed', () => {
  const feed = cfg.feeds.find((f) => f.name === 'pcGaming');
  assert.ok(feed, 'the PC Gaming feed is in the settings');
  const p = mk({ text: 'Which cozy game should I play first on my new Steam Deck? Any ideas?', likes: 1, replies: 0, age: 3 });
  const inFeed = ev(p, { group: 'pcGaming' });
  const unknown = ev(p, { group: 'no-such-group' }); // not a group, not a feed: the default weight 1
  assert.equal(inFeed.keep, true, inFeed.reason);
  assert.equal(unknown.keep, true, unknown.reason);
  assert.equal(inFeed.candidate.score - unknown.candidate.score, feed.weight - 1);
  assert.equal(ev(mk({ handle: 'dailygamedrops.bsky.social', text: 'Fallout 4 is $4.99 on Steam today, lowest price ever for the game.' }), { group: 'pcGaming' }).reason, 'bot, shop or studio');
});

test('what is attached to a post is described in a few words, because Claude cannot see pictures', () => {
  assert.equal(describeEmbed(null), null);
  assert.equal(describeEmbed({ $type: 'app.bsky.embed.images#view', images: [{ alt: 'Steam page of Hades showing 75% off' }] }), 'image: Steam page of Hades showing 75% off');
  assert.equal(describeEmbed({ $type: 'app.bsky.embed.images#view', images: [{ alt: '' }] }), 'image, no description');
  assert.equal(describeEmbed({ $type: 'app.bsky.embed.images#view', images: [{ alt: 'a' }, { alt: '' }, { alt: 'c' }] }), '3 images: a / c');
  assert.equal(describeEmbed({ $type: 'app.bsky.embed.video#view', alt: '' }), 'video, no description');
  assert.equal(describeEmbed({ $type: 'app.bsky.embed.external#view', external: { title: 'Bundle tiers explained', uri: 'https://x.test' } }), 'link card: Bundle tiers explained');
  assert.equal(describeEmbed({ $type: 'app.bsky.embed.record#view', record: { $type: 'app.bsky.embed.record#viewRecord', author: { handle: 'a.bsky.social' }, value: { text: 'Is this worth it?' } } }), 'quotes @a.bsky.social: Is this worth it?');
  assert.equal(describeEmbed({ $type: 'app.bsky.embed.record#view', record: { $type: 'app.bsky.embed.record#viewNotFound' } }), null);
  assert.equal(describeEmbed({ $type: 'app.bsky.embed.recordWithMedia#view', media: { $type: 'app.bsky.embed.images#view', images: [{ alt: 'cart' }] }, record: { record: { $type: 'app.bsky.embed.record#viewRecord', author: { handle: 'b.bsky.social' }, value: { text: 'Deal!' } } } }), 'image: cart; quotes @b.bsky.social: Deal!');
  assert.ok(describeEmbed({ $type: 'app.bsky.embed.images#view', images: [{ alt: 'x'.repeat(500) }] }).length < 200, 'a long description is cut');
});

test('a post with a picture is kept, and the list says there is a picture', () => {
  const withPic = ev(mk({ text: 'Should I buy this on Steam now or wait for a sale? Screenshot of the price below.', embed: { $type: 'app.bsky.embed.images#view', images: [{ alt: '' }] } }));
  assert.equal(withPic.keep, true, withPic.reason);
  assert.equal(withPic.candidate.media, 'image, no description');
  assert.equal(ev(mk()).candidate.media, null);
  // a picture without any text is never offered: there is nothing to answer
  assert.equal(ev(mk({ text: '', embed: { $type: 'app.bsky.embed.images#view', images: [{ alt: 'cat' }] } })).reason, 'empty');
  const picked = { normal: [withPic.candidate], heated: [] };
  const md = renderReport('prices', cfg, { searched: [], stats: {}, picked, now: NOW });
  assert.match(md, /\n   \[image, no description\]\n/);
});

test('the settings file is complete', () => {
  assert.deepEqual(configProblems(cfg), []);
  assert.deepEqual(configProblems({ handle: 'x' }), ['passwordEnv is missing (the name of the variable that holds the app password)', 'groups is empty']);
});

// ---- the whole program against a fake Bluesky server ------------------------------------------------------------
const PASSWORD = 'test-password-not-real';

function fakeServer({ feedFails = false } = {}) {
  const calls = [];
  const good = mk({ handle: 'goodperson.bsky.social', text: 'Thinking about buying a Steam Deck game for a long flight. Worth it or should I wait for a sale?' });
  const answered = mk({ handle: 'answeredperson.bsky.social', text: 'Should I buy this game on Steam or wait for a sale? Not sure yet.' });
  const limited = mk({ handle: 'closedperson.bsky.social', text: 'Seeking recommendations for Steam Deck games for my flight, any good ones?', threadgate: { record: { allow: [] } } });
  const dev = mk({ handle: 'somedev.bsky.social', text: 'Wishlist my game on Steam, the demo is out now!' });
  const nsfw = mk({ handle: 'adultperson.bsky.social', text: 'Should I buy this on Steam or wait for a sale?', labels: [{ val: 'porn' }] });
  const ai = mk({ handle: 'aiperson.bsky.social', text: 'Does anyone know if Steam shows which games use generative AI on the store page?' });
  const feedGood = mk({ handle: 'feedperson.bsky.social', text: 'Just got a Steam Deck for the trip, which cozy game should I install first? Open to ideas.' });
  const feedBot = mk({ handle: 'dailygamedrops.bsky.social', text: 'Fallout 4 is $4.99 on Steam until Oct 23, lowest price ever for the game.' });
  const posts = [good, answered, limited, dev, nsfw, ai];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      calls.push(`${req.method} ${url.pathname}${url.searchParams.get('q') ? ' q=' + url.searchParams.get('q') : ''}`);
      if (url.pathname.endsWith('createSession')) {
        const b = JSON.parse(body || '{}');
        return b.password === PASSWORD ? send(200, { accessJwt: 'jwt-test' }) : send(401, { error: 'AuthenticationRequired', message: 'Invalid identifier or password' });
      }
      if (req.headers.authorization !== 'Bearer jwt-test') return send(401, { error: 'AuthenticationRequired', message: 'login needed' });
      if (url.pathname.endsWith('searchPosts')) return send(200, { posts });
      if (url.pathname.endsWith('resolveHandle')) return send(200, { did: 'did:plc:fakephusion' });
      if (url.pathname.endsWith('getFeed')) {
        if (feedFails) return send(500, { error: 'InternalServerError', message: 'feed is down' });
        calls.push(`feed=${url.searchParams.get('feed')}`);
        return send(200, { feed: [{ post: feedGood }, { post: feedBot }, { post: feedGood }] });
      }
      if (url.pathname.endsWith('getAuthorFeed')) {
        return send(200, { feed: [{ post: { author: { handle: 'saveandplay.com' } }, reply: { parent: { uri: answered.uri }, root: { uri: answered.uri } } }] });
      }
      return send(404, { error: 'NotFound' });
    });
  });
  return { server, calls, posts: { good, answered, limited, dev, nsfw, ai, feedGood, feedBot } };
}

function runProgram(env, args = []) {
  const script = fileURLToPath(new URL('./comment-candidates.mjs', import.meta.url));
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'comments-'));
  mkdirSync(join(root, 'data'));
  copyFileSync(file('data', 'comments-accounts.json'), join(root, 'data', 'comments-accounts.json'));
  return root;
}

test('end to end: the list has only the right posts, the password is never printed or saved', async () => {
  const { server, posts, calls } = fakeServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const root = tempRoot();
  const env = { COMMENTS_ROOT: root, BSKY_API_BASE: base, BSKY_APP_PASSWORD: PASSWORD, COMMENTS_RETRY_MS: '1' };
  try {
    const r = await runProgram(env);
    assert.equal(r.code, 0, r.out);
    const md = readFileSync(join(root, 'drafts', 'comments-prices.md'), 'utf8');
    assert.ok(md.includes('goodperson.bsky.social'), 'the good post is listed');
    for (const bad of ['answeredperson', 'closedperson', 'somedev', 'adultperson']) assert.ok(!md.includes(bad), `${bad} is not listed`);
    assert.match(md, /## Heated topics[\s\S]*aiperson/);
    assert.ok(md.includes('feedperson.bsky.social') && md.includes('pcGaming'), 'the good post from the feed is listed, with the name of the feed');
    assert.equal((md.match(/\/profile\/feedperson\.bsky\.social\/post\//g) || []).length, 1, 'the same post twice in the feed is listed once');
    assert.ok(!md.includes('dailygamedrops'), 'a deals bot from the feed is not listed');
    assert.ok(md.includes('pcGaming: feed'), 'the feed is named in the header of the list');
    assert.ok(calls.includes('feed=at://did:plc:fakephusion/app.bsky.feed.generator/aaadmtxc3akja'), 'the feed address was built from the owner and the id');
    assert.ok(existsSync(join(root, 'drafts', 'comments-state-prices.json')));
    for (const f of readdirSync(join(root, 'drafts'))) assert.ok(!readFileSync(join(root, 'drafts', f), 'utf8').includes(PASSWORD), `${f} has no password`);
    assert.ok(!r.out.includes(PASSWORD), 'the password is not printed');
    // a second run goes on with other queries and keeps the posts that are still fresh
    const r2 = await runProgram(env);
    assert.equal(r2.code, 0, r2.out);
    assert.ok(readFileSync(join(root, 'drafts', 'comments-prices.md'), 'utf8').includes('goodperson.bsky.social'));
    assert.equal(posts.good.author.handle, 'goodperson.bsky.social');
    const sources = JSON.parse(readFileSync(join(root, 'drafts', 'comments-state-prices.json'), 'utf8')).sources;
    assert.equal(sources.pcGaming.runs, 2, 'two runs are counted for the feed');
    assert.equal(sources.pcGaming.posts, 6, 'three posts per run were seen');
    assert.ok(sources.pcGaming.fit >= 2 && sources.pcGaming.fit < sources.pcGaming.posts, 'some posts fit and the bot post does not');
    assert.ok(r2.out.includes('Sources so far') && r2.out.includes('pcGaming:'), 'the totals are printed');
    // after the owner was shown the good post, it never comes back
    writeFileSync(join(root, 'drafts', 'comments-shown-prices-20261013-1000.json'), JSON.stringify([`https://bsky.app/profile/goodperson.bsky.social/post/${posts.good.uri.split('/').pop()}`]));
    const r3 = await runProgram(env);
    assert.equal(r3.code, 0, r3.out);
    assert.ok(!readFileSync(join(root, 'drafts', 'comments-prices.md'), 'utf8').includes('goodperson.bsky.social'), 'the shown post is gone');
  } finally {
    server.close();
  }
});

test('a feed that is down does not stop the search, and the problem is named', async () => {
  const { server } = fakeServer({ feedFails: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const root = tempRoot();
  try {
    const r = await runProgram({ COMMENTS_ROOT: root, BSKY_API_BASE: `http://127.0.0.1:${server.address().port}`, BSKY_APP_PASSWORD: PASSWORD, COMMENTS_RETRY_MS: '1' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /feed pcGaming: FAILED \(feed is down\)/);
    assert.ok(readFileSync(join(root, 'drafts', 'comments-prices.md'), 'utf8').includes('goodperson.bsky.social'), 'the search part still works');
  } finally {
    server.close();
  }
});

test('a wrong password gives a plain message, exit code 1, and the password is not shown', async () => {
  const { server } = fakeServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const root = tempRoot();
  try {
    const r = await runProgram({ COMMENTS_ROOT: root, BSKY_API_BASE: `http://127.0.0.1:${server.address().port}`, BSKY_APP_PASSWORD: 'wrong-password-123', COMMENTS_RETRY_MS: '1' });
    assert.equal(r.code, 1);
    assert.match(r.out, /login as @saveandplay\.com failed/);
    assert.ok(!r.out.includes('wrong-password-123'));
    assert.ok(!existsSync(join(root, 'drafts', 'comments-prices.md')));
  } finally {
    server.close();
  }
});

test('no password at all explains how to get one', async () => {
  const root = tempRoot();
  const r = await runProgram({ COMMENTS_ROOT: root, BSKY_APP_PASSWORD: '' });
  assert.equal(r.code, 1);
  assert.match(r.out, /App passwords/);
});
