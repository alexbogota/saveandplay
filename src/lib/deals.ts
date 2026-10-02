import dealsRaw from '../../data/deals.json';

export interface Deal {
  id: string;
  title: string;
  store: string;
  price: number;
  was: number;
  discount: number;
  url?: string;
  cover?: string;
  tone?: string;
  updatedAt?: string;
}

interface RawDeal { store: string; title: string; was: number; price: number; discountPct: number; url: string; image?: string; checkedAt?: string }

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// No cover image yet: use a flat colour tile (picked from the title so it stays stable).
const tones = ['#263553', '#43284F', '#1D4A47', '#573626', '#36462A', '#2F2F66', '#5A2B3A', '#244B5E'];
const toneFor = (s: string) => tones[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % tones.length];

// Real deals come from /data/deals.json. Best discount first.
export const allDeals: Deal[] = (dealsRaw as RawDeal[])
  .map((d) => ({
    id: slug(`${d.store}-${d.title}`),
    title: d.title,
    store: d.store,
    price: d.price,
    was: d.was,
    discount: d.discountPct,
    url: d.url,
    cover: d.image || undefined,
    tone: toneFor(d.title),
    updatedAt: d.checkedAt,
  }))
  .sort((a, b) => b.discount - a.discount);

// The home page shows the 8 best.
export const deals = allDeals.slice(0, 8);

// Stores that actually have deals, with how many.
export const storeList = [...new Set(allDeals.map((d) => d.store))]
  .sort()
  .map((name) => ({ name, slug: slug(name), count: allDeals.filter((d) => d.store === name).length }));

// Date prices were last checked: the newest checkedAt in the data file.
const newest = allDeals.map((d) => d.updatedAt).filter(Boolean).sort().at(-1);
export const lastChecked = newest
  ? new Date(`${newest}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
  : undefined;

export const featuredDeal: Deal | undefined = allDeals[0];

export const money = (n: number) => `$${n.toFixed(2)}`;

// All outgoing buttons go through our own redirect, so the affiliate network can be swapped in one place.
export const goUrl = (item: { store: string; id: string }) => `/go/${slug(item.store)}/${item.id}`;
