// Ready posts for the social channels of an account, made by a template: no AI, no API key. Used by scripts/daily-brief.mjs.
// Same approach as the Nostr note (scripts/lib/nostr.mjs, buildNote).
//
// Everything that depends on the account or the channel lives in data/accounts.json (accounts.<id>.channels.<channel>), not here:
// the template, the tags, the disclosure line, the limit of characters, the date format, the marks of the link (utmSource). A new channel or
// account is a new block in that file; this code does not change.
//
// The text uses only what the first deal of the brief carries (and that comes from data/deals.json): title, store, discount, price, old price,
// the date the price was checked, the end of the sale (if there is one). "Lowest price we've tracked" is written only when the brief says the
// price history confirms it. The link always goes to OUR page of the game (/deals/<store>/<game>/), never straight to a store: the link card
// with the cover comes from that page. The disclosure ("Ad") is plain text, the last line of the post, and its characters count in the limit.
//
// Tags (all CamelCase, chosen by the day, not at random, so that tests repeat):
//   baseTags      always.
//   storeTags     { store: tag }   the tag of the store of the deal.
//   nicheTags     { store: tag }   a tag of the niche of that store (GOG: DRMFree, IndieGala: IndieGames).
//   factTags      { "genre or tag of the game": "Tag" }  a tag that is added only when the game itself has that genre or tag in data/game-facts.json
//                 (for example "city builder": "CityBuilder"). Nothing is added for a game whose facts we do not have. Comes after the tags above, before the rotating one.
//   gameTag       true: a tag made from the title of the game (the part before ":", letters and digits only, CamelCase, 4-25 characters).
//   rotatingTags  the pool for the rotation. It holds literal tags (Gaming) and the names {store}, {niche}, {game} for the derived tags.
//                 A derived tag that is NOT in the pool is added to every post; one that IS in the pool comes only in its turn.
//                 Each day takes the next tag(s) of the pool; one that does not exist for this deal (no game tag) or is already used is skipped.
//   rotatingCount how many tags of the pool a post takes (default 1). The pool is read like a ring and each day moves on by this many places
//                 (day number x rotatingCount), so two days in a row do not share a rotating tag and every tag of the pool comes in its turn.
//                 With 7 tags in the pool and rotatingCount 3, the pool is used up in 7 days and each tag appears on 3 days of 7.
//   maxTags       the most tags in a post (the rotating ones are the first to go).
//
// Two optional lines (a channel with enough room, like Mastodon; a channel without them is not changed):
//   savings       "You save {amount}": {amount} = old price minus price, counted from the prices of the deal (in cents, so 39.99 - 5.99 = $34.00).
//                 The line is left out when there is nothing to save. The template places it with {savings}.
//   storeNote     { store: note }. The template places it with {storeNote}; no note for a store = no line. A note is either
//                 - a short plain text: "GOG": "DRM-free" (the same for every game of the store), or
//                 - a rule that takes it from the data of the game: "IndieGala": { "field": "drminfo", "notes": { "Steam key": "Steam key", "DRM free": "DRM-free" } }
//                   The field (now only drminfo, from the IndieGala feed, kept in data/deals.json) is compared with the keys of "notes" without regard to
//                   capitals, hyphens or spaces; a value that is not listed, or no value, gives no note. Nothing is guessed.

import { slug, dealPagePath } from './deal-paths.mjs';
import { labelsOf } from './facts.mjs';

const NOTE_FIELDS = ['drminfo']; // fields of a deal a storeNote rule may read
const CHANNEL_DEFAULTS = { enabled: true, dateFormat: 'MMM D', linkChars: 25, storeTags: {}, nicheTags: {}, gameTag: false, factTags: {}, rotatingTags: [], rotatingCount: 1, savings: '', storeNote: {} };
const REQUIRED = ['subid', 'maxChars', 'disclosure', 'baseTags', 'maxTags', 'template'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PLACEHOLDERS = ['title', 'store', 'discount', 'price', 'was', 'checked', 'ends', 'lowest', 'why', 'savings', 'storeNote', 'link', 'tags', 'disclosure'];
const DERIVED = ['{store}', '{niche}', '{game}'];
const MIN_TITLE = 15;
const GAME_TAG_MIN = 4;
const GAME_TAG_MAX = 25;
const tagName = /^[A-Z0-9][A-Za-z0-9]{1,39}$/; // CamelCase: starts with a capital letter (or a digit), letters and digits only

export function channelWithDefaults(accountId, name, channel) {
  const c = { ...CHANNEL_DEFAULTS, ...channel };
  const where = `Channel "${name}" of account "${accountId}"`;
  c.utmSource ??= c.subid;
  for (const [k, v] of Object.entries(CHANNEL_DEFAULTS)) c[k] ??= v; // a field that is empty or missing is "not set"
  const missing = REQUIRED.filter((k) => !c[k] || (Array.isArray(c[k]) && !c[k].length));
  if (missing.length) throw new Error(`${where} in data/accounts.json lacks: ${missing.join(', ')}.`);
  if (!Number.isInteger(c.maxChars) || c.maxChars < 50) throw new Error(`${where}: maxChars must be a whole number (50 or more).`);
  if (!Number.isInteger(c.maxTags) || c.maxTags < 1) throw new Error(`${where}: maxTags must be a whole number (1 or more).`);
  if (typeof c.disclosure !== 'string' || !c.disclosure.trim() || /[\n#]/.test(c.disclosure)) throw new Error(`${where}: disclosure must be a short plain text on one line, not a hashtag (for example Ad).`);
  if (!Array.isArray(c.template)) throw new Error(`${where}: template must be a list of paragraphs.`);
  const oneLine = (t) => typeof t === 'string' && t.trim() && !/[\r\n#]/.test(t); // plain text, one line, no hashtag
  if (c.savings && (!oneLine(c.savings) || !c.savings.includes('{amount}'))) throw new Error(`${where}: savings must be one line of plain text with {amount} in it (for example: You save {amount}).`);
  for (const [store, note] of Object.entries(c.storeNote)) {
    if (typeof note === 'object' && note !== null) {
      const ok = NOTE_FIELDS.includes(note.field) && note.notes && typeof note.notes === 'object' && Object.keys(note.notes).length && Object.values(note.notes).every(oneLine);
      if (!ok) throw new Error(`${where}: the storeNote of ${store} must look like { "field": "${NOTE_FIELDS.join('" or "')}", "notes": { "value in the data": "short plain note" } }; every note one line of plain text without #.`);
    } else if (!oneLine(note)) throw new Error(`${where}: the storeNote of ${store} must be a short plain text on one line, without #, or a rule with "field" and "notes".`);
  }
  for (const t of c.rotatingTags) if (t.startsWith('{') && !DERIVED.includes(t)) throw new Error(`${where}: "${t}" in rotatingTags is unknown; allowed: ${DERIVED.join(' ')}.`);
  if (!Number.isInteger(c.rotatingCount) || c.rotatingCount < 1) throw new Error(`${where}: rotatingCount must be a whole number (1 or more).`);
  if (c.rotatingTags.length && c.rotatingCount > c.rotatingTags.length) throw new Error(`${where}: rotatingCount is ${c.rotatingCount} but rotatingTags has only ${c.rotatingTags.length} tags.`);
  if (typeof c.factTags !== 'object' || Array.isArray(c.factTags)) throw new Error(`${where}: factTags must look like { "city builder": "CityBuilder" }.`);
  for (const [word, tag] of Object.entries(c.factTags)) if (!word.trim() || typeof tag !== 'string') throw new Error(`${where}: factTags "${word}" must point to a tag written without #.`);
  const literal = [...c.baseTags, ...Object.values(c.storeTags), ...Object.values(c.nicheTags), ...Object.values(c.factTags), ...c.rotatingTags.filter((t) => !DERIVED.includes(t))];
  for (const t of literal) if (!tagName.test(t)) throw new Error(`${where}: "${t}" is not a valid tag. Write tags without #, in CamelCase (PCGaming, GameDeals).`);
  for (const m of c.template.join('\n').matchAll(/\{(\w+)\}/g)) if (!PLACEHOLDERS.includes(m[1])) throw new Error(`${where}: the template has {${m[1]}}; allowed: ${PLACEHOLDERS.map((p) => `{${p}}`).join(' ')}.`);
  for (const need of ['tags', 'link', 'disclosure']) if (!c.template.some((p) => p.includes(`{${need}}`))) throw new Error(`${where}: the template needs {${need}}.`);
  const lastLine = c.template.at(-1).split('\n').map((l) => l.trim()).filter(Boolean).at(-1);
  if (lastLine !== '{disclosure}') throw new Error(`${where}: {disclosure} must be the last line of the template.`);
  return c;
}

// "MMM D" -> "Oct 8". Tokens: YYYY, MM, DD, MMM, D. The day is the UTC day, like everywhere in the brief.
export function formatDate(t, format) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) throw new Error(`Not a date: ${t}`);
  const parts = { YYYY: String(d.getUTCFullYear()), MM: String(d.getUTCMonth() + 1).padStart(2, '0'), DD: String(d.getUTCDate()).padStart(2, '0'), MMM: MONTHS[d.getUTCMonth()], D: String(d.getUTCDate()) };
  return format.replace(/YYYY|MMM|MM|DD|D/g, (tok) => parts[tok]);
}

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
export const graphemes = (s) => [...segmenter.segment(s)].length;
const money = (n) => `$${Number(n).toFixed(2)}`;

// The tag of a game from its title: the part before ":", letters and digits only, CamelCase.
// A word in capitals longer than 3 letters is written as a normal word (MONSTER -> Monster, LEGO -> Lego); a short one (II, DLC) stays as it is.
// Returns null when the result has no letter or is shorter than 4 or longer than 25 characters.
export function gameTag(title) {
  const part = String(title).split(':')[0].replace(/['’]/g, ''); // an apostrophe does not split a word: Assassin's -> Assassins
  const words = part.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const tag = words
    .map((w) => {
      const caps = w === w.toUpperCase() && /[A-Z]/.test(w);
      const body = caps && w.length > 3 ? w.toLowerCase() : w;
      return body[0].toUpperCase() + body.slice(1);
    })
    .join('');
  if (!/[A-Za-z]/.test(tag) || tag.length < GAME_TAG_MIN || tag.length > GAME_TAG_MAX) return null;
  return tag;
}

const dayNumber = (day) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 864e5);

// The tags of the post, in order, without the "#". Returns { tags, rotating } (rotating = the tags the rotation chose, a list, empty when none).
// `every` = how many days apart the posts of this account are (cadence.everyDays of data/accounts.json; 1 = every day). The ring of the rotation
// moves on by one step per POST, not per calendar day, so an account that posts every second day still goes through the whole pool.
export function chooseTags({ c, channel, day, every = 1 }) {
  const tags = [...channel.baseTags];
  const has = (t) => tags.some((x) => x.toLowerCase() === t.toLowerCase());
  const derived = {
    '{store}': channel.storeTags[c.store] ?? null,
    '{niche}': channel.nicheTags[c.store] ?? null,
    '{game}': channel.gameTag ? gameTag(c.title) : null,
  };
  const pool = channel.rotatingTags;
  for (const key of DERIVED) if (!pool.includes(key) && derived[key] && !has(derived[key])) tags.push(derived[key]); // not in the rotation: on every post
  const labels = labelsOf(c.facts); // the genres and tags of THIS game; a game without facts gets no tag from factTags
  for (const [word, tag] of Object.entries(channel.factTags)) if (labels.has(word.toLowerCase().replace(/\s+/g, ' ').trim()) && !has(tag)) tags.push(tag);
  const rotating = [];
  if (pool.length) {
    const count = channel.rotatingCount;
    const want = Math.min(count, Math.max(0, channel.maxTags - tags.length)); // maxTags cuts the rotating tags first
    const slot = Math.floor(dayNumber(day) / every); // the number of the post: +1 for each post, also when the posts are `every` days apart
    const start = (((slot * count) % pool.length) + pool.length) % pool.length; // the ring moves on by `count` places a post
    for (let k = 0; k < pool.length && rotating.length < want; k++) {
      const item = pool[(start + k) % pool.length];
      const tag = DERIVED.includes(item) ? derived[item] : item;
      if (tag && !has(tag) && !rotating.some((r) => r.toLowerCase() === tag.toLowerCase())) rotating.push(tag);
    }
  }
  return { tags: [...tags.slice(0, channel.maxTags), ...rotating], rotating };
}

// The address of the post link: our page of the game with the marks of the channel.
export const postLink = (links, c, channel, day) => `${links.site}${dealPagePath(c)}?utm_source=${channel.utmSource}&utm_medium=social&utm_campaign=deals-${day}`;

// "Why today" clauses of the brief, without the one the {lowest} part already says, and the rank only when it is high.
const whyText = (c) => {
  const clauses = (c.whyToday ?? []).filter((w) => !/^lowest price/.test(w) && (!/^deepest-discount rank/.test(w) || c.discountRank <= 3));
  return clauses.length ? `Why today: ${clauses.join('; ')}.` : '';
};

// The note of the store for this deal: plain text, or taken from a field of the deal by the rule of the channel. '' = no note.
const normNote = (t) => String(t).toLowerCase().replace(/[-_\s]+/g, ' ').trim();
export function noteOf(channel, c) {
  const entry = channel.storeNote[c.store];
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  const value = c[entry.field];
  if (value == null || value === '') return '';
  const hit = Object.entries(entry.notes).find(([key]) => normNote(key) === normNote(value));
  return hit ? hit[1] : '';
}

// What the buyer saves, in cents: old price minus price (both from data/deals.json). Counted in cents so that 39.99 - 5.99 is exactly 34.00.
export const savingsInCents = (c) => Math.max(0, Math.round(c.was * 100) - Math.round(c.price * 100));

function check(c) {
  const bad = [];
  if (!c || c.kind !== 'deal') throw new Error('There is no deal to post.');
  if (!c.title || typeof c.title !== 'string') bad.push('title');
  if (!c.store || typeof c.store !== 'string') bad.push('store');
  for (const k of ['price', 'was', 'discount']) if (!Number.isFinite(c[k])) bad.push(k);
  if (!c.priceCheckedAt || Number.isNaN(Date.parse(c.priceCheckedAt))) bad.push('priceCheckedAt');
  if (c.endsAt && Number.isNaN(Date.parse(c.endsAt))) bad.push('endsAt');
  if (!slug(c.title) || !slug(c.store)) bad.push('title/store (no letters or digits for the address)');
  if (bad.length) throw new Error(`The first deal of the brief is not complete: ${bad.join(', ')}.`);
}

// Returns { text, length, max, tags, link, warnings }. Throws when the post cannot be made honestly (the caller writes "no post today" and the reason).
export function buildPost({ candidate: c, channel, links, day, every = 1 }) {
  check(c);
  const warnings = [];
  const link = postLink(links, c, channel, day);
  const { tags } = chooseTags({ c, channel, day, every });
  const tagsText = tags.map((t) => `#${t}`).join(' ');
  const saved = channel.savings ? savingsInCents(c) : 0; // cents; 0 = nothing to show

  const render = (title) => {
    const values = {
      title,
      store: c.store,
      discount: String(c.discount),
      price: money(c.price),
      was: money(c.was),
      checked: formatDate(c.priceCheckedAt, channel.dateFormat),
      ends: c.endsAt ? ` Sale ends ${formatDate(c.endsAt, channel.dateFormat)}.` : '',
      lowest: c.history?.lowest ? " Lowest price we've tracked." : '',
      why: whyText(c),
      savings: saved ? channel.savings.replace('{amount}', money(saved / 100)) : '',
      storeNote: noteOf(channel, c),
      link,
      tags: tagsText,
      disclosure: channel.disclosure,
    };
    return channel.template
      .map((p) => p.replace(/\{(\w+)\}/g, (_, k) => values[k]).split('\n').map((l) => l.trim()).filter(Boolean).join('\n'))
      .filter(Boolean)
      .join('\n\n');
  };
  // The link counts as linkChars (the apps shorten it); everything else, the tags and the disclosure line too, is counted as it is,
  // in characters the way a person sees them.
  const lengthOf = (text) => graphemes(text.replace(link, '')) + channel.linkChars;

  let title = c.title;
  let text = render(title);
  while (lengthOf(text) > channel.maxChars && graphemes(title) > MIN_TITLE) {
    const over = lengthOf(text) - channel.maxChars;
    const chars = [...segmenter.segment(title)].map((s) => s.segment);
    title = chars.slice(0, Math.max(MIN_TITLE - 1, chars.length - over - 1)).join('').trimEnd().replace(/[\s:,\-–—]+$/, '') + '…';
    text = render(title);
  }
  if (title !== c.title) warnings.push(`The title was shortened to fit ${channel.maxChars} characters: "${title}".`);
  if (lengthOf(text) > channel.maxChars) throw new Error(`The post does not fit ${channel.maxChars} characters even with a short title (${lengthOf(text)}). Shorten the template in data/accounts.json.`);

  // Guards: the disclosure is the last line, never a hashtag, the link is ours, the numbers of the post are the numbers of the deal.
  if (text.split('\n').at(-1) !== channel.disclosure) throw new Error(`The disclosure "${channel.disclosure}" is not the last line of the post. Check the template: {disclosure} must be the last line.`);
  if (/#ad\b/i.test(text)) throw new Error('The post has the tag #ad. The disclosure is plain text now (the field disclosure of the channel).');
  if (tags.length > channel.maxTags) throw new Error(`The post has ${tags.length} tags, the limit is ${channel.maxTags}.`);
  if (!text.includes(link) || !link.startsWith(`${links.site}/deals/`)) throw new Error('The post has no link to our page of the game.');
  // Any amount in the post (outside the game's own title) must be the price or the old price of the deal.
  // The saving counted from those two prices is allowed too, only when the channel has the savings line.
  const expected = [c.price, c.was].map((n) => Number(n.toFixed(2)));
  if (channel.savings && saved) expected.push(saved / 100);
  const strange = [...text.replace(title, '').matchAll(/\$(\d+\.\d{2})/g)].map((m) => Number(m[1])).filter((n) => !expected.includes(n));
  if (strange.length) throw new Error(`The post has an amount that is not a price of the deal: $${strange[0]}.`);
  if (/lowest (price )?ever|all[- ]time low|historical low/i.test(text)) throw new Error('The post claims a record low. Not allowed: only "lowest price we\'ve tracked", and only when the history confirms it.');
  // A marketplace key (Kinguin) is compared with the CURRENT price of another store (compareTo), never with an "old price", and is never
  // called safe or official (decision of 11 October 2026; the site says the same, see src/lib/deals.ts).
  if (c.marketplace) {
    const bare = text.replace(title, '');
    if (!/marketplace key/i.test(text)) throw new Error('A marketplace key must be called a "Marketplace key" in the post.');
    if (c.compareTo && !text.includes(`current ${c.compareTo} price`)) throw new Error(`A marketplace key is compared with the current ${c.compareTo} price: the post must say "current ${c.compareTo} price".`);
    if (/\b(safe|safest|official|verified|guaranteed|trusted|legit)\b/i.test(bare)) throw new Error('A post about a marketplace key must not call it safe, official, verified, guaranteed or trusted.');
    if (/\bwas\b|\d+% off|-\d+%/i.test(bare)) throw new Error('A marketplace key has no old price: the post must not say "was", "% off" or "-NN%".');
  }
  return { text, length: lengthOf(text), max: channel.maxChars, tags, link, warnings };
}
