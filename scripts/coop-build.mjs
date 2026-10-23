// Builds the games of data/coop-games.json that are made by the program (auto: true), from the host's list and Steam.
//
//   node scripts/coop-build.mjs            reads the host's list page (if it answers), matches every game to Steam, writes the files
//   node scripts/coop-build.mjs --dry-run  the same, writes nothing
//   node scripts/coop-build.mjs --offline  does not read the host's page (uses data/coop-host-games.json as it is)
//
// 1. data/coop-host-games.json = the games the host rents servers for. The host's list page is read again; new games are added there,
//    games that moved to "On the horizon" are taken out (the page is not trusted when it looks different: then nothing changes).
// 2. data/coop-steam-ids.json = hand-made answers: a Steam number (always wins) or {"skip": "reason"}.
//    Without an answer the name (the host's title, then the slug) is searched on Steam and accepted only when the cleaned names are the same.
// 3. Steam's answer (appdetails) decides: a released game with a multiplayer mode and no adult sexual content. Everything else is listed
//    with the reason in data/coop-build-report.md; nothing is guessed.
// 4. data/coop-games.json: hand-made games stay as they are; program games are rewritten (most reviewed first).
// Run by the workflow "Update co-op games" (weekly and by hand). Steam answers one request per 0.6 s.

import { readFile, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { clean, slugName, classify, buildEntry, mergeGames, parseHostList, titleOf } from './lib/coop-build.mjs';

const root = new URL('../data/', import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(name, root), 'utf8'));
const dryRun = process.argv.includes('--dry-run');
const offline = process.argv.includes('--offline');
const UA = { 'user-agent': 'SaveAndPlay co-op games script (saveandplay.com)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());

async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (res.ok) return await res.json();
    } catch { /* tried again */ }
    await sleep(1500 * attempt);
  }
  throw new Error(`request failed: ${url}`);
}
const search = async (term) => ((await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=us&l=english`)).items ?? []).filter((i) => i.type === 'app');
const details = async (id) => { const j = (await getJson(`https://store.steampowered.com/api/appdetails?appids=${id}&cc=us&l=english`))?.[id]; return j?.success ? j.data : null; };

const host = await read('coop-host-games.json');
const answers = await read('coop-steam-ids.json');
const gamesFile = await read('coop-games.json');
const report = { added: [], skipped: [], doubtful: [], missing: [], check: [], news: [] };

// ---- 1. the host's list ------------------------------------------------------------------------------------------------
if (!offline) {
  try {
    const res = await fetch(host.listUrl, { headers: UA, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`the page answered ${res.status}`);
    const live = parseHostList(await res.text());
    if (!live) report.news.push('The host page looks different from what the program expects: its list was NOT updated (the saved list is used).');
    else {
      for (const s of live.games) if (!host.games.includes(s)) report.news.push(`New game on the host: ${s}`);
      for (const s of host.games) if (!live.games.includes(s)) report.news.push(`No longer orderable at the host: ${s} (taken out)`);
      host.games = live.games;
      host.horizon = live.horizon;
      host.names = { ...(host.names ?? {}), ...live.names };
      host.checkedOn = today;
    }
  } catch (e) {
    report.news.push(`The host page could not be read (${e.message}): the saved list is used.`);
  }
}

// ---- 2 and 3. Steam -------------------------------------------------------------------------------------------------------
const autos = [];
let n = 0;
for (const hostSlug of host.games) {
  console.log(`[${++n}/${host.games.length}] ${hostSlug}`);
  const answer = answers[hostSlug];
  const hostPath = host.pathTemplate.replace('{slug}', hostSlug);
  if (gamesFile.games.some((g) => !g.auto && Object.values(g.hosts ?? {}).some((h) => h.path === hostPath))) continue; // a hand-made game: left as it is
  if (answer && typeof answer === 'object' && answer.skip) { report.skipped.push(`${hostSlug}: ${answer.skip}`); continue; }
  try {
    let appid = typeof answer === 'number' ? answer : null;
    const wanted = [host.names?.[hostSlug], slugName(hostSlug)].filter(Boolean);
    if (!appid) {
      let items = [];
      for (const term of wanted) {
        items = await search(term);
        await sleep(600);
        const hit = items.find((i) => wanted.some((w) => clean(i.name) === clean(w)));
        if (hit) { appid = hit.id; break; }
        if (items.length) break;
      }
      if (!appid) {
        (items.length ? report.doubtful : report.missing).push(items.length
          ? `${hostSlug}  (searched: ${wanted.join(' / ')})  Steam offered: ${items.slice(0, 4).map((i) => `${i.name} [${i.id}]`).join(' | ')}`
          : `${hostSlug}  (searched: ${wanted.join(' / ')})  Steam offered nothing`);
        continue;
      }
    }
    const data = await details(appid);
    await sleep(600);
    const verdict = classify(data);
    if (!verdict.ok) { report.skipped.push(`${hostSlug} (Steam ${appid}${data?.name ? `, ${titleOf(data.name)}` : ''}): ${verdict.reason}`); continue; }
    if (typeof answer === 'number' && !wanted.some((w) => clean(w) === clean(data.name))) report.check.push(`${hostSlug}: your number ${appid} is "${titleOf(data.name)}": make sure it is the same game`);
    if (!data.header_image) { report.missing.push(`${hostSlug} (Steam ${appid}, ${titleOf(data.name)}): Steam gave no header picture`); continue; }
    autos.push(buildEntry({ hostSlug, data, hostKey: host.host, pathTemplate: host.pathTemplate, checkedOn: today }));
  } catch (e) {
    report.missing.push(`${hostSlug}: ${e.message}`);
  }
}

// ---- 4. write ---------------------------------------------------------------------------------------------------------------
const games = mergeGames(gamesFile.games, autos);
report.added = games.filter((g) => g.auto).map((g) => g.title);
const out = [];
const section = (title, rows) => { out.push(`## ${title}: ${rows.length}`, ...rows.map((r) => `- ${r}`), ''); };
out.push(`# Co-op games build, ${today}`, '', `Host list: ${host.games.length} games orderable, ${(host.horizon ?? []).length} on the horizon (not used). Hand-made: ${games.filter((g) => !g.auto).length}. Made by the program: ${report.added.length}.`, '');
section('Needs your answer in data/coop-steam-ids.json (Steam number or skip)', report.doubtful);
section('Not found on Steam', report.missing);
section('Check', report.check);
section('News about the host list', report.news);
section('Left out (the reason is Steam\'s own answer)', report.skipped);
section('Made by the program', report.added);
const text = out.join('\n');
console.log(text.split('\n').slice(0, 60).join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
if (dryRun) { console.log('\nDry run: nothing written.'); process.exit(0); }
await writeFile(new URL('coop-games.json', root), JSON.stringify({ ...gamesFile, games }, null, 2) + '\n');
await writeFile(new URL('coop-host-games.json', root), JSON.stringify(host, null, 2) + '\n');
await writeFile(new URL('coop-build-report.md', root), text);
console.log(`\nWritten: data/coop-games.json (${games.length} games), data/coop-host-games.json, data/coop-build-report.md`);
