// Shows the posts of the last list that were NOT shown before, and remembers them as shown. This is the step the chat uses.
// The list (drafts/comments-<account>.json) is made by the finder; the posts shown earlier are in drafts/comments-shown-<account>*.json.
//
//   node scripts/comments-show.mjs                                     account "prices", up to 8 posts, nothing is remembered (a look)
//   node scripts/comments-show.mjs --limit 8 --record-new OUT.json    also writes ONLY the posts shown now to OUT.json (a new file for the GitHub branch: nothing old is touched)
//   node scripts/comments-show.mjs --limit 8 --record OUT.json         also writes the full "shown" list (old ones + these) to OUT.json (the owner's computer)
//   node scripts/comments-show.mjs --account NAME --max-age 30 --stale 8      --stale N: the oldest list allowed, in hours (default 8: the list is made every 6 hours)
//
// Why it exists: the finder skips shown posts only at the moment it makes a list, but a list is read several times. This step skips them on every read.
// With --record OUT.json the one file keeps the whole memory: copy it over drafts/comments-shown-<account>.json (the finder reads it too). Entries older than 21 days are dropped.
// With --record-new OUT.json the file holds only what was shown now. Name it comments-shown-<account>-<date and time>.json, so every chat adds its own file and the finder reads them all.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { file, postKey, reportLine, commentAccounts } from './lib/comments.mjs';

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const id = arg('--account') ?? 'prices';
const limit = Number(arg('--limit') ?? 8);
const record = arg('--record');
const recordNew = arg('--record-new');
const staleHours = Number(arg('--stale') ?? 8);
let maxAgeHours = Number(arg('--max-age') ?? 0);
const KEEP_DAYS = 21;
const now = Date.now();

if (!maxAgeHours) {
  try { maxAgeHours = commentAccounts(id)[0].account.maxAgeHours; } catch { maxAgeHours = 30; }
}

const listPath = file('drafts', `comments-${id}.json`);
if (!existsSync(listPath)) {
  console.log(`NO LIST: drafts/comments-${id}.json is missing. Ask the owner to start the "Comment candidates" workflow on GitHub (or run npm run comments:find) and stop.`);
  process.exit(2);
}
let list;
try { list = JSON.parse(readFileSync(listPath, 'utf8')); } catch { console.log(`NO LIST: drafts/comments-${id}.json cannot be read. Ask the owner to run npm run comments:find and stop.`); process.exit(2); }

// everything shown so far: key -> { url, at }
const shown = new Map();
const dir = file('drafts');
if (existsSync(dir)) {
  for (const f of readdirSync(dir)) {
    if (!(f === `comments-shown-${id}.json` || (f.startsWith(`comments-shown-${id}-`) && f.endsWith('.json')))) continue;
    try {
      for (const x of JSON.parse(readFileSync(resolve(dir, f), 'utf8'))) {
        const url = typeof x === 'string' ? x : x?.url ?? x?.uri;
        const k = postKey(url);
        if (k && !shown.has(k)) shown.set(k, { url, at: (typeof x === 'object' && x?.at) || new Date(now).toISOString() }); // not x?.at: a string has a method called at
      }
    } catch { /* a broken file is ignored */ }
  }
}

const made = list.madeAt ? Date.parse(list.madeAt) : NaN;
const ageH = Number.isFinite(made) ? (now - made) / 36e5 : null;
// A stale or undated list is never shown: the owner may have answered many of its posts since, and the chat must not draft from it.
if (ageH == null || ageH > staleHours) {
  console.log(`STALE LIST: ${ageH == null ? 'its age is unknown (an old list)' : `made ${list.madeAt}, ${ageH.toFixed(1)} h ago, the limit is ${staleHours} h`}. Tell the owner (in Russian) to start the "Comment candidates" workflow on GitHub (Actions, Run workflow) and wait about two minutes, or to run npm run comments:find on his computer, then stop. No posts are shown from a stale list (the owner can allow an older one with --stale 24).`);
  process.exit(3);
}
const dropped = { shown: 0, old: 0 };
const fresh = (c) => {
  if (shown.has(postKey(c.url))) { dropped.shown++; return false; }
  const t = Date.parse(c.createdAt);
  if (Number.isFinite(t) && (now - t) / 36e5 > maxAgeHours) { dropped.old++; return false; }
  return true;
};
const normal = (list.normal ?? []).filter(fresh).slice(0, limit);
const heated = (list.heated ?? []).filter(fresh).slice(0, Math.min(2, limit));

const out = [];
out.push(`LIST AGE: ${ageH.toFixed(1)} h (made ${list.madeAt}).`);
out.push(`NEW POSTS: ${normal.length}${heated.length ? ` + ${heated.length} heated` : ''}. Not shown again: already shown ${dropped.shown}, too old ${dropped.old}.`);
if (normal.length) out.push('', '## Posts', normal.map((c, i) => reportLine(c, i, now)).join('\n'));
if (heated.length) out.push('', '## Heated topics: reply only neutrally, with facts', heated.map((c, i) => reportLine(c, i, now)).join('\n'));
if (!normal.length && !heated.length) out.push('', 'No new posts in this list. Tell the owner to wait for the next list or run npm run comments:find.');

if (recordNew) {
  const added = [...normal, ...heated].map((c) => ({ url: c.url, at: new Date(now).toISOString() }));
  mkdirSync(dirname(resolve(recordNew)), { recursive: true });
  writeFileSync(recordNew, JSON.stringify(added, null, 2));
  out.push('', `REMEMBERED: ${added.length} posts as shown, in the new file ${recordNew}. Put it on the GitHub branch now (bash scripts/comments-branch.sh save ${recordNew}).`);
}
if (record) {
  const cutoff = now - KEEP_DAYS * 864e5;
  const all = new Map([...shown].filter(([, v]) => !(Date.parse(v.at) < cutoff)));
  for (const c of [...normal, ...heated]) all.set(postKey(c.url), { url: c.url, at: new Date(now).toISOString() });
  mkdirSync(dirname(resolve(record)), { recursive: true });
  writeFileSync(record, JSON.stringify([...all.values()], null, 2));
  out.push('', `REMEMBERED: ${normal.length + heated.length} posts as shown. The full shown list (${all.size} posts) is in ${record}: copy it over drafts/comments-shown-${id}.json.`);
}
console.log(out.join('\n'));
