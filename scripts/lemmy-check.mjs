// Checks the Lemmy account without posting anything, and (on request) sets up its profile.
//
//   npm run lemmy:check                    log in and look at every community of data/lemmy-accounts.json (also the switched-off ones)
//   npm run lemmy:profile                  the same, and then save the profile: display name, bio, BOT flag, avatar, banner
//   node scripts/lemmy-check.mjs --account lemmy-cozy
//   GitHub -> Actions -> "Post to Lemmy" -> Run workflow, mode "check" or "profile"
//
// The check says: which Lemmy version the server runs (and so which API is used), whether the login works, whether each community is found,
// how many subscribers it has, and whether only moderators may post there. It is the first thing to run after the account is created.
// The password comes from .env or from the GitHub Secret (LEMMY_PASSWORD) and is never printed.

import { lemmyAccounts, configProblems, handleOf, loadPassword, createClient, buildProfile, summary, finish, reasonOf, hintFor } from './lib/lemmy.mjs';

const args = process.argv.slice(2);
const only = args.includes('--account') ? args[args.indexOf('--account') + 1] : null;
const withProfile = args.includes('--profile');
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

  say(`Lemmy account "${id}" (${account.name}): ${handleOf(account)}`);
  const problems = configProblems(account);
  for (const p of problems) bad(`data/lemmy-accounts.json: ${p}.`);
  if (problems.length) return { ok, lines };

  const password = loadPassword(account.passwordEnv);
  if (!password) {
    bad(`no password (${account.passwordEnv}) in .env or in the environment. Put ${account.passwordEnv}=... in the local .env file, then run npm run lemmy:secret to send it to GitHub.`);
    return { ok, lines };
  }

  const client = createClient(account.instance);
  try {
    const found = await client.detect(account.apiVersion ?? null);
    say(`Server ${account.instance}: Lemmy ${found.version ?? '(version not shown)'}, the program speaks API ${found.api}.`);
    await client.login(account.username, password);
    say(`Login works as ${handleOf(account)}.`);
  } catch (e) {
    bad(`${account.instance}: ${describe(e)}`);
    return { ok, lines };
  }

  for (const c of account.communities ?? []) {
    const tag = `${c.community} [${(c.kinds ?? []).join(', ')}]${c.enabled === false ? ' (switched off)' : ''}`;
    try {
      const k = await client.community(c.community);
      const notes = [];
      if (k.subscribers !== null) notes.push(`${k.subscribers} subscribers`);
      if (k.restricted) notes.push('ONLY MODERATORS CAN POST here (the bot cannot)');
      if (k.nsfw) notes.push('marked NSFW');
      if (k.removed || k.deleted) notes.push('REMOVED or DELETED');
      say(`  ok   ${tag}: found, id ${k.id}${notes.length ? ', ' + notes.join(', ') : ''}`);
      if ((k.restricted || k.removed || k.deleted) && c.enabled !== false) bad(`${c.community} is switched on but cannot take posts. Switch it off in data/lemmy-accounts.json.`);
    } catch (e) {
      say(`  FAIL ${tag}: ${describe(e)}`);
      if (c.enabled !== false) ok = false;
    }
  }

  if (withProfile) {
    try {
      const profile = buildProfile(account);
      await client.saveSettings(profile);
      const person = await client.me();
      say(`Profile saved. The server now shows:`);
      const same = (k, got) => `${got === profile[k] ? 'ok  ' : 'NOT'} ${k}`;
      if (person) {
        say(`  ${same('display_name', person.display_name)}`);
        say(`  ${same('bio', person.bio)}`);
        say(`  ${same('bot_account', person.bot_account)}${profile.bot_account ? ' (the BOT badge)' : ''}`);
        if (profile.avatar) say(`  ${person.avatar ? 'ok  ' : 'NOT'} avatar${person.avatar ? '' : ': this server version did not take the picture by address, add it by hand in Settings'}`);
        if (profile.banner) say(`  ${person.banner ? 'ok  ' : 'NOT'} banner${person.banner ? '' : ': this server version did not take the picture by address, add it by hand in Settings'}`);
        if (person.display_name !== profile.display_name || person.bio !== profile.bio || person.bot_account !== profile.bot_account) bad('the server did not keep the profile text or the BOT flag. Open Settings of the account and look.');
      } else say('  (the server did not return the profile, so it could not be compared)');
    } catch (e) {
      bad(`profile: ${describe(e)}`);
    }
  }
  return { ok, lines };
}

async function main() {
  const accounts = lemmyAccounts(only).filter(({ account }) => account.enabled !== false);
  if (!accounts.length) {
    console.log('No enabled Lemmy accounts in data/lemmy-accounts.json: nothing to check.');
    summary('## Lemmy check\n\n**Skipped:** no enabled Lemmy accounts.\n');
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
    summary(`## Lemmy ${withProfile ? 'profile' : 'check'}: ${a.account.name} (${a.id})\n\n**${r.ok ? 'All good.' : 'There are problems.'}**\n\n\`\`\`\`text\n${r.lines.join('\n')}\n\`\`\`\`\n`);
    if (!r.ok) code = 1;
  }
  return code;
}

finish(await main());
