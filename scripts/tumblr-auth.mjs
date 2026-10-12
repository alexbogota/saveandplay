// Gets the Tumblr token and token secret once, and writes them into the local .env (never printed).
//
//   npm run tumblr:auth                    account "tumblr"
//   npm run tumblr:auth -- --account tumblr-cozy
//
// Before this: register an app at https://www.tumblr.com/oauth/apps. Its "Default callback URL" must be exactly  http://localhost:8765/callback
// (the "OAuth2 redirect URLs" field can be the same). Copy the "OAuth Consumer Key" and the "Secret Key" into the local .env as
// TUMBLR_CONSUMER_KEY=... and TUMBLR_CONSUMER_SECRET=...
// What it does: asks Tumblr for a temporary token, prints a web address (and tries to open it in the browser). You log in to the blog's account
// and press "Allow" (the only step a program cannot do), Tumblr sends the browser back to localhost, and this script exchanges that for the
// permanent token. The token does not expire, so this is done once per account. Then run npm run tumblr:secret.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { tumblrAccounts, loadCreds, secretNames, file, setEnvValue, oauthHeader, createClient, WWW_BASE, reasonOf, UA } from './lib/tumblr.mjs';

const args = process.argv.slice(2);
const id = args.includes('--account') ? args[args.indexOf('--account') + 1] : 'tumblr';
const PORT = Number(process.env.TUMBLR_AUTH_PORT) || 8765;
const WAIT_MS = Number(process.env.TUMBLR_AUTH_WAIT_MS) || 5 * 60 * 1000;
const CALLBACK = `http://localhost:${PORT}/callback`;

const [{ account }] = tumblrAccounts(id);
const names = secretNames(account);
const { creds, missing } = loadCreds(account);
if (!creds.consumerKey || !creds.consumerSecret) {
  console.error(`ERROR: ${[names.CONSUMER_KEY, names.CONSUMER_SECRET].filter((n) => missing.includes(n)).join(' and ')} not set in .env. Register the app at https://www.tumblr.com/oauth/apps (Default callback URL: ${CALLBACK}), copy the OAuth Consumer Key and the Secret Key into .env, and run this again.`);
  process.exit(1);
}

// One signed POST to a login page of Tumblr. The answer is a form-encoded text (oauth_token=...&oauth_token_secret=...).
async function oauthPost(path, { token = '', tokenSecret = '', extra = {} }) {
  const url = `${WWW_BASE()}${path}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { authorization: oauthHeader({ method: 'POST', url, consumerKey: creds.consumerKey, consumerSecret: creds.consumerSecret, token, tokenSecret, extra }), 'user-agent': UA, accept: '*/*' },
    signal: AbortSignal.timeout(20000),
  });
  const body = await r.text();
  const out = Object.fromEntries(new URLSearchParams(body));
  if (!r.ok || !out.oauth_token || !out.oauth_token_secret) throw new Error(`${path}: HTTP ${r.status}${r.ok ? ' (no token in the answer)' : ''}. Check the consumer key and secret, and that the Default callback URL of the app is ${CALLBACK}.`);
  return out;
}

function openInBrowser(url) {
  try {
    const [cmd, ...a] = process.platform === 'win32' ? ['rundll32', 'url.dll,FileProtocolHandler', url] : process.platform === 'darwin' ? ['open', url] : ['xdg-open', url];
    spawn(cmd, a, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    // the address is printed anyway
  }
}

// Waits for the browser to come back to localhost with ?oauth_token=...&oauth_verifier=...
function waitForCallback(expectedToken) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${PORT}`);
      if (u.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const verifier = u.searchParams.get('oauth_verifier');
      const ok = u.searchParams.get('oauth_token') === expectedToken && verifier;
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(ok ? '<h2>Done. You can close this tab and go back to the terminal.</h2>' : '<h2>Tumblr did not allow it. Go back to the terminal.</h2>');
      clearTimeout(timer);
      server.close();
      if (ok) resolve(verifier);
      else reject(new Error('Tumblr sent the browser back without permission (the Allow button was not pressed, or the token is not the one asked for).'));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`No answer from the browser in ${Math.round(WAIT_MS / 60000)} minutes. Run this again.`));
    }, WAIT_MS);
    server.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Cannot listen on port ${PORT} (${reasonOf(e)}). Close the program that uses it, or set TUMBLR_AUTH_PORT and the same port in the app's Default callback URL.`));
    });
    server.listen(PORT, '127.0.0.1');
  });
}

try {
  const temp = await oauthPost('/oauth/request_token', { extra: { oauth_callback: CALLBACK } });
  const address = `${WWW_BASE()}/oauth/authorize?oauth_token=${encodeURIComponent(temp.oauth_token)}`;
  console.log(`Open this address in the browser, log in as the account of the blog and press "Allow":\n\n  ${address}\n\n(waiting up to ${Math.round(WAIT_MS / 60000)} minutes)`);
  const waiting = waitForCallback(temp.oauth_token);
  openInBrowser(address);
  const verifier = await waiting;
  const perm = await oauthPost('/oauth/access_token', { token: temp.oauth_token, tokenSecret: temp.oauth_token_secret, extra: { oauth_verifier: verifier } });
  setEnvValue(file('.env'), names.TOKEN, perm.oauth_token);
  setEnvValue(file('.env'), names.TOKEN_SECRET, perm.oauth_token_secret);
  console.log(`Saved ${names.TOKEN} and ${names.TOKEN_SECRET} in .env (the values are not shown).`);
  try {
    const user = await createClient({ ...creds, token: perm.oauth_token, tokenSecret: perm.oauth_token_secret }).userInfo();
    console.log(`Login works as Tumblr user "${user.name}". Blogs: ${user.blogs.map((b) => b.name).join(', ') || '(none)'}.`);
    if (!user.blogs.some((b) => b.name.toLowerCase() === account.blog.toLowerCase())) console.log(`Note: "blog" in data/tumblr-accounts.json is "${account.blog}", it is not in this list. Change it to the right name.`);
  } catch (e) {
    console.log(`Saved, but the first request failed (${reasonOf(e)}). Run npm run tumblr:check.`);
  }
  console.log('Next: npm run tumblr:secret (sends the four secrets to GitHub).');
} catch (e) {
  console.error(`ERROR: ${reasonOf(e)}`);
  process.exit(1);
}
