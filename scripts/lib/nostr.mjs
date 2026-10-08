// Shared code of the Nostr scripts (nostr-keygen, nostr-secret, nostr-profile, post-nostr, nostr-check).
// See PROJECT.md, section 11 ("Nostr"). Settings: data/nostr-accounts.json (profile, autopost, key name, hashtags), data/nostr-relays.json (relays),
// and the block with the same name in data/accounts.json (the deal rules of the daily brief: stores, minimum discount, subid, post rules).
//
// Rule for every function here: the private key (nsec) is never printed, never put in an error message and never returned as text.
// It is read from the environment (GitHub Secret) or from the local .env file, and used only to sign.
//
// For tests the root folder can be changed with NOSTR_ROOT (the folder that holds data/, public/, drafts/, .env).

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import { hexToBytes } from 'nostr-tools/utils';

export { finalizeEvent, getPublicKey, verifyEvent, nip19 };

export const ROOT = process.env.NOSTR_ROOT ? resolve(process.env.NOSTR_ROOT) : fileURLToPath(new URL('../../', import.meta.url));
export const file = (rel) => resolve(ROOT, rel);

export const DEFAULT_HASHTAGS = ['ad', 'pcgaming', 'gamedeals'];
const HOUR = 3600e3;

// ---------- files and settings ----------

export const readJson = (rel, fallback) => {
  const p = file(rel);
  if (!existsSync(p)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`File not found: ${rel}`);
  }
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read ${rel}: ${e.message}`);
  }
};

// Value of NAME in a .env file (KEY=value lines, optional quotes). Returns null if the file or the key is missing.
export function readEnvValue(envFile, name) {
  if (!existsSync(envFile)) return null;
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && m[1] === name) return m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return null;
}

// All Nostr accounts: { id, account } with defaults filled in. The settings of data/nostr-accounts.json are joined with the block of the
// same name in data/accounts.json (that block is what the daily brief reads to choose the deal and to make the link).
export function nostrAccounts(only = null) {
  const cfg = readJson('data/accounts.json');
  const nostr = readJson('data/nostr-accounts.json');
  const out = [];
  for (const [id, settings] of Object.entries(nostr.accounts ?? {})) {
    if (only && id !== only) continue;
    const brief = cfg.accounts?.[id];
    if (!brief) throw new Error(`"${id}" is in data/nostr-accounts.json but not in data/accounts.json (the daily brief takes its deal rules from there).`);
    out.push({ id, account: withNostrDefaults(id, { ...brief, ...settings }), links: cfg.links });
  }
  if (only && !out.length) throw new Error(`No Nostr account "${only}" in data/nostr-accounts.json.`);
  return out;
}

export function withNostrDefaults(id, a) {
  const secretEnv = a.secretEnv || (id === 'nostr' ? 'NOSTR_NSEC' : `NOSTR_NSEC_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`);
  return { autopost: false, maxPriceAgeHours: 48, maxBriefAgeHours: 12, timezone: 'America/Bogota', hashtags: DEFAULT_HASHTAGS, ...a, secretEnv };
}

export function loadRelayConfig() {
  const cfg = readJson('data/nostr-relays.json');
  const urls = (cfg.relays ?? []).filter((r) => r.enabled !== false).map((r) => r.url);
  if (!urls.length) throw new Error('data/nostr-relays.json has no enabled relays.');
  return { urls, minAccepted: cfg.minAccepted ?? 2, timeoutMs: cfg.timeoutMs ?? 10000, relays: cfg.relays };
}

// ---------- keys ----------

export function parseSecretKey(raw) {
  try {
    if (/^nsec1/i.test(raw)) {
      const d = nip19.decode(raw.toLowerCase());
      if (d.type === 'nsec') return d.data;
    } else if (/^[0-9a-f]{64}$/i.test(raw)) {
      return hexToBytes(raw.toLowerCase());
    }
  } catch {
    // falls through to the error below, which never contains the value
  }
  throw new Error('The private key is set but is not a valid nsec key (the value is not shown).');
}

// The private key of an account, or null if none is set. Environment first (GitHub Secret), then the local .env file.
export function loadSecretKey(secretEnv) {
  const raw = (process.env[secretEnv] || readEnvValue(file('.env'), secretEnv) || '').trim();
  return raw ? parseSecretKey(raw) : null;
}

export const npubOf = (sk) => nip19.npubEncode(getPublicKey(sk));
export const hexOf = (npub) => {
  const d = nip19.decode(npub);
  if (d.type !== 'npub') throw new Error('Not an npub.');
  return d.data;
};
export const isNpub = (s) => /^npub1[0-9a-z]{58}$/.test(String(s ?? ''));

// ---------- the note (kind 1): a template, no AI ----------

export const money = (n) => `$${Number(n).toFixed(2)}`;
export const stamp = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const mimeOf = (url) => {
  try {
    return MIME[new URL(url).pathname.split('.').pop().toLowerCase()] ?? null;
  } catch {
    return null;
  }
};

// The "why today" reasons come from the brief (c.whyToday, one clause each). The "deepest-discount rank 9 of 38" clause only helps when the rank is high, so it is shown only for the top 3.
export const whyLine = (c) => {
  const clauses = (c.whyToday ?? []).filter((w) => !/^deepest-discount rank/.test(w) || c.discountRank <= 3);
  return clauses.length ? `Why today: ${clauses.join('; ')}.` : null;
};

function check(c) {
  const bad = [];
  if (!c || typeof c !== 'object') throw new Error('The brief has no deal to post.');
  if (!c.title || typeof c.title !== 'string') bad.push('title');
  if (!c.store || typeof c.store !== 'string') bad.push('store');
  for (const k of ['price', 'was', 'discount']) if (!Number.isFinite(c[k])) bad.push(k);
  if (!c.priceCheckedAt || Number.isNaN(Date.parse(c.priceCheckedAt))) bad.push('priceCheckedAt');
  if (c.endsAt && Number.isNaN(Date.parse(c.endsAt))) bad.push('endsAt');
  if (!/^https:\/\/[^\s]+$/.test(c.link ?? '')) bad.push('link (needs a full https address)');
  if (c.cover && !/^https:\/\/[^\s]+$/.test(c.cover)) bad.push('cover (needs a full https address)');
  if (bad.length) throw new Error(`The first deal of the brief is not complete or not valid: ${bad.join(', ')}.`);
}

// Text and tags of the note from the first candidate of the brief. Only the numbers and dates of the brief, nothing invented, nothing rounded.
export function buildNote(c, account) {
  check(c);
  const lines = [`${c.title}: -${c.discount}% at ${c.store}`, `${money(c.price)} (was ${money(c.was)})`];
  lines.push(`Price checked ${stamp(c.priceCheckedAt)}.${c.endsAt ? ` Sale ends ${stamp(c.endsAt)}.` : ''}`);
  const why = whyLine(c);
  if (why) lines.push(why);
  lines.push('#ad');

  const blocks = [lines.join('\n')];
  if (c.cover) blocks.push(c.cover); // the picture on its own line, the link last
  blocks.push(c.link);
  const content = blocks.join('\n\n');

  const hashtags = [...new Set(['ad', ...(account.hashtags ?? DEFAULT_HASHTAGS)].map((h) => String(h).replace(/^#/, '').toLowerCase()))];
  const tags = hashtags.map((h) => ['t', h]);
  if (c.cover) {
    const imeta = ['imeta', `url ${c.cover}`];
    const mime = mimeOf(c.cover);
    if (mime) imeta.push(`m ${mime}`);
    imeta.push(`alt ${c.coverAlt || `Cover art for ${c.title}`}`); // every meaningful picture has an alt text
    tags.push(imeta);
  }
  if (!/(^|\s)#ad(\s|$)/.test(content)) throw new Error('The note has no #ad. It is not allowed to post without it.');
  return { content, tags };
}

export const signNote = ({ content, tags }, sk, now = Date.now()) => finalizeEvent({ kind: 1, created_at: Math.floor(now / 1000), tags, content }, sk);

// ---------- the profile (kind 0) and the NIP-05 file ----------

export function buildProfile(id, account) {
  const p = account.profile ?? {};
  const missing = ['about', 'website', 'picture', 'banner', 'nip05'].filter((k) => !p[k]);
  if (!account.name || missing.length) throw new Error(`Account "${id}" lacks ${!account.name ? 'name, ' : ''}profile.${missing.join(', profile.')} in data/nostr-accounts.json.`);
  for (const k of ['website', 'picture', 'banner']) if (!/^https:\/\//.test(p[k])) throw new Error(`profile.${k} of "${id}" must be a full https address.`);
  if (!/^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(p.nip05)) throw new Error(`profile.nip05 of "${id}" must look like name@domain.`);
  // "bot": true is the standard flag for automated accounts (NIP-24). PROJECT.md section 5 asks to say that the account is automated.
  return { name: account.name, display_name: account.name, about: p.about, website: p.website, picture: p.picture, banner: p.banner, nip05: p.nip05, bot: true };
}

export const nip05Parts = (nip05) => {
  const [name, domain] = nip05.split('@');
  return { name, domain };
};

export const nip05File = (names, relayMap) => ({ names, ...(relayMap && Object.keys(relayMap).length ? { relays: relayMap } : {}) });

// ---------- relays ----------
// A small relay client on the WebSocket built into Node 22 (the protocol part we need: send EVENT and wait for OK, ask with REQ until EOSE).
// nostr-tools has a relay client too, but in version 2.25.2 it falls into endless recursion on Node 22 when a relay refuses the connection,
// which a daily bot must survive. Keys, signing and address encoding still come from nostr-tools.

const reasonOfRaw = (e) => String(e?.message ?? e ?? 'unknown error').replace(/\s+/g, ' ').trim().slice(0, 160) || 'unknown error';
export const reasonOf = reasonOfRaw;

// Opens a WebSocket; rejects after timeoutMs. Note: never call close() inside an error handler (that loops in some Node versions).
export function openSocket(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket === 'undefined') return reject(new Error('this Node has no WebSocket (needs Node 22 or newer)'));
    let ws;
    let settled = false;
    const end = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      end(reject, new Error('connection timed out'));
      try {
        ws?.close();
      } catch {
        // ignore
      }
    }, timeoutMs);
    try {
      ws = new WebSocket(url);
    } catch (e) {
      return end(reject, new Error(`bad address: ${reasonOfRaw(e)}`));
    }
    ws.addEventListener('open', () => end(resolve, ws));
    ws.addEventListener('error', () => end(reject, new Error('connection failed')));
    ws.addEventListener('close', () => end(reject, new Error('connection closed')));
  });
}

const closeQuietly = (ws) => {
  try {
    ws?.close();
  } catch {
    // already closed
  }
};

// Sends the event to one relay and waits for its OK answer. Never throws: the result is { url, ok, ms, reason }.
export async function publishToRelay(url, event, timeoutMs) {
  const t0 = Date.now();
  let ws;
  try {
    ws = await openSocket(url, timeoutMs);
    const reason = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no answer (timeout)')), timeoutMs);
      ws.addEventListener('message', (m) => {
        let d;
        try {
          d = JSON.parse(String(m.data));
        } catch {
          return;
        }
        if (d[0] === 'OK' && d[1] === event.id) {
          clearTimeout(timer);
          if (d[2]) resolve(String(d[3] ?? ''));
          else reject(new Error(String(d[3] || 'rejected without a reason')));
        }
      });
      ws.addEventListener('close', () => {
        clearTimeout(timer);
        reject(new Error('connection closed before an answer'));
      });
      ws.send(JSON.stringify(['EVENT', event]));
    });
    return { url, ok: true, ms: Date.now() - t0, reason: reasonOfRaw(reason) === 'unknown error' ? '' : reasonOfRaw(reason) };
  } catch (e) {
    return { url, ok: false, ms: Date.now() - t0, reason: reasonOfRaw(e) };
  } finally {
    closeQuietly(ws);
  }
}

export const publishToAll = (event, urls, timeoutMs) => Promise.all(urls.map((u) => publishToRelay(u, event, timeoutMs)));

// Events that match a filter on one relay (only events with a valid signature); null if the relay could not be asked.
export async function queryRelay(url, filter, timeoutMs) {
  let ws;
  try {
    ws = await openSocket(url, timeoutMs);
    return await new Promise((resolve) => {
      const events = [];
      const sub = `q${Math.random().toString(36).slice(2, 10)}`;
      const timer = setTimeout(() => resolve(events), timeoutMs);
      const done = () => {
        clearTimeout(timer);
        resolve(events);
      };
      ws.addEventListener('message', (m) => {
        let d;
        try {
          d = JSON.parse(String(m.data));
        } catch {
          return;
        }
        if (d[1] !== sub) return;
        if (d[0] === 'EVENT' && d[2] && verifyEvent(d[2])) events.push(d[2]);
        else if (d[0] === 'EOSE' || d[0] === 'CLOSED') done();
      });
      ws.addEventListener('close', done);
      ws.send(JSON.stringify(['REQ', sub, filter]));
    });
  } catch {
    return null;
  } finally {
    closeQuietly(ws);
  }
}

// ---------- the end of a script ----------
// Not process.exit(code): on Windows, Node can crash (exit code 0xC0000409) when it exits while a relay WebSocket is still closing.
// The exit code is set and Node ends by itself once every socket and timer is done. The unref'd timer is only a safety net in case
// a socket never closes; it does not keep Node running by itself.
export function finish(code, graceMs = 15000) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), graceMs).unref();
}

// ---------- output ----------

export const summary = (md) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.endsWith('\n') ? md : md + '\n');
};
export const relayTable = (results) =>
  ['| Relay | Result | Time | Answer |', '|---|---|---|---|', ...results.map((r) => `| ${r.url} | ${r.ok ? 'accepted' : 'NOT accepted'} | ${r.ms} ms | ${r.reason || ''} |`)].join('\n');

export const hoursSince = (t, now = Date.now()) => (now - Date.parse(t)) / HOUR;
