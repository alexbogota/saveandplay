// Tests of the ready posts (scripts/lib/posts.mjs and makePosts in scripts/daily-brief.mjs). They run offline.
//
//   npm run posts:test
//
// Checked: the text and the numbers, the link (our page, marks of the channel), the disclosure line ("Ad") last and counted in the limit,
// no #ad tag, the tags (base, store, niche, the tag of the game, the rotation by the day), the limit of characters (and a long title),
// "Lowest price we've tracked" only when the history says so and only after minHistoryDays, no post when there is no deal,
// a broken template is reported and never produces a post, a new channel needs only a block in the settings,
// the real data/accounts.json is valid.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { channelWithDefaults, buildPost, chooseTags, gameTag, formatDate, graphemes, savingsInCents, noteOf } from './lib/posts.mjs';
import { collectTags, gameTagsOf, summarizeHistory } from './lib/tag-stats.mjs';

process.env.DAILY_BRIEF_AS_MODULE = '1';
process.env.UPDATE_DEALS_AS_MODULE = '1';
const { makePosts, withDefaults, historyFacts, buildCandidates } = await import('./daily-brief.mjs');
const { mergeIndieGala } = await import('./update-deals.mjs');

const links = { site: 'https://saveandplay.com' };
const accounts = JSON.parse(readFileSync(fileURLToPath(new URL('../data/accounts.json', import.meta.url)), 'utf8')).accounts;
const bluesky = channelWithDefaults('prices', 'bluesky', accounts.prices.channels.bluesky);
const mastodon = channelWithDefaults('prices', 'mastodon', accounts.prices.channels.mastodon);

const deal = {
  id: 'indiegala-control-ultimate-edition', kind: 'deal', title: 'Control Ultimate Edition', store: 'IndieGala',
  price: 5.99, was: 39.99, discount: 85, endsAt: '2026-10-08T23:59:00Z', priceCheckedAt: '2026-10-07T09:49:09.029Z',
  history: { days: 5, lowest: false }, whyToday: ['sale ends in 36 h', 'deepest-discount rank 10 of 38'], discountRank: 10,
};
const gog = {
  id: 'gog-shadow-tactics-blades-of-the-shogun', kind: 'deal', title: 'Shadow Tactics: Blades of the Shogun', store: 'GOG',
  price: 3.99, was: 39.99, discount: 90, endsAt: '2026-10-18T06:59:00Z', priceCheckedAt: '2026-10-08T09:48:00Z',
  history: { days: 3, lowest: false }, whyToday: ['deepest-discount rank 6 of 32'], discountRank: 6,
};
const day = '2026-10-08'; // day number 20734: 20734 % 3 = 1 (Gaming) for Bluesky; Mastodon pool of 3 as well
let ran = 0;
const test = (name, fn) => { fn(); ran++; console.log(`ok  ${name}`); };
const tagsOf = (text) => text.split('\n').at(-2).split(' ');

test('text: only the numbers of the deal, dates by the channel format, disclosure last', () => {
  const p = buildPost({ candidate: deal, channel: bluesky, links, day });
  assert.equal(p.text, [
    'Control Ultimate Edition: -85% at IndieGala\n$5.99 (was $39.99)\nPrice checked Oct 7. Sale ends Oct 8.',
    'https://saveandplay.com/deals/indiegala/control-ultimate-edition/?utm_source=bluesky-prices&utm_medium=social&utm_campaign=deals-2026-10-08',
    '#PCGaming #GameDeals #Gaming\nAd',
  ].join('\n\n'));
  assert.ok(p.length <= 300);
});

test('the disclosure is the plain last line, never a hashtag; no #ad anywhere', () => {
  for (const ch of [bluesky, mastodon]) {
    for (const d of [deal, gog]) {
      for (const n of [8, 9, 10, 11, 12]) {
        const p = buildPost({ candidate: d, channel: ch, links, day: `2026-10-${String(n).padStart(2, '0')}` });
        assert.equal(p.text.split('\n').at(-1), 'Ad');
        assert.ok(!/#ad\b/i.test(p.text));
      }
    }
  }
  assert.throws(() => channelWithDefaults('x', 'c', { ...accounts.prices.channels.bluesky, disclosure: '#ad' }), /not a hashtag/);
  assert.throws(() => channelWithDefaults('x', 'c', { ...accounts.prices.channels.bluesky, disclosure: undefined }), /lacks: disclosure/);
});

test('the characters of the disclosure line count in the limit', () => {
  const longer = channelWithDefaults('x', 'c', { ...accounts.prices.channels.bluesky, disclosure: 'Ad: affiliate links, we may earn a commission' });
  const a = buildPost({ candidate: deal, channel: bluesky, links, day });
  const b = buildPost({ candidate: deal, channel: longer, links, day });
  assert.equal(b.length - a.length, graphemes('Ad: affiliate links, we may earn a commission') - graphemes('Ad'));
});

test('the link is our page of the game, never a store; the marks belong to the channel', () => {
  const b = buildPost({ candidate: deal, channel: bluesky, links, day });
  const m = buildPost({ candidate: deal, channel: mastodon, links, day });
  assert.ok(b.link.startsWith('https://saveandplay.com/deals/indiegala/control-ultimate-edition/?utm_source=bluesky-prices&utm_medium=social&utm_campaign=deals-2026-10-08'));
  assert.ok(m.link.includes('utm_source=mastodon-prices'));
  for (const t of [b.text, m.text]) assert.ok(!/gog\.com|qwpeg|indiegala\.com|admitad|steampowered/i.test(t));
});

test('game tag: the part before ":", letters and digits, CamelCase, 4 to 25 characters', () => {
  assert.equal(gameTag('Shadow Tactics: Blades of the Shogun'), 'ShadowTactics');
  assert.equal(gameTag('MONSTER HUNTER RISE'), 'MonsterHunterRise');
  assert.equal(gameTag('LEGO® Star Wars™:The Skywalker Saga Deluxe Edition'), 'LegoStarWars');
  assert.equal(gameTag("Assassin's Creed"), 'AssassinsCreed');
  assert.equal(gameTag('No Man’s Sky'), 'NoMansSky');
  assert.equal(gameTag('Hades II'), 'HadesII');
  assert.equal(gameTag('Control Ultimate Edition'), 'ControlUltimateEdition'); // 22 characters
  assert.equal(gameTag('Deponia'), 'Deponia');
  assert.equal(gameTag('Sifu'), 'Sifu', 'four characters is the shortest');
  assert.equal(gameTag('Go'), null, 'too short');
  assert.equal(gameTag('The Extremely Long Title Of A Game: Part 2'), null, 'too long (more than 25)');
  assert.equal(gameTag('1234'), null, 'no letter');
  assert.equal(gameTag('神之天平'), null, 'no letters or digits we can use');
});

test('Bluesky tags: PCGaming GameDeals and a third one by the day: store, Gaming, game (rotation, not random)', () => {
  const third = (d, n) => chooseTags({ c: d, channel: bluesky, day: `2026-10-${String(n).padStart(2, '0')}` }).tags;
  const seq = [8, 9, 10, 11, 12, 13].map((n) => third(gog, n).at(-1));
  assert.deepEqual(seq, ['Gaming', 'ShadowTactics', 'GOG', 'Gaming', 'ShadowTactics', 'GOG']);
  for (const n of [8, 9, 10]) assert.deepEqual(third(gog, n).slice(0, 2), ['PCGaming', 'GameDeals']);
  assert.deepEqual(third(gog, 9), third(gog, 9), 'the same day gives the same tags');
  for (const n of [8, 9, 10, 11]) assert.ok(third(gog, n).length <= 3);
  // a game with no usable tag: the rotation goes on to the next tag of the pool
  const none = { ...gog, title: 'Go' };
  assert.deepEqual([8, 9, 10, 11].map((n) => third(none, n).at(-1)), ['Gaming', 'GOG', 'GOG', 'Gaming']);
});

test('Mastodon tags: GameDeals PCGaming, store, niche and one by the day: game, Gaming, VideoGames; at most 5', () => {
  const tags = (d, n) => chooseTags({ c: d, channel: mastodon, day: `2026-10-${String(n).padStart(2, '0')}` }).tags;
  assert.deepEqual([8, 9, 10].map((n) => tags(gog, n)), [
    ['GameDeals', 'PCGaming', 'GOG', 'DRMFree', 'Gaming'],
    ['GameDeals', 'PCGaming', 'GOG', 'DRMFree', 'VideoGames'],
    ['GameDeals', 'PCGaming', 'GOG', 'DRMFree', 'ShadowTactics'],
  ]);
  assert.deepEqual(tags(deal, 8).slice(2, 4), ['IndieGala', 'IndieGames']);
  for (const n of [8, 9, 10, 11, 12, 13]) assert.ok(tags(deal, n).length <= 5);
  const small = channelWithDefaults('x', 'c', { ...accounts.prices.channels.mastodon, maxTags: 4 });
  assert.equal(chooseTags({ c: gog, channel: small, day: '2026-10-08' }).tags.length, 4, 'maxTags cuts the rotating tag first');
});

test('every tag is CamelCase (starts with a capital letter, letters and digits only)', () => {
  for (const ch of [bluesky, mastodon]) {
    for (const d of [deal, gog, { ...gog, title: 'MONSTER HUNTER RISE', store: 'IndieGala' }]) {
      for (let n = 1; n <= 30; n++) for (const t of chooseTags({ c: d, channel: ch, day: `2026-10-${String(n).padStart(2, '0')}` }).tags) assert.match(t, /^[A-Z0-9][A-Za-z0-9]+$/);
    }
  }
  assert.throws(() => channelWithDefaults('x', 'c', { ...accounts.prices.channels.bluesky, baseTags: ['pcgaming'] }), /not a valid tag/);
  assert.throws(() => channelWithDefaults('x', 'c', { ...accounts.prices.channels.bluesky, baseTags: ['PC Gaming'] }), /not a valid tag/);
  assert.throws(() => channelWithDefaults('x', 'c', { ...accounts.prices.channels.bluesky, rotatingTags: ['{shop}'] }), /unknown/);
});

test('a duplicate tag is not written twice (the store is also the base tag)', () => {
  const ch = channelWithDefaults('x', 'c', { ...accounts.prices.channels.bluesky, storeTags: { GOG: 'GameDeals' } });
  for (let n = 1; n <= 6; n++) {
    const tags = chooseTags({ c: gog, channel: ch, day: `2026-10-0${n}` }).tags.map((t) => t.toLowerCase());
    assert.equal(new Set(tags).size, tags.length);
  }
});

test('"Lowest price we\'ve tracked" only when the history says so; never "lowest ever"', () => {
  assert.ok(!buildPost({ candidate: deal, channel: bluesky, links, day }).text.includes('Lowest price'));
  const low = buildPost({ candidate: { ...deal, history: { days: 14, lowest: true } }, channel: bluesky, links, day });
  assert.ok(low.text.includes("Price checked Oct 7. Sale ends Oct 8. Lowest price we've tracked."));
  assert.throws(() => buildPost({ candidate: { ...deal, title: 'Lowest price ever' }, channel: bluesky, links, day }), /record low/);
});

test('minHistoryDays: the lowest-price claim only after enough days of history', () => {
  const rows = (n, price) => Array.from({ length: n }, (_, i) => ({ date: `2026-09-${String(10 + i).padStart(2, '0')}`, price }));
  assert.equal(accounts.prices.minHistoryDays, 14);
  const { minHistoryDays: _omitted, ...withoutSetting } = accounts.prices;
  assert.equal(withDefaults('x', withoutSetting).minHistoryDays, 14, 'an account without the setting gets 14');
  assert.equal(historyFacts(rows(13, 9.99), 5.99, '2026-10-08', 14).lowest, false, '13 days is not enough');
  assert.equal(historyFacts(rows(14, 9.99), 5.99, '2026-10-08', 14).lowest, true, '14 days is enough');
  assert.equal(historyFacts(rows(14, 4.99), 5.99, '2026-10-08', 14).lowest, false, 'a lower earlier price: not the lowest');
  assert.equal(historyFacts(rows(5, 9.99), 5.99, '2026-10-08', 3).lowest, true, 'the limit is the one of the account');
  assert.equal(historyFacts(rows(13, 9.99), 5.99, '2026-10-08', 14).days, 13);
});

test('no end date: no "Sale ends"', () => {
  const p = buildPost({ candidate: { ...deal, endsAt: null }, channel: bluesky, links, day });
  assert.ok(p.text.includes('Price checked Oct 7.\n') && !p.text.includes('Sale ends'));
});

test('a very long title is shortened to fit, and the post says so', () => {
  const title = 'The Extremely Long Game Title: Remastered Special Anniversary Collector\'s Gold Edition With All Seasons And Every Single Expansion Pack Ever Released Plus More And Even More Bonus Content For Everyone Who Plays';
  const p = buildPost({ candidate: { ...deal, title }, channel: bluesky, links, day });
  assert.ok(p.length <= 300 && p.text.includes('…') && p.warnings.length === 1);
  assert.equal(p.text.split('\n').at(-1), 'Ad');
});

test('the length counts the link as linkChars and counts characters as a person sees them', () => {
  assert.equal(graphemes('a👍🏽b'), 3);
  const p = buildPost({ candidate: deal, channel: bluesky, links, day });
  assert.equal(p.length, graphemes(p.text.replace(p.link, '')) + 25);
});

test('a template without {tags}, {link} or {disclosure}, with {disclosure} not last, a wrong placeholder or no maxTags is refused', () => {
  const base = accounts.prices.channels.bluesky;
  assert.throws(() => channelWithDefaults('x', 'c', { ...base, template: ['{title}', '{link}', '{disclosure}'] }), /needs \{tags\}/);
  assert.throws(() => channelWithDefaults('x', 'c', { ...base, template: ['{title}', '{tags}\n{disclosure}'] }), /needs \{link\}/);
  assert.throws(() => channelWithDefaults('x', 'c', { ...base, template: ['{title}', '{link}', '{tags}'] }), /needs \{disclosure\}/);
  assert.throws(() => channelWithDefaults('x', 'c', { ...base, template: ['{disclosure}', '{title}', '{link}', '{tags}'] }), /must be the last line/);
  assert.throws(() => channelWithDefaults('x', 'c', { ...base, template: ['{titel}', '{link}', '{tags}\n{disclosure}'] }), /\{titel\}/);
  assert.throws(() => channelWithDefaults('x', 'c', { ...base, maxTags: undefined }), /lacks: maxTags/);
  assert.throws(() => channelWithDefaults('x', 'c', { ...base, maxChars: undefined }), /lacks: maxChars/);
});

test('an incomplete deal is refused, nothing is invented', () => {
  for (const broken of [{ price: NaN }, { priceCheckedAt: null }, { title: '' }, { was: undefined }, { kind: 'news' }]) {
    assert.throws(() => buildPost({ candidate: { ...deal, ...broken }, channel: bluesky, links, day }));
  }
});

test('dates', () => {
  assert.equal(formatDate('2026-10-08T23:59:00Z', 'MMM D'), 'Oct 8');
  assert.equal(formatDate('2026-01-05T00:00:00Z', 'DD.MM.YYYY'), '05.01.2026');
});

test('makePosts: one post per channel, same deal; no channels = nothing (Nostr); no deal = "none" with the reason', () => {
  const account = withDefaults('prices', accounts.prices);
  const posts = makePosts({ id: 'prices', account, brief: { candidates: [deal], warnings: [] }, links, now: Date.parse('2026-10-08T12:00:00Z') });
  assert.deepEqual(posts.map((p) => p.channel), ['bluesky', 'mastodon']);
  assert.ok(posts.every((p) => p.deal === deal.id && !p.none));
  assert.deepEqual(makePosts({ id: 'nostr', account: withDefaults('nostr', accounts.nostr), brief: { candidates: [deal], warnings: [] }, links, now: 0 }), []);
  const none = makePosts({ id: 'prices', account, brief: { candidates: [], warnings: ['Prices are old.'] }, links, now: 0 });
  assert.ok(none.every((p) => p.none.startsWith('No deal passes the rules today.') && p.expected));
  const off = makePosts({ id: 'prices', account: { ...account, channels: { bluesky: { ...account.channels.bluesky, enabled: false }, mastodon: account.channels.mastodon } }, brief: { candidates: [deal], warnings: [] }, links, now: Date.parse('2026-10-08T12:00:00Z') });
  assert.deepEqual(off.map((p) => p.channel), ['mastodon']);
});

test('a broken channel gives "none" with the reason, the other channel still works', () => {
  const account = withDefaults('prices', { ...accounts.prices, channels: { bluesky: { ...accounts.prices.channels.bluesky, template: ['{link}'] }, mastodon: accounts.prices.channels.mastodon } });
  const posts = makePosts({ id: 'prices', account, brief: { candidates: [deal], warnings: [] }, links, now: Date.parse('2026-10-08T12:00:00Z') });
  assert.ok(posts[0].none && !posts[0].expected && /needs \{tags\}/.test(posts[0].none));
  assert.ok(!posts[1].none);
});

test('a new channel is only a block in the settings (no code change)', () => {
  const threads = { enabled: true, subid: 'threads-prices', maxChars: 500, disclosure: 'Ad', baseTags: ['PCGaming'], maxTags: 2, template: ['{title}: -{discount}%', '{link}', '{tags}\n{disclosure}'] };
  const p = buildPost({ candidate: deal, channel: channelWithDefaults('prices', 'threads', threads), links, day });
  assert.ok(p.link.includes('utm_source=threads-prices') && p.text.endsWith('#PCGaming\nAd'));
});

test('tag research: the tags of accounts.json are collected, the statistics are only what the server said', () => {
  const tags = collectTags(accounts).map((t) => t.tag);
  assert.deepEqual(tags, ['DRMFree', 'GameDeals', 'Gaming', 'GOG', 'IndieGala', 'IndieGames', 'PCGaming', 'VideoGames']);
  assert.ok(collectTags(accounts).find((t) => t.tag === 'GameDeals').where.length === 2, 'used by both channels');
  assert.deepEqual(gameTagsOf([{ title: 'Shadow Tactics: Blades' }, { title: 'Go' }, { title: 'Shadow Tactics 2' }]).map((t) => t.tag), ['ShadowTactics', 'ShadowTactics2']);
  const now = Date.parse('2026-10-09T10:00:00Z');
  const day = (iso, uses, accounts) => ({ day: String(Date.parse(iso) / 1000), uses: String(uses), accounts: String(accounts) });
  const history = [day('2026-10-09T00:00:00Z', 5, 3), day('2026-10-08T00:00:00Z', 124, 30), day('2026-10-07T00:00:00Z', 120, 31), day('2026-10-06T00:00:00Z', 92, 28)];
  assert.deepEqual(summarizeHistory(history, now), { days: 3, uses: 336, avgUses: 112, lastDay: { date: '2026-10-08', uses: 124, accounts: 30 }, maxAccounts: 31 }, 'today (not over) is left out');
  assert.deepEqual(summarizeHistory([], now), { days: 0, uses: 0, avgUses: 0, lastDay: null, maxAccounts: 0 });
  assert.equal(summarizeHistory(undefined, now), null, 'no history in the answer: no numbers');
  assert.equal(summarizeHistory([{ day: 'x', uses: 'y', accounts: 'z' }], now).days, 0, 'garbage is not counted');
});

test('Mastodon: "You save $X" (old price minus price) and the note of the store (GOG: DRM-free, IndieGala: by its drminfo); Bluesky has neither', () => {
  const g = buildPost({ candidate: gog, channel: mastodon, links, day });
  assert.ok(g.text.startsWith('Shadow Tactics: Blades of the Shogun: -90% at GOG\n$3.99 (was $39.99)\nYou save $36.00\nDRM-free\nPrice checked Oct 8. Sale ends Oct 18.\n'));
  const i = buildPost({ candidate: deal, channel: mastodon, links, day });
  assert.ok(i.text.startsWith('Control Ultimate Edition: -85% at IndieGala\n$5.99 (was $39.99)\nYou save $34.00\nPrice checked Oct 7.'), 'IndieGala without drminfo in the data: no note');
  assert.ok(!i.text.includes('Steam key') && !i.text.includes('DRM-free'));
  for (const d of [gog, deal]) {
    const b = buildPost({ candidate: d, channel: bluesky, links, day });
    assert.ok(!/You save|DRM-free|Steam key/.test(b.text), 'Bluesky is not changed: little room');
  }
  assert.equal(g.text.split('\n').at(-1), 'Ad');
});

test('the saving is counted in cents from the prices of the deal', () => {
  const c = (price, was) => ({ price, was });
  assert.equal(savingsInCents(c(5.99, 39.99)), 3400);
  assert.equal(savingsInCents(c(8.09, 59.99)), 5190);
  assert.equal(savingsInCents(c(0.99, 9.99)), 900);
  assert.equal(savingsInCents(c(0.1, 0.3)), 20, 'no float noise (0.3 - 0.1 is 0.19999999999999998 as floats)');
  assert.equal(savingsInCents(c(9.99, 9.99)), 0);
  assert.equal(savingsInCents(c(12, 9.99)), 0, 'a price above the old price saves nothing');
  const none = buildPost({ candidate: { ...gog, price: 39.99 }, channel: mastodon, links, day });
  assert.ok(!none.text.includes('You save'), 'nothing to save: no line');
  assert.ok(buildPost({ candidate: { ...gog, price: 8.09, was: 59.99 }, channel: mastodon, links, day }).text.includes('You save $51.90\n'));
});

test('no note for a store that is not in storeNote: no line, no empty line', () => {
  const p = buildPost({ candidate: { ...gog, store: 'Humble' }, channel: mastodon, links, day });
  assert.ok(p.text.includes('$3.99 (was $39.99)\nYou save $36.00\nPrice checked'));
});

test('the amounts check: the computed saving is allowed, invented amounts still stop the build', () => {
  const withNote = (store, note) => channelWithDefaults('x', 'c', { ...accounts.prices.channels.mastodon, storeNote: { [store]: note } });
  // an invented amount in the note of the store
  assert.throws(() => buildPost({ candidate: gog, channel: withNote('GOG', 'Save $50.00 more at the checkout'), links, day }), /not a price of the deal: \$50/);
  // the saving is allowed only when it IS the saving: this one is a different amount
  assert.throws(() => buildPost({ candidate: gog, channel: withNote('GOG', 'You save $35.00'), links, day }), /\$35/);
  // the amount that equals the real saving is fine, even written by hand in a note
  assert.ok(buildPost({ candidate: gog, channel: withNote('GOG', 'Worth $36.00 less'), links, day }).text.includes('Worth $36.00 less'));
  // a channel without the savings line does not get the saving allowed
  const noSavings = channelWithDefaults('x', 'c', { ...accounts.prices.channels.mastodon, savings: undefined, storeNote: { GOG: 'Worth $36.00 less' } });
  assert.throws(() => buildPost({ candidate: gog, channel: noSavings, links, day }), /\$36/);
  // the title of a game may hold an amount of its own; it is not a price of the post
  assert.ok(buildPost({ candidate: { ...gog, title: 'Sam & Max: $99.99 Quest' }, channel: mastodon, links, day }).text.includes('$99.99 Quest'));
});

test('savings and storeNote: bad settings are refused', () => {
  const base = accounts.prices.channels.mastodon;
  assert.throws(() => channelWithDefaults('x', 'c', { ...base, savings: 'You save a lot' }), /\{amount\}/);
  assert.throws(() => channelWithDefaults('x', 'c', { ...base, savings: 'You save {amount} #deal' }), /one line of plain text/);
  assert.throws(() => channelWithDefaults('x', 'c', { ...base, storeNote: { GOG: 'two\nlines' } }), /storeNote of GOG/);
  assert.throws(() => channelWithDefaults('x', 'c', { ...base, storeNote: { GOG: '#DRMFree' } }), /storeNote of GOG/);
  assert.equal(channelWithDefaults('x', 'c', { ...base, savings: undefined, storeNote: undefined }).savings, '', 'both are optional');
  const noLines = channelWithDefaults('x', 'c', { ...base, savings: undefined, storeNote: undefined });
  assert.ok(!buildPost({ candidate: gog, channel: noLines, links, day }).text.includes('You save'), 'a channel without them gets no lines, though its template has the placeholders');
});

test('IndieGala note comes from the drminfo of the game: "Steam key" or "DRM free" as the feed says, otherwise no note', () => {
  const ig = (drminfo) => ({ ...deal, drminfo });
  const lines = (c) => buildPost({ candidate: c, channel: mastodon, links, day }).text.split('\n');
  assert.deepEqual(lines(ig('Steam key')).slice(0, 4), ['Control Ultimate Edition: -85% at IndieGala', '$5.99 (was $39.99)', 'You save $34.00', 'Steam key']);
  assert.deepEqual(lines(ig('DRM free')).slice(0, 4), ['Control Ultimate Edition: -85% at IndieGala', '$5.99 (was $39.99)', 'You save $34.00', 'DRM-free']);
  assert.equal(lines(ig('DRM-free'))[3], 'DRM-free', 'capitals, hyphens and spaces do not matter');
  assert.equal(lines(ig('  steam KEY '))[3], 'Steam key');
  for (const unknown of ['GOG key', 'Epic key', 'Origin', '', null, undefined]) assert.equal(lines(ig(unknown))[3], 'Price checked Oct 7. Sale ends Oct 8.', `no note for ${JSON.stringify(unknown)}`);
  // GOG keeps its own text, whatever the drminfo says; Bluesky has no note at all
  assert.equal(lines({ ...gog, drminfo: 'Steam key' })[3], 'DRM-free');
  assert.ok(!/Steam key|DRM-free/.test(buildPost({ candidate: ig('Steam key'), channel: bluesky, links, day }).text));
});

test('noteOf: plain text, a rule from a field, or nothing', () => {
  const ch = channelWithDefaults('x', 'c', { ...accounts.prices.channels.mastodon, storeNote: { A: 'Plain', B: { field: 'drminfo', notes: { 'Steam key': 'Key' } } } });
  assert.equal(noteOf(ch, { store: 'A' }), 'Plain');
  assert.equal(noteOf(ch, { store: 'B', drminfo: 'steam-key' }), 'Key');
  assert.equal(noteOf(ch, { store: 'B', drminfo: 'Something else' }), '');
  assert.equal(noteOf(ch, { store: 'B' }), '');
  assert.equal(noteOf(ch, { store: 'C', drminfo: 'Steam key' }), '', 'a store without a note');
});

test('storeNote rules: bad settings are refused (no field, unknown field, no notes, a hashtag or a line break in a note)', () => {
  const base = accounts.prices.channels.mastodon;
  const rule = (r) => channelWithDefaults('x', 'c', { ...base, storeNote: { IndieGala: r } });
  assert.throws(() => rule({ notes: { 'Steam key': 'Key' } }), /must look like/);
  assert.throws(() => rule({ field: 'platform', notes: { 'Steam key': 'Key' } }), /must look like/);
  assert.throws(() => rule({ field: 'drminfo', notes: {} }), /must look like/);
  assert.throws(() => rule({ field: 'drminfo' }), /must look like/);
  assert.throws(() => rule({ field: 'drminfo', notes: { 'Steam key': '#SteamKey' } }), /must look like/);
  assert.throws(() => rule({ field: 'drminfo', notes: { 'Steam key': 'two\nlines' } }), /must look like/);
  assert.ok(rule({ field: 'drminfo', notes: { 'Steam key': 'Key' } }));
});

test('the invented-amount check also covers notes taken from the data', () => {
  const rule = channelWithDefaults('x', 'c', { ...accounts.prices.channels.mastodon, storeNote: { IndieGala: { field: 'drminfo', notes: { 'Steam key': 'Save $50.00 extra' } } } });
  assert.throws(() => buildPost({ candidate: { ...deal, drminfo: 'Steam key' }, channel: rule, links, day }), /not a price of the deal: \$50/);
});

test('the brief carries drminfo from deals.json into the candidate, and a post is made from it', () => {
  const account = withDefaults('prices', accounts.prices);
  const now = Date.parse('2026-10-08T12:00:00Z');
  const make = (extra) => buildCandidates({
    eligible: [{ deal: { store: 'IndieGala', title: 'Control Ultimate Edition', price: 5.99, was: 39.99, discountPct: 85, endsAt: '2026-10-09T23:59:00Z', checkedAt: '2026-10-08T09:00:00Z', url: 'https://www.indiegala.com/store/game/control/1', ...extra }, id: 'indiegala-control-ultimate-edition', offeredOn: null }],
    mentions: new Map(), history: {}, account, links, now,
  })[0];
  assert.equal(make({ drminfo: 'Steam key' }).drminfo, 'Steam key');
  assert.equal(make({}).drminfo, null, 'a deal without the field: null');
  const posts = makePosts({ id: 'prices', account, brief: { candidates: [make({ drminfo: 'DRM free' })], warnings: [] }, links, now });
  assert.ok(posts.find((p) => p.channel === 'mastodon').text.includes('\nDRM-free\n'));
  assert.ok(!posts.find((p) => p.channel === 'bluesky').text.includes('DRM-free'));
});

test('update-deals keeps what the feed says: the fresh IndieGala list replaces the old entries with their drminfo', () => {
  const old = [{ store: 'IndieGala', title: 'A', url: 'https://i/a', image: 'cover.jpg' }, { store: 'GOG', title: 'G', url: 'https://g/g' }];
  const fresh = [{ store: 'IndieGala', title: 'A', url: 'https://i/a', drminfo: 'Steam key', image: '' }, { store: 'IndieGala', title: 'B', url: 'https://i/b', drminfo: 'DRM free', image: '' }];
  const merged = mergeIndieGala(old, fresh).deals;
  assert.equal(merged.find((d) => d.title === 'A').drminfo, 'Steam key');
  assert.equal(merged.find((d) => d.title === 'A').image, 'cover.jpg', 'the cover found earlier is kept');
  assert.equal(merged.find((d) => d.title === 'B').drminfo, 'DRM free');
  assert.equal(merged.find((d) => d.title === 'G').drminfo, undefined, 'GOG is not touched');
  const later = mergeIndieGala(merged, [{ store: 'IndieGala', title: 'A', url: 'https://i/a', image: '' }]).deals;
  assert.equal(later.find((d) => d.title === 'A').drminfo, undefined, 'if the feed stops saying it, we do not keep an old value');
});

test('the real data/deals.json: a drminfo, where there is one, is plain text of an IndieGala deal', () => {
  const deals = JSON.parse(readFileSync(fileURLToPath(new URL('../data/deals.json', import.meta.url)), 'utf8'));
  for (const d of deals) if ('drminfo' in d) assert.ok(typeof d.drminfo === 'string' && d.drminfo.trim() && d.store === 'IndieGala', `${d.title}`);
});

test('the real data/accounts.json: every channel is valid and a post can be made for each, for 30 days in a row', () => {
  for (const [id, account] of Object.entries(accounts)) {
    for (const [name, raw] of Object.entries(account.channels ?? {})) {
      const channel = channelWithDefaults(id, name, raw);
      for (const d of [deal, gog]) {
        for (let n = 1; n <= 30; n++) {
          const p = buildPost({ candidate: d, channel, links, day: `2026-10-${String(n).padStart(2, '0')}` });
          assert.ok(p.length <= channel.maxChars, `${id}/${name}`);
          assert.ok(p.tags.length <= channel.maxTags);
        }
      }
    }
  }
  assert.ok(!JSON.stringify(accounts).includes('directLinkStores'));
  assert.ok(!/"(adTag|hashtags|storeHashtags)"/.test(JSON.stringify(accounts)), 'the old tag fields are gone');
});

console.log(`\n${ran} tests passed.`);
