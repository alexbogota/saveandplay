// Game-title helpers: turn a title into plain words, so a news headline can be compared with a deal.
// clean / core / EDITION are the same rules as in scripts/steam.mjs (keep them in sync if one changes).

export const EDITION =
  /\b(goty|game of the year|definitive|directors? cut|director s cut|general|complete|ultimate|deluxe|standard|enhanced|remastered|gold|legendary|premium|anniversary|digital|brutal|ritual|overlord)( edition)?\b|\bedition\b/g;

export const clean = (s) =>
  s
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .trim();

// The title without edition words: "Control Ultimate Edition" -> "control".
export const core = (s) => clean(s).replace(EDITION, '').replace(/\s+/g, ' ').trim();

export const words = (s) => (s ? s.split(' ') : []);

// A number or roman numeral after a game name usually means a different game ("Evolution" vs "Evolution 2").
const SEQUEL = /^(\d+|ii|iii|iv|v|vi|vii|viii|ix|x)$/;

// Does the headline contain this name as whole words? `name` and `headline` are already clean() text.
// A name that does not end in a number is not matched when a number follows it in the headline (the sequel).
export function hasName(headline, name) {
  const h = words(headline);
  const n = words(name);
  if (!n.length || n.length > h.length) return false;
  const lastIsNumber = SEQUEL.test(n.at(-1));
  for (let i = 0; i + n.length <= h.length; i++) {
    if (!n.every((w, k) => h[i + k] === w)) continue;
    const next = h[i + n.length];
    if (next && SEQUEL.test(next) && !lastIsNumber) continue;
    return true;
  }
  return false;
}

// Names under which a deal title may appear in a headline (clean() text).
// Full name without edition words, and the part before ":" or " - " when that part is at least two words.
// A one-word name is used only when it is long (8+ letters) and not a common English word, otherwise "Control" would match every headline with "control".
// Short one-word games are still found when a feed item links to their Steam or GOG page.
const COMMON = new Set(['evolution', 'universe', 'journey', 'unpacking', 'sunset', 'discovery', 'survival', 'adventure', 'fighter', 'warfare']);
export function nameVariants(title) {
  const trim = (n) => n.replace(/( (the|a|an|of|and))+$/, '');
  const out = new Set();
  const full = trim(core(title));
  const head = trim(core(title.split(/\s[:\-–—]\s|:\s/)[0]));
  if (full && (words(full).length >= 2 || (full.length >= 8 && !COMMON.has(full)))) out.add(full);
  if (head && words(head).length >= 2) out.add(head);
  return [...out];
}
