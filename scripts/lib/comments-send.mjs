// Sending the replies the owner approved. Shared by the chat step (scripts/comments-drafts.mjs: drafts, the owner's "ок", "стоп"),
// the sender on GitHub (scripts/comments-send.mjs, workflow "Send comments") and the daily numbers (scripts/comments-stats.mjs).
//
// The rule that never changes: nothing is sent without the owner's "ок". The sender sends ONLY texts from comments-approved-*.json,
// exactly as approved, and checks each one again right before it goes. Bluesky's developer guidelines call automated or bulk replies spam,
// so a reply that a person did not approve is never sent, whatever the settings say (decided 20 Oct 2026, docs/decisions.md).
//
// Files on the "comments" branch. Each one is written once and never changed, so the chat, the finder and the sender never overwrite each other:
//   comments-drafts-<block>-<stamp>.json              the drafts the chat is about to show the owner (numbered); written BEFORE they are shown
//   comments-approved-<block>-<stamp>-<stamp2>.json   what the owner approved: the final texts, his own edits included
//   comments-cancel-<block>-<stamp>.json              the owner said "стоп": approved replies that were not sent yet are never sent
//   comments-sent-<stamp>.json                        one per sender run: what happened to each approved reply (sent with its link, or skipped with the reason)
//   comments-stats-<block>-<stamp>.json               once a day: likes and replies that our replies got
// <block> is the account block of data/comments-accounts.json (prices, prices-wide, ...). Its "send" object holds the settings below.
// For tests: COMMENTS_ROOT (the folder), BSKY_API_BASE and BSKY_PUBLIC_BASE (fake servers), COMMENTS_GAP_SCALE=0 (no pauses).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { file, postKey, looksNotEnglish } from './comments.mjs';

const lc = (s) => String(s ?? '').toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const brief = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// ---- settings ---------------------------------------------------------------------------------------------------
export const SEND_DEFAULTS = {
  enabled: false,
  handle: null,                // the account these settings belong to. A block that inherits "send" from another account without its own handle (Mastodon extends prices) does not send; Cozy and Retro add their own handle and password with "send+".
  passwordEnv: null,           // the secret with the app password of THIS account (never the search login of another account)
  dailyLimit: 20,              // replies in 24 hours (a rolling day), both modes of the account together
  maxPerRun: 25,
  gapSeconds: [60, 180],       // pause between two replies while the repository is public (GitHub minutes are free there)
  gapSecondsPrivate: [15, 30], // pause when the repository is private (every minute counts against the free monthly minutes)
  maxPostAgeHours: 48,         // never answer a post older than this, even if it was approved
  maxApprovalAgeHours: 24,     // an approval older than this is not sent: the queue never fires days later
  maxDraftAgeHours: 24,        // drafts older than this cannot be approved (run the comments again)
  perAuthorHours: 24,          // at most one reply to the same person in this time
  maxChars: 300,               // Bluesky allows 300 characters (graphemes) in a post
  maxEmoji: 1,
  allowLinks: false,
  allowHashtags: false,
  allowDomains: [],            // sites written as a domain that are fine as plain facts (gog.com, itch.io)
  blockNames: [],              // other sites and services: never named, unless the author of the post named them first
  blockPhrases: [],            // promo and forbidden phrases: never
};

export function sendSettings(account) {
  const s = { ...SEND_DEFAULTS, ...(account?.send ?? {}) };
  const own = !!s.handle && lc(s.handle) === lc(account?.handle);
  return { ...s, enabled: s.enabled === true && own, inherited: !!account?.send && !own };
}

export function sendProblems(account) {
  const raw = account?.send;
  const s = sendSettings(account);
  if (!raw || raw.enabled !== true || s.inherited) return [];
  const p = [];
  if ((account.platform ?? 'bluesky') !== 'bluesky') p.push('sending works only for Bluesky accounts for now');
  if (!s.passwordEnv) p.push('send.passwordEnv is missing (the secret with the app password of this account)');
  if (account.loginAs && s.passwordEnv === account.passwordEnv) p.push('send.passwordEnv must be the app password of this account itself: its search uses the login of another account (loginAs)');
  for (const k of ['dailyLimit', 'maxPerRun']) if (!Number.isInteger(s[k]) || s[k] < 1) p.push(`send.${k} must be a whole number above 0`);
  for (const k of ['maxPostAgeHours', 'maxApprovalAgeHours', 'maxDraftAgeHours', 'maxChars']) if (!(Number(s[k]) > 0)) p.push(`send.${k} must be a number above 0`);
  if (!(Number(s.perAuthorHours) >= 0)) p.push('send.perAuthorHours must be 0 or more');
  if (!Number.isInteger(s.maxEmoji) || s.maxEmoji < 0) p.push('send.maxEmoji must be a whole number, 0 or more');
  for (const k of ['gapSeconds', 'gapSecondsPrivate']) {
    const g = s[k];
    if (!Array.isArray(g) || g.length !== 2 || !g.every((x) => Number.isFinite(x) && x >= 0) || g[0] > g[1]) p.push(`send.${k} must be [smallest, biggest] in seconds`);
  }
  for (const k of ['allowDomains', 'blockNames', 'blockPhrases']) if (!Array.isArray(s[k])) p.push(`send.${k} must be a list`);
  return p;
}

// Unknown counts as private: then the pauses are short and the run costs few GitHub minutes.
export const repoIsPrivate = () => process.env.REPO_PRIVATE !== 'false';

// The pause before the next reply, in milliseconds (random inside the range of the settings, so the replies do not come like a machine gun).
export function gapMs(s, isPrivate, rnd = Math.random) {
  const [a, b] = isPrivate ? s.gapSecondsPrivate : s.gapSeconds;
  const scale = process.env.COMMENTS_GAP_SCALE != null && process.env.COMMENTS_GAP_SCALE !== '' ? Number(process.env.COMMENTS_GAP_SCALE) : 1;
  return Math.max(0, Math.round((a + (b - a) * rnd()) * 1000 * (Number.isFinite(scale) ? scale : 1)));
}

// ---- the text of a reply ----------------------------------------------------------------------------------------
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
export const graphemes = (s) => { let n = 0; for (const _ of segmenter.segment(String(s ?? ''))) n++; return n; };
const emojiCount = (s) => { let n = 0; for (const { segment } of segmenter.segment(String(s ?? ''))) if (/\p{Extended_Pictographic}/u.test(segment)) n++; return n; };
const norm = (s) => lc(s).replace(/[’‘`]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(Boolean);
function shingles(w, n) {
  const out = new Set();
  if (w.length < n) { if (w.length) out.add(w.join(' ')); return out; }
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}
// How alike two replies are, 0 to 1 (shared runs of 3 words; 2 for very short texts). A template with one word changed scores high.
export function similarity(a, b) {
  const wa = words(a), wb = words(b);
  if (!wa.length || !wb.length) return 0;
  const n = Math.min(wa.length, wb.length) >= 6 ? 3 : 2;
  const A = shingles(wa, n), B = shingles(wb, n);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
export const SIMILAR = 0.6;
export const sameText = (a, b) => norm(a) === norm(b);

const wordRe = (w) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(lc(w))}(?=$|[^\\p{L}\\p{N}])`, 'u');
const hasWords = (text, w) => wordRe(w).test(lc(text));
const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/iu;
const DOMAIN_RE = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?:com|net|org|io|gg|co|app|dev|me|tv|info|store|shop|games|game|deals|social|xyz|ru|uk|de|fr|us|ca|au|eu|ly|to|link|site|online|club|live|world|fm|ai)\b/giu;
// Prices and discounts: "$9.99", "9.99 USD", "75%". Each one must be in the post itself, so we never write a number we did not check.
const NUMBER_RE = /[$€£]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:usd|eur|gbp|dollars?|euros?|bucks|pounds?)\b|\b\d{1,3}\s?%/giu;
const numbers = (s) => (String(s ?? '').match(NUMBER_RE) ?? []).map((m) => lc(m).replace(/[\s,]/g, ''));

// What is wrong with a reply text, as short plain sentences (an empty list means it may go).
//   s: the send settings of the account; context: the post text and what it shows (a quoted post, a link card);
//   earlier: [{ text, at }] replies sent or approved before; batch: [{ n, text }] the other drafts of the same batch.
export function replyProblems(text, { s, context = '', earlier = [], batch = [] } = {}) {
  const t = String(text ?? '').trim();
  if (!t) return ['the text is empty'];
  const p = [];
  const g = graphemes(t);
  if (g > s.maxChars) p.push(`too long: ${g} characters, the limit is ${s.maxChars}`);
  if (/^["“”]/.test(t) && /["“”]$/.test(t)) p.push('the whole reply is in quotes: give the text without them');
  if (/^(reply|draft|answer)\s*:/i.test(t)) p.push('starts with a label ("Reply:"): give only the reply itself');
  if (/\p{Script=Cyrillic}/u.test(t)) p.push('has Russian letters: the reply must be in English');
  else if (looksNotEnglish(t)) p.push('does not look like English');
  if (t.startsWith('@')) p.push('starts with @name: a reply needs no @name');
  else if (/(^|[\s(])@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/iu.test(t)) p.push('mentions someone with @: that sends them a notification, leave it out');
  const ctx = lc(context);
  if (!s.allowLinks) {
    if (URL_RE.test(t)) p.push('has a link: replies of this account have no links');
    else {
      for (const m of t.match(DOMAIN_RE) ?? []) {
        const d = lc(m);
        const ok = (s.allowDomains ?? []).some((a) => d === lc(a) || d.endsWith(`.${lc(a)}`)) || ctx.includes(d);
        if (!ok) p.push(`names the site ${m}: only if the author of the post named it first`);
      }
    }
  }
  if (!s.allowHashtags && /(^|\s)#(?!\d+\b)[\p{L}\p{N}_]+/u.test(t)) p.push('has a hashtag: replies have no hashtags');
  const e = emojiCount(t);
  if (e > s.maxEmoji) p.push(`${e} emoji, at most ${s.maxEmoji}`);
  for (const name of s.blockNames ?? []) if (hasWords(t, name) && !hasWords(context, name)) p.push(`names "${name}": never name other sites or services unless the author of the post named them first`);
  for (const phrase of s.blockPhrases ?? []) if (hasWords(t, phrase)) p.push(`has "${phrase}": no promo, no claims like that`);
  const known = new Set(numbers(context));
  const unknown = [...new Set(numbers(t).filter((x) => x !== '100%' && !known.has(x)))];
  if (unknown.length) p.push(`has a price or a discount that is not in the post (${unknown.join(', ')}): never write a number we did not check`);
  if (s.allowLinks && /saveandplay\.com\/(deals|go)\//i.test(t) && t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() !== 'Ad') p.push('a link to our deal page needs the last line "Ad"');
  for (const x of earlier) {
    if (sameText(x.text, t)) { p.push(`the same text was already used${x.at ? ` (${String(x.at).slice(0, 10)})` : ''}`); break; }
    if (similarity(x.text, t) >= SIMILAR) { p.push(`too similar to an earlier reply${x.at ? ` (${String(x.at).slice(0, 10)})` : ''}: "${brief(x.text, 70)}"`); break; }
  }
  for (const x of batch) if (sameText(x.text, t) || similarity(x.text, t) >= SIMILAR) p.push(`too similar to draft ${x.n}: every reply must be written for its own post`);
  return [...new Set(p)];
}

// Links in a reply become clickable only with "facets" (Bluesky does not find them by itself in a post made through the API). Byte positions in UTF-8.
export function linkFacets(text) {
  const enc = new TextEncoder();
  const out = [];
  for (const m of String(text).matchAll(/\bhttps?:\/\/\S+/g)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, '');
    const start = enc.encode(text.slice(0, m.index)).length;
    out.push({ index: { byteStart: start, byteEnd: start + enc.encode(url).length }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }] });
  }
  return out;
}

// ---- files on the branch (copied into drafts/ by scripts/comments-branch.sh load) --------------------------------
export const stampOf = (t = Date.now()) => new Date(t).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
// A new file never takes the name of an existing one (two "ок" in the same second get name.json and name-2.json).
export function uniqueName(base) {
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${base}.json` : `${base}-${i}.json`;
    if (!existsSync(file('drafts', name))) return name;
  }
}
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
function filesWith(prefix) {
  const dir = file('drafts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort()
    .map((name) => ({ name, data: readJson(resolve(dir, name)) })).filter((x) => x.data && typeof x.data === 'object');
}
export const loadDraftFiles = () => filesWith('comments-drafts-').filter((x) => Array.isArray(x.data.items));
export const loadApprovedFiles = () => filesWith('comments-approved-').filter((x) => Array.isArray(x.data.items));
export const loadCancelFiles = () => filesWith('comments-cancel-');
export const loadStatsFiles = () => filesWith('comments-stats-');
export const loadSent = () => filesWith('comments-sent-').flatMap((x) => (Array.isArray(x.data.entries) ? x.data.entries : []).map((e) => ({ ...e, file: x.name })));

// One approved reply is known by the account and the post: a post is never answered twice, whatever file approved it.
export const itemKey = (handle, uri) => `${lc(handle)}|${postKey(uri)}`;
export const FINAL = new Set(['sent', 'skipped']);
// A reply held back only by the daily limit is not final: it waits for room (the approval still expires after maxApprovalAgeHours).
// Older reports wrote that case as "skipped", so those are read as waiting too.
const heldByLimit = (e) => e.status === 'waiting' || (e.status === 'skipped' && /^daily limit \(/.test(String(e.reason ?? '')));
export const finalKeys = (sent) => new Set(sent.filter((e) => FINAL.has(e.status) && !heldByLimit(e)).map((e) => itemKey(e.handle, e.uri)));
export const sentWithin = (sent, handle, hours, now) => sent.filter((e) => e.status === 'sent' && lc(e.handle) === lc(handle) && now - Date.parse(e.at) < hours * 36e5);

// A "стоп" of the owner (a cancel file) stops every approved reply of the account that was approved before it (or only the listed ones).
export const isCancelled = (cancels, handle, key, approvedAt) => cancels.some((c) => lc(c.handle) === lc(handle) && Date.parse(c.at) >= Date.parse(approvedAt) && (c.all === true || (c.keys ?? []).includes(key)));

// Approved replies that are still waiting: not sent or skipped yet. `cancelled` says the owner stopped it; the age of the approval is checked by the caller.
export function pendingItems({ approved, sent, cancels, handle = null }) {
  const done = finalKeys(sent);
  const out = [];
  for (const f of approved) {
    const d = f.data;
    if (handle && lc(d.handle) !== lc(handle)) continue;
    for (const it of d.items) {
      const key = itemKey(d.handle, it.uri);
      if (done.has(key) || out.some((o) => o.key === key)) continue;
      out.push({ ...it, key, block: d.account, handle: d.handle, approvedAt: d.approvedAt, approvedFile: f.name, cancelled: isCancelled(cancels.map((c) => c.data), d.handle, key, d.approvedAt) });
    }
  }
  return out.sort((a, b) => Date.parse(a.approvedAt) - Date.parse(b.approvedAt) || a.n - b.n);
}

// Texts used before by an account (sent or approved in the last `days` days): a new reply must not repeat them.
export function earlierTexts({ approved, sent, handle, now, days = 60, exceptKeys = new Set() }) {
  const since = now - days * 864e5;
  const out = [];
  for (const e of sent) if (e.status === 'sent' && lc(e.handle) === lc(handle) && Date.parse(e.at) >= since) out.push({ text: e.text, at: e.at, key: itemKey(e.handle, e.uri) });
  for (const f of approved) {
    if (lc(f.data.handle) !== lc(handle) || !(Date.parse(f.data.approvedAt) >= since)) continue;
    for (const it of f.data.items) { const key = itemKey(f.data.handle, it.uri); if (!out.some((o) => o.key === key)) out.push({ text: it.text, at: f.data.approvedAt, key }); }
  }
  return out.filter((x) => !exceptKeys.has(x.key));
}

// ---- Bluesky: posting -------------------------------------------------------------------------------------------
// The login is the account's own app password. After the login the calls go to the account's own server (its PDS, from the login answer).
export function createPoster({ fetchImpl = globalThis.fetch, base = process.env.BSKY_API_BASE || 'https://bsky.social', timeoutMs = Number(process.env.COMMENTS_TIMEOUT_MS) || 20000, retryMs = Number(process.env.COMMENTS_RETRY_MS) || 2000 } = {}) {
  const fixed = !!process.env.BSKY_API_BASE; // tests: one fake server answers everything
  let host = base;
  let jwt = null;
  let me = null;
  let creds = null;
  async function call(path, { method = 'GET', params, body, retry = true } = {}, attempt = 0) {
    const url = new URL(`/xrpc/${path}`, host);
    for (const [k, v] of Object.entries(params ?? {})) if (v != null) url.searchParams.set(k, String(v));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, { method, headers: { 'content-type': 'application/json', ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    } catch (e) {
      clearTimeout(timer);
      if (retry && attempt < 1) { await sleep(retryMs); return call(path, { method, params, body, retry }, attempt + 1); }
      throw Object.assign(new Error(`cannot reach the Bluesky server: ${e.message}`), { code: 'network' });
    }
    clearTimeout(timer);
    if (retry && (res.status === 429 || res.status >= 500) && attempt < 1) { await sleep(retryMs); return call(path, { method, params, body, retry }, attempt + 1); }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok) {
      const code = json?.error === 'ExpiredToken' ? 'expired' : res.status === 401 ? 'auth' : res.status === 429 ? 'rate' : `http-${res.status}`;
      throw Object.assign(new Error(json?.message || json?.error || `HTTP ${res.status}`), { code, status: res.status });
    }
    return json;
  }
  // A token lasts a limited time; a long run with pauses logs in again once when the server says it expired.
  async function authed(path, opts) {
    try { return await call(path, opts); } catch (e) {
      if (e.code !== 'expired' || !creds) throw e;
      await login(creds.identifier, creds.password);
      return call(path, opts);
    }
  }
  async function login(identifier, password) {
    const j = await call('com.atproto.server.createSession', { method: 'POST', body: { identifier, password }, retry: false });
    jwt = j?.accessJwt || null;
    if (!jwt || !j?.did) throw Object.assign(new Error('login gave no token'), { code: 'auth' });
    creds = { identifier, password };
    me = { did: j.did, handle: lc(j.handle) };
    const pds = (j.didDoc?.service ?? []).find((x) => x?.id === '#atproto_pds' || x?.type === 'AtprotoPersonalDataServer')?.serviceEndpoint;
    if (!fixed && typeof pds === 'string' && /^https:\/\//.test(pds)) host = pds;
    return me;
  }
  return {
    login,
    get me() { return me; },
    async post(uri) {
      const j = await authed('app.bsky.feed.getPosts', { params: { uris: uri } });
      return j?.posts?.[0] ?? null;
    },
    // Did our account answer this post already (by hand or by an earlier run)? { ok: false } when the thread cannot be read (deleted or blocked).
    async repliedBy(uri, did) {
      const j = await authed('app.bsky.feed.getPostThread', { params: { uri, depth: 1, parentHeight: 0 } });
      const th = j?.thread;
      if (!th || !String(th.$type ?? '').endsWith('#threadViewPost')) return { ok: false, type: String(th?.$type ?? 'none') };
      return { ok: true, replied: (th.replies ?? []).some((r) => r?.post?.author?.did === did) };
    },
    // Our replies of the last `hours` hours, by hand or by the program (the daily limit and "one reply per person" count them all): [{ at, to }]
    async recentReplies(hours, maxPages = 3) {
      const since = Date.now() - hours * 36e5;
      const out = [];
      let cursor;
      for (let i = 0; i < maxPages; i++) {
        const j = await authed('app.bsky.feed.getAuthorFeed', { params: { actor: me.did, filter: 'posts_with_replies', limit: 100, cursor } });
        let older = false;
        for (const it of j?.feed ?? []) {
          const p = it?.post;
          if (!p || it.reason || p.author?.did !== me.did || !p.record?.reply) continue;
          const at = Date.parse(p.record.createdAt ?? p.indexedAt ?? '');
          if (!(at >= since)) { older = true; continue; }
          out.push({ at: new Date(at).toISOString(), to: lc(it.reply?.parent?.author?.handle ?? ''), uri: p.uri });
        }
        cursor = j?.cursor;
        if (!cursor || older || !(j?.feed ?? []).length) break;
      }
      return out;
    },
    // One reply. Never repeated by itself on an error: a second try could post the same reply twice.
    async reply({ text, parent, root, langs, facets }) {
      const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString(), ...(langs?.length ? { langs } : {}), reply: { root, parent }, ...(facets?.length ? { facets } : {}) };
      return authed('com.atproto.repo.createRecord', { method: 'POST', body: { repo: me.did, collection: 'app.bsky.feed.post', record }, retry: false });
    },
  };
}

// Reading public Bluesky data without a login (our own replies and their likes, for the daily numbers).
export async function publicCall(path, params, { fetchImpl = globalThis.fetch, base = process.env.BSKY_PUBLIC_BASE || 'https://public.api.bsky.app', retryMs = Number(process.env.COMMENTS_RETRY_MS) || 2000, timeoutMs = 20000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const url = new URL(`/xrpc/${path}`, base);
    for (const [k, v] of Object.entries(params ?? {})) if (v != null) url.searchParams.set(k, String(v));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: ctl.signal });
      clearTimeout(timer);
      if ((res.status === 429 || res.status >= 500) && attempt < 1) { await sleep(retryMs); continue; }
      const json = await res.json().catch(() => null);
      if (!res.ok) throw Object.assign(new Error(json?.message || json?.error || `HTTP ${res.status}`), { code: `http-${res.status}` });
      return json;
    } catch (e) {
      clearTimeout(timer);
      if (e.code) throw e;
      if (attempt < 1) { await sleep(retryMs); continue; }
      throw Object.assign(new Error(`cannot reach ${base}: ${e.message}`), { code: 'network' });
    }
  }
}

export const replyUrl = (handle, uri) => `https://bsky.app/profile/${handle}/post/${String(uri).split('/').pop()}`;
