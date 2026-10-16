// Steam lookups for our scripts: find a game's Steam app id, read its review score and content flags.
// Used only inside scripts to choose deals. Nothing from Steam is shown on the site.
//
//   const info = await steamInfo('Sifu Deluxe Edition', 30686);
//   // -> { appid, name, pct, total, desc, age, descriptors }  or  null when the game was not found
//
// How the game is found:
// 1. data/steam-ids.json (title -> app id, by hand) always wins.
// 2. Then the number the store put in its link (hint), but only if Steam's name for that number
//    is the same game. IndieGala often has the Steam number there, but not always.
// 3. Then Steam search; accepted only when the names are the same after cleaning
//    (same rules as scripts/fetch-steam-covers.mjs: case, ™/®, punctuation, edition words).
//
// Every answer is remembered in data/steam-cache.json for CACHE_DAYS days, so Steam is asked once.
// Real requests are 1.5 seconds apart.

import { readFile, writeFile } from 'node:fs/promises';

const CACHE_FILE = new URL('../data/steam-cache.json', import.meta.url);
const MANUAL_FILE = new URL('../data/steam-ids.json', import.meta.url);
const CACHE_DAYS = 14;
const UA = { 'user-agent': 'SaveAndPlay deals script' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = async (url, fallback) => {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch {
    return fallback;
  }
};

const EDITION =
  /\b(goty|game of the year|definitive|directors? cut|director s cut|general|complete|ultimate|deluxe|standard|enhanced|remastered|gold|legendary|premium|anniversary|digital|brutal|ritual|overlord)( edition)?\b|\bedition\b/g;
const clean = (s) =>
  s
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .trim();
const core = (s) => clean(s).replace(EDITION, '').replace(/\s+/g, ' ').trim();
const sameGame = (a, b) => clean(a) === clean(b) || (core(a) !== '' && core(a) === core(b));

const manual = await readJson(MANUAL_FILE, {});
const cache = await readJson(CACHE_FILE, { titles: {}, apps: {} });
const today = () => new Date().toISOString().slice(0, 10);
const fresh = (at) => at && (Date.now() - new Date(at)) / 864e5 < CACHE_DAYS;

let lastRequest = 0;
async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const wait = lastRequest + 1500 - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
      if (res.ok) return await res.json();
    } catch {}
    await sleep(1500 * attempt);
  }
  throw new Error(`Steam did not answer: ${url}`);
}

// Name, type, age limit and content flags of one app. null = Steam has nothing under this number.
async function details(appid) {
  const cached = cache.apps[appid];
  if (cached && fresh(cached.at) && cached.name) return cached;
  const data = (await getJson(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic,content_descriptors&cc=us&l=english`))?.[appid];
  if (!data?.success) return null;
  const d = data.data;
  const app = { ...cached, name: d.name, type: d.type, age: Number(d.required_age) || 0, descriptors: d.content_descriptors?.ids ?? [], at: today() };
  cache.apps[appid] = app;
  return app;
}

async function reviews(appid) {
  const app = cache.apps[appid];
  if (app?.total !== undefined && fresh(app.reviewsAt)) return app;
  const q = (await getJson(`https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`))?.query_summary;
  if (!q) return app;
  Object.assign(app, { pos: q.total_positive, total: q.total_reviews, desc: q.review_score_desc, reviewsAt: today() });
  return app;
}

async function search(title) {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&cc=us&l=english`;
  return ((await getJson(url)).items ?? []).filter((i) => i.type === 'app');
}

async function resolve(title, hint) {
  const known = cache.titles[title];
  if (known && fresh(known.at)) return known.id;
  let id = null;
  const tried = [manual[title], hint].filter(Boolean);
  for (const candidate of tried) {
    const app = await details(candidate);
    if (app && app.type === 'game' && (candidate === manual[title] || sameGame(app.name, title))) {
      id = candidate;
      break;
    }
  }
  if (!id) {
    const hit = (await search(title)).find((i) => sameGame(i.name, title));
    if (hit && (await details(hit.id))?.type === 'game') id = hit.id;
  }
  cache.titles[title] = { id, at: today() };
  return id;
}

// Genres, release date and content flags of one app, for the niche accounts (scripts/enrich-facts.mjs). null = Steam has nothing.
export async function steamAppData(appid) {
  const data = (await getJson(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic,genres,release_date,content_descriptors&cc=us&l=english`))?.[appid];
  return data?.success ? data.data : null;
}

export async function steamInfo(title, hint) {
  try {
    const appid = await resolve(title, hint);
    if (!appid) return null;
    const app = await reviews(appid);
    if (!app?.total) return null;
    return { appid, name: app.name, pct: Math.round((100 * app.pos) / app.total), total: app.total, desc: app.desc, age: app.age, descriptors: app.descriptors };
  } finally {
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 1) + '\n');
  }
}
