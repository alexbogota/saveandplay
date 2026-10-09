// Ready posts for the social channels of an account, made by a template: no AI, no API key. Used by scripts/daily-brief.mjs.
// Same approach as the Nostr note (scripts/lib/nostr.mjs, buildNote).
//
// Everything that depends on the account or the channel lives in data/accounts.json (accounts.<id>.channels.<channel>), not here:
// the template, hashtags, the ad tag, the limit of characters, the date format, the marks of the link (utmSource). A new channel or
// account is a new block in that file; this code does not change.
//
// The text uses only what the first deal of the brief carries (and that comes from data/deals.json): title, store, discount, price, old price,
// the date the price was checked, the end of the sale (if there is one). "Lowest price we've tracked" is written only when the brief says the
// price history confirms it. The link always goes to OUR page of the game (/deals/<store>/<game>/), never straight to a store: the link card
// with the cover comes from that page. The ad tag is always the last thing in the post.

import { slug, dealPagePath } from './deal-paths.mjs';

const CHANNEL_DEFAULTS = { enabled: true, dateFormat: 'MMM D', adTag: '#ad', linkChars: 25, storeHashtags: {} };
const REQUIRED = ['subid', 'maxChars', 'hashtags', 'template'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PLACEHOLDERS = ['title', 'store', 'discount', 'price', 'was', 'checked', 'ends', 'lowest', 'why', 'link', 'tags'];
const MIN_TITLE = 15;

export function channelWithDefaults(accountId, name, channel) {
  const c = { ...CHANNEL_DEFAULTS, ...channel };
  c.utmSource ??= c.subid;
  const missing = REQUIRED.filter((k) => !c[k] || (Array.isArray(c[k]) && !c[k].length));
  if (missing.length) throw new Error(`Channel "${name}" of account "${accountId}" in data/accounts.json lacks: ${missing.join(', ')}.`);
  if (!Number.isInteger(c.maxChars) || c.maxChars < 50) throw new Error(`Channel "${name}" of account "${accountId}": maxChars must be a whole number (50 or more).`);
  if (!Array.isArray(c.template)) throw new Error(`Channel "${name}" of account "${accountId}": template must be a list of paragraphs.`);
  const tag = /^#[\p{L}\p{N}_]{2,40}$/u;
  for (const h of [...c.hashtags, ...Object.values(c.storeHashtags), c.adTag]) if (!tag.test(h)) throw new Error(`Channel "${name}" of account "${accountId}": "${h}" is not a valid hashtag (like #PCGaming, no spaces).`);
  for (const m of c.template.join('\n').matchAll(/\{(\w+)\}/g)) if (!PLACEHOLDERS.includes(m[1])) throw new Error(`Channel "${name}" of account "${accountId}": the template has {${m[1]}}; allowed: ${PLACEHOLDERS.map((p) => `{${p}}`).join(' ')}.`);
  if (!c.template.some((p) => p.includes('{tags}'))) throw new Error(`Channel "${name}" of account "${accountId}": the template needs {tags} (hashtags and the ad tag at the end).`);
  if (!c.template.some((p) => p.includes('{link}'))) throw new Error(`Channel "${name}" of account "${accountId}": the template needs {link}.`);
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

// Returns { text, length, max, warnings }. Throws when the post cannot be made honestly (the caller writes "no post today" and the reason).
export function buildPost({ candidate: c, channel, links, day }) {
  check(c);
  const warnings = [];
  const link = postLink(links, c, channel, day);
  const tagList = [...channel.hashtags, channel.storeHashtags[c.store]].filter(Boolean);
  const seen = new Set();
  const tags = tagList.filter((h) => !seen.has(h.toLowerCase()) && h.toLowerCase() !== channel.adTag.toLowerCase() && seen.add(h.toLowerCase()));
  const tagsText = [...tags, channel.adTag].join(' ');

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
    };
    return channel.template
      .map((p) => p.replace(/\{(\w+)\}/g, (_, k) => values[k]).split('\n').map((l) => l.trim()).filter(Boolean).join('\n'))
      .filter(Boolean)
      .join('\n\n');
  };
  // The link counts as linkChars (the apps shorten it); everything else is counted as it is, in characters the way a person sees them.
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

  // Guards: the ad tag is the last word, the link is ours, the numbers of the post are the numbers of the deal.
  if (text.split(/\s+/).at(-1) !== channel.adTag) throw new Error(`The ad tag ${channel.adTag} is not the last thing of the post. Check the template: {tags} must be the last paragraph.`);
  if (!text.includes(link) || !link.startsWith(`${links.site}/deals/`)) throw new Error('The post has no link to our page of the game.');
  // Any amount in the post (outside the game's own title) must be the price or the old price of the deal.
  const expected = [c.price, c.was].map((n) => Number(n.toFixed(2)));
  const strange = [...text.replace(title, '').matchAll(/\$(\d+\.\d{2})/g)].map((m) => Number(m[1])).filter((n) => !expected.includes(n));
  if (strange.length) throw new Error(`The post has an amount that is not a price of the deal: $${strange[0]}.`);
  if (/lowest (price )?ever|all[- ]time low|historical low/i.test(text)) throw new Error('The post claims a record low. Not allowed: only "lowest price we\'ve tracked", and only when the history confirms it.');
  return { text, length: lengthOf(text), max: channel.maxChars, link, warnings };
}
