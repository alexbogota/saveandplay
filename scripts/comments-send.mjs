// Sends the replies the owner approved in the chat (drafts/comments-approved-*.json, from the "comments" branch), one by one, with pauses.
// It runs on GitHub (workflow "Send comments"), started by the chat right after the owner's "ок". It never writes a reply itself:
// it sends ONLY approved texts, exactly as approved, and checks each one again right before it goes:
//   the text rules of the account (length, no links, no names of other sites, no invented prices, not a repeat), a fresh approval, no "стоп",
//   the post still exists and is not too old, its replies are open, nobody blocks anybody, we have not answered it yet (by hand or by an earlier run),
//   one reply per person per day, and the daily limit of the account.
// Pauses between two replies: send.gapSeconds while the repository is public (free GitHub minutes), send.gapSecondsPrivate when it is private.
// What happened is written to drafts/comments-sent-<stamp>.json after every reply (the workflow saves it on the branch, even when the run is stopped)
// and to the Summary of the run, in Russian.
//
//   node scripts/comments-send.mjs              send what is waiting (every account)
//   node scripts/comments-send.mjs --dry-run    check everything, post nothing, save nothing (also DRY_RUN=true)
//   node scripts/comments-send.mjs --account prices
//
// Secrets: send.passwordEnv of the account (BSKY_APP_PASSWORD for the main one). Exit code 1 when an account could not log in or a run had to stop.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { commentAccounts, file, loadPassword } from './lib/comments.mjs';
import {
  sendSettings, sendProblems, replyProblems, repoIsPrivate, gapMs, stampOf, brief, linkFacets, replyUrl, createPoster,
  loadApprovedFiles, loadCancelFiles, loadSent, pendingItems, sentWithin, earlierTexts, isCancelled,
} from './lib/comments-send.mjs';

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const dryRun = args.includes('--dry-run') || process.env.DRY_RUN === 'true';
const only = arg('--account');
const lc = (s) => String(s ?? '').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();
const stamp = stampOf(started);
const isPrivate = repoIsPrivate();
const sentName = `comments-sent-${stamp}.json`;
const entries = [];
const summary = [];

function save() {
  if (dryRun || !entries.length) return;
  mkdirSync(file('drafts'), { recursive: true });
  writeFileSync(file('drafts', sentName), JSON.stringify({ madeAt: new Date(started).toISOString(), run: process.env.GITHUB_RUN_ID ?? null, private: isPrivate, entries }, null, 2));
  writeFileSync(file('drafts', '.comments-new-files'), `drafts/${sentName}\n`);
}

const blockOf = (id) => { try { return commentAccounts(id)[0].account; } catch { return null; } };

// A "стоп" said while this run was going: the newest cancel files are read from the branch before every reply (only on GitHub, COMMENTS_CANCEL_FROM_GIT=1).
function stoppedNow(it) {
  if (process.env.COMMENTS_CANCEL_FROM_GIT !== '1') return false;
  const git = (...a) => spawnSync('git', a, { encoding: 'utf8', timeout: 30000 });
  if (git('fetch', '--quiet', 'origin', process.env.COMMENTS_BRANCH || 'comments').status !== 0) return false;
  const names = (git('ls-tree', '--name-only', 'FETCH_HEAD').stdout ?? '').split('\n').filter((n) => n.startsWith('comments-cancel-') && n.endsWith('.json'));
  const cancels = [];
  for (const n of names) { try { cancels.push(JSON.parse(git('show', `FETCH_HEAD:${n}`).stdout)); } catch { /* a broken file is ignored */ } }
  return isCancelled(cancels, it.handle, it.key, it.approvedAt);
}

const RU = {
  'cancelled by the owner': 'остановлен вашим «стоп»',
  'sending is off for this account': 'для этого аккаунта отправка выключена',
  'the post is deleted or hidden': 'пост удалён или скрыт',
  'the author closed replies': 'автор закрыл ответы',
  'the author blocks us (or we block them)': 'автор заблокировал нас (или мы его)',
  'we already answered this post': 'мы уже ответили на этот пост',
  'dry run: everything is fine, nothing was posted': 'проверка: всё в порядке, ничего не отправлено',
};
const ru = (reason) => RU[reason]
  ?? reason.replace(/^approval older than (\d+) h$/, 'одобрение старше $1 ч')
    .replace(/^daily limit \((\d+) in 24 h\)$/, 'дневной лимит ($1 за 24 ч)')
    .replace(/^the run limit \((\d+)\): waits for the next run$/, 'лимит одного запуска ($1), ждёт следующего')
    .replace(/^we replied to @(\S+) less than (\d+) h ago$/, 'этому человеку (@$1) уже отвечали меньше $2 ч назад')
    .replace(/^the post is older than (\d+) h$/, 'пост старше $1 ч')
    .replace(/^could not read the (post|thread) \((.*)\): the next run tries again$/, (m, what, why) => `не удалось прочитать ${what === 'post' ? 'пост' : 'ветку'} (${why}), следующий запуск попробует снова`)
    .replace(/^Bluesky asked to slow down \(429\): the next run tries again$/, 'Bluesky попросил притормозить (429), следующий запуск попробует снова')
    .replace(/^the login stopped working: the next run tries again$/, 'вход перестал работать, следующий запуск попробует снова')
    .replace(/^network or server problem \((.*)\): .*$/, 'сбой сети или сервера ($1), следующий запуск сначала проверит ветку, потом попробует снова')
    .replace(/^Bluesky refused it: /, 'Bluesky не принял ответ: ')
    .replace(/^text: /, 'текст не прошёл проверку: ');

async function sendFor(handle, items, sent) {
  const say = (l) => console.log(l);
  const first = blockOf(items[0].block);
  const mark = (it, status, reason, extra = {}) => {
    const e = { block: it.block, handle, n: it.n, uri: it.uri, url: it.url, author: it.author, text: it.text, approvedFile: it.approvedFile, approvedAt: it.approvedAt, status, reason, at: new Date().toISOString(), ...extra };
    entries.push(e);
    save();
    say(`  ${it.n}. @${it.author}: ${status}${status === 'sent' ? ` ${extra.replyUrl}` : ` (${reason})`}`);
    return e;
  };
  const s0 = first ? sendSettings(first) : null;
  if (!first || !s0.enabled) { for (const it of items) mark(it, 'skipped', 'sending is off for this account'); return 0; }
  const problems = sendProblems(first);
  if (problems.length) { say(`PROBLEM: data/comments-accounts.json, "${items[0].block}" send: ${problems.join('; ')}. Nothing was sent for @${handle}.`); return 1; }
  const password = loadPassword(s0.passwordEnv);
  if (!password) { say(`PROBLEM: no secret ${s0.passwordEnv} (the app password of @${first.handle}). Nothing was sent for @${handle}.`); summary.push(`**@${handle}: ничего не отправлено, нет секрета ${s0.passwordEnv}.**`); return 1; }
  const poster = createPoster();
  let me;
  try { me = await poster.login(first.handle, password); } catch (e) {
    say(`PROBLEM: login as @${first.handle} failed: ${String(e.message).replaceAll(password, '[hidden]')}. Check the app password in the secret ${s0.passwordEnv}. Nothing was sent.`);
    summary.push(`**@${handle}: вход не удался, ничего не отправлено.** Проверьте пароль приложения в секрете ${s0.passwordEnv}.`);
    return 1;
  }
  if (me.handle !== lc(first.handle)) { say(`PROBLEM: the login is @${me.handle}, not @${first.handle}: nothing was sent (a wrong password in ${s0.passwordEnv}?).`); summary.push(`**Вход под чужим аккаунтом (@${me.handle}), ничего не отправлено.**`); return 1; }

  // Our real replies of the last day from Bluesky itself, so the limits also count the replies the owner sent by hand.
  let feed = null;
  try { feed = await poster.recentReplies(Math.max(24, ...items.map((it) => sendSettings(blockOf(it.block) ?? first).perAuthorHours))); } catch (e) {
    say(`Note: could not read our own recent replies (${e.message}), so the limits count only the replies sent by the program.`);
  }
  let lastSentAt = 0;
  let sentNow = 0;
  // In a dry run the replies that passed count as if they went, so the check shows what a real run would do.
  const checked = () => entries.filter((e) => e.status === 'checked' && e.handle === handle);
  const repliesIn = (all, hours, t) => checked().length + Math.max(sentWithin(all, handle, hours, t).length, feed ? feed.filter((r) => t - Date.parse(r.at) < hours * 36e5).length + sentNow : 0);
  const answered = (all, author, hours, t) => sentWithin(all, handle, hours, t).some((e) => lc(e.author) === lc(author)) || (feed ?? []).some((r) => r.to === lc(author) && t - Date.parse(r.at) < hours * 36e5) || checked().some((e) => lc(e.author) === lc(author));
  for (const it of items) {
    const block = blockOf(it.block) ?? first;
    const s = sendSettings(block);
    const all = [...sent, ...entries];
    const t = Date.now();
    if (it.cancelled) { mark(it, 'skipped', 'cancelled by the owner'); continue; }
    if (!s.enabled) { mark(it, 'skipped', 'sending is off for this account'); continue; }
    if (t - Date.parse(it.approvedAt) > s.maxApprovalAgeHours * 36e5) { mark(it, 'skipped', `approval older than ${s.maxApprovalAgeHours} h`); continue; }
    if (repliesIn(all, 24, t) >= s.dailyLimit) { mark(it, 'skipped', `daily limit (${s.dailyLimit} in 24 h)`); continue; }
    if (sentNow + checked().length >= s.maxPerRun) { mark(it, 'waiting', `the run limit (${s.maxPerRun}): waits for the next run`); continue; }
    if (s.perAuthorHours > 0 && answered(all, it.author, s.perAuthorHours, t)) { mark(it, 'skipped', `we replied to @${it.author} less than ${s.perAuthorHours} h ago`); continue; }
    let post;
    try { post = await poster.post(it.uri); } catch (e) { mark(it, 'failed', `could not read the post (${e.message}): the next run tries again`); continue; }
    if (!post) { mark(it, 'skipped', 'the post is deleted or hidden'); continue; }
    const context = [it.context, post.record?.text].filter(Boolean).join('\n');
    const tp = replyProblems(it.text, { s, context, earlier: earlierTexts({ approved: [], sent: all, handle, now: t, exceptKeys: new Set([it.key]) }) });
    if (tp.length) { mark(it, 'skipped', `text: ${tp.join('; ')}`); continue; }
    const created = Date.parse(post.record?.createdAt ?? post.indexedAt ?? '');
    if (Number.isFinite(created) && t - created > s.maxPostAgeHours * 36e5) { mark(it, 'skipped', `the post is older than ${s.maxPostAgeHours} h`); continue; }
    if (post.viewer?.replyDisabled) { mark(it, 'skipped', 'the author closed replies'); continue; }
    if (post.author?.viewer?.blockedBy || post.author?.viewer?.blocking) { mark(it, 'skipped', 'the author blocks us (or we block them)'); continue; }
    let thread;
    try { thread = await poster.repliedBy(it.uri, me.did); } catch (e) { mark(it, 'failed', `could not read the thread (${e.message}): the next run tries again`); continue; }
    if (!thread.ok) { mark(it, 'skipped', /blocked/i.test(thread.type) ? 'the author blocks us (or we block them)' : 'the post is deleted or hidden'); continue; }
    if (thread.replied) { mark(it, 'skipped', 'we already answered this post'); continue; }
    if (dryRun) { mark(it, 'checked', 'dry run: everything is fine, nothing was posted'); continue; }
    const wait = lastSentAt ? Math.max(0, lastSentAt + gapMs(s, isPrivate) - Date.now()) : 0;
    if (wait) { say(`  pause ${Math.round(wait / 1000)} s`); await sleep(wait); }
    if (stoppedNow(it)) { mark(it, 'skipped', 'cancelled by the owner'); continue; }
    const root = post.record?.reply?.root?.uri && post.record?.reply?.root?.cid ? { uri: post.record.reply.root.uri, cid: post.record.reply.root.cid } : { uri: post.uri, cid: post.cid };
    try {
      const r = await poster.reply({ text: it.text, parent: { uri: post.uri, cid: post.cid }, root, langs: [block.language ?? 'en'], facets: s.allowLinks ? linkFacets(it.text) : [] });
      lastSentAt = Date.now();
      sentNow++;
      mark(it, 'sent', 'sent', { replyUri: r?.uri ?? null, replyUrl: r?.uri ? replyUrl(first.handle, r.uri) : null });
    } catch (e) {
      if (e.code === 'rate') { mark(it, 'failed', 'Bluesky asked to slow down (429): the next run tries again'); say('Stopping this account: Bluesky asked to slow down.'); return 1; }
      if (e.code === 'auth') { mark(it, 'failed', 'the login stopped working: the next run tries again'); return 1; }
      if (e.code === 'network' || /^http-5/.test(String(e.code))) { mark(it, 'failed', `network or server problem (${e.message}): the next run checks the thread first, then tries again`); continue; }
      mark(it, 'skipped', `Bluesky refused it: ${e.message}`);
    }
  }
  return 0;
}

function writeSummary() {
  const out = [`## Отправка ответов${dryRun ? ' (проверка, ничего не отправлено)' : ''}`, ''];
  if (!entries.length && !summary.length) out.push('Ничего не ждёт отправки: одобренных и ещё не отправленных ответов нет.');
  for (const h of [...new Set(entries.map((e) => e.handle))]) {
    const es = entries.filter((e) => e.handle === h);
    const n = (st) => es.filter((e) => e.status === st).length;
    const [a, b] = (() => { const blk = blockOf(es[0].block); const s = sendSettings(blk); return isPrivate ? s.gapSecondsPrivate : s.gapSeconds; })();
    out.push(`### @${h}`, '', `${dryRun ? `Проверено ${n('checked')}` : `Отправлено ${n('sent')}`}, пропущено ${n('skipped')}${n('failed') + n('waiting') ? `, ждут следующего запуска ${n('failed') + n('waiting')}` : ''}. Паузы между ответами ${a}–${b} с (репозиторий ${isPrivate ? 'закрытый: минуты GitHub считаются' : 'открытый: минуты GitHub бесплатные'}).`, '');
    out.push('| № | Кому | Итог | Текст |', '|---|---|---|---|');
    for (const e of es) {
      const result = e.status === 'sent' ? `✅ [отправлен](${e.replyUrl})` : e.status === 'checked' ? '🔎 можно отправлять' : e.status === 'skipped' ? `⏭ ${ru(e.reason)}` : `⏳ ${ru(e.reason)}`;
      out.push(`| ${e.n} | [@${e.author}](${e.url}) | ${result} | ${brief(e.text, 120).replace(/\|/g, '/')} |`);
    }
    out.push('');
  }
  out.push(...summary);
  const text = out.join('\n') + '\n';
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  return text;
}

async function main() {
  const approved = loadApprovedFiles();
  const sent = loadSent();
  const cancels = loadCancelFiles();
  let pending = pendingItems({ approved, sent, cancels });
  if (only) pending = pending.filter((p) => p.block === only);
  console.log(`Send comments${dryRun ? ' (DRY RUN: nothing is posted)' : ''}: ${pending.length} approved repl${pending.length === 1 ? 'y' : 'ies'} waiting. Repository ${isPrivate ? 'private (short pauses)' : 'public (long pauses)'}.`);
  let code = 0;
  for (const handle of [...new Set(pending.map((p) => lc(p.handle)))]) {
    console.log(`@${handle}:`);
    try { code = Math.max(code, await sendFor(handle, pending.filter((p) => lc(p.handle) === handle), sent)); } catch (e) {
      console.log(`ERROR (@${handle}): ${e.message}`);
      code = 1;
    }
  }
  writeSummary();
  const n = entries.filter((e) => e.status === 'sent').length;
  console.log(dryRun ? `Checked ${entries.length}, nothing posted.` : `Sent ${n}. ${entries.length ? `Written to drafts/${sentName}.` : 'Nothing to write.'}`);
  return code;
}

process.exitCode = await main();
setTimeout(() => process.exit(process.exitCode), 3000).unref();
