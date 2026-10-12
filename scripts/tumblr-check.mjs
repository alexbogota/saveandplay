// Checks the Tumblr account without posting anything.
//
//   npm run tumblr:check                   look at every account of data/tumblr-accounts.json
//   node scripts/tumblr-check.mjs --account tumblr-cozy
//   GitHub -> Actions -> "Post to Tumblr" -> Run workflow, mode "check"
//
// The check says: whether the four secrets are set (names only, never values), whether Tumblr accepts the login, which blogs the user has, and whether
// the blog named in data/tumblr-accounts.json is one of them. It is the first thing to run after npm run tumblr:secret.

import { tumblrAccounts, configProblems, handleOf, loadCreds, createClient, summary, finish, reasonOf, hintFor } from './lib/tumblr.mjs';

const args = process.argv.slice(2);
const only = args.includes('--account') ? args[args.indexOf('--account') + 1] : null;
const describe = (e) => `${reasonOf(e)}${hintFor(e?.code) ? ` ${hintFor(e.code)}` : ''}`;

async function checkAccount({ id, account }) {
  const lines = [];
  const say = (line) => {
    console.log(line);
    lines.push(line);
  };
  let ok = true;
  const bad = (line) => {
    ok = false;
    say(`PROBLEM: ${line}`);
  };

  say(`Tumblr account "${id}" (${account.name}): ${handleOf(account)}`);
  const problems = configProblems(account);
  for (const p of problems) bad(`data/tumblr-accounts.json: ${p}.`);
  if (problems.length) return { ok, lines };

  const { creds, missing } = loadCreds(account);
  if (missing.length) {
    bad(`not set: ${missing.join(', ')}. Put the consumer key and secret in the local .env file, run npm run tumblr:auth (it adds the token), then npm run tumblr:secret.`);
    return { ok, lines };
  }
  say('All four secrets are set.');

  try {
    const user = await createClient(creds).userInfo();
    say(`Login works as Tumblr user "${user.name ?? '?'}". Blogs of this user: ${user.blogs.map((b) => b.name).join(', ') || '(none)'}.`);
    const mine = user.blogs.find((b) => b.name.toLowerCase() === account.blog.toLowerCase());
    if (mine) say(`Blog "${account.blog}" is yours${mine.title ? ` (title: "${mine.title}")` : ''}. Posts go there.`);
    else bad(`the blog "${account.blog}" is not among the blogs of this user. Set "blog" in data/tumblr-accounts.json to one of: ${user.blogs.map((b) => b.name).join(', ') || '(none)'}.`);
  } catch (e) {
    bad(describe(e));
  }
  return { ok, lines };
}

async function main() {
  const accounts = tumblrAccounts(only).filter(({ account }) => account.enabled !== false);
  if (!accounts.length) {
    console.log('No enabled Tumblr accounts in data/tumblr-accounts.json: nothing to check.');
    summary('## Tumblr check\n\n**Skipped:** no enabled Tumblr accounts.\n');
    return 0;
  }
  let code = 0;
  for (const a of accounts) {
    let r;
    try {
      r = await checkAccount(a);
    } catch (e) {
      r = { ok: false, lines: [`PROBLEM: ${reasonOf(e)}`] };
      console.error(`ERROR (${a.id}): ${reasonOf(e)}`);
    }
    summary(`## Tumblr check: ${a.account.name} (${a.id})\n\n**${r.ok ? 'All good.' : 'There are problems.'}**\n\n\`\`\`\`text\n${r.lines.join('\n')}\n\`\`\`\`\n`);
    if (!r.ok) code = 1;
  }
  return code;
}

finish(await main());
