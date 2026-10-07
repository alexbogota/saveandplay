import dealsRaw from '../../data/deals.json';

export interface Deal {
  id: string;
  title: string;
  store: string;
  price: number;
  was: number;
  discount: number;
  url?: string;
  affiliateUrl?: string;
  cover?: string;
  tone?: string;
  updatedAt?: string;
  endsAt?: string;
}

interface RawDeal { store: string; title: string; was: number; price: number; discountPct: number; url: string; image?: string; checkedAt?: string; endsAt?: string; affiliateUrl?: string; steamId?: number }

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// One card per game. If several stores sell the same game, only the cheapest offer is shown.
// Same price: the store we earn more from wins (GOG first, then IndieGala).
// A game is recognised by its Steam number: the steamId field, or the number inside the Steam cover address.
// With neither, the title is used.
const storeRank = (store: string) => { const i = ['GOG', 'IndieGala'].indexOf(store); return i === -1 ? 99 : i; };
const gameKey = (d: RawDeal) => {
  const steam = d.steamId ?? d.image?.match(/\/apps\/(\d+)\//)?.[1];
  return steam ? `steam-${steam}` : `title-${slug(d.title)}`;
};
const beats = (a: RawDeal, b: RawDeal) => (a.price !== b.price ? a.price < b.price : storeRank(a.store) < storeRank(b.store));
const bestOffers = (list: RawDeal[]) => {
  const best = new Map<string, RawDeal>();
  for (const d of list) {
    const key = gameKey(d);
    const current = best.get(key);
    if (!current || beats(d, current)) best.set(key, d);
  }
  return list.filter((d) => best.get(gameKey(d)) === d);
};

// No cover image yet: use a flat colour tile (picked from the title so it stays stable).
const tones = ['#263553', '#43284F', '#1D4A47', '#573626', '#36462A', '#2F2F66', '#5A2B3A', '#244B5E'];
const toneFor = (s: string) => tones[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % tones.length];

const toDeal = (d: RawDeal): Deal => ({
  id: slug(`${d.store}-${d.title}`),
  title: d.title,
  store: d.store,
  price: d.price,
  was: d.was,
  discount: d.discountPct,
  url: d.url,
  affiliateUrl: d.affiliateUrl,
  cover: d.image || undefined,
  tone: toneFor(d.title),
  updatedAt: d.checkedAt,
  endsAt: d.endsAt,
});

// Real deals come from /data/deals.json. Best discount first.
export const allDeals: Deal[] = bestOffers(dealsRaw as RawDeal[])
  .map(toDeal)
  .sort((a, b) => b.discount - a.discount);

// One page per offer: /deals/<store>/<game>/. This includes the offers the cards hide as "cheaper in another store",
// so the address of any offer in data/deals.json works. The same address rule is in scripts/daily-brief.mjs (dealPagePath).
export const dealPath = (d: { store: string; title: string }) => `/deals/${slug(d.store)}/${slug(d.title)}/`;
export const dealPages: Deal[] = [...new Map((dealsRaw as RawDeal[]).map((d) => [dealPath(d), toDeal(d)])).values()];

// The home page shows the 8 best.
export const deals = allDeals.slice(0, 8);

// Stores that actually have deals, with how many.
export const storeList = [...new Set(allDeals.map((d) => d.store))]
  .sort()
  .map((name) => ({ name, slug: slug(name), count: allDeals.filter((d) => d.store === name).length }));

// Date prices were last checked: the newest checkedAt in the data file.
const newest = allDeals.map((d) => d.updatedAt).filter(Boolean).sort().at(-1);
export const lastChecked = newest
  ? new Date(`${newest.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
  : undefined;

export const featuredDeal: Deal | undefined = allDeals[0];

export const money = (n: number) => `$${n.toFixed(2)}`;

// All outgoing buttons go through our own redirect, so the affiliate network can be swapped in one place.
export const goUrl = (item: { store: string; id: string }) => `/go/${slug(item.store)}/${item.id}`;
