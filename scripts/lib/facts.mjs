// Facts about a game (release year, genres, tags, mature content) and the rule that says whether a game fits a niche account.
// Used by scripts/enrich-facts.mjs (fills data/game-facts.json) and by scripts/daily-brief.mjs (picks games for Cozy, Retro and any future niche).
//
// Where the facts come from (nothing is guessed; a game with no facts simply does not fit a niche):
//   GOG     the open GOG catalog (the same one update-deals reads for prices): releaseDate is the year the game CAME OUT, genres and tags are GOG's.
//   Steam   store.steampowered.com appdetails: the genres, the Steam release date and the content descriptors.
//           Careful: for an old game Steam often shows the date of its re-release (Prince of Persia: The Sands of Time = 2008, the game is from 2003).
//           So a retro account must take its games from GOG (stores: ["GOG"]); Steam years are fine for "recent" rules.
//
// A fact entry (data/game-facts.json, key = the deal id, store-title as in the address of the game page):
//   { source: "gog" | "steam", year: 2003 | null, genres: ["Adventure"], tags: ["Classic"], mature: false, at: "2026-10-15" }
//
// The rule of a niche account ("select" in data/accounts.json):
//   maxYear / minYear  the year of the game must be inside. A game with no known year does not fit.
//   anyOf              at least one of these words is a genre or a tag of the game (capitals do not matter).
//   noneOf             none of these words is a genre or a tag of the game.
//   notMature          true: games marked mature (violence, gore, nudity, sexual content) do not fit.
//   label              a short name of the niche for reports ("Retro"). Optional.

const KEYS = ['label', 'maxYear', 'minYear', 'anyOf', 'noneOf', 'notMature'];
// Tags of GOG that mean mature content. Steam: content descriptors 1-5 (nudity, violence or gore, adult sexual content, general mature content).
const GOG_MATURE = ['violent', 'gore', 'nudity', 'sexual content', 'mature'];
const STEAM_MATURE = [1, 2, 3, 4, 5];

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const names = (list) => [...new Set((list ?? []).map((x) => (typeof x === 'string' ? x : x?.name ?? x?.description)).filter(Boolean).map((x) => String(x).trim()))];
const yearOf = (text) => {
  const m = String(text ?? '').match(/\b(19[7-9]\d|20\d{2})\b/);
  return m ? Number(m[1]) : null;
};

// A product of the GOG catalog (raw, as GOG sends it) -> a fact entry.
export function gogFacts(p, today) {
  const genres = names(p.genres);
  const tags = names(p.tags);
  return { source: 'gog', year: yearOf(p.releaseDate), genres, tags, mature: tags.some((t) => GOG_MATURE.includes(norm(t))), at: today };
}

// The data of Steam appdetails (the "data" part of the answer) -> a fact entry.
export function steamFactsOf(d, today) {
  const ids = (d.content_descriptors?.ids ?? []).map(Number);
  return { source: 'steam', year: yearOf(d.release_date?.coming_soon ? '' : d.release_date?.date), genres: names(d.genres), tags: [], mature: ids.some((i) => STEAM_MATURE.includes(i)), at: today };
}

// All the words (genres and tags) of a game, lower case.
export const labelsOf = (f) => new Set([...(f?.genres ?? []), ...(f?.tags ?? [])].map(norm));

const isWords = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.trim());
// Problems of a "select" block, as a list of sentences (empty = fine).
export function selectProblems(select) {
  if (!select || typeof select !== 'object' || Array.isArray(select)) return ['select must be an object like { "maxYear": 2008 }'];
  const out = [];
  for (const k of Object.keys(select)) if (!KEYS.includes(k)) out.push(`unknown field "${k}" (allowed: ${KEYS.join(', ')})`);
  for (const k of ['maxYear', 'minYear']) if (k in select && !(Number.isInteger(select[k]) && select[k] > 1970 && select[k] < 2100)) out.push(`${k} must be a year like 2008`);
  if ('minYear' in select && 'maxYear' in select && select.minYear > select.maxYear) out.push('minYear is bigger than maxYear');
  for (const k of ['anyOf', 'noneOf']) if (k in select && !isWords(select[k])) out.push(`${k} must be a list of words (genres or tags)`);
  if ('notMature' in select && typeof select.notMature !== 'boolean') out.push('notMature must be true or false');
  if ('label' in select && (typeof select.label !== 'string' || !select.label.trim())) out.push('label must be a short text');
  if (!out.length && !['maxYear', 'minYear', 'anyOf', 'noneOf', 'notMature'].some((k) => k in select)) out.push('the rule is empty: it would let every game in');
  return out;
}

// Does the game fit the niche? -> '' (fits) | 'noFacts' (we know nothing about the game) | 'notNiche' (we know it and it does not fit).
export function nicheMiss(facts, select) {
  if (!select) return '';
  if (!facts) return 'noFacts';
  const needsYear = 'maxYear' in select || 'minYear' in select;
  if (needsYear && !facts.year) return 'noFacts';
  if ('maxYear' in select && facts.year > select.maxYear) return 'notNiche';
  if ('minYear' in select && facts.year < select.minYear) return 'notNiche';
  if (select.notMature && facts.mature) return 'notNiche';
  const labels = labelsOf(facts);
  if (select.anyOf && !select.anyOf.some((w) => labels.has(norm(w)))) return 'notNiche';
  if (select.noneOf && select.noneOf.some((w) => labels.has(norm(w)))) return 'notNiche';
  return '';
}
