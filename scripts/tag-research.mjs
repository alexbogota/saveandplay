// Tag research: how much are our hashtags used on Mastodon? Reads the OPEN statistics of a Mastodon server (public API, no key, no login):
//   GET https://<server>/api/v1/tags/<tag>   ->  the use of the tag in the last 7 days, day by day.
//
//   npm run tags:research                    all tags of data/accounts.json  ->  drafts/tag-research.md (and printed)
//   npm run tags:research -- --games         also the game tags of the current deals (data/deals.json), one request each
//   npm run tags:research -- --instance mastodon.online     another server (or set TAGS_INSTANCE)
//
// What the numbers are: what THAT server has seen (its own users and the accounts they follow), not the whole fediverse; every server counts a bit
// differently. Today is left out because it is not over. Nothing is guessed: a tag the server could not answer for shows "no data" and the reason.
// Bluesky has no public statistics of tags (its search shows posts, not counts), so nothing is researched or invented for it.
// Good-citizen rules: an honest User-Agent, one request at a time with a pause, a stop when the server says "too many requests".

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { collectTags, gameTagsOf, summarizeHistory } from './lib/tag-stats.mjs';

const UA = 'SaveAndPlay-tags/1.0 (+https://saveandplay.com)';
const PAUSE_MS = Number(process.env.TAGS_PAUSE_MS ?? 600);
const TIMEOUT_MS = 15000;
const args = process.argv.slice(2);
const instance = (args.includes('--instance') ? args[args.indexOf('--instance') + 1] : process.env.TAGS_INSTANCE) || 'mastodon.social';
const withGames = args.includes('--games');
const root = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = async (rel) => JSON.parse(await readFile(root(rel), 'utf8'));

async function fetchTag(tag) {
  try {
    const res = await fetch(`https://${instance}/api/v1/tags/${encodeURIComponent(tag)}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 429) return { stop: true, error: 'the server says too many requests (HTTP 429)' };
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = await res.json();
    return { history: body.history };
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? 'no answer in 15 s' : e.message };
  }
}

const row = (t, r, summary) => {
  const used = t.where.length > 3 ? `${t.where.slice(0, 3).join('; ')}; +${t.where.length - 3}` : t.where.join('; ');
  if (r.error) return `| #${t.tag} | ${used} | no data: ${r.error} | | | |`;
  if (!summary) return `| #${t.tag} | ${used} | no data: the answer has no history | | | |`;
  if (!summary.lastDay) return `| #${t.tag} | ${used} | 0 | 0 | | |`;
  return `| #${t.tag} | ${used} | ${summary.uses} | ${summary.avgUses} | ${summary.lastDay.uses} (${summary.lastDay.accounts} accounts, ${summary.lastDay.date}) | ${summary.maxAccounts} |`;
};

async function research(list, nowMs) {
  const lines = [];
  let ok = 0;
  let stopped = null;
  for (const [i, t] of list.entries()) {
    if (stopped) {
      lines.push(row(t, { error: `not asked: ${stopped}` }, null));
      continue;
    }
    if (i) await sleep(PAUSE_MS);
    const r = await fetchTag(t.tag);
    if (r.stop) stopped = r.error;
    const summary = r.error ? null : summarizeHistory(r.history, nowMs);
    if (!r.error && summary) ok++;
    lines.push(row(t, r, summary));
    console.log(`${String(i + 1).padStart(2)}/${list.length} #${t.tag.padEnd(24)} ${r.error ? 'no data: ' + r.error : summary ? `${summary.uses} uses in ${summary.days} days` : 'no history'}`);
  }
  return { lines, ok };
}

const header = '| Tag | Used in our settings | Uses, last full days | Per day | Last full day | Most accounts in a day |\n|---|---|---|---|---|---|';

async function main() {
  const accounts = (await readJson('../data/accounts.json')).accounts;
  const now = Date.now();
  const fixed = collectTags(accounts);
  if (!fixed.length) throw new Error('No tags in data/accounts.json (channels have no baseTags).');
  console.log(`Server: ${instance}. ${fixed.length} tags from data/accounts.json${withGames ? ' and the game tags of the current deals' : ''}.`);
  const main = await research(fixed, now);
  let games = null;
  if (withGames) {
    const deals = await readJson('../data/deals.json');
    const known = new Set(fixed.map((t) => t.tag.toLowerCase()));
    const list = gameTagsOf(deals).filter((t) => !known.has(t.tag.toLowerCase()));
    await sleep(PAUSE_MS);
    games = await research(list, now);
  }

  const day = new Date(now).toISOString().slice(0, 10);
  const md = [
    `# Tag research, ${day}`,
    '',
    `Source: the open statistics of the Mastodon server **${instance}** (\`/api/v1/tags/<tag>\`, public, no key). Made by \`npm run tags:research\`, at ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
    '',
    '- The numbers are what this one server has seen (its own users and the accounts they follow), not the whole fediverse. Another server gives other numbers.',
    '- "Uses, last full days" is the sum over the days the server returned, today left out (it is not over). "Per day" is that sum divided by the number of days. "Last full day" is yesterday.',
    '- "no data" means the server did not answer for that tag; the reason is written. Nothing is estimated.',
    '- **Bluesky:** it has no public statistics of tags, so nothing is researched or invented for it. The same tags are used there, but we have no numbers.',
    '- The tag of a game is made from the title of each game, so it is not in the main table; run with `--games` to look at the game tags of the current deals.',
    '',
    '## Tags of data/accounts.json',
    '',
    header,
    ...main.lines,
    ...(games ? ['', '## Game tags of the current deals (made from the titles)', '', header, ...games.lines] : []),
    '',
  ].join('\n');
  await mkdir(root('../drafts/'), { recursive: true });
  await writeFile(root('../drafts/tag-research.md'), md);
  console.log(`\nWritten: drafts/tag-research.md (${main.ok} of ${fixed.length} tags answered)`);
  if (!main.ok) process.exitCode = 1;
}

await main();
