// The list of ready posts for X (Twitter), for the Google Sheet. No AI, no API, no keys: it only re-shapes what the daily brief already made.
//
// X has no way for us to post by program (decision 21 October 2026), so the owner copies the ready text into X by hand. To make it as short as
// possible, this program collects the "x" posts of EVERY account (accounts.<id>.channels.x in data/accounts.json: main, second deal, Cozy, Retro,
// and any future niche: a new account with an "x" channel is picked up by itself) into ONE small CSV file. A Google Sheet reads that file by
// itself with one formula (=IMPORTDATA("<address of the file>")), so the owner only copies a cell.
//
// Each post is flattened to ONE line (Google Sheets puts quotation marks around a copied cell that has line breaks, and they would land in the post).
// The flat text keeps everything the post had in the same order and ends with the plain text "Ad". Its length is checked again after the
// flattening (limit: X_LIMIT, the link counts as 23): a post that does not fit is left out and said so, never cut.
//
// Files (in drafts/, saved on the "brief" branch by scripts/brief-branch.sh):
//   x-posts.json  the history, the last KEEP_DAYS days, the newest first (so a missed day is still in the sheet)
//   x-posts.csv   the same as a table: day, account, post, chars
// Usage: node scripts/x-sheet.mjs   (after scripts/daily-brief.mjs)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const X_LIMIT = 280;
export const LINK_CHARS = 23;
export const KEEP_DAYS = 7;

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const graphemes = (s) => [...segmenter.segment(s)].length;

// "Title: -75% at GOG\n$4.99 (was $19.99)\nPrice checked Oct 21.\n\nhttps://...\n\n#PCGaming #GOG\nAd"
//  ->  "Title: -75% at GOG | $4.99 (was $19.99) | Price checked Oct 21. https://... #PCGaming #GOG Ad"
export function flatten(text) {
  const paragraphs = text.trim().split(/\n\s*\n/).map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean));
  const out = paragraphs.map((lines, i) => lines.join(i === 0 ? ' | ' : ' '));
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

// Length the way X counts it: every link is 23 characters.
export function xLength(flat) {
  const link = flat.match(/https?:\/\/\S+/g) ?? [];
  let t = flat;
  for (const l of link) t = t.replace(l, '');
  return graphemes(t) + link.length * LINK_CHARS;
}

// Checks one flat post. Returns the problems (an empty list = fine).
export function problemsOf(flat) {
  const p = [];
  if (!/(^|\s)Ad$/.test(flat)) p.push('the text does not end with the plain word Ad');
  if (!/https:\/\/saveandplay\.com\/deals\//.test(flat)) p.push('no link to our game page');
  if (/https?:\/\/(?!saveandplay\.com\/)\S+/.test(flat)) p.push('a link that is not ours');
  const n = xLength(flat);
  if (n > X_LIMIT) p.push(`${n} characters, X allows ${X_LIMIT}`);
  return p;
}

const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;
export const toCsv = (rows) => ['day,account,post,chars', ...rows.map((r) => [r.day, r.account, r.post, r.chars].map(csvCell).join(','))].join('\n') + '\n';

// Merges today's posts into the history: the same day and account is replaced (a second run of the day), older than KEEP_DAYS is dropped, newest first.
export function merge(history, fresh, today) {
  const key = (r) => `${r.day}|${r.account}`;
  const gone = new Set(fresh.map(key));
  const oldest = Date.parse(today) - (KEEP_DAYS - 1) * 86400000;
  const kept = history.filter((r) => !gone.has(key(r)) && Date.parse(r.day) >= oldest);
  return [...fresh, ...kept].sort((a, b) => (a.day === b.day ? a.order - b.order : a.day < b.day ? 1 : -1));
}

export async function build({ accountsFile, draftsDir, today }) {
  const cfg = JSON.parse(await readFile(accountsFile, 'utf8'));
  const fresh = [];
  const notes = [];
  let order = 0;
  for (const [id, account] of Object.entries(cfg.accounts)) {
    const ch = account.channels?.x;
    if (account.enabled === false || !ch || ch.enabled === false) continue;
    order++;
    const file = resolve(draftsDir, `post-${id}-x.md`);
    if (!existsSync(file)) { notes.push(`${id}: no file ${file}`); continue; }
    const text = (await readFile(file, 'utf8')).trim();
    if (!text || text.startsWith('NO POST TODAY')) { notes.push(`${id}: ${text || 'empty file'}`); continue; }
    const post = flatten(text);
    const bad = problemsOf(post);
    if (bad.length) { notes.push(`${id}: LEFT OUT, ${bad.join('; ')}`); continue; }
    fresh.push({ day: today, account: id, post, chars: xLength(post), order });
  }
  return { fresh, notes };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const draftsDir = process.env.OUT_DIR ? resolve(process.env.OUT_DIR) : resolve(root, 'drafts');
  const accountsFile = process.env.ACCOUNTS_FILE ? resolve(process.env.ACCOUNTS_FILE) : resolve(root, 'data/accounts.json');
  const today = process.env.X_TODAY ?? new Date().toISOString().slice(0, 10);
  await mkdir(draftsDir, { recursive: true });
  const histFile = resolve(draftsDir, 'x-posts.json');
  const history = existsSync(histFile) ? JSON.parse(await readFile(histFile, 'utf8')) : [];
  const { fresh, notes } = await build({ accountsFile, draftsDir, today });
  const rows = merge(history, fresh, today);
  await writeFile(histFile, JSON.stringify(rows, null, 1) + '\n');
  await writeFile(resolve(draftsDir, 'x-posts.csv'), toCsv(rows));
  console.log(`X posts: ${fresh.length} new today, ${rows.length} in the list.`);
  for (const n of notes) console.log(process.env.GITHUB_ACTIONS && /LEFT OUT/.test(n) ? `::warning::X: ${n}` : `X: ${n}`);
  if (process.env.GITHUB_STEP_SUMMARY && fresh.length) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Posts for X (${fresh.length}): they are in the Google Sheet\n\n\`\`\`\`text\n${fresh.map((r) => `[${r.account}] ${r.post}`).join('\n\n')}\n\`\`\`\`\n\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
