// Stage 1: drafts only. Publishes nothing and does not touch data/deals.json or the site.
//
//   npm run drafts
//
// 1. Reads data/deals.json.
// 2. drafts/deals.json = the same deals, but every GOG deal without an affiliate link gets an
//    Admitad link (subid=site). Links that are already there (for example Sovrn) are kept.
// 3. drafts/posts.md = ready-to-read Bluesky posts for the best GOG deals.
// 4. data/history.json = one price snapshot per deal per day (our own price history).
// 5. data/drafts-log.json = which deal was drafted on which day, so it is not offered again for a week.
//
// Look at the files in drafts/. If they are good, copy drafts/deals.json over data/deals.json by hand.

import { mkdir, readFile, writeFile } from 'node:fs/promises';

const DEALS = new URL('../data/deals.json', import.meta.url);
const HISTORY = new URL('../data/history.json', import.meta.url);
const LOG = new URL('../data/drafts-log.json', import.meta.url);
const OUT = new URL('../drafts/', import.meta.url);

// The numbers you may want to change.
const MIN_DISCOUNT = 50; // percent
const MAX_POSTS = 5; // posts per run
const REPEAT_DAYS = 7; // do not offer the same deal again for this many days
const MAX_AGE_HOURS = 48; // a price checked longer ago than this is not offered
const POST_LIMIT = 300; // Bluesky post length
const SITE = 'https://saveandplay.com';

// Admitad deeplink for GOG (template from docs/partners.md, section 4). Only GOG has one so far.
const GOG_LINK = 'https://qwpeg.com/g/q2orumsnydc9990a3d590704a7278f/';
const gogLink = (url, channel) => `${GOG_LINK}?subid=${channel}&ulp=${encodeURIComponent(url)}`;
// Stores we may post about (the table in docs/partners.md, section 3).
const POST_STORES = ['GOG', 'IndieGala'];
// Only these stores get a direct affiliate link next to the post. IndieGala: our site link only,
// until IndieGala confirms its rules for social networks (owner's decision, Oct 5).
const DIRECT_LINK_STORES = ['GOG'];

// Same as slug() in src/lib/deals.ts, so ids match the site.
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dealId = (d) => slug(`${d.store}-${d.title}`);
// Our own page with UTM tags, so Google Analytics can tell Bluesky from Mastodon.
const siteLink = (d, channel, day) => `${SITE}/deals/?store=${slug(d.store)}&utm_source=${channel}&utm_medium=social&utm_campaign=deals-${day}`;
const money = (n) => `$${n.toFixed(2)}`;
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const readJson = async (url, fallback) => {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch {
    return fallback;
  }
};
const save = (url, data) => writeFile(url, JSON.stringify(data, null, 2) + '\n');

const now = new Date();
const today = now.toISOString().slice(0, 10);
const deals = await readJson(DEALS, []);
const history = await readJson(HISTORY, {});
const log = await readJson(LOG, {});

// The site shows one card per game: the cheapest offer, same price GOG first, then IndieGala
// (same rule as src/lib/deals.ts). We do not post about an offer that is hidden there.
const storeRank = (store) => {
  const i = ['GOG', 'IndieGala'].indexOf(store);
  return i === -1 ? 99 : i;
};
const gameKey = (d) => {
  const steam = d.steamId ?? d.image?.match(/\/apps\/(\d+)\//)?.[1];
  return steam ? `steam-${steam}` : `title-${slug(d.title)}`;
};
const beats = (a, b) => (a.price !== b.price ? a.price < b.price : storeRank(a.store) < storeRank(b.store));
const bestOffer = new Map();
for (const d of deals) if (!bestOffer.has(gameKey(d)) || beats(d, bestOffer.get(gameKey(d)))) bestOffer.set(gameKey(d), d);
const onSite = new Set([...bestOffer.values()].map(dealId));

// 2. Draft copy of the deals with affiliate links.
let linked = 0;
const draftDeals = deals.map((d) => {
  if (d.store === 'GOG' && !d.affiliateUrl && d.url?.startsWith('https://www.gog.com/')) {
    linked++;
    return { ...d, affiliateUrl: gogLink(d.url, 'site') };
  }
  return d;
});

// 4. Price snapshot, once per day (a second run on the same day only refreshes today's line).
for (const d of deals) {
  const rows = (history[dealId(d)] ??= []);
  const row = { date: today, price: d.price, was: d.was };
  if (rows.at(-1)?.date === today) rows[rows.length - 1] = row;
  else rows.push(row);
}

// 3. Pick the deals for posts and say why the others were left out.
const skipped = { store: 0, hidden: 0, discount: 0, expired: 0, stale: 0, repeat: 0, later: 0 };
const picked = [];
for (const d of [...deals].sort((a, b) => b.discountPct - a.discountPct || a.price - b.price)) {
  const id = dealId(d);
  if (!POST_STORES.includes(d.store)) skipped.store++;
  else if (!onSite.has(id)) skipped.hidden++;
  else if (d.discountPct < MIN_DISCOUNT) skipped.discount++;
  else if (d.endsAt && new Date(d.endsAt) < now) skipped.expired++;
  else if (!d.checkedAt || now - new Date(d.checkedAt) > MAX_AGE_HOURS * 3600e3) skipped.stale++;
  else if (log[id] && log[id] !== today && (now - new Date(log[id])) / 86400e3 < REPEAT_DAYS) skipped.repeat++;
  else if (picked.length < MAX_POSTS) picked.push(d);
  else skipped.later++; // good deal, but today's posts are full: it will come up on a later run
}

const posts = picked.map((d) => {
  const text =
    `${d.title}: ${d.discountPct}% off at ${d.store}, ${money(d.price)} instead of ${money(d.was)}. ` +
    (d.endsAt ? `Sale ends ${day(d.endsAt)}. ` : '') +
    `Prices checked ${day(d.checkedAt)}. #ad`;
  // The link is added by the bot next to the text; count it as long as our site address.
  const length = text.length + 1 + SITE.length;
  return { d, text, length };
});

const md = [
  '# Bluesky post drafts',
  '',
  `Made ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC. Nothing here is published.`,
  `Rules: ${POST_STORES.join(' and ')} only, discount ${MIN_DISCOUNT}%+, sale not over, price checked within ${MAX_AGE_HOURS} h, not offered in the last ${REPEAT_DAYS} days.`,
  `Left out: ${skipped.store} other stores, ${skipped.hidden} hidden duplicates, ${skipped.discount} small discounts, ${skipped.expired} ended, ${skipped.stale} old prices, ${skipped.repeat} repeats. Good deals waiting for a later run: ${skipped.later}.`,
  '',
  ...(posts.length ? [] : ['No deals match the rules today.', '']),
  ...posts.flatMap(({ d, text, length }, i) => [
    `## ${i + 1}. ${d.title}`,
    '',
    text,
    '',
    `- Length: ${length}/${POST_LIMIT}${length > POST_LIMIT ? '  TOO LONG, shorten before posting' : ''}`,
    `- Link for Bluesky (our page): ${siteLink(d, 'bluesky', today)}`,
    `- Link for Mastodon (our page): ${siteLink(d, 'mastodon', today)}`,
    DIRECT_LINK_STORES.includes(d.store)
      ? `- Direct link for the ${d.store} test (subid=bluesky): ${gogLink(d.url, 'bluesky')}`
      : `- Direct link: none, ${d.store} posts use our site link only`,
    '',
  ]),
].join('\n');

await mkdir(OUT, { recursive: true });
await save(new URL('deals.json', OUT), draftDeals);
await writeFile(new URL('posts.md', OUT), md);
await save(HISTORY, history);
for (const { d } of posts) log[dealId(d)] = today;
await save(LOG, log);

console.log(`GOG links added: ${linked}. Posts prepared: ${posts.length}.`);
console.log(`Left out: ${JSON.stringify(skipped)}`);
console.log('Files: drafts/deals.json, drafts/posts.md, data/history.json, data/drafts-log.json');
