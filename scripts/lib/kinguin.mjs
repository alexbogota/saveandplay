// Takes the ready list of Kinguin keys (data/kinguin.json of the public repo saveandplay-feeds) and turns it into entries of data/deals.json.
// Used by scripts/update-deals.mjs. The heavy work (reading the 100+ MB Kinguin feed, asking Steam for prices) is done in that other repo;
// here we only read its small result, check it again with our own rules and keep the daily limits.
//
// What is honest here:
//  - The price we compare with is the CURRENT Steam price (field "steamPrice" of the file). The "discount" that Kinguin shows itself is never used.
//  - "was" of the entry = that Steam price, and the entry says so: compareTo = "Steam". The site writes "Steam price", never a crossed-out "old price".
//  - marketplace = true: the site adds the notice about independent sellers on every Kinguin card and page (see src/lib/deals.ts).
//  - The time of the check (checkedAt) is the time the file's program asked Steam, not the time of this program.
//
// Safe by design: a file that is missing, broken or too old changes nothing (the old entries stay and disappear by themselves after
// dropOlderThanHours). Links are accepted only from the Admitad addresses listed in the rules and only when they lead to kinguin.net.

const HOUR = 3600e3;
const money = (n) => `$${Number(n).toFixed(2)}`;

export const STORE = 'Kinguin';

// The Steam number of a deal: the field, or the number inside the Steam cover address (the same rule as gameKey in src/lib/deals.ts).
export const steamIdOf = (d) => {
  const n = Number(d.steamId ?? d.image?.match(/\/apps\/(\d+)\//)?.[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// The link from the feed -> { affiliateUrl, pageUrl } or null. subid is put first, the same way as in our GOG links.
export function affiliateLink(raw, hosts, subid) {
  let u;
  let target;
  try {
    u = new URL(raw);
    target = new URL(u.searchParams.get('ulp'));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !hosts.includes(u.hostname) || !/^\/g\/[a-z0-9]+\/?$/i.test(u.pathname)) return null;
  if (target.protocol !== 'https:' || !/(^|\.)kinguin\.net$/.test(target.hostname)) return null;
  const affiliateUrl = u.searchParams.has('subid') ? raw : raw.replace('?', `?subid=${encodeURIComponent(subid)}&`);
  return { affiliateUrl, pageUrl: target.href };
}

const regionOf = (s) => (/region.?free/i.test(s ?? '') ? 'Region free' : /global/i.test(s ?? '') ? 'Global' : null);
const steamPicture = (url) => {
  try {
    return new URL(url).hostname.endsWith('steamstatic.com') ? url : '';
  } catch {
    return '';
  }
};

// One item of the file -> a deal for data/deals.json, or { why } (the reason it is not used).
export function toDeal(c, { k, steam, now, isExcluded, rules }) {
  const title = String(c?.title ?? '').replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
  const checked = Date.parse(c?.checkedAt);
  const ok =
    title && Number.isInteger(c.steamId) && c.steamId > 0 && typeof c.kinguinId === 'string' && c.kinguinId &&
    [c.price, c.steamPrice, c.reviews?.total, c.reviews?.positivePct].every(Number.isFinite) &&
    c.price > 0 && c.price < c.steamPrice && !Number.isNaN(checked) && checked <= now + 10 * 60e3;
  if (!ok) return { why: 'invalid' };
  const savings = Math.round((1 - c.price / c.steamPrice) * 100);
  if (Math.abs(savings - c.savingsPct) > 2) return { why: 'invalid' };
  if (savings < k.minSavings || savings > k.maxSavings) return { why: 'savings' };
  if (c.reviews.total < steam.minReviews) return { why: 'fewReviews' };
  if (c.reviews.positivePct < steam.minPositive) return { why: 'lowScore' };
  const region = regionOf(c.region);
  if (!region) return { why: 'noRegion' };
  const link = affiliateLink(c.url, k.linkHosts, k.subid);
  if (!link) return { why: 'badLink' };
  if (isExcluded(rules, { url: link.pageUrl, title })) return { why: 'excluded' };
  return {
    store: STORE,
    title,
    currency: 'USD',
    was: c.steamPrice,
    price: c.price,
    discountPct: savings,
    url: link.pageUrl,
    image: steamPicture(c.image),
    status: 'kinguin-feed',
    checkedAt: new Date(checked).toISOString(),
    affiliateUrl: link.affiliateUrl,
    steamId: c.steamId,
    kinguinId: c.kinguinId,
    compareTo: 'Steam',
    marketplace: true,
    region,
  };
}

// deals = the whole current list of data/deals.json (the other stores are already updated).
// Returns { deals, out, ok }. ok = false: the file cannot be used, nothing was changed.
export function updateKinguin({ deals, rules, now, file, isExcluded }) {
  const k = rules.kinguin;
  const out = {
    refreshed: [], dropped: [], added: [], problems: [], inFile: 0, valid: 0, fileAgeHours: null,
    skipped: { invalid: 0, savings: 0, fewReviews: 0, lowScore: 0, noRegion: 0, badLink: 0, excluded: 0, officialHasIt: 0, duplicate: 0 },
  };
  const age = (now - Date.parse(file?.generatedAt)) / HOUR;
  if (!Array.isArray(file?.deals) || Number.isNaN(age)) {
    out.problems.push('файл не похож на готовый список Kinguin (нет generatedAt или deals)');
    return { deals, out, ok: false };
  }
  out.fileAgeHours = Math.round(age * 10) / 10;
  if (age > k.maxFileAgeHours) {
    out.problems.push(`файлу Kinguin ${out.fileAgeHours} ч, а можно не больше ${k.maxFileAgeHours} ч: цены в нём устарели, ничего не добавляю`);
    return { deals, out, ok: false };
  }

  const existing = deals.filter((d) => d.store === STORE);
  const others = deals.filter((d) => d.store !== STORE);
  const official = new Set(others.map(steamIdOf).filter(Boolean)); // a game that an official store already sells is not shown from a marketplace
  const oldById = new Map(existing.map((d) => [d.kinguinId, d]));
  out.inFile = file.deals.length;

  // 1. Every item of the file is checked again with our own rules. The most reviewed games come first.
  const ctx = { k, steam: rules.steam, now, isExcluded, rules };
  const valid = [];
  const seen = new Set();
  const refusal = new Map(); // kinguinId -> why, to explain the removal of an old entry
  const byReviews = [...file.deals].sort((a, b) => (b?.reviews?.total ?? 0) - (a?.reviews?.total ?? 0));
  for (const c of byReviews) {
    const r = toDeal(c, ctx);
    if (r.why) {
      out.skipped[r.why]++;
      refusal.set(c?.kinguinId, r.why);
    } else if (official.has(r.steamId)) {
      out.skipped.officialHasIt++;
      refusal.set(r.kinguinId, 'officialHasIt');
    } else if (seen.has(r.steamId)) {
      out.skipped.duplicate++;
    } else {
      seen.add(r.steamId);
      valid.push(r);
    }
  }
  out.valid = valid.length;

  // 2. What is already on the site stays while it is still in the list; new games come in with the daily limit.
  const keep = valid
    .filter((d) => oldById.has(d.kinguinId))
    .slice(0, k.maxTotal)
    .map((d) => {
      const old = oldById.get(d.kinguinId);
      out.refreshed.push(old.price !== d.price ? `${d.title}: ${money(old.price)} → ${money(d.price)} (Steam ${money(d.was)})` : `${d.title}: без изменений`);
      return !d.image && old.image ? { ...d, image: old.image } : d; // a cover already found is kept
    });
  const room = Math.min(k.maxNew, Math.max(0, k.maxTotal - keep.length));
  const fresh = valid.filter((d) => !oldById.has(d.kinguinId)).slice(0, room);
  for (const d of fresh) out.added.push(`${d.title}: ${money(d.price)} вместо ${money(d.was)} в Steam (−${d.discountPct}%)`);

  const why = {
    savings: 'скидка к Steam вне допустимых границ',
    fewReviews: 'мало отзывов в Steam',
    lowScore: 'низкая оценка в Steam',
    officialHasIt: 'эту игру теперь продаёт обычный магазин',
    excluded: 'игра в списке exclude',
    badLink: 'ссылка не прошла проверку',
    invalid: 'запись в файле повреждена',
    noRegion: 'регион не указан',
  };
  const keptIds = new Set(keep.map((d) => d.kinguinId));
  for (const old of existing) {
    if (keptIds.has(old.kinguinId)) continue;
    const reason = refusal.has(old.kinguinId) ? why[refusal.get(old.kinguinId)] : valid.some((d) => d.kinguinId === old.kinguinId) ? 'лимит на сайте' : 'её нет в свежем списке';
    out.dropped.push(`${old.title}: ${reason}`);
  }
  return { deals: [...others, ...keep, ...fresh], out, ok: true };
}
