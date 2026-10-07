// Checks every feed listed in data/sources.json and tells which ones really work:
// does it open, how fresh is the newest post, how often does it post, full text or short teasers.
//
//   npm run sources                                           on your computer
//   GitHub -> Actions -> "Check sources" -> Run workflow      the same thing, on GitHub
//
// Read-only: it changes nothing on the site and publishes nothing.
// Result: a table on screen, drafts/sources-report.md and drafts/sources-report.json
// (the drafts/ folder is not committed), and on GitHub the same table on the run page.
//
// Good-citizen rules: one request per feed, a pause between requests, a User-Agent that says who we are,
// robots.txt is respected, no cookies, no tricks. A site that refuses us is marked, never bypassed.
//
// Option: --all also checks the sources marked "skip" in data/sources.json.
// For tests: SOURCES_FILE, REPORT_DIR, FEED_TIMEOUT_MS, FEED_PAUSE_MS can be set in the environment.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { decode, plain, parseDate, parseFeed, robotsAllows, loadFeed, sleep } from './lib/feeds.mjs';

// The feed-reading code lives in scripts/lib/feeds.mjs (shared with scripts/daily-brief.mjs).
// It is re-exported here, so tests and other scripts can still import it from this file.
export { decode, plain, parseDate, parseFeed, robotsAllows };

const UA = 'SaveAndPlay-feed-check/1.0 (+https://saveandplay.com)';
const TIMEOUT_MS = Number(process.env.FEED_TIMEOUT_MS) || 20000;
const PAUSE_MS = Number(process.env.FEED_PAUSE_MS ?? 1000);
const FRESH_DAYS = 14; // a feed whose newest post is older than this is marked "stale"
const MAX_BYTES = 3_000_000; // never read more than this from one feed
const FULL_TEXT_CHARS = 1200; // median post text at least this long = "full text", shorter = "teaser"

// ---------- statistics of one feed ----------

export function stats(items, now = Date.now()) {
  const dated = items.filter((i) => i.t != null).sort((a, b) => b.t - a.t).slice(0, 30);
  const newest = dated[0]?.t ?? null;
  const ageDays = newest == null ? null : Math.max(0, (now - newest) / 864e5);
  let perWeek = null;
  if (dated.length >= 3) {
    const span = (dated[0].t - dated.at(-1).t) / 864e5;
    if (span > 0) perWeek = ((dated.length - 1) / span) * 7;
  }
  const lens = items.map((i) => i.len).sort((a, b) => a - b);
  const median = lens.length ? lens[Math.floor(lens.length / 2)] : 0;
  return { newest, newestTitle: dated[0]?.title ?? '', ageDays, perWeek, text: median >= FULL_TEXT_CHARS ? 'full' : 'teaser' };
}

// ---------- checking one source ----------

export async function check(src, now = Date.now()) {
  const out = { id: src.id, name: src.name, topics: src.topics, feed: src.feed, listed: src.status, status: 'FAIL', note: '', http: null, items: 0, newest: null, newestTitle: '', ageDays: null, perWeek: null, text: null };
  const r = await loadFeed(src.feed, { ua: UA, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });
  if (r.kind !== 'OK') return { ...out, status: r.kind, note: r.note, http: r.http };
  out.http = r.http;
  out.items = r.items.length;
  if (!out.items) return { ...out, status: 'EMPTY', note: 'лента открылась, но записей в ней нет' };
  const s = stats(r.items, now);
  Object.assign(out, {
    newest: s.newest == null ? null : new Date(s.newest).toISOString().slice(0, 10),
    newestTitle: s.newestTitle || r.items[0].title,
    ageDays: s.ageDays == null ? null : Math.round(s.ageDays),
    perWeek: s.perWeek == null ? null : Math.round(s.perWeek * 10) / 10,
    text: s.text,
  });
  if (s.newest == null) return { ...out, status: 'NO_DATES', note: 'в записях нет дат' };
  if (s.ageDays > FRESH_DAYS) return { ...out, status: 'STALE', note: `последний пост ${Math.round(s.ageDays)} дн. назад` };
  return { ...out, status: 'OK' };
}

// ---------- the report ----------

const LABEL = { OK: 'работает', NO_DATES: 'нет дат', STALE: 'давно не обновлялась', EMPTY: 'пусто', NOT_FEED: 'не лента', ROBOTS: 'запрещено robots.txt', FAIL: 'ошибка' };
const RANK = { OK: 0, NO_DATES: 1, STALE: 2, EMPTY: 3, NOT_FEED: 4, ROBOTS: 5, FAIL: 6 };
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function report(results, topics, when = new Date()) {
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  const order = Object.keys(topics);
  const sorted = [...results].sort(
    (a, b) => order.indexOf(a.topics[0]) - order.indexOf(b.topics[0]) || RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name),
  );
  const lines = [
    `# Проверка источников, ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `Проверено лент: ${results.length}. ` + Object.keys(RANK).filter((k) => counts[k]).map((k) => `${LABEL[k]}: ${counts[k]}`).join(', ') + '.',
    '',
    `Свежей считаем ленту, где последний пост не старше ${FRESH_DAYS} дней. «≈ в неделю» это оценка по датам записей внутри ленты. Темы: ${order.map((k) => `${k} = ${topics[k]}`).join('; ')}.`,
    '',
    '| Тема | Источник | Статус | Последний пост | ≈ в неделю | Текст | Последний заголовок или причина |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of sorted) {
    lines.push(
      '| ' +
        [
          r.topics.join('/'),
          cell(r.name),
          LABEL[r.status],
          r.newest ? `${r.newest} (${r.ageDays} дн.)` : '—',
          r.perWeek ?? '—',
          r.text === 'full' ? 'полный' : r.text === 'teaser' ? 'анонс' : '—',
          cell(cut(r.status === 'OK' ? r.newestTitle : r.status === 'NO_DATES' ? `${r.note}. Первая запись: ${r.newestTitle}` : r.note, 70)) || '—',
        ].join(' | ') +
        ' |',
    );
  }
  const broke = results.filter((r) => r.listed === 'ok' && r.status !== 'OK');
  const found = results.filter((r) => r.listed === 'candidate' && r.status === 'OK');
  lines.push('', `Были в списке как рабочие, а сейчас нет: ${broke.length ? broke.map((r) => `${r.name} (${LABEL[r.status]})`).join(', ') : 'таких нет'}.`);
  lines.push('', `Кандидаты, которые оказались рабочими и свежими: ${found.length ? found.map((r) => r.name).join(', ') : 'таких нет'}.`, '');
  return lines.join('\n');
}

// ---------- run ----------

async function main() {
  const file = process.env.SOURCES_FILE ? resolve(process.env.SOURCES_FILE) : fileURLToPath(new URL('../data/sources.json', import.meta.url));
  const outDir = process.env.REPORT_DIR ? resolve(process.env.REPORT_DIR) : fileURLToPath(new URL('../drafts/', import.meta.url));
  const all = process.argv.includes('--all');
  const list = JSON.parse(await readFile(file, 'utf8'));
  const sources = list.sources.filter((s) => all || s.status !== 'skip');

  console.log(`Checking ${sources.length} feeds, pause ${PAUSE_MS} ms between requests.`);
  const results = [];
  for (const [i, src] of sources.entries()) {
    if (i) await sleep(PAUSE_MS);
    const r = await check(src);
    results.push(r);
    console.log(`${String(i + 1).padStart(2)}/${sources.length} ${r.status.padEnd(8)} ${src.name}${r.note ? ' - ' + r.note : ''}`);
  }

  const md = report(results, list.topics);
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, 'sources-report.md'), md);
  await writeFile(resolve(outDir, 'sources-report.json'), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');

  console.log('\n' + md);
  console.log(`Files: ${resolve(outDir, 'sources-report.md')} and sources-report.json`);
}

// Running the file always runs the check. Only the tests set this variable, to import the functions without running it.
if (!process.env.CHECK_SOURCES_AS_MODULE) await main();
