// Shared code of the Lemmy scripts (post-lemmy, lemmy-check, lemmy-secret). See LEMMY.md (everything about Lemmy is described there).
// Settings: data/lemmy-accounts.json (instance, user, communities, profile, autopost) and the block with the same name in data/accounts.json
// (the deal rules of the daily brief: stores, minimum discount, subid). No AI, no paid API.
//
// Rule for every function here: the password and the login token (JWT) are never printed and never put in an error message.
// The password is read from the environment (GitHub Secret) or from the local .env file, and used only to log in.
//
// For tests the root folder can be changed with LEMMY_ROOT (the folder that holds data/, public/, drafts/, src/, .env),
// and the address of the server with LEMMY_API_BASE (instead of https://<instance>).

import { readFileSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { splitArticle } from '../article-tools.mjs';

export const ROOT = process.env.LEMMY_ROOT ? resolve(process.env.LEMMY_ROOT) : fileURLToPath(new URL('../../', import.meta.url));
export const file = (rel) => resolve(ROOT, rel);

// The two kinds of posts (the same as for Nostr): one DEAL a day, and a guide of the site (ARTICLE) every few days.
export const KINDS = ['deal', 'article'];
// The label of a deal post, plain text and the LAST line of the body (PROJECT.md section 5: a post with an affiliate link must be marked).
// Articles have no label: they link to our own guide, not to a store.
export const DISCLOSURE = 'Ad: we may earn a commission if you buy.';
export const MAX_TITLE = 200; // Lemmy refuses longer post titles
export const DEFAULT_TITLE = '{title}: -{discount}% at {store} ({price}, was {was})';
const TITLE_WORDS = ['title', 'discount', 'store', 'price', 'was'];
const HOUR = 3600e3;
const UA = 'saveandplay-lemmy (+https://saveandplay.com)';

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

// The password of an account, or null if none is set. Environment first (GitHub Secret), then the local .env file.
export const loadPassword = (passwordEnv) => (process.env[passwordEnv] || readEnvValue(file('.env'), passwordEnv) || '').trim() || null;

// All Lemmy accounts: { id, account, links } with defaults filled in. The settings of data/lemmy-accounts.json are joined with the block of the
// same name in data/accounts.json (that block is what the daily brief reads to choose the deal and to make the link).
export function lemmyAccounts(only = null) {
  const cfg = readJson('data/accounts.json');
  const lemmy = readJson('data/lemmy-accounts.json');
  const out = [];
  for (const [id, settings] of Object.entries(lemmy.accounts ?? {})) {
    if (only && id !== only) continue;
    const brief = cfg.accounts?.[id];
    if (!brief) throw new Error(`"${id}" is in data/lemmy-accounts.json but not in data/accounts.json (the daily brief takes its deal rules from there).`);
    out.push({ id, account: withLemmyDefaults(id, { ...brief, ...settings }), links: cfg.links });
  }
  if (only && !out.length) throw new Error(`No Lemmy account "${only}" in data/lemmy-accounts.json.`);
  return out;
}

export function withLemmyDefaults(id, a) {
  const passwordEnv = a.passwordEnv || (id === 'lemmy' ? 'LEMMY_PASSWORD' : `LEMMY_PASSWORD_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`);
  const communities = (a.communities ?? []).map((c) => ({ enabled: true, ...c }));
  return { autopost: false, maxPriceAgeHours: 48, maxBriefAgeHours: 12, timezone: 'America/Bogota', articleEveryDays: 2, retryDays: 3, ...a, passwordEnv, communities };
}

const COMMUNITY_RE = /^[a-z0-9_]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;
const HOST_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;
const USER_RE = /^[a-z0-9_]{3,20}$/i;

// What is wrong with the settings of an account: a list of plain sentences (empty = fine). The scripts that talk to the server refuse to run with problems.
export function configProblems(account) {
  const bad = [];
  if (!HOST_RE.test(account.instance ?? '')) bad.push('"instance" must be the address of the server without https://, for example lemmy.world');
  if (!USER_RE.test(account.username ?? '')) bad.push('"username" must be the Lemmy user name (3-20 letters, digits or _, without @)');
  if (!Number.isInteger(account.articleEveryDays) || account.articleEveryDays < 1) bad.push('"articleEveryDays" must be a whole number, 1 or more');
  if (!Number.isInteger(account.retryDays) || account.retryDays < 0) bad.push('"retryDays" must be a whole number, 0 or more');
  if (account.apiVersion && !['v3', 'v4'].includes(account.apiVersion)) bad.push('"apiVersion" must be "v3" or "v4" (or left out: the program finds it out itself)');
  const seen = new Set();
  for (const c of account.communities ?? []) {
    const name = String(c.community ?? '');
    if (!COMMUNITY_RE.test(name)) bad.push(`community "${name}" must look like name@server (for example gamedeals@compuverse.uk)`);
    if (seen.has(name.toLowerCase())) bad.push(`community "${name}" is listed twice`);
    seen.add(name.toLowerCase());
    if (!Array.isArray(c.kinds) || !c.kinds.length || c.kinds.some((k) => !KINDS.includes(k))) bad.push(`community "${name}": "kinds" must be a list of ${KINDS.map((k) => `"${k}"`).join(' and/or ')}`);
    if (c.titleTemplate !== undefined) {
      const words = [...String(c.titleTemplate).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const unknown = words.filter((w) => !TITLE_WORDS.includes(w));
      if (unknown.length || !words.includes('title')) bad.push(`community "${name}": "titleTemplate" needs {title} and may use only ${TITLE_WORDS.map((w) => `{${w}}`).join(' ')}${unknown.length ? ` (not valid: ${unknown.map((w) => `{${w}}`).join(' ')})` : ''}`);
    }
    if (c.languageId !== undefined && !Number.isInteger(c.languageId)) bad.push(`community "${name}": "languageId" must be a whole number (English is 37)`);
  }
  return bad;
}

// The communities of an account that take this kind of post: { community, kinds, enabled, ... }.
export const communitiesFor = (account, kind) => (account.communities ?? []).filter((c) => c.kinds?.includes(kind));
export const handleOf = (account) => `@${account.username}@${account.instance}`;
export const postPage = (instance, id) => `https://${instance}/post/${id}`;

// ---------- small helpers ----------

export const reasonOf = (e) => String(e?.message ?? e ?? 'unknown error').replace(/\s+/g, ' ').trim().slice(0, 200) || 'unknown error';
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

// ---------- the Lemmy server ----------
// Lemmy 0.19 speaks API "v3", Lemmy 1.0 speaks "v4" (v3 still answers there for a while). The program asks v4 first and falls back to v3, so a server
// that is updated does not break the bot. Login gives a token (JWT) that goes in the "Authorization: Bearer" header.

const ROUTES = {
  v3: { site: '/api/v3/site', login: '/api/v3/user/login', community: '/api/v3/community', resolve: '/api/v3/resolve_object', post: '/api/v3/post', posts: '/api/v3/post/list', settings: '/api/v3/user/save_user_settings', me: '/api/v3/site' },
  v4: { site: '/api/v4/site', login: '/api/v4/account/auth/login', community: '/api/v4/community', resolve: '/api/v4/resolve_object', post: '/api/v4/post', posts: '/api/v4/post/list', settings: '/api/v4/account/settings', me: '/api/v4/account' },
};

// What the owner can do about the error codes a Lemmy server gives. The code itself is always shown too.
const HINTS = [
  [/^incorrect_login$/, 'The user name or the password is wrong. Check "username" in data/lemmy-accounts.json and the password (npm run lemmy:secret sends it to GitHub).'],
  [/^email_not_verified$/, 'The account has not confirmed its e-mail yet: open the message from the server and click the link.'],
  [/^registration_application_is_pending$/, 'The server has not approved the registration yet. Wait for its admins.'],
  [/^registration_denied$/, 'The server denied the registration. Choose another server ("instance" in data/lemmy-accounts.json).'],
  [/totp/, 'The account has two-factor login switched on, and the bot cannot use it. Switch it off for this account.'],
  [/^site_ban$|^deleted$/, 'The account is banned or deleted on its server.'],
  [/^rate_limit_error$|^http_429$/, 'The server limits how fast posts can be made. The next run tries again; do not add many communities at once.'],
  [/language_not_allowed/, 'The community does not take posts in this language. Set "languageId" for the community in data/lemmy-accounts.json (English is 37).'],
  [/only_mods_can_post/, 'Only moderators may post in this community. Switch it off in data/lemmy-accounts.json.'],
  [/banned_from_community|community_ban/, 'The account is banned from this community. Switch it off in data/lemmy-accounts.json.'],
  [/nsfw/, 'The server does not allow this kind of post here.'],
  [/blocked_url|invalid_url/, 'The server refuses this web address (blocked or not valid).'],
  [/couldnt_find_community|couldnt_find_object|not_found|^http_404$/, 'The server does not know this community. Check the name and the server in data/lemmy-accounts.json.'],
  [/post_title|title_too_long|too_long/, 'The text is too long for the server.'],
];
export const hintFor = (code) => HINTS.find(([re]) => re.test(String(code ?? '')))?.[1] ?? null;

export class LemmyError extends Error {
  constructor(message, { code = 'error', status = 0 } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// A client for one server. fetchImpl is replaceable for tests. Nothing here prints; errors never contain the password or the token.
export function createClient(instance, { fetchImpl = globalThis.fetch, timeoutMs = Number(process.env.LEMMY_TIMEOUT_MS) || 20000, retryMs = Number(process.env.LEMMY_RETRY_MS) || 1500 } = {}) {
  const origin = process.env.LEMMY_API_BASE || `https://${instance}`;
  let api = null;
  let jwt = null;
  const routes = () => {
    if (!api) throw new LemmyError('the server was not asked yet (detect first)', { code: 'not_ready' });
    return ROUTES[api];
  };

  // GET is repeated on a network error, 429 and 5xx. A POST/PUT never is: the post may have gone through, and the next run finds it on the server.
  async function call(method, route, { query, body, auth = false } = {}) {
    const url = new URL(route, origin);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers = { accept: 'application/json', 'user-agent': UA };
    if (body) headers['content-type'] = 'application/json';
    if (auth) {
      if (!jwt) throw new LemmyError('not logged in', { code: 'not_logged_in' });
      headers.authorization = `Bearer ${jwt}`;
    }
    const tries = method === 'GET' ? 3 : 1;
    let last;
    for (let i = 0; i < tries; i++) {
      if (i) await sleep(retryMs * i);
      let r;
      let text;
      try {
        r = await fetchImpl(url, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
        text = await r.text();
      } catch (e) {
        last = new LemmyError(`${route}: no answer (${e?.name === 'TimeoutError' ? 'timed out' : reasonOf(e)})`, { code: 'network' });
        continue;
      }
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (r.ok) {
        if (json === null || typeof json !== 'object') throw new LemmyError(`${route}: the answer is not JSON, so this is not a Lemmy server`, { code: 'not_json', status: r.status });
        return json;
      }
      const code = typeof json?.error === 'string' ? json.error : typeof json?.message === 'string' ? json.message.slice(0, 60) : `http_${r.status}`;
      last = new LemmyError(`${route}: ${code}${typeof json?.message === 'string' && json.error ? ` (${json.message.slice(0, 120)})` : ''}`, { code, status: r.status });
      if (!(r.status === 429 || r.status >= 500)) break;
    }
    throw last;
  }

  return {
    get api() {
      return api;
    },
    origin,

    // Finds out which API the server speaks. force = "v3" or "v4" from the settings; null = ask v4, then v3.
    async detect(force = null) {
      let last;
      for (const v of force ? [force] : ['v4', 'v3']) {
        try {
          const site = await call('GET', ROUTES[v].site);
          if (typeof site.version === 'string' || site.site_view || site.site) {
            api = v;
            return { api: v, version: typeof site.version === 'string' ? site.version : null, site };
          }
        } catch (e) {
          last = e;
        }
      }
      throw new LemmyError(`${instance} does not answer like a Lemmy server (${reasonOf(last)})`, { code: last?.code === 'network' ? 'network' : 'not_lemmy' });
    },

    async login(username, password) {
      const r = await call('POST', routes().login, { body: { username_or_email: username, password } });
      if (!r.jwt) {
        const code = r.verify_email_sent ? 'email_not_verified' : r.registration_created ? 'registration_application_is_pending' : 'no_token';
        throw new LemmyError(`login: ${code}`, { code });
      }
      jwt = r.jwt;
    },

    // The community name@server as the server of the account sees it. A community the server does not know yet is fetched by resolve_object.
    async community(name) {
      let view;
      try {
        view = (await call('GET', routes().community, { query: { name }, auth: Boolean(jwt) })).community_view;
      } catch (e) {
        if (!/couldnt_find|not_found|^http_404$/.test(e.code)) throw e;
        view = (await call('GET', routes().resolve, { query: { q: `!${name}` }, auth: Boolean(jwt) })).community;
      }
      const c = view?.community;
      if (!c?.id) throw new LemmyError(`community ${name}: the server did not return it`, { code: 'couldnt_find_community' });
      let host = '';
      try {
        host = new URL(c.actor_id).host;
      } catch {
        host = '';
      }
      return { id: c.id, name: c.name, host, title: c.title ?? c.name, apId: c.actor_id ?? null, restricted: Boolean(c.posting_restricted_to_mods), removed: Boolean(c.removed), deleted: Boolean(c.deleted), nsfw: Boolean(c.nsfw), subscribers: view.counts?.subscribers ?? null };
    },

    // The newest posts of a community, as { id, name, url, published, creator, creatorHost }.
    async recentPosts(communityId, limit = 50) {
      const r = await call('GET', routes().posts, { query: { community_id: communityId, sort: 'New', limit, type_: 'All' }, auth: Boolean(jwt) });
      return (r.posts ?? []).map((v) => {
        let creatorHost = '';
        try {
          creatorHost = new URL(v.creator?.actor_id).host;
        } catch {
          creatorHost = '';
        }
        return { id: v.post?.id, name: v.post?.name, url: v.post?.url ?? null, published: v.post?.published ?? v.post?.published_at ?? null, creator: v.creator?.name ?? null, creatorHost };
      });
    },

    async createPost(fields) {
      const r = await call('POST', routes().post, { body: fields, auth: true });
      const post = r.post_view?.post ?? r.post;
      if (!post?.id) throw new LemmyError('the server accepted the post but did not return its id', { code: 'no_post_id' });
      return { id: post.id, apId: post.ap_id ?? null };
    },

    // The profile of the logged-in user (person) or null.
    async me() {
      const r = await call('GET', routes().me, { auth: true });
      return r.my_user?.local_user_view?.person ?? r.local_user_view?.person ?? r.person ?? null;
    },

    async saveSettings(fields) {
      await call('PUT', routes().settings, { body: fields, auth: true });
    },
  };
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

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

// The post of a deal from the first candidate of the brief: only its numbers and dates, nothing invented, nothing rounded.
// name = title, url = our own page of the game (never a store), body = markdown, the "Ad:" line last. The cover is the thumbnail, with its alt text.
export function buildDealPost(c, titleTemplate = DEFAULT_TITLE) {
  check(c);
  const name = clip(fill(titleTemplate, { title: c.title, discount: c.discount, store: c.store, price: money(c.price), was: money(c.was) }).replace(/\s+/g, ' ').trim(), MAX_TITLE);
  const paras = [`**${money(c.price)}** (was ${money(c.was)}) at ${c.store}, -${c.discount}%.`, `Price checked ${stamp(c.priceCheckedAt)}.${c.endsAt ? ` Sale ends ${stamp(c.endsAt)}.` : ''}`];
  const why = whyLine(c);
  if (why) paras.push(why);
  paras.push(DISCLOSURE);
  const body = paras.join('\n\n');
  if (!body.split('\n').includes(DISCLOSURE) || !body.trimEnd().endsWith(DISCLOSURE)) throw new Error('A deal post has no "Ad:" line at the end. It is not allowed to post without it.');
  const post = { name, url: c.link, body };
  if (c.cover) {
    post.custom_thumbnail = c.cover;
    post.alt_text = clip(String(c.coverAlt || `Cover art for ${c.title}`), 1000); // every meaningful picture has an alt text
  }
  return post;
}

// ---------- the guides of the site ----------

export const GUIDES = 'src/pages/guides';

// Every guide: { slug, text, updated, off }, oldest first. "lemmy: false" in the header of a guide keeps it out of Lemmy.
export function listGuides() {
  const dir = file(GUIDES);
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.md')) : [];
  const out = names.map((n) => {
    const slug = n.slice(0, -3);
    const text = readFileSync(file(`${GUIDES}/${n}`), 'utf8');
    const fm = splitArticle(text).fm ?? {};
    const updated = /^\d{4}-\d{2}-\d{2}/.test(String(fm.updated ?? '')) ? String(fm.updated).slice(0, 10) : null;
    return { slug, text, updated, off: String(fm.lemmy ?? '').trim().toLowerCase() === 'false' };
  });
  return out.sort((a, b) => (a.updated ?? '9999').localeCompare(b.updated ?? '9999') || a.slug.localeCompare(b.slug));
}

// The post of a guide from its header: title, description, picture. The link carries the marks of the account (utm_source = subid).
// Returns { post, path, notes }. Throws with a plain reason when the guide cannot become a post.
export function buildArticlePost(g, account, site) {
  const { fm } = splitArticle(g.text);
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
  const post = { name: clip(title, MAX_TITLE), url: `${site}${path}?utm_source=${account.subid}&utm_medium=social&utm_campaign=${g.slug}` };
  if (description) post.body = description;
  const image = String(fm.image ?? '').trim();
  const alt = String(fm.imageAlt ?? '').trim();
  if (!image) notes.push('no picture: the header has no image');
  else if (!/^\/[^\s?#]+$/.test(image)) notes.push(`no picture: image "${image}" is not a site path`);
  else if (!alt) notes.push('no picture: the header has no imageAlt');
  else if (!existsSync(file(`public${image}`))) notes.push(`no picture: public${image} does not exist`);
  else {
    post.custom_thumbnail = `${site}${image}`;
    post.alt_text = clip(alt, 1000);
  }
  return { post, path, notes };
}

// Does the page open on the live site (200)? LEMMY_PAGE_BASE replaces the site address, for tests only.
export async function pageLive(site, path) {
  const url = `${process.env.LEMMY_PAGE_BASE || site}${path}`;
  let reason = 'no answer';
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'saveandplay-lemmy (page check)' } });
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

// A post of OUR account in a list of recent posts that already carries our page (the second guard against a double post, when the record was lost).
// pathname = path of our page (/deals/gog/x/ or /guides/x/); maxAgeHours = only newer posts count (null = any age, for a guide).
export function ownPost(posts, { username, instance, site, pathname, maxAgeHours = null, now = Date.now() }) {
  let siteHost = '';
  try {
    siteHost = new URL(site).host;
  } catch {
    siteHost = '';
  }
  return (
    posts.find((p) => {
      if (!p.url || String(p.creator ?? '').toLowerCase() !== username.toLowerCase()) return false;
      if (p.creatorHost && p.creatorHost.toLowerCase() !== instance.toLowerCase()) return false;
      let u;
      try {
        u = new URL(p.url);
      } catch {
        return false;
      }
      if (u.host !== siteHost || u.pathname !== pathname) return false;
      if (maxAgeHours !== null) return p.published && hoursSince(p.published, now) <= maxAgeHours;
      return true;
    }) ?? null
  );
}

// ---------- the profile ----------

// What goes into the profile of the account: display name (20 characters at most), bio (300), the bot flag, avatar and banner (full https addresses).
export function buildProfile(account) {
  const p = account.profile ?? {};
  const bad = [];
  if (!String(p.displayName ?? '').trim()) bad.push('profile.displayName');
  else if (p.displayName.length > 20) bad.push('profile.displayName is longer than 20 characters');
  if (!String(p.bio ?? '').trim()) bad.push('profile.bio');
  else if (p.bio.length > 300) bad.push(`profile.bio is ${p.bio.length} characters, the server takes 300 at most`);
  for (const k of ['avatar', 'banner']) if (p[k] && !/^https:\/\/[^\s]+$/.test(p[k])) bad.push(`profile.${k} must be a full https address`);
  if (bad.length) throw new Error(`The profile of the account is not complete or not valid: ${bad.join(', ')} (data/lemmy-accounts.json).`);
  // "bot_account" is the flag Lemmy shows as a BOT badge. The posts are automated, so it is ON unless profile.bot is false.
  return { display_name: p.displayName.trim(), bio: p.bio.trim(), bot_account: p.bot !== false, ...(p.avatar ? { avatar: p.avatar } : {}), ...(p.banner ? { banner: p.banner } : {}) };
}
