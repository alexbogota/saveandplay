// The guides of the site as Nostr article notes (owner, 11 Oct 2026: a guide on the site may go to Nostr, no approval; one article every 2 days).
// Used by scripts/post-nostr.mjs (--kind article) and scripts/nostr-sync-articles.mjs (the preview). No AI, no keys.
//
// Which guide is next: src/pages/guides/<name>.md that is not posted yet (drafts/posted-nostr.json, section articles) and has no "nostr: false"
// in its header; the oldest first (by "updated" of the header; guides without a date after the dated ones; the same date by file name).
// The text: the record of data/nostr-articles.json for that name (lines, tags, image, imageAlt, path, campaign) if there is one,
// otherwise a template from the header: title, an empty line, description; the tags of the header; the picture of the header
// only if the file is in public/, is a PNG of 1200x630 and has an alt text.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { file, readJson, BRAND_TAG, OLD_AD_TAG } from './nostr.mjs';
import { splitArticle, pngSize } from '../article-tools.mjs';

export const GUIDES = 'src/pages/guides';
const IMAGE_SIZE = [1200, 630];

// Tags of the header: "tags: [a, b]", "tags: a, b" or a block list ("tags:" then "  - a" lines). null = the header has no tags.
export function headerTags(text) {
  const head = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const lines = head.split(/\r?\n/);
  const i = lines.findIndex((l) => /^tags:/.test(l));
  if (i < 0) return null;
  const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');
  const inline = lines[i].slice(5).trim();
  if (inline) return inline.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
  const out = [];
  for (const l of lines.slice(i + 1)) {
    const m = l.match(/^\s*-\s*(.*)$/);
    if (!m) break;
    out.push(unquote(m[1]));
  }
  return out.filter(Boolean);
}

// "Steam Deck" -> "steamdeck", "#GOG" -> "gog". What still does not fit a-z, 0-9, _ and 2-30 characters is dropped with a reason.
export function cleanTags(raw = []) {
  const tags = [];
  const dropped = [];
  for (const t of raw) {
    const h = String(t).trim().replace(/^#/, '').toLowerCase().replace(/[\s-]+/g, '');
    if (h === OLD_AD_TAG || h.startsWith(BRAND_TAG)) dropped.push(`${t} (not a topic tag)`);
    else if (!/^[a-z0-9_]{2,30}$/.test(h)) dropped.push(`${t} (only a-z, 0-9, _ and 2-30 long)`);
    else if (!tags.includes(h)) tags.push(h);
  }
  return { tags, dropped };
}

// Why the picture of the header cannot go into the note, or null if it can.
export function imageProblem(image, imageAlt) {
  if (!image) return 'the header has no image';
  if (!/^\/[^\s?#]+$/.test(image)) return `image "${image}" is not a site path`;
  if (!String(imageAlt ?? '').trim()) return 'the header has no imageAlt';
  const p = file(`public${image}`);
  if (!existsSync(p)) return `public${image} does not exist`;
  const size = pngSize(readFileSync(p));
  if (!size) return `public${image} is not a PNG`;
  if (size.width !== IMAGE_SIZE[0] || size.height !== IMAGE_SIZE[1]) return `public${image} is ${size.width}x${size.height}, needs ${IMAGE_SIZE.join('x')}`;
  return null;
}

// A line of the note may not carry the ad mark: an article note links to our own guide.
const cleanLine = (s) => String(s).replace(/(^|\s)#ad\b/gi, '').replace(/\s+/g, ' ').trim();

// The template note of one guide from its header, or { skip } with the reason.
export function draftOf(slug, text) {
  const { fm } = splitArticle(text);
  if (!fm) return { skip: 'no header (--- ... ---)' };
  const title = cleanLine(fm.title ?? '');
  const description = cleanLine(fm.description ?? '');
  if (!title) return { skip: 'the header has no title' };
  if (!/^[a-z0-9_-]+$/i.test(slug)) return { skip: 'the file name has characters other than letters, digits, - and _' };
  const lines = [title, ...(description ? ['', description] : [])].filter((l) => !/^ad:/i.test(l));

  const notes = [];
  if (!description) notes.push('the header has no description, the note has the title only');
  const raw = headerTags(text);
  const { tags, dropped } = cleanTags(raw ?? []);
  if (raw === null) notes.push('the header has no tags');
  if (dropped.length) notes.push(`tags dropped: ${dropped.join(', ')}`);

  const draft = { path: `/guides/${slug}/`, campaign: slug, tags, lines };
  const why = imageProblem(fm.image, fm.imageAlt);
  if (why) notes.push(`no picture: ${why}`);
  else Object.assign(draft, { image: fm.image, imageAlt: String(fm.imageAlt).trim() });
  return { draft, notes };
}

// Every guide: { slug, text, updated, off }, oldest first.
export function listGuides() {
  const dir = file(GUIDES);
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.md')) : [];
  const out = names.map((n) => {
    const slug = n.slice(0, -3);
    const text = readFileSync(file(`${GUIDES}/${n}`), 'utf8');
    const fm = splitArticle(text).fm ?? {};
    const updated = /^\d{4}-\d{2}-\d{2}/.test(String(fm.updated ?? '')) ? String(fm.updated).slice(0, 10) : null;
    return { slug, text, updated, off: String(fm.nostr ?? '').trim().toLowerCase() === 'false' };
  });
  return out.sort((a, b) => (a.updated ?? '9999').localeCompare(b.updated ?? '9999') || a.slug.localeCompare(b.slug));
}

export const articleRecords = () => readJson('data/nostr-articles.json', { articles: {} }).articles ?? {};

// The article of one guide: the record of data/nostr-articles.json if there is one (it wins over the template), else the template.
// Returns { article, source, notes } or { skip }.
export function articleFor(g, records = articleRecords()) {
  const rec = records[g.slug];
  if (rec) return { article: { path: `/guides/${g.slug}/`, campaign: g.slug, ...rec, slug: g.slug }, source: 'data/nostr-articles.json', notes: [] };
  const t = draftOf(g.slug, g.text);
  if (t.skip) return { skip: t.skip };
  return { article: { ...t.draft, slug: g.slug }, source: 'template from the header', notes: t.notes };
}

// The guides that wait for their note: not posted, not switched off; the ones named first come first (redo), then the oldest.
export function waitingGuides(posted = {}, first = []) {
  const all = listGuides().filter((g) => !g.off && !posted[g.slug]);
  return [...first.map((s) => all.find((g) => g.slug === s)).filter(Boolean), ...all.filter((g) => !first.includes(g.slug))];
}

// ---------- the 2-day rule (days of the account's time zone, YYYY-MM-DD) ----------

export const ARTICLE_EVERY_DAYS = 2;
export const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// The day of the last article note: the record of posted articles and the article slots of the days (a note found on a relay has no name).
// ignoreIds = notes that do not count (deleted or about to be deleted by redo).
export function lastArticleDay(days = {}, posted = {}, ignoreIds = new Set()) {
  let last = null;
  for (const p of Object.values(posted)) if (p?.day && !ignoreIds.has(p.id) && p.day > (last ?? '')) last = p.day;
  for (const [d, slots] of Object.entries(days)) {
    const a = slots?.article;
    if (a && (a.status === 'done' || a.status === 'partial') && !ignoreIds.has(a.id) && d > (last ?? '')) last = d;
  }
  return last;
}

// The first day the next article may go out: today, or 2 days after the last one.
export const earliestArticleDay = (today, last) => (last && addDays(last, ARTICLE_EVERY_DAYS) > today ? addDays(last, ARTICLE_EVERY_DAYS) : today);
