// Fills data/game-facts.json: the release year, genres, tags and "mature" flag of every game in data/deals.json.
// The niche accounts (Cozy, Retro, ...) choose their games by these facts (see scripts/lib/facts.mjs and "select" in data/accounts.json).
//
//   npm run facts                  fill what is missing, and refresh entries older than REFRESH_DAYS
//   npm run facts -- --dry-run     only show what would be asked, write nothing
//   GitHub: runs by itself in the "Update deals" workflow, right after the prices.
//
// A GOG game is asked from the GOG catalog (the year the game came out, GOG's genres and tags), any other game from Steam appdetails
// by its Steam number. A game the source does not know gets NO entry (the niche accounts then skip it; nothing is guessed).
// Facts of games that left data/deals.json long ago are removed. One request per second, same good-citizen rules as the price update.
//
// For tests: DEALS_FILE, FACTS_FILE, GOG_CATALOG_URL, FEED_PAUSE_MS, ENRICH_NOW.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { makeClient, lookup } from './lib/gog.mjs';
import { gogFacts, steamFactsOf } from './lib/facts.mjs';
import { slug } from './lib/deal-paths.mjs';

const UA = 'SaveAndPlay-prices/1.0 (+https://saveandplay.com)';
const DAY = 864e5;
const REFRESH_DAYS = 60; // a game's genres and year do not change; this only catches a catalog fix
const KEEP_DAYS = 30; // facts of a game that is no longer a deal are kept this long (it often comes back in the next sale)

const path = (envName, rel) => (process.env[envName] ? resolve(process.env[envName]) : fileURLToPath(new URL(rel, import.meta.url)));
const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`Cannot read ${file}: ${e.message}`);
  }
};

export const dealId = (d) => slug(`${d.store}-${d.title}`);
const gogSlug = (url) => url?.match(/gog\.com\/(?:[a-z]{2}\/)?game\/([a-z0-9_]+)/i)?.[1]?.toLowerCase() ?? null;
const steamIdOf = (d) => {
  const n = Number(d.steamId ?? d.image?.match(/\/apps\/(\d+)\//)?.[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Which deals need a fresh look: no entry, or an old one.
export function needed(deals, facts, nowMs) {
  return deals.filter((d) => {
    const f = facts[dealId(d)];
    return !f || !f.at || (nowMs - Date.parse(f.at)) / DAY > REFRESH_DAYS;
  });
}

// Entries of games that are not deals any more are dropped after KEEP_DAYS.
export function prune(facts, deals, nowMs) {
  const live = new Set(deals.map(dealId));
  const out = {};
  for (const [id, f] of Object.entries(facts)) if (live.has(id) || (nowMs - Date.parse(f.at)) / DAY <= KEEP_DAYS) out[id] = f;
  return out;
}

// ask = { gog: (deal) => raw product | null | throws, steam: (appid) => appdetails data | null | throws }
export async function enrich({ deals, facts, nowMs, ask }) {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const next = { ...facts };
  const report = { added: [], unknown: [], problems: [] };
  for (const d of needed(deals, facts, nowMs)) {
    try {
      let entry = null;
      if (d.store === 'GOG') {
        const raw = gogSlug(d.url) ? await ask.gog(d) : null;
        if (raw) entry = gogFacts(raw, today);
      } else if (steamIdOf(d)) {
        const data = await ask.steam(steamIdOf(d));
        if (data) entry = steamFactsOf(data, today);
      }
      if (entry) {
        next[dealId(d)] = entry;
        report.added.push(`${d.title} (${d.store}): ${entry.year ?? 'year unknown'}, ${entry.genres.slice(0, 3).join('/') || 'no genres'}`);
      } else report.unknown.push(`${d.title} (${d.store})`);
    } catch (e) {
      report.problems.push(`${d.title} (${d.store}): ${e.message}`);
    }
  }
  return { facts: prune(next, deals, nowMs), report };
}

async function main() {
  const nowMs = process.env.ENRICH_NOW ? Date.parse(process.env.ENRICH_NOW) : Date.now();
  const dry = process.argv.includes('--dry-run');
  const dealsFile = path('DEALS_FILE', '../data/deals.json');
  const factsFile = path('FACTS_FILE', '../data/game-facts.json');
  const deals = await readJson(dealsFile, []);
  const facts = await readJson(factsFile, {});
  const todo = needed(deals, facts, nowMs);
  console.log(`${deals.length} deals, ${Object.keys(facts).length} known facts, ${todo.length} to ask${dry ? ' (dry run)' : ''}.`);
  if (dry) {
    for (const d of todo) console.log(`- ${d.title} (${d.store})`);
    return;
  }

  const get = makeClient({ ua: UA, timeoutMs: Number(process.env.FEED_TIMEOUT_MS) || 20000, pauseMs: Number(process.env.FEED_PAUSE_MS ?? 1000) });
  let steamAppData = null;
  const ask = {
    gog: async (d) => {
      const r = await lookup(get, d.title, gogSlug(d.url));
      if (r.error) throw new Error(r.error);
      return r.raw ?? null;
    },
    steam: async (appid) => {
      steamAppData ??= (await import('./steam.mjs')).steamAppData;
      return steamAppData(appid);
    },
  };
  const { facts: next, report } = await enrich({ deals, facts, nowMs, ask });
  console.log(`Added ${report.added.length}, no answer for ${report.unknown.length}, errors ${report.problems.length}.`);
  for (const l of report.added) console.log(`+ ${l}`);
  for (const l of report.unknown) console.log(`? ${l}: the source does not know this game, no entry`);
  for (const l of report.problems) console.log(`! ${l}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Game facts (genres, years): added ${report.added.length}, unknown ${report.unknown.length}, errors ${report.problems.length}\n\n${[...report.unknown.map((l) => `- ${l}: unknown`), ...report.problems.map((l) => `- ${l}`)].join('\n')}\n\n`);
  }
  await writeFile(factsFile, JSON.stringify(next, null, 1) + '\n');
}

if (!process.env.ENRICH_AS_MODULE) await main();
