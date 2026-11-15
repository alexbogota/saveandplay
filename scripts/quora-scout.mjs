// Scouts niches for Quora: are there questions on this topic, how many, and which of our articles already answer them.
// It never opens Quora (closed to robots). It asks a search API for pages of quora.com and counts what comes back.
// Nothing is posted anywhere. Settings and the list of niches: data/quora-scout.json. How to read the report: docs/quora-scout.md.
//
//   npm run quora:scout                          every niche that is not switched off
//   npm run quora:scout -- --niche crafts        one niche from the settings
//   npm run quora:scout -- --topic "bullet journal, habit tracker"   a quick look at a topic that is not in the settings
//   npm run quora:scout -- --from drafts/quora-scout/raw-2026-11-15.json   build the report from saved search results (no key, no requests)
//   npm run quora:scout -- --fresh               ask the search again even if today's answers are saved
//
// The search needs a free key: tavily.com (1,000 searches a month; the sign-up asks for a card to verify it, no charge), the line TAVILY_API_KEY=... in the .env file.
// One niche costs as many searches as it has queries (12 at most by default).
// Result: drafts/quora-scout/report-<date>.md and raw-<date>.json (the search answers, so a second run costs nothing).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { buildQueries, scoutNiche, verdict, verdictLabel, byStrength, renderReport, loadArticles, articlesFromSitemap, materialsFromResults } from './lib/quora-scout.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
};
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function envValue(name) {
  if (process.env[name]) return process.env[name];
  const file = join(root, '.env');
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') || null : null;
}

const quoraDomain = (lang) => (lang === 'en' ? 'quora.com' : `${lang}.quora.com`);

// One search limited to one site -> [{ title, url }]. Tavily: POST /search, 1 credit for a basic search.
async function searchTavily(query, key, settings, domain) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, search_depth: 'basic', max_results: settings.resultsPerQuery ?? 20, include_domains: [domain] }),
    });
    if (res.status === 429 && attempt === 0) {
      await sleep((Number(res.headers.get('retry-after')) || 20) * 1000);
      continue;
    }
    if (res.status === 401) fail('The search refused the key (401). Check TAVILY_API_KEY in the .env file.');
    if (res.status === 432 || res.status === 433) fail(`The monthly limit of the search key is used up (${res.status}). Wait for the next month or run with --from on saved results.`);
    if (!res.ok) throw new Error(`search answered ${res.status}`);
    const data = await res.json();
    return (data.results ?? []).map((r) => ({ title: r.title, url: r.url }));
  }
  throw new Error('search is busy (429 twice)');
}

// ctx: { settings, raw, save, key, from, fresh, count }. A "search" source is material that lives on a site closed to programs
// (classes of a marketplace): its titles come from a search limited to that site, never from the site itself, and are saved.
async function nicheArticles(niche, ctx) {
  const sources = [].concat(niche.articles ?? []);
  const out = loadArticles(sources, root);
  for (const src of sources.filter((s) => s.search)) {
    const cfg = ctx.settings.articleSources?.[src.search];
    if (!cfg) {
      console.log(`  no articleSources.${src.search} in the settings`);
      continue;
    }
    ctx.raw.materials ??= {};
    const cacheKey = `${cfg.domain}|${src.query.toLowerCase()}`;
    if ((ctx.fresh || !ctx.raw.materials[cacheKey]) && !ctx.from && ctx.key) {
      try {
        ctx.raw.materials[cacheKey] = await searchTavily(src.query, ctx.key, ctx.settings, cfg.domain);
        ctx.count();
        ctx.save();
        await sleep(ctx.settings.pauseMs ?? 1200);
      } catch (e) {
        console.log(`  material search "${src.query}" failed: ${e.message}`);
      }
    }
    out.push(...materialsFromResults(ctx.raw.materials[cacheKey] ?? [], cfg));
  }
  for (const src of sources.filter((s) => s.sitemap)) {
    try {
      const res = await fetch(src.sitemap, { headers: { 'user-agent': 'sitemap-reader/1.0' } });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      out.push(...articlesFromSitemap(await res.text(), { include: src.include }));
    } catch (e) {
      console.log(`  could not read the sitemap ${src.sitemap}: ${e.message}`);
    }
  }
  return out;
}

async function main() {
  const settings = readJson(join(root, 'data/quora-scout.json'), null);
  if (!settings) fail('data/quora-scout.json is missing or broken.');
  const date = new Date().toISOString().slice(0, 10);
  const outDir = join(root, 'drafts/quora-scout');
  mkdirSync(outDir, { recursive: true });

  let niches = Object.entries(settings.niches ?? {}).filter(([, n]) => n.enabled !== false);
  const only = arg('--niche');
  const topic = arg('--topic');
  if (topic) {
    const seeds = topic.split(',').map((s) => s.trim()).filter(Boolean);
    niches = [[`topic-${seeds[0].toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, { name: topic, seeds, words: seeds.flatMap((s) => s.toLowerCase().split(/\s+/)).filter((w) => w.length > 3) }]];
  } else if (only) {
    niches = Object.entries(settings.niches ?? {}).filter(([id]) => id === only);
    if (!niches.length) fail(`No niche "${only}" in data/quora-scout.json. There are: ${Object.keys(settings.niches ?? {}).join(', ')}`);
  }

  const from = arg('--from');
  const rawFile = from ? resolve(from) : join(outDir, `raw-${date}.json`);
  const saved = readJson(rawFile, null);
  if (from && !saved) fail(`Cannot read ${rawFile}.`);
  const raw = saved ?? { date, source: 'Tavily Search API', niches: {} };
  const fresh = args.includes('--fresh');
  const key = from ? null : envValue('TAVILY_API_KEY');

  // Every saved answer by language and query: two niches that share a query pay for it once.
  const pool = new Map();
  const poolKey = (lang, query) => `${lang}|${query.toLowerCase()}`;
  for (const [id, answers] of Object.entries(raw.niches ?? {})) {
    for (const a of answers) pool.set(poolKey(a.lang ?? settings.niches?.[id]?.lang ?? 'en', a.query), a.results ?? []);
  }

  const done = [];
  let askedFor = 0;
  const ctx = { settings, raw, key, from, fresh, save: () => writeFileSync(rawFile, `${JSON.stringify(raw, null, 1)}
`), count: () => askedFor++ };
  for (const [id, niche] of niches) {
    const lang = niche.lang ?? 'en';
    const queries = buildQueries(niche, settings);
    if (!from) {
      const missing = queries.filter((q) => fresh || !pool.has(poolKey(lang, q)));
      if (missing.length && !key) {
        fail(
          `No search key. Get a free one at tavily.com (1,000 searches a month; the sign-up asks for a card to verify it, no charge), add the line TAVILY_API_KEY=... to the .env file in the project folder and run again.\nThis run needs ${missing.length} searches for "${id}".`,
        );
      }
      for (const query of missing) {
        try {
          const results = await searchTavily(query, key, settings, quoraDomain(lang));
          askedFor++;
          pool.set(poolKey(lang, query), results);
          raw.niches[id] = [...(raw.niches[id] ?? []).filter((a) => a.query !== query), { query, lang, results }];
          writeFileSync(rawFile, `${JSON.stringify(raw, null, 1)}\n`);
          console.log(`  ${id}: ${results.length} pages for "${query}"`);
        } catch (e) {
          console.log(`  ${id}: "${query}" failed: ${e.message}`);
        }
        await sleep(settings.pauseMs ?? 1200);
      }
    }
    const answers = queries.filter((q) => pool.has(poolKey(lang, q))).map((query) => ({ query, results: pool.get(poolKey(lang, query)) }));
    if (!answers.length) {
      console.log(`${id}: no saved search results for its queries, skipped.`);
      continue;
    }
    const articles = await nicheArticles(niche, ctx);
    const stats = scoutNiche(niche, answers, { articles, minShared: settings.minSharedWords ?? 2, blockWords: settings.blockWords ?? [], angles: typeof niche.angles === "string" ? settings.angles?.[niche.angles] ?? null : niche.angles ?? null });
    done.push({ id, niche, stats, verdict: verdict(stats, settings.limits), hasArticles: articles.length > 0 });
  }
  if (!done.length) fail('Nothing to report.');

  done.sort(byStrength);
  const reportFile = join(outDir, `report-${raw.date ?? date}${topic ? `-${done[0].id}` : only ? `-${only}` : ''}.md`);
  writeFileSync(reportFile, renderReport(done, { date: raw.date ?? date, source: raw.source ?? 'Tavily Search API', top: settings.topQuestions ?? 20 }));
  for (const n of done) {
    const s = n.stats;
    console.log(`${n.id}: ${s.unique} questions from ${s.queries} searches, share ${Math.round(s.share * 100)}%, ${n.hasArticles ? `${s.withArticle} have our article` : 'no articles connected'} -> ${verdictLabel(n.verdict)}`);
  }
  if (askedFor) console.log(`Searches used in this run: ${askedFor}.`);
  console.log(`Report: ${reportFile}`);
}

main().catch((e) => fail(e.stack ?? String(e)));
