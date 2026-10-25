// Looks through the public RSS feeds of chosen subreddits and writes a SHORT list of fresh posts where a helpful answer from us would fit.
// Nothing is posted, voted or followed, and no Reddit account or password is used. Settings: data/reddit-accounts.json.
//
//   npm run reddit:find                      the "main" account
//   node scripts/reddit-find.mjs --account main
//   node scripts/reddit-find.mjs --again     also list posts that were already listed before
//
// Result: drafts/reddit-candidates-<account>.md. Then tell Claude in the chat: "reddit saveandplay".
// It reads only that file, picks the best posts and writes the answers. The owner pastes them by hand.
// Run it on the owner's own computer: Reddit often refuses requests from GitHub's servers.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const USER_AGENT = 'saveandplay-reader/1.0 (reads public RSS feeds; contact@saveandplay.com)';

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

// Reddit puts the post text into the feed as escaped HTML: decode, drop the tags, decode again.
export function plainText(raw) {
  let s = decode(raw ?? '');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decode(s);
  s = s.replace(/submitted by\s+\/?u\/\S+/gi, ' ').replace(/\[(link|comments)\]/gi, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

const pick = (xml, re) => (xml.match(re) ?? [])[1];

export function parseFeed(xml) {
  return String(xml).split('<entry>').slice(1).map((chunk) => {
    const entry = chunk.split('</entry>')[0];
    const link = pick(entry, /<link[^>]*href="([^"]+)"/);
    return {
      id: (link ?? '').match(/\/comments\/([a-z0-9]+)/i)?.[1] ?? link,
      title: plainText(pick(entry, /<title[^>]*>([\s\S]*?)<\/title>/)),
      link,
      subreddit: pick(entry, /<category[^>]*term="([^"]+)"/),
      author: pick(entry, /<author>\s*<name>\/?u?\/?([^<]+)<\/name>/),
      updated: pick(entry, /<updated>([^<]+)<\/updated>/),
      text: plainText(pick(entry, /<content[^>]*>([\s\S]*?)<\/content>/)),
    };
  }).filter((p) => p.id && p.title && p.link);
}

// Returns { keep, reason, score, matched } for one post.
export function evaluate(post, settings, now = Date.now()) {
  const hay = `${post.title} ${post.text}`.toLowerCase();
  const title = post.title.toLowerCase();
  const block = settings.blockWords.find((w) => hay.includes(w.toLowerCase()));
  if (block) return { keep: false, reason: `blocked word "${block}"` };
  if (settings.username && post.author && post.author.toLowerCase() === settings.username.toLowerCase()) return { keep: false, reason: 'our own post' };
  const ageH = (now - Date.parse(post.updated)) / 36e5;
  if (!Number.isFinite(ageH)) return { keep: false, reason: 'no date' };
  if (ageH > settings.maxAgeHours) return { keep: false, reason: 'too old' };
  const matched = settings.cues.filter((c) => hay.includes(c.toLowerCase()));
  let score = 0;
  if (title.includes('?')) score += 2;
  score += Math.min(matched.length, 4);
  if (score < settings.minScore) return { keep: false, reason: 'does not look like a question we can help with' };
  if (ageH < 3) score += 2; else if (ageH < 8) score += 1;
  return { keep: true, score, matched, ageH };
}

// Best first, but never more than perSubreddit from one place, and perRun in total.
export function choose(found, settings) {
  const perSub = {};
  const out = [];
  for (const p of [...found].sort((a, b) => b.score - a.score)) {
    perSub[p.subreddit] = (perSub[p.subreddit] ?? 0) + 1;
    if (perSub[p.subreddit] > settings.perSubreddit) continue;
    out.push(p);
    if (out.length >= settings.perRun) break;
  }
  return out;
}

const age = (h) => (h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);

export function render(accountId, picked, stats, now = Date.now()) {
  const lines = [
    `# Reddit: posts to answer (${accountId}), ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    '',
    'Для Claude: выбери 3-5 лучших постов, где можно честно помочь по существу. Ответ 3-5 предложений, по-английски, БЕЗ ссылок на наш сайт, без рекламы. Если пост не подходит, так и скажи.',
    '',
  ];
  if (!picked.length) lines.push('Подходящих новых постов нет.', '');
  picked.forEach((p, i) => {
    lines.push(`## ${i + 1}. r/${p.subreddit}: ${p.title}`, `${p.link}`, `Возраст ${age(p.ageH)}, оценка ${p.score}, совпало: ${p.matched.join(', ') || '-'}`);
    if (p.text) lines.push(`> ${p.text.slice(0, 280)}${p.text.length > 280 ? '...' : ''}`);
    lines.push('');
  });
  lines.push('---', `Просмотрено постов: ${stats.total}. Отброшено: ${Object.entries(stats.dropped).map(([k, v]) => `${k} ${v}`).join('; ') || 'ничего'}.`);
  if (stats.failed.length) lines.push(`Не открылись: ${stats.failed.join('; ')}.`);
  return lines.join('\n') + '\n';
}

const readJson = (path, fallback) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Several subreddits in ONE request (r/a+b+c): far fewer requests, so Reddit does not say "too many" (429).
async function fetchFeed(subs, retried = false) {
  const url = `https://www.reddit.com/r/${subs.map(encodeURIComponent).join('+')}/new/.rss?limit=100`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/atom+xml,application/xml' } });
  if (res.status === 429 && !retried) {
    const wait = Math.min(Number(res.headers.get('retry-after')) || 30, 90);
    console.log(`  Reddit says "too many requests": waiting ${wait} s and trying once more...`);
    await sleep(wait * 1000);
    return fetchFeed(subs, true);
  }
  if (res.status === 429) throw new Error('Reddit still says "too many requests" (429). Wait 10-15 minutes and run again.');
  if (res.status === 403) throw new Error('Reddit answered 403: it refuses this network. Try from your home internet without VPN.');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text());
}

async function main() {
  const args = process.argv.slice(2);
  const id = args.includes('--account') ? args[args.indexOf('--account') + 1] : 'main';
  const again = args.includes('--again');
  const config = readJson(join(root, 'data', 'reddit-accounts.json'), null);
  const settings = config?.accounts?.[id];
  if (!settings) { console.error(`PROBLEM: no account "${id}" in data/reddit-accounts.json.`); return 1; }
  if (settings.enabled === false) { console.log(`Account "${id}" is switched off in data/reddit-accounts.json.`); return 0; }

  const seenPath = join(root, 'data', 'reddit-seen.json');
  const seen = readJson(seenPath, {});
  const now = Date.now();
  for (const [k, t] of Object.entries(seen)) if (now - t > 14 * 864e5) delete seen[k];

  const stats = { total: 0, dropped: {}, failed: [] };
  const found = new Map();
  const groups = [];
  for (let i = 0; i < settings.subreddits.length; i += 4) groups.push(settings.subreddits.slice(i, i + 4));
  for (const [gi, group] of groups.entries()) {
    if (gi) await sleep(6000); // a pause between requests
    try {
      const posts = await fetchFeed(group);
      console.log(`  ${group.map((g) => `r/${g}`).join(', ')}: ${posts.length} posts`);
      for (const p of posts) {
        stats.total++;
        const r = again || !seen[p.id] ? evaluate(p, settings, now) : { keep: false, reason: 'already listed before' };
        if (!r.keep) { stats.dropped[r.reason] = (stats.dropped[r.reason] ?? 0) + 1; continue; }
        found.set(p.id, { ...p, ...r, subreddit: p.subreddit ?? group[0] });
      }
    } catch (e) {
      console.log(`  ${group.map((g) => `r/${g}`).join(', ')}: FAILED (${e.message})`);
      stats.failed.push(`${group.join(', ')} (${e.message})`);
    }
  }
  if (stats.failed.length === groups.length) { console.error('PROBLEM: no feed could be read. Nothing saved.'); return 1; }

  const picked = choose([...found.values()], settings);
  for (const p of picked) seen[p.id] = now;
  mkdirSync(join(root, 'drafts'), { recursive: true });
  const out = join('drafts', `reddit-candidates-${id}.md`);
  writeFileSync(join(root, out), render(id, picked, stats, now));
  writeFileSync(seenPath, JSON.stringify(seen, null, 2));
  console.log(`Saved ${out}: ${picked.length} posts. Now tell Claude: "reddit saveandplay".`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
