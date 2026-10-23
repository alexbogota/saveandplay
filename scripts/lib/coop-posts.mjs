// "Play together" posts for Bluesky: a game from data/coop-games.json and a link to its page /servers/<slug>/ (decided 22 Oct 2026, docs/decisions.md).
// Used by scripts/post-bluesky.mjs: `show` adds one such post for every account that asks for it, the owner approves it with the others ("ок все"),
// the sender checks it again and posts it. No model writes anything: the lines come from the "posts" of the game, the frame from the account.
//
// Settings (data/accounts.json): accounts.<id>.channels.bluesky.coop = {
//   enabled: true,
//   anyTags: ["cozy"],          the account takes games that have at least one of these tags (data/coop-games.json, "tags"); ["*"] = every game
//   everyDays: 2,               at most one such post every N days (the day in Bogota)
//   baseTags: ["CozyGames"],    hashtags of every such post; the game's own "hashtag" is added
//   template: ["{text}", "{link}", "{tags}\n{disclosure}"]   blocks joined with an empty line
// }
// The game: the one this account posted least recently (never posted first, then the order of the file: hand-made games, then the most reviewed).
// The line: the next one of its "posts"; a game made by the program (auto) has none and gets lines from what Steam lists (autoLines).
// The link has utm_campaign=coop-YYYY-MM-DD: the day of the post (an old approval is refused) and the mark that it is a "play together" post.

import { readFileSync } from 'node:fs';
import { file } from './comments.mjs';
import { SITE, graphemes, MAX_GRAPHEMES, shortenForPost, dayKey, itemKey } from './bsky-posts.mjs';

export const COOP_DEFAULTS = { enabled: false, anyTags: [], everyDays: 2, baseTags: [], template: ['{text}', '{link}', '{tags}\n{disclosure}'] };

export function readCoopGames() {
  try { return JSON.parse(readFileSync(file('data', 'coop-games.json'), 'utf8')).games ?? []; } catch { return []; }
}

// Ready lines of a game: its own "posts", or for a program game the lines made from Steam's multiplayer flags (nothing else is claimed).
export function autoLines(g) {
  const t = g.title;
  const f = g.steam ?? {};
  if (f.coop || f.onlineCoop) {
    const co = f.onlineCoop ? 'online co-op' : 'co-op';
    return [
      `${t} has ${co} on Steam.\nA rented server keeps your world online when the host logs off.`,
      `Playing ${t} with friends? Steam lists ${co}.\nA game server means nobody has to host from their own PC.`,
      `A shared ${t} world that is always online: that is what a rented server is for.\nSteam lists ${co} for the game.`,
    ];
  }
  return [
    `${t} is a multiplayer game on Steam.\nA rented server keeps your own world or community online around the clock.`,
    `Want your own ${t} server? A rented one stays online when you log off.`,
    `Running a ${t} server for friends or a community? Here is what a rented server gives you.`,
  ];
}
export const postLines = (g) => ((g.posts ?? []).length ? g.posts : g.auto ? autoLines(g) : []);

export const coopSettings = (acc) => (acc?.channel?.coop ? { ...COOP_DEFAULTS, ...acc.channel.coop } : null);

export function coopSettingsProblems(s) {
  const p = [];
  if (!Array.isArray(s.anyTags) || !s.anyTags.length) p.push('coop.anyTags must list at least one tag');
  if (!Number.isInteger(s.everyDays) || s.everyDays < 1) p.push('coop.everyDays must be a whole number, 1 or more');
  if (!Array.isArray(s.template) || !s.template.some((b) => String(b).includes('{link}'))) p.push('coop.template must have {link}');
  return p;
}

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// Earlier "play together" posts of this account: from the keys "<account>|coop-<day>|/servers/<slug>/" of what was posted (sent) or is approved and waiting.
export function coopHistory(accountId, keys) {
  const out = [];
  for (const k of keys) {
    const [acc, tag, path] = String(k ?? '').split('|');
    const day = tag?.match(/^coop-(\d{4}-\d{2}-\d{2})$/)?.[1];
    const slug = path?.match(/^\/servers\/([a-z0-9-]+)\/$/)?.[1];
    if (acc === accountId && day && slug) out.push({ day, slug, key: k });
  }
  return out;
}

export const coopKey = (accountId, day, path) => itemKey(accountId, `coop-${day}`, path);

// Today's post of one account: { noPost } or { text, link, path, day, slug, key, game }.
// keys = the keys of posts already sent or approved (any account; only this account's are used).
export function coopPostFor(acc, { games = readCoopGames(), keys = [], now = Date.now() } = {}) {
  const s = coopSettings(acc);
  if (!s || !s.enabled) return null;
  const today = dayKey(now);
  const history = coopHistory(acc.id, keys);
  const before = history.filter((h) => h.day < today); // today's own post (approved or sent) does not move the choice
  const last = before.map((h) => h.day).sort().at(-1);
  if (last && daysBetween(last, today) < s.everyDays) return { noPost: `the last "play together" post was on ${last}; the next one is due on ${addDays(last, s.everyDays)} (coop.everyDays = ${s.everyDays})` };
  const want = new Set(s.anyTags.map((t) => String(t).toLowerCase()));
  const eligible = games.filter((g) => (want.has('*') || (g.tags ?? []).some((t) => want.has(String(t).toLowerCase()))) && postLines(g).length);
  if (!eligible.length) return { noPost: `no game in data/coop-games.json has one of the tags ${s.anyTags.join(', ')}` };
  const lastOf = (slug) => before.filter((h) => h.slug === slug).map((h) => h.day).sort().at(-1) ?? '';
  const game = [...eligible].sort((a, b) => lastOf(a.slug).localeCompare(lastOf(b.slug)) || eligible.indexOf(a) - eligible.indexOf(b))[0];
  const times = before.filter((h) => h.slug === game.slug).length;
  const lines = postLines(game);
  const text0 = lines[times % lines.length];
  const utm = acc.channel.utmSource ?? acc.channel.subid ?? acc.id;
  const path = `/servers/${game.slug}/`;
  const link = `${SITE}${path}?utm_source=${encodeURIComponent(utm)}&utm_medium=social&utm_campaign=coop-${today}`;
  const tags = [...s.baseTags, game.hashtag].filter(Boolean).filter((t, i, a) => a.indexOf(t) === i).map((t) => `#${t}`).join(' ');
  const disclosure = acc.channel.disclosure ?? 'Ad';
  const text = s.template
    .map((b) => String(b).replaceAll('{text}', text0).replaceAll('{link}', link).replaceAll('{tags}', tags).replaceAll('{disclosure}', disclosure).replaceAll('{title}', game.title))
    .join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, link, path, day: today, slug: game.slug, key: coopKey(acc.id, today, path), game: game.title };
}

// A post text (approved earlier) back into its parts, for the checks of the sender.
export function parseCoopPost(raw) {
  const text = String(raw ?? '').replace(/\r/g, '').trim();
  if (!text) return { noPost: 'the file is empty' };
  const all = text.match(/https?:\/\/\S+/g) ?? [];
  const link = all.find((l) => l.startsWith(`${SITE}/servers/`)) ?? null;
  let path = null;
  try { path = link ? new URL(link).pathname : null; } catch { /* reported by coopProblems */ }
  const slug = path?.match(/^\/servers\/([a-z0-9-]+)\/$/)?.[1] ?? null;
  const day = link?.match(/utm_campaign=coop-(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  return { text, link, path, slug, day, links: all.length, kind: 'coop' };
}

export function coopProblems(post, { acc, games = readCoopGames(), now = Date.now() }) {
  const p = [];
  const text = post.text ?? '';
  if (!text) return ['the post is empty'];
  if (post.links !== 1 || !post.link || !post.slug) p.push(`the post must have exactly one link, to a game page of ours: ${SITE}/servers/<game>/ (it has ${post.links ?? 0})`);
  else {
    if (!games.some((g) => g.slug === post.slug)) p.push(`the game "${post.slug}" is not in data/coop-games.json any more`);
    if (!post.link.includes('utm_medium=social')) p.push('the link needs utm_medium=social');
  }
  const disclosure = acc.channel.disclosure ?? 'Ad';
  if (text.split('\n').at(-1) !== disclosure) p.push(`the last line must be "${disclosure}" (the page has affiliate links)`);
  if (/#ad\b/i.test(text)) p.push('the tag #ad is not used: the disclosure is the plain line');
  if (/lowest (price )?ever|all[- ]time low|best price ever/i.test(text)) p.push('"lowest ever" is not allowed');
  if (/[Ѐ-ӿ]/.test(text)) p.push('English only');
  if (/\$\d/.test(text)) p.push('no prices in a "play together" post (server prices change)');
  const shown = shortenForPost(text, post.link);
  if (graphemes(shown) > MAX_GRAPHEMES) p.push(`the post is ${graphemes(shown)} characters, Bluesky allows ${MAX_GRAPHEMES}`);
  const maxDayAge = acc.settings?.maxDayAge ?? 1;
  if (!post.day) p.push('the link has no date (utm_campaign=coop-YYYY-MM-DD)');
  else if (daysBetween(post.day, dayKey(now)) > maxDayAge) p.push(`the post is for ${post.day}, too old`);
  else if (daysBetween(post.day, dayKey(now)) < 0) p.push(`the post is for ${post.day}, a day that has not come yet`);
  return p;
}
