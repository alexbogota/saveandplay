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
//   gameTag       true: a tag made from the title of the game (the part before ":", letters and digits only, CamelCase, 4-25 characters).
//   rotatingTags  the pool for the rotation. It holds literal tags (Gaming) and the names {store}, {niche}, {game} for the derived tags.
//                 A derived tag that is NOT in the pool is added to every post; one that IS in the pool comes only in its turn.
//                 Each day takes the next tag of the pool; one that does not exist for this deal (no game tag) or is already used is skipped.
//   maxTags       the most tags in a post (the rotating one is the first to go).

import { slug, dealPagePath } from './deal-paths.mjs';

const CHANNEL_DEFAULTS = { enabled: true, dateFormat: 'MMM D', linkChars: 25, storeTags: {}, nicheTags: {}, gameTag: false, rotatingTags: [] };
const REQUIRED = ['subid', 'maxChars', 'disclosure', 'baseTags', 'maxTags', 'template'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PLACEHOLDERS = ['title', 'store', 'discount', 'price', 'was', 'checked', 'ends', 'lowest', 'why', 'link', 'tags', 'disclosure'];
const DERIVED = ['{store}', '{niche}', '{game}'];
const MIN_TITLE = 15;
const GAME_TAG_MIN = 4;
const GAME_TAG_MAX = 25;
const tagName = /^[A-Z0-9][A-Za-z0-9]{1,39}$/; // CamelCase: starts with a capital letter (or a digit), letters and digits only

export function channelWithDefaults(accountId, name, channel) {
  const c = { ...CHANNEL_DEFAULTS, ...channel };
  const where = `Channel "${name}" of account "${accountId}"`;
  c.utmSource ??= c.subid;
  const missing = REQUIRED.filter((k) => !c[k] || (Array.isArray(c[k]) && !c[k].length));
  if (missing.length) throw new Error(`${where} in data/accounts.json lacks: ${missing.join(', ')}.`);
  if (!Number.isInteger(c.maxChars) || c.maxChars < 50) throw new Error(`${where}: maxChars must be a whole number (50 or more).`);
  if (!Number.isInteger(c.maxTags) || c.maxTags < 1) throw new Error(`${where}: maxTags must be a whole number (1 or more).`);
  if (typeof c.disclosure !== 'string' || !c.disclosure.trim() || /[\n#]/.test(c.disclosure)) throw new Error(`${where}: disclosure must be a short plain text on one line, not a hashtag (for example Ad).`);
  if (!Array.isArray(c.template)) throw new Error(`${where}: template must be a list of paragraphs.`);
  for (const t of c.rotatingTags) if (t.startsWith('{') && !DERIVED.includes(t)) throw new Error(`${where}: "${t}" in rotatingTags is unknown; allowed: ${DERIVED.join(' ')}.`);
  const literal = [...c.baseTags, ...Object.values(c.storeTags), ...Object.values(c.nicheTags), ...c.rotatingTags.filter((t) => !DERIVED.includes(t))];
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

// The tags of the post, in order, without the "#". Returns { tags, rotating } (rotating = the tag the rotation chose, or null).
export function chooseTags({ c, channel, day }) {
  const tags = [...channel.baseTags];
  const has = (t) => tags.some((x) => x.toLowerCase() === t.toLowerCase());
  const derived = {
    '{store}': channel.storeTags[c.store] ?? null,
    '{niche}': channel.nicheTags[c.store] ?? null,
    '{game}': channel.gameTag ? gameTag(c.title) : null,
  };
  const pool = channel.rotatingTags;
  for (const key of DERIVED) if (!pool.includes(key) && derived[key] && !has(derived[key])) tags.push(derived[key]); // not in the rotation: on every post
  let rotating = null;
  if (pool.length) {
    const start = ((dayNumber(day) % pool.length) + pool.length) % pool.length;
    for (let k = 0; k < pool.length; k++) {
      const item = pool[(start + k) % pool.length];
      const tag = DERIVED.includes(item) ? derived[item] : item;
      if (tag && !has(tag)) {
        rotating = tag;
        break;
      }
    }
  }
  const room = channel.maxTags - tags.length;
  const kept = tags.slice(0, channel.maxTags);
  if (rotating && room > 0) kept.push(rotating);
  else rotating = null;
  return { tags: kept, rotating };
}

// The address of the post link: our page of the game with the marks of the channel.
export const postLink = (links, c, channel, day) => `${links.site}${dealPagePath(c)}?utm_source=${channel.utmSource}&utm_medium=social&utm_campaign=deals-${day}`;

// "Why today" clauses of the brief, without the one the {lowest} part already says, and the rank only when it is high.
const whyText = (c) => {
  const clauses = (c.whyToday ?? []).filter((w) => !/^lowest price/.test(w) && (!/^deepest-discount rank/.test(w) || c.discountRank <= 3));
  return clauses.length ? `Why today: ${clauses.join('; ')}.` : '';
};

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
export function buildPost({ candidate: c, channel, links, day }) {
  check(c);
  const warnings = [];
  const link = postLink(links, c, channel, day);
  const { tags } = chooseTags({ c, channel, day });
  const tagsText = tags.map((t) => `#${t}`).join(' ');

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
  const expected = [c.price, c.was].map((n) => Number(n.toFixed(2)));
  const strange = [...text.replace(title, '').matchAll(/\$(\d+\.\d{2})/g)].map((m) => Number(m[1])).filter((n) => !expected.includes(n));
  if (strange.length) throw new Error(`The post has an amount that is not a price of the deal: $${strange[0]}.`);
  if (/lowest (price )?ever|all[- ]time low|historical low/i.test(text)) throw new Error('The post claims a record low. Not allowed: only "lowest price we\'ve tracked", and only when the history confirms it.');
  return { text, length: lengthOf(text), max: channel.maxChars, tags, link, warnings };
}
