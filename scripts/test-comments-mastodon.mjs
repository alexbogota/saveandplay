// Tests for the Mastodon side of the comment finder. No internet and no real account: a small fake Mastodon server runs on this computer.
//   npm run comments:test   (runs this file together with test-comments.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commentAccounts, configProblems, evaluate, fromMastodon, htmlToText, describeMastodonMedia, parseTagQuery, createMastodonApi, loadShown, file } from './lib/comments.mjs';

const NOW = Date.parse('2026-10-13T15:00:00Z');
const HOME = 'mastodon.social';
let n = 1000;
const hashtag = (t) => `<a href="https://${HOME}/tags/${t.toLowerCase()}" class="mention hashtag" rel="tag">#<span>${t}</span></a>`;
const link = (url) => `<a href="${url}" target="_blank" rel="nofollow noopener noreferrer" translate="no"><span class="invisible">https://</span><span class="ellipsis">${url.replace('https://', '')}</span><span class="invisible"></span></a>`;

// A status as a Mastodon server returns it. `base` is "now" for the created_at (fixed for the rules, the real time for the whole program).
function status(o = {}, base = NOW) {
  const id = String(o.id ?? ++n);
  const acct = o.acct ?? `person${id}@other.example`;
  const [user, domain] = acct.split('@');
  return {
    id,
    created_at: new Date(base - (o.age ?? 3) * 36e5).toISOString(),
    in_reply_to_id: o.reply ?? null,
    sensitive: !!o.sensitive,
    spoiler_text: o.cw ?? '',
    visibility: 'public',
    language: o.lang === undefined ? 'en' : o.lang,
    url: o.url ?? `https://${domain ?? HOME}/@${user}/statuses/${id}`,
    replies_count: o.replies ?? 0,
    favourites_count: o.likes ?? 1,
    content: o.html ?? `<p>${o.text ?? 'Should I buy this on Steam now or wait for a sale? Any tips?'}</p>`,
    account: {
      id: `7${id}`, acct: domain === HOME ? user : acct, display_name: o.name ?? 'Some Person', bot: !!o.bot,
      url: `https://${domain ?? HOME}/@${user}`, note: o.note ?? '<p>I like games and cats</p>', noindex: o.noindex ?? null,
    },
    media_attachments: o.media ?? [],
    card: o.card ?? null,
    reblog: o.reblog ?? null,
  };
}
const mcfg = commentAccounts('mastodon-prices')[0].account;
const ms = (o = {}) => fromMastodon(status(o), HOME);
const ev = (post, extra = {}) => evaluate(post, mcfg, { now: NOW, group: 'waitForSale', query: 'steamsale', ...extra });

test('the text of a post is taken from its HTML: paragraphs, hashtags, entities, full links', () => {
  assert.equal(htmlToText(`<p>Should I buy ${hashtag('Hades')} now or wait for a sale?</p><p>Thanks &amp; cheers<br>Dana</p>`), 'Should I buy #Hades now or wait for a sale? Thanks & cheers Dana');
  assert.equal(htmlToText(link('https://store.steampowered.com/app/1145360/Hades/')), 'https://store.steampowered.com/app/1145360/Hades/');
  assert.equal(htmlToText('<p>It&#39;s &quot;fine&quot; &lt;3 &#x1F600; &unknown; &#99999999999;</p>'), 'It\'s "fine" <3 😀 &unknown; &#99999999999;');
  assert.equal(htmlToText('<p><span class="h-card"><a href="https://x.example/@a" class="u-url mention">@<span>a</span></a></span> hi</p>'), '@a hi');
  assert.equal(htmlToText(null), '');
});

test('a Mastodon status becomes the post shape the rules read', () => {
  const p = fromMastodon(status({ id: 555, acct: 'dana@other.example', name: 'Dana :blobcat: P', likes: 4, replies: 2, lang: 'en', html: `<p>Worth it? ${hashtag('Steam')} ${link('https://example.com/review')}</p>` }), HOME);
  assert.equal(p.author.handle, 'dana@other.example');
  assert.equal(p.author.displayName, 'Dana P', 'emoji codes are removed from the name');
  assert.equal(p.webUrl, 'https://mastodon.social/@dana@other.example/555', 'the link opens the post on OUR server, where the owner is logged in');
  assert.equal(p.uri, p.webUrl);
  assert.equal(p.origin, 'https://other.example/@dana/statuses/555', 'the post\'s own page is kept as a second way to open it');
  assert.equal(p.likeCount, 4);
  assert.equal(p.replyCount, 2);
  assert.deepEqual(p.record.langs, ['en']);
  assert.equal(p.record.facets[0].features.length, 1, 'one link: hashtags and @names are not links');
  assert.match(p.record.text, /^Worth it\? #Steam https:\/\/example\.com\/review$/);
  // a person of our own server has no @server in acct, the handle and the link still work
  const local = fromMastodon(status({ id: 556, acct: `neighbour@${HOME}`, url: 'https://mastodon.social/@neighbour/556' }), HOME);
  assert.equal(local.author.handle, `neighbour@${HOME}`);
  assert.equal(local.webUrl, 'https://mastodon.social/@neighbour/556');
  assert.equal(local.origin, undefined, 'a post of our own server has only one address');
  // no language tag: no language claim (the text itself is checked later)
  assert.equal(fromMastodon(status({ lang: null }), HOME).record.langs, undefined);
  // a boost, or nonsense, is not a post
  assert.equal(fromMastodon(status({ reblog: { id: 1 } }), HOME), null);
  assert.equal(fromMastodon(null, HOME), null);
  assert.equal(fromMastodon({ id: '1' }, HOME), null);
  // a reply is marked
  assert.ok(fromMastodon(status({ reply: '123' }), HOME).record.reply);
});

test('pictures, video and link cards are described in a few words', () => {
  assert.equal(describeMastodonMedia(status()), null);
  assert.equal(describeMastodonMedia(status({ media: [{ type: 'image', description: 'Steam page of Hades at 75% off' }] })), 'image: Steam page of Hades at 75% off');
  assert.equal(describeMastodonMedia(status({ media: [{ type: 'image', description: null }] })), 'image, no description');
  assert.equal(describeMastodonMedia(status({ media: [{ type: 'image', description: 'a' }, { type: 'image', description: '' }, { type: 'image', description: 'c' }] })), '3 images: a / c');
  assert.equal(describeMastodonMedia(status({ media: [{ type: 'gifv' }] })), 'video, no description');
  assert.equal(describeMastodonMedia(status({ media: [{ type: 'audio' }] })), 'audio');
  assert.equal(describeMastodonMedia(status({ card: { title: 'Bundle tiers explained' } })), 'link card: Bundle tiers explained');
  assert.ok(describeMastodonMedia(status({ media: [{ type: 'image', description: 'x'.repeat(500) }] })).length < 200);
  const kept = ev(ms({ media: [{ type: 'image', description: '' }] }));
  assert.equal(kept.keep, true, kept.reason);
  assert.equal(kept.candidate.media, 'image, no description');
  assert.equal(ev(ms()).candidate.media, null);
});

test('a real question from a person on another server is kept, with a link that opens on our server', () => {
  const p = ms({ id: 4242, acct: 'dana@other.example' });
  const r = ev(p);
  assert.equal(r.keep, true, r.reason);
  assert.equal(r.candidate.url, 'https://mastodon.social/@dana@other.example/4242');
  assert.equal(r.candidate.origin, 'https://other.example/@dana/statuses/4242');
  assert.equal(r.candidate.handle, 'dana@other.example');
  assert.equal(r.candidate.question, true);
  assert.equal(r.candidate.heated, false);
});

test('Mastodon posts that must be dropped, each with its reason', () => {
  const cases = [
    ['an account marked as a bot', ms({ bot: true }), 'bot, shop or studio'],
    ['a news feed by its name', ms({ acct: 'feed@igeek.example.com', text: 'Should Steam do this? New Steam update is out for Linux and the Deck.' }), 'bot, shop or studio'],
    ['a news site by its server address', ms({ acct: 'editor@gamer-geek-news.com', text: 'Is the Steam Deck worth it for a backlog of games? Our take.' }), 'bot, shop or studio'],
    ['a game developer server', ms({ acct: 'sam@mastodon.gamedev.place', text: 'Should I add co-op to my game on Steam? Thinking about the backlog of ideas.' }), 'bot, shop or studio'],
    ['a bridge from another network', ms({ acct: 'someone.bsky.social@bsky.brid.gy', text: 'Should I buy this on Steam now or wait for a sale? Any tips?' }), 'bot, shop or studio'],
    ['a post behind a content warning', ms({ cw: 'game spoilers', text: 'Should I buy this on Steam now or wait for a sale? Any tips?' }), 'content warning'],
    ['a sensitive post', ms({ sensitive: true }), 'content warning'],
    ['a person who asked not to be found', ms({ noindex: true }), 'hidden from search'],
    ['a profile that says no bots', ms({ note: '<p>Gamer. NO BOTS, no promo.</p>' }), 'profile says no bots or promo'],
    ['a profile with the #nobot hashtag', ms({ note: `<p>Hi! ${hashtag('nobot')}</p>` }), 'profile says no bots or promo'],
    ['a developer promoting a game', ms({ text: 'Wishlist our game on Steam, the demo is out now! #indiedev' }), 'skip word'],
    ['a news post: a link and no question', ms({ html: `<p>Steam client update brings Linux improvements for the Deck. ${link('https://example.com/news/steam')}</p>` }), 'link post, not a question'],
    ['not English by the language tag', ms({ lang: 'de', text: 'Soll ich dieses Spiel auf Steam kaufen oder auf einen Sale warten?' }), 'other language'],
    ['not English by the text (no tag)', ms({ lang: null, text: 'Você já jogou esse jogo na Steam? Qual é o melhor jogo para a sua lista, vale a pena comprar agora?' }), 'other language (text)'],
    ['older than the limit', ms({ age: 40 }), 'too old'],
    ['our own post', ms({ acct: 'saveandplay@mastodon.social' }), 'own post'],
    ['console only', ms({ text: 'Is Mario Kart worth it on Switch 2 or should I wait for a sale on the game?' }), 'console only'],
  ];
  for (const [name, post, reason] of cases) {
    const r = ev(post);
    assert.equal(r.keep, false, name);
    assert.equal(r.reason, reason, name);
  }
});

test('a link is fine when the person asks a question, and hashtags alone are fine', () => {
  const ask = ms({ html: `<p>Is this worth it on Steam or should I wait for a sale? ${link('https://store.steampowered.com/app/1/x')}</p>` });
  assert.equal(ev(ask).keep, true);
  const tagged = ms({ html: `<p>Should I buy this on Steam now or wait for a sale? ${hashtag('Steam')} ${hashtag('PCGaming')} ${hashtag('Gaming')}</p>` });
  assert.equal(ev(tagged).keep, true);
  // the same rules for Bluesky stay as they were: a link post without a question is not dropped by this rule there
  const bsky = commentAccounts('prices')[0].account;
  assert.equal(bsky.skipLinkPosts, undefined);
});

test('a post we already answered is found by its id', () => {
  const p = ms({ id: 8001 });
  assert.equal(ev(p, { ownReplied: new Set(['8001']) }).reason, 'already answered');
  assert.equal(ev(p, { ownReplied: new Set(['8002']) }).keep, true);
});

test('the shown-posts memory of Mastodon and of Bluesky do not mix', () => {
  const root = mkdtempSync(join(tmpdir(), 'shown-m-'));
  mkdirSync(join(root, 'drafts'));
  const w = (name, data) => writeFileSync(join(root, 'drafts', name), JSON.stringify(data));
  w('comments-shown-mastodon-prices-20261013-1000.json', ['https://mastodon.social/@dana@other.example/4242', { url: 'https://mastodon.social/@a/4243' }]);
  w('comments-shown-prices-20261013-1000.json', ['https://bsky.app/profile/a.bsky.social/post/3kaaa']);
  const old = process.env.COMMENTS_ROOT;
  process.env.COMMENTS_ROOT = root;
  return import(`./lib/comments.mjs?shown-m=${Date.now()}`).then((m) => {
    if (old === undefined) delete process.env.COMMENTS_ROOT; else process.env.COMMENTS_ROOT = old;
    assert.deepEqual([...m.loadShown('mastodon-prices')].sort(), ['4242', '4243']);
    assert.deepEqual([...m.loadShown('prices')], ['3kaaa']);
  });
});

test('hashtag queries are understood', () => {
  assert.deepEqual(parseTagQuery('steamdeck'), { tag: 'steamdeck', all: [] });
  assert.deepEqual(parseTagQuery(' #SteamDeck '), { tag: 'SteamDeck', all: [] });
  assert.deepEqual(parseTagQuery('steam+sale'), { tag: 'steam', all: ['sale'] });
  assert.deepEqual(parseTagQuery('jeux_vidéo'), { tag: 'jeux_vidéo', all: [] });
  for (const bad of ['', null, 'two words', 'steam-deck', 'a+b+c+d+e', '+sale', 'steam+', '"wait for a sale"']) assert.equal(parseTagQuery(bad), null, String(bad));
});

test('the Mastodon settings block inherits from Bluesky and adds its own', () => {
  const prices = commentAccounts('prices')[0].account;
  assert.deepEqual(configProblems(mcfg), []);
  assert.equal(mcfg.platform, 'mastodon');
  assert.equal(mcfg.handle, 'saveandplay@mastodon.social');
  assert.equal(mcfg.instance, 'mastodon.social');
  assert.equal(prices.platform, 'bluesky');
  assert.ok(mcfg.skipWords.includes('wishlist'), 'the stop words of the Bluesky block are inherited');
  assert.ok(mcfg.skipWords.includes('#newrelease') && !prices.skipWords.includes('#newrelease'), 'words with a + key are added only here');
  assert.equal(mcfg.skipWords.length, prices.skipWords.length + 4);
  assert.ok(mcfg.skipAuthorWords.includes('feed') && mcfg.skipAuthorWords.includes('bot'));
  assert.deepEqual(mcfg.feeds, [], 'Bluesky feeds are not inherited');
  assert.ok(prices.feeds.length > 0);
  assert.equal(mcfg.passwordEnv, null, 'no password for Mastodon');
  assert.ok(mcfg.broadFlag === undefined);
  for (const g of Object.values(mcfg.groups)) for (const q of g.queries) assert.ok(parseTagQuery(q), `${q} is a hashtag`);
  assert.ok(mcfg.groups.broadPlaying?.broad && mcfg.groups.broadAsk?.broad, 'the broad groups exist here too and can be switched off');
});

test('Mastodon settings with mistakes are reported in plain words', () => {
  assert.match(configProblems({ ...mcfg, handle: 'saveandplay' })[0], /handle must look like name@server/);
  assert.match(configProblems({ ...mcfg, groups: { x: { queries: ['two words'] } } })[0], /group "x": "two words" is not a hashtag/);
  assert.match(configProblems({ ...mcfg, feeds: [{ name: 'f', url: 'x' }] })[0], /feeds work only for Bluesky/);
  assert.match(configProblems({ ...mcfg, platform: 'myspace' })[0], /platform "myspace" is not known/);
  assert.deepEqual(configProblems({ handle: 'x' }), ['passwordEnv is missing (the name of the variable that holds the app password)', 'groups is empty'], 'Bluesky checks are as before');
});

test('an unknown base account or a loop in "extends" is named', () => {
  const root = mkdtempSync(join(tmpdir(), 'extends-'));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'comments-accounts.json'), JSON.stringify({ accounts: { a: { extends: 'b' }, b: { extends: 'a' }, c: { extends: 'nothing' }, d: { handle: 'x@y.zz', platform: 'mastodon' } } }));
  const old = process.env.COMMENTS_ROOT;
  process.env.COMMENTS_ROOT = root;
  return import(`./lib/comments.mjs?extends=${Date.now()}`).then((m) => {
    if (old === undefined) delete process.env.COMMENTS_ROOT; else process.env.COMMENTS_ROOT = old;
    assert.throws(() => m.commentAccounts('a'), /account "a" extends itself/);
    assert.throws(() => m.commentAccounts('c'), /no account "nothing"/);
    assert.throws(() => m.commentAccounts('zzz'), /no account "zzz"/);
    assert.equal(m.commentAccounts('d')[0].account.instance, 'y.zz');
  });
});

// ---- the reader against a fake Mastodon server ------------------------------------------------------------------
async function serve(handler) {
  const calls = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    calls.push({ path: url.pathname, query: url.searchParams, auth: req.headers.authorization ?? null, agent: req.headers['user-agent'] ?? '' });
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    handler(url, send, calls.length);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, calls, base: `http://127.0.0.1:${server.address().port}` };
}

test('the reader asks for the hashtag timeline (both tags for "a+b"), names itself, sends no login, and skips boosts', async () => {
  const { server, calls, base } = await serve((url, send) => send(200, [status({ id: 1 }, Date.now()), status({ id: 2, reblog: { id: 9 } }, Date.now()), status({ id: 3 }, Date.now())]));
  try {
    const api = createMastodonApi({ instance: HOME, base, retryMs: 1 });
    await api.login();
    const posts = await api.search('steam+sale', { limit: 25 });
    assert.deepEqual(posts.map((p) => p.webUrl.split('/').pop()), ['1', '3'], 'the boost is skipped');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/api/v1/timelines/tag/steam');
    assert.equal(calls[0].query.get('limit'), '25');
    assert.deepEqual(calls[0].query.getAll('all[]'), ['sale']);
    assert.equal(calls[0].auth, null);
    assert.match(calls[0].agent, /saveandplay/);
    await assert.rejects(() => api.search('two words'), /not a hashtag/);
    await createMastodonApi({ instance: HOME, base, token: 'tok-123' }).search('steam');
    assert.equal(calls.at(-1).auth, 'Bearer tok-123', 'a token is sent only when the settings give one');
    assert.equal((await api.search('steam', { limit: 500 })).length, 2);
    assert.equal(calls.at(-1).query.get('limit'), '40', 'at most 40 per page (the Mastodon limit)');
  } finally { server.close(); }
});

test('the reader goes through pages and stops at posts older than the limit', async () => {
  const total = 120; // one post every 20 minutes, 40 per page: 13 hours, 26 hours, 40 hours
  const all = Array.from({ length: total }, (_, i) => status({ id: 900 - i, age: (i * 20) / 60 }, Date.now()));
  const { server, calls, base } = await serve((url, send) => {
    const max = url.searchParams.get('max_id');
    const rest = max ? all.filter((s) => Number(s.id) < Number(max)) : all;
    send(200, rest.slice(0, Number(url.searchParams.get('limit'))));
  });
  try {
    const api = createMastodonApi({ instance: HOME, base, retryMs: 1 });
    const since = new Date(Date.now() - 20 * 36e5).toISOString();
    const posts = await api.search('steam', { since, limit: 40, pages: 5 });
    assert.equal(calls.length, 2, 'the second page already reached posts older than 20 hours, so the search stops');
    assert.equal(calls[1].query.get('max_id'), '861', 'the next page starts after the last post of the first');
    assert.equal(posts.length, 80);
    calls.length = 0;
    assert.equal((await api.search('steam', { limit: 40, pages: 1 })).length, 40);
    assert.equal(calls.length, 1);
  } finally { server.close(); }
});

test('our own replies are read from our public posts, and a closed server gets a clear error code', async () => {
  const { server, calls, base } = await serve((url, send) => {
    if (url.pathname === '/api/v1/accounts/lookup') return send(200, { id: '999', acct: url.searchParams.get('acct') });
    if (url.pathname === '/api/v1/accounts/999/statuses') return send(200, [{ id: '5001', in_reply_to_id: '8001' }, { id: '5002', in_reply_to_id: null }, { id: '5003', in_reply_to_id: '8003' }]);
    send(401, { error: 'This API requires an authenticated user' });
  });
  try {
    const api = createMastodonApi({ instance: HOME, base, retryMs: 1 });
    assert.deepEqual([...(await api.ownReplied('saveandplay@mastodon.social'))].sort(), ['8001', '8003']);
    assert.equal(calls[0].query.get('acct'), 'saveandplay', 'only the name is asked, without the server');
    await assert.rejects(() => api.search('steam'), (e) => e.code === 'auth' && /authenticated/.test(e.message));
  } finally { server.close(); }
});

test('a busy server (429) is asked once more, an unreachable one is named', async () => {
  let seen = 0;
  const { server, base } = await serve((url, send) => (++seen === 1 ? send(429, { error: 'Too many requests' }) : send(200, [status({ id: 1 }, Date.now())])));
  try {
    const api = createMastodonApi({ instance: HOME, base, retryMs: 1 });
    assert.equal((await api.search('steam')).length, 1);
    assert.equal(seen, 2);
  } finally { server.close(); }
  await assert.rejects(() => createMastodonApi({ instance: HOME, base, retryMs: 1, timeoutMs: 500 }).search('steam'), (e) => e.code === 'network' && /cannot reach/.test(e.message));
});

// ---- the whole program --------------------------------------------------------------------------------------------
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
function runShow(root, args = []) {
  const script = fileURLToPath(new URL('./comments-show.mjs', import.meta.url));
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script, ...args], { env: { ...process.env, COMMENTS_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}
function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'comments-m-'));
  mkdirSync(join(root, 'data'));
  copyFileSync(file('data', 'comments-accounts.json'), join(root, 'data', 'comments-accounts.json'));
  return root;
}

function fakeMastodon() {
  const t = Date.now();
  const s = (o) => status(o, t);
  const posts = {
    good: s({ id: 7001, acct: 'goodperson@other.example', text: 'Thinking about buying a Steam Deck game for a long flight. Worth it or should I wait for a sale?' }),
    answered: s({ id: 7002, acct: 'answeredperson@other.example', text: 'Should I buy this game on Steam or wait for a sale? Not sure yet.' }),
    bot: s({ id: 7003, acct: 'dealbot@other.example', bot: true, text: 'Should I buy Fallout 4? It is $4.99 on Steam today, a deal on a game.' }),
    news: s({ id: 7004, acct: 'feed@igeek.gamer-geek-news.com', html: `<p>New Steam client update adds Linux improvements ${link('https://igeek.example/steam')}</p>` }),
    cw: s({ id: 7005, acct: 'cwperson@other.example', cw: 'spoilers', text: 'Should I buy this on Steam or wait for a sale? Not sure.' }),
    hidden: s({ id: 7006, acct: 'hiddenperson@other.example', noindex: true, text: 'Should I buy this on Steam or wait for a sale? Not sure.' }),
    nobots: s({ id: 7007, acct: 'nobotsperson@other.example', note: '<p>no bots please</p>', text: 'Should I buy this on Steam or wait for a sale? Not sure.' }),
    ai: s({ id: 7008, acct: 'aiperson@other.example', text: 'Does anyone know if Steam shows which games use generative AI on the store page?' }),
    bridged: s({ id: 7009, acct: 'x.bsky.social@bsky.brid.gy', text: 'Should I buy this on Steam or wait for a sale? Not sure.' }),
    old: s({ id: 7010, acct: 'oldperson@other.example', age: 50, text: 'Should I buy this on Steam or wait for a sale? Not sure.' }),
  };
  return posts;
}

async function startFake({ closed = false } = {}) {
  const posts = fakeMastodon();
  const timeline = Object.values(posts).sort((a, b) => Number(b.id) - Number(a.id));
  const r = await serve((url, send) => {
    if (closed) return send(401, { error: 'This API requires an authenticated user' });
    if (url.pathname === '/api/v1/accounts/lookup') return send(200, { id: '999' });
    if (url.pathname === '/api/v1/accounts/999/statuses') return send(200, [{ id: '5001', in_reply_to_id: posts.answered.id }]);
    if (url.pathname.startsWith('/api/v1/timelines/tag/')) return send(200, timeline);
    send(404, { error: 'Record not found' });
  });
  return { ...r, posts };
}

test('end to end: the list has only the right posts, links open on our server, no login is sent', async () => {
  const { server, calls, base, posts } = await startFake();
  const root = tempRoot();
  const env = { COMMENTS_ROOT: root, MASTODON_API_BASE: base, COMMENTS_RETRY_MS: '1', BSKY_APP_PASSWORD: '' };
  try {
    const r = await runProgram(env, ['--account', 'mastodon-prices']);
    assert.equal(r.code, 0, r.out);
    const md = readFileSync(join(root, 'drafts', 'comments-mastodon-prices.md'), 'utf8');
    assert.match(md, /^# Comment candidates: mastodon-prices \(@saveandplay@mastodon\.social\)/);
    assert.ok(md.includes('https://mastodon.social/@goodperson@other.example/7001'), 'the good post is listed, with a link that opens on our server');
    assert.ok(md.includes('@goodperson@other.example'));
    assert.match(md, /goodperson@other\.example\/7001\n   original: https:\/\/other\.example\/@goodperson\/statuses\/7001\n/, 'the original address of the post is the next line');
    for (const bad of ['answeredperson', 'dealbot', 'gamer-geek-news', 'cwperson', 'hiddenperson', 'nobotsperson', 'brid.gy', 'oldperson']) assert.ok(!md.includes(bad), `${bad} is not listed`);
    assert.match(md, /## Heated topics[\s\S]*aiperson/);
    assert.match(md, /Dropped in this run:.*bot, shop or studio/);
    assert.match(md, /already answered/);
    // what was asked: public timelines of hashtags from the groups, the account lookup, no login, no token
    const tags = [...new Set(calls.filter((c) => c.path.startsWith('/api/v1/timelines/tag/')).map((c) => c.path.split('/').pop()))];
    const wanted = Object.values(mcfg.groups).filter((g) => g.enabled !== false).flatMap((g) => g.queries);
    assert.deepEqual([...tags].sort(), [...new Set(wanted)].sort(), 'every hashtag of every switched-on group (queriesPerGroup), none of the switched-off groups');
    assert.ok(!tags.includes('steamsale') && !tags.includes('humblebundle'), 'the groups switched off on 20 Oct 2026 are not searched');
    assert.ok(calls.every((c) => c.auth === null), 'no login or token is sent');
    assert.ok(calls.every((c) => c.path.startsWith('/api/v1/')));
    assert.ok(existsSync(join(root, 'drafts', 'comments-state-mastodon-prices.json')));
    assert.ok(!existsSync(join(root, 'drafts', 'comments-prices.md')), 'the Bluesky list is not touched');
    // a second run keeps the fresh post
    const r2 = await runProgram(env, ['--account', 'mastodon-prices']);
    assert.equal(r2.code, 0, r2.out);
    assert.ok(readFileSync(join(root, 'drafts', 'comments-mastodon-prices.md'), 'utf8').includes('/7001'));
    const state = JSON.parse(readFileSync(join(root, 'drafts', 'comments-state-mastodon-prices.json'), 'utf8'));
    assert.equal(state.sources.deck.runs, 2 * mcfg.groups.deck.queries.length, "every hashtag of the group is read in every run");
    assert.ok(state.sources.deck.fit >= 2);
    assert.match(r2.out, /Sources so far/);
    // once the owner was shown the post, it never comes back
    writeFileSync(join(root, 'drafts', 'comments-shown-mastodon-prices-20261013-1000.json'), JSON.stringify(['https://mastodon.social/@goodperson@other.example/7001']));
    const r3 = await runProgram(env, ['--account', 'mastodon-prices']);
    assert.equal(r3.code, 0, r3.out);
    assert.ok(!readFileSync(join(root, 'drafts', 'comments-mastodon-prices.md'), 'utf8').includes('/7001'), 'the shown post is gone');
    assert.equal(posts.good.id, '7001');
  } finally { server.close(); }
});

test('the chat step works for Mastodon: shows new posts once, remembers them in its own file', async () => {
  const { server, base } = await startFake();
  const root = tempRoot();
  try {
    const r = await runProgram({ COMMENTS_ROOT: root, MASTODON_API_BASE: base, COMMENTS_RETRY_MS: '1' }, ['--account', 'mastodon-prices']);
    assert.equal(r.code, 0, r.out);
    const out = join(root, 'drafts', 'comments-shown-mastodon-prices-20261013-120000.json');
    const a = await runShow(root, ['--account', 'mastodon-prices', '--limit', '8', '--record-new', out]);
    assert.equal(a.code, 0, a.out);
    assert.ok(a.out.includes('https://mastodon.social/@goodperson@other.example/7001'));
    assert.match(a.out, /REMEMBERED: \d+ posts/);
    assert.ok(JSON.parse(readFileSync(out, 'utf8')).some((x) => x.url.endsWith('/7001')));
    const b = await runShow(root, ['--account', 'mastodon-prices']);
    assert.match(b.out, /NEW POSTS: 0/);
    assert.ok(!b.out.includes('/7001'));
  } finally { server.close(); }
});

test('a server that closes its hashtag timelines gives a plain message and writes no list', async () => {
  const { server, base } = await startFake({ closed: true });
  const root = tempRoot();
  try {
    const r = await runProgram({ COMMENTS_ROOT: root, MASTODON_API_BASE: base, COMMENTS_RETRY_MS: '1' }, ['--account', 'mastodon-prices']);
    assert.equal(r.code, 1);
    assert.match(r.out, /read-only access token/);
    assert.ok(!existsSync(join(root, 'drafts', 'comments-mastodon-prices.md')));
  } finally { server.close(); }
});

test('one account failing does not stop the other: its list is written, the run still ends red', async () => {
  const { server, base } = await startFake();
  const root = tempRoot();
  try {
    // no Bluesky password anywhere: the Bluesky account fails, the Mastodon one must still work
    const r = await runProgram({ COMMENTS_ROOT: root, MASTODON_API_BASE: base, COMMENTS_RETRY_MS: '1', BSKY_APP_PASSWORD: '' });
    assert.equal(r.code, 1, 'the failure is not hidden');
    assert.match(r.out, /no BSKY_APP_PASSWORD/);
    assert.ok(readFileSync(join(root, 'drafts', 'comments-mastodon-prices.md'), 'utf8').includes('/7001'));
    assert.deepEqual(readdirSync(join(root, 'drafts')).filter((f) => f.includes('comments-prices')), [], 'nothing was written for the failed account');
  } finally { server.close(); }
});

test('the secret helper says a Mastodon account needs no secret', async () => {
  const script = fileURLToPath(new URL('./comments-secret.mjs', import.meta.url));
  const root = tempRoot();
  const out = await new Promise((resolve) => {
    const p = spawn(process.execPath, [script, '--account', 'mastodon-prices'], { env: { ...process.env, COMMENTS_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    p.stdout.on('data', (d) => (text += d));
    p.stderr.on('data', (d) => (text += d));
    p.on('close', (code) => resolve({ code, text }));
  });
  assert.equal(out.code, 0, out.text);
  assert.match(out.text, /needs no secret/);
});
