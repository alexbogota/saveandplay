// Addresses of our own pages of the games. The same rule as dealPath in src/lib/deals.ts (keep them in sync).
export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const dealPagePath = (d) => `/deals/${slug(d.store)}/${slug(d.title)}/`;
