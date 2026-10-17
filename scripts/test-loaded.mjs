// Tests of the Loaded part (scripts/lib/loaded.mjs, scripts/loaded-fetch.mjs and its place in scripts/update-deals.mjs). They run offline.
//
//   npm run loaded:test
//
// Checked: the page is read as FACTS only (name, price, address) and unclear cards are skipped; a guard page or a changed markup stops the
// reading and writes nothing; names are matched with Steam exactly (a Deluxe Edition is never compared with the standard game); a key is shown
// only when it is clearly cheaper than the CURRENT Steam price; links (only the Admitad address of the rules, only to loaded.com); the limits
// of the site (5 new a day, 15 in all); an official store beats a key seller; a stale or broken file changes nothing; Kinguin and Loaded do not
// hide each other; Loaded is not in the post settings; the whole program works on a file.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePage, candidates, looksBlocked, productUrl, cleanTitle, nameKey, affiliateLink, updateLoaded } from './lib/loaded.mjs';
import { updateKinguin } from './lib/kinguin.mjs';

process.env.UPDATE_DEALS_AS_MODULE = '1';
const { tidy, isExcluded } = await import('./update-deals.mjs');

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const realRules = JSON.parse(readFileSync(here('../data/deals-rules.json'), 'utf8'));
const accountsFile = JSON.parse(readFileSync(here('../data/accounts.json'), 'utf8'));
const rules = structuredClone(realRules);
rules.loaded.enabled = true;
const BASE = accountsFile.links.loadedDeeplink;
const NOW = Date.parse('2026-10-17T09:30:00Z');
const hours = (h) => new Date(NOW - h * 3600e3).toISOString();

// ---------- a page like the real one: Magento cards, div.product-item ----------
const card = (name, slug, prices, extra = '') => `
<div class="product-item product-item-info${extra}">
  <a class="product photo product-item-photo" href="https://www.loaded.com/${slug}" tabindex="-1"><img src="https://www.loaded.com/media/${slug}.jpg" alt="${name}"></a>
  <strong class="product name product-item-name"><a class="product-item-link" href="https://www.loaded.com/${slug}">${name}</a></strong>
  <div class="price-box price-final_price">${prices}</div>
</div>`;
const one = (p) => `<span class="price-container"><span class="price-wrapper"><span class="price">$${p}</span></span></span>`;
const sale = (was, now) => `<span class="old-price"><span class="price">$${was}</span></span><span class="special-price"><span class="price-label">Special Price</span><span class="price">$${now}</span></span>`;
const page = (cards) => `<!doctype html><html><head><title>CDKeys deals</title></head><body><div class="products wrapper grid">${cards.join('\n')}</div></body></html>`;

const pageCards = [
  card('Marathon PC (Steam)', 'marathon-pc-steam', one('19.99')),
  card('Hades II &amp; Friends PC (Steam)', 'hades-ii-pc-steam', sale('29.99', '17.49')),
  card('Some Game PC (WW)', 'some-game-pc-ww', one('5.00')),
  card('Forza Horizon 5 Xbox', 'forza-horizon-5-xbox', one('15.00')),
  card('Two Prices PC (Steam)', 'two-prices-pc-steam', '<span class="price">$10.00</span> <span class="price">$12.00</span>'),
  card('No Price PC (Steam)', 'no-price-pc-steam', ''),
  card('Query PC (Steam)', 'query-pc-steam?region=us', one('9.00')),
  card('Elsewhere PC (Steam)', 'elsewhere-pc-steam', one('9.00')).replace(/https:\/\/www\.loaded\.com\/elsewhere/g, 'https://evil.example/elsewhere'),
  card('FC Points PC (Steam)', 'fc-points-pc-steam', one('9.00')),
  card('Marathon PC (Steam)', 'marathon-pc-steam', one('19.99')),
  ...Array.from({ length: 6 }, (_, i) => card(`Filler ${i} PC (Steam)`, `filler-${i}-pc-steam`, one('4.99'))),
];
const html = page(pageCards);

let ran = 0;
const test = async (name, fn) => { await fn(); ran++; console.log(`ok  ${name}`); };

await test('page: facts only (name, price, address); special price beats the old price; unclear cards are skipped', () => {
  const r = parsePage(html);
  assert.equal(r.seen, pageCards.length);
  const by = (slug) => r.items.find((i) => i.url === `https://www.loaded.com/${slug}`);
  assert.deepEqual(by('marathon-pc-steam'), { title: 'Marathon PC (Steam)', url: 'https://www.loaded.com/marathon-pc-steam', price: 19.99 });
  assert.equal(by('hades-ii-pc-steam').price, 17.49, 'the special price, not the old one');
  assert.equal(by('hades-ii-pc-steam').title, 'Hades II & Friends PC (Steam)');
  assert.equal(by('two-prices-pc-steam'), undefined, 'two prices and no marker: unclear');
  assert.equal(by('no-price-pc-steam'), undefined);
  assert.equal(by('query-pc-steam'), undefined, 'an address with a query is never used');
  assert.equal(by('elsewhere-pc-steam'), undefined, 'a link to another site');
  assert.equal(r.bad.duplicate, 1);
  assert.deepEqual(Object.keys(by('marathon-pc-steam')).sort(), ['price', 'title', 'url'], 'nothing else is taken from the page');
});

await test('candidates: only PC Steam keys that are games', () => {
  const c = candidates(parsePage(html).items);
  const urls = c.items.map((i) => i.url.split('/').pop());
  assert.ok(urls.includes('marathon-pc-steam') && urls.includes('hades-ii-pc-steam'));
  assert.ok(!urls.includes('some-game-pc-ww'), 'WW keys are skipped until we know what they are');
  assert.ok(!urls.includes('forza-horizon-5-xbox'));
  assert.ok(!urls.includes('fc-points-pc-steam'), 'in-game money');
  assert.equal(c.skipped.notSteamKey, 2);
  assert.equal(c.skipped.notAGame, 1);
});

await test('a guard page is recognised (we stop, we never get around it)', () => {
  assert.ok(looksBlocked(403, '<html><title>Just a moment...</title>'));
  assert.ok(looksBlocked(200, '<html><head><title>Just a moment...</title></head>'));
  assert.ok(looksBlocked(503, 'x'));
  assert.ok(!looksBlocked(200, html));
  assert.equal(parsePage('<html><title>Just a moment...</title></html>').seen, 0);
});

await test('addresses and names', () => {
  assert.equal(productUrl('https://www.loaded.com/marathon-pc-steam'), 'https://www.loaded.com/marathon-pc-steam');
  assert.equal(productUrl('/marathon-pc-steam'), 'https://www.loaded.com/marathon-pc-steam');
  for (const bad of ['http://www.loaded.com/x', 'https://loaded.com.evil.example/x', 'https://www.loaded.com/a/b', 'https://www.loaded.com/x?q=1', 'https://www.loaded.com/catalogsearch/result', 'https://www.loaded.com/x#y', 'javascript:alert(1)'])
    assert.equal(productUrl(bad), null, bad);
  assert.equal(cleanTitle('Marathon PC (Steam)'), 'Marathon');
  assert.equal(cleanTitle('Cyberpunk 2077 PC Steam Key (WW)'), 'Cyberpunk 2077');
  assert.equal(cleanTitle('Hades II™ PC'), 'Hades II');
  assert.equal(cleanTitle('Dark Souls III Deluxe Edition PC (Steam)'), 'Dark Souls III Deluxe Edition', 'edition words stay: Steam has to match them');
  assert.equal(nameKey('The Witcher® 3: Wild Hunt'), nameKey('witcher 3 wild hunt'));
});

await test('link: Admitad address of the rules, leads to loaded.com, subid=site', () => {
  const hosts = rules.loaded.linkHosts;
  const ok = affiliateLink(BASE, 'https://www.loaded.com/marathon-pc-steam', hosts, 'site');
  assert.equal(ok.pageUrl, 'https://www.loaded.com/marathon-pc-steam');
  assert.equal(ok.affiliateUrl, `${BASE}?subid=site&ulp=${encodeURIComponent('https://www.loaded.com/marathon-pc-steam')}`);
  assert.equal(affiliateLink(BASE.replace('naiawork.com', 'evil.example'), 'https://www.loaded.com/x', hosts, 'site'), null, 'host not in the rules');
  assert.equal(affiliateLink(BASE.replace('https:', 'http:'), 'https://www.loaded.com/x', hosts, 'site'), null, 'not https');
  assert.equal(affiliateLink(BASE.replace('/g/', '/x/'), 'https://www.loaded.com/x', hosts, 'site'), null, 'not an Admitad path');
  assert.equal(affiliateLink(BASE, 'https://evil.example/x', hosts, 'site'), null, 'leads elsewhere');
  assert.equal(affiliateLink(BASE, 'https://www.loaded.com.evil.example/x', hosts, 'site'), null, 'look-alike host');
  assert.equal(affiliateLink('not a link', 'https://www.loaded.com/x', hosts, 'site'), null);
});

// ---------- the deals ----------
// Game n: Loaded address game-n-pc-steam, Steam id 2000 + n, n * 1000 Steam reviews (a bigger n is a more known game), Steam price $30.
const item = (n, over = {}) => ({ title: `Game ${n} PC (Steam)`, url: `https://www.loaded.com/game-${n}-pc-steam`, price: 12, ...over });
const fileOf = (items, over = {}) => ({ generatedAt: hours(1), currency: 'USD', items, ...over });
const steamFor = (over = {}) => ({
  steam: async (title) => {
    const m = title.match(/^Game (\d+)$/);
    return m ? { appid: 2000 + Number(m[1]), name: title, pct: 90, total: Number(m[1]) * 1000, descriptors: [], ...over } : null;
  },
  steamPrice: async () => 30,
});
const link = (url) => affiliateLink(BASE, url, rules.loaded.linkHosts, rules.loaded.subid);
const run = (deals, file, extra = {}, r = rules) => updateLoaded({ deals, rules: r, now: NOW, file, isExcluded, link, ...steamFor(), ...extra });
const titles = (deals) => deals.filter((d) => d.store === 'Loaded').map((d) => d.title);

await test('a deal is honest: Steam price is the comparison, no Loaded percent, marketplace flag, US price, link through Admitad', async () => {
  const r = await run([], fileOf([item(1)]));
  assert.ok(r.ok);
  const d = r.deals[0];
  assert.equal(d.store, 'Loaded');
  assert.equal(d.title, 'Game 1');
  assert.equal(d.price, 12);
  assert.equal(d.was, 30);
  assert.equal(d.discountPct, 60);
  assert.equal(d.compareTo, 'Steam');
  assert.equal(d.marketplace, true);
  assert.equal(d.priceRegion, 'US');
  assert.equal(d.url, 'https://www.loaded.com/game-1-pc-steam');
  assert.equal(d.affiliateUrl, `${BASE}?subid=site&ulp=${encodeURIComponent(d.url)}`);
  assert.equal(d.steamId, 2001);
  assert.equal(d.checkedAt, hours(1), 'the time of the file, not of this program');
  assert.equal(Object.keys(d).filter((k) => /loaded|percent|lowest|cheapest|safe/i.test(k)).length, 0);
  assert.equal(tidy(r.deals, rules, NOW).deals.length, 1, 'it passes the final checks of the site');
});

await test('not cheaper than Steam by minSavings, or suspiciously cheap: not shown', async () => {
  const r = await run([], fileOf([item(1, { price: 21.5 }), item(2, { price: 30 }), item(3, { price: 35 }), item(4, { price: 3 }), item(5, { price: 20 })]));
  assert.deepEqual(titles(r.deals), ['Game 5'], '$21.50 is 28% below $30; $3 is 90% below');
  assert.equal(r.out.skipped.notCheaper, 3);
  assert.equal(r.out.skipped.tooGood, 1);
});

await test('the name must match Steam exactly: a Deluxe Edition is not compared with the standard game', async () => {
  const r = await run([], fileOf([item(1, { title: 'Game 1 Deluxe Edition PC (Steam)' }), item(2)]), {
    steam: async (title) => ({ appid: 2001, name: 'Game 1', pct: 90, total: 5000, descriptors: [] }),
  });
  assert.deepEqual(titles(r.deals), [], 'both are refused: the Steam name is "Game 1"');
  assert.equal(r.out.skipped.notSameName, 2, 'Deluxe, and Game 2 (the mock answers with the Steam name "Game 1" for both)');
  const r2 = await run([], fileOf([item(2)]), { steam: async () => ({ appid: 2002, name: 'Game 2', pct: 90, total: 5000, descriptors: [] }) });
  assert.deepEqual(titles(r2.deals), ['Game 2']);
});

await test('Steam checks: unknown game, few reviews, low score, adult content, no Steam price', async () => {
  const bad = [{ total: 100 }, { pct: 50 }, { descriptors: [3] }];
  const r1 = await run([], fileOf([item(1)]), { steam: async () => null });
  assert.equal(r1.out.skipped.notOnSteam, 1);
  for (const over of bad) assert.deepEqual(titles((await run([], fileOf([item(1)]), steamFor(over))).deals), [], JSON.stringify(over));
  const r2 = await run([], fileOf([item(1)]), { steamPrice: async () => null });
  assert.equal(r2.out.skipped.noSteamPrice, 1);
  const r3 = await run([], fileOf([item(1)]), { steam: async () => { throw new Error('down'); } });
  assert.equal(r3.out.skipped.steamError, 1);
  assert.ok(r3.ok);
});

await test('links: a bad link or an address that is not a PC Steam key is refused', async () => {
  const r = await run([], fileOf([item(1, { url: 'https://evil.example/game-1-pc-steam' }), item(2, { url: 'https://www.loaded.com/game-2-xbox' }), item(3)]));
  assert.deepEqual(titles(r.deals), ['Game 3']);
});

await test('limits: 5 new games a day, the most reviewed win, 15 in all', async () => {
  const items = Array.from({ length: 12 }, (_, i) => item(i + 1));
  const day1 = await run([], fileOf(items));
  assert.deepEqual(titles(day1.deals).sort(), ['Game 12', 'Game 11', 'Game 10', 'Game 9', 'Game 8'].sort());
  const day2 = await run(day1.deals, fileOf(items));
  assert.equal(titles(day2.deals).length, 10);
  const day3 = await run(day2.deals, fileOf(items));
  assert.equal(titles(day3.deals).length, 12);
  const many = Array.from({ length: 40 }, (_, i) => item(i + 1));
  let deals = [];
  for (let day = 0; day < 6; day++) deals = (await run(deals, fileOf(many))).deals;
  assert.equal(titles(deals).length, 15, 'never more than maxTotal');
});

await test('at most maxChecked new games are looked up in Steam in one run', async () => {
  let asked = 0;
  const many = Array.from({ length: 60 }, (_, i) => item(i + 1));
  const r = await run([], fileOf(many), { steam: async (t) => (asked++, steamFor().steam(t)) });
  assert.equal(asked, rules.loaded.maxChecked);
  assert.equal(r.out.skipped.notChecked, 60 - rules.loaded.maxChecked);
});

await test('an official store beats a key seller; Kinguin does not hide Loaded and Loaded does not hide Kinguin', async () => {
  const gog = { store: 'GOG', title: 'Game 3', steamId: 2003, price: 5, was: 10, discountPct: 50, url: 'https://www.gog.com/en/game/game_3', checkedAt: hours(1) };
  const r = await run([gog], fileOf([item(3), item(4)]));
  assert.deepEqual(titles(r.deals), ['Game 4']);
  assert.equal(r.out.skipped.officialHasIt, 1);

  const kinguinGame = { store: 'Kinguin', title: 'Game 5', steamId: 2005, price: 10, was: 30, discountPct: 67, url: 'https://www.kinguin.net/x', marketplace: true, compareTo: 'Steam', kinguinId: '1', checkedAt: hours(1) };
  const withKinguin = await run([kinguinGame], fileOf([item(5)]));
  assert.deepEqual(titles(withKinguin.deals), ['Game 5'], 'Loaded may offer a game that Kinguin has');

  const kFile = { generatedAt: hours(1), count: 1, deals: [{
    steamId: 2006, title: 'Game 6', kinguinName: 'Game 6', kinguinId: '77', price: 10, steamPrice: 30, steamWas: 30, steamDiscountPct: 0, savingsPct: 67,
    reviews: { total: 6000, positivePct: 90 }, stock: 10, region: 'Steam REGION FREE', image: '',
    url: `https://ficca2021.com/g/abc123def/?f_id=1&ulp=${encodeURIComponent('https://www.kinguin.net/en/category/77/game-6-pc-steam-cd-key')}`, checkedAt: hours(2),
  }] };
  const loadedOffer = (await run([], fileOf([item(6)]))).deals;
  const k = updateKinguin({ deals: loadedOffer, rules, now: NOW, file: kFile, isExcluded });
  assert.deepEqual(k.deals.filter((d) => d.marketplace).map((d) => d.store).sort(), ['Kinguin', 'Loaded'], 'both stay, the site shows the cheaper one');
});

await test('an excluded game is not shown', async () => {
  const r = await run([], fileOf([item(1), item(2)]), {}, { ...rules, exclude: ['game-1-pc-steam'] });
  assert.deepEqual(titles(r.deals), ['Game 2']);
});

await test('refresh, removal and the cover that was already found', async () => {
  const first = (await run([], fileOf([item(1), item(2)]))).deals;
  first.find((d) => d.title === 'Game 1').image = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2001/header.jpg';
  const next = await run(first, fileOf([item(1, { price: 10 }), item(3)]));
  assert.deepEqual(titles(next.deals).sort(), ['Game 1', 'Game 3']);
  const g1 = next.deals.find((d) => d.title === 'Game 1');
  assert.equal(g1.price, 10);
  assert.ok(g1.image.includes('/apps/2001/'), 'the cover is kept');
  assert.match(next.out.dropped.join(), /Game 2.*нет в свежем списке/);
  assert.match(next.out.refreshed.join(), /Game 1: \$12.00 → \$10.00/);
  // a game that stopped being cheap leaves with the reason
  const gone = await run(next.deals, fileOf([item(1, { price: 29 }), item(3)]));
  assert.match(gone.out.dropped.join(), /Game 1.*не дешевле/);
});

await test('a stale or broken file changes nothing', async () => {
  const first = (await run([], fileOf([item(1)]))).deals;
  for (const file of [fileOf([item(2)], { generatedAt: hours(40) }), { items: [] }, { generatedAt: 'x', items: [] }, null, { generatedAt: hours(1), items: 'no' }]) {
    const r = await run(first, file);
    assert.equal(r.ok, false);
    assert.deepEqual(r.deals, first);
    assert.ok(r.out.problems.length);
  }
});

await test('the real rules and settings: Loaded is not in any post, the link base is in accounts.json, the redirect exists', () => {
  const k = realRules.loaded;
  assert.equal(k.maxNew, 5);
  assert.equal(k.maxTotal, 15);
  assert.ok(k.minSavings >= 30 && k.maxSavings <= 85);
  assert.deepEqual(k.linkHosts, ['naiawork.com']);
  assert.equal(k.subid, 'site');
  assert.ok(BASE.startsWith('https://naiawork.com/g/'));
  for (const [id, a] of Object.entries(accountsFile.accounts)) assert.ok(!a.stores.includes('Loaded'), `${id} must not post Loaded (decision of 16 October)`);
  assert.ok(!readFileSync(here('./make-drafts.mjs'), 'utf8').match(/POST_STORES = \[[^\]]*Loaded/), 'make-drafts does not post Loaded');
  assert.match(readFileSync(here('../public/go/.htaccess'), 'utf8'), /\^\/go\/loaded\/\?\$ "https:\/\/naiawork\.com\/g\/[a-z0-9]+\/\?subid=site&ulp=/);
});

await test('loaded-fetch: a saved page -> data/loaded.json; a guard page or a changed markup -> exit 1 and no file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loaded-test-'));
  const go = (name, content) => {
    writeFileSync(join(dir, `${name}.html`), content);
    const out = join(dir, `${name}.json`);
    const res = spawnSync(process.execPath, [here('./loaded-fetch.mjs'), '--html', join(dir, `${name}.html`)], { env: { ...process.env, LOADED_OUT: out, LOADED_NOW: '2026-10-17T09:00:00Z', GITHUB_STEP_SUMMARY: '' }, encoding: 'utf8' });
    return { res, out };
  };
  const ok = go('ok', html);
  assert.equal(ok.res.status, 0, ok.res.stderr + ok.res.stdout);
  const file = JSON.parse(readFileSync(ok.out, 'utf8'));
  assert.equal(file.generatedAt, '2026-10-17T09:00:00.000Z');
  assert.ok(file.items.length >= 8 && file.items.every((i) => /-pc-steam$/.test(i.url) && i.price > 0 && i.title));
  assert.deepEqual(Object.keys(file).sort(), ['cardsOnPage', 'currency', 'generatedAt', 'items', 'source']);

  const blocked = go('blocked', '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>cf-chl</body></html>');
  assert.equal(blocked.res.status, 1);
  assert.ok(!existsSync(blocked.out), 'nothing is written');
  assert.match(blocked.res.stdout, /Обходить защиту мы не будем/);

  const changed = go('changed', page([card('Marathon PC (Steam)', 'marathon-pc-steam', one('19.99'))]));
  assert.equal(changed.res.status, 1);
  assert.ok(!existsSync(changed.out));
  assert.match(changed.res.stdout, /изменилась разметка/);
});

await test('the whole program on files: Loaded adds games, writes deals, history and a report; off by default', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loaded-test-'));
  const only = { ...realRules, gog: { ...realRules.gog, enabled: false }, indiegala: { enabled: false }, kinguin: { ...realRules.kinguin, enabled: false }, loaded: { ...realRules.loaded, enabled: true } };
  writeFileSync(join(dir, 'rules.json'), JSON.stringify(only));
  writeFileSync(join(dir, 'deals.json'), '[]');
  writeFileSync(join(dir, 'history.json'), '{}');
  const items = Array.from({ length: 8 }, (_, i) => item(i + 1));
  writeFileSync(join(dir, 'loaded.json'), JSON.stringify(fileOf(items, { generatedAt: new Date(Date.now() - 3600e3).toISOString() })));
  const mock = {};
  for (let n = 1; n <= 8; n++) {
    mock[`Game ${n}`] = { appid: 2000 + n, name: `Game ${n}`, pct: 90, total: n * 1000, descriptors: [] };
    mock[`price:${2000 + n}`] = 30;
  }
  writeFileSync(join(dir, 'steam.json'), JSON.stringify(mock));
  const env = {
    ...process.env, UPDATE_DEALS_AS_MODULE: '', UPDATE_NOW: new Date().toISOString(), RULES_FILE: join(dir, 'rules.json'), DEALS_FILE: join(dir, 'deals.json'),
    HISTORY_FILE: join(dir, 'history.json'), LOADED_FILE: join(dir, 'loaded.json'), STEAM_MOCK_FILE: join(dir, 'steam.json'), REPORT_DIR: dir, GITHUB_STEP_SUMMARY: '',
  };
  const res = spawnSync(process.execPath, [here('./update-deals.mjs')], { env, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr + res.stdout);
  const deals = JSON.parse(readFileSync(join(dir, 'deals.json'), 'utf8'));
  assert.equal(deals.length, 5, 'five new games on the first day');
  assert.ok(deals.every((d) => d.store === 'Loaded' && d.marketplace && d.compareTo === 'Steam' && d.affiliateUrl.startsWith('https://naiawork.com/g/')));
  assert.equal(Object.keys(JSON.parse(readFileSync(join(dir, 'history.json'), 'utf8'))).length, 5);
  assert.match(readFileSync(join(dir, 'deals-update.md'), 'utf8'), /## Loaded: обновлено 0, добавлено 5, убрано 0/);

  // Off by default: with the real rules the file is not even read.
  assert.equal(realRules.loaded.enabled, false);
  writeFileSync(join(dir, 'rules.json'), JSON.stringify({ ...only, loaded: { ...only.loaded, enabled: false } }));
  writeFileSync(join(dir, 'deals.json'), '[]');
  const off = spawnSync(process.execPath, [here('./update-deals.mjs')], { env, encoding: 'utf8' });
  assert.equal(off.status, 1, 'no store answered: nothing is written');
  assert.equal(readFileSync(join(dir, 'deals.json'), 'utf8'), '[]');
});

console.log(`\n${ran} tests passed.`);
