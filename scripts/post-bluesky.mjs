// Posts the ready posts of the daily brief to Bluesky after the owner's "ок" in the chat. See scripts/lib/bsky-posts.mjs and docs/decisions.md (21 Oct 2026).
//
// The chat steps (the shell forgets everything between commands; the chat first runs `bash scripts/comments-branch.sh load`):
//   node scripts/post-bluesky.mjs show                       today's posts of every account that is posted by the program: numbered, with the checks
//   node scripts/post-bluesky.mjs approve --ok all           the owner said "ок": every post without a problem (or --ok 1,3, --skip 2)
//        writes drafts/posts-approved-<stamp>.json and prints the ONE command that saves it on the branch and starts the workflow "Post to Bluesky"
//   node scripts/post-bluesky.mjs cancel [--all]             the owner said "стоп": approved posts that were not posted yet are never posted
// The sender (GitHub, workflow "Post to Bluesky", started by the chat right after the owner's "ок"):
//   node scripts/post-bluesky.mjs send [--dry-run]           posts what is approved and waiting; --dry-run checks everything and posts nothing
//
// It posts ONLY the approved text, as the app does (the link shortened to 25 characters, the full address in a facet, #tags as facets, a link card
// with the title, description and picture of OUR page of the game), and checks each post again right before it goes: the approval is young, the text
// rules, the deal is still listed at that price and the sale is not over, our page answers 200, nothing like it was posted in the last 36 hours
// (the feed of the account itself is asked, so a post made by hand counts), no "стоп". A failure is shown in the Summary of the run (in Russian).
// Exit code: 0 fine, 1 a problem (nothing was sent for that account).

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { file, loadPassword } from './lib/comments.mjs';
import { createPoster, stampOf, uniqueName, brief } from './lib/comments-send.mjs';
import {
  publishAccounts, publishProblems, readBriefPost, parseBriefPost, postProblems, shortenForPost, facetsOf, loadCard, gapMs, dayKey, itemKey,
  loadApproved, loadCancels, loadSent, pendingPosts, FINAL, isCancelled, sleep, lc,
} from './lib/bsky-posts.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? null : null; };
const dryRun = args.includes('--dry-run') || process.env.DRY_RUN === 'true';
const only = arg('--account');
const now = Date.now();
const done = (text, code = 0) => { console.log(text); process.exit(code); };

const readDeals = () => { try { const d = JSON.parse(readFileSync(file('data', 'deals.json'), 'utf8')); return Array.isArray(d) ? d : d.deals ?? []; } catch { return []; } };

// "1,3,5-7" -> [1, 3, 5, 6, 7]
function numbers(s) {
  const out = [];
  for (const tok of String(s ?? '').split(/[,\s]+/).filter(Boolean)) {
    const m = tok.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) done(`PROBLEM: "${tok}" is not a number or a range like 5-7.`, 1);
    for (let n = Math.min(+m[1], +(m[2] ?? m[1])); n <= Math.max(+m[1], +(m[2] ?? m[1])); n++) out.push(n);
  }
  return out;
}

// ---- the posts of today, numbered (the chat: show and approve) -------------------------------------------------------------------
function todaysPosts() {
  const deals = readDeals();
  const sent = loadSent();
  const pending = pendingPosts({ approved: loadApproved(), sent, cancels: loadCancels() }).filter((p) => !p.cancelled);
  const list = [];
  let n = 0;
  for (const acc of publishAccounts(only)) {
    if (!acc.settings.enabled) continue;
    const bad = publishProblems(acc);
    if (bad.length) { list.push({ acc, problems: [`settings: ${bad.join('; ')}`], n: ++n }); continue; }
    let raw;
    try { raw = readBriefPost(acc.id); } catch (e) { done(`PROBLEM: ${e.message}.`, 1); }
    if (raw == null) { list.push({ acc, noPost: 'no post file of the brief for this account', n: ++n }); continue; }
    const post = parseBriefPost(raw);
    if (post.noPost) { list.push({ acc, noPost: post.noPost, n: ++n }); continue; }
    const problems = postProblems(post, { acc, deals, now });
    const key = post.day && post.path ? itemKey(acc.id, post.day, post.path) : null;
    const was = key ? sent.find((e) => e.key === key && FINAL.has(e.status)) : null;
    if (was) problems.push(was.status === 'sent' ? `already posted (${was.postUrl ?? 'see the sent report'})` : `already handled by the sender: ${was.reason}`);
    else if (key && pending.some((p) => p.key === key)) problems.push('already approved and waiting for the sender');
    list.push({ acc, post, key, problems, n: ++n });
  }
  return list;
}

function cmdShow() {
  const list = todaysPosts();
  if (!list.length) done('NO ACCOUNT is posted by the program yet (publish.enabled in data/accounts.json, channel bluesky).');
  for (const it of list) {
    console.log(`\n## ${it.n}. ${it.acc.id} (@${it.acc.handle})`);
    if (it.noPost) { console.log(`   NO POST TODAY: ${it.noPost}`); continue; }
    console.log(it.post.text.split('\n').map((l) => `   | ${l}`).join('\n'));
    console.log(`   link: ${it.post.link}`);
    console.log(it.problems.length ? `   PROBLEMS (cannot be approved): ${it.problems.join('; ')}` : '   OK: can be approved. Our page and the feed are checked again by the sender.');
  }
  console.log('\nShow the owner these posts EXACTLY as printed (the program posts only these texts). Approve: node scripts/post-bluesky.mjs approve --ok all');
}

function cmdApprove() {
  const list = todaysPosts();
  const ok = arg('--ok');
  if (!ok) done('Usage: node scripts/post-bluesky.mjs approve --ok all|1,3 [--skip 2]', 1);
  const chosen = ok === 'all' ? new Set(list.map((l) => l.n)) : new Set(numbers(ok));
  for (const n of numbers(arg('--skip') ?? '')) chosen.delete(n);
  const items = [];
  const refused = [];
  for (const it of list) {
    if (!chosen.has(it.n)) continue;
    if (it.noPost || it.problems.length) { refused.push(`${it.n}. ${it.acc.id}: ${it.noPost ?? it.problems.join('; ')}`); continue; }
    items.push({ n: it.n, account: it.acc.id, handle: it.acc.handle, text: it.post.text, link: it.post.link, day: it.post.day, key: it.key });
  }
  for (const n of chosen) if (!list.some((l) => l.n === n)) refused.push(`${n}: no such post`);
  if (!items.length) done(`NOTHING APPROVED.${refused.length ? `\nNot approved: ${refused.join(' | ')}` : ''}`, 1);
  mkdirSync(file('drafts'), { recursive: true });
  const name = uniqueName(`posts-approved-${stampOf(now)}`);
  writeFileSync(file('drafts', name), JSON.stringify({ approvedAt: new Date(now).toISOString(), items }, null, 2));
  console.log(`APPROVED ${items.length}: ${items.map((i) => `${i.n} (${i.account})`).join(', ')}. Saved as drafts/${name}.`);
  if (refused.length) console.log(`Not approved: ${refused.join(' | ')}`);
  console.log(`\nNEXT, ONE command: bash scripts/comments-branch.sh save drafts/${name} && gh workflow run "Post to Bluesky" -R alexbogota/saveandplay --ref main`);
  console.log('Then tell the owner (in Russian, short): how many posts go, that the result (with links) is in the Summary of the run (Actions, Post to Bluesky), and that he can say "стоп".');
}

function cmdCancel() {
  const pending = pendingPosts({ approved: loadApproved(), sent: loadSent(), cancels: loadCancels() }).filter((p) => !p.cancelled);
  if (!pending.length) done('Nothing is waiting: no approved post is left to cancel.');
  const handles = [...new Set(pending.map((p) => p.handle))];
  mkdirSync(file('drafts'), { recursive: true });
  const names = [];
  for (const h of handles) {
    const name = uniqueName(`posts-cancel-${stampOf(now)}`);
    writeFileSync(file('drafts', name), JSON.stringify({ handle: h, at: new Date(now).toISOString(), all: true }, null, 2));
    names.push(`drafts/${name}`);
  }
  console.log(`CANCELLED ${pending.length} approved post(s) not posted yet.\nNEXT, ONE command: bash scripts/comments-branch.sh save ${names.join(' ')}`);
}

// ---- the sender -------------------------------------------------------------------------------------------------------------------
const isPrivate = process.env.REPO_PRIVATE !== 'false';
const stamp = stampOf(now);
const sentName = `posts-sent-${stamp}.json`;
const entries = [];
const summary = [];
const RU = {
  'cancelled by the owner': 'остановлен вашим «стоп»',
  'the sender is off for this account': 'для этого аккаунта публикация выключена',
  'dry run: everything is fine, nothing was posted': 'проверка: всё в порядке, ничего не опубликовано',
};
const ru = (r) => RU[r]
  ?? r.replace(/^approval older than (\d+) h$/, 'одобрение старше $1 ч')
    .replace(/^already posted: (.*)$/, 'уже опубликовано ($1)')
    .replace(/^text: /, 'проверка не прошла: ')
    .replace(/^our page: /, 'наша страница: ')
    .replace(/^Bluesky asked to slow down \(429\): the next run tries again$/, 'Bluesky попросил притормозить (429), следующий запуск попробует снова')
    .replace(/^the login stopped working: the next run tries again$/, 'вход перестал работать, следующий запуск попробует снова')
    .replace(/^network or server problem \((.*)\): .*$/, 'сбой сети или сервера ($1), следующий запуск сначала проверит ленту, потом попробует снова')
    .replace(/^Bluesky refused it: /, 'Bluesky не принял пост: ');

function save() {
  if (dryRun || !entries.length) return;
  mkdirSync(file('drafts'), { recursive: true });
  writeFileSync(file('drafts', sentName), JSON.stringify({ madeAt: new Date(now).toISOString(), run: process.env.GITHUB_RUN_ID ?? null, private: isPrivate, entries }, null, 2));
  writeFileSync(file('drafts', '.comments-new-files'), `drafts/${sentName}\n`);
}

function stoppedNow(it) {
  if (process.env.COMMENTS_CANCEL_FROM_GIT !== '1') return false;
  const git = (...a) => spawnSync('git', a, { encoding: 'utf8', timeout: 30000 });
  if (git('fetch', '--quiet', 'origin', process.env.COMMENTS_BRANCH || 'comments').status !== 0) return false;
  const names = (git('ls-tree', '--name-only', 'FETCH_HEAD').stdout ?? '').split('\n').filter((n) => n.startsWith('posts-cancel-') && n.endsWith('.json'));
  const cancels = [];
  for (const n of names) { try { cancels.push(JSON.parse(git('show', `FETCH_HEAD:${n}`).stdout)); } catch { /* a broken file is ignored */ } }
  return isCancelled(cancels, it.handle, it.key, it.approvedAt);
}

async function sendFor(handle, items, sent) {
  const say = (l) => console.log(l);
  const accOf = (id) => publishAccounts(id)[0] ?? null;
  const first = accOf(items[0].account);
  const mark = (it, status, reason, extra = {}) => {
    entries.push({ key: it.key, account: it.account, handle, n: it.n, link: it.link, text: it.text, approvedFile: it.approvedFile, approvedAt: it.approvedAt, status, reason, at: new Date().toISOString(), ...extra });
    save();
    say(`  ${it.n}. ${it.account}: ${status}${status === 'sent' ? ` ${extra.postUrl}` : ` (${reason})`}`);
  };
  if (!first || !first.settings.enabled) { for (const it of items) mark(it, 'skipped', 'the sender is off for this account'); return 0; }
  const bad = publishProblems(first);
  if (bad.length) { say(`PROBLEM: data/accounts.json, "${first.id}" bluesky publish: ${bad.join('; ')}. Nothing was posted for @${handle}.`); return 1; }
  const pw = first.settings.passwordEnv;
  const password = loadPassword(pw);
  if (!password) { say(`PROBLEM: no secret ${pw} (the app password of @${first.handle}). Nothing was posted for @${handle}.`); summary.push(`**@${handle}: ничего не опубликовано, нет секрета ${pw}.**`); return 1; }
  const poster = createPoster();
  let me;
  try { me = await poster.login(first.handle, password); } catch (e) {
    say(`PROBLEM: login as @${first.handle} failed: ${String(e.message).replaceAll(password, '[hidden]')}. Check the app password in the secret ${pw}. Nothing was posted.`);
    summary.push(`**@${handle}: вход не удался, ничего не опубликовано.** Проверьте пароль приложения в секрете ${pw}.`);
    return 1;
  }
  if (me.handle !== lc(first.handle)) { say(`PROBLEM: the login is @${me.handle}, not @${first.handle}: nothing was posted (a wrong password in ${pw}?).`); summary.push(`**Вход под чужим аккаунтом (@${me.handle}), ничего не опубликовано.**`); return 1; }

  const deals = readDeals();
  let feed = null;
  try { feed = await poster.recentPosts(Math.max(...items.map((it) => accOf(it.account)?.settings.duplicateHours ?? 36))); } catch (e) {
    say(`Note: could not read our own recent posts (${e.message}); only the program's own records protect against a double post.`);
  }
  let lastAt = 0;
  for (const it of items) {
    const acc = accOf(it.account) ?? first;
    const s = acc.settings;
    const t = Date.now();
    if (it.cancelled) { mark(it, 'skipped', 'cancelled by the owner'); continue; }
    if (t - Date.parse(it.approvedAt) > s.maxApprovalAgeHours * 36e5) { mark(it, 'skipped', `approval older than ${s.maxApprovalAgeHours} h`); continue; }
    const post = parseBriefPost(it.text);
    const problems = postProblems(post, { acc, deals, now: t });
    if (problems.length) { mark(it, 'skipped', `text: ${problems.join('; ')}`); continue; }
    const path = post.path;
    const early = [...sent, ...entries].find((e) => e.status === 'sent' && lc(e.handle) === lc(handle) && e.key !== it.key && String(e.link ?? '').includes(path) && t - Date.parse(e.at) < s.duplicateHours * 36e5);
    const fromFeed = (feed ?? []).find((f) => f.links.some((l) => l.includes(path)) && t - Date.parse(f.at) < s.duplicateHours * 36e5);
    if (early || fromFeed) { mark(it, 'skipped', `already posted: ${(early?.postUrl ?? fromFeed?.uri ?? '').toString()}`); continue; }
    const card = await loadCard(post.link);
    if (!card.ok) { mark(it, 'failed', `our page: ${card.reason}; the next run tries again`); continue; }
    if (dryRun) { mark(it, 'checked', 'dry run: everything is fine, nothing was posted'); continue; }
    const wait = lastAt ? Math.max(0, lastAt + gapMs(s) - Date.now()) : 0;
    if (wait) { say(`  pause ${Math.round(wait / 1000)} s`); await sleep(wait); }
    if (stoppedNow(it)) { mark(it, 'skipped', 'cancelled by the owner'); continue; }
    try {
      const finalText = shortenForPost(post.text, post.link);
      let thumb;
      if (card.image) { try { thumb = await poster.uploadBlob(card.image.bytes, card.image.mime); } catch { thumb = undefined; /* a card without a picture is still a card */ } }
      const r = await poster.createPost({
        text: finalText, facets: facetsOf(finalText, post.link), langs: ['en'],
        card: { uri: post.link, title: card.title, description: brief(card.description, 280), ...(thumb ? { thumb } : {}) },
      });
      lastAt = Date.now();
      mark(it, 'sent', 'sent', { postUri: r?.uri ?? null, postUrl: r?.uri ? `https://bsky.app/profile/${first.handle}/post/${r.uri.split('/').pop()}` : null, picture: !!thumb });
    } catch (e) {
      if (e.code === 'rate') { mark(it, 'failed', 'Bluesky asked to slow down (429): the next run tries again'); return 1; }
      if (e.code === 'auth') { mark(it, 'failed', 'the login stopped working: the next run tries again'); return 1; }
      if (e.code === 'network' || /^http-5/.test(String(e.code))) { mark(it, 'failed', `network or server problem (${e.message}): the next run checks the feed first, then tries again`); continue; }
      mark(it, 'skipped', `Bluesky refused it: ${e.message}`);
    }
  }
  return 0;
}

function writeSummary() {
  const out = [`## Публикация постов в Bluesky${dryRun ? ' (проверка, ничего не опубликовано)' : ''}`, ''];
  if (!entries.length && !summary.length) out.push('Ничего не ждёт публикации: одобренных и ещё не опубликованных постов нет.');
  for (const h of [...new Set(entries.map((e) => e.handle))]) {
    const es = entries.filter((e) => e.handle === h);
    const n = (st) => es.filter((e) => e.status === st).length;
    out.push(`### @${h}`, '', `${dryRun ? `Проверено ${n('checked')}` : `Опубликовано ${n('sent')}`}, пропущено ${n('skipped')}${n('failed') ? `, ждут следующего запуска ${n('failed')}` : ''}.`, '');
    out.push('| № | Аккаунт | Итог | Текст |', '|---|---|---|---|');
    for (const e of es) {
      const result = e.status === 'sent' ? `✅ [опубликован](${e.postUrl})${e.picture ? '' : ' (без картинки в карточке)'}` : e.status === 'checked' ? '🔎 можно публиковать' : e.status === 'skipped' ? `⏭ ${ru(e.reason)}` : `⏳ ${ru(e.reason)}`;
      out.push(`| ${e.n} | ${e.account} | ${result} | ${brief(e.text.split('\n')[0], 90).replace(/\|/g, '/')} |`);
    }
    out.push('');
  }
  out.push(...summary);
  const text = out.join('\n') + '\n';
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  return text;
}

async function cmdSend() {
  const sent = loadSent();
  let pending = pendingPosts({ approved: loadApproved(), sent, cancels: loadCancels() });
  if (only) pending = pending.filter((p) => p.account === only);
  console.log(`Post to Bluesky${dryRun ? ' (DRY RUN: nothing is posted)' : ''}: ${pending.length} approved post(s) waiting.`);
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
  console.log(dryRun ? `Checked ${entries.length}, nothing posted.` : `Posted ${n}. ${entries.length ? `Written to drafts/${sentName}.` : 'Nothing to write.'}`);
  return code;
}

if (cmd === 'show') cmdShow();
else if (cmd === 'approve') cmdApprove();
else if (cmd === 'cancel') cmdCancel();
else if (cmd === 'send') {
  process.exitCode = await cmdSend();
  setTimeout(() => process.exit(process.exitCode), 3000).unref();
} else done('Usage: node scripts/post-bluesky.mjs show | approve --ok all|1,3 | cancel | send [--dry-run]', 1);
