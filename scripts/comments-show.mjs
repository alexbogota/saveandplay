// Shows the posts of the last list that were NOT shown before, and remembers them as shown. This is the step the chat uses.
// The list (drafts/comments-<account>.json) is made by the finder; the posts shown earlier are in drafts/comments-shown-<account>*.json.
//
//   node scripts/comments-show.mjs                                     account "prices", up to showLimit posts (8 if the settings do not say), nothing is remembered (a look)
//   node scripts/comments-show.mjs --limit 8 --record-new OUT.json    also writes ONLY the posts shown now to OUT.json (a new file for the GitHub branch: nothing old is touched)
//   node scripts/comments-show.mjs --limit 8 --record OUT.json         also writes the full "shown" list (old ones + these) to OUT.json (the owner's computer)
//   node scripts/comments-show.mjs --account NAME --max-age 30 --stale 8      --stale N: the oldest list allowed, in hours (default 8: the list is made every 6 hours)
//   node scripts/comments-show.mjs --all --record-new-all STAMP        EVERY enabled account of data/comments-accounts.json in one go (the phrase "комментарии saveandplay")
//   node scripts/comments-show.mjs --all --wide --record-new-all STAMP    the wide mode of EVERY account (the phrase "комментарии saveandplay 2"): the blocks marked onDemand (prices-wide, mastodon-prices-wide, cozy-wide, retro-wide); each shares the memory "shown" of its normal block (shownAs)
//   node scripts/comments-show.mjs --all --partial --record-new-all STAMP     same, but an account whose list is missing or stale is only reported and skipped
//
// Why it exists: the finder skips shown posts only at the moment it makes a list, but a list is read several times. This step skips them on every read.
// With --record OUT.json the one file keeps the whole memory: copy it over drafts/comments-shown-<account>.json (the finder reads it too). Entries older than 21 days are dropped.
// With --record-new OUT.json the file holds only what was shown now. Name it comments-shown-<account>-<date and time>.json, so every chat adds its own file and the finder reads them all.
//
// --all: one block per account, in the order of the settings file (prices, mastodon-prices, cozy, retro, ...), each with ITS OWN list and ITS OWN memory.
// How many posts a block shows is "showLimit" of the account (--limit, if given, replaces it for all). With --record-new-all STAMP every block that showed posts writes
// drafts/comments-shown-<account>-STAMP.json, and the last lines give the one command that puts them all on the GitHub branch.
// Without --partial, if the list of any account is missing or stale NOTHING is shown or remembered (exit code 3): start the workflow once (it makes every list) and repeat.
// With --partial the accounts with a good list are shown and the others are named in their block (a block may be empty; that is fine).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { file, postKey, reportLine, commentAccounts } from './lib/comments.mjs';

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const all = args.includes('--all');
const partial = args.includes('--partial');
const wide = args.includes('--wide');
const limitArg = arg('--limit');
const record = arg('--record');
const recordNew = arg('--record-new');
const recordNewAll = arg('--record-new-all');
const staleHours = Number(arg('--stale') ?? 8);
const KEEP_DAYS = 21;
const now = Date.now();

// everything shown so far for an account: key -> { url, at }
function loadShownMap(id) {
  const shown = new Map();
  const dir = file('drafts');
  if (!existsSync(dir)) return shown;
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
  return shown;
}

const accountOf = (id) => { try { return commentAccounts(id)[0].account; } catch { return null; } };

// Reads the list of one account. { problem: { code, text } } when there is nothing usable, else { list, ageH }.
function readList(id) {
  const listPath = file('drafts', `comments-${id}.json`);
  if (!existsSync(listPath)) return { problem: { code: 2, kind: 'NO LIST', text: `NO LIST: drafts/comments-${id}.json is missing. Ask the owner to start the "Comment candidates" workflow on GitHub (or run npm run comments:find) and stop.` } };
  let list;
  try { list = JSON.parse(readFileSync(listPath, 'utf8')); } catch { return { problem: { code: 2, kind: 'NO LIST', text: `NO LIST: drafts/comments-${id}.json cannot be read. Ask the owner to run npm run comments:find and stop.` } }; }
  const made = list.madeAt ? Date.parse(list.madeAt) : NaN;
  const ageH = Number.isFinite(made) ? (now - made) / 36e5 : null;
  // A stale or undated list is never shown: the owner may have answered many of its posts since, and the chat must not draft from it.
  if (ageH == null || ageH > staleHours) {
    return { problem: { code: 3, kind: 'STALE LIST', text: `STALE LIST: ${ageH == null ? 'its age is unknown (an old list)' : `made ${list.madeAt}, ${ageH.toFixed(1)} h ago, the limit is ${staleHours} h`}. Tell the owner (in Russian) to start the "Comment candidates" workflow on GitHub (Actions, Run workflow) and wait about two minutes, or to run npm run comments:find on his computer, then stop. No posts are shown from a stale list (the owner can allow an older one with --stale 24).` } };
  }
  return { list, ageH };
}

// The posts of one account that may be shown now. { text (the report), shown: [candidates], shownMap }
function pickPosts(id, list, ageH, limit) {
  const maxAgeHours = Number(arg('--max-age') ?? 0) || accountOf(id)?.maxAgeHours || 30;
  const shown = loadShownMap(accountOf(id)?.shownAs ?? id); // shownAs: shares the memory of another block, so no post is shown twice across the two modes
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
  return { text: out.join('\n'), posts: [...normal, ...heated], shown };
}

const writeNew = (path, posts) => {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, JSON.stringify(posts.map((c) => ({ url: c.url, at: new Date(now).toISOString() })), null, 2));
};

// ---- one account (the old way) ----
function single() {
  const id = arg('--account') ?? 'prices';
  const limit = Number(limitArg ?? accountOf(id)?.showLimit ?? 8);
  const r = readList(id);
  if (r.problem) { console.log(r.problem.text); process.exit(r.problem.code); }
  const { text, posts, shown } = pickPosts(id, r.list, r.ageH, limit);
  const out = [text];
  if (recordNew) {
    writeNew(recordNew, posts);
    out.push('', `REMEMBERED: ${posts.length} posts as shown, in the new file ${recordNew}. Put it on the GitHub branch now (bash scripts/comments-branch.sh save ${recordNew}).`);
  }
  if (record) {
    const cutoff = now - KEEP_DAYS * 864e5;
    const keep = new Map([...shown].filter(([, v]) => !(Date.parse(v.at) < cutoff)));
    for (const c of posts) keep.set(postKey(c.url), { url: c.url, at: new Date(now).toISOString() });
    mkdirSync(dirname(resolve(record)), { recursive: true });
    writeFileSync(record, JSON.stringify([...keep.values()], null, 2));
    out.push('', `REMEMBERED: ${posts.length} posts as shown. The full shown list (${keep.size} posts) is in ${record}: copy it over drafts/comments-shown-${id}.json.`);
  }
  console.log(out.join('\n'));
}

// ---- every enabled account ----
function everyone() {
  // onDemand blocks (the wide mode, "комментарии saveandplay 2") are not part of the normal "all". With --wide the run takes ONLY them (one wide block per account).
  const accounts = commentAccounts().filter(({ account }) => account.enabled !== false && (wide ? account.onDemand : !account.onDemand));
  const lists = accounts.map((a) => ({ ...a, ...readList(a.id) }));
  const bad = lists.filter((l) => l.problem);
  if (bad.length && !partial) {
    console.log(`${bad.some((b) => b.problem.kind === 'STALE LIST') ? 'STALE LIST' : 'NO LIST'}: no list for ${bad.map((b) => `${b.id} (${b.problem.kind === 'NO LIST' ? 'missing' : 'stale'})`).join(', ')}. Nothing was shown and nothing was remembered. Start the "Comment candidates" workflow ONCE (it makes the list of every account), wait for it to end, then repeat this command with --partial (an account whose list still is not usable is then only named and skipped). Tell the owner (in Russian) only if the workflow cannot be started.`);
    process.exit(bad.some((b) => b.problem.kind === 'STALE LIST') ? 3 : 2);
  }
  const written = [];
  const out = [];
  for (const l of lists) {
    out.push(`\n==================== ${l.id} (${l.account.platform === 'mastodon' ? '' : '@'}${l.account.handle}) ====================`);
    if (l.problem) { out.push(`SKIPPED (${l.problem.kind}): the list of this account is not usable now. Say so to the owner in one line; the block stays empty.`); continue; }
    const limit = Number(limitArg ?? l.account.showLimit ?? 8);
    const { text, posts } = pickPosts(l.id, l.list, l.ageH, limit);
    out.push(text);
    if (recordNewAll && posts.length) {
      const path = `drafts/comments-shown-${l.account.shownAs ?? l.id}-${recordNewAll}.json`;
      writeNew(file(path), posts);
      written.push(path);
      out.push(`REMEMBERED: ${posts.length} posts of ${l.id} in ${path}.`);
    }
  }
  out.push('', '==================== SAVE ====================');
  if (!recordNewAll) out.push('Nothing was remembered (no --record-new-all STAMP given): this was a look.');
  else if (!written.length) out.push('Nothing was shown, so there is nothing to save.');
  else out.push(`Put the memory on the GitHub branch now, ONE command: bash scripts/comments-branch.sh save ${written.join(' ')}`);
  console.log(out.join('\n').trimStart());
}

if (all) everyone();
else single();
