// Checks what cannot be checked from the code alone: the NIP-05 address on the live site and the relays.
//
//   node scripts/nostr-check.mjs
//   GitHub -> Actions -> "Post to Nostr" -> Run workflow, mode "check"
//
// 1. NIP-05: https://<domain>/.well-known/nostr.json?name=<name> must answer 200 WITHOUT a redirect, with the header
//    Access-Control-Allow-Origin: * (browsers and web clients need it), and name the right key.
// 2. Relays (data/nostr-relays.json): does the WebSocket open, and what does the relay say about itself (NIP-11): does it want payment,
//    a login (NIP-42) or restrict writing? Whether a relay really ACCEPTS our notes is only proven by a real write: mode "profile" and every post show it.
//
// Exit code 1 if the NIP-05 address is wrong or fewer relays than "minAccepted" look usable.

import { readFileSync, existsSync } from 'node:fs';
import { file, nostrAccounts, loadRelayConfig, loadSecretKey, getPublicKey, nip05Parts, summary, reasonOf, openSocket, finish } from './lib/nostr.mjs';

const args = process.argv.slice(2);
const only = args.includes('--account') ? args[args.indexOf('--account') + 1] : null;
const TIMEOUT = Number(process.env.NOSTR_CHECK_TIMEOUT_MS) || 10000;
let problems = 0;
let md = '## Nostr check\n\n';
const say = (line, bad = false) => {
  console.log(line);
  md += `- ${bad ? '**PROBLEM** ' : ''}${line}\n`;
  if (bad) problems++;
};

const timed = (url, opts = {}) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeout ?? TIMEOUT);
  return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
};

// ---- 1. NIP-05 ----
for (const { id, account } of nostrAccounts(only)) {
  const { name, domain } = nip05Parts(account.profile.nip05);
  const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`;
  const sk = loadSecretKey(account.secretEnv);
  let expected = sk ? getPublicKey(sk) : null;
  if (!expected && existsSync(file('public/.well-known/nostr.json'))) expected = JSON.parse(readFileSync(file('public/.well-known/nostr.json'), 'utf8')).names?.[name] ?? null;
  console.log(`\nNIP-05 of "${id}": ${account.profile.nip05}\n  ${url}`);
  try {
    const r = await timed(url, { redirect: 'manual', headers: { accept: 'application/json' } });
    if (r.status !== 200) say(`${account.profile.nip05}: the address answers ${r.status}${r.status >= 300 && r.status < 400 ? ` (a redirect to ${r.headers.get('location')}: NIP-05 forbids redirects)` : ''}. Expected 200. Is the site deployed with public/.well-known/nostr.json?`, true);
    else {
      const cors = r.headers.get('access-control-allow-origin');
      const body = await r.json().catch(() => null);
      const served = body?.names?.[name];
      say(`${account.profile.nip05}: 200 without redirect, content-type ${r.headers.get('content-type')}`);
      if (cors === '*') say('Access-Control-Allow-Origin: * is present');
      else say(`Access-Control-Allow-Origin is ${cors ? `"${cors}"` : 'missing'}, it must be *. public/.well-known/.htaccess sets it, but the host must allow it (mod_headers).`, true);
      if (!served) say(`the file has no name "${name}"`, true);
      else if (expected && served !== expected) say(`the file names ${served} for "${name}", but the account's key is ${expected}`, true);
      else say(`"${name}" = ${served}${expected ? ' (matches the account key)' : ' (no key here to compare with)'}`);
    }
  } catch (e) {
    say(`${account.profile.nip05}: cannot open ${url}: ${reasonOf(e)}`, true);
  }
}

// ---- 1b. Collateral check: the other file in .well-known (atproto-did = the Bluesky handle @saveandplay.com) must still be served. ----
// The .htaccess for NIP-05 sits in the same folder; if the host reacted badly to it, this is where it would show.
const atproto = file('public/.well-known/atproto-did');
const siteHost = nostrAccounts(only)[0]?.links?.site;
if (existsSync(atproto) && siteHost) {
  const url = `${siteHost.replace(/\/$/, '')}/.well-known/atproto-did`;
  try {
    const r = await timed(url, { redirect: 'manual' });
    const live = (await r.text()).trim();
    const want = readFileSync(atproto, 'utf8').trim();
    if (r.status === 200 && live === want) say(`${url}: still served (the Bluesky handle is fine)`);
    else say(`${url}: answers ${r.status}${r.status === 200 ? ' with different text' : ''}. The Bluesky handle may be broken: delete public/.well-known/.htaccess and deploy again.`, true);
  } catch (e) {
    say(`${url}: cannot open: ${reasonOf(e)}`, true);
  }
}

// ---- 2. relays ----
const cfg = loadRelayConfig();
console.log(`\nRelays (${cfg.urls.length}):`);
md += '\n| Relay | WebSocket | Says about itself (NIP-11) | Verdict |\n|---|---|---|---|\n';
let usable = 0;
for (const url of cfg.urls) {
  const http = url.replace(/^ws/, 'http');
  let info = null;
  try {
    const r = await timed(http, { headers: { accept: 'application/nostr+json' }, timeout: 8000 });
    info = r.ok ? await r.json().catch(() => null) : null;
  } catch {
    // no NIP-11 document: not a problem by itself
  }
  const lim = info?.limitation ?? {};
  const flags = [lim.payment_required && 'payment required', lim.auth_required && 'login (NIP-42) required', lim.restricted_writes && 'writes restricted', lim.min_pow_difficulty && `proof of work ${lim.min_pow_difficulty}`].filter(Boolean);
  let ws = 'FAILED';
  const t0 = Date.now();
  let sock;
  try {
    sock = await openSocket(url, TIMEOUT);
    ws = `open (${Date.now() - t0} ms)`;
  } catch (e) {
    ws = `FAILED: ${reasonOf(e)}`;
  } finally {
    try {
      sock?.close();
    } catch {
      // ignore
    }
  }
  const open = ws.startsWith('open');
  const verdict = !open ? 'not reachable' : flags.length ? `will probably refuse writes (${flags.join(', ')})` : 'usable';
  if (verdict === 'usable') usable++;
  console.log(`  ${url.padEnd(28)} ${ws.padEnd(18)} ${info?.software ? `${info.name ?? ''} ${info.software}` : 'no NIP-11 info'}${flags.length ? ' [' + flags.join(', ') + ']' : ''} -> ${verdict}`);
  md += `| ${url} | ${ws} | ${info ? [info.name, info.software, flags.join(', ')].filter(Boolean).join(', ') : 'no NIP-11 info'} | ${verdict} |\n`;
}
if (usable < cfg.minAccepted) {
  problems++;
  md += `\n**PROBLEM** only ${usable} relay(s) look usable, ${cfg.minAccepted} are needed. Edit data/nostr-relays.json.\n`;
  console.log(`PROBLEM: only ${usable} relay(s) look usable, ${cfg.minAccepted} needed.`);
} else {
  md += `\n${usable} of ${cfg.urls.length} relays look usable (${cfg.minAccepted} needed). A real write test is mode "profile".\n`;
}
summary(md);
finish(problems ? 1 : 0);
