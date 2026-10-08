// Makes the key pair of a Nostr account. Nostr has no registration: the account IS the pair of keys.
//
//   npm run nostr:keygen                      account "nostr" (data/nostr-accounts.json)
//   npm run nostr:keygen -- --account nostr-cozy
//   npm run nostr:keygen -- --force           make a NEW key even if one exists (the old one is kept in .env as a comment)
//
// What it does:
//   1. makes the keys and saves the PRIVATE key (nsec) only into the local .env file (it must be in .gitignore, this is checked);
//   2. prints only the PUBLIC key (npub) and the next steps. The private key is never printed;
//   3. writes the public key into public/.well-known/nostr.json (NIP-05: prices@saveandplay.com) and into data/accounts.json (the handle line of the brief block).
// The private key lives in the repository only as the GitHub Secret NOSTR_NSEC: send it there with `npm run nostr:secret`.
// There is NO account recovery in Nostr: a lost private key is a lost account. Copy it to the password manager once.

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateSecretKey } from 'nostr-tools/pure';
import { file, nostrAccounts, readEnvValue, getPublicKey, nip19, nip05Parts, nip05File, readJson } from './lib/nostr.mjs';

const args = process.argv.slice(2);
const argValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const force = args.includes('--force');
const id = argValue('--account') ?? 'nostr';

function fail(msg) {
  console.error(`\nERROR: ${msg}\n`);
  process.exit(1);
}

const [{ account }] = nostrAccounts(id);
const envName = account.secretEnv;
const envFile = file('.env');

// 1. Is .env ignored by git? If not, we would risk committing the private key. Stop before writing anything.
const ignore = existsSync(file('.gitignore')) ? readFileSync(file('.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim()) : [];
if (!ignore.some((l) => l === '.env' || l === '/.env' || l === '.env*' || l === '.env.*')) fail('.env is not listed in .gitignore. Add a line ".env" to .gitignore first, then run this again. Nothing was changed.');

// 2. Never replace an existing key by accident.
if ((process.env[envName] || readEnvValue(envFile, envName)) && !force) {
  fail(`A private key ${envName} already exists (in .env or in the environment). Nothing was changed.\nUse --force only if you really want a NEW account: the old key is then kept in .env as a comment, and the old account stays but you can no longer sign for it.`);
}

// 3. Check the public files BEFORE making a key, so a problem never leaves a half-done result.
const nip05Path = file('public/.well-known/nostr.json');
let current = { names: {} };
if (existsSync(nip05Path)) {
  try {
    current = JSON.parse(readFileSync(nip05Path, 'utf8'));
  } catch {
    fail('public/.well-known/nostr.json exists but is not valid JSON. Fix or delete that file and run this again. Nothing was changed.');
  }
}
const accPath = file('data/accounts.json');
const accText = readFileSync(accPath, 'utf8');
const start = accText.search(new RegExp(`"${id}"\\s*:\\s*\\{`));
const handleRe = /("handle"\s*:\s*")[^"]*(")/g;
handleRe.lastIndex = Math.max(start, 0);
const handleMatch = handleRe.exec(accText);
if (!handleMatch) fail(`Cannot find the "handle" line of "${id}" in data/accounts.json. Nothing was changed.`);

// 4. Make the keys.
const sk = generateSecretKey();
const nsec = nip19.nsecEncode(sk);
const pkHex = getPublicKey(sk);
const npub = nip19.npubEncode(pkHex);

// 5. Save the private key into .env: append, keep every other line as it is (same line endings).
let text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
const eol = text.includes('\r\n') ? '\r\n' : '\n';
if (force && text) {
  text = text
    .split(/\r?\n/)
    .map((l) => (new RegExp(`^\\s*(export\\s+)?${envName}\\s*=`).test(l) ? `#replaced ${new Date().toISOString().slice(0, 10)} ${l}` : l))
    .join(eol);
  writeFileSync(envFile, text);
}
const sep = text && !text.endsWith('\n') ? eol : '';
appendFileSync(envFile, `${sep}# Nostr private key of the account "${id}". NEVER commit or share it. Keep a copy in the password manager.${eol}${envName}=${nsec}${eol}`, { mode: 0o600 });

// 6. The public parts: NIP-05 file and the handle in data/accounts.json.
const { name } = nip05Parts(account.profile.nip05);
mkdirSync(dirname(nip05Path), { recursive: true });
const relayUrls = readJson('data/nostr-relays.json').relays.filter((r) => r.enabled !== false).map((r) => r.url);
const names = { ...(current.names ?? {}), [name]: pkHex };
const relayMap = { ...(current.relays ?? {}), [pkHex]: relayUrls };
writeFileSync(nip05Path, JSON.stringify(nip05File(names, relayMap), null, 2) + '\n');

// handle in data/accounts.json: replace only that one value, so the hand-made formatting of the file stays
writeFileSync(accPath, accText.slice(0, handleMatch.index) + handleMatch[1] + npub + handleMatch[2] + accText.slice(handleMatch.index + handleMatch[0].length));

console.log(`
Nostr account "${id}" is ready.

  Public key (npub):  ${npub}
  NIP-05 address:     ${account.profile.nip05}
  Profile page:       https://njump.me/${npub}

The private key was saved ONLY in .env (line ${envName}=...). It is not shown here on purpose.

Next steps:
  1. IMPORTANT, once: open .env, copy the value after "${envName}=" into your password manager.
     Nostr has no account recovery: a lost private key means a lost account.
  2. Send the key to GitHub Secrets (it is not shown while doing this):
         npm run nostr:secret${id === 'nostr' ? '' : ` -- --account ${id}`}
     Without the helper the same thing is:  gh secret set ${envName}   (it asks for the value: paste it from .env)
  3. Commit and push public/.well-known/nostr.json and data/accounts.json (both changed by this script). .env is ignored by git.
  4. GitHub -> Actions -> "Post to Nostr" -> Run workflow, mode "profile" (publishes the profile), then mode "dry-run".
`);
