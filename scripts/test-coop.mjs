// Tests of the "play together" posts (scripts/lib/coop-posts.mjs) and of data/coop-games.json. Run: npm run coop:test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coopPostFor, parseCoopPost, coopProblems, coopHistory, coopSettingsProblems, COOP_DEFAULTS, readCoopGames } from './lib/coop-posts.mjs';
import { graphemes, shortenForPost, MAX_GRAPHEMES } from './lib/bsky-posts.mjs';

const games = [
  { slug: 'farm-a', title: 'Farm A', tags: ['cozy'], hashtag: 'FarmA', posts: ['Farm A line one.', 'Farm A line two.'] },
  { slug: 'mine-b', title: 'Mine B', tags: ['Cozy', 'sandbox'], hashtag: 'MineB', posts: ['Mine B line.'] },
  { slug: 'war-c', title: 'War C', tags: ['shooter'], hashtag: 'WarC', posts: ['War C line.'] },
];
const acc = (coop = {}) => ({
  id: 'cozy', handle: 'cozy.test', settings: { maxDayAge: 1 },
  channel: { utmSource: 'bluesky-cozy', disclosure: 'Ad', coop: { ...COOP_DEFAULTS, enabled: true, anyTags: ['cozy'], everyDays: 2, baseTags: ['CozyGames'], ...coop } },
});
const day = (d) => Date.parse(`2026-10-${String(d).padStart(2, '0')}T15:00:00Z`); // 10:00 in Bogota

test('off or missing settings make no post', () => {
  assert.equal(coopPostFor({ id: 'x', channel: {} }, { games }), null);
  assert.equal(coopPostFor(acc({ enabled: false }), { games }), null);
});

test('the post: text of the game, one link to our page with utm and the day, tags, Ad last', () => {
  const r = coopPostFor(acc(), { games, now: day(23) });
  assert.equal(r.slug, 'farm-a');
  assert.equal(r.link, 'https://saveandplay.com/servers/farm-a/?utm_source=bluesky-cozy&utm_medium=social&utm_campaign=coop-2026-10-23');
  assert.equal(r.text, `Farm A line one.\n\n${r.link}\n\n#CozyGames #FarmA\nAd`);
  assert.equal(r.key, 'cozy|coop-2026-10-23|/servers/farm-a/');
  assert.deepEqual(coopProblems(parseCoopPost(r.text), { acc: acc(), games, now: day(23) }), []);
});

test('only games with a tag of the account (case does not matter), least recently posted first, lines rotate', () => {
  const keys = [];
  const seen = [];
  for (let d = 1; d <= 9; d += 2) {
    const r = coopPostFor(acc(), { games, keys, now: day(d) });
    seen.push(`${r.slug}:${r.text.split('\n')[0]}`);
    keys.push(r.key);
  }
  assert.deepEqual(seen, ['farm-a:Farm A line one.', 'mine-b:Mine B line.', 'farm-a:Farm A line two.', 'mine-b:Mine B line.', 'farm-a:Farm A line one.']);
});

test('everyDays: no second post too soon; today\'s own approved post does not block or change today', () => {
  const first = coopPostFor(acc(), { games, now: day(10) });
  const again = coopPostFor(acc(), { games, keys: [first.key], now: day(10) });
  assert.equal(again.key, first.key); // the same post: post-bluesky then says "already approved"
  assert.match(coopPostFor(acc(), { games, keys: [first.key], now: day(11) }).noPost, /next one is due on 2026-10-12/);
  assert.equal(coopPostFor(acc(), { games, keys: [first.key], now: day(12) }).slug, 'mine-b');
});

test('posts of other accounts do not count', () => {
  assert.deepEqual(coopHistory('cozy', ['retro|coop-2026-10-10|/servers/farm-a/', 'cozy|2026-10-10|/deals/gog/x/']), []);
  assert.equal(coopPostFor(acc(), { games, keys: ['retro|coop-2026-10-10|/servers/farm-a/'], now: day(10) }).slug, 'farm-a');
});

test('no game with the tags: NO POST with the reason', () => {
  assert.match(coopPostFor(acc({ anyTags: ['retro'] }), { games, now: day(10) }).noPost, /no game/);
});

test('the checks of the sender refuse a changed or old text', () => {
  const r = coopPostFor(acc(), { games, now: day(23) });
  const p = (text, now = day(23)) => coopProblems(parseCoopPost(text), { acc: acc(), games, now });
  assert.match(p(r.text.replace(/\nAd$/, '')).join(' '), /last line must be "Ad"/);
  assert.match(p(`${r.text.replace('Ad', '')} https://example.com\nAd`).join(' '), /exactly one link/);
  assert.match(p(r.text.replace('Farm A line one.', 'Only $4.99!')).join(' '), /no prices/);
  assert.match(p(r.text, day(26)).join(' '), /too old/);
  assert.match(coopProblems(parseCoopPost(r.text), { acc: acc(), games: games.slice(1), now: day(23) }).join(' '), /not in data\/coop-games\.json/);
});

test('settings problems are named', () => {
  assert.deepEqual(coopSettingsProblems({ ...COOP_DEFAULTS, anyTags: ['cozy'] }), []);
  assert.equal(coopSettingsProblems({ ...COOP_DEFAULTS, anyTags: [], everyDays: 0, template: ['{text}'] }).length, 3);
});

test('data/coop-games.json: every game is complete and every ready post fits Bluesky for every account that would take it', () => {
  const real = readCoopGames();
  assert.ok(real.length > 0);
  const accounts = JSON.parse(readFileSync(new URL('../data/accounts.json', import.meta.url), 'utf8')).accounts;
  const slugs = new Set();
  for (const g of real) {
    for (const k of ['slug', 'title', 'hashtag', 'image', 'checkedOn', 'intro']) assert.ok(g[k], `${g.slug}: ${k} is missing`);
    assert.match(g.slug, /^[a-z0-9-]+$/);
    assert.ok(!slugs.has(g.slug), `${g.slug} twice`); slugs.add(g.slug);
    assert.match(g.image, /^https:\/\//);
    assert.ok(g.facts.length && g.facts.every((f) => f.text && f.source && /^https:\/\//.test(f.url)), `${g.slug}: facts need text, source and url`);
    assert.ok(Object.keys(g.hosts).length, `${g.slug}: no host`);
    assert.ok(g.posts.length, `${g.slug}: no posts`);
    for (const line of g.posts) assert.ok(!/\$\d|https?:|#|lowest/i.test(line), `${g.slug}: a post line has a price, a link, a tag or "lowest": ${line}`);
  }
  for (const [id, a] of Object.entries(accounts)) {
    const coop = a.channels?.bluesky?.coop;
    if (!coop) continue;
    const ac = { id, settings: { maxDayAge: 1 }, channel: { ...a.channels.bluesky, coop: { ...coop, enabled: true } } };
    for (const g of real.filter((x) => x.tags.some((t) => coop.anyTags.includes(t)))) {
      g.posts.forEach((_, i) => {
        const keys = Array.from({ length: i }, (_, k) => `${id}|coop-2026-01-${String(k + 1).padStart(2, '0')}|/servers/${g.slug}/`);
        const r = coopPostFor(ac, { games: [g], keys, now: day(23) });
        const shown = shortenForPost(r.text, r.link);
        assert.ok(graphemes(shown) <= MAX_GRAPHEMES, `${id} ${g.slug} post ${i + 1}: ${graphemes(shown)} characters`);
        assert.deepEqual(coopProblems(parseCoopPost(r.text), { acc: ac, games: real, now: day(23) }), [], `${id} ${g.slug} post ${i + 1}`);
      });
    }
  }
});
