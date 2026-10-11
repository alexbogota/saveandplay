// Puts every new guide of the site into the Nostr article queue as a DRAFT (approved: false). Nothing is published, no AI, no keys.
//
//   npm run nostr:articles                     show what would be added, change nothing (the default)
//   npm run nostr:articles -- --write          add the drafts to data/nostr-articles.json
//   node scripts/nostr-sync-articles.mjs --check            one line only: the guides without a Nostr draft (the dry-run of "Post to Nostr" shows it in Summary)
//   node scripts/nostr-sync-articles.mjs --account nostr-cozy   another queue (the key as in data/nostr-accounts.json; default "nostr")
//
// A guide is src/pages/guides/<name>.md. It is new when data/nostr-articles.json has no article <name>. The draft is built from the header of the guide only:
//   lines    = title, an empty line, description (no "#ad", no "Ad:" line: the note links to our own guide, not to a store)
//   path     = /guides/<name>/          campaign = <name>
//   tags     = "tags" of the header (if it has them), as a-z, 0-9, _ and 2-30 long; the others are dropped and named in the report
//   image    = "image" and "imageAlt" of the header, only if the file exists in public/, is a PNG of 1200x630 and the alt text is not empty
//   approved = false always: the owner reads the text and switches it to true by hand.
// The name goes to the end of the account's queue. Articles that are already in the file are never changed.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { file, readJson, summary, BRAND_TAG, OLD_AD_TAG } from './lib/nostr.mjs';
import { splitArticle, pngSize } from './article-tools.mjs';

const ARTICLES = 'data/nostr-articles.json';
const GUIDES = 'src/pages/guides';
const IMAGE_SIZE = [1200, 630];

// Tags of the header: "tags: [a, b]", "tags: a, b" or a block list ("tags:" then "  - a" lines).
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
    if (h === OLD_AD_TAG || h === BRAND_TAG) dropped.push(`${t} (not a topic tag)`);
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

// The draft of one guide, or { skip } with the reason.
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

  const draft = { approved: false, path: `/guides/${slug}/`, campaign: slug, tags, lines };
  const why = imageProblem(fm.image, fm.imageAlt);
  if (why) notes.push(`no picture: ${why}`);
  else Object.assign(draft, { image: fm.image, imageAlt: String(fm.imageAlt).trim() });
  return { draft, notes };
}

// Compares the guides with the file. Returns { cfg, added: [{ slug, draft, notes }], skipped: [{ slug, reason }] }; cfg already has the drafts in it.
export function sync(account = 'nostr') {
  const cfg = readJson(ARTICLES, { articles: {}, queues: {} });
  cfg.articles ??= {};
  cfg.queues ??= {};
  const queue = (cfg.queues[account] ??= []);
  const dir = file(GUIDES);
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.md')).sort() : [];
  const added = [];
  const skipped = [];
  for (const n of names) {
    const slug = n.slice(0, -3);
    if (cfg.articles[slug]) continue; // already there: never changed
    const r = draftOf(slug, readFileSync(file(`${GUIDES}/${n}`), 'utf8'));
    if (r.skip) {
      skipped.push({ slug, reason: r.skip });
      continue;
    }
    cfg.articles[slug] = r.draft;
    if (!queue.includes(slug)) queue.push(slug);
    added.push({ slug, ...r });
  }
  return { cfg, added, skipped };
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const check = args.includes('--check');
  const account = args.includes('--account') ? args[args.indexOf('--account') + 1] : 'nostr';
  const { cfg, added, skipped } = sync(account);
  const missing = [...added.map((a) => a.slug), ...skipped.map((s) => s.slug)];

  if (check) {
    // Read only, for the dry-run of "Post to Nostr": one line, and a warning when there is something to add.
    if (!missing.length) return console.log('Every guide has a Nostr draft.');
    const line = `Guides without a Nostr draft: ${missing.join(', ')}`;
    console.log(process.env.GITHUB_ACTIONS ? `::warning::${line}` : `WARNING: ${line}`);
    summary(`\n**${line}** (run \`npm run nostr:articles\` on the computer)\n`);
    return;
  }

  console.log(`Queue "${account}" of ${ARTICLES}: ${added.length} new draft(s), ${skipped.length} guide(s) skipped.\n`);
  for (const a of added) {
    console.log(`+ ${a.slug}  (approved: false, picture: ${a.draft.image ? 'yes' : 'no'}, tags: ${a.draft.tags.length ? a.draft.tags.join(', ') : 'none'})`);
    for (const l of a.draft.lines) console.log(`    | ${l}`);
    for (const n of a.notes) console.log(`    note: ${n}`);
  }
  for (const s of skipped) console.log(`- ${s.slug}: skipped, ${s.reason}`);

  if (!added.length) return console.log('Nothing to add.');
  if (!write) return console.log('\nNothing was written. To add these drafts: npm run nostr:articles -- --write');
  writeFileSync(file(ARTICLES), JSON.stringify(cfg, null, 2) + '\n');
  console.log(`\nWritten to ${ARTICLES}. Every new draft has approved: false: it is not posted until the owner reads it and sets approved: true.`);
}

if (process.argv[1] && /nostr-sync-articles\.mjs$/.test(process.argv[1])) main();
