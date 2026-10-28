// Tests of the niche accounts (Cozy, Retro, ...) and of "one game, one family of accounts per day". They run offline.
//
//   npm run niche:test
//
// Checked: the facts of a game (GOG catalog, Steam) are read right, the rule "select" lets in only what fits and never guesses
// (a game with no facts or no year does not fit), a bad rule is refused, the facts file is filled only from real answers and cleaned,
// a niche account with nothing that fits says so and posts nothing, two accounts of different families never get the same game on one
// day while accounts of one family may, tags from the facts of the game appear only when the game has them, and the real
// data/accounts.json + data/game-facts.json give Cozy and Retro what the decisions of 15 October say (no Kinguin, GOG-only Retro, no mature games in Cozy).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gogFacts, steamFactsOf, nicheMiss, selectProblems, labelsOf } from './lib/facts.mjs';
import { channelWithDefaults, buildPost, chooseTags } from './lib/posts.mjs';

process.env.DAILY_BRIEF_AS_MODULE = '1';
process.env.ENRICH_AS_MODULE = '1';
process.env.UPDATE_DEALS_AS_MODULE = '1';
const { withDefaults, eligibleDeals, buildBrief, makePosts, takenToday, familyOf, dealId } = await import('./daily-brief.mjs');
const { enrich, needed, prune } = await import('./enrich-facts.mjs');
const { updateGog } = await import('./update-deals.mjs');

const read = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const accountsFile = read('../data/accounts.json');
const links = { site: 'https://saveandplay.com', ...accountsFile.links };
let ran = 0;
const test = async (name, fn) => { await fn(); ran++; console.log(`ok  ${name}`); };

const NOW = Date.parse('2026-10-16T12:00:00Z');
const DAY = '2026-10-16';
const fact = (o = {}) => ({ source: 'gog', year: 2004, genres: ['Adventure'], tags: [], mature: false, at: '2026-10-15', ...o });
const deal = (title, o = {}) => ({ store: 'GOG', title, currency: 'USD', was: 19.99, price: 3.99, discountPct: 80, url: `https://www.gog.com/en/game/${title.toLowerCase().replace(/\W+/g, '_')}`, image: '', checkedAt: '2026-10-16T09:00:00Z', endsAt: '2026-10-25T09:00:00Z', ...o });
const base = { name: 'x', handle: '@x', topic: 'prices', subid: 'x', stores: ['GOG'], minDiscount: 50, dealsWithoutNews: true, maxTopics: 0 };
const run = (account, deals, facts, { state = { top: {} }, id = 'a', accounts } = {}) => {
  const acc = withDefaults(id, account);
  const taken = takenToday({ state, accounts: accounts ?? new Map([[id, acc]]), deals, id, today: DAY });
  return buildBrief({ account: acc, links, deals, history: {}, offered: {}, feeds: new Map(), sources: [], now: NOW, facts, taken });
};

await test('facts of a GOG product: the year it came out, genres and tags, mature from the tags', () => {
  const f = gogFacts({ releaseDate: '2003.12.02', genres: [{ name: 'Action' }, { name: 'Adventure' }], tags: [{ name: 'Classic' }, { name: 'Gore' }] }, '2026-10-15');
  assert.deepEqual(f, { source: 'gog', year: 2003, genres: ['Action', 'Adventure'], tags: ['Classic', 'Gore'], mature: true, at: '2026-10-15' });
  assert.equal(gogFacts({ releaseDate: null, genres: [], tags: [] }, '2026-10-15').year, null, 'no date = no year, nothing guessed');
  assert.equal(gogFacts({ releaseDate: '1994.09.22', tags: [{ name: 'Classic' }] }, 'd').mature, false);
});

await test('facts of a Steam app: the Steam date, the genres, mature from the content descriptors; "coming soon" has no year', () => {
  const f = steamFactsOf({ release_date: { date: 'Oct 22, 2015' }, genres: [{ id: '1', description: 'Action' }, { id: '3', description: 'RPG' }], content_descriptors: { ids: [2, 5] } }, 'd');
  assert.deepEqual([f.source, f.year, f.genres, f.mature], ['steam', 2015, ['Action', 'RPG'], true]);
  assert.equal(steamFactsOf({ release_date: { date: 'Coming soon', coming_soon: true }, genres: [], content_descriptors: { ids: [] } }, 'd').year, null);
  assert.equal(steamFactsOf({ release_date: { date: '12 Mar, 2019' }, genres: [], content_descriptors: { ids: [] } }, 'd').mature, false);
});

await test('the rule: year, anyOf, noneOf, notMature; capitals do not matter', () => {
  const retro = { maxYear: 2007 };
  assert.equal(nicheMiss(fact({ year: 2007 }), retro), '');
  assert.equal(nicheMiss(fact({ year: 2008 }), retro), 'notNiche');
  assert.equal(nicheMiss(fact({ year: 2012 }), { minYear: 2010 }), '');
  assert.equal(nicheMiss(fact({ year: 2009 }), { minYear: 2010 }), 'notNiche');
  const calm = { anyOf: ['City builder', 'Casual'], noneOf: ['Action'], notMature: true };
  assert.equal(nicheMiss(fact({ tags: ['city BUILDER'] }), calm), '');
  assert.equal(nicheMiss(fact({ genres: ['Action'], tags: ['Casual'] }), calm), 'notNiche', 'noneOf wins');
  assert.equal(nicheMiss(fact({ tags: ['Casual'], mature: true }), calm), 'notNiche');
  assert.equal(nicheMiss(fact({ tags: ['Puzzle'] }), calm), 'notNiche', 'none of anyOf');
  assert.deepEqual([...labelsOf(fact({ genres: ['Adventure'], tags: ['Point&Click'] }))], ['adventure', 'point&click']);
});

await test('nothing is guessed: no facts or no year = does not fit; no rule = everything fits', () => {
  assert.equal(nicheMiss(undefined, { maxYear: 2007 }), 'noFacts');
  assert.equal(nicheMiss(fact({ year: null }), { maxYear: 2007 }), 'noFacts');
  assert.equal(nicheMiss(fact({ year: null, tags: ['Casual'] }), { anyOf: ['Casual'] }), '', 'a rule without years does not need a year');
  assert.equal(nicheMiss(undefined, null), '');
});

await test('a bad rule is refused with a clear sentence (empty rule, unknown field, wrong type, minYear above maxYear)', () => {
  assert.deepEqual(selectProblems({ maxYear: 2007, label: 'Retro' }), []);
  assert.match(selectProblems({})[0], /empty/);
  assert.match(selectProblems({ maxYear: 2007, colour: 'red' })[0], /unknown field "colour"/);
  assert.match(selectProblems({ maxYear: '2007' })[0], /maxYear must be a year/);
  assert.match(selectProblems({ anyOf: [] })[0], /anyOf must be a list/);
  assert.match(selectProblems({ minYear: 2010, maxYear: 2000 }).join(), /bigger than maxYear/);
  assert.throws(() => withDefaults('retro', { ...base, select: { maxYear: 'old' } }), /select: maxYear must be a year/);
});

await test('enrich: facts only from real answers; a game the source does not know gets no entry; one failure does not stop the rest', async () => {
  const deals = [deal('Deponia'), deal('Mystery Game'), deal('Broken Game'), deal('Steam Game', { store: 'IndieGala', url: 'https://www.indiegala.com/x', steamId: 42 })];
  const ask = {
    gog: async (d) => {
      if (d.title === 'Broken Game') throw new Error('catalog did not answer');
      return d.title === 'Deponia' ? { releaseDate: '2012.08.01', genres: [{ name: 'Adventure' }], tags: [{ name: 'Funny' }] } : null;
    },
    steam: async (appid) => (appid === 42 ? { release_date: { date: 'Jan 5, 2023' }, genres: [{ description: 'Indie' }], content_descriptors: { ids: [] } } : null),
  };
  const r = await enrich({ deals, facts: {}, nowMs: NOW, ask });
  assert.deepEqual(Object.keys(r.facts).sort(), ['gog-deponia', 'indiegala-steam-game']);
  assert.equal(r.facts['gog-deponia'].year, 2012);
  assert.deepEqual(r.report.unknown, ['Mystery Game (GOG)']);
  assert.match(r.report.problems[0], /Broken Game.*did not answer/);
});

await test('enrich: known entries are not asked again until they are 60 days old; old facts of games that left are removed after 30 days', () => {
  const deals = [deal('Deponia'), deal('Fresh Game')];
  const facts = { 'gog-deponia': fact({ at: '2026-10-01' }), 'gog-old-deal': fact({ at: '2026-08-01' }), 'gog-gone-recently': fact({ at: '2026-10-10' }) };
  assert.deepEqual(needed(deals, facts, NOW).map((d) => d.title), ['Fresh Game']);
  assert.deepEqual(needed(deals, { 'gog-deponia': fact({ at: '2026-07-01' }) }, NOW).map((d) => d.title), ['Deponia', 'Fresh Game']);
  assert.deepEqual(Object.keys(prune(facts, deals, NOW)).sort(), ['gog-deponia', 'gog-gone-recently']);
});

await test('a niche account gets only the games that fit; the others are counted, not posted', () => {
  const deals = [deal('Old One'), deal('New One'), deal('No Facts One')];
  const facts = { 'gog-old-one': fact({ year: 2003 }), 'gog-new-one': fact({ year: 2020 }) };
  const { eligible, left, fit } = eligibleDeals(deals, withDefaults('retro', { ...base, select: { maxYear: 2007 } }), NOW, {}, { facts });
  assert.deepEqual(eligible.map((e) => e.deal.title), ['Old One']);
  assert.deepEqual([fit, left.notNiche, left.noFacts], [1, 1, 1]);
});

await test('nothing fits: the brief says so and the post file says NO POST TODAY, no other game is taken to fill the day', () => {
  const deals = [deal('New One')];
  const brief = run({ ...base, select: { maxYear: 2007, label: 'Retro' }, channels: accountsFile.accounts.retro.channels }, deals, { 'gog-new-one': fact({ year: 2020 }) });
  assert.equal(brief.json.candidates.length, 0);
  assert.match(brief.json.warnings.join(' '), /No game fits the niche today \(0 fit the rule, 1 do not/);
  assert.deepEqual(brief.json.niche, { label: 'Retro', fit: 0, postable: 0 });
  const posts = makePosts({ id: 'retro', account: withDefaults('retro', { ...base, select: { maxYear: 2007 }, channels: { bluesky: accountsFile.accounts.retro.channels.bluesky } }), brief: brief.json, links, now: NOW });
  assert.equal(posts.length, 1);
  assert.match(posts[0].none, /No deal passes the rules today/);
  assert.match(brief.md, /Niche Retro: 0 games fit the rule today/);
});

await test('an account without a rule is not changed: no select, no facts needed', () => {
  const brief = run(base, [deal('Anything')], {});
  assert.equal(brief.json.candidates.length, 1);
  assert.equal(brief.json.niche, undefined);
  assert.doesNotMatch(brief.md, /outside the niche/);
});

await test('one game, one family a day: a second family never gets the game another family took; the same family may', () => {
  const deals = [deal('Shared Game', { discountPct: 90, price: 1.99 }), deal('Second Game', { discountPct: 70, price: 5.99 })];
  const facts = { 'gog-shared-game': fact({ year: 2003 }), 'gog-second-game': fact({ year: 2004 }) };
  const accounts = new Map([
    ['main', withDefaults('main', base)],
    ['retro', withDefaults('retro', { ...base, select: { maxYear: 2007 } })],
    ['mirror', withDefaults('mirror', { ...base, family: 'main' })],
  ]);
  const state = { top: {} };
  const pick = (id) => {
    const b = run(accounts.get(id), deals, facts, { state, id, accounts });
    if (b.top) (state.top[id] ??= {})[b.top.id] = DAY;
    return b.top?.title ?? null;
  };
  assert.equal(pick('main'), 'Shared Game');
  assert.equal(pick('retro'), 'Second Game', 'the best game of the main account is not given to Retro');
  assert.equal(pick('mirror'), 'Shared Game', 'the mirror of the main account (same family) posts the same game on its network');
  assert.equal(familyOf('main', accounts.get('main')), 'main');
  assert.equal(familyOf('mirror', accounts.get('mirror')), 'main');
  const later = run(accounts.get('retro'), deals, facts, { state: { top: { main: { 'gog-shared-game': DAY, 'gog-second-game': DAY } } }, id: 'retro', accounts });
  assert.equal(later.json.candidates.length, 0, 'when everything is taken the account posts nothing');
  assert.match(later.json.warnings.join(' '), /2 were taken by another account today/);
});

await test('a pick of another day does not block a game; a disabled or unknown account does not block it either', () => {
  const deals = [deal('Shared Game')];
  const accounts = new Map([['main', withDefaults('main', base)], ['retro', withDefaults('retro', base)]]);
  const yesterday = { top: { main: { 'gog-shared-game': '2026-10-15' } } };
  assert.equal(takenToday({ state: yesterday, accounts, deals, id: 'retro', today: DAY }).size, 0);
  const ghost = { top: { removed: { 'gog-shared-game': DAY } } };
  assert.equal(takenToday({ state: ghost, accounts, deals, id: 'retro', today: DAY }).size, 0);
});

await test('the same game from two stores counts as one game (Steam number)', () => {
  const deals = [deal('Twin', { steamId: 7 }), deal('Twin', { store: 'IndieGala', steamId: 7, price: 4.5 })];
  const accounts = new Map([['a', withDefaults('a', base)], ['b', withDefaults('b', { ...base, stores: ['GOG', 'IndieGala'] })]]);
  const taken = takenToday({ state: { top: { a: { [dealId(deals[0])]: DAY } } }, accounts, deals, id: 'b', today: DAY });
  assert.deepEqual([...taken], ['steam-7']);
});

await test('factTags: a tag from the facts appears only for a game that has the word; a game without facts gets none', () => {
  const channel = channelWithDefaults('cozy', 'bluesky', { ...accountsFile.accounts.cozy.channels.bluesky, factTags: { 'city builder': 'CityBuilder', cozy: 'CozyGames' }, rotatingTags: [], gameTag: false });
  const c = { title: 'SimCity 4 Deluxe Edition', store: 'GOG', facts: { year: 2003, genres: ['Simulation'], tags: ['City builder'] } };
  assert.deepEqual(chooseTags({ c, channel, day: DAY }).tags, ['GameDeals', 'PCGaming', 'GOG', 'CityBuilder']);
  assert.ok(!chooseTags({ c, channel, day: DAY }).tags.includes('CozyGames'), 'the game is not tagged cozy');
  assert.ok(!chooseTags({ c: { ...c, facts: null }, channel, day: DAY }).tags.includes('CityBuilder'));
  assert.throws(() => channelWithDefaults('x', 'bluesky', { ...accountsFile.accounts.cozy.channels.bluesky, factTags: { a: '#Bad' } }), /not a valid tag/);
});

await test('the real settings: Cozy and Retro are valid, have no Kinguin, Retro takes GOG only, its Mastodon channel waits for an account; mirrors share the family of "prices"', () => {
  const a = accountsFile.accounts;
  for (const id of ['cozy', 'retro']) {
    const acc = withDefaults(id, a[id]);
    assert.ok(acc.select, `${id} has a rule`);
    assert.ok(!acc.stores.includes('Kinguin'), `${id} must not post Kinguin (only prices-kinguin may)`);
    for (const [name, ch] of Object.entries(acc.channels)) channelWithDefaults(id, name, ch);
    assert.ok(acc.subid.startsWith('bluesky-'));
  }
  assert.deepEqual(a.retro.stores, ['GOG']);
  assert.equal(a.retro.enabled, true, 'the Bluesky account of Retro exists (16 October)');
  assert.equal(a.retro.channels.mastodon.enabled, false, 'the Mastodon channel of Retro waits for its account');
  assert.equal(a.retro.channels.bluesky.subid, 'bluesky-retro');
  assert.equal(a.retro.channels.mastodon.subid, 'mastodon-retro');
  assert.equal(a.cozy.channels.bluesky.subid, 'bluesky-cozy');
  assert.equal(a.cozy.enabled, true);
  for (const id of ['nostr', 'lemmy', 'tumblr']) assert.equal(a[id].family, 'prices', `${id} mirrors the main account`);
  for (const id of ['prices-kinguin', 'cozy', 'retro']) assert.equal(a[id].family, undefined, `${id} is its own family`);
  const order = Object.keys(a);
  assert.ok(order.indexOf('prices') < order.indexOf('cozy') && order.indexOf('cozy') < order.indexOf('retro'), 'the order of the file decides who takes a game first');
});

await test('the real data: Retro holds only GOG games from 2007 or earlier, Cozy holds no mature, action or Kinguin games, and every game has facts', () => {
  const deals = read('../data/deals.json');
  const facts = read('../data/game-facts.json');
  const a = accountsFile.accounts;
  const pool = (id) => deals.filter((d) => a[id].stores.includes(d.store) && nicheMiss(facts[dealId(d)], a[id].select) === '');
  const retro = pool('retro');
  const cozy = pool('cozy');
  for (const d of retro) {
    assert.equal(d.store, 'GOG');
    assert.ok(facts[dealId(d)].year <= 2007, d.title);
  }
  for (const d of cozy) {
    const f = facts[dealId(d)];
    assert.ok(!f.mature && !labelsOf(f).has('action') && !labelsOf(f).has('violent'), d.title);
  }
  assert.ok(retro.length >= 1, 'Retro has games today (if this fails after a data update, the sales ended: not a bug)');
  const missing = deals.filter((d) => !facts[dealId(d)]).map((d) => d.title);
  assert.deepEqual(missing, [], 'run npm run facts: these deals have no facts yet');
});

await test('posts for Cozy and Retro: our page, the channel mark, Ad last, no #ad, the numbers of the deal', () => {
  const c = { kind: 'deal', id: 'gog-x', title: 'SimCity 4 Deluxe Edition', store: 'GOG', price: 4.99, was: 19.99, discount: 75, endsAt: '2026-10-25T09:00:00Z', priceCheckedAt: '2026-10-15T10:03:10Z', history: { days: 1, lowest: false }, whyToday: [], discountRank: 3, facts: { year: 2003, genres: ['Simulation'], tags: ['City builder'] } };
  for (const [id, name, mark] of [['cozy', 'bluesky', 'bluesky-cozy'], ['retro', 'bluesky', 'bluesky-retro'], ['retro', 'mastodon', 'mastodon-retro']]) {
    const ch = channelWithDefaults(id, name, accountsFile.accounts[id].channels[name]);
    const p = buildPost({ candidate: c, channel: ch, links, day: DAY });
    assert.ok(p.link.includes(`utm_source=${mark}`) && p.link.startsWith('https://saveandplay.com/deals/gog/'));
    assert.equal(p.text.split('\n').at(-1), 'Ad');
    assert.ok(!/#ad\b/i.test(p.text) && !/cozy/i.test(p.text.replace(p.link, '')) || id === 'cozy');
    assert.ok(p.length <= ch.maxChars);
  }
  const cozy = buildPost({ candidate: c, channel: channelWithDefaults('cozy', 'bluesky', accountsFile.accounts.cozy.channels.bluesky), links, day: DAY });
  assert.ok(cozy.tags.includes('CityBuilder'), 'a city builder gets the tag it deserves');
  assert.ok(!cozy.tags.includes('CozyGames'), 'but not the cozy tag it does not have');
});

await test('repeatSkip: a niche account does not get the same game again within repeatDays, and says how many it left out', () => {
  const deals = [deal('Old One'), deal('Old Two')];
  const facts = { 'gog-old-one': fact({ year: 2003 }), 'gog-old-two': fact({ year: 2004 }) };
  const offered = { 'gog-old-one': '2026-10-14' };
  const acc = (o) => withDefaults('retro', { ...base, select: { maxYear: 2007 }, ...o });
  assert.deepEqual(eligibleDeals(deals, acc({ repeatSkip: true }), NOW, offered, { facts }).eligible.map((e) => e.deal.title), ['Old Two']);
  assert.equal(eligibleDeals(deals, acc({ repeatSkip: true }), NOW, offered, { facts }).left.repeat, 1);
  assert.equal(eligibleDeals(deals, acc({}), NOW, offered, { facts }).eligible.length, 2, 'without repeatSkip the old rule stays (only a penalty)');
  assert.equal(eligibleDeals(deals, acc({ repeatSkip: true }), NOW, { 'gog-old-one': '2026-10-01' }, { facts }).eligible.length, 2, 'after repeatDays the game may come back');
  const real = withDefaults('cozy', accountsFile.accounts.cozy);
  assert.deepEqual([real.repeatSkip, real.minDiscount], [true, 30]);
  assert.equal(withDefaults('retro', accountsFile.accounts.retro).repeatSkip, true);
});

await test('update-deals niche pass: a cheaper, quieter old game that fits Retro is added (status gog-niche); the general rules still keep it out of the normal pass', async () => {
  const product = (slug, title, base, final, o = {}) => ({ id: slug, slug, title, productType: 'game', publishers: ['P'], reviewsCount: 150, reviewsRating: 42, releaseDate: '2003.05.05', genres: [{ name: 'Strategy' }], tags: [{ name: 'Classic' }],
    price: { baseMoney: { amount: String(base), currency: 'USD' }, finalMoney: { amount: String(final), currency: 'USD' }, discount: `-${Math.round((1 - final / base) * 100)}%` }, ...o });
  const products = [
    product('old_cheap', 'Old Cheap Classic', 5.99, 2.99), // retro, 50%, base under 9.99: the general pass never takes it
    product('new_cheap', 'New Cheap Game', 5.99, 2.99, { releaseDate: '2021.01.01' }), // not retro
    product('small_off', 'Barely On Sale', 5.99, 5.09), // 15% off
    product('few_reviews', 'Almost Unknown', 5.99, 2.99, { reviewsCount: 10 }),
  ];
  const get = async (url) => (url.includes('catalog') ? { ok: true, text: JSON.stringify({ products, pages: 1 }) } : { ok: true, text: '<html></html>' });
  const steam = async () => ({ appid: 111, total: 400, pct: 85, descriptors: [] });
  const rules = { gog: { enabled: true, minDiscount: 50, minBase: 9.99, minReviews: 300, minRating: 38, maxNew: 6, maxTotal: 24, maxPerPublisher: 3, maxChecked: 20, catalogPages: 3, keepMinDiscount: 30 },
    gogNiche: { enabled: true, minBase: 4.99, minReviews: 100, minRating: 38, maxNew: 4, maxTotal: 8, maxChecked: 15, catalogPages: 6, steam: { minReviews: 100, minPositive: 75 } },
    steam: { minReviews: 500, minPositive: 80, adultFlags: [1, 3, 4] }, exclude: [] };
  const niches = [{ select: { maxYear: 2007 }, minDiscount: 30 }];
  const r = await updateGog({ deals: [], rules, now: NOW, get, steam, link: null, niches });
  assert.deepEqual(r.out.added, [], 'the general pass added nothing');
  assert.deepEqual(r.out.addedNiche.length, 1);
  assert.match(r.out.addedNiche[0], /Old Cheap Classic: \$2\.99 \(−50%\)/);
  assert.equal(r.deals.length, 1);
  assert.equal(r.deals[0].status, 'gog-niche');
  assert.equal(r.deals[0].steamId, 111);
  // a niche game the Steam check refuses is not added; with no niche accounts nothing changes
  const bad = await updateGog({ deals: [], rules, now: NOW, get, steam: async () => ({ appid: 1, total: 20, pct: 90, descriptors: [] }), link: null, niches });
  assert.equal(bad.deals.length, 0);
  assert.equal(bad.out.skippedNiche.fewReviews, 1);
  assert.equal((await updateGog({ deals: [], rules, now: NOW, get, steam, link: null, niches: [] })).deals.length, 0);
});

console.log(`\n${ran} tests passed.`);
