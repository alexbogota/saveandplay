// Once a day (workflow "Send comments", by its schedule): how our replies under other people's posts do. Likes and replies from people
// are the measure of quality, so the drafts can learn from the replies that worked.
// Reads the public feed of each Bluesky account that has comments (no login needed), and writes drafts/comments-stats-<block>-<stamp>.json
// (the workflow saves it on the "comments" branch) and the Summary of the run, in Russian.
// The chat shows the numbers and the best replies with: node scripts/comments-drafts.mjs status
//
//   node scripts/comments-stats.mjs                 every enabled Bluesky account (one per handle; the wide blocks share it)
//   node scripts/comments-stats.mjs --account prices --days 14
//
// All our replies count, sent by hand or by the program. Only replies older than 24 hours count in the share "with a like": a fresh reply had no time yet.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { commentAccounts, file } from './lib/comments.mjs';
import { publicCall, stampOf, brief, loadSent, replyUrl } from './lib/comments-send.mjs';

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const days = Number(arg('--days') ?? 14);
const only = arg('--account');
const now = Date.now();
const stamp = stampOf(now);
const lc = (s) => String(s ?? '').toLowerCase();

// Our replies of the last `days` days (not our own posts, not reposts), newest first, up to `maxPages` pages of 100.
async function ourReplies(handle, maxPages = 6) {
  const since = now - days * 864e5;
  const out = [];
  let cursor;
  for (let i = 0; i < maxPages; i++) {
    const j = await publicCall('app.bsky.feed.getAuthorFeed', { actor: handle, filter: 'posts_with_replies', limit: 100, cursor });
    const feed = j?.feed ?? [];
    let older = false;
    for (const it of feed) {
      const p = it?.post;
      if (!p || it.reason || lc(p.author?.handle) !== lc(handle) || !p.record?.reply) continue;
      const at = Date.parse(p.record.createdAt ?? p.indexedAt ?? '');
      if (!Number.isFinite(at)) continue;
      if (at < since) { older = true; continue; }
      out.push({ uri: p.uri, url: replyUrl(handle, p.uri), text: String(p.record.text ?? ''), at: new Date(at).toISOString(), likes: p.likeCount ?? 0, replies: p.replyCount ?? 0, reposts: (p.repostCount ?? 0) + (p.quoteCount ?? 0), to: it.reply?.parent?.author?.handle ?? null });
    }
    cursor = j?.cursor;
    if (!cursor || !feed.length || older) break;
  }
  return out;
}

async function main() {
  const accounts = commentAccounts(only).filter(({ account }) => account.enabled !== false && (only || !account.onDemand) && (account.platform ?? 'bluesky') === 'bluesky');
  const seen = new Set();
  const viaProgram = new Set(loadSent().filter((e) => e.status === 'sent' && e.replyUri).map((e) => e.replyUri));
  const written = [];
  const summary = ['## Наши ответы под чужими постами', ''];
  let code = 0;
  for (const { id, account } of accounts) {
    if (seen.has(lc(account.handle))) continue;
    seen.add(lc(account.handle));
    let replies;
    try { replies = await ourReplies(account.handle); } catch (e) {
      console.log(`PROBLEM (@${account.handle}): could not read the public feed: ${e.message}`);
      summary.push(`**@${account.handle}: не удалось прочитать ленту (${e.message}).**`, '');
      code = 1;
      continue;
    }
    const mature = replies.filter((r) => now - Date.parse(r.at) >= 864e5);
    const m = {
      count: mature.length,
      withLike: mature.filter((r) => r.likes > 0).length,
      withReply: mature.filter((r) => r.replies > 0).length,
      likes: mature.reduce((a, r) => a + r.likes, 0),
      replies: mature.reduce((a, r) => a + r.replies, 0),
      byProgram: mature.filter((r) => viaProgram.has(r.uri)).length,
    };
    const top = [...mature].map((r) => ({ ...r, score: r.likes + 2 * r.replies + r.reposts })).filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || Date.parse(b.at) - Date.parse(a.at)).slice(0, 5)
      .map(({ score, ...r }) => r);
    const name = `comments-stats-${id}-${stamp}.json`;
    mkdirSync(file('drafts'), { recursive: true });
    writeFileSync(file('drafts', name), JSON.stringify({ block: id, handle: account.handle, madeAt: new Date(now).toISOString(), days, total: replies.length, mature: m, top }, null, 2));
    written.push(`drafts/${name}`);
    const pct = m.count ? Math.round((100 * m.withLike) / m.count) : 0;
    console.log(`@${account.handle}: ${replies.length} replies in ${days} days; older than 24 h: ${m.count}, with a like ${m.withLike} (${pct}%), with a reply ${m.withReply}. Saved drafts/${name}.`);
    summary.push(`### @${account.handle}`, '', `За ${days} дн.: ${replies.length} ответов. Из тех, что старше суток (${m.count}): с лайком ${m.withLike} (${pct}%), с ответом человека ${m.withReply}, всего лайков ${m.likes}${m.byProgram ? `, отправлено программой ${m.byProgram}` : ''}.`, '');
    if (top.length) {
      summary.push('Лучшие ответы:', '');
      for (const t of top) summary.push(`- ❤ ${t.likes} · ↩ ${t.replies}: [${brief(t.text, 140)}](${t.url})${t.to ? ` (для @${t.to})` : ''}`);
      summary.push('');
    }
  }
  if (written.length) writeFileSync(file('drafts', '.comments-new-files'), written.join('\n') + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
  return code;
}

process.exitCode = await main();
setTimeout(() => process.exit(process.exitCode), 3000).unref();
