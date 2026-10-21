// The chat's step for the replies that the program sends (accounts with their own "send" settings in data/comments-accounts.json:
// the main Bluesky account, Cozy and Retro). The other accounts (Mastodon) are sent by hand as before.
//
//   node scripts/comments-drafts.mjs new --account prices --stamp STAMP --in FILE.json
//        FILE.json: [{ "post": "<the post link from the list>", "text": "<the reply>", "verify": "<what the owner must check; leave out if nothing>" }, ...]
//        Checks every draft (the sender checks again before sending), numbers them, saves drafts/comments-drafts-prices-STAMP.json
//        and prints the list to show the owner EXACTLY as it is. When a draft has a problem nothing is saved: fix it and run again.
//   node scripts/comments-drafts.mjs approve --account prices --ok all            the owner said "ок": every draft except those marked VERIFY
//   node scripts/comments-drafts.mjs approve --account prices --ok 1,3,5-7        only these (a VERIFY draft goes only when its number is named)
//   node scripts/comments-drafts.mjs approve --account prices --ok all --skip 4   all except 4
//   node scripts/comments-drafts.mjs approve --account prices --ok all --edits EDITS.json    with the owner's own texts, EDITS.json = { "4": "his text" }
//        (--edit 4 "text" works too; an edited draft counts as approved). Uses the newest drafts of the account (or --file drafts/comments-drafts-....json),
//        writes drafts/comments-approved-....json and prints the ONE command that saves it on the branch and starts the "Send comments" workflow.
//   node scripts/comments-drafts.mjs cancel --account prices [--n 4,5]            the owner said "стоп": approved replies not sent yet are never sent
//   node scripts/comments-drafts.mjs status                                       last sending, room left today, how our replies do (likes, replies, best ones)
//
// Exit codes: 0 fine, 1 a problem (nothing saved), 4 the account is sent by hand (no sending of its own).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { commentAccounts, file, postKey } from './lib/comments.mjs';
import {
  sendSettings, sendProblems, replyProblems, stampOf, uniqueName, brief, itemKey, finalKeys, sentWithin, pendingItems, earlierTexts,
  loadDraftFiles, loadApprovedFiles, loadCancelFiles, loadSent, loadStatsFiles,
} from './lib/comments-send.mjs';

const REPO = process.env.COMMENTS_REPO || 'alexbogota/saveandplay';
const args = process.argv.slice(2);
const cmd = args[0];
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? null : null; };
const now = Date.now();
const lc = (s) => String(s ?? '').toLowerCase();
const done = (text, code = 0) => { console.log(text); process.exit(code); };

// "1,3,5-7" -> [1, 3, 5, 6, 7]
function numbers(s) {
  const out = [];
  for (const tok of String(s ?? '').split(/[,\s]+/).filter(Boolean)) {
    const m = tok.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) done(`PROBLEM: "${tok}" is not a number or a range like 5-7.`, 1);
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.push(n);
  }
  return out;
}

function accountFor(block) {
  if (!block) done('PROBLEM: say which account: --account prices (or prices-wide, the wide mode).', 1);
  let account;
  try { account = commentAccounts(block)[0].account; } catch (e) { done(`PROBLEM: ${e.message}.`, 1); }
  const s = sendSettings(account);
  if (!s.enabled) done(`SENT BY HAND: the account "${block}" (@${account.handle}) has no sending of its own. Show its drafts as before; the owner sends them himself.`, 4);
  const p = sendProblems(account);
  if (p.length) done(`PROBLEM: data/comments-accounts.json, "${block}" send: ${p.join('; ')}.`, 1);
  return { account, s };
}

// Room left in the daily limit: sent in the last 24 h and approved replies still waiting both count.
function room(handle, s) {
  const sent = loadSent();
  const waiting = pendingItems({ approved: loadApprovedFiles(), sent, cancels: loadCancelFiles(), handle })
    .filter((p) => !p.cancelled && now - Date.parse(p.approvedAt) <= s.maxApprovalAgeHours * 36e5).length;
  const last24 = sentWithin(sent, handle, 24, now).length;
  return { last24, waiting, left: Math.max(0, s.dailyLimit - last24 - waiting) };
}

// ---- new: check, number and save the drafts before they are shown ----------------------------------------------------
function cmdNew() {
  const block = arg('--account');
  const stamp = arg('--stamp');
  const input = arg('--in');
  if (!stamp || !input) done('Usage: node scripts/comments-drafts.mjs new --account prices --stamp STAMP --in FILE.json', 1);
  if (!/^\d{8}-\d{6}$/.test(stamp)) done('PROBLEM: --stamp must look like 20261020-153000 (the same STAMP as the shown files).', 1);
  const { account, s } = accountFor(block);
  const name = `comments-drafts-${block}-${stamp}.json`;
  if (loadDraftFiles().some((f) => f.name === name)) done(`PROBLEM: ${name} exists already. Saved drafts never change: run again with a new STAMP ($(date -u +%Y%m%d-%H%M%S)).`, 1);
  let list;
  try { list = JSON.parse(readFileSync(file('drafts', `comments-${block}.json`), 'utf8')); } catch { done(`PROBLEM: drafts/comments-${block}.json is missing or broken: run bash scripts/comments-branch.sh load first.`, 1); }
  const byKey = new Map();
  for (const c of [...(list.normal ?? []), ...(list.heated ?? [])]) { byKey.set(postKey(c.url), c); byKey.set(postKey(c.uri), c); }
  let drafts;
  try { drafts = JSON.parse(readFileSync(input, 'utf8')); } catch (e) { done(`PROBLEM: ${input} is not valid JSON (${e.message}).`, 1); }
  if (!Array.isArray(drafts) || !drafts.length) done('PROBLEM: the drafts file must be a list: [{ "post": "...", "text": "..." }, ...].', 1);

  const approved = loadApprovedFiles();
  const sent = loadSent();
  const handled = finalKeys(sent);
  const waiting = new Set(pendingItems({ approved, sent, cancels: loadCancelFiles(), handle: account.handle }).filter((p) => !p.cancelled).map((p) => p.key));
  const earlier = earlierTexts({ approved, sent, handle: account.handle, now });
  const recent = new Set(s.perAuthorHours > 0 ? sentWithin(sent, account.handle, s.perAuthorHours, now).map((e) => lc(e.author)) : []);
  const items = [];
  const problems = [];
  drafts.forEach((d, i) => {
    const n = i + 1;
    const c = byKey.get(postKey(d?.post));
    if (!c) { problems.push(`${n}: ${d?.post ?? '(no post)'} is not in the list of ${block}: draft only for posts the list shows`); return; }
    const key = itemKey(account.handle, c.uri);
    if (items.some((x) => postKey(x.uri) === postKey(c.uri))) { problems.push(`${n}: a second draft for the same post`); return; }
    if (handled.has(key) || waiting.has(key)) problems.push(`${n}: this post was already answered or approved`);
    if (items.some((x) => lc(x.author) === lc(c.handle))) problems.push(`${n}: a second draft for @${c.handle} in this batch: one reply per person`);
    if (recent.has(lc(c.handle))) problems.push(`${n}: we replied to @${c.handle} less than ${s.perAuthorHours} h ago: one reply per person per day`);
    const text = String(d?.text ?? '').trim();
    const context = [c.text, c.media].filter(Boolean).join('\n');
    for (const p of replyProblems(text, { s, context, earlier, batch: items.map((x) => ({ n: x.n, text: x.text })) })) problems.push(`${n}: ${p}`);
    items.push({ n, uri: c.uri, url: c.url, author: c.handle, context, text, ...(d?.verify ? { verify: String(d.verify).trim() } : {}), group: c.group ?? null, heated: !!c.heated });
  });
  if (problems.length) done(['PROBLEMS: nothing was saved. Fix these drafts (or leave the post out) and run the same command again:', ...problems.map((p) => `- ${p}`)].join('\n'), 1);

  mkdirSync(file('drafts'), { recursive: true });
  writeFileSync(file('drafts', name), JSON.stringify({ account: block, handle: account.handle, platform: 'bluesky', stamp, madeAt: new Date(now).toISOString(), items }, null, 2));
  const r = room(account.handle, s);
  const out = [
    `DRAFTS of ${block} (@${account.handle}): ${items.length}, saved as drafts/${name}.`,
    `Add drafts/${name} to the SAVE command and run it before the owner answers.`,
    'Show the owner these drafts EXACTLY as written here, with their numbers: the program sends only these texts.',
    '',
  ];
  for (const it of items) {
    out.push(`${it.n}. @${it.author} · ${it.url}`, `   Post: ${brief(it.context, 140)}`, `   Reply: ${it.text}`);
    if (it.verify) out.push(`   VERIFY: ${it.verify} (goes only if the owner names number ${it.n} in his "ок")`);
  }
  out.push('', `Daily limit of @${account.handle} in this mode: ${s.dailyLimit} replies in 24 h. Sent in the last 24 h: ${r.last24}, approved and waiting: ${r.waiting}. Room now: ${r.left}.`);
  if (items.length > r.left) out.push(`Only ${r.left} more fit today: if he approves more, the rest are not sent (the daily limit). Tell him.`);
  done(out.join('\n'));
}

// ---- approve: the owner's "ок" ----------------------------------------------------------------------------------------
function cmdApprove() {
  const block = arg('--account');
  const { account, s } = accountFor(block);
  const files = loadDraftFiles().filter((f) => f.data.account === block);
  const drafts = arg('--file')
    ? files.find((f) => f.name === arg('--file').split(/[/\\]/).pop())
    : files.sort((a, b) => Date.parse(b.data.madeAt) - Date.parse(a.data.madeAt))[0];
  if (!drafts) done(`NO DRAFTS of ${block}${arg('--file') ? ` named ${arg('--file')}` : ''}: run bash scripts/comments-branch.sh load, or run the comments again.`, 1);
  const ageH = (now - Date.parse(drafts.data.madeAt)) / 36e5;
  if (!(ageH <= s.maxDraftAgeHours)) done(`TOO OLD: the drafts ${drafts.name} were made ${Number.isFinite(ageH) ? `${ageH.toFixed(1)} h` : 'long'} ago (the limit is ${s.maxDraftAgeHours} h). Nothing approved: run the comments again, the posts may be answered or gone.`, 1);

  const edits = {};
  if (arg('--edits')) {
    try { Object.assign(edits, JSON.parse(readFileSync(arg('--edits'), 'utf8'))); } catch (e) { done(`PROBLEM: ${arg('--edits')} is not valid JSON (${e.message}).`, 1); }
  }
  args.forEach((a, i) => { if (a === '--edit') edits[args[i + 1]] = args[i + 2]; });
  const okTokens = args.flatMap((a, i) => (a === '--ok' ? String(args[i + 1] ?? '').split(/[,\s]+/) : [])).filter(Boolean);
  if (!okTokens.length && !Object.keys(edits).length) done('PROBLEM: say which drafts the owner approved: --ok all, or --ok 1,3,5.', 1);
  const all = okTokens.includes('all');
  const named = new Set(numbers(okTokens.filter((t) => t !== 'all').join(',')));
  const skip = new Set(numbers(arg('--skip')));
  const edited = new Set(Object.keys(edits).map(Number));
  const exists = new Set(drafts.data.items.map((it) => it.n));
  const unknown = [...named, ...skip, ...edited].filter((n) => !exists.has(n));
  if (unknown.length) done(`PROBLEM: there is no draft number ${[...new Set(unknown)].join(', ')} in ${drafts.name} (it has 1 to ${drafts.data.items.length}).`, 1);

  const approvedFiles = loadApprovedFiles();
  const sent = loadSent();
  const handled = finalKeys(sent);
  const waiting = new Set(pendingItems({ approved: approvedFiles, sent, cancels: loadCancelFiles(), handle: account.handle }).filter((p) => !p.cancelled).map((p) => p.key));
  const items = [];
  const notes = [];
  const problems = [];
  const leftVerify = [];
  for (const it of drafts.data.items) {
    const chosen = (all && !it.verify) || named.has(it.n) || edited.has(it.n);
    if (!chosen) { if (all && it.verify && !skip.has(it.n)) leftVerify.push(it.n); continue; }
    if (skip.has(it.n)) continue;
    const key = itemKey(account.handle, it.uri);
    if (handled.has(key)) { notes.push(`${it.n}: already sent or skipped earlier, not approved again`); continue; }
    if (waiting.has(key)) { notes.push(`${it.n}: already approved and waiting`); continue; }
    const text = edited.has(it.n) ? String(edits[it.n] ?? '').trim() : it.text;
    const earlier = earlierTexts({ approved: approvedFiles, sent, handle: account.handle, now, exceptKeys: new Set([key]) });
    const pr = replyProblems(text, { s, context: it.context, earlier, batch: items.map((x) => ({ n: x.n, text: x.text })) });
    if (pr.length) { problems.push(...pr.map((p) => `${it.n}: ${p}`)); continue; }
    items.push({ n: it.n, uri: it.uri, url: it.url, author: it.author, context: it.context, text, edited: edited.has(it.n) && text !== it.text, ...(it.verify ? { verify: it.verify } : {}) });
  }
  if (problems.length) done(['PROBLEMS: nothing was approved. Tell the owner (in Russian) what is wrong and ask, or leave these numbers out:', ...problems.map((p) => `- ${p}`)].join('\n'), 1);
  if (!items.length) done(['NOTHING TO SEND: no draft is approved by these words.', ...notes.map((x) => `- ${x}`), ...(leftVerify.length ? [`- VERIFY drafts not named by the owner: ${leftVerify.join(', ')}`] : [])].join('\n'));

  const r = room(account.handle, s);
  const name = uniqueName(`comments-approved-${block}-${drafts.data.stamp}-${stampOf(now)}`);
  mkdirSync(file('drafts'), { recursive: true });
  writeFileSync(file('drafts', name), JSON.stringify({ account: block, handle: account.handle, platform: 'bluesky', drafts: drafts.name, approvedAt: new Date(now).toISOString(), items }, null, 2));
  const out = [`APPROVED ${items.length} of ${drafts.data.items.length} (${block}, @${account.handle}): ${items.map((x) => `${x.n}${x.edited ? ' (his text)' : ''}`).join(', ')}. Saved as drafts/${name}.`];
  const skipped = drafts.data.items.filter((it) => !items.some((x) => x.n === it.n)).map((it) => it.n);
  if (skipped.length) out.push(`Not approved: ${skipped.join(', ')}.${leftVerify.length ? ` Among them VERIFY drafts the owner did not name: ${leftVerify.join(', ')}.` : ''}`);
  for (const x of notes) out.push(`- ${x}`);
  if (items.length > r.left) out.push(`DAILY LIMIT: only ${r.left} more fit in 24 h (${s.dailyLimit}, sent ${r.last24}, waiting ${r.waiting}): the first ${r.left} go, the rest are skipped. Tell the owner.`);
  out.push('', `NEXT, ONE command: bash scripts/comments-branch.sh save drafts/${name} && gh workflow run "Send comments" -R ${REPO} --ref main`);
  out.push('Then tell the owner (in Russian, short): how many replies go, that they go one by one with pauses of a minute or more, that he can say "стоп", and that the result is in the Summary of the run (Actions, Send comments).');
  done(out.join('\n'));
}

// ---- cancel: the owner's "стоп" ---------------------------------------------------------------------------------------
function cmdCancel() {
  const block = arg('--account') ?? 'prices';
  const { account } = accountFor(block);
  const pending = pendingItems({ approved: loadApprovedFiles(), sent: loadSent(), cancels: loadCancelFiles(), handle: account.handle }).filter((p) => !p.cancelled);
  let keys = null;
  if (arg('--n')) {
    const wanted = new Set(numbers(arg('--n')));
    const newest = loadApprovedFiles().filter((f) => f.data.account === block).sort((a, b) => Date.parse(b.data.approvedAt) - Date.parse(a.data.approvedAt))[0];
    keys = (newest?.data.items ?? []).filter((it) => wanted.has(it.n)).map((it) => itemKey(account.handle, it.uri));
    if (!keys.length) done(`NOTHING TO STOP: the newest approval of ${block} has no number ${[...wanted].join(', ')}.`);
  }
  const affected = pending.filter((p) => !keys || keys.includes(p.key));
  const name = uniqueName(`comments-cancel-${block}-${stampOf(now)}`);
  mkdirSync(file('drafts'), { recursive: true });
  writeFileSync(file('drafts', name), JSON.stringify({ account: block, handle: account.handle, at: new Date(now).toISOString(), ...(keys ? { keys } : { all: true }) }, null, 2));
  done([
    `STOPPED: ${affected.length} approved repl${affected.length === 1 ? 'y' : 'ies'} of @${account.handle} that ${affected.length === 1 ? 'was' : 'were'} not sent yet will never be sent${keys ? ` (numbers ${arg('--n')})` : ''}. Saved as drafts/${name}.`,
    `NEXT, ONE command (saves it, then stops a run that is going now; the run also checks for a "стоп" before every reply):`,
    `bash scripts/comments-branch.sh save drafts/${name} && for st in in_progress queued; do gh run list -R ${REPO} --workflow "Send comments" --status $st --json databaseId -q '.[].databaseId'; done | xargs -r -n1 gh run cancel -R ${REPO}`,
    'Replies that already went out stay: the owner can delete one in the Bluesky app (the three dots under it, Delete post).',
  ].join('\n'));
}

// ---- status: what happened, what is left, how the replies do -----------------------------------------------------------
function cmdStatus() {
  const blocks = commentAccounts().filter(({ account }) => account.enabled !== false && sendSettings(account).enabled);
  if (!blocks.length) done('SENDING: no account has sending switched on (data/comments-accounts.json, "send").');
  const sent = loadSent();
  const stats = loadStatsFiles();
  const out = [];
  for (const handle of [...new Set(blocks.map((b) => lc(b.account.handle)))]) {
    const mine = blocks.filter((b) => lc(b.account.handle) === handle);
    const main = mine.find((b) => !b.account.onDemand) ?? mine[0];
    const s = sendSettings(main.account);
    out.push(`SENDING @${handle} (${mine.map((b) => `${b.id}: limit ${sendSettings(b.account).dailyLimit} in 24 h`).join(', ')}):`);
    const runs = [...new Set(sent.filter((e) => lc(e.handle) === handle).map((e) => e.file))].sort();
    const last = runs.at(-1);
    if (!last) out.push('  No replies sent by the program yet.');
    else {
      const es = sent.filter((e) => e.file === last && lc(e.handle) === handle);
      const why = {};
      for (const e of es.filter((x) => x.status !== 'sent')) why[e.reason] = (why[e.reason] ?? 0) + 1;
      out.push(`  Last run ${String(es[0]?.at ?? '').slice(0, 16).replace('T', ' ')} UTC: ${es.filter((e) => e.status === 'sent').length} sent${Object.keys(why).length ? `; not sent: ${Object.entries(why).map(([k, v]) => `${k} (${v})`).join('; ')}` : ''}.`);
    }
    const r = room(handle, s);
    out.push(`  Sent in the last 24 h: ${r.last24}. Approved and waiting: ${r.waiting}${r.waiting ? ' (if no "Send comments" run is going, start one: gh workflow run "Send comments" -R ' + REPO + ' --ref main)' : ''}.`);
    const st = stats.filter((f) => lc(f.data.handle) === handle).sort((a, b) => Date.parse(b.data.madeAt) - Date.parse(a.data.madeAt))[0]?.data;
    if (!st) out.push('  QUALITY: no numbers yet (they are counted once a day by the "Send comments" workflow).');
    else {
      const m = st.mature ?? {};
      const pct = m.count ? Math.round((100 * m.withLike) / m.count) : 0;
      out.push(`  QUALITY (counted ${String(st.madeAt).slice(0, 16).replace('T', ' ')} UTC; our replies of the last ${st.days} days that are older than 24 h): ${m.count ?? 0} replies, ${m.withLike ?? 0} with a like (${pct}%), ${m.withReply ?? 0} got a reply from a person, ${m.likes ?? 0} likes in all.`);
      if ((st.top ?? []).length) {
        out.push('  TOP replies (real ones that worked: match their spirit, never copy their words):');
        for (const t of st.top) out.push(`    likes ${t.likes}, replies ${t.replies}: "${brief(t.text, 200)}" (to @${t.to ?? '?'})`);
      }
    }
  }
  done(out.join('\n'));
}

if (cmd === 'new') cmdNew();
else if (cmd === 'approve') cmdApprove();
else if (cmd === 'cancel') cmdCancel();
else if (cmd === 'status') cmdStatus();
else done('Usage: node scripts/comments-drafts.mjs new|approve|cancel|status ... (see the top of this file)', 2);
