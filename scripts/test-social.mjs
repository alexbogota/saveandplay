// Tests for the "which guides still have no post" check. No internet: a small fake Bluesky and Mastodon server runs on this computer.
//   npm run social:test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mentions, loadGuides, loadSettings, judge, blueskyPosts, mastodonPosts, check, render } from './social-pending.mjs';

const SITE = 'https://saveandplay.com';
const SCRIPT = fileURLToPath(new URL('./social-pending.mjs', import.meta.url));

function makeRoot({ guides = {}, social = {}, accounts = { accounts: { prices: { handle: '@saveandplay.com' } } } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'social-'));
  mkdirSync(join(root, 'src', 'pages', 'guides'), { recursive: true });
  mkdirSync(join(root, 'data'));
  for (const [slug, updated] of Object.entries(guides)) {
    writeFileSync(join(root, 'src', 'pages', 'guides', `${slug}.md`), `---\nlayout: x\ntitle: "Title of ${slug}"\nupdated: ${updated}\n---\n\nText.\n`);
  }
  writeFileSync(join(root, 'src', 'pages', 'guides', 'index.astro'), '---\n---\n');
  writeFileSync(join(root, 'data', 'accounts.json'), JSON.stringify(accounts));
  writeFileSync(join(root, 'data', 'social-check.json'), JSON.stringify(social));
  return root;
}

// a fake server: Bluesky feed pages and a Mastodon account
function fake({ bsky = [], bskyCursorAfter = null, mastodon = [] } = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    seen.push(url.pathname + url.search);
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/xrpc/app.bsky.feed.getAuthorFeed') {
      if (bsky === 'down') return send(500, { error: 'boom' });
      const page = url.searchParams.get('cursor') ? 1 : 0;
      const items = bsky[page] ?? [];
      return send(200, { feed: items, cursor: bsky[page + 1] ? `c${page + 1}` : bskyCursorAfter });
    }
    if (url.pathname === '/api/v1/accounts/lookup') return send(url.searchParams.get('acct') === 'saveandplay' ? 200 : 404, { id: '77' });
    if (url.pathname === '/api/v1/accounts/77/statuses') return send(200, mastodon);
    send(404, {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}
const bskyPost = (text, { facets, embed, createdAt = '2026-10-13T12:00:00Z', handle = 'saveandplay.com', reason } = {}) => ({
  post: { uri: `at://x/app.bsky.feed.post/${Math.random()}`, author: { handle }, record: { text, createdAt, facets }, embed },
  ...(reason ? { reason } : {}),
});
const link = (uri) => [{ features: [{ $type: 'app.bsky.richtext.facet#link', uri }] }];

test('a link to a guide is found in any spelling, and a different guide with the same beginning is not confused', () => {
  const yes = (l, slug = 'how-steam-refunds-work') => mentions(l, SITE, slug);
  assert.ok(yes(['https://saveandplay.com/guides/how-steam-refunds-work/']));
  assert.ok(yes(['https://saveandplay.com/guides/how-steam-refunds-work?utm_source=bluesky']));
  assert.ok(yes(['read: https://saveandplay.com/guides/how-steam-refunds-work and more']));
  assert.ok(yes(['HTTPS://SAVEANDPLAY.COM/guides/how-steam-refunds-work/#top']));
  assert.ok(!yes(['https://saveandplay.com/guides/how-steam-refunds-work-2/']), 'a longer slug is another guide');
  assert.ok(!yes(['saveandplay.com/guides/how-steam-re…']), 'a cut-off text is not a link');
  assert.ok(!yes(['https://other.example/guides/how-steam-refunds-work/']), 'another site');
  assert.ok(!yes(['https://saveandplay.com/deals/gog/x']));
});

test('guides are read from the site files; the index page and ignored guides are left out', () => {
  const root = makeRoot({ guides: { 'b-guide': '2026-10-12', 'a-guide': '2026-10-11', 'old-one': '2026-09-01' }, social: { ignore: ['old-one'] } });
  const s = loadSettings(root);
  assert.equal(s.handle, 'saveandplay.com');
  assert.equal(s.site, 'https://saveandplay.com');
  const g = loadGuides(root, s.ignore);
  assert.deepEqual(g.map((x) => x.slug), ['a-guide', 'b-guide']);
  assert.equal(g[0].title, 'Title of a-guide');
  assert.equal(g[0].updated, '2026-10-11');
});

test('Bluesky: our own posts with a link are read from facets, from the link card and from the text; replies, reposts and strangers are ignored', async () => {
  const { server, base } = await fake({ bsky: [[
    bskyPost('Guide one', { facets: link('https://saveandplay.com/guides/one/?utm_source=bluesky') }),
    bskyPost('Guide two', { embed: { $type: 'app.bsky.embed.external#view', external: { uri: 'https://saveandplay.com/guides/two/' } } }),
    bskyPost('Guide three: https://saveandplay.com/guides/three/'),
    bskyPost('Guide four with a picture and a card', { embed: { media: { external: { uri: 'https://saveandplay.com/guides/four/' } } } }),
    bskyPost('A repost of somebody else', { facets: link('https://saveandplay.com/guides/five/'), reason: { $type: 'app.bsky.feed.defs#reasonRepost' } }),
    bskyPost('Someone else', { facets: link('https://saveandplay.com/guides/six/'), handle: 'other.bsky.social' }),
  ]] });
  process.env.BSKY_PUBLIC_API = base;
  try {
    const feed = await blueskyPosts('saveandplay.com');
    assert.equal(feed.complete, true);
    for (const slug of ['one', 'two', 'three', 'four']) assert.equal(judge({ slug, updated: '2026-10-13' }, feed, SITE).state, 'posted', slug);
    for (const slug of ['five', 'six']) assert.equal(judge({ slug, updated: '2026-10-13' }, feed, SITE).state, 'missing', slug);
  } finally { delete process.env.BSKY_PUBLIC_API; server.close(); }
});

test('a guide older than the part of the feed we could read is "unchecked", not "missing"', async () => {
  const day = (d) => `2026-10-${d}T10:00:00Z`;
  const { server, base } = await fake({ bsky: [[bskyPost('recent', { createdAt: day('13') }), bskyPost('older', { createdAt: day('10') })], [bskyPost('more', { createdAt: day('08') })]], bskyCursorAfter: 'next' });
  process.env.BSKY_PUBLIC_API = base;
  try {
    const feed = await blueskyPosts('saveandplay.com', { pages: 2 });
    assert.equal(feed.complete, false, 'there is still more feed that we did not read');
    assert.equal(judge({ slug: 'x', updated: '2026-10-11' }, feed, SITE).state, 'missing', 'newer than the oldest post we read: it would be there');
    assert.equal(judge({ slug: 'x', updated: '2026-10-01' }, feed, SITE).state, 'unchecked');
    assert.equal(judge({ slug: 'x', updated: null }, feed, SITE).state, 'unchecked', 'no date: no claim');
  } finally { delete process.env.BSKY_PUBLIC_API; server.close(); }
});

test('Mastodon: statuses are read through the account name, links come from the text, the card and the status', async () => {
  const { server, base } = await fake({ mastodon: [
    { id: '3', content: '<p>New guide <a href="https://saveandplay.com/guides/one/" rel="nofollow">saveandplay.com/guides/one/</a></p>', created_at: '2026-10-13T10:00:00Z' },
    { id: '2', content: '<p>No link in the text</p>', card: { url: 'https://saveandplay.com/guides/two/' }, created_at: '2026-10-12T10:00:00Z' },
  ] });
  process.env.MASTODON_API_BASE = base;
  try {
    const feed = await mastodonPosts({ instance: 'mastodon.example', acct: 'saveandplay' });
    assert.equal(judge({ slug: 'one', updated: '2026-10-13' }, feed, SITE).state, 'posted');
    assert.equal(judge({ slug: 'two', updated: '2026-10-12' }, feed, SITE).state, 'posted');
    assert.equal(judge({ slug: 'three', updated: '2026-10-12' }, feed, SITE).state, 'missing');
    await assert.rejects(mastodonPosts({ instance: 'mastodon.example', acct: 'nobody' }), /answered 404/);
  } finally { delete process.env.MASTODON_API_BASE; server.close(); }
});

test('the full check: what is posted, what waits, and what is honestly "not set" or "could not be checked"', async () => {
  const { server, base } = await fake({ bsky: [[bskyPost('Guide a', { facets: link('https://saveandplay.com/guides/a-guide/') })]] });
  process.env.BSKY_PUBLIC_API = base;
  try {
    const root = makeRoot({ guides: { 'a-guide': '2026-10-12', 'b-guide': '2026-10-13' } });
    const res = await check(root);
    assert.deepEqual(res.waiting.map((w) => `${w.slug}@${w.channel}`), ['b-guide@Bluesky']);
    assert.equal(res.waiting[0].url, 'https://saveandplay.com/guides/b-guide/');
    assert.equal(res.channels.Mastodon.state, 'not set');
    const text = render(res);
    assert.match(text, /a-guide \(2026-10-12\): Bluesky posted 2026-10-13, Mastodon not set/);
    assert.match(text, /b-guide .*: Bluesky NOT POSTED, Mastodon not set/);
    assert.match(text, /Mastodon is not checked yet: put the instance and the account name/);
    assert.match(text, /WAITING FOR A POST: b-guide on Bluesky\./);
  } finally { delete process.env.BSKY_PUBLIC_API; server.close(); }
});

test('a feed that cannot be read never makes a guide look unposted', async () => {
  const { server, base } = await fake({ bsky: 'down' });
  process.env.BSKY_PUBLIC_API = base;
  try {
    const res = await check(makeRoot({ guides: { 'a-guide': '2026-10-12' } }));
    assert.equal(res.channels.Bluesky.state, 'error');
    assert.deepEqual(res.waiting, [], 'no claim is made when the feed could not be read');
    const text = render(res);
    assert.match(text, /Bluesky could not be checked/);
    assert.match(text, /Could not check Bluesky: .* answered 500\. Nothing is claimed about it\./);
    assert.match(text, /WAITING FOR A POST: unknown, Bluesky could not be read\. Run it again later\./);
    assert.ok(!/nothing \(every guide/.test(text), 'a feed that could not be read is never reported as "all clear"');
  } finally { delete process.env.BSKY_PUBLIC_API; server.close(); }
});

test('the command line prints the report, and --json prints the same as JSON', async () => {
  const { server, base } = await fake({ bsky: [[bskyPost('Guide a', { facets: link('https://saveandplay.com/guides/a-guide/') })]], mastodon: [] });
  const root = makeRoot({ guides: { 'a-guide': '2026-10-12', 'b-guide': '2026-10-13' }, social: { mastodon: { instance: 'm.example', acct: '@saveandplay@m.example' } } });
  const run = (args) => new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, SOCIAL_ROOT: root, BSKY_PUBLIC_API: base, MASTODON_API_BASE: base } });
    let out = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
  try {
    const r = await run([]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /a-guide .*Bluesky posted .*Mastodon NOT POSTED/, 'Mastodon is checked when the instance and name are set (the "@name@instance" form is understood)');
    assert.match(r.out, /WAITING FOR A POST: a-guide on Mastodon; b-guide on Bluesky; b-guide on Mastodon\./);
    const j = JSON.parse((await run(['--json'])).out);
    assert.equal(j.waiting.length, 3);
    assert.equal(j.guides.length, 2);
  } finally { server.close(); }
});
