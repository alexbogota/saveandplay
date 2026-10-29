// Posts the ready posts of the daily brief to Bluesky AND Mastodon (25 Oct 2026) after the owner's "ок" in the chat. See scripts/lib/bsky-posts.mjs and docs/decisions.md (21 Oct 2026).
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
  readSchedule, scheduleProblems, scheduleItems, isDue, parseArticlePost, articleProblems, articleKey, waitingArticles,
} from './lib/bsky-posts.mjs';
import { parsePosts, splitArticle } from './article-tools.mjs';
import { mastodonAccounts, mastodonSettingsProblems, createMastodon } from './lib/mastodon-posts.mjs';
import { coopSettings, coopSettingsProblems, coopPostFor, parseCoopPost, coopProblems, readCoopGames } from './lib/coop-posts.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? null : null; };
const dryRun = args.includes('--dry-run') || process.env.DRY_RUN === 'true';
const only = arg('--account');
const articleAccount = 'prices'; // the account whose Bluesky profile posts about the guides
const noArticle = args.includes('--no-article');
const RECENT_GUIDE_DAYS = 3; // a guide that is already on the site is still offered for its post this many days
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
async function todaysPosts() {
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
  // The post about a guide: the oldest draft of the daily writer that is not on the site yet (or the one named with --article <slug>).
  const main = publishAccounts(articleAccount).find((a) => a.settings.enabled);
  const mainMastodon = mastodonAccounts(articleAccount).find((a) => a.settings.enabled);
  const art = (main || mainMastodon) && !noArticle ? await waitingArticles({ parsePosts, splitArticle }) : null;
  if (main && !noArticle) {
    const { list: drafts, note } = art;
    const wanted = arg('--article');
    // A guide whose page is already open is offered again when its post never went out (the approval was older than the limit or the page
    // was not open yet) and the guide is not older than RECENT_GUIDE_DAYS. 28 Oct 2026: the Steam Wallet post was lost this way.
    const draftKey = (d) => { const p = parseArticlePost(d.text); return p.path ? articleKey(main.id, p.path) : null; };
    const missed = (d) => d.onSite && (now - Date.parse(String(d.name).slice(0, 10))) / 864e5 <= RECENT_GUIDE_DAYS && !sent.some((e) => e.key === draftKey(d) && e.status === 'sent');
    const draft = wanted ? drafts.find((d) => d.slug === wanted) : drafts.find((d) => !d.onSite) ?? drafts.find(missed);
    if (wanted && !draft) done(`PROBLEM: no draft of the guide "${wanted}" on the "articles" branch.`, 1);
    if (!draft) list.push({ acc: main, kind: 'article', noPost: note ?? 'no guide is waiting: the daily writer has no draft that is not on the site yet', n: ++n });
    else {
      const post = parseArticlePost(draft.text);
      const problems = post.noPost ? [post.noPost] : articleProblems(post, { acc: main });
      if (post.slug && post.slug !== draft.slug) problems.push(`the link goes to the guide "${post.slug}", not to "${draft.slug}"`);
      const key = post.path ? articleKey(main.id, post.path) : null;
      const was = key ? sent.find((e) => e.key === key && FINAL.has(e.status) && !(e.status === 'skipped' && /^approval older/.test(e.reason ?? ''))) : null; // an expired approval does not count as handled
      if (was) problems.push(was.status === 'sent' ? `already posted (${was.postUrl ?? 'see the sent report'})` : `already handled by the sender: ${was.reason}`);
      else if (key && pending.some((p) => p.key === key)) problems.push('already approved and waiting for the sender');
      list.push({ acc: main, kind: 'article', post, key, problems, title: draft.title, onSite: draft.onSite, n: ++n });
    }
  }
  // "Play together" posts (a game from data/coop-games.json, a link to /servers/<game>/): every account with coop.enabled (scripts/lib/coop-posts.mjs).
  const games = readCoopGames();
  const keys = [...sent.filter((e) => FINAL.has(e.status)).map((e) => e.key), ...pending.map((p) => p.key)];
  for (const acc of publishAccounts(only)) {
    const cs = coopSettings(acc);
    if (!acc.settings.enabled || !cs?.enabled) continue;
    const bad = coopSettingsProblems(cs);
    if (bad.length) { list.push({ acc, kind: 'coop', problems: [`settings: ${bad.join('; ')}`], n: ++n }); continue; }
    const made = coopPostFor(acc, { games, keys, now });
    if (made.noPost) { list.push({ acc, kind: 'coop', noPost: made.noPost, n: ++n }); continue; }
    const post = parseCoopPost(made.text);
    const problems = coopProblems(post, { acc, games, now });
    const was = sent.find((e) => e.key === made.key && FINAL.has(e.status));
    if (was) problems.push(was.status === 'sent' ? `already posted (${was.postUrl ?? 'see the sent report'})` : `already handled by the sender: ${was.reason}`);
    else if (pending.some((p) => p.key === made.key)) problems.push('already approved and waiting for the sender');
    list.push({ acc, kind: 'coop', post, key: made.key, problems, title: made.game, n: ++n });
  }
  // Mastodon (the same posts, the brief's post-<account>-mastodon.md and the "Mastodon" block of the guide's posts.md). Numbered after all Bluesky posts,
  // so the numbers of the Bluesky posts do not change when Mastodon is switched on.
  const dealEntry = (acc) => {
    const bad = mastodonSettingsProblems(acc);
    if (bad.length) return { acc, problems: [`settings: ${bad.join('; ')}`] };
    let raw;
    try { raw = readBriefPost(acc.id, 'mastodon'); } catch (e) { done(`PROBLEM: ${e.message}.`, 1); }
    if (raw == null) return { acc, noPost: 'no post file of the brief for this account' };
    const post = parseBriefPost(raw);
    if (post.noPost) return { acc, noPost: post.noPost };
    const problems = postProblems(post, { acc, deals, now });
    const key = post.day && post.path ? itemKey(`mastodon:${acc.id}`, post.day, post.path) : null;
    const was = key ? sent.find((e) => e.key === key && FINAL.has(e.status)) : null;
    if (was) problems.push(was.status === 'sent' ? `already posted (${was.postUrl ?? 'see the sent report'})` : `already handled by the sender: ${was.reason}`);
    else if (key && pending.some((p) => p.key === key)) problems.push('already approved and waiting for the sender');
    return { acc, post, key, problems };
  };
  for (const acc of mastodonAccounts(only)) {
    if (!acc.settings.enabled) continue;
    list.push({ ...dealEntry(acc), n: ++n });
  }
  if (mainMastodon && art) {
    const wanted = arg('--article');
    const draft = wanted ? art.list.find((d) => d.slug === wanted) : art.list.find((d) => !d.onSite);
    if (!draft) list.push({ acc: mainMastodon, kind: 'article', noPost: art.note ?? 'no guide is waiting: the daily writer has no draft that is not on the site yet', n: ++n });
    else {
      const post = parseArticlePost(draft.mastodon);
      const problems = post.noPost ? [post.noPost] : articleProblems(post, { acc: mainMastodon });
      if (!draft.mastodon) problems.push('the draft has no "Mastodon" block in posts.md');
      if (post.slug && post.slug !== draft.slug) problems.push(`the link goes to the guide "${post.slug}", not to "${draft.slug}"`);
      const key = post.path ? articleKey(`mastodon:${mainMastodon.id}`, post.path) : null;
      const was = key ? sent.find((e) => e.key === key && FINAL.has(e.status)) : null;
      if (was) problems.push(was.status === 'sent' ? `already posted (${was.postUrl ?? 'see the sent report'})` : `already handled by the sender: ${was.reason}`);
      else if (key && pending.some((p) => p.key === key)) problems.push('already approved and waiting for the sender');
      list.push({ acc: mainMastodon, kind: 'article', post, key, problems, title: draft.title, onSite: draft.onSite, n: ++n });
    }
  }
  return list;
}

async function cmdShow() {
  const list = await todaysPosts();
  if (!list.length) done('NO ACCOUNT is posted by the program yet (publish.enabled in data/accounts.json, channel bluesky).');
  for (const it of list) {
    const label = it.kind === 'article' ? `GUIDE POST${it.title ? `: ${it.title}` : ''}${it.onSite === false ? ' (the guide is not on the site yet: publish it first or right after the approval)' : ''} of `
      : it.kind === 'coop' ? `PLAY TOGETHER${it.title ? `: ${it.title}` : ''} (game server page, affiliate) of ` : '';
    console.log(`\n## ${it.n}. ${it.acc.platform === 'mastodon' ? 'MASTODON ' : ''}${label}${it.acc.id} (@${it.acc.handle || '?'})`);
    if (it.noPost) { console.log(`   NO POST TODAY: ${it.noPost}`); continue; }
    console.log(it.post.text.split('\n').map((l) => `   | ${l}`).join('\n'));
    console.log(`   link: ${it.post.link}`);
    console.log(it.problems.length ? `   PROBLEMS (cannot be approved): ${it.problems.join('; ')}` : '   OK: can be approved. Our page and the feed are checked again by the sender.');
  }
  console.log('\nShow the owner these posts EXACTLY as printed (the program posts only these texts). Approve: node scripts/post-bluesky.mjs approve --ok all');
}

async function cmdApprove() {
  const list = await todaysPosts();
  const ok = arg('--ok');
  if (!ok) done('Usage: node scripts/post-bluesky.mjs approve --ok all|1,3 [--skip 2] [--now]', 1);
  const chosen = ok === 'all' ? new Set(list.map((l) => l.n)) : new Set(numbers(ok));
  for (const n of numbers(arg('--skip') ?? '')) chosen.delete(n);
  const items = [];
  const refused = [];
  for (const it of list) {
    if (!chosen.has(it.n)) continue;
    if (it.noPost || it.problems.length) { refused.push(`${it.n}. ${it.acc.platform === 'mastodon' ? 'Mastodon ' : ''}${it.kind === 'article' ? 'guide post' : it.kind === 'coop' ? `play together (${it.acc.id})` : it.acc.id}: ${it.noPost ?? it.problems.join('; ')}`); continue; }
    items.push({ n: it.n, kind: it.kind ?? 'deal', platform: it.acc.platform ?? 'bluesky', account: it.acc.id, handle: it.acc.handle, text: it.post.text, link: it.post.link, day: it.post.day ?? null, key: it.key });
  }
  for (const n of chosen) if (!list.some((l) => l.n === n)) refused.push(`${n}: no such post`);
  if (!items.length) done(`NOTHING APPROVED.${refused.length ? `\nNot approved: ${refused.join(' | ')}` : ''}`, 1);
  const schedule = readSchedule();
  const bad = scheduleProblems(schedule);
  if (bad.length) done(`PROBLEM: data/post-schedule.json: ${bad.join('; ')}.`, 1);
  const timed = scheduleItems(items, { now, schedule, immediate: args.includes('--now') });
  mkdirSync(file('drafts'), { recursive: true });
  const name = uniqueName(`posts-approved-${stampOf(now)}`);
  writeFileSync(file('drafts', name), JSON.stringify({ approvedAt: new Date(now).toISOString(), items: timed }, null, 2));
  const what = (i, guide = 'guide post') => `${i.platform === 'mastodon' ? 'Mastodon ' : ''}${i.kind === 'article' ? guide : i.kind === 'coop' ? `play together, ${i.account}` : i.account}`;
  console.log(`APPROVED ${timed.length}: ${timed.map((i) => `${i.n} (${what(i, 'guide')})`).join(', ')}. Saved as drafts/${name}.`);
  const clock = (iso) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  console.log('Hours (Bogota time; the sender looks every hour, so a post goes out within about an hour after its time):');
  for (const i of timed) console.log(`  ${i.n}. ${what(i)} (@${i.handle}): ${Date.parse(i.notBefore) <= now + 60000 ? 'now' : `from ${clock(i.notBefore)}`}`);
  if (refused.length) console.log(`Not approved: ${refused.join(' | ')}`);
  console.log(`\nNEXT, ONE command: bash scripts/comments-branch.sh save drafts/${name} && gh workflow run "Post to Bluesky" -R alexbogota/saveandplay --ref main`);
  console.log('Then tell the owner (in Russian, short): which post goes at what hour (Bogota), that the result (with links) is in the Summary of the runs (Actions, Post to Bluesky), and that he can say "стоп". If a guide post is approved and the guide is not on the site yet, publish the guide now (/publish, "ок, статья дня"): its post waits until the page opens.');
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
const sentName = uniqueName(`posts-sent-${stamp}`); // a run in the same second as another one never replaces its report
const entries = [];
const summary = [];
const later = []; // approved posts whose hour has not come yet
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
    .replace(/^Bluesky refused it: /, 'Bluesky не принял пост: ')
    .replace(/^Mastodon asked to slow down \(429\): the next run tries again$/, 'Mastodon попросил притормозить (429), следующий запуск попробует снова')
    .replace(/^Mastodon refused it: /, 'Mastodon не принял пост: ');

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
  if (items[0].platform === 'mastodon') return sendMastodonFor(handle, items, sent);
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
    const post = it.kind === 'article' ? parseArticlePost(it.text) : it.kind === 'coop' ? parseCoopPost(it.text) : parseBriefPost(it.text);
    const problems = it.kind === 'article' ? articleProblems(post, { acc }) : it.kind === 'coop' ? coopProblems(post, { acc, now: t }) : postProblems(post, { acc, deals, now: t });
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

// ---- the sender for Mastodon (the same checks, the same hours; the client is scripts/lib/mastodon-posts.mjs) ---------------------------------------
async function sendMastodonFor(handle, items, sent) {
  const say = (l) => console.log(l);
  const accOf = (id) => mastodonAccounts(id)[0] ?? null;
  const first = accOf(items[0].account);
  const mark = (it, status, reason, extra = {}) => {
    entries.push({ key: it.key, account: it.account, platform: 'mastodon', handle, n: it.n, link: it.link, text: it.text, approvedFile: it.approvedFile, approvedAt: it.approvedAt, status, reason, at: new Date().toISOString(), ...extra });
    save();
    say(`  ${it.n}. Mastodon ${it.account}: ${status}${status === 'sent' ? ` ${extra.postUrl}` : ` (${reason})`}`);
  };
  if (!first || !first.settings.enabled) { for (const it of items) mark(it, 'skipped', 'the sender is off for this account'); return 0; }
  const bad = mastodonSettingsProblems(first);
  if (bad.length) { say(`PROBLEM: data/accounts.json, "${first.id}" mastodon publish: ${bad.join('; ')}. Nothing was posted for @${handle}.`); return 1; }
  const env = first.settings.tokenEnv;
  const token = process.env[env];
  if (!token) {
    say(`PROBLEM: no secret ${env} (the access token of @${handle}). Nothing was posted for @${handle}.`);
    summary.push(`**@${handle}: ничего не опубликовано, нет секрета ${env}.** Создайте токен в Mastodon и положите его в секрет GitHub (docs/posts-bluesky.md, раздел Mastodon).`);
    return 1;
  }
  const api = createMastodon({ instance: first.instance, token });
  let me;
  try { me = await api.login(); } catch (e) {
    say(`PROBLEM: login to ${first.instance} failed: ${e.message}. Check the token in the secret ${env} (scopes read:accounts and write:statuses). Nothing was posted.`);
    summary.push(`**@${handle}: вход не удался, ничего не опубликовано.** Проверьте токен в секрете ${env} (права read:accounts и write:statuses).`);
    return 1;
  }
  if (me.acct !== lc(first.acct)) { say(`PROBLEM: the token belongs to @${me.acct}, not @${first.acct}: nothing was posted (a wrong token in ${env}?).`); summary.push(`**Токен чужого аккаунта (@${me.acct}), ничего не опубликовано.** Проверьте секрет ${env}.`); return 1; }

  const deals = readDeals();
  let feed = null;
  try { feed = await api.recentPosts(Math.max(...items.map((it) => accOf(it.account)?.settings.duplicateHours ?? 36))); } catch (e) {
    say(`Note: could not read our own recent Mastodon posts (${e.message}); only the program's own records protect against a double post.`);
  }
  let lastAt = 0;
  for (const it of items) {
    const acc = accOf(it.account) ?? first;
    const st = acc.settings;
    const t = Date.now();
    if (it.cancelled) { mark(it, 'skipped', 'cancelled by the owner'); continue; }
    if (t - Date.parse(it.approvedAt) > st.maxApprovalAgeHours * 36e5) { mark(it, 'skipped', `approval older than ${st.maxApprovalAgeHours} h`); continue; }
    const post = it.kind === 'article' ? parseArticlePost(it.text) : parseBriefPost(it.text);
    const problems = it.kind === 'article' ? articleProblems(post, { acc }) : postProblems(post, { acc, deals, now: t });
    if (problems.length) { mark(it, 'skipped', `text: ${problems.join('; ')}`); continue; }
    const path = post.path;
    const early = [...sent, ...entries].find((e) => e.status === 'sent' && lc(e.handle) === lc(handle) && e.key !== it.key && String(e.link ?? '').includes(path) && t - Date.parse(e.at) < st.duplicateHours * 36e5);
    const fromFeed = (feed ?? []).find((f) => f.links.some((l) => l.includes(path)) && t - Date.parse(f.at) < st.duplicateHours * 36e5);
    if (early || fromFeed) { mark(it, 'skipped', `already posted: ${(early?.postUrl ?? fromFeed?.uri ?? '').toString()}`); continue; }
    const card = await loadCard(post.link);
    if (!card.ok) { mark(it, 'failed', `our page: ${card.reason}; the next run tries again`); continue; }
    if (dryRun) { mark(it, 'checked', 'dry run: everything is fine, nothing was posted'); continue; }
    const wait = lastAt ? Math.max(0, lastAt + gapMs(st) - Date.now()) : 0;
    if (wait) { say(`  pause ${Math.round(wait / 1000)} s`); await sleep(wait); }
    if (stoppedNow(it)) { mark(it, 'skipped', 'cancelled by the owner'); continue; }
    try {
      const r = await api.createStatus({ text: post.text, key: it.key });
      lastAt = Date.now();
      mark(it, 'sent', 'sent', { postUri: r.id, postUrl: r.url });
    } catch (e) {
      if (e.code === 'rate') { mark(it, 'failed', 'Mastodon asked to slow down (429): the next run tries again'); return 1; }
      if (e.code === 'auth') { mark(it, 'failed', 'the login stopped working: the next run tries again'); return 1; }
      if (e.code === 'network' || /^http-5/.test(String(e.code))) { mark(it, 'failed', `network or server problem (${e.message}): the next run checks the feed first, then tries again`); continue; }
      mark(it, 'skipped', `Mastodon refused it: ${e.message}`);
    }
  }
  return 0;
}

// The chat or the workflow (dry run): is the Mastodon token right? Logs in and says whose it is. Posts nothing.
async function cmdCheckMastodon() {
  const handles = new Map();
  for (const acc of mastodonAccounts(only)) if (acc.settings.enabled && !handles.has(acc.handle)) handles.set(acc.handle, acc);
  if (!handles.size) done('Mastodon is not switched on: no account has channels.mastodon.publish.enabled in data/accounts.json.', 1);
  let code = 0;
  const lines = ['## Проверка входа в Mastodon', ''];
  for (const [handle, acc] of handles) {
    const bad = mastodonSettingsProblems(acc);
    const token = process.env[acc.settings.tokenEnv ?? ''];
    let line;
    if (bad.length) line = `settings: ${bad.join('; ')}`;
    else if (!token) line = `no secret ${acc.settings.tokenEnv} (the access token is not set on GitHub)`;
    else {
      try { const me = await createMastodon({ instance: acc.instance, token }).login(); line = me.acct === lc(acc.acct) ? `OK: the token is of @${me.acct}@${acc.instance}` : `WRONG ACCOUNT: the token is of @${me.acct}, expected @${acc.acct}`; if (me.acct !== lc(acc.acct)) code = 1; }
      catch (e) { line = `LOGIN FAILED: ${e.message}`; }
    }
    if (!/^OK/.test(line)) code = 1;
    console.log(`@${handle}: ${line}`);
    lines.push(`- @${handle}: ${/^OK/.test(line) ? '✅ ' : '❌ '}${line}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  return code;
}

function writeSummary() {
  const out = [`## Публикация постов (Bluesky и Mastodon)${dryRun ? ' (проверка, ничего не опубликовано)' : ''}`, ''];
  if (!entries.length && !summary.length) out.push(later.length ? 'Сейчас публиковать нечего: у одобренных постов ещё не пришёл час.' : 'Ничего не ждёт публикации: одобренных и ещё не опубликованных постов нет.');
  for (const h of [...new Set(entries.map((e) => e.handle))]) {
    const es = entries.filter((e) => e.handle === h);
    const n = (st) => es.filter((e) => e.status === st).length;
    out.push(`### @${h}`, '', `${dryRun ? `Проверено ${n('checked')}` : `Опубликовано ${n('sent')}`}, пропущено ${n('skipped')}${n('failed') ? `, ждут следующего запуска ${n('failed')}` : ''}.`, '');
    out.push('| № | Аккаунт | Итог | Текст |', '|---|---|---|---|');
    for (const e of es) {
      const result = e.status === 'sent' ? `✅ [опубликован](${e.postUrl})${e.platform === 'mastodon' || e.picture ? '' : ' (без картинки в карточке)'}` : e.status === 'checked' ? '🔎 можно публиковать' : e.status === 'skipped' ? `⏭ ${ru(e.reason)}` : `⏳ ${ru(e.reason)}`;
      out.push(`| ${e.n} | ${e.account} | ${result} | ${brief(e.text.split('\n')[0], 90).replace(/\|/g, '/')} |`);
    }
    out.push('');
  }
  if (later.length) {
    const clock = (iso) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
    out.push('### Ждут своего часа', '', '| № | Аккаунт | Что | Не раньше (Богота) |', '|---|---|---|---|');
    for (const it of later) out.push(`| ${it.n} | ${it.account} | ${it.platform === 'mastodon' ? 'Mastodon: ' : ''}${it.kind === 'article' ? 'пост к статье' : it.kind === 'coop' ? 'играем вместе' : 'скидка'} | ${clock(it.notBefore)} |`);
    out.push('');
  }
  out.push(...summary);
  const text = out.join('\n') + '\n';
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  return text;
}

async function cmdSend() {
  const sent = loadSent();
  let waiting = pendingPosts({ approved: loadApproved(), sent, cancels: loadCancels() });
  if (only) waiting = waiting.filter((p) => p.account === only);
  // A post goes only when its hour has come (notBefore); a dry run checks them all.
  const pending = dryRun ? waiting : waiting.filter((p) => p.cancelled || isDue(p, now));
  later.push(...waiting.filter((p) => !pending.includes(p)));
  console.log(`Post to Bluesky${dryRun ? ' (DRY RUN: nothing is posted)' : ''}: ${pending.length} approved post(s) to look at now${later.length ? `, ${later.length} wait for their hour` : ''}.`);
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

if (cmd === 'show') await cmdShow();
else if (cmd === 'approve') await cmdApprove();
else if (cmd === 'cancel') cmdCancel();
else if (cmd === 'check-mastodon') { process.exitCode = await cmdCheckMastodon(); setTimeout(() => process.exit(process.exitCode), 1000).unref(); }
else if (cmd === 'send') {
  process.exitCode = await cmdSend();
  setTimeout(() => process.exit(process.exitCode), 3000).unref();
} else done('Usage: node scripts/post-bluesky.mjs show | approve --ok all|1,3 | cancel | send [--dry-run] | check-mastodon', 1);
