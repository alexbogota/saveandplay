// Reading prices from GOG: the open catalog that gog.com itself uses (catalog.gog.com) and the sale end date on a game's page.
// Used by scripts/update-deals.mjs. Everything here is polite: robots.txt is checked, requests are spaced out,
// and api.gog.com is not used at all because its robots.txt forbids it.
//
// For tests the addresses can be replaced: GOG_CATALOG_URL, GOG_PAGE_ORIGIN.

import { fetchText, sleep, ZONES } from './feeds.mjs';

const catalogUrl = () => process.env.GOG_CATALOG_URL ?? 'https://catalog.gog.com/v1/catalog';
const pageOrigin = () => process.env.GOG_PAGE_ORIGIN ?? 'https://www.gog.com';

// A fetcher with a pause between requests (GOG is asked once per `pauseMs`, never faster).
export function makeClient({ ua, timeoutMs = 20000, pauseMs = 1000 }) {
  let last = 0;
  return async function get(url, accept = '*/*') {
    const wait = last + pauseMs - Date.now();
    if (wait > 0) await sleep(wait);
    const r = await fetchText(url, { ua, timeoutMs, accept, maxBytes: 5_000_000 });
    last = Date.now();
    return r;
  };
}

// ---------- the catalog ----------

// One product of the catalog -> the numbers we need, or null when the product has no usable US dollar price
// (coming soon, free, another currency, or the numbers do not agree with each other).
export function parseProduct(p) {
  const base = Number(p?.price?.baseMoney?.amount);
  const final = Number(p?.price?.finalMoney?.amount);
  if (!p?.slug || !p?.title || !(base > 0) || !(final > 0) || final > base) return null;
  if (p.price.baseMoney.currency !== 'USD' || (p.price.finalMoney.currency ?? 'USD') !== 'USD') return null;
  const pct = Math.round((1 - final / base) * 100);
  const said = parseInt(String(p.price.discount ?? '').replace(/[^\d]/g, ''), 10); // "-90%"
  if (Number.isFinite(said) && Math.abs(said - pct) > 2) return null;
  return {
    id: String(p.id ?? ''),
    slug: p.slug,
    title: p.title,
    type: p.productType ?? '',
    url: `https://www.gog.com/en/game/${p.slug}`,
    base,
    final,
    pct,
    publisher: p.publishers?.[0] ?? '',
    reviews: Number(p.reviewsCount) || 0,
    rating: Number(p.reviewsRating) || 0, // 0-50: 43 means 4.3 stars
    raw: p, // the product as GOG sent it (genres, tags, release date: used to check a niche)
  };
}

const query = (extra) => ['limit=48', 'countryCode=US', 'locale=en-US', 'currencyCode=USD', 'productType=in:game,pack', ...extra].join('&');

async function catalogJson(get, extra) {
  const r = await get(`${catalogUrl()}?${query(extra)}`, 'application/json');
  if (!r.ok) return { error: r.note };
  try {
    const data = JSON.parse(r.text);
    if (!Array.isArray(data.products)) return { error: 'в ответе каталога нет списка игр' };
    return { data };
  } catch {
    return { error: 'каталог ответил не JSON' };
  }
}

// The best-selling games that are on sale now (the first `pages` pages, 48 games each).
export async function topDiscounted(get, pages) {
  const products = [];
  const problems = [];
  for (let page = 1; page <= pages; page++) {
    const { data, error } = await catalogJson(get, ['order=desc:bestselling', 'discounted=eq:true', `page=${page}`]);
    if (error) {
      problems.push(`страница ${page}: ${error}`);
      continue;
    }
    products.push(...data.products.map(parseProduct).filter(Boolean));
    if (page >= (Number(data.pages) || 1)) break;
  }
  return { products, problems };
}

// The catalog search wants the title the way GOG writes it: apostrophes stay ("baldur's gate 3" is found, "baldur s gate 3" is not).
const searchText = (title) => title.replace(/[™®©]/g, '').replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

// The current price of one game we already list, found by its title and matched by the address name (slug).
// { product } | { product: null } (not found) | { error }. Up to three searches: the whole title, its first two words, its longest word.
export async function lookup(get, title, slug) {
  const words = searchText(title).split(' ').filter(Boolean);
  const longest = [...words].sort((a, b) => b.length - a.length)[0]?.replace(/'.*$/, '');
  const attempts = [...new Set([words.join(' '), words.slice(0, 2).join(' '), longest])].filter((a) => a && a.length >= 3);
  let error = null;
  for (const text of attempts) {
    const r = await catalogJson(get, [`query=like:${encodeURIComponent(text)}`]);
    if (r.error) {
      error = r.error;
      continue;
    }
    const hit = r.data.products.map(parseProduct).find((p) => p?.slug === slug);
    if (hit) return { product: hit, raw: r.data.products.find((p) => p?.slug === slug) };
  }
  return error ? { error } : { product: null };
}

// ---------- the sale end date on the game's page ----------

const pad = (n) => String(n).padStart(2, '0');
const offsetMinutes = (zone) => {
  const z = zone.toUpperCase();
  if (z === 'UTC' || z === 'GMT') return 0;
  const o = ZONES[z];
  return o ? (o[0] === '-' ? -1 : 1) * (Number(o.slice(1, 3)) * 60 + Number(o.slice(3, 5))) : null;
};

// "Offer ends on: 10/07/2026 09:59 EEST" -> "2026-10-07T09:59:00+03:00". null when the page has no such line,
// the zone is unknown, or the date is not within the next 60 days (then it is not an end date we can trust).
export function parseEndDate(html, now = Date.now()) {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const m = text.match(/Offer ends on:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([A-Za-z]{2,5})/i);
  if (!m) return null;
  const [a, b, year, hh, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  const [month, day] = a > 12 ? [b, a] : [a, b]; // the page writes MM/DD/YYYY; a first number above 12 can only be the day
  const off = offsetMinutes(m[6]);
  if (off == null || month < 1 || month > 12 || day < 1 || day > 31 || hh > 23) return null;
  const t = Date.UTC(year, month - 1, day, hh, mi) - off * 60000;
  if (t < now - 3600e3 || t > now + 60 * 864e5) return null;
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return `${year}-${pad(month)}-${pad(day)}T${pad(hh)}:${pad(mi)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// { iso } (date found) | { iso: null } (page opened, no date) | { error }
export async function endDate(get, gameUrl, now = Date.now()) {
  const r = await get(gameUrl.replace('https://www.gog.com', pageOrigin()), 'text/html');
  if (!r.ok) return { error: r.note };
  return { iso: parseEndDate(r.text, now) };
}
