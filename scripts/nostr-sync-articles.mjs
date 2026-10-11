// A preview of the article notes of Nostr: which guide goes out next and with which text. Read only: it writes nothing, no AI, no keys.
//
//   npm run nostr:articles
//   node scripts/nostr-sync-articles.mjs --account nostr-cozy     another account (the key as in data/nostr-accounts.json; default "nostr")
//
// Since 11 Oct 2026 the articles go out by themselves (scripts/post-nostr.mjs --kind article, at most one every 2 days): the oldest guide of
// src/pages/guides/ that is not posted and has no "nostr: false" in its header. Its text is the record of data/nostr-articles.json if there is one,
// otherwise the template from the header (scripts/lib/nostr-guides.mjs). What is already posted is in drafts/posted-nostr.json; on GitHub it lives on the
// "brief" branch, so on the computer the list may show as waiting what already went out.

import { existsSync } from 'node:fs';
import { file, readJson, nostrAccounts, buildArticleNote } from './lib/nostr.mjs';
import { listGuides, articleFor, articleRecords } from './lib/nostr-guides.mjs';

const args = process.argv.slice(2);
if (args.includes('--write') || args.includes('--check')) {
  console.error('This command only shows the preview now: the articles go to Nostr by themselves (no queue, no approval). Nothing was written.');
  process.exit(2);
}
const id = args.includes('--account') ? args[args.indexOf('--account') + 1] : 'nostr';
const { account, links } = nostrAccounts(id)[0];
const local = existsSync(file('drafts/posted-nostr.json'));
const posted = readJson('drafts/posted-nostr.json', { articles: {} }).articles?.[id] ?? {};
const records = articleRecords();

console.log(`Guides in the order Nostr posts them (oldest first, at most one every 2 days, 12:00 Bogota). Account "${id}".`);
if (!local) console.log('(No drafts/posted-nostr.json on this computer: the record of posted notes is on the "brief" branch, so "waiting" may include posted ones.)');
let next = null;
for (const g of listGuides()) {
  const head = `${g.slug} (updated ${g.updated ?? 'no date'})`;
  if (posted[g.slug]) {
    console.log(`  posted   ${head}: ${posted[g.slug].day}`);
    continue;
  }
  if (g.off) {
    console.log(`  off      ${head}: "nostr: false" in the header`);
    continue;
  }
  const r = articleFor(g, records);
  let note = null;
  if (!r.skip) {
    try {
      note = buildArticleNote(r.article, account, links?.site);
    } catch (e) {
      r.skip = e.message;
    }
  }
  if (r.skip) {
    console.log(`  BROKEN   ${head}: ${r.skip}`);
    continue;
  }
  next ??= g.slug;
  console.log(`  ${next === g.slug ? 'NEXT   ' : 'waiting'}  ${head}: text from ${r.source}${r.notes.length ? `; ${r.notes.join('; ')}` : ''}`);
  for (const l of note.content.split('\n')) console.log(`      | ${l}`);
}
console.log(next ? `\nNext article: ${next}.` : '\nNo articles waiting.');
