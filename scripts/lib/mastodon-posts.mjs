// Posting the ready posts of the daily brief to Mastodon after the owner's "ок" in the chat (decided 25 Oct 2026, docs/decisions.md).
// It is the same road as Bluesky (scripts/post-bluesky.mjs, scripts/lib/bsky-posts.mjs): the owner approves in the chat, the workflow "Post to Bluesky"
// posts exactly the approved text at its hour and checks it again right before it goes. Only the client for the Mastodon API differs.
//
// Settings: accounts.<id>.channels.mastodon.publish = { enabled, tokenEnv, instance, acct } in data/accounts.json.
// The access token is a GitHub secret (tokenEnv, now MASTODON_ACCESS_TOKEN); it is never printed and never written to a file.
// For tests: MASTODON_API_BASE (a fake server instead of https://<instance>).

import { readAccounts, PUBLISH_DEFAULTS } from './bsky-posts.mjs';
import { brief } from './comments-send.mjs';
import { createHash } from 'node:crypto';

const lc = (s) => String(s ?? '').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const MASTODON_DEFAULTS = { ...PUBLISH_DEFAULTS, tokenEnv: null, instance: 'mastodon.social', acct: null };
export const MASTODON_MAX_CHARS = 500; // mastodon.social; a link counts as 23 characters (the "linkChars" of the channel)

// Accounts that may be posted to Mastodon by the program: an enabled account with an enabled "mastodon" channel that has its own "publish" settings.
// handle = "<acct>@<instance>" (the same for every block that posts to the one account).
export function mastodonAccounts(only = null) {
  const out = [];
  for (const [id, a] of Object.entries(readAccounts())) {
    if (only && id !== only) continue;
    const ch = a?.channels?.mastodon;
    if (a?.enabled === false || !ch || ch.enabled === false || !ch.publish) continue;
    const settings = { ...MASTODON_DEFAULTS, ...ch.publish };
    const acct = String(settings.acct ?? '').replace(/^@/, '').split('@')[0];
    const instance = String(settings.instance ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    out.push({ id, name: a.name ?? id, platform: 'mastodon', handle: acct && instance ? `${acct}@${instance}` : '', acct, instance, channel: ch, settings });
  }
  return out;
}

export function mastodonSettingsProblems(acc) {
  const s = acc.settings;
  const p = [];
  if (!s.enabled) return p;
  if (!acc.acct) p.push('publish.acct is missing (the name of the Mastodon account, without @)');
  if (!acc.instance) p.push('publish.instance is missing (for example mastodon.social)');
  if (!s.tokenEnv) p.push('publish.tokenEnv is missing (the secret with the access token of this account)');
  for (const k of ['maxApprovalAgeHours', 'duplicateHours']) if (!(Number(s[k]) > 0)) p.push(`publish.${k} must be a number above 0`);
  if (!Number.isInteger(s.maxDayAge) || s.maxDayAge < 0) p.push('publish.maxDayAge must be a whole number, 0 or more');
  if (!(Number(s.minHoursLeft) >= 0)) p.push('publish.minHoursLeft must be 0 or more');
  const g = s.gapSeconds;
  if (!Array.isArray(g) || g.length !== 2 || !g.every((x) => Number.isFinite(x) && x >= 0) || g[0] > g[1]) p.push('publish.gapSeconds must be [smallest, biggest] in seconds');
  if (!(Number(acc.channel.maxChars) > 0 && Number(acc.channel.maxChars) <= MASTODON_MAX_CHARS)) p.push(`channels.mastodon.maxChars must be 1-${MASTODON_MAX_CHARS}`);
  return p;
}

// The length Mastodon counts: every link is 23 characters, whatever its real length.
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
export function countedLength(text, linkChars = 23) {
  let n = 0;
  for (const _ of segmenter.segment(String(text ?? '').replace(/https?:\/\/\S+/g, 'x'.repeat(linkChars)))) n++;
  return n;
}

// The key Mastodon remembers for an hour: the same approved post sent twice (a retry after a network error) is one status.
export const idempotencyKey = (itemKey) => createHash('sha256').update(String(itemKey)).digest('hex').slice(0, 32);

// ---- the Mastodon API -------------------------------------------------------------------------------------------
export function createMastodon({ instance, token, fetchImpl = globalThis.fetch, base = process.env.MASTODON_API_BASE || `https://${instance}`, timeoutMs = Number(process.env.COMMENTS_TIMEOUT_MS) || 20000, retryMs = Number(process.env.COMMENTS_RETRY_MS) || 5000 }) {
  let me = null;
  const hide = (s) => String(s ?? '').replaceAll(token, '[hidden]');
  async function call(path, { method = 'GET', params, body, headers = {}, retry = true } = {}, attempt = 0) {
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(params ?? {})) if (v != null) url.searchParams.set(k, String(v));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    } catch (e) {
      clearTimeout(timer);
      if (retry && attempt < 1) { await sleep(retryMs); return call(path, { method, params, body, headers, retry }, attempt + 1); }
      throw Object.assign(new Error(`cannot reach Mastodon: ${hide(e.message)}`), { code: 'network' });
    }
    clearTimeout(timer);
    if (retry && (res.status === 429 || res.status >= 500) && attempt < 1) { await sleep(retryMs); return call(path, { method, params, body, headers, retry }, attempt + 1); }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok) {
      const code = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate' : `http-${res.status}`;
      throw Object.assign(new Error(hide(json?.error || `HTTP ${res.status}`)), { code, status: res.status });
    }
    return json;
  }
  return {
    // Whose token is this? { id, acct } ("acct" is the name on its own server, without the server).
    async login() {
      const j = await call('/api/v1/accounts/verify_credentials', { retry: false });
      if (!j?.id) throw Object.assign(new Error('the token gave no account'), { code: 'auth' });
      me = { id: String(j.id), acct: lc(String(j.acct ?? '').split('@')[0]), url: j.url ?? null };
      return me;
    },
    get me() { return me; },
    // Our own statuses of the last `hours` hours, by hand or by the program: [{ at, uri, links }]
    async recentPosts(hours, maxPages = 2) {
      const since = Date.now() - hours * 36e5;
      const out = [];
      let maxId = null;
      for (let i = 0; i < maxPages; i++) {
        const list = await call(`/api/v1/accounts/${me.id}/statuses`, { params: { limit: 40, exclude_replies: 'true', exclude_reblogs: 'true', max_id: maxId } });
        if (!Array.isArray(list)) throw Object.assign(new Error('unexpected answer from Mastodon'), { code: 'http-200' });
        let older = false;
        for (const s of list) {
          const at = Date.parse(s.created_at ?? '');
          if (!(at >= since)) { older = true; continue; }
          const links = [String(s.content ?? '').replace(/<[^>]+>/g, ' ')];
          for (const m of String(s.content ?? '').matchAll(/href="([^"]+)"/g)) links.push(m[1]);
          if (s.card?.url) links.push(s.card.url);
          out.push({ at: new Date(at).toISOString(), uri: s.url ?? s.uri ?? null, links });
        }
        maxId = list.at(-1)?.id ?? null;
        if (older || list.length < 40 || !maxId) break;
      }
      return out;
    },
    // Posts a public status in English. The server makes the link card from the og: tags of our page by itself.
    async createStatus({ text, key }) {
      const j = await call('/api/v1/statuses', { method: 'POST', body: { status: text, visibility: 'public', language: 'en' }, headers: { 'idempotency-key': idempotencyKey(key) } });
      return { id: j?.id ?? null, url: j?.url ?? j?.uri ?? null };
    },
  };
}

export { brief };
