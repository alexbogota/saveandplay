// Sends the four Tumblr secrets from the local .env to GitHub Secrets, without ever showing them.
//
//   npm run tumblr:secret                       account "tumblr" (TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET, TUMBLR_TOKEN, TUMBLR_TOKEN_SECRET)
//   npm run tumblr:secret -- --account tumblr-cozy
//
// Before this: the .env file has the four lines (the consumer key and secret you copy from tumblr.com/oauth/apps, the token and token secret are written
// by npm run tumblr:auth). The .env file is in .gitignore, never committed.
// It runs `gh secret set <NAME>` and gives the value through the standard input, so it is not in the command line, not in the shell history
// and not on the screen. Needs the GitHub CLI (`gh`) logged in (`gh auth login`) and run inside the repository folder.

import { spawnSync } from 'node:child_process';
import { tumblrAccounts, loadCreds, secretNames, SECRET_PARTS } from './lib/tumblr.mjs';

const args = process.argv.slice(2);
const id = args.includes('--account') ? args[args.indexOf('--account') + 1] : 'tumblr';
const [{ account }] = tumblrAccounts(id);
const names = secretNames(account);
const { creds, missing } = loadCreds(account);
const values = { CONSUMER_KEY: creds.consumerKey, CONSUMER_SECRET: creds.consumerSecret, TOKEN: creds.token, TOKEN_SECRET: creds.tokenSecret };

if (missing.length) {
  console.error(`ERROR: not set in .env: ${missing.join(', ')}. Add the lines to the .env file in the project folder (npm run tumblr:auth writes the token ones), then run this again.`);
  process.exit(1);
}

const probe = spawnSync('gh', ['--version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  console.error(`The GitHub CLI (gh) was not found, so the secrets cannot be set from here.
Do it once by hand (the values are NOT shown by this script):
  1. Open the repository on github.com -> Settings -> Secrets and variables -> Actions -> New repository secret.
  2. Make four secrets named ${SECRET_PARTS.map((p) => names[p]).join(', ')}.
  3. For each one open the local .env file in a text editor and copy the part after the "=".`);
  process.exit(2);
}

let failed = false;
for (const part of SECRET_PARTS) {
  const value = values[part];
  const r = spawnSync('gh', ['secret', 'set', names[part]], { input: value, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (r.status !== 0) {
    // gh's own message is shown, the value never is
    console.error(`gh could not set ${names[part]}:\n${(r.stderr || r.stdout || '').replaceAll(value, '[hidden]').trim()}\nCheck: gh auth status, and that you are inside the repository folder.`);
    failed = true;
  } else console.log(`Secret ${names[part]} is set in GitHub (the value was not shown).`);
}
process.exit(failed ? 1 : 0);
