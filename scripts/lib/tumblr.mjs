// Shared code of the Tumblr scripts (post-tumblr, tumblr-check, tumblr-auth, tumblr-secret). See TUMBLR.md (everything about Tumblr is described there).
// Settings: data/tumblr-accounts.json (blog, tags, kinds, autopost) and the block with the same name in data/accounts.json
// (the deal rules of the daily brief: stores, minimum discount, subid). No AI, no paid API.
//
// Login: OAuth 1.0a with four values (consumer key, consumer secret, token, token secret). They never expire, so nothing has to be renewed or written back
// to GitHub. They come from the environment (GitHub Secrets) or from the local .env file, and they are never printed, never put in an error message.
//
// For tests the root folder can be changed with TUMBLR_ROOT (the folder that holds data/, public/, drafts/, src/, .env), the address of the API
// with TUMBLR_API_BASE (instead of https://api.tumblr.com) and the address of the login pages with TUMBLR_WWW_BASE (instead of https://www.tumblr.com).

import { readFileSync, existsSync, readdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { splitArticle } from '../article-tools.mjs';

const HOME_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const file = (rel) => resolve(process.env.TUMBLR_ROOT ? resolve(process.env.TUMBLR_ROOT) : HOME_ROOT, rel); // looked up at every call, so tests can switch the folder

// The two kinds of posts (the same as for Nostr and Lemmy): one DEAL a day, and a guide of the site (ARTICLE) every few days.
export const KINDS = ['deal', 'article'];
// The label of a deal post: plain text and the LAST block of the post (docs/channels.md section 5: a post that leads to an affiliate link is marked).
// Articles have no label: they link to our own guide, not to a store.
export const DISCLOSURE = 'Ad: we may earn a commission if you buy.';
export const API_BASE = () => process.env.TUMBLR_API_BASE || 'https://api.tumblr.com';
export const WWW_BASE = () => process.env.TUMBLR_WWW_BASE || 'https://www.tumblr.com';
const HOUR = 3600e3;
export const UA = 'saveandplay-tumblr (+https://saveandplay.com)'; // one fixed value: Tumblr suspends apps that send many different ones
export const SECRET_PARTS = ['CONSUMER_KEY', 'CONSUMER_SECRET', 'TOKEN', 'TOKEN_SECRET'];

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

// Sets NAME=value in a .env file (the line is replaced if it exists, added if not). The value is never printed.
export function setEnvValue(envFile, name, value) {
  const lines = existsSync(envFile) ? readFileSync(envFile, 'utf8').split(/\r?\n/) : [];
  const re = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
  const at = lines.findIndex((l) => re.test(l));
  if (at >= 0) lines[at] = `${name}=${value}`;
  else {
    while (lines.length && lines.at(-1) === '') lines.pop();
    lines.push(`${name}=${value}`);
  }
  writeFileSync(envFile, lines.join('\n') + '\n');
}

// The names of the four secrets of an account, for example TUMBLR_CONSUMER_KEY. Another account has its own prefix.
export const secretNames = (account) => Object.fromEntries(SECRET_PARTS.map((p) => [p, `${account.secretPrefix}_${p}`]));
// The four values, from the environment first (GitHub Secrets), then from the local .env file. { creds, missing } (missing = names that are not set).
export function loadCreds(account) {
  const names = secretNames(account);
  const get = (n) => (process.env[n] || readEnvValue(file('.env'), n) || '').trim() || null;
  const creds = { consumerKey: get(names.CONSUMER_KEY), consumerSecret: get(names.CONSUMER_SECRET), token: get(names.TOKEN), tokenSecret: get(names.TOKEN_SECRET) };
  const missing = SECRET_PARTS.filter((p) => !creds[{ CONSUMER_KEY: 'consumerKey', CONSUMER_SECRET: 'consumerSecret', TOKEN: 'token', TOKEN_SECRET: 'tokenSecret' }[p]]).map((p) => names[p]);
  return { creds, missing };
}

// All Tumblr accounts: { id, account, links } with defaults filled in. The settings of data/tumblr-accounts.json are joined with the block of the
// same name in data/accounts.json (that block is what the daily brief reads to choose the deal and to make the link).
export function tumblrAccounts(only = null) {
  const cfg = readJson('data/accounts.json');
  const tumblr = readJson('data/tumblr-accounts.json');
  const out = [];
  for (const [id, settings] of Object.entries(tumblr.accounts ?? {})) {
    if (only && id !== only) continue;
    const brief = cfg.accounts?.[id];
    if (!brief) throw new Error(`"${id}" is in data/tumblr-accounts.json but not in data/accounts.json (the daily brief takes its deal rules from there).`);
    out.push({ id, account: withTumblrDefaults(id, { ...brief, ...settings }), links: cfg.links });
  }
  if (only && !out.length) throw new Error(`No Tumblr account "${only}" in data/tumblr-accounts.json.`);
  return out;
}

export function withTumblrDefaults(id, a) {
  const secretPrefix = a.secretPrefix || (id === 'tumblr' ? 'TUMBLR' : `TUMBLR_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`);
  return { autopost: false, kinds: [...KINDS], maxPriceAgeHours: 48, maxBriefAgeHours: 12, timezone: 'America/Bogota', articleEveryDays: 2, maxTags: 15, linkStyle: 'text', theme: 'games', ...a, secretPrefix, tags: { base: [], article: [], guides: {}, store: {}, ...(a.tags ?? {}) } };
}

const BLOG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/i;
const PREFIX_RE = /^[A-Z][A-Z0-9_]*$/;
const TAG_OK = (t) => typeof t === 'string' && t.trim() && !/[,#]/.test(t) && t.length <= 100;

// What is wrong with the settings of an account: a list of plain sentences (empty = fine). The scripts that talk to the server refuse to run with problems.
export function configProblems(account) {
  const bad = [];
  if (!BLOG_RE.test(account.blog ?? '')) bad.push('"blog" must be the name of the Tumblr blog (the part before .tumblr.com: letters, digits, -)');
  if (!PREFIX_RE.test(account.secretPrefix ?? '')) bad.push('"secretPrefix" must be capital letters, digits and _ (for example TUMBLR)');
  if (!Array.isArray(account.kinds) || !account.kinds.length || account.kinds.some((k) => !KINDS.includes(k))) bad.push(`"kinds" must be a list of ${KINDS.map((k) => `"${k}"`).join(' and/or ')}`);
  if (!Number.isInteger(account.articleEveryDays) || account.articleEveryDays < 1) bad.push('"articleEveryDays" must be a whole number, 1 or more');
  if (!['text', 'card'].includes(account.linkStyle)) bad.push('"linkStyle" must be "text" (a picture and a link in the text) or "card" (Tumblr makes the link card itself)');
  if (!Number.isInteger(account.maxTags) || account.maxTags < 0 || account.maxTags > 30) bad.push('"maxTags" must be a whole number from 0 to 30');
  const t = account.tags ?? {};
  for (const key of ['base', 'article']) if (!Array.isArray(t[key]) || !t[key].every(TAG_OK)) bad.push(`tags.${key} must be a list of tags without commas and without #`);
  if (typeof t.store !== 'object' || Array.isArray(t.store) || Object.values(t.store ?? {}).some((v) => !Array.isArray(v) || !v.every(TAG_OK))) bad.push('tags.store must pair a store with a list of tags (no commas, no #)');
  if (typeof t.guides !== 'object' || t.guides === null || Array.isArray(t.guides) || Object.values(t.guides).some((v) => !Array.isArray(v) || !v.every(TAG_OK))) bad.push('tags.guides must pair a guide (its file name without .md) with a list of tags (no commas, no #)');
  return bad;
}

export const handleOf = (account) => `${account.blog}.tumblr.com`;
export const postPage = (blog, id) => `https://${blog}.tumblr.com/post/${id}`;

// ---------- small helpers ----------

export const reasonOf = (e) => String(e?.message ?? e ?? 'unknown error').replace(/\s+/g, ' ').trim().slice(0, 240) || 'unknown error';
export const hoursSince = (t, now = Date.now()) => (now - Date.parse(t)) / HOUR;
export const money = (n) => `$${Number(n).toFixed(2)}`;
export const stamp = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
export const dayKey = (t, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t); // YYYY-MM-DD
export const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const summary = (md) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.endsWith('\n') ? md : md + '\n');
};
// Not process.exit(code): the exit code is set and Node ends by itself once every socket and timer is done. The unref'd timer is a safety net only.
export function finish(code, graceMs = 15000) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), graceMs).unref();
}

// ---------- OAuth 1.0a (RFC 5849), HMAC-SHA1 ----------

// Percent-encoding of RFC 3986: encodeURIComponent leaves ! ' ( ) * alone, OAuth does not.
export const pct = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// The Authorization header of a signed request. "query" are the parameters in the address; "extra" are more oauth_* values (oauth_callback,
// oauth_verifier). A JSON body is not part of the signature. nonce and timestamp are replaceable for tests.
export function oauthHeader({ method, url, query = {}, consumerKey, consumerSecret, token = '', tokenSecret = '', extra = {}, nonce = randomBytes(16).toString('hex'), timestamp = Math.floor(Date.now() / 1000) }) {
  const oauth = { oauth_consumer_key: consumerKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(timestamp), oauth_version: '1.0', ...(token ? { oauth_token: token } : {}), ...extra };
  const all = [...Object.entries(query), ...Object.entries(oauth)].map(([k, v]) => [pct(k), pct(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const base = [method.toUpperCase(), pct(url), pct(all.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  const signature = createHmac('sha1', `${pct(consumerSecret)}&${pct(tokenSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(', ');
}

// ---------- the Tumblr API ----------

// What the owner can do about the errors Tumblr gives. The status is always shown too.
export const HINTS = [
  [/^http_401$|^unauthorized$/, 'Tumblr does not accept the login. The four secrets may be wrong or the app access was taken away. Run npm run tumblr:auth again, then npm run tumblr:secret.'],
  [/^http_403$|^forbidden$/, 'Tumblr refuses this. The account may be limited or suspended: open the blog in a browser and look for a notice.'],
  [/^http_404$/, 'Tumblr does not know this blog. Check "blog" in data/tumblr-accounts.json (the part before .tumblr.com).'],
  [/^http_429$|^rate_limit$/, 'Tumblr limits how fast posts can be made (250 posts a day). The next run tries again.'],
  [/^http_400$|^http_422$|^bad_request$/, 'Tumblr did not accept the content of the post. The text above says why.'],
];
export const hintFor = (code) => HINTS.find(([re]) => re.test(String(code ?? '')))?.[1] ?? null;

export class TumblrError extends Error {
  constructor(message, { code = 'error', status = 0 } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// A client for one account. fetchImpl is replaceable for tests. Nothing here prints; errors never contain the secrets.
export function createClient(creds, { fetchImpl = globalThis.fetch, timeoutMs = Number(process.env.TUMBLR_TIMEOUT_MS) || 20000, retryMs = Number(process.env.TUMBLR_RETRY_MS) || 1500 } = {}) {
  const origin = API_BASE();

  // GET is repeated on a network error, 429 and 5xx. A POST never is: the post may have gone through, and the next run finds it on the blog.
  async function call(method, route, { query = {}, body } = {}) {
    const url = new URL(route, origin);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const tries = method === 'GET' ? 3 : 1;
    let last;
    for (let i = 0; i < tries; i++) {
      if (i) await sleep(retryMs * i);
      const headers = {
        accept: 'application/json',
        'user-agent': UA,
        authorization: oauthHeader({ method, url: `${url.origin}${url.pathname}`, query, ...creds }),
        ...(body ? { 'content-type': 'application/json' } : {}),
      };
      let r;
      let text;
      try {
        r = await fetchImpl(url, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
        text = await r.text();
      } catch (e) {
        last = new TumblrError(`${route}: no answer (${e?.name === 'TimeoutError' ? 'timed out' : reasonOf(e)})`, { code: 'network' });
        continue;
      }
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (r.ok) {
        if (json === null || typeof json !== 'object') throw new TumblrError(`${route}: the answer is not JSON, so this is not the Tumblr API`, { code: 'not_json', status: r.status });
        return json.response ?? json;
      }
      const detail = [json?.meta?.msg, ...(json?.errors ?? []).map((x) => x?.detail || x?.title)].filter((x) => typeof x === 'string' && x).join(': ').slice(0, 200);
      last = new TumblrError(`${route}: HTTP ${r.status}${detail ? ` (${detail})` : ''}`, { code: `http_${r.status}`, status: r.status });
      if (!(r.status === 429 || r.status >= 500)) break;
    }
    throw last;
  }

  return {
    origin,
    // The logged-in user: { name, blogs: [{ name, title, url }] }.
    async userInfo() {
      const r = await call('GET', '/v2/user/info');
      const u = r.user ?? {};
      return { name: u.name ?? null, blogs: (u.blogs ?? []).map((b) => ({ name: b.name, title: b.title ?? '', url: b.url ?? null })) };
    },
    // The newest posts of a blog in NPF: [{ id, url, timestamp (ms), links: [every link address in the post] }].
    async recentPosts(blog, limit = 20) {
      const r = await call('GET', `/v2/blog/${encodeURIComponent(blog)}/posts`, { query: { npf: 'true', limit } });
      return (r.posts ?? []).map((p) => ({
        id: String(p.id_string ?? p.id ?? ''),
        url: p.post_url ?? null,
        timestamp: Number(p.timestamp) * 1000 || null,
        links: linksOf(p.content),
      }));
    },
    // READ ONLY. The newest public posts that carry a tag, newest first: [{ blog, title, description, url, postUrl, timestamp (ms), notes, tags, original, adult }].
    // before = a time in ms: only posts older than that (to read the next page). original = false for a reblog.
    async taggedPosts(tag, { before = null, limit = 20 } = {}) {
      const r = await call('GET', '/v2/tagged', { query: { tag, limit, filter: 'text', ...(before ? { before: Math.floor(before / 1000) } : {}) } });
      return (Array.isArray(r) ? r : []).map((p) => ({
        blog: String(p.blog_name ?? p.blog?.name ?? ''),
        title: String(p.blog?.title ?? ''),
        description: String(p.blog?.description ?? ''),
        url: p.blog?.url ?? null,
        postUrl: p.post_url ?? null,
        timestamp: Number(p.timestamp) * 1000 || null,
        notes: Number(p.note_count) || 0,
        tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
        original: !(p.reblogged_from_id || p.reblogged_root_id || p.reblogged_from_name || (Array.isArray(p.trail) && p.trail.length)),
        adult: Boolean(p.blog?.is_nsfw || p.blog?.is_adult || p.is_nsfw),
      }));
    },
    // READ ONLY. The last public posts of ANY blog and what the blog says about itself: { info: { title, description, adult }, posts: [{ timestamp (ms), tags, notes, original, postUrl }] }.
    // Used to look at a blog before it is suggested for a follow. A private or removed blog gives HTTP 404/403.
    async blogPosts(blog, { limit = 20 } = {}) {
      const r = await call('GET', `/v2/blog/${encodeURIComponent(blog)}/posts`, { query: { limit, filter: 'text' } });
      const b = r.blog ?? {};
      return {
        info: { title: String(b.title ?? ''), description: String(b.description ?? ''), adult: Boolean(b.is_nsfw || b.is_adult) },
        posts: (r.posts ?? []).map((p) => ({
          timestamp: Number(p.timestamp) * 1000 || null,
          tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
          notes: Number(p.note_count) || 0,
          original: !(p.reblogged_from_id || p.reblogged_root_id || p.reblogged_from_name || (Array.isArray(p.trail) && p.trail.length)),
          postUrl: p.post_url ?? null,
        })),
      };
    },
    // Makes a post (NPF). content = the list of blocks, tags = list of strings. Returns { id }.
    async createPost(blog, { content, tags = [] }) {
      const r = await call('POST', `/v2/blog/${encodeURIComponent(blog)}/posts`, { body: { content, state: 'published', ...(tags.length ? { tags: tags.join(',') } : {}) } });
      const id = r.id_string ?? r.id;
      if (id === undefined || id === null || id === '') throw new TumblrError('Tumblr accepted the post but did not return its id', { code: 'no_post_id' });
      return { id: String(id) };
    },
  };
}

// ---------- picture size ----------
// Tumblr wants the width and height of every picture. The program reads them from the picture itself (the first bytes of PNG, JPEG, GIF, WebP).

export function imageInfo(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.toString('latin1', 12, 16) === 'IHDR') return { type: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.toString('latin1', 0, 3) === 'GIF') return { type: 'image/gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const kind = buf.toString('latin1', 12, 16);
    if (kind === 'VP8 ') return { type: 'image/webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { type: 'image/webp', width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') return { type: 'image/webp', width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: 'image/jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

// Downloads a picture and reads its type and size: { info } or { reason }. The program needs no help from the owner for this.
export async function probeImage(url, { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  try {
    // TUMBLR_PROBE_BASE answers for every picture address, for tests only.
    if (process.env.TUMBLR_PROBE_BASE) url = `${process.env.TUMBLR_PROBE_BASE}${new URL(url).pathname}`;
    const r = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': UA } });
    if (!r.ok) return { reason: `the picture answered HTTP ${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 10e6) return { reason: 'the picture is larger than 10 MB' };
    const info = imageInfo(buf);
    return info && info.width > 0 && info.height > 0 ? { info } : { reason: 'the size of the picture could not be read (not PNG, JPEG, GIF or WebP)' };
  } catch (e) {
    return { reason: `the picture could not be downloaded (${reasonOf(e)})` };
  }
}

// ---------- the post: a template, no AI ----------

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

const text = (t, subtype) => ({ type: 'text', text: t, ...(subtype ? { subtype } : {}) });
const imageBlock = (url, info, alt) => ({ type: 'image', media: [{ type: info.type, url, width: info.width, height: info.height }], alt_text: clip(alt, 4000) });
// The link to OUR page. "text" (default): a line of text with the address as a link, so the post shows OUR picture at its own size and nothing is cut.
// "card": a link block, Tumblr makes the card from our page itself (its own crop of the page picture, which we cannot control).
const linkBlock = (url, label, style) => (style === 'card' ? { type: 'link', url } : { type: 'text', text: label, formatting: [{ start: 0, end: label.length, type: 'link', url }] });
// Every link address of a list of NPF blocks (link blocks and links inside text), to find our own post again.
export const linksOf = (blocks = []) => blocks.flatMap((b) => (b?.type === 'link' && typeof b.url === 'string' ? [b.url] : (b?.formatting ?? []).filter((f) => f?.type === 'link' && typeof f.url === 'string').map((f) => f.url)));

// The tags of a post: the account's base tags, the store's tags (deals), the game's name (deals), the article tags (guides). Tumblr wants plain words
// without commas and without #. Duplicates (any letter case) are dropped, and no more than maxTags remain (the first ones win).
// A guide's OWN tags (tags.guides[slug], about what that guide is about) go FIRST: the first tags matter most for search, and the huge general tags
// (gaming, steam) sink a post in minutes. c = { slug } for a guide.
export function buildTags(account, kind, c = null) {
  const t = account.tags ?? {};
  const own = kind === 'deal' ? [] : t.guides?.[c?.slug] ?? [];
  const list = kind === 'deal' ? [...(t.base ?? []), ...(t.store?.[c?.store] ?? []), String(c?.title ?? '').replace(/[,#]/g, ' ').replace(/\s+/g, ' ').trim()] : [...own, ...(t.base ?? []), ...(t.article ?? [])];
  const seen = new Set();
  return list.filter((x) => x && x.length <= 100 && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase())).slice(0, account.maxTags ?? 15);
}

// The post of a deal from the first candidate of the brief: only its numbers and dates, nothing invented, nothing rounded.
// content = blocks, the "Ad:" line LAST. The link is our own page of the game (never a store). cover = { type, width, height } of the cover picture or null.
export function buildDealPost(c, account, cover = null) {
  check(c);
  const blocks = [text(`${c.title}: -${c.discount}% at ${c.store}`, 'heading2')];
  const notes = [];
  if (c.cover && cover) blocks.push(imageBlock(c.cover, cover, String(c.coverAlt || `Cover art for ${c.title}`)));
  else if (c.cover) notes.push('no cover: its size could not be read');
  blocks.push(text(`${money(c.price)} (was ${money(c.was)}) at ${c.store}, -${c.discount}%.`));
  blocks.push(text(`Price checked ${stamp(c.priceCheckedAt)}.${c.endsAt ? ` Sale ends ${stamp(c.endsAt)}.` : ''}`));
  const why = whyLine(c);
  if (why) blocks.push(text(why));
  blocks.push(linkBlock(c.link, `See this deal on Save and Play: ${c.title}`, account.linkStyle));
  blocks.push(text(DISCLOSURE));
  if (blocks.at(-1).text !== DISCLOSURE) throw new Error('A deal post has no "Ad:" line at the end. It is not allowed to post without it.');
  return { content: blocks, tags: buildTags(account, 'deal', c), notes };
}

// ---------- the guides of the site ----------

export const GUIDES = 'src/pages/guides';

// Every guide: { slug, text, updated, off }, oldest first. "tumblr: false" in the header of a guide keeps it out of Tumblr.
export function listGuides() {
  const dir = file(GUIDES);
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.md')) : [];
  const out = names.map((n) => {
    const slug = n.slice(0, -3);
    const raw = readFileSync(file(`${GUIDES}/${n}`), 'utf8');
    const fm = splitArticle(raw).fm ?? {};
    const updated = /^\d{4}-\d{2}-\d{2}/.test(String(fm.updated ?? '')) ? String(fm.updated).slice(0, 10) : null;
    return { slug, text: raw, updated, off: String(fm.tumblr ?? '').trim().toLowerCase() === 'false' };
  });
  return out.sort((a, b) => (a.updated ?? '9999').localeCompare(b.updated ?? '9999') || a.slug.localeCompare(b.slug));
}

// The key points of a guide, to put INTO the post (a post that holds its value in itself gets reblogged; a picture and a link to another site does not).
// Takes the FIRST numbered list of the text with 3 to 8 items ("1. **Is it the same edition?** A Deluxe ..."), and from each item only its bold lead
// (or, without a bold lead, its first sentence); the explanations stay on the site. heading = the "##" heading above the list.
// Pictures (figure, svg), code and link addresses are ignored. Returns { heading, points } or null (no such list: the post stays short, as before).
export function guidePoints(body) {
  const clean = String(body ?? '').replace(/<figure[\s\S]*?<\/figure>/gi, '').replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/```[\s\S]*?```/g, '');
  const plain = (s) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();
  const runs = [];
  let heading = null;
  let run = null;
  const close = () => {
    if (run) runs.push(run);
    run = null;
  };
  for (const line of clean.split(/\r?\n/)) {
    const h = line.match(/^#{2,3}\s+(.+?)\s*#*\s*$/);
    if (h) {
      close();
      heading = plain(h[1]);
      continue;
    }
    const m = line.match(/^ {0,3}(\d{1,2})[.)]\s+(.+)$/);
    if (m) {
      const n = Number(m[1]);
      if (run && n === run.items.length + 1) run.items.push(m[2]);
      else {
        close();
        if (n === 1) run = { heading, items: [m[2]] };
      }
      continue;
    }
    if (line.trim() && !/^\s/.test(line)) close(); // text that is not the list ends it (an indented line goes on with the item)
  }
  close();
  const found = runs.find((r) => r.items.length >= 3 && r.items.length <= 8);
  if (!found) return null;
  const lead = (s) => {
    const b = s.match(/^(?:\*\*|__)(.+?)(?:\*\*|__)/);
    let t = plain(b ? b[1] : s);
    if (!b) t = t.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ?? t;
    return clip(t.replace(/:$/, ''), 160);
  };
  const points = found.items.map(lead).filter(Boolean);
  return points.length >= 3 ? { heading: found.heading ? clip(found.heading, 120) : null, points } : null;
}

// The post of a guide from its header: title, picture, description, key points, link. The link carries the marks of the account (utm_source = subid).
// cover = { type, width, height } of the picture, null (it could not be measured), or left out (not measured yet: no note about its size). Returns { post: { content, tags }, path, title, imageUrl, notes }. Throws with a plain reason when the guide cannot become a post.
export function buildArticlePost(g, account, site, cover = undefined) {
  const { fm, body } = splitArticle(g.text);
  const bad = [];
  if (!fm) bad.push('no header (--- ... ---)');
  const title = String(fm?.title ?? '').replace(/\s+/g, ' ').trim();
  if (fm && !title) bad.push('the header has no title');
  if (!/^[a-z0-9_-]+$/i.test(g.slug)) bad.push('the file name has characters other than letters, digits, - and _');
  if (!/^https:\/\/[^\s/]+$/.test(site ?? '')) bad.push('links.site of data/accounts.json');
  if (!/^[a-z0-9_-]+$/i.test(account.subid ?? '')) bad.push('subid of the account');
  if (bad.length) throw new Error(`The guide "${g.slug}" cannot become a post: ${bad.join(', ')}.`);

  const path = `/guides/${g.slug}/`;
  const notes = [];
  const description = String(fm.description ?? '').replace(/\s+/g, ' ').trim();
  if (!description) notes.push('the header has no description, the post has the title only');
  const image = String(fm.image ?? '').trim();
  const alt = String(fm.imageAlt ?? '').trim();
  let imageUrl = null;
  if (!image) notes.push('no picture: the header has no image');
  else if (!/^\/[^\s?#]+$/.test(image)) notes.push(`no picture: image "${image}" is not a site path`);
  else if (!alt) notes.push('no picture: the header has no imageAlt');
  else if (!existsSync(file(`public${image}`))) notes.push(`no picture: public${image} does not exist`);
  else imageUrl = `${site}${image}`;

  const blocks = [text(clip(title, 300), 'heading2')];
  if (imageUrl && cover) blocks.push(imageBlock(imageUrl, cover, alt));
  else if (imageUrl && cover !== undefined) notes.push('no picture: its size could not be read');
  if (description) blocks.push(text(description));
  const key = guidePoints(body);
  if (key) {
    if (key.heading) blocks.push({ ...text(key.heading), formatting: [{ start: 0, end: key.heading.length, type: 'bold' }] });
    for (const p of key.points) blocks.push(text(p, 'ordered-list-item'));
  }
  blocks.push(linkBlock(`${site}${path}?utm_source=${account.subid}&utm_medium=social&utm_campaign=${g.slug}`, 'Read the guide on Save and Play', account.linkStyle));
  return { post: { content: blocks, tags: buildTags(account, 'article', { slug: g.slug }) }, path, title: clip(title, 300), imageUrl, notes };
}

// Does the page open on the live site (200)? TUMBLR_PAGE_BASE replaces the site address, for tests only.
export async function pageLive(site, path) {
  const url = `${process.env.TUMBLR_PAGE_BASE || site}${path}`;
  let reason = 'no answer';
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'saveandplay-tumblr (page check)' } });
      await r.body?.cancel();
      if (r.status === 200) return { ok: true, url };
      reason = `HTTP ${r.status}`;
      if (r.status === 404) break;
    } catch (e) {
      reason = reasonOf(e);
    }
  }
  return { ok: false, url, reason };
}

// A recent post of the blog that already carries our page (the second guard against a double post, when the record was lost).
// pathname = path of our page (/deals/gog/x/ or /guides/x/); maxAgeHours = only newer posts count (null = any age, for a guide).
export function ownPost(posts, { site, pathname, maxAgeHours = null, now = Date.now() }) {
  let siteHost = '';
  try {
    siteHost = new URL(site).host;
  } catch {
    siteHost = '';
  }
  return (
    posts.find((p) => {
      const hit = p.links.some((l) => {
        try {
          const u = new URL(l);
          return u.host === siteHost && u.pathname === pathname;
        } catch {
          return false;
        }
      });
      if (!hit) return false;
      if (maxAgeHours !== null) return p.timestamp && (now - p.timestamp) / HOUR <= maxAgeHours;
      return true;
    }) ?? null
  );
}

// ---------- finding blogs to follow (READ ONLY: nothing is followed, liked or posted) ----------
// The settings of a THEME (data/tumblr-themes.json): broad tags of a whole subject (games, travel), not of a narrow niche. Blogs point to a theme by "theme"
// in data/tumblr-accounts.json. One search per theme serves every blog of that theme. The program reads the newest public posts of each tag (/v2/tagged),
// groups them by blog, drops what is not worth following, and ranks the rest. A human opens the list and presses Follow.

export const THEME_FILE = 'data/tumblr-themes.json';
export const THEME_DEFAULTS = { blockTags: [], avoidTags: [], blockWords: [], topicWords: [], skip: [], maxAgeDays: 14, maxMedianNotes: 1500, minOriginalPosts: 1, pagesPerTag: 3, top: 20, verifyTop: 40, minOnTopic: 0.3 };
export const withThemeDefaults = (t) => ({ ...THEME_DEFAULTS, ...(t ?? {}) });

// What is wrong with a theme: plain sentences (empty = fine).
export function themeProblems(theme) {
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return ['the theme is missing or is not an object'];
  const t = withThemeDefaults(theme);
  const bad = [];
  if (!Array.isArray(t.tags) || !t.tags.length || !t.tags.every(TAG_OK)) bad.push('"tags" must be a list of at least one tag (no commas, no #)');
  for (const k of ['blockTags', 'avoidTags', 'blockWords', 'topicWords']) if (!Array.isArray(t[k]) || !t[k].every((x) => typeof x === 'string' && x.trim())) bad.push(`"${k}" must be a list of words`);
  if (typeof t.minOnTopic !== 'number' || !(t.minOnTopic >= 0 && t.minOnTopic <= 1)) bad.push('"minOnTopic" must be a number from 0 to 1');
  if (!Array.isArray(t.skip) || !t.skip.every((x) => typeof x === 'string' && BLOG_RE.test(x))) bad.push('"skip" must be a list of blog names (letters, digits, -)');
  for (const [k, min, max] of [['maxAgeDays', 1, 90], ['maxMedianNotes', 1, 1e6], ['minOriginalPosts', 0, 100], ['pagesPerTag', 1, 10], ['top', 1, 100], ['verifyTop', 0, 100]]) {
    if (!Number.isInteger(t[k]) || t[k] < min || t[k] > max) bad.push(`"${k}" must be a whole number from ${min} to ${max}`);
  }
  return bad;
}

// A tag is blocked when it equals a blocked word or, for words of 4+ letters, contains it ("sissy training" is hit by "sissy"). block = a Set of lower-case words.
export const tagBlocked = (tag, block) => {
  const t = String(tag).toLowerCase();
  return block.has(t) || [...block].some((w) => w.length >= 4 && t.includes(w));
};

// Posts (from taggedPosts, each marked with viaTag = the tag it was found by) -> { list, dropped, blogsSeen }.
// A blog is dropped when: it is on the skip list or is the own blog; adult content (a post carries a blockTag, or Tumblr marks the blog); half of its posts
// carry avoidTags (art, anime...); it has no own post (only reblogs); it is too big (median notes above maxMedianNotes). Posts older than maxAgeDays are not
// counted, so a blog that has gone quiet never shows up. Ranking: own posts count 3, every post 1, every tag it was found by 2.
export function rankBlogs(posts, theme, { now = Date.now(), skip = [] } = {}) {
  const t = withThemeDefaults(theme);
  const low = (a) => (a ?? []).map((x) => String(x).toLowerCase());
  const skipSet = new Set([...low(t.skip), ...low(skip)]);
  const block = new Set(low(t.blockTags));
  const avoid = new Set(low(t.avoidTags));
  const since = now - t.maxAgeDays * 864e5;
  const blogs = new Map();
  for (const p of posts ?? []) {
    if (!p?.blog || !Number.isFinite(p.timestamp) || p.timestamp < since) continue;
    const key = p.blog.toLowerCase();
    const b = blogs.get(key) ?? { blog: p.blog, title: '', description: '', url: null, posts: new Map(), via: new Set(), adult: false };
    b.title ||= p.title ?? '';
    b.description ||= p.description ?? '';
    b.url ||= p.url ?? null;
    b.adult ||= Boolean(p.adult);
    b.posts.set(p.postUrl ?? String(p.timestamp), p); // the same post comes from several tags: counted once
    if (p.viaTag) b.via.add(p.viaTag);
    blogs.set(key, b);
  }
  const dropped = {};
  const drop = (why) => {
    dropped[why] = (dropped[why] ?? 0) + 1;
  };
  const list = [];
  for (const [key, b] of blogs) {
    const ps = [...b.posts.values()];
    const tagsOf = (p) => low(p.tags);
    if (skipSet.has(key)) {
      drop('already known or your own blog');
      continue;
    }
    if (b.adult || ps.some((p) => tagsOf(p).some((x) => tagBlocked(x, block)))) {
      drop('adult content');
      continue;
    }
    if (ps.filter((p) => tagsOf(p).some((x) => avoid.has(x))).length / ps.length >= 0.5) {
      drop('mostly off-topic (art, anime...)');
      continue;
    }
    const originals = ps.filter((p) => p.original).length;
    if (originals < t.minOriginalPosts) {
      drop('only reblogs, no own posts');
      continue;
    }
    const notes = ps.map((p) => p.notes ?? 0).sort((x, y) => x - y);
    const median = notes[Math.floor((notes.length - 1) / 2)];
    if (median > t.maxMedianNotes) {
      drop('too big (thousands of notes)');
      continue;
    }
    const newest = ps.reduce((a, p) => (p.timestamp > a.timestamp ? p : a));
    list.push({ blog: b.blog, title: b.title, description: b.description, url: b.url ?? `https://${b.blog}.tumblr.com/`, posts: ps.length, originals, medianNotes: median, tags: [...b.via], newest: newest.timestamp, newestUrl: newest.postUrl, score: originals * 3 + ps.length + b.via.size * 2 });
  }
  list.sort((a, b) => b.score - a.score || b.newest - a.newest || a.blog.localeCompare(b.blog));
  return { list, dropped, blogsSeen: blogs.size };
}

// Is the word in the text as a whole word? "18+" is found in "F 33 18+" but not in "v118+ mods"; "nsfw" is found in "no nsfw" but not in "unsfwed". text is lower case.
const wordIn = (text, w) => new RegExp(`(?<![\\p{L}\\p{N}])${String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(text);

// SECOND LOOK at a blog that passed rankBlogs: its last posts (from blogPosts). The tag search sees only the posts that carry the theme's tags, so a blog that
// misuses a tag (adult content with #steam on a few posts) looks fine there. Here the whole recent blog is judged: { ok, reason, share, posts, newest }.
// Dropped: no public posts; adult (Tumblr marks the blog, a blockWord in its title or description, a blockTag anywhere in its tags); no post within maxAgeDays;
// less than minOnTopic of its posts carry a tag with one of the topicWords (checked only when the theme has topicWords).
export function profileCheck(profile, theme, { now = Date.now() } = {}) {
  const t = withThemeDefaults(theme);
  const low = (a) => (a ?? []).map((x) => String(x).toLowerCase());
  const block = new Set(low(t.blockTags));
  const words = low(t.blockWords);
  const topic = low(t.topicWords);
  const posts = profile?.posts ?? [];
  const info = profile?.info ?? {};
  if (!posts.length) return { ok: false, reason: 'no public posts' };
  const text = `${info.title ?? ''} ${info.description ?? ''}`.replace(/<[^>]+>/g, ' ').replace(/[’‘]/g, "'").toLowerCase();
  if (info.adult || words.some((w) => wordIn(text, w)) || posts.some((p) => low(p.tags).some((x) => tagBlocked(x, block)))) return { ok: false, reason: 'adult content' };
  const newest = Math.max(...posts.map((p) => p.timestamp ?? 0));
  if (newest < now - t.maxAgeDays * 864e5) return { ok: false, reason: 'no new posts lately' };
  let share = null;
  if (topic.length) {
    share = posts.filter((p) => low(p.tags).some((x) => topic.some((w) => x.includes(w)))).length / posts.length;
    if (share < t.minOnTopic) return { ok: false, reason: 'not mostly about the subject', share };
  }
  return { ok: true, share, posts: posts.length, newest };
}
