// Fills the "image" field of data/deals.json with the Steam header picture of each game.
//
//   npm run covers            fill only deals that have an empty image
//   npm run covers -- --all   look every deal up again and overwrite images
//
// 1. data/steam-ids.json maps a deal title to a Steam app id by hand. It is checked first
//    and always wins; Steam search is used only for titles that are not listed there.
// 2. Search accepts a game only when the names are the same after cleaning
//    (case, ™/®, punctuation, "The", and edition words like "Director's Cut" are ignored).
//    Anything else goes to the "doubtful" or "not found" list and keeps image = "".
// 3. The picture address is NOT built by hand. It is taken from Steam's own answer
//    (appdetails -> header_image), because newer games use addresses with a hash in them.
// 4. At the end every image address in the file is requested; the ones that do not open are listed.

import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('../data/deals.json', import.meta.url);
const redo = process.argv.includes('--all');
const UA = { 'user-agent': 'SaveAndPlay cover script' };
// Every request gives up after 15 seconds instead of hanging forever.
const timeout = () => AbortSignal.timeout(15000);

let manual = {};
try {
  manual = JSON.parse(await readFile(new URL('../data/steam-ids.json', import.meta.url), 'utf8'));
} catch {}

// Words that only describe an edition, not a different game.
const EDITION =
  /\b(goty|game of the year|definitive|directors? cut|director s cut|general|complete|ultimate|deluxe|standard|enhanced|remastered|gold|legendary|premium|anniversary)( edition)?\b|\bedition\b/g;

const clean = (s) =>
  s
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .trim();

const core = (s) => clean(s).replace(EDITION, '').replace(/\s+/g, ' ').trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: UA, signal: timeout() });
      if (res.ok) return await res.json();
    } catch {}
    await sleep(1500 * attempt);
  }
  throw new Error(`request failed: ${url}`);
}

async function search(term) {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=us&l=english`;
  return ((await getJson(url)).items ?? []).filter((i) => i.type === 'app');
}

// Returns the header picture address that Steam itself gives for this app, or '' if none.
async function headerImage(appid) {
  const data = (await getJson(`https://store.steampowered.com/api/appdetails?appids=${appid}`))?.[appid];
  return data?.success ? (data.data?.header_image ?? '') : '';
}

async function opens(url) {
  try {
    const res = await fetch(url, { headers: UA, signal: timeout() });
    return res.ok && (res.headers.get('content-type') ?? '').startsWith('image/');
  } catch {
    return false;
  }
}

const deals = JSON.parse(await readFile(FILE, 'utf8'));
const filled = [];
const doubtful = [];
const missing = [];
let kept = 0;

let n = 0;
for (const deal of deals) {
  console.log(`[${++n}/${deals.length}] ${deal.title}`);
  const manualId = manual[deal.title];
  if (!manualId && deal.image && !redo) {
    kept++;
    continue;
  }
  deal.image = '';

  try {
    let appid = manualId;
    let note = '[manual]';
    let name = '';

    if (!appid) {
      const items = await search(deal.title);
      const exact = items.find((i) => clean(i.name) === clean(deal.title));
      const base = core(deal.title);
      const hit = exact ?? items.find((i) => base && core(i.name) === base);
      if (!hit) {
        (items.length ? doubtful : missing).push(
          items.length
            ? `${deal.title} (${deal.store})  ?  Steam offered: ${items.slice(0, 3).map((i) => i.name).join(' | ')}`
            : `${deal.title} (${deal.store})`,
        );
        await sleep(400);
        continue;
      }
      appid = hit.id;
      name = ` → ${hit.name}`;
      note = exact ? '' : '[edition name differs]';
    }

    const image = await headerImage(appid);
    if (image) {
      deal.image = image;
      filled.push(`${deal.title}${name} (app ${appid}) ${note}`.trim());
    } else {
      missing.push(`${deal.title} (${deal.store}): app ${appid} found, but Steam gave no header_image`);
    }
  } catch (e) {
    missing.push(`${deal.title} (${deal.store}): ${e.message}`);
  }
  await sleep(400);
}

await writeFile(FILE, JSON.stringify(deals, null, 2) + '\n');

// Final check: does every image address really open?
const broken = [];
for (const deal of deals) {
  if (deal.image && !(await opens(deal.image))) broken.push(`${deal.title}: ${deal.image}`);
}

const list = (title, rows) => {
  console.log(`\n${title}: ${rows.length}`);
  rows.forEach((r) => console.log('  - ' + r));
};
const unusedManual = Object.keys(manual).filter((t) => !deals.some((d) => d.title === t));

console.log(`Deals in file: ${deals.length}` + (kept ? `, left as they were: ${kept}` : ''));
if (unusedManual.length) list('Titles in steam-ids.json that match no deal (check spelling)', unusedManual);
list('Covers set this run', filled);
list('Doubtful (image left empty)', doubtful);
list('Not found / no picture (image left empty)', missing);
list('Image address does NOT open', broken);
const working = deals.filter((d) => d.image).length - broken.length;
console.log(`\nWorking covers: ${working} of ${deals.length}`);
