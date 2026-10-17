// Loaded (formerly CDKeys) in the daily price update. Two parts:
//
//  1. parsePage(html): reads the deals page https://www.loaded.com/cdkeys-deals and keeps only FACTS: the name, the price and the address
//     of each product card. No pictures, no texts, no "old price" and no percent of Loaded (we do not know what they are measured against).
//     Used by scripts/loaded-fetch.mjs, which writes data/loaded.json.
//  2. updateLoaded(...): turns that small file into entries of data/deals.json, with our own rules and daily limits. Used by scripts/update-deals.mjs.
//
// What is honest here (the same idea as for Kinguin, scripts/lib/kinguin.mjs):
//  - The price we compare with is the CURRENT Steam price in dollars (asked at the time of the run). "was" of the entry = that Steam price and
//    compareTo = "Steam": the site writes "Steam price", never a crossed-out "old price". A key is shown only when it is cheaper than Steam by
//    minSavings % or more; a key that costs the same or more has no deal in it, so it is not shown at all.
//  - A game is accepted only when its cleaned name is EXACTLY the name of the Steam game (so a "Deluxe Edition" is never compared with the
//    standard game). A doubt means skip.
//  - Only the page address that really stood on the Loaded page is used, never one made up from a name. Only "-pc-steam" keys.
//  - The price is the price of the US region (the page is read from a US address). The region of the key itself is not known: the site says so.
//
// Safe by design: a file that is missing, broken or too old changes nothing (the old entries stay and disappear by themselves after
// dropOlderThanHours). Links are accepted only from the Admitad addresses listed in the rules and only when they lead to loaded.com.

import { steamIdOf } from './kinguin.mjs';

const HOUR = 3600e3;
const money = (n) => `$${Number(n).toFixed(2)}`;

export const STORE = 'Loaded';
export const PAGE = 'https://www.loaded.com/cdkeys-deals';

// ---------- 1. the page ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', trade: '™', reg: '®', copy: '©' };
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
const text = (html) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// A page of Cloudflare or another guard instead of the deals. We stop there; we never try to get around it.
export function looksBlocked(status, html) {
  return status === 403 || status === 429 || status === 503 || /<title>\s*(just a moment|attention required|access denied)/i.test(html ?? '');
}

// The cleaned address of a product: https, loaded.com, one path word, no query. Anything else -> null.
export function productUrl(href) {
  try {
    const u = new URL(href, 'https://www.loaded.com/');
    if (u.protocol !== 'https:' || !/^(www\.)?loaded\.com$/.test(u.hostname) || u.search || u.hash) return null;
    if (!/^\/[a-z0-9][a-z0-9-]*$/.test(u.pathname)) return null;
    return `https://www.loaded.com${u.pathname}`;
  } catch {
    return null;
  }
}

const AMOUNT = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/g;
const amounts = (s) => [...s.matchAll(AMOUNT)].map((m) => Number(m[1].replace(/,/g, '')));

// The cards of the page (div.product-item) -> [{ title, url, price }]. A card without a clear name, address or ONE clear price is skipped.
// seen = how many cards the page had (a page with a handful of cards means the markup has changed: the caller decides).
export function parsePage(html) {
  const starts = [...html.matchAll(/<div\b[^>]*\bclass="[^"]*(?<![-\w])product-item(?![-\w])[^"]*"[^>]*>/gi)].map((m) => m.index);
  const items = [];
  const bad = { noLink: 0, noName: 0, noPrice: 0, twoPrices: 0, duplicate: 0 };
  const urls = new Set();
  starts.forEach((from, i) => {
    const block = html.slice(from, starts[i + 1] ?? from + 12000);
    const anchors = [...block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({ attrs: m[1], inner: m[2], href: m[1].match(/\bhref="([^"]+)"/i)?.[1] }));
    const linked = anchors.filter((a) => a.href && productUrl(decode(a.href)));
    const a = linked.find((x) => /product-item-link/.test(x.attrs)) ?? linked[0];
    if (!a) return void bad.noLink++;
    const url = productUrl(decode(a.href));
    const title = text(a.inner) || decode(a.attrs.match(/\btitle="([^"]+)"/i)?.[1] ?? '').trim();
    if (!title) return void bad.noName++;
    // The price: the special price when the card has one, else the only dollar amount of the card. Two different amounts and no marker = unclear, skip.
    const special = block.search(/special-price/i);
    const all = [...new Set(amounts(text(block)))];
    const price = special >= 0 ? amounts(text(block.slice(special)))[0] : all.length === 1 ? all[0] : undefined;
    if (price === undefined) return void (all.length ? bad.twoPrices++ : bad.noPrice++);
    if (urls.has(url)) return void bad.duplicate++;
    urls.add(url);
    items.push({ title, url, price });
  });
  return { items, seen: starts.length, bad };
}

// Words of keys that are not a PC game: other consoles, in-game money, cards. The Steam check would drop most of them anyway.
const NOT_PC_GAME = /\b(xbox|playstation|ps[345]|nintendo|switch|gift card|fc points|points|currency|v-?bucks|coins?|dlc|subscription|game pass|membership|wallet)\b/i;

// The list of the page -> candidates for the file: PC Steam keys only (the address ends with -pc-steam). Returns { items, skipped }.
export function candidates(items) {
  const skipped = { notSteamKey: 0, notAGame: 0 };
  const keep = [];
  for (const it of items) {
    if (!/-pc-steam$/.test(it.url)) skipped.notSteamKey++;
    else if (NOT_PC_GAME.test(it.title)) skipped.notAGame++;
    else keep.push(it);
  }
  return { items: keep, skipped };
}

// ---------- 2. the deals ----------

// "Marathon PC (Steam)" -> "Marathon". Only the platform words around the name are removed; Steam then has to confirm the name exactly.
export const cleanTitle = (t) => {
  let s = String(t ?? '').replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*[([](?:pc\s*)?(?:steam|ww|global|worldwide|us|eu|row|key|cd key|digital)[^)\]]*[)\]]/gi, '');
  for (let i = 0; i < 4; i++) s = s.replace(/\s+(pc|steam|cd key|key|global|ww|worldwide|digital)\s*$/i, '');
  return s.trim();
};
// The same cleaning as the Steam lookup uses for names (scripts/steam.mjs), without dropping edition words.
export const nameKey = (s) =>
  String(s ?? '').toLowerCase().replace(/[™®©]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/^the /, '').trim();

// base = the deeplink of the programme (accounts.links.loadedDeeplink). Returns { affiliateUrl, pageUrl } or null.
export function affiliateLink(base, pageUrl, hosts, subid) {
  let b;
  try {
    b = new URL(base);
  } catch {
    return null;
  }
  const page = productUrl(pageUrl);
  if (!page || b.protocol !== 'https:' || !hosts.includes(b.hostname) || !/^\/g\/[a-z0-9]+\/?$/i.test(b.pathname) || b.search) return null;
  return { affiliateUrl: `${b.origin}${b.pathname}?subid=${encodeURIComponent(subid)}&ulp=${encodeURIComponent(page)}`, pageUrl: page };
}

// deals = the whole current list of data/deals.json (GOG, IndieGala and Kinguin are already updated).
// steam(title) -> { appid, name, pct, total, descriptors } | null; steamPrice(appid) -> dollars | null; link(pageUrl) -> { affiliateUrl, pageUrl } | null.
// Returns { deals, out, ok }. ok = false: the file cannot be used, nothing was changed.
export async function updateLoaded({ deals, rules, now, file, isExcluded, steam, steamPrice, link }) {
  const k = rules.loaded;
  const s = rules.steam;
  const out = {
    refreshed: [], dropped: [], added: [], problems: [], inFile: 0, fileAgeHours: null, checked: 0, valid: 0,
    skipped: { invalid: 0, notOnSteam: 0, notSameName: 0, fewReviews: 0, lowScore: 0, adult: 0, noSteamPrice: 0, notCheaper: 0, tooGood: 0, badLink: 0, excluded: 0, officialHasIt: 0, duplicate: 0, steamError: 0, notChecked: 0 },
  };
  const age = (now - Date.parse(file?.generatedAt)) / HOUR;
  if (!Array.isArray(file?.items) || Number.isNaN(age)) {
    out.problems.push('файл не похож на список Loaded (нет generatedAt или items)');
    return { deals, out, ok: false };
  }
  out.fileAgeHours = Math.round(age * 10) / 10;
  if (age > k.maxFileAgeHours) {
    out.problems.push(`файлу Loaded ${out.fileAgeHours} ч, а можно не больше ${k.maxFileAgeHours} ч: цены в нём устарели, ничего не добавляю`);
    return { deals, out, ok: false };
  }
  out.inFile = file.items.length;

  const existing = deals.filter((d) => d.store === STORE);
  const others = deals.filter((d) => d.store !== STORE);
  const official = new Set(others.filter((d) => !d.marketplace).map(steamIdOf).filter(Boolean)); // a game an official store sells is not shown from a key seller
  const oldByUrl = new Map(existing.map((d) => [d.url, d]));
  const checkedAt = new Date(Date.parse(file.generatedAt)).toISOString();

  // One item -> a deal, or { why }.
  const judge = async (it) => {
    const price = Number(it?.price);
    const title = cleanTitle(it?.title);
    const l = link(it?.url);
    if (!title || !(price > 0) || !l || !/-pc-steam$/.test(l.pageUrl)) return { why: l ? 'invalid' : 'badLink' };
    if (isExcluded(rules, { url: l.pageUrl, title })) return { why: 'excluded' };
    let info;
    try {
      info = await steam(title);
    } catch {
      return { why: 'steamError' };
    }
    if (!info) return { why: 'notOnSteam' };
    if (nameKey(info.name) !== nameKey(title)) return { why: 'notSameName' };
    if (info.total < s.minReviews) return { why: 'fewReviews' };
    if (info.pct < s.minPositive) return { why: 'lowScore' };
    if (info.descriptors?.some((x) => s.adultFlags.includes(x))) return { why: 'adult' };
    if (official.has(info.appid)) return { why: 'officialHasIt' };
    let steamUsd;
    try {
      steamUsd = await steamPrice(info.appid);
    } catch {
      return { why: 'steamError' };
    }
    if (!(steamUsd > 0)) return { why: 'noSteamPrice' };
    const savings = Math.round((1 - price / steamUsd) * 100);
    if (savings < k.minSavings) return { why: 'notCheaper' };
    if (savings > k.maxSavings) return { why: 'tooGood' };
    return {
      deal: {
        store: STORE,
        title: info.name.replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim(),
        currency: 'USD',
        was: steamUsd,
        price,
        discountPct: savings,
        url: l.pageUrl,
        image: '',
        status: 'loaded-page',
        checkedAt,
        affiliateUrl: l.affiliateUrl,
        steamId: info.appid,
        compareTo: 'Steam',
        marketplace: true,
        priceRegion: k.priceRegion,
      },
      reviews: info.total,
    };
  };

  // 1. Games already on the site are checked first (their price is refreshed or they leave). Then up to maxChecked new ones are looked up
  //    in Steam (it is slow: one request per 1.5 s) and the most reviewed of those that pass win the daily places (maxNew, maxTotal).
  const byUrl = new Map();
  for (const it of file.items) {
    const l = link(it?.url);
    if (l && !byUrl.has(l.pageUrl)) byUrl.set(l.pageUrl, it);
    else out.skipped.duplicate++;
  }
  const refusal = new Map(); // page address -> why, to explain the removal of an old entry
  const keepCandidates = [];
  for (const [url, it] of byUrl) {
    if (!oldByUrl.has(url)) continue;
    out.checked++;
    const r = await judge(it);
    if (r.deal) keepCandidates.push(r);
    else (refusal.set(url, r.why), out.skipped[r.why]++);
  }
  const keep = keepCandidates.filter((r, i, a) => a.findIndex((x) => x.deal.steamId === r.deal.steamId) === i).slice(0, k.maxTotal).map((r) => {
    const old = oldByUrl.get(r.deal.url);
    out.refreshed.push(old.price !== r.deal.price ? `${r.deal.title}: ${money(old.price)} → ${money(r.deal.price)} (Steam ${money(r.deal.was)})` : `${r.deal.title}: без изменений`);
    return !r.deal.image && old.image ? { ...r.deal, image: old.image } : r.deal; // a cover already found is kept
  });

  const room = Math.min(k.maxNew, Math.max(0, k.maxTotal - keep.length));
  const taken = new Set(keep.map((d) => d.steamId));
  const found = [];
  let looked = 0;
  for (const [url, it] of byUrl) {
    if (oldByUrl.has(url) || room === 0) continue;
    if (looked >= k.maxChecked) {
      out.skipped.notChecked++;
      continue;
    }
    looked++;
    out.checked++;
    const r = await judge(it);
    if (!r.deal) out.skipped[r.why]++;
    else if (taken.has(r.deal.steamId)) out.skipped.duplicate++;
    else {
      taken.add(r.deal.steamId);
      found.push(r);
    }
  }
  const added = found.sort((a, b) => b.reviews - a.reviews).slice(0, room).map((r) => r.deal); // the most reviewed games win
  out.valid = keep.length + found.length;
  for (const d of added) out.added.push(`${d.title}: ${money(d.price)} вместо ${money(d.was)} в Steam (−${d.discountPct}%)`);

  const why = {
    invalid: 'запись в файле повреждена',
    badLink: 'ссылка не прошла проверку',
    excluded: 'игра в списке exclude',
    notOnSteam: 'игру не нашли в Steam',
    notSameName: 'название не совпало со Steam точно (другое издание?)',
    fewReviews: 'мало отзывов в Steam',
    lowScore: 'низкая оценка в Steam',
    adult: 'взрослый контент',
    officialHasIt: 'эту игру теперь продаёт обычный магазин',
    noSteamPrice: 'у Steam нет цены',
    notCheaper: 'ключ уже не дешевле Steam на нужную долю',
    tooGood: 'ключ слишком дешёвый, это подозрительно',
    steamError: 'Steam не ответил',
  };
  const keptUrls = new Set(keep.map((d) => d.url));
  for (const old of existing) {
    if (keptUrls.has(old.url)) continue;
    const reason = refusal.has(old.url) ? why[refusal.get(old.url)] : byUrl.has(old.url) ? 'лимит на сайте' : 'её нет в свежем списке';
    out.dropped.push(`${old.title}: ${reason}`);
  }
  return { deals: [...others, ...keep, ...added], out, ok: true };
}
