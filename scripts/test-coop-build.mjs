// Tests of scripts/lib/coop-build.mjs (matching, judging Steam's answer, building and merging entries). Run: npm run coop:test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clean, slugName, ourSlug, hashtagOf, steamFlags, classify, buildEntry, mergeGames, parseHostList, titleOf } from './lib/coop-build.mjs';

const cat = (...ids) => ids.map((id) => ({ id, description: `c${id}` }));
const steam = (over = {}) => ({
  type: 'game', name: 'Test Game™', steam_appid: 111, header_image: 'https://example.test/h.jpg',
  release_date: { coming_soon: false, date: 'Feb 26, 2016' }, genres: [{ description: 'Indie' }, { description: 'RPG' }],
  categories: cat(1, 9, 38), recommendations: { total: 5000 }, ...over,
});

test('names are compared the way the cover script does (case, symbols, apostrophes, "The")', () => {
  assert.equal(clean("Don't Starve Together"), clean(slugName('dont_starve_together')));
  assert.equal(clean('Garry’s Mod'), clean(slugName('garrys_mod')));
  assert.equal(clean('ARK: Survival Ascended'), clean(slugName('ark_survival_ascended')));
  assert.equal(clean('The Forest'), clean(slugName('the_forest')));
  assert.equal(clean('Counter-Strike: Global Offensive'), clean(slugName('counter_strike_global_offensive')));
  assert.notEqual(clean('Grounded 2'), clean(slugName('grounded2'))); // such a game goes to the list for a human answer
  assert.equal(ourSlug('7_days_to_die'), '7-days-to-die');
  assert.equal(titleOf('Test Game™  Deluxe'), 'Test Game Deluxe');
});

test('hashtags: words joined, no apostrophes, none when empty, only digits or too long', () => {
  assert.equal(hashtagOf("Don't Starve Together"), 'DontStarveTogether');
  assert.equal(hashtagOf('7 Days to Die'), '7DaysToDie');
  assert.equal(hashtagOf('2077'), '');
  assert.equal(hashtagOf('!!!'), '');
  assert.equal(hashtagOf('A Very Long Title That Goes On And On Forever'), '');
});

test('Steam flags and the verdict: only a released game with a multiplayer mode and no adult content', () => {
  assert.deepEqual(steamFlags(steam()), { multi: true, coop: true, onlineCoop: true, pvp: false, mmo: false });
  assert.equal(classify(steam()).ok, true);
  assert.match(classify(null).reason, /no details/);
  assert.match(classify(steam({ type: 'dlc' })).reason, /not a game/);
  assert.match(classify(steam({ release_date: { coming_soon: true } })).reason, /not released/);
  assert.match(classify(steam({ categories: cat(2) })).reason, /no multiplayer/); // single-player only
  assert.match(classify(steam({ content_descriptors: { ids: [3] } })).reason, /adult/);
  assert.equal(classify(steam({ content_descriptors: { ids: [2, 5] }, categories: cat(1, 20) })).ok, true); // violence alone does not exclude a game
  assert.equal(classify(steam({ categories: cat(36) })).ok, true); // online PvP only counts as multiplayer
});

test('the entry: facts only from Steam, no marketing text, a link back to the Steam page, the host page path', () => {
  const e = buildEntry({ hostSlug: 'test_game', data: steam(), hostKey: 'survivalServers', pathTemplate: '/services/game_servers/{slug}/', checkedOn: 'October 22, 2026' });
  assert.equal(e.slug, 'test-game');
  assert.equal(e.title, 'Test Game');
  assert.equal(e.auto, true);
  assert.equal(e.hashtag, 'TestGame');
  assert.equal(e.image, 'https://example.test/h.jpg');
  assert.deepEqual(e.hosts, { survivalServers: { path: '/services/game_servers/test_game/', facts: [] } });
  assert.equal(e.facts[0].text, 'Steam lists online co-op for Test Game.');
  assert.ok(e.facts.every((f) => f.url === 'https://store.steampowered.com/app/111/' && f.source === 'Steam store page'));
  assert.ok(e.facts.some((f) => f.text === 'Steam files it under: Indie, RPG.'));
  assert.ok(e.facts.some((f) => f.text === 'Release date on Steam: Feb 26, 2016.'));
  assert.equal(e.popularity, 5000);
  assert.deepEqual(e.posts, []);
  const pvp = buildEntry({ hostSlug: 'x', data: steam({ categories: cat(1, 49, 20), genres: [] }), hostKey: 'h', pathTemplate: '/{slug}/', checkedOn: 'd' });
  assert.equal(pvp.facts[0].text, 'Steam lists PvP and massively multiplayer play for Test Game.');
});

test('merge: hand-made games stay first and untouched; program games follow, most reviewed first; no double slug or Steam number', () => {
  const hand = [{ slug: 'stardew-valley', title: 'Stardew Valley', steamAppId: 413150, posts: ['x'] }];
  const mk = (slug, title, id, popularity) => ({ slug, title, steamAppId: id, popularity, auto: true });
  const merged = mergeGames(
    [...hand, mk('old-auto', 'Old', 1, 1)],
    [mk('b', 'B', 2, 10), mk('a', 'A', 3, 10), mk('top', 'Top', 4, 99), mk('stardew-valley', 'Stardew Valley', 413150, 500), mk('twin', 'Twin', 2, 5)],
  );
  assert.deepEqual(merged.map((g) => g.slug), ['stardew-valley', 'top', 'a', 'b']);
  assert.deepEqual(merged[0], hand[0]);
});

test('the host page: games before the marker are orderable, after it "on the horizon"; a strange page is not trusted', () => {
  const link = (s, t = '') => `<a href="/services/game_servers/${s}/">${t}</a>`;
  const first = Array.from({ length: 25 }, (_, i) => link(`game_${i}`, i === 0 ? 'Game <b>Zero</b>' : 'Order Now')).join('\n');
  const html = `${first}<a href="?sortbyname">name</a>${link('soon_game', 'Soon Game')}${link('game_1')}`;
  const r = parseHostList(html);
  assert.equal(r.games.length, 25);
  assert.deepEqual(r.horizon, ['soon_game', 'game_1']);
  assert.equal(r.names.game_0, 'Game Zero');
  assert.equal(r.names.game_1, undefined); // "Order Now" is not a title
  assert.equal(r.names.soon_game, 'Soon Game');
  assert.equal(parseHostList('<html>blocked</html>'), null);
  assert.equal(parseHostList(`${link('a')}${link('b')}<a href="?sortbyname"></a>`), null); // too few games: the page changed
});
