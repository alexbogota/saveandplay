// Looks at an Admitad product feed and writes a plain report: which columns it has, how full they are,
// what the prices look like. It changes nothing on the site. Run by hand from GitHub (Actions -> "Feed probe").
//
// The access key of the feed (ADMITAD_FEED_USER, ADMITAD_FEED_CODE) lives only in GitHub Secrets.
// It is never written to a file, and every address in the report is cleaned of it.
// Which feeds to look at: data/feeds.json (feed numbers are not secret). A new store or a new region = one more line there.
//
// Usage: node scripts/feed-probe.mjs [store]      (store = a key of data/feeds.json, default: all)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const USER = process.env.ADMITAD_FEED_USER;
const CODE = process.env.ADMITAD_FEED_CODE;
if (!USER || !CODE) {
  console.error('ADMITAD_FEED_USER / ADMITAD_FEED_CODE are not set (add them in GitHub: Settings -> Secrets and variables -> Actions).');
  process.exit(1);
}

const config = JSON.parse(readFileSync('data/feeds.json', 'utf8'));
const only = process.argv[2];
const MAX_BYTES = 300_000_000;

const clean = (s) => String(s).replaceAll(USER, '***').replaceAll(CODE, '***');
const short = (s, n = 110) => {
  const t = clean(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};
const md = (s) => short(s).replace(/\|/g, '\\|');

function feedUrl(site, id) {
  return `${process.env.FEED_ORIGIN ?? 'https://export.admitad.com'}/en/webmaster/websites/${site}/products/export_adv_products/?user=${USER}&code=${CODE}&feed_id=${id}&format=csv`;
}

// A small CSV reader: quotes, doubled quotes, line breaks inside quotes.
function parseCsv(text, delim) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function guessDelimiter(firstLine) {
  const counts = [';', ',', '\t', '|'].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}

const num = (v) => {
  const n = Number(String(v).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

async function probe(store, name, site, id) {
  const out = [`### ${store} / ${name} (feed ${id})`, ''];
  let res;
  try {
    res = await fetch(feedUrl(site, id), { headers: { 'User-Agent': 'saveandplay-feed-probe' } });
  } catch (e) {
    out.push(`Download failed: ${clean(e.message)}`, '');
    return out.join('\n');
  }
  out.push(`HTTP ${res.status}, type: ${res.headers.get('content-type') ?? '?'}`);
  if (!res.ok) return out.concat(['', 'The feed did not open. Check the key and the feed number.', '']).join('\n');

  const buf = Buffer.from(await res.arrayBuffer());
  const cut = buf.length > MAX_BYTES;
  const text = buf.subarray(0, MAX_BYTES).toString('utf8');
  out.push(`Size: ${(buf.length / 1e6).toFixed(1)} MB${cut ? ' (only the first 300 MB were read)' : ''}`);

  const firstLine = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : 2000);
  const delim = guessDelimiter(firstLine);
  const rows = parseCsv(text, delim);
  const header = rows.shift() ?? [];
  const data = rows.filter((r) => r.length > 1);
  out.push(`Separator: ${delim === '\t' ? 'TAB' : '"' + delim + '"'}; columns: ${header.length}; products: ${data.length}`, '');

  // Columns: how full, example values, and the few values for short lists (currency, platform, availability...).
  out.push('| # | Column | Filled | Distinct | Examples |', '|---|---|---|---|---|');
  const cols = header.map((h, i) => {
    const vals = data.map((r) => r[i] ?? '');
    const filled = vals.filter((v) => v.trim() !== '');
    const set = new Map();
    for (const v of filled) set.set(v, (set.get(v) ?? 0) + 1);
    return { h, i, filled: filled.length, set };
  });
  for (const c of cols) {
    const pct = data.length ? Math.round((c.filled / data.length) * 100) : 0;
    const ex = c.set.size <= 12
      ? [...c.set.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v, n]) => `${short(v, 30)} (${n})`).join('; ')
      : [...c.set.keys()].slice(0, 2).map((v) => short(v, 50)).join(' · ');
    out.push(`| ${c.i} | ${md(c.h)} | ${pct}% | ${c.set.size} | ${md(ex)} |`);
  }
  out.push('');

  // Prices: how many products have an old price higher than the current one.
  const find = (re) => cols.find((c) => re.test(c.h));
  const priceCol = find(/^price$/i) ?? find(/price/i);
  const oldCol = find(/old.?price/i);
  if (priceCol && oldCol) {
    let disc = 0, bad = 0, big = 0;
    for (const r of data) {
      const p = num(r[priceCol.i]), o = num(r[oldCol.i]);
      if (!(p > 0)) { bad++; continue; }
      if (o > p) { disc++; if (1 - p / o >= 0.5) big++; }
    }
    out.push(`Products with an old price above the current price: ${disc} (of them 50% off or more: ${big}). Products without a usable price: ${bad}.`, '');
  } else {
    out.push(`Price columns: current = ${priceCol?.h ?? 'not found'}, old = ${oldCol?.h ?? 'not found'}.`, '');
  }

  out.push('Three sample rows (long text cut, key removed):', '');
  for (const r of data.slice(0, 3)) {
    out.push('```', ...header.map((h, i) => `${h}: ${short(r[i] ?? '', 140)}`), '```');
  }
  out.push('');
  return out.join('\n');
}

const report = ['# Admitad feed report', `Made: ${new Date().toISOString()}`, ''];
for (const [store, s] of Object.entries(config)) {
  if (only && only !== store) continue;
  for (const [name, id] of Object.entries(s.feeds)) {
    console.log(`Looking at ${store} / ${name} …`);
    report.push(await probe(store, name, s.site, id));
  }
}

mkdirSync('drafts', { recursive: true });
const text = report.join('\n');
writeFileSync('drafts/feed-report.md', text);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, text, { flag: 'a' });
console.log(text);
