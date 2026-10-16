// Looks for fresh Bluesky or Mastodon posts where a short helpful reply from our account would fit, and writes a SHORT list for Claude to answer.
// Nothing is posted, liked or followed. The settings are in data/comments-accounts.json.
//
//   npm run comments:find                      every enabled account
//   node scripts/comment-candidates.mjs --account prices                bluesky
//   node scripts/comment-candidates.mjs --account mastodon-prices       mastodon (no password: public hashtag timelines)
//   node scripts/comment-candidates.mjs --queries 6      more queries in this run
//
// Bluesky posts come from searches (groups) and from custom feeds ("feeds" in the settings file: somebody else's list of posts on a topic).
// Mastodon has no search by words, so a group there is a list of hashtags and the posts come from their timelines.
//
// Result: drafts/comments-<account>.md (the list, about 1-2k tokens), drafts/comments-<account>.json (the same with all fields) and
// drafts/comments-state-<account>.json (which queries are next, which posts are still fresh). Posts that Claude already showed are never listed again:
// Claude records them in drafts/comments-shown-<account>-*.json. Then tell Claude in the chat:
// "комментарии saveandplay", it reads only that .md file and writes the replies. The owner sends them by hand.
// It also runs by itself on GitHub every 6 hours (.github/workflows/comments.yml); the list then lives on the "comments" branch (scripts/comments-branch.sh).
// The login needs a Bluesky app password (Settings > Privacy and security > App passwords) in .env as BSKY_APP_PASSWORD.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { commentAccounts, configProblems, loadPassword, loadShown, createApi, createMastodonApi, evaluate, pickQueries, updatePool, renderReport, file } from './lib/comments.mjs';

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const only = arg('--account');
const queriesOverride = arg('--queries') ? Number(arg('--queries')) : null;

const readJson = (path, fallback) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
};
const hint = (e, platform = 'bluesky') => ({
  auth: platform === 'mastodon'
    ? 'The server does not let us read hashtag timelines without an account. Tell Claude: a read-only access token (tokenEnv in the settings) is needed.'
    : 'Check the handle and the app password (an app password, not the main password; make a new one in Bluesky Settings if unsure).',
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
  const mastodon = account.platform === 'mastodon';
  let api;
  if (mastodon) {
    // No password: the public hashtag timelines are read. A token (tokenEnv) is used only if the settings name one and it exists.
    api = createMastodonApi({ instance: account.instance, token: account.tokenEnv ? loadPassword(account.tokenEnv) : null });
  } else {
    const password = loadPassword(account.passwordEnv);
    if (!password) {
      say(`PROBLEM: no ${account.passwordEnv} in .env or in the environment. Make an app password in Bluesky (Settings > Privacy and security > App passwords), add the line ${account.passwordEnv}=... to the .env file in the project folder, then run again.`);
      return { ok: false, lines };
    }
    api = createApi();
    try {
      await api.login(account.loginAs ?? account.handle, password); // loginAs: a niche account (cozy, retro) searches under the login of the main account; it only reads
    } catch (e) {
      say(`PROBLEM: login as @${account.loginAs ?? account.handle} failed: ${e.message}. ${hint(e)}`.trim());
      return { ok: false, lines };
    }
  }

  let ownReplied = new Set();
  try { ownReplied = await api.ownReplied(account.handle); } catch (e) { say(`Note: could not read our own replies (${e.message}), so answered posts may show up again.`); }

  const shown = loadShown(id);
  const statePath = file('drafts', `comments-state-${id}.json`);
  const state = readJson(statePath, {});
  const now = Date.now();
  const since = new Date(now - account.maxAgeHours * 36e5).toISOString();
  const queries = pickQueries(account, state, queriesOverride ?? account.queriesPerRun);
  const feeds = (account.feeds ?? []).filter((f) => f.enabled !== false);
  const stats = {};
  state.sources ??= {}; // per search group and per feed: runs, posts seen, posts that passed the rules (to decide which sources are worth keeping)
  const count = (name, total, fit) => {
    const c = (state.sources[name] ??= { runs: 0, posts: 0, fit: 0 });
    c.runs++; c.posts += total; c.fit += fit;
    c.last = { posts: total, fit, at: new Date(now).toISOString() };
  };
  const found = new Map();
  let failed = 0;
  // Every post goes through the same rules, whether it came from a search or from a feed.
  const take = (posts, group, query) => {
    let kept = 0;
    for (const post of posts) {
      const r = evaluate(post, account, { now, group, query, ownReplied, shown });
      if (!r.keep) { stats[r.reason] = (stats[r.reason] ?? 0) + 1; continue; }
      if (!found.has(r.candidate.uri) || found.get(r.candidate.uri).score < r.candidate.score) found.set(r.candidate.uri, r.candidate);
      kept++;
    }
    return kept;
  };
  for (const q of queries) {
    try {
      const posts = await api.search(q.query, { since, limit: account.perQuery, lang: account.language, pages: account.pages });
      const fit = take(posts, q.group, q.query);
      count(q.group, posts.length, fit);
      say(`  ${q.group}: ${q.query}: ${posts.length} posts, ${fit} fit`);
    } catch (e) {
      failed++;
      say(`  ${q.group}: ${q.query}: FAILED (${e.message}). ${hint(e, account.platform)}`.trim());
    }
  }
  for (const f of feeds) {
    try {
      const posts = await api.feedPosts(f.url, { limit: f.limit ?? 100, pages: f.pages ?? 1 });
      const fit = take(posts, f.name, 'feed');
      count(f.name, posts.length, fit);
      say(`  feed ${f.name}: ${posts.length} posts, ${fit} fit`);
    } catch (e) {
      failed++;
      say(`  feed ${f.name}: FAILED (${e.message}). ${hint(e)}`.trim());
    }
  }
  if (failed === queries.length + feeds.length && failed) return { ok: false, lines };

  const { removed, ...picked } = updatePool(state, [...found.values()], account, now, ownReplied, shown);
  for (const [reason, count] of Object.entries(removed)) stats[`earlier finds: ${reason}`] = count;
  const report = renderReport(id, account, { searched: [...queries, ...feeds.map((f) => ({ group: f.name, query: 'feed' }))], stats, picked, now });
  mkdirSync(file('drafts'), { recursive: true });
  writeFileSync(file('drafts', `comments-${id}.md`), report);
  writeFileSync(file('drafts', `comments-${id}.json`), JSON.stringify({ madeAt: new Date(now).toISOString(), ...picked }, null, 2));
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  const totals = Object.entries(state.sources).map(([k, c]) => `${k}: ${c.fit} fit of ${c.posts} posts in ${c.runs} runs`);
  say(`Sources so far (fit = passed the rules): ${totals.join('; ')}.`);
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
