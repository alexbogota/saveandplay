// Tests of the ready posts (scripts/lib/posts.mjs and makePosts in scripts/daily-brief.mjs). They run offline.
//
//   npm run posts:test
//
// Checked: the text and the numbers, the link (our page, marks of the channel), the ad tag last, hashtags, the limit of characters
// (and a long title), "Lowest price we've tracked" only when the history says so, no post when there is no deal, a broken template
// is reported and never produces a post, a new channel needs only a block in the settings, the real data/accounts.json is valid.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { channelWithDefaults, buildPost, formatDate, graphemes } from './lib/posts.mjs';

process.env.DAILY_BRIEF_AS_MODULE = '1';
const { makePosts, withDefaults, historyFacts } = await import('./daily-brief.mjs');

const links = { site: 'https://saveandplay.com' };
const accounts = JSON.parse(readFileSync(fileURLToPath(new URL('../data/accounts.json', import.meta.url)), 'utf8')).accounts;
const bluesky = channelWithDefaults('prices', 'bluesky', accounts.prices.channels.bluesky);
const mastodon = channelWithDefaults('prices', 'mastodon', accounts.prices.channels.mastodon);

const deal = {
  id: 'indiegala-control-ultimate-edition', kind: 'deal', title: 'Control Ultimate Edition', store: 'IndieGala',
  price: 5.99, was: 39.99, discount: 85, endsAt: '2026-10-08T23:59:00Z', priceCheckedAt: '2026-10-07T09:49:09.029Z',
  history: { days: 5, lowest: false }, whyToday: ['sale ends in 36 h', 'deepest-discount rank 10 of 38'], discountRank: 10,
};
const day = '2026-10-08';
let ran = 0;
const test = (name, fn) => { fn(); ran++; console.log(`ok  ${name}`); };

test('text: only the numbers of the deal, dates by the channel format', () => {
  const p = buildPost({ candidate: deal, channel: bluesky, links, day });
  assert.equal(p.text, [
    'Control Ultimate Edition: -85% at IndieGala\n$5.99 (was $39.99)\nPrice checked Oct 7. Sale ends Oct 8.',
    'https://saveandplay.com/deals/indiegala/control-ultimate-edition/?utm_source=bluesky-prices&utm_medium=social&utm_campaign=deals-2026-10-08',
    '#PCGaming #GameDeals #ad',
  ].join('\n\n'));
  assert.ok(p.length <= 300);
});

test('the link is our page of the game, never a store; the marks belong to the channel', () => {
  const b = buildPost({ candidate: deal, channel: bluesky, links, day });
  const m = buildPost({ candidate: deal, channel: mastodon, links, day });
  assert.ok(b.link.startsWith('https://saveandplay.com/deals/indiegala/control-ultimate-edition/?utm_source=bluesky-prices&utm_medium=social&utm_campaign=deals-2026-10-08'));
  assert.ok(m.link.includes('utm_source=mastodon-prices'));
  for (const t of [b.text, m.text]) assert.ok(!/gog\.com|qwpeg|indiegala\.com|admitad|steampowered/i.test(t));
});

test('the ad tag is the last word; Mastodon has 3-4 tags in CamelCase and the store tag', () => {
  const m = buildPost({ candidate: deal, channel: mastodon, links, day });
  assert.equal(m.text.split(/\s+/).at(-1), '#ad');
  const tags = m.text.split('\n').at(-1).split(' ');
  assert.deepEqual(tags, ['#PCGaming', '#GameDeals', '#Gaming', '#IndieGala', '#ad']);
  assert.ok(m.text.includes('Why today: sale ends in 36 h.'), 'the rank clause is not shown below the top 3');
  assert.ok(!/rank/.test(m.text));
});

test('"Lowest price we\'ve tracked" only when the history says so; never "lowest ever"', () => {
  assert.ok(!buildPost({ candidate: deal, channel: bluesky, links, day }).text.includes('Lowest price'));
  const low = buildPost({ candidate: { ...deal, history: { days: 5, lowest: true } }, channel: bluesky, links, day });
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
  assert.equal(p.text.split(/\s+/).at(-1), '#ad');
});

test('the length counts the link as linkChars and counts characters as a person sees them', () => {
  assert.equal(graphemes('a👍🏽b'), 3);
  const p = buildPost({ candidate: deal, channel: bluesky, links, day });
  assert.equal(p.length, graphemes(p.text.replace(p.link, '')) + 25);
});

test('a template without {tags} or {link}, with a wrong placeholder or a bad hashtag is refused', () => {
  const base = accounts.prices.channels.bluesky;
  assert.throws(() => channelWithDefaults('x', 'c', { ...base, template: ['{title}', '{link}'] }), /needs \{tags\}/);
  assert.throws(() => channelWithDefaults('x', 'c', { ...base, template: ['{title}', '{tags}'] }), /needs \{link\}/);
  assert.throws(() => channelWithDefaults('x', 'c', { ...base, template: ['{titel}', '{link}', '{tags}'] }), /\{titel\}/);
  assert.throws(() => channelWithDefaults('x', 'c', { ...base, hashtags: ['PCGaming'] }), /not a valid hashtag/);
  assert.throws(() => channelWithDefaults('x', 'c', { ...base, maxChars: undefined }), /lacks: maxChars/);
});

test('a template that does not end with the tags cannot produce a post', () => {
  const bad = channelWithDefaults('x', 'c', { ...accounts.prices.channels.bluesky, template: ['{tags}', '{title}', '{link}'] });
  assert.throws(() => buildPost({ candidate: deal, channel: bad, links, day }), /ad tag/);
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
  const threads = { enabled: true, subid: 'threads-prices', maxChars: 500, hashtags: ['#PCGaming'], template: ['{title}: -{discount}%', '{link}', '{tags}'] };
  const p = buildPost({ candidate: deal, channel: channelWithDefaults('prices', 'threads', threads), links, day });
  assert.ok(p.link.includes('utm_source=threads-prices') && p.text.endsWith('#PCGaming #ad'));
});

test('the real data/accounts.json: every channel is valid and a post can be made for each', () => {
  for (const [id, account] of Object.entries(accounts)) {
    for (const [name, raw] of Object.entries(account.channels ?? {})) {
      const channel = channelWithDefaults(id, name, raw);
      const p = buildPost({ candidate: deal, channel, links, day });
      assert.ok(p.length <= channel.maxChars, `${id}/${name}`);
    }
  }
  assert.ok(!JSON.stringify(accounts).includes('directLinkStores'));
});

console.log(`\n${ran} tests passed.`);
