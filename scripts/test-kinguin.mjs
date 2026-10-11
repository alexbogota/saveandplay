// Tests of the Kinguin part of the daily price update (scripts/lib/kinguin.mjs and its place in scripts/update-deals.mjs). They run offline.
//
//   npm run kinguin:test
//
// Checked: the honest fields (the price we compare with is the Steam price, labelled as such; the time of the check is the time of the file),
// links (only the Admitad addresses of the rules, only to kinguin.net, subid added), the limits of the site (5 new a day, 15 in all),
// the savings limits (too good to be true is not shown), reviews, games that an official store already sells, a stale or broken file
// changes nothing, a game that left the list is removed, the whole program works on a file, Kinguin is not in the post settings.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { affiliateLink, updateKinguin, steamIdOf } from './lib/kinguin.mjs';

process.env.UPDATE_DEALS_AS_MODULE = '1';
const { tidy, problem, isExcluded } = await import('./update-deals.mjs');

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const realRules = JSON.parse(readFileSync(here('../data/deals-rules.json'), 'utf8'));
const rules = structuredClone(realRules);
const NOW = Date.parse('2026-10-12T09:30:00Z');
const hours = (h) => new Date(NOW - h * 3600e3).toISOString();

const link = (id, extra = '') =>
  `https://ficca2021.com/g/abc123def/?f_id=25658${extra}&ulp=${encodeURIComponent(`https://www.kinguin.net/en/category/${id}/game-${id}-pc-steam-cd-key?nosalesbooster=1&currency=USD`)}`;
// One item as the public repo writes it. Game n has n * 1000 Steam reviews, so a bigger n is a more known game.
const item = (n, over = {}) => ({
  steamId: 1000 + n, title: `Game ${n}`, kinguinName: `Game ${n} PC Steam CD Key`, kinguinId: String(5000 + n),
  price: 10, steamPrice: 30, steamWas: 30, steamDiscountPct: 0, savingsPct: 67,
  reviews: { total: n * 1000, positivePct: 90 }, stock: 100, region: 'Steam REGION FREE',
  url: link(5000 + n), image: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${1000 + n}/header.jpg?t=1`,
  checkedAt: hours(2), ...over,
});
const fileOf = (items, over = {}) => ({ generatedAt: hours(1), count: items.length, deals: items, ...over });
const run = (deals, file, r = rules) => updateKinguin({ deals, rules: r, now: NOW, file, isExcluded });
const titles = (deals) => deals.filter((d) => d.store === 'Kinguin').map((d) => d.title);

let ran = 0;
const test = (name, fn) => { fn(); ran++; console.log(`ok  ${name}`); };

test('link: Admitad address of the rules, leads to kinguin.net, subid goes first', () => {
  const ok = affiliateLink(link(1), rules.kinguin.linkHosts, 'site');
  assert.ok(ok.affiliateUrl.startsWith('https://ficca2021.com/g/abc123def/?subid=site&f_id=25658&ulp='));
  assert.equal(ok.pageUrl, 'https://www.kinguin.net/en/category/1/game-1-pc-steam-cd-key?nosalesbooster=1&currency=USD');
  assert.equal(affiliateLink(link(1, '&subid=bluesky'), rules.kinguin.linkHosts, 'site').affiliateUrl.match(/subid=/g).length, 1, 'an existing subid is not doubled');
});

test('link: a strange address is refused', () => {
  const hosts = rules.kinguin.linkHosts;
  assert.equal(affiliateLink(link(1).replace('ficca2021.com', 'evil.example'), hosts, 'site'), null, 'host not in the rules');
  assert.equal(affiliateLink(link(1).replace('https:', 'http:'), hosts, 'site'), null, 'not https');
  assert.equal(affiliateLink(link(1).replace('/g/abc123def/', '/x/abc123def/'), hosts, 'site'), null, 'not an Admitad path');
  assert.equal(affiliateLink(`https://ficca2021.com/g/abc123def/?ulp=${encodeURIComponent('https://evil.example/x')}`, hosts, 'site'), null, 'leads elsewhere');
  assert.equal(affiliateLink(`https://ficca2021.com/g/abc123def/?ulp=${encodeURIComponent('https://kinguin.net.evil.example/x')}`, hosts, 'site'), null, 'look-alike host');
  assert.equal(affiliateLink('https://ficca2021.com/g/abc123def/', hosts, 'site'), null, 'no target');
  assert.equal(affiliateLink('not a link', hosts, 'site'), null);
});

test('an entry is honest: was = the Steam price, labelled; the check time is the time of the file', () => {
  const r = run([], fileOf([item(3)]));
  assert.ok(r.ok);
  const [d] = r.deals;
  assert.equal(d.store, 'Kinguin');
  assert.equal(d.was, 30);
  assert.equal(d.price, 10);
  assert.equal(d.discountPct, 67);
  assert.equal(d.compareTo, 'Steam');
  assert.equal(d.marketplace, true);
  assert.equal(d.region, 'Region free');
  assert.equal(d.checkedAt, hours(2));
  assert.equal(d.steamId, 1003);
  assert.ok(d.affiliateUrl.includes('subid=site'));
  assert.ok(d.url.startsWith('https://www.kinguin.net/'));
  assert.equal(problem(d), '', 'the rest of the program accepts the entry');
  assert.equal(JSON.stringify(d).includes('market_price'), false, 'the Kinguin own discount is never used');
});

test('the title is cleaned, the cover must be a Steam picture, the region is named plainly', () => {
  const r = run([], fileOf([item(3, { title: 'Game®  Three™', image: 'https://evil.example/a.jpg', region: 'Steam GLOBAL' })]));
  assert.equal(r.deals[0].title, 'Game Three');
  assert.equal(r.deals[0].image, '', 'the cover will be filled by npm run covers');
  assert.equal(r.deals[0].region, 'Global');
});

test('savings: too small and too good to be true are not shown', () => {
  const r = run([], fileOf([item(1, { price: 25, savingsPct: 17 }), item(2, { price: 3, savingsPct: 90 }), item(3, { price: 4.5, savingsPct: 85 }), item(4, { price: 21, savingsPct: 30 })]));
  assert.deepEqual(titles(r.deals).sort(), ['Game 3', 'Game 4'], '85% and 30% are inside the limits');
  assert.equal(r.out.skipped.savings, 2);
});

test('the savings written in the file must agree with the prices', () => {
  const r = run([], fileOf([item(1, { savingsPct: 40 })]));
  assert.equal(titles(r.deals).length, 0);
  assert.equal(r.out.skipped.invalid, 1);
});

test('reviews and score of Steam are checked again', () => {
  const r = run([], fileOf([item(0, { reviews: { total: 100, positivePct: 95 } }), item(2, { reviews: { total: 5000, positivePct: 60 } }), item(5)]));
  assert.deepEqual(titles(r.deals), ['Game 5']);
  assert.equal(r.out.skipped.fewReviews, 1);
  assert.equal(r.out.skipped.lowScore, 1);
});

test('broken items are skipped, not crashed on', () => {
  const bad = [null, {}, item(1, { price: 'x' }), item(2, { steamId: 'abc' }), item(3, { checkedAt: 'never' }), item(4, { checkedAt: new Date(NOW + 3 * 3600e3).toISOString() }), item(5, { region: '' }), item(6, { price: 40, savingsPct: -33 }), item(7, { url: 'https://evil.example/' })];
  const r = run([], fileOf(bad));
  assert.ok(r.ok);
  assert.equal(titles(r.deals).length, 0);
});

test('a game that an official store sells is not shown from Kinguin', () => {
  const gog = { store: 'GOG', title: 'Game 1', steamId: 1001, price: 20, was: 30, discountPct: 33, url: 'https://www.gog.com/en/game/game_1', checkedAt: hours(1) };
  const old = { store: 'IndieGala', title: 'Game 2 old', image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1002/header.jpg', price: 1, was: 2, discountPct: 50, url: 'https://x', checkedAt: hours(1) };
  assert.equal(steamIdOf(old), 1002, 'the Steam number can come from the cover address');
  const r = run([gog, old], fileOf([item(1), item(2), item(3)]));
  assert.deepEqual(titles(r.deals), ['Game 3']);
  assert.equal(r.out.skipped.officialHasIt, 2);
  assert.equal(r.deals.filter((d) => d.store !== 'Kinguin').length, 2, 'the other stores are untouched');
});

test('a Kinguin entry on the site is removed when an official store starts selling the game', () => {
  const first = run([], fileOf([item(1), item(2)]));
  const gog = { store: 'GOG', title: 'Game 1', steamId: 1001, price: 20, was: 30, discountPct: 33, url: 'https://www.gog.com/en/game/game_1', checkedAt: hours(1) };
  const next = run([gog, ...first.deals], fileOf([item(1), item(2)]));
  assert.deepEqual(titles(next.deals), ['Game 2']);
  assert.match(next.out.dropped[0], /Game 1.*обычный магазин/);
});

test('limits of the site: 5 new a day, 15 in all, the most known games first', () => {
  const items = Array.from({ length: 30 }, (_, i) => item(i + 1)); // game 30 is the most reviewed
  let deals = [];
  const seen = [];
  for (let day = 1; day <= 5; day++) {
    const r = run(deals, fileOf(items));
    deals = r.deals;
    seen.push(titles(deals).length);
  }
  assert.deepEqual(seen, [5, 10, 15, 15, 15]);
  assert.deepEqual(titles(deals).slice(0, 5), ['Game 30', 'Game 29', 'Game 28', 'Game 27', 'Game 26']);
  assert.equal(titles(deals).length, new Set(titles(deals)).size);
});

test('limits come from the rules', () => {
  const small = structuredClone(rules);
  small.kinguin.maxNew = 2;
  small.kinguin.maxTotal = 3;
  let deals = [];
  const items = Array.from({ length: 10 }, (_, i) => item(i + 1));
  deals = run(deals, fileOf(items), small).deals;
  deals = run(deals, fileOf(items), small).deals;
  deals = run(deals, fileOf(items), small).deals;
  assert.equal(titles(deals).length, 3);
});

test('prices are refreshed, a game that left the list is removed, a cover found earlier is kept', () => {
  const first = run([], fileOf([item(1, { image: '' }), item(2), item(3)]));
  first.deals.find((d) => d.title === 'Game 1').image = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1001/header.jpg';
  const next = run(first.deals, fileOf([item(1, { image: '', price: 9, savingsPct: 70 }), item(3)]));
  assert.deepEqual(titles(next.deals).sort(), ['Game 1', 'Game 3']);
  const one = next.deals.find((d) => d.title === 'Game 1');
  assert.equal(one.price, 9);
  assert.ok(one.image.includes('/apps/1001/'));
  assert.match(next.out.dropped.join(), /Game 2.*нет в свежем списке/);
  assert.match(next.out.refreshed.join(), /Game 1: \$10.00 → \$9.00/);
});

test('a stale or broken file changes nothing', () => {
  const first = run([], fileOf([item(1)])).deals;
  for (const file of [fileOf([item(2)], { generatedAt: hours(40) }), { deals: [] }, { generatedAt: 'x', deals: [] }, null, { generatedAt: hours(1), deals: 'no' }]) {
    const r = run(first, file);
    assert.equal(r.ok, false);
    assert.deepEqual(r.deals, first);
    assert.ok(r.out.problems.length);
  }
});

test('an empty but fresh list is a real answer: Kinguin entries go away', () => {
  const first = run([], fileOf([item(1)])).deals;
  const r = run(first, fileOf([]));
  assert.ok(r.ok);
  assert.equal(titles(r.deals).length, 0);
});

test('the list of the site: other stores stay, an entry the check time of which is old is removed by tidy', () => {
  const gog = { store: 'GOG', title: 'Other', steamId: 1, price: 5, was: 10, discountPct: 50, url: 'https://www.gog.com/en/game/other', checkedAt: hours(1) };
  const r = run([gog], fileOf([item(1, { checkedAt: hours(30) })]));
  assert.equal(tidy(r.deals, rules, NOW).deals.length, 2, '30 hours is inside dropOlderThanHours');
  const old = run([gog], fileOf([item(1, { checkedAt: hours(30) })]), rules);
  old.deals[1].checkedAt = hours(60);
  assert.equal(tidy(old.deals, rules, NOW).removed.stale.length, 1);
});

test('the real rules and settings: Kinguin is on, limits as decided, not in the posts', () => {
  const k = realRules.kinguin;
  assert.equal(k.enabled, true);
  assert.equal(k.maxNew, 5);
  assert.equal(k.maxTotal, 15);
  assert.equal(k.maxSavings, 85);
  assert.ok(k.source.startsWith('https://raw.githubusercontent.com/'));
  assert.ok(k.linkHosts.length && k.subid);
  const accounts = JSON.parse(readFileSync(here('../data/accounts.json'), 'utf8')).accounts;
  for (const [id, a] of Object.entries(accounts)) assert.ok(!a.stores.includes('Kinguin'), `${id} must not post Kinguin`);
  assert.ok(!readFileSync(here('./make-drafts.mjs'), 'utf8').match(/POST_STORES = \[[^\]]*Kinguin/), 'make-drafts does not post Kinguin');
});

test('the whole program on a file: writes deals, history and a report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kinguin-test-'));
  const only = { ...realRules, gog: { ...realRules.gog, enabled: false }, indiegala: { enabled: false } };
  writeFileSync(join(dir, 'rules.json'), JSON.stringify(only));
  writeFileSync(join(dir, 'deals.json'), '[]');
  writeFileSync(join(dir, 'history.json'), '{}');
  writeFileSync(join(dir, 'kinguin.json'), JSON.stringify(fileOf(Array.from({ length: 8 }, (_, i) => item(i + 1)), { generatedAt: new Date().toISOString() })));
  const env = {
    ...process.env, UPDATE_DEALS_AS_MODULE: '', UPDATE_NOW: new Date().toISOString(), RULES_FILE: join(dir, 'rules.json'), DEALS_FILE: join(dir, 'deals.json'),
    HISTORY_FILE: join(dir, 'history.json'), KINGUIN_FILE: join(dir, 'kinguin.json'), REPORT_DIR: dir,
  };
  // The check times in the fixture are relative to NOW; with a real clock the file is "fresh" and the items 2 hours old are inside 48 hours.
  const items = JSON.parse(readFileSync(join(dir, 'kinguin.json'), 'utf8'));
  items.deals.forEach((d) => { d.checkedAt = new Date(Date.now() - 2 * 3600e3).toISOString(); });
  writeFileSync(join(dir, 'kinguin.json'), JSON.stringify(items));
  const res = spawnSync(process.execPath, [here('./update-deals.mjs')], { env, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr + res.stdout);
  const deals = JSON.parse(readFileSync(join(dir, 'deals.json'), 'utf8'));
  assert.equal(deals.length, 5, 'five new games on the first day');
  assert.ok(deals.every((d) => d.store === 'Kinguin' && d.marketplace && d.compareTo === 'Steam'));
  const history = JSON.parse(readFileSync(join(dir, 'history.json'), 'utf8'));
  assert.equal(Object.keys(history).length, 5);
  const md = readFileSync(join(dir, 'deals-update.md'), 'utf8');
  assert.match(md, /## Kinguin: обновлено 0, добавлено 5, убрано 0/);
});

console.log(`\n${ran} tests passed.`);
