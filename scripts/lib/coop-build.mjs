// The pure parts of scripts/coop-build.mjs (no network): matching names, judging a Steam answer, building the entry of a game for
// data/coop-games.json. Tested in scripts/test-coop-build.mjs. Every fact written into an entry comes from Steam's own answer (appdetails);
// nothing is invented and the developer's marketing text is not copied.

export const clean = (s) => String(s ?? '').toLowerCase()
  .replace(/[™®©]/g, '').replace(/&/g, ' and ').replace(/['’`]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').replace(/^the /, '').trim();

export const slugName = (slug) => String(slug).replace(/_/g, ' ');
export const ourSlug = (hostSlug) => String(hostSlug).replace(/_/g, '-');
export const titleOf = (name) => String(name ?? '').replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();

// "Don't Starve Together" -> "DontStarveTogether"; '' when it would be empty, only digits or longer than 30 characters.
export function hashtagOf(title) {
  const words = titleOf(title).replace(/['’]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1));
  const tag = words.join('');
  return tag && tag.length <= 30 && !/^\d+$/.test(tag) ? tag : '';
}

// Steam category numbers (appdetails "categories"): 1 Multi-player, 9 Co-op, 38 Online Co-op, 49 PvP, 36 Online PvP, 20 MMO.
export function steamFlags(data) {
  const ids = new Set((data?.categories ?? []).map((c) => c.id));
  return { multi: ids.has(1), coop: ids.has(9) || ids.has(38), onlineCoop: ids.has(38), pvp: ids.has(49) || ids.has(36), mmo: ids.has(20) };
}

// Is this Steam answer a released game with a multiplayer mode? { ok, flags } or { ok: false, reason }.
export function classify(data) {
  if (!data) return { ok: false, reason: 'Steam gave no details for this number' };
  if (data.type !== 'game') return { ok: false, reason: `Steam says it is a "${data.type}", not a game` };
  if (data.release_date?.coming_soon) return { ok: false, reason: 'not released yet' };
  const ids = data.content_descriptors?.ids ?? [];
  if (ids.includes(3) || ids.includes(4)) return { ok: false, reason: 'Steam marks adult sexual content' };
  const flags = steamFlags(data);
  if (!(flags.multi || flags.coop || flags.pvp || flags.mmo)) return { ok: false, reason: 'Steam lists no multiplayer mode' };
  return { ok: true, flags };
}

const joinList = (list) => (list.length < 3 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

export function modesOf(flags) {
  const modes = [];
  if (flags.onlineCoop) modes.push('online co-op'); else if (flags.coop) modes.push('co-op');
  if (flags.pvp) modes.push('PvP');
  if (flags.mmo) modes.push('massively multiplayer play');
  if (!modes.length) modes.push('multiplayer');
  return modes;
}

// The entry of one game for data/coop-games.json (auto: true = made by the program, never edited by hand).
export function buildEntry({ hostSlug, data, hostKey, pathTemplate, checkedOn }) {
  const flags = steamFlags(data);
  const title = titleOf(data.name);
  const url = `https://store.steampowered.com/app/${data.steam_appid}/`;
  const source = 'Steam store page';
  const genres = (data.genres ?? []).map((g) => g.description);
  const released = data.release_date?.date ?? '';
  const facts = [{ text: `Steam lists ${joinList(modesOf(flags))} for ${title}.`, source, url }];
  if (genres.length) facts.push({ text: `Steam files it under: ${genres.join(', ')}.`, source, url });
  if (released) facts.push({ text: `Release date on Steam: ${released}.`, source, url });
  const kind = genres.slice(0, 3).join(', ');
  return {
    slug: ourSlug(hostSlug),
    title,
    auto: true,
    tags: ['server'],
    hashtag: hashtagOf(title),
    steamAppId: data.steam_appid,
    image: data.header_image,
    checkedOn,
    intro: `${title} is a multiplayer game${kind ? ` (${kind})` : ''}. This page shows what Steam says about its multiplayer modes and where you can rent a server for it.`,
    facts,
    steam: flags,
    popularity: data.recommendations?.total ?? 0,
    hosts: { [hostKey]: { path: pathTemplate.replace('{slug}', hostSlug), facts: [] } },
    posts: [],
  };
}

// Hand-made games (no "auto") stay exactly as they are and come first; the made-by-program games follow, most reviewed first.
// A program game is dropped when a hand-made one has its slug or its Steam number, and two program games never share a number.
export function mergeGames(existing, autos) {
  const manual = existing.filter((g) => !g.auto);
  const slugs = new Set(manual.map((g) => g.slug));
  const ids = new Set(manual.map((g) => g.steamAppId).filter(Boolean));
  const out = [...manual];
  for (const a of [...autos].sort((x, y) => (y.popularity - x.popularity) || x.title.localeCompare(y.title))) {
    if (slugs.has(a.slug) || ids.has(a.steamAppId)) continue;
    slugs.add(a.slug); ids.add(a.steamAppId);
    out.push(a);
  }
  return out;
}

// The list page of the host: the games before the "On the horizon" part are orderable. Returns null when the page does not look as expected.
// names: the text of the link when it is a plain title.
export function parseHostList(html, marker = 'sortbyname') {
  const text = String(html ?? '');
  const cut = text.indexOf(marker);
  if (cut < 0) return null;
  const grab = (part) => {
    const out = [];
    const names = {};
    for (const m of part.matchAll(/<a[^>]+href="\/services\/game_servers\/([a-z0-9_]+)\/?"[^>]*>([\s\S]*?)<\/a>/gi)) {
      if (!out.includes(m[1])) out.push(m[1]);
      const t = m[2].replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
      if (t.length >= 2 && t.length <= 60 && !/^(order|view|learn|more)/i.test(t) && !names[m[1]]) names[m[1]] = t;
    }
    return { slugs: out, names };
  };
  const released = grab(text.slice(0, cut));
  const horizon = grab(text.slice(cut));
  if (released.slugs.length < 20) return null; // too few: the page changed, do not trust it
  return { games: released.slugs, horizon: horizon.slugs, names: { ...horizon.names, ...released.names } };
}
