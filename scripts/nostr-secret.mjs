// Sends the private key from the local .env to the GitHub Secret, without ever showing it.
//
//   npm run nostr:secret                       account "nostr" (secret NOSTR_NSEC)
//   npm run nostr:secret -- --account nostr-cozy
//
// It runs `gh secret set <NAME>` and gives the key through the standard input, so the key is not in the command line,
// not in the shell history and not on the screen. Needs the GitHub CLI (`gh`) logged in (`gh auth login`) and run inside the repository folder.

import { spawnSync } from 'node:child_process';
import { file, nostrAccounts, readEnvValue, loadSecretKey } from './lib/nostr.mjs';

const args = process.argv.slice(2);
const id = args.includes('--account') ? args[args.indexOf('--account') + 1] : 'nostr';
const [{ account }] = nostrAccounts(id);
const name = account.secretEnv;

let ok = false;
try {
  ok = Boolean(loadSecretKey(name)); // checks that a valid key is there; the value stays inside
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}
if (!ok) {
  console.error(`ERROR: no ${name} in .env. Run first: npm run nostr:keygen${id === 'nostr' ? '' : ` -- --account ${id}`}`);
  process.exit(1);
}
const value = (process.env[name] || readEnvValue(file('.env'), name)).trim();

const probe = spawnSync('gh', ['--version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  console.error(`The GitHub CLI (gh) was not found, so the secret cannot be set from here.
Do it once by hand (the key is NOT shown by this script):
  1. Open the repository on github.com -> Settings -> Secrets and variables -> Actions -> New repository secret.
  2. Name: ${name}
  3. Secret: open the local .env file in a text editor and copy the part after "${name}=".`);
  process.exit(2);
}

const r = spawnSync('gh', ['secret', 'set', name], { input: value, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
if (r.status !== 0) {
  // gh's own message is shown, the key never is
  console.error(`gh could not set the secret:\n${(r.stderr || r.stdout || '').replaceAll(value, '[key hidden]').trim()}\nCheck: gh auth status, and that you are inside the repository folder.`);
  process.exit(1);
}
console.log(`Secret ${name} is set in GitHub (the value was not shown).`);
