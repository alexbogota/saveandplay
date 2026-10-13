// Finds fresh Bluesky posts where a short, helpful reply from our account would fit. It never posts, likes or follows anything.
//
// The rules (which words to skip, how to score) are in data/comments-accounts.json, one block per account. The code has no account in it.
// The login uses a Bluesky "app password" from the environment (GitHub Secret) or from the local .env file. It is used only to log in and is never printed.
// For tests the root folder can be changed with COMMENTS_ROOT and the server with BSKY_API_BASE.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.COMMENTS_ROOT ? resolve(process.env.COMMENTS_ROOT) : fileURLToPath(new URL('../../', import.meta.url));
export const file = (...parts) => resolve(ROOT, ...parts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lc = (s) => String(s ?? '').toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Value of NAME in a .env file (KEY=value lines, optional quotes). Null if the file or the key is missing.
export function readEnvValue(path, name) {
  if (!existsSync(path)) return null;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || m[1] !== name) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  }
  return null;
}
export const loadPassword = (name) => (process.env[name] || readEnvValue(file('.env'), name) || '').trim() || null;

// The last part of a post link or at:// address (the post's own id), lower case. Used to recognise the same post in any spelling.
export const postKey = (s) => String(s ?? '').split(/[/?#]/).filter(Boolean).pop()?.toLowerCase() ?? '';

// Posts that Claude already showed to the owner (answered or not): every drafts/comments-shown-<account>.json and
// drafts/comments-shown-<account>-*.json, each a JSON array of post links (bsky.app links or at:// addresses). A broken file is ignored.
export function loadShown(id) {
  const dir = file('drafts');
  const keys = new Set();
  if (!existsSync(dir)) return keys;
  for (const f of readdirSync(dir)) {
    if (!(f === `comments-shown-${id}.json` || (f.startsWith(`comments-shown-${id}-`) && f.endsWith('.json')))) continue;
    try {
      for (const x of JSON.parse(readFileSync(resolve(dir, f), 'utf8'))) {
        const k = postKey(typeof x === 'string' ? x : x?.url ?? x?.uri);
        if (k) keys.add(k);
      }
    } catch { /* ignore */ }
  }
  return keys;
}

const DEFAULTS = { enabled: true, language: 'en', maxAgeHours: 30, minChars: 30, maxChars: 600, queriesPerRun: 4, perQuery: 40, maxCandidates: 12, maxHeated: 3, minScore: 5 };
export const withDefaults = (a) => ({ ...DEFAULTS, ...a, handle: String(a.handle ?? '').replace(/^@/, '') });

export function commentAccounts(only = null) {
  const all = JSON.parse(readFileSync(file('data', 'comments-accounts.json'), 'utf8')).accounts ?? {};
  const ids = only ? [only] : Object.keys(all);
  return ids.map((id) => {
    if (!all[id]) throw new Error(`no account "${id}" in data/comments-accounts.json`);
    return { id, account: withDefaults(all[id]) };
  });
}

export function configProblems(a) {
  const p = [];
  if (!a.handle) p.push('handle is missing');
  if (!a.passwordEnv) p.push('passwordEnv is missing (the name of the variable that holds the app password)');
  const g = a.groups;
  if (!g || !Object.keys(g).length) p.push('groups is empty');
  else for (const [k, v] of Object.entries(g)) if (!Array.isArray(v?.queries) || !v.queries.length) p.push(`group "${k}" has no queries`);
  return p;
}

// ---- Bluesky (read only) ----------------------------------------------------------------------------------------
export function createApi({ fetchImpl = globalThis.fetch, base = process.env.BSKY_API_BASE || 'https://bsky.social', timeoutMs = Number(process.env.COMMENTS_TIMEOUT_MS) || 20000, retryMs = Number(process.env.COMMENTS_RETRY_MS) || 2000 } = {}) {
  let jwt = null;
  async function call(path, { method = 'GET', params, body } = {}, attempt = 0) {
    const url = new URL(`/xrpc/${path}`, base);
    for (const [k, v] of Object.entries(params ?? {})) if (v != null) url.searchParams.set(k, String(v));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, { method, headers: { 'content-type': 'application/json', ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    } catch (e) {
      clearTimeout(timer);
      if (attempt < 1) { await sleep(retryMs); return call(path, { method, params, body }, attempt + 1); }
      throw Object.assign(new Error(`cannot reach ${base}: ${e.message}`), { code: 'network' });
    }
    clearTimeout(timer);
    if ((res.status === 429 || res.status >= 500) && attempt < 1) { await sleep(retryMs); return call(path, { method, params, body }, attempt + 1); }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok) throw Object.assign(new Error(json?.message || json?.error || `HTTP ${res.status}`), { code: res.status === 401 ? 'auth' : `http-${res.status}`, status: res.status });
    return json;
  }
  return {
    async login(identifier, password) {
      const j = await call('com.atproto.server.createSession', { method: 'POST', body: { identifier, password } });
      jwt = j?.accessJwt || null;
      if (!jwt) throw Object.assign(new Error('login gave no token'), { code: 'auth' });
    },
    async search(q, { since, limit = 40, lang = 'en' } = {}) {
      const j = await call('app.bsky.feed.searchPosts', { params: { q, sort: 'latest', limit, lang, since } });
      return j?.posts ?? [];
    },
    // Posts our account already answered (the post it answered and the top of its thread), so they are never offered again.
    async ownReplied(handle, limit = 50) {
      const j = await call('app.bsky.feed.getAuthorFeed', { params: { actor: handle, filter: 'posts_with_replies', limit } });
      const out = new Set();
      for (const it of j?.feed ?? []) {
        if (lc(it?.post?.author?.handle) !== lc(handle) || !it.reply) continue;
        if (it.reply.parent?.uri) out.add(it.reply.parent.uri);
        if (it.reply.root?.uri) out.add(it.reply.root.uri);
      }
      return out;
    },
  };
}

// ---- choosing posts ---------------------------------------------------------------------------------------------
const BAD_LABELS = new Set(['porn', 'sexual', 'nudity', 'graphic-media', 'gore']);
const hasAny = (text, words) => (words ?? []).find((w) => text.includes(lc(w))) ?? null;
export const webUrl = (post) => `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split('/').pop()}`;

// keep:true with a candidate, or keep:false with the reason (the reasons are counted in the report so the rules can be tuned).
export function evaluate(post, cfg, { now = Date.now(), group = null, query = null, ownReplied = new Set(), shown = new Set() } = {}) {
  const no = (reason) => ({ keep: false, reason });
  const rec = post?.record ?? {};
  const text = String(rec.text ?? '').replace(/\s+/g, ' ').trim();
  const low = lc(text);
  const handle = post?.author?.handle ?? '';
  const name = lc(post?.author?.displayName);
  if (!post?.uri || !text || !handle) return no('empty');
  if (lc(handle) === lc(cfg.handle)) return no('own post');
  if (ownReplied.has(post.uri)) return no('already answered');
  if (shown.has(postKey(post.uri))) return no('already shown');
  const created = Date.parse(rec.createdAt ?? post.indexedAt ?? '');
  if (!Number.isFinite(created)) return no('no date');
  const ageH = (now - created) / 36e5;
  if (ageH > cfg.maxAgeHours) return no('too old');
  if (ageH < -1) return no('date in the future');
  const langs = rec.langs;
  if (Array.isArray(langs) && langs.length && !langs.some((l) => lc(l).startsWith(cfg.language))) return no('other language');
  const labels = [...(post.labels ?? []), ...(post.author?.labels ?? [])].map((l) => lc(l?.val));
  if (labels.some((l) => BAD_LABELS.has(l))) return no('adult or graphic label');
  if (Array.isArray(post.threadgate?.record?.allow)) return no('replies are limited');
  const who = lc(handle.split('.')[0]);
  if ((cfg.skipAuthorWords ?? []).some((w) => who.includes(lc(w)) || new RegExp(`(^|[^a-z0-9])${esc(lc(w))}([^a-z0-9]|$)`).test(name))) return no('bot, shop or studio');
  if (text.length < cfg.minChars) return no('too short');
  if (text.length > cfg.maxChars) return no('too long');
  if (hasAny(low, cfg.skipWords) || hasAny(name, cfg.skipWords)) return no('skip word');
  if (cfg.requireAnyWord?.length && !hasAny(low, cfg.requireAnyWord)) return no('not about games');
  const links = (rec.facets ?? []).flatMap((f) => f.features ?? []).filter((x) => String(x?.$type).endsWith('#link')).length;
  if (links > 1) return no('many links');

  const likes = post.likeCount ?? 0;
  const replies = post.replyCount ?? 0;
  const g = cfg.groups?.[group] ?? {};
  const question = text.includes('?') || !!hasAny(low, cfg.questionWords);
  const topic = !!hasAny(low, cfg.topicWords);
  let score = (g.weight ?? 1);
  if (question) score += 3;
  if (topic) score += 2;
  if (replies <= 2) score += 1;
  if (replies > 15) score -= 2;
  if (likes >= 1 && likes <= 30) score += 1;
  if (ageH <= 6) score += 1;
  if (score < cfg.minScore) return no('low score');
  const heated = !!g.heated || (cfg.heatedPatterns ?? []).some((p) => new RegExp(p, 'i').test(text));
  return {
    keep: true,
    candidate: { uri: post.uri, url: webUrl(post), handle, name: post.author.displayName ?? '', text, createdAt: new Date(created).toISOString(), likes, replies, group, query, score, question, heated, isReply: !!rec.reply },
  };
}

// ---- rotation, pool, report -------------------------------------------------------------------------------------
// One query from each of n DIFFERENT groups per run; the next run goes on with the next groups and the next query of each group.
export function pickQueries(cfg, state, n = cfg.queriesPerRun) {
  const names = Object.keys(cfg.groups).filter((g) => cfg.groups[g].enabled !== false);
  if (!names.length) return [];
  state.cursor ??= 0;
  state.next ??= {};
  const take = Math.min(n, names.length);
  const out = [];
  for (let i = 0; i < take; i++) {
    const g = names[(state.cursor + i) % names.length];
    const qs = cfg.groups[g].queries;
    const k = (state.next[g] ?? 0) % qs.length;
    out.push({ group: g, query: qs[k] });
    state.next[g] = k + 1;
  }
  state.cursor = (state.cursor + take) % names.length;
  return out;
}

// The pool holds every fresh candidate found in the last hours, so a run does not hide what the previous run found.
export function updatePool(state, found, cfg, now, ownReplied = new Set(), shown = new Set()) {
  state.pool ??= {};
  for (const c of found) state.pool[c.uri] = { ...c, firstSeen: state.pool[c.uri]?.firstSeen ?? new Date(now).toISOString() };
  for (const [uri, c] of Object.entries(state.pool)) {
    if ((now - Date.parse(c.createdAt)) / 36e5 > cfg.maxAgeHours || ownReplied.has(uri) || shown.has(postKey(uri))) delete state.pool[uri];
  }
  const all = Object.values(state.pool).sort((a, b) => b.score - a.score || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { normal: all.filter((c) => !c.heated).slice(0, cfg.maxCandidates), heated: all.filter((c) => c.heated).slice(0, cfg.maxHeated) };
}

const ago = (iso, now) => {
  const h = (now - Date.parse(iso)) / 36e5;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : `${Math.round(h)}h`;
};

export function renderReport(id, account, { searched, stats, picked, now }) {
  const line = (c, i) => `${i + 1}. @${c.handle}${c.name ? ` (${c.name.slice(0, 40)})` : ''} · ${ago(c.createdAt, now)} · likes ${c.likes} · replies ${c.replies}${c.question ? ' · question' : ''} · ${c.group}\n   ${c.url}\n   ${c.text.slice(0, 280)}`;
  const out = [
    `# Comment candidates: ${id} (@${account.handle})`,
    `Made ${new Date(now).toISOString().slice(0, 16)}Z. Searched: ${searched.map((s) => `${s.group}: ${s.query}`).join(' | ') || 'nothing'}.`,
    `Posts below: ${picked.normal.length}${picked.heated.length ? ` + ${picked.heated.length} heated` : ''}. Dropped in this run: ${Object.entries(stats).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`,
    '',
    '## Posts',
    picked.normal.length ? picked.normal.map(line).join('\n') : '(no fresh fitting posts right now)',
  ];
  if (picked.heated.length) out.push('', '## Heated topics (AI debates etc.): reply only neutrally, with facts', picked.heated.map(line).join('\n'));
  return out.join('\n') + '\n';
}
