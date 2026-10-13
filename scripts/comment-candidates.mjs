// Looks for fresh Bluesky posts where a short helpful reply from our account would fit, and writes a SHORT list for Claude to answer.
// Nothing is posted, liked or followed. The settings are in data/comments-accounts.json.
//
//   npm run comments:find                      every enabled account
//   node scripts/comment-candidates.mjs --account prices
//   node scripts/comment-candidates.mjs --queries 6      more queries in this run
//
// Result: drafts/comments-<account>.md (the list, about 1-2k tokens), drafts/comments-<account>.json (the same with all fields) and
// drafts/comments-state-<account>.json (which queries are next, which posts are still fresh). Posts that Claude already showed are never listed again:
// Claude records them in drafts/comments-shown-<account>-*.json. Then tell Claude in the chat:
// "комментарии saveandplay", it reads only that .md file and writes the replies. The owner sends them by hand.
// The login needs a Bluesky app password (Settings > Privacy and security > App passwords) in .env as BSKY_APP_PASSWORD.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { commentAccounts, configProblems, loadPassword, loadShown, createApi, evaluate, pickQueries, updatePool, renderReport, file } from './lib/comments.mjs';

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const only = arg('--account');
const queriesOverride = arg('--queries') ? Number(arg('--queries')) : null;

const readJson = (path, fallback) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
};
const hint = (e) => ({
  auth: 'Check the handle and the app password (an app password, not the main password; make a new one in Bluesky Settings if unsure).',
  network: 'Check the internet connection, then run again.',
}[e?.code] ?? '');

async function runAccount({ id, account }) {
  const lines = [];
  const say = (l) => { console.log(l); lines.push(l); };
  const problems = configProblems(account);
  if (problems.length) {
    for (const p of problems) say(`PROBLEM: data/comments-accounts.json: ${p}.`);
    return { ok: false, lines };
  }
  const password = loadPassword(account.passwordEnv);
  if (!password) {
    say(`PROBLEM: no ${account.passwordEnv} in .env or in the environment. Make an app password in Bluesky (Settings > Privacy and security > App passwords), add the line ${account.passwordEnv}=... to the .env file in the project folder, then run again.`);
    return { ok: false, lines };
  }

  const api = createApi();
  try {
    await api.login(account.handle, password);
  } catch (e) {
    say(`PROBLEM: login as @${account.handle} failed: ${e.message}. ${hint(e)}`.trim());
    return { ok: false, lines };
  }

  let ownReplied = new Set();
  try { ownReplied = await api.ownReplied(account.handle); } catch (e) { say(`Note: could not read our own replies (${e.message}), so answered posts may show up again.`); }

  const shown = loadShown(id);
  const statePath = file('drafts', `comments-state-${id}.json`);
  const state = readJson(statePath, {});
  const now = Date.now();
  const since = new Date(now - account.maxAgeHours * 36e5).toISOString();
  const queries = pickQueries(account, state, queriesOverride ?? account.queriesPerRun);
  const stats = {};
  const found = new Map();
  let failed = 0;
  for (const q of queries) {
    try {
      const posts = await api.search(q.query, { since, limit: account.perQuery, lang: account.language });
      let kept = 0;
      for (const post of posts) {
        const r = evaluate(post, account, { now, group: q.group, query: q.query, ownReplied, shown });
        if (!r.keep) { stats[r.reason] = (stats[r.reason] ?? 0) + 1; continue; }
        if (!found.has(r.candidate.uri) || found.get(r.candidate.uri).score < r.candidate.score) found.set(r.candidate.uri, r.candidate);
        kept++;
      }
      say(`  ${q.group}: ${q.query}: ${posts.length} posts, ${kept} fit`);
    } catch (e) {
      failed++;
      say(`  ${q.group}: ${q.query}: FAILED (${e.message}). ${hint(e)}`.trim());
    }
  }
  if (failed === queries.length && queries.length) return { ok: false, lines };

  const picked = updatePool(state, [...found.values()], account, now, ownReplied, shown);
  const report = renderReport(id, account, { searched: queries, stats, picked, now });
  mkdirSync(file('drafts'), { recursive: true });
  writeFileSync(file('drafts', `comments-${id}.md`), report);
  writeFileSync(file('drafts', `comments-${id}.json`), JSON.stringify(picked, null, 2));
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  say(`Saved drafts/comments-${id}.md: ${picked.normal.length} posts${picked.heated.length ? ` + ${picked.heated.length} heated` : ''}.`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Comment candidates: ${id}\n\n\`\`\`\`text\n${report}\`\`\`\`\n`);
  return { ok: true, lines };
}

async function main() {
  const accounts = commentAccounts(only).filter(({ account }) => account.enabled !== false);
  if (!accounts.length) {
    console.log('No enabled accounts in data/comments-accounts.json: nothing to do.');
    return 0;
  }
  let code = 0;
  for (const a of accounts) {
    console.log(`Comment search for "${a.id}" (@${a.account.handle})`);
    try {
      if (!(await runAccount(a)).ok) code = 1;
    } catch (e) {
      console.error(`ERROR (${a.id}): ${e.message}`);
      code = 1;
    }
  }
  return code;
}

process.exitCode = await main();
setTimeout(() => process.exit(process.exitCode), 3000).unref();
