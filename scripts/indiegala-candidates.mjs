// Makes a short list of IndieGala deal candidates. Publishes nothing and does not touch the site.
//
//   npm run indiegala
//
// 1. Downloads IndieGala's own sale feed (https://www.indiegala.com/store_games_rss?sale=true),
//    all pages, one request every 2 seconds.
// 2. Keeps games only: not DLC, sold in the US, a real discount end date (not "2050"),
//    old price from MIN_BASE dollars, discount from MIN_DISCOUNT percent,
//    and the publisher is on the KNOWN_PUBLISHERS list.
// 3. Takes at most MAX_PER_PUBLISHER games per publisher (so one company does not fill the list),
//    sorted by dollars saved.
// 4. Writes drafts/indiegala.md (to read) and drafts/indiegala.json (deals in the site format,
//    with our ref=... link). The cover is left empty on purpose: run "npm run covers" after
//    the deals are copied to data/deals.json.
//
// Idea for later (not built): ask Steam for the review score of each game and keep only the well
// reviewed ones. It would also show age ratings. Details are in PROJECT.md, section 10.

import { mkdir, writeFile } from 'node:fs/promises';

const FEED = 'https://www.indiegala.com/store_games_rss?sale=true';
const OUT = new URL('../drafts/', import.meta.url);
const REF = 'mmu5nmn'; // our IndieGala affiliate code

// The numbers you may want to change.
const MIN_BASE = 30; // old price, dollars
const MIN_DISCOUNT = 60; // percent
const MAX_PER_PUBLISHER = 3;
const MAX_CANDIDATES = 30;

// Publishers we trust to be well known. A name matches if it contains one of these words.
// Games from any other publisher are left out for now.
const KNOWN_PUBLISHERS = [
  'warner bros', 'frontier developments', 'kepler interactive', '505 games', 'team17',
  'playstation', 'koei tecmo', 'capcom', 'annapurna', 'bloober', 'konami', 'remedy',
  'hello games', 'disco elysium', 'red hook', 'private division', 'atari', 'snk corporation',
  'secret mode', 'dreamhaven', 'pathea', 'microids', 'square enix', 'sega', 'bandai namco',
  '2k', 'paradox', 'devolver', 'deep silver', 'thq nordic', 'bethesda', 'cd projekt',
  'focus entertainment', 'humble games', 'raw fury', 'larian',
];

const UA = { 'user-agent': 'SaveAndPlay deals script' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) =>
  s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const field = (xml, tag) => decode((xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [, ''])[1].trim());
const money = (n) => `$${n.toFixed(2)}`;

// 1. Download every page of the feed.
const items = [];
for (let page = 1, pages = 1; page <= pages; page++) {
  const res = await fetch(`${FEED}&page=${page}`, { headers: UA, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Feed page ${page}: HTTP ${res.status}`);
  const xml = await res.text();
  pages = Number(field(xml, 'totalPages')) || 1;
  items.push(...(xml.match(/<item>[\s\S]*?<\/item>/g) || []));
  console.log(`Feed page ${page} of ${pages}: ${items.length} items so far`);
  if (page < pages) await sleep(2000);
}

// 2. Filter.
const now = new Date();
const skipped = { otherEditions: 0, dlc: 0, region: 0, noEnd: 0, ended: 0, cheap: 0, smallDiscount: 0, publisher: 0 };
const good = [];
for (const it of items) {
  const usd = it.match(/<price currency="USD"[\s\S]*?<base>([\d.]+)<\/base>\s*<discountPercent>([\d.]+)<\/discountPercent>\s*<final>([\d.]+)<\/final>/);
  const publisher = field(it, 'publisher');
  const end = field(it, 'discountEnd');
  if (!usd) continue;
  const [base, pct, final] = [Number(usd[1]), Number(usd[2]), Number(usd[3])];
  if (field(it, 'isDLC') !== 'None') skipped.dlc++;
  else if (!/<regionAvailable>[^<]*\bUS\b/.test(it)) skipped.region++;
  else if (!end || end >= '2030') skipped.noEnd++;
  else if (new Date(end) < now) skipped.ended++;
  else if (base < MIN_BASE) skipped.cheap++;
  else if (pct < MIN_DISCOUNT) skipped.smallDiscount++;
  else if (!KNOWN_PUBLISHERS.some((p) => publisher.toLowerCase().includes(p))) skipped.publisher++;
  else good.push({ title: field(it, 'title'), publisher, link: field(it, 'link'), base, pct, final, end, drm: field(it, 'drminfo') });
}

// 3. One edition per game (the cheapest), at most a few per publisher, most dollars saved first.
const gameKey = (t) =>
  t
    .toLowerCase()
    .replace(/[™®]/g, '')
    .replace(/\s*[-:–]\s*(\w+\s+){0,2}edition$/, '')
    .replace(/\s*\b(digital deluxe|deluxe|ultimate|brutal|complete|ritual|overlord)( edition)?$/, '')
    .trim();
const cheapest = new Map();
for (const g of good) {
  const k = gameKey(g.title);
  if (!cheapest.has(k) || g.final < cheapest.get(k).final) cheapest.set(k, g);
}
const unique = good.filter((g) => cheapest.get(gameKey(g.title)) === g);
skipped.otherEditions = good.length - unique.length;
unique.sort((a, b) => b.base - b.final - (a.base - a.final));
const perPublisher = {};
const picked = unique
  .filter((g) => (perPublisher[g.publisher] = (perPublisher[g.publisher] || 0) + 1) <= MAX_PER_PUBLISHER)
  .slice(0, MAX_CANDIDATES);

// 4. Output.
const refLink = (url) => {
  const u = new URL(url);
  u.searchParams.set('ref', REF);
  return u.toString();
};
const checkedAt = now.toISOString();
const deals = picked.map((g) => ({
  store: 'IndieGala',
  title: g.title,
  currency: 'USD',
  was: g.base,
  price: g.final,
  discountPct: Math.round(g.pct),
  url: g.link,
  affiliateUrl: refLink(g.link),
  image: '',
  status: 'indiegala-feed',
  checkedAt,
  endsAt: g.end,
}));

const cell = (s) => s.replace(/\|/g, '/');
const md = [
  '# IndieGala candidates',
  '',
  `Made ${checkedAt.slice(0, 16).replace('T', ' ')} UTC from IndieGala's sale feed (${items.length} games on sale). Nothing here is published.`,
  `Rules: not DLC, sold in the US, real end date, old price from ${money(MIN_BASE)}, discount from ${MIN_DISCOUNT}%, known publisher, up to ${MAX_PER_PUBLISHER} per publisher.`,
  `Left out: ${JSON.stringify(skipped)}`,
  '',
  '| # | Game | Publisher | Price | Was | Off | Ends | Key type |',
  '|---|------|-----------|-------|-----|-----|------|----------|',
  ...picked.map((g, i) => `| ${i + 1} | [${cell(g.title)}](${refLink(g.link)}) | ${cell(g.publisher)} | ${money(g.final)} | ${money(g.base)} | ${Math.round(g.pct)}% | ${g.end.slice(0, 10)} | ${g.drm.replace(/\s+/g, ' ')} |`),
  '',
].join('\n');

await mkdir(OUT, { recursive: true });
await writeFile(new URL('indiegala.md', OUT), md);
await writeFile(new URL('indiegala.json', OUT), JSON.stringify(deals, null, 2) + '\n');

console.log(`Candidates: ${picked.length} (of ${unique.length} games that passed all rules).`);
console.log(`Left out: ${JSON.stringify(skipped)}`);
console.log('Files: drafts/indiegala.md, drafts/indiegala.json');
