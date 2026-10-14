// Sends the Bluesky app password from the local .env to the GitHub Secret, without ever showing it.
//
//   npm run comments:secret                       account "prices" (secret BSKY_APP_PASSWORD)
//   npm run comments:secret -- --account NAME
//
// Before this: the line  BSKY_APP_PASSWORD=the app password of the Bluesky account  must be in the local .env file (it is in .gitignore, never committed).
// It runs `gh secret set <NAME>` and gives the password through the standard input, so it is not in the command line, not in the shell history
// and not on the screen. Needs the GitHub CLI (`gh`) logged in (`gh auth login`) and run inside the repository folder.

import { spawnSync } from 'node:child_process';
import { file, commentAccounts, readEnvValue, loadPassword } from './lib/comments.mjs';

const args = process.argv.slice(2);
const id = args.includes('--account') ? args[args.indexOf('--account') + 1] : 'prices';
const [{ account }] = commentAccounts(id);
const name = account.platform === 'mastodon' ? account.tokenEnv : account.passwordEnv;

if (!name) {
  console.log(`The account "${id}" (${account.platform}) needs no secret: it reads public data only. Nothing to do.`);
  process.exit(0);
}
if (!loadPassword(name)) {
  console.error(`ERROR: no ${name} in .env. Add the line ${name}=the app password of the Bluesky account to the .env file in the project folder, then run this again.`);
  process.exit(1);
}
const value = (process.env[name] || readEnvValue(file('.env'), name)).trim();

const probe = spawnSync('gh', ['--version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  console.error(`The GitHub CLI (gh) was not found, so the secret cannot be set from here.
Do it once by hand (the password is NOT shown by this script):
  1. Open the repository on github.com -> Settings -> Secrets and variables -> Actions -> New repository secret.
  2. Name: ${name}
  3. Secret: open the local .env file in a text editor and copy the part after "${name}=".`);
  process.exit(2);
}

const r = spawnSync('gh', ['secret', 'set', name], { input: value, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
if (r.status !== 0) {
  // gh's own message is shown, the password never is
  console.error(`gh could not set the secret:\n${(r.stderr || r.stdout || '').replaceAll(value, '[password hidden]').trim()}\nCheck: gh auth status, and that you are inside the repository folder.`);
  process.exit(1);
}
console.log(`Secret ${name} is set in GitHub (the value was not shown).`);
