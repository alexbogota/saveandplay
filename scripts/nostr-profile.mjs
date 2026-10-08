// Publishes (or updates) the profile of a Nostr account: name, about, website, picture, banner and the NIP-05 address (kind 0).
// A profile is a "replaceable" event: running this again simply replaces the old profile on the relays.
//
//   npm run nostr:profile                  publish the profile of account "nostr" (the key comes from .env or from the GitHub Secret)
//   npm run nostr:profile -- --dry-run     only show the profile, publish nothing (no key needed)
//   npm run nostr:profile -- --account nostr-cozy
//   GitHub -> Actions -> "Post to Nostr" -> Run workflow, mode "profile"
//
// The profile text, pictures and NIP-05 address are in data/nostr-accounts.json (block "profile" of the account). Relays: data/nostr-relays.json.

import { readFileSync, existsSync } from 'node:fs';
import { file, nostrAccounts, loadRelayConfig, loadSecretKey, npubOf, getPublicKey, buildProfile, nip05Parts, publishToAll, relayTable, summary, finalizeEvent, verifyEvent, finish } from './lib/nostr.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const only = args.includes('--account') ? args[args.indexOf('--account') + 1] : null;
let exitCode = 0;

for (const { id, account } of nostrAccounts(only)) {
  const profile = buildProfile(id, account);
  const sk = loadSecretKey(account.secretEnv);
  const pk = sk ? getPublicKey(sk) : null;
  const npub = sk ? npubOf(sk) : /^npub1/.test(account.handle) ? account.handle : '(not created yet: run npm run nostr:keygen)';

  // The NIP-05 file must name THIS key, otherwise the "verified" mark would be false.
  const { name } = nip05Parts(profile.nip05);
  const nipPath = file('public/.well-known/nostr.json');
  let nipNote = 'public/.well-known/nostr.json is missing (npm run nostr:keygen makes it).';
  let nipOk = false;
  if (existsSync(nipPath)) {
    try {
      const served = JSON.parse(readFileSync(nipPath, 'utf8')).names?.[name];
      nipOk = Boolean(pk) && served === pk;
      nipNote = nipOk ? `public/.well-known/nostr.json names "${name}" = this key.` : served ? `public/.well-known/nostr.json names "${name}" but NOT this key.` : `public/.well-known/nostr.json has no name "${name}".`;
    } catch {
      nipNote = 'public/.well-known/nostr.json is not valid JSON.';
    }
  }

  const content = JSON.stringify(profile);
  let md = `## Nostr profile "${id}"\n\n- npub: \`${npub}\`\n- NIP-05: ${profile.nip05} (${nipNote})\n\n\`\`\`json\n${JSON.stringify(profile, null, 2)}\n\`\`\`\n`;
  console.log(`Profile of "${id}" (${npub}):\n${JSON.stringify(profile, null, 2)}\n${nipNote}`);

  if (dryRun) {
    console.log('Dry run: nothing was published.');
    summary(md + '\nDry run: nothing was published.\n');
    continue;
  }
  if (!sk) {
    console.error(`ERROR: no private key (${account.secretEnv}). Run npm run nostr:keygen first, and npm run nostr:secret to send the key to GitHub.`);
    summary(md + `\nNo private key (${account.secretEnv}): nothing was published.\n`);
    exitCode = 1;
    continue;
  }
  if (!nipOk) {
    console.error(`ERROR: ${nipNote} Fix it first (npm run nostr:keygen writes the file), otherwise the NIP-05 mark would be false.`);
    summary(md + `\nNot published: ${nipNote}\n`);
    exitCode = 1;
    continue;
  }

  const event = finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content }, sk);
  if (!verifyEvent(event)) throw new Error('The signed profile does not verify. Not published.');
  const relays = loadRelayConfig();
  const results = await publishToAll(event, relays.urls, relays.timeoutMs);
  const accepted = results.filter((r) => r.ok);
  console.log(`\nRelays: ${accepted.length} of ${results.length} accepted the profile (needed ${relays.minAccepted}).`);
  for (const r of results) console.log(`  ${r.ok ? 'accepted ' : 'REJECTED '} ${r.url} (${r.ms} ms)${r.reason ? ' - ' + r.reason : ''}`);
  console.log(`Profile page: https://njump.me/${npub}`);
  md += `\n${relayTable(results)}\n\nProfile page: https://njump.me/${npub}\n\nEvent id: \`${event.id}\`\n`;
  md += accepted.length >= relays.minAccepted ? '\nProfile published.\n' : `\n**Only ${accepted.length} relay(s) accepted the profile, ${relays.minAccepted} needed.** Check data/nostr-relays.json.\n`;
  summary(md);
  if (accepted.length < relays.minAccepted) exitCode = 1;
}
finish(exitCode);
