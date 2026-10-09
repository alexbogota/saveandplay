// Helpers of scripts/tag-research.mjs: which tags the accounts use, and what the open statistics of Mastodon say about a tag.
// Nothing here is estimated: a number is either in the answer of the Mastodon server or it is not shown.

import { gameTag } from './posts.mjs';

// Every tag written in data/accounts.json (channels of every account), with where it is used.
// Returns [{ tag, where: ['prices/bluesky: base', ...] }] sorted by tag. The names {store}, {niche}, {game} of the rotation pool are not tags;
// the tag of a game is made per game, so it is only researched on request (see gameTagsOf).
export function collectTags(accounts) {
  const found = new Map();
  const add = (tag, where) => {
    const key = tag.toLowerCase();
    if (!found.has(key)) found.set(key, { tag, where: [] });
    found.get(key).where.push(where);
  };
  for (const [id, account] of Object.entries(accounts)) {
    for (const [name, ch] of Object.entries(account.channels ?? {})) {
      const at = `${id}/${name}`;
      for (const t of ch.baseTags ?? []) add(t, `${at}: base`);
      for (const [store, t] of Object.entries(ch.storeTags ?? {})) add(t, `${at}: store ${store}`);
      for (const [store, t] of Object.entries(ch.nicheTags ?? {})) add(t, `${at}: niche ${store}`);
      for (const t of ch.rotatingTags ?? []) if (!t.startsWith('{')) add(t, `${at}: rotation`);
    }
  }
  return [...found.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

// The game tags of the current deals (only for channels that use gameTag). [{ tag, where: ['Shadow Tactics: Blades of the Shogun'] }]
export function gameTagsOf(deals) {
  const found = new Map();
  for (const d of deals) {
    const tag = gameTag(d.title);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (!found.has(key)) found.set(key, { tag, where: [] });
    found.get(key).where.push(d.title);
  }
  return [...found.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

// The answer of GET /api/v1/tags/:name has "history": the last 7 days, newest first, every day { day: unix time of 00:00 UTC, uses, accounts } as text.
// The first day is usually today, not over yet: it is not counted, so that a half day does not look like a quiet day.
// Returns { days, uses, avgUses, lastDay: { date, uses, accounts }, maxAccounts } or null when the answer has no history.
export function summarizeHistory(history, nowMs) {
  if (!Array.isArray(history)) return null;
  const todayStart = Math.floor(nowMs / 864e5) * 864e5;
  const rows = history
    .map((h) => ({ t: Number(h.day) * 1000, uses: Number(h.uses), accounts: Number(h.accounts) }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.uses) && Number.isFinite(r.accounts) && r.t < todayStart)
    .sort((a, b) => b.t - a.t);
  if (!rows.length) return { days: 0, uses: 0, avgUses: 0, lastDay: null, maxAccounts: 0 };
  const uses = rows.reduce((s, r) => s + r.uses, 0);
  const last = rows[0];
  return {
    days: rows.length,
    uses,
    avgUses: Math.round((uses / rows.length) * 10) / 10,
    lastDay: { date: new Date(last.t).toISOString().slice(0, 10), uses: last.uses, accounts: last.accounts },
    maxAccounts: Math.max(...rows.map((r) => r.accounts)),
  };
}
