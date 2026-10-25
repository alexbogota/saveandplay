// Posting the ready posts of the daily brief to Bluesky after the owner's "ок" in the chat (decided 21 Oct 2026, docs/decisions.md).
// Used by scripts/post-bluesky.mjs (the chat step: show, approve, cancel; and the sender on GitHub: send).
//
// The rule that never changes: nothing is posted without the owner's "ок". The sender posts ONLY the text the owner saw and approved,
// exactly as it was, and checks it again right before it goes (the deal is still listed at that price, the sale is not over, our page of the
// game opens, the post was not made already, the text rules). The text of the post is made by the daily brief (scripts/daily-brief.mjs,
// scripts/lib/posts.mjs) from data/deals.json, never by a model.
//
// Files on the "comments" branch (the same branch and the same helper as the replies: scripts/comments-branch.sh; each file is written once and never changed):
//   posts-approved-<stamp>.json   what the owner approved: [{ n, account, handle, text, link, day, key }]
//   posts-cancel-<stamp>.json     the owner said "стоп": approved posts that were not posted yet are never posted
//   posts-sent-<stamp>.json       one per sender run: what happened to each approved post (posted with its link, or skipped with the reason)
// Settings: accounts.<id>.channels.bluesky.publish in data/accounts.json. For tests: COMMENTS_ROOT (the folder), BSKY_API_BASE (fake server),
// POSTS_BRIEF_DIR (the brief posts from files instead of the "brief" branch), POSTS_SITE_BASE (a fake site instead of https://saveandplay.com).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { file } from './comments.mjs';
import { dealPagePath } from './deal-paths.mjs';

const lc = (s) => String(s ?? '').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
export const graphemes = (s) => { let n = 0; for (const _ of segmenter.segment(String(s ?? ''))) n++; return n; };
export const SITE = 'https://saveandplay.com';
export const MAX_GRAPHEMES = 300; // Bluesky allows 300 characters in a post
export const LINK_CHARS = 25;     // the app shows a link as 25 characters; so does this program (see shortLink)

// ---- settings ---------------------------------------------------------------------------------------------------
export const PUBLISH_DEFAULTS = {
  enabled: false,
  passwordEnv: null,          // the secret with the app password of THIS account
  gapSeconds: [30, 90],       // pause between two posts of the same account
  maxApprovalAgeHours: 20,    // an approval older than this is not posted
  maxDayAge: 1,               // the post is made for a day (the date in its link); a post older than this many days is not posted
  duplicateHours: 36,         // a post with the same page of ours, made in this time (by hand or by the program), counts as posted
  minHoursLeft: 1,            // never post a sale that ends sooner than this
};

export function readAccounts() {
  return JSON.parse(readFileSync(file('data', 'accounts.json'), 'utf8')).accounts ?? {};
}

// Accounts that may be posted to Bluesky by the program: an enabled account with an enabled "bluesky" channel that has its own "publish" settings.
export function publishAccounts(only = null) {
  const out = [];
  for (const [id, a] of Object.entries(readAccounts())) {
    if (only && id !== only) continue;
    const ch = a?.channels?.bluesky;
    if (a?.enabled === false || !ch || ch.enabled === false || !ch.publish) continue;
    const settings = { ...PUBLISH_DEFAULTS, ...ch.publish };
    out.push({ id, name: a.name ?? id, platform: 'bluesky', handle: String(a.handle ?? '').replace(/^@/, ''), channel: ch, settings });
  }
  return out;
}

export function publishProblems(acc) {
  const s = acc.settings;
  const p = [];
  if (!s.enabled) return p;
  if (!acc.handle) p.push('the account has no handle');
  if (!s.passwordEnv) p.push('publish.passwordEnv is missing (the secret with the app password of this account)');
  for (const k of ['maxApprovalAgeHours', 'duplicateHours']) if (!(Number(s[k]) > 0)) p.push(`publish.${k} must be a number above 0`);
  if (!Number.isInteger(s.maxDayAge) || s.maxDayAge < 0) p.push('publish.maxDayAge must be a whole number, 0 or more');
  if (!(Number(s.minHoursLeft) >= 0)) p.push('publish.minHoursLeft must be 0 or more');
  const g = s.gapSeconds;
  if (!Array.isArray(g) || g.length !== 2 || !g.every((x) => Number.isFinite(x) && x >= 0) || g[0] > g[1]) p.push('publish.gapSeconds must be [smallest, biggest] in seconds');
  return p;
}

export function gapMs(s, rnd = Math.random) {
  const [a, b] = s.gapSeconds;
  const scale = process.env.COMMENTS_GAP_SCALE != null && process.env.COMMENTS_GAP_SCALE !== '' ? Number(process.env.COMMENTS_GAP_SCALE) : 1;
  return Math.max(0, Math.round((a + (b - a) * rnd()) * 1000 * (Number.isFinite(scale) ? scale : 1)));
}

// ---- the post of the brief --------------------------------------------------------------------------------------
// drafts/post-<account>-bluesky.md on the "brief" branch (read with git), or from POSTS_BRIEF_DIR in tests. null = no file.
export function readBriefPost(id, platform = 'bluesky') {
  const name = `post-${id}-${platform}.md`;
  if (process.env.POSTS_BRIEF_DIR) {
    const p = `${process.env.POSTS_BRIEF_DIR}/${name}`;
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  }
  const git = (...a) => spawnSync('git', a, { encoding: 'utf8', timeout: 60000, cwd: file('.') });
  if (git('fetch', '--quiet', 'origin', 'brief').status !== 0) throw new Error('cannot read the "brief" branch of the repository');
  const r = git('show', `FETCH_HEAD:${name}`);
  return r.status === 0 ? r.stdout : null;
}

const LINK_RE = /https:\/\/saveandplay\.com\/deals\/[^\s]+/g;

// The text of a brief file as a post: { noPost } when the brief says NO POST TODAY, else { text, link, day, path }.
export function parseBriefPost(raw) {
  const text = String(raw ?? '').replace(/\r/g, '').trim();
  if (!text) return { noPost: 'the file is empty' };
  if (/^NO POST TODAY/i.test(text)) return { noPost: text.replace(/^NO POST TODAY:?\s*/i, '').split('\n')[0] };
  const links = text.match(LINK_RE) ?? [];
  const link = links[0] ?? null;
  const day = link?.match(/utm_campaign=deals-(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  let path = null;
  try { path = link ? new URL(link).pathname : null; } catch { /* a broken link is reported by postProblems */ }
  return { text, link, day, path, links: links.length };
}

export const dayKey = (t = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(t); // 2026-10-21, the day in Bogota
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

export const itemKey = (account, day, path) => `${account}|${day}|${path}`;

// The length of a post: Bluesky counts the link as 25 characters (shortLink), Mastodon as 23 (the "linkChars" of the channel), at most "maxChars" (500).
function lengthProblem(text, link, acc) {
  if (acc.platform === 'mastodon') {
    const max = Number(acc.channel.maxChars) || 500;
    const n = graphemes(link ? text.replace(link, 'x'.repeat(acc.channel.linkChars ?? 23)) : text);
    return n > max ? `the post is ${n} characters, Mastodon allows ${max}` : null;
  }
  const n = graphemes(shortenForPost(text, link));
  return n > MAX_GRAPHEMES ? `the post is ${n} characters, Bluesky allows ${MAX_GRAPHEMES}` : null;
}

// ---- the checks -----------------------------------------------------------------------------------------------------
// What is wrong with a post, as short plain sentences (an empty list means it may go). deals = data/deals.json (a list).
export function postProblems(post, { acc, deals, now = Date.now() }) {
  const s = acc.settings;
  const p = [];
  const text = post.text ?? '';
  if (!text) return ['the post is empty'];
  const disclosure = acc.channel.disclosure ?? 'Ad';
  if (post.links !== 1 || !post.link) p.push(`the post must have exactly one link to our page of a game (it has ${post.links ?? 0})`);
  if (text.split('\n').at(-1) !== disclosure) p.push(`the last line must be "${disclosure}" (the disclosure of the ad)`);
  if (/#ad\b/i.test(text)) p.push('the tag #ad is not used: the disclosure is the plain line');
  if (/lowest (price )?ever|all[- ]time low|historical low/i.test(text)) p.push('"lowest ever" is not allowed');
  const len = lengthProblem(text, post.link, acc);
  if (len) p.push(len);
  if (!post.day) p.push('the link has no date (utm_campaign=deals-YYYY-MM-DD)');
  else if (daysBetween(post.day, dayKey(now)) > s.maxDayAge) p.push(`the post is for ${post.day}, too old: wait for the next brief`);
  else if (daysBetween(post.day, dayKey(now)) < 0) p.push(`the post is for ${post.day}, a day that has not come yet`);
  // The deal of the link must still be listed with the price of the text, and the sale must not be over.
  if (post.path) {
    const deal = (deals ?? []).find((d) => dealPagePath(d) === post.path);
    if (!deal) p.push('the deal is not listed any more (data/deals.json)');
    else {
      const prices = [...text.matchAll(/\$(\d+\.\d{2})/g)].map((m) => Number(m[1]));
      if (!prices.includes(Number(Number(deal.price).toFixed(2)))) p.push(`the price in the post is not the current price of the deal ($${Number(deal.price).toFixed(2)})`);
      const ends = deal.endsAt ? Date.parse(deal.endsAt) : null;
      if (ends && ends - now < s.minHoursLeft * 36e5) p.push('the sale is over or ends within the hour');
    }
  }
  return p;
}

// ---- the post as Bluesky wants it ---------------------------------------------------------------------------------
// The app shows a link as host + path cut to 25 characters ("saveandplay.com/deals/gog/f..."); the text of a post made through the API must do
// the same, because Bluesky counts the characters of the text, and the link itself goes into a facet. That is why the brief counts a link as 25.
export function shortLink(url, length = LINK_CHARS) {
  const u = new URL(url);
  const short = u.host + (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash;
  return short.length > length ? `${short.slice(0, length - 3)}...` : short;
}
export const shortenForPost = (text, link) => (link ? text.replace(link, shortLink(link)) : text);

// Links and #tags become clickable only with "facets". Byte positions in UTF-8 of the final text.
export function facetsOf(finalText, link) {
  const enc = new TextEncoder();
  const out = [];
  const at = (idx) => enc.encode(finalText.slice(0, idx)).length;
  if (link) {
    const short = shortLink(link);
    const idx = finalText.indexOf(short);
    if (idx >= 0) out.push({ index: { byteStart: at(idx), byteEnd: at(idx) + enc.encode(short).length }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: link }] });
  }
  for (const m of finalText.matchAll(/(^|\s)#([\p{L}\p{N}_]+)/gu)) {
    const start = m.index + m[1].length;
    out.push({ index: { byteStart: at(start), byteEnd: at(start) + enc.encode(`#${m[2]}`).length }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[2] }] });
  }
  return out;
}

// ---- our page (the link card) -----------------------------------------------------------------------------------------
const siteUrl = (link) => (process.env.POSTS_SITE_BASE ? link.replace(SITE, process.env.POSTS_SITE_BASE.replace(/\/$/, '')) : link);
const meta = (html, prop) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  const v = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return v ? v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null;
};

// Opens our page of the game. { ok: false, reason } when it does not answer 200. The card: title, description and the picture (og:image) if it can be read.
export async function loadCard(link, { fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const get = async (url) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try { return await fetchImpl(url, { signal: ctl.signal, headers: { 'user-agent': 'saveandplay-poster' } }); } finally { clearTimeout(timer); }
  };
  let res;
  try { res = await get(siteUrl(link)); } catch (e) { return { ok: false, reason: `our page does not open (${e.message})` }; }
  if (res.status !== 200) return { ok: false, reason: `our page answers ${res.status}, not 200` };
  const html = await res.text();
  const title = meta(html, 'og:title') ?? html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
  const description = meta(html, 'og:description') ?? meta(html, 'description') ?? '';
  let image = null;
  const src = meta(html, 'og:image');
  if (src) {
    try {
      const abs = new URL(src, siteUrl(link)).toString();
      const ir = await get(process.env.POSTS_SITE_BASE ? abs.replace(SITE, process.env.POSTS_SITE_BASE.replace(/\/$/, '')) : abs);
      const mime = (ir.headers.get('content-type') ?? '').split(';')[0].trim();
      if (ir.ok && /^image\//.test(mime)) {
        const bytes = new Uint8Array(await ir.arrayBuffer());
        if (bytes.length > 0 && bytes.length <= 950000) image = { bytes, mime };
      }
    } catch { /* a card without a picture is still a card */ }
  }
  return { ok: true, title: title ?? 'SaveAndPlay', description, image };
}

// ---- the hours of the day (data/post-schedule.json) -------------------------------------------------------------------
// The owner approves everything at once in the morning; the posts of ONE Bluesky account go out one after another, spacingHours apart
// (first now, then +3 h, +6 h ...), in the order of "order" (account ids; "article" = the post about a guide). The sender (GitHub, every hour)
// posts what is due. Each approved post carries its own "notBefore".
export const SCHEDULE_DEFAULTS = { spacingHours: 2, order: ['prices', 'prices-2', 'article', 'coop:prices', 'prices-kinguin', 'mastodon:prices', 'mastodon:article', 'mastodon:prices-kinguin'] };

export function readSchedule() {
  let raw = {};
  try { raw = JSON.parse(readFileSync(file('data', 'post-schedule.json'), 'utf8')); } catch { /* the defaults are used */ }
  return { ...SCHEDULE_DEFAULTS, ...raw };
}

export function scheduleProblems(sch) {
  const p = [];
  if (!(Number(sch.spacingHours) >= 0)) p.push('spacingHours must be 0 or more');
  if (!Array.isArray(sch.order) || sch.order.some((x) => typeof x !== 'string')) p.push('order must be a list of account ids (and "article")');
  return p;
}

// A play-together post has its own place per account: "coop:<account>" (an account that is not in the order list goes after its own deal posts).
const slotOf = (it) => {
  const slot = it.kind === 'article' ? 'article' : it.kind === 'coop' ? `coop:${it.account}` : it.account;
  return it.platform === 'mastodon' ? `mastodon:${slot}` : slot;
};

// Gives every item its "notBefore" (ISO time). immediate = true: everything may go now. Items of different Bluesky accounts do not wait for each other.
export function scheduleItems(items, { now = Date.now(), schedule = readSchedule(), immediate = false } = {}) {
  const byHandle = new Map();
  for (const it of items) byHandle.set(lc(it.handle), [...(byHandle.get(lc(it.handle)) ?? []), it]);
  const out = [];
  for (const list of byHandle.values()) {
    const rank = (it) => { const i = schedule.order.indexOf(slotOf(it)); return i < 0 ? schedule.order.length : i; };
    list.sort((a, b) => rank(a) - rank(b) || (a.n ?? 0) - (b.n ?? 0));
    list.forEach((it, i) => out.push({ ...it, notBefore: new Date(now + (immediate ? 0 : i * schedule.spacingHours * 36e5)).toISOString() }));
  }
  return out.sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
}

// An item without "notBefore" (approved before the schedule existed) is due at once.
export const isDue = (it, now = Date.now()) => !it.notBefore || Date.parse(it.notBefore) <= now;

// ---- the post about a guide (kind "article") ------------------------------------------------------------------------------
// The text comes from the draft of the daily writer (branch "articles", posts.md, the "Bluesky" block) or from drafts/social/post-NN-<slug>.md that
// `article-tools.mjs take` writes. The link goes to /guides/<slug>/ with utm marks; there is no Ad line (the guide has no affiliate links).
export function parseArticlePost(raw) {
  const text = String(raw ?? '').replace(/\r/g, '').trim();
  if (!text) return { noPost: 'the file is empty' };
  const links = text.match(/https:\/\/saveandplay\.com\/guides\/[^\s]+/g) ?? [];
  const link = links[0] ?? null;
  let path = null;
  try { path = link ? new URL(link).pathname : null; } catch { /* reported by articleProblems */ }
  const slug = path?.match(/^\/guides\/([a-z0-9-]+)\/$/)?.[1] ?? null;
  return { text, link, path, slug, links: (text.match(/https?:\/\/\S+/g) ?? []).length, kind: 'article' };
}

export function articleProblems(post, { acc }) {
  const p = [];
  const text = post.text ?? '';
  if (!text) return ['the post is empty'];
  if (post.links !== 1 || !post.link || !post.slug) p.push(`the post must have exactly one link, to a guide of ours: ${SITE}/guides/<slug>/ (it has ${post.links ?? 0})`);
  else {
    if (!post.link.includes('utm_medium=social')) p.push('the link needs utm_medium=social');
    if (!text.split('\n').some((l) => l.trim() === post.link)) p.push('the link must stand alone on its own line');
  }
  const disclosure = acc.channel.disclosure ?? 'Ad';
  if (text.split('\n').map((l) => l.trim()).filter(Boolean).at(-1) === disclosure) p.push(`no "${disclosure}" line: the guide has no affiliate links`);
  if (/#ad\b/i.test(text)) p.push('the tag #ad is not used');
  if (/lowest (price )?ever|all[- ]time low|best price ever/i.test(text)) p.push('"lowest ever" is not allowed');
  if (/[\u0400-\u04FF]/.test(text)) p.push('English only');
  const len = lengthProblem(text, post.link, acc);
  if (len) p.push(len);
  return p;
}

export const articleKey = (account, path) => itemKey(account, 'article', path);

// Guide drafts of the daily writer that are not on the site yet, with their Bluesky text: [{ slug, title, name, text }].
// Reads the "articles" branch with git (or ARTICLE_DRAFTS_DIR in tests: folders <name>/article.md + posts.md). A broken draft is left out.
export async function waitingArticles({ parsePosts, splitArticle }) {
  const dirs = [];
  const onSite = (slug) => existsSync(file('src', 'pages', 'guides', `${slug}.md`));
  if (process.env.ARTICLE_DRAFTS_DIR) {
    const root = process.env.ARTICLE_DRAFTS_DIR;
    for (const name of existsSync(root) ? readdirSync(root).sort() : []) {
      try { dirs.push({ name, article: readFileSync(`${root}/${name}/article.md`, 'utf8'), posts: readFileSync(`${root}/${name}/posts.md`, 'utf8') }); } catch { /* skipped */ }
    }
  } else {
    const git = (...a) => spawnSync('git', a, { encoding: 'utf8', timeout: 60000, cwd: file('.'), maxBuffer: 64 * 1024 * 1024 });
    if (git('fetch', '--quiet', 'origin', 'articles').status !== 0) return { list: [], note: 'the "articles" branch cannot be read (no drafts yet, or no network)' };
    const names = (git('ls-tree', '--name-only', 'FETCH_HEAD:articles').stdout ?? '').split('\n').filter(Boolean).sort();
    for (const name of names) {
      const a = git('show', `FETCH_HEAD:articles/${name}/article.md`);
      const b = git('show', `FETCH_HEAD:articles/${name}/posts.md`);
      if (a.status === 0 && b.status === 0) dirs.push({ name, article: a.stdout, posts: b.stdout });
    }
  }
  const list = [];
  for (const d of dirs) {
    try {
      const { fm } = splitArticle(d.article);
      const slug = String(fm?.image ?? '').replace(/^\/og\//, '').replace(/\.png$/, '');
      const text = parsePosts(d.posts).bluesky;
      const mastodon = parsePosts(d.posts).mastodon ?? null;
      if (slug && text) list.push({ slug, title: fm?.title ?? d.name, name: d.name, text, mastodon, onSite: onSite(slug) });
    } catch { /* a broken draft is left out */ }
  }
  return { list, note: null };
}

// ---- files on the branch (copied into drafts/ by scripts/comments-branch.sh load) --------------------------------
function loadFiles(prefix) {
  const dir = file('drafts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.startsWith(prefix) && n.endsWith('.json')).sort().flatMap((name) => {
    try { return [{ name, data: JSON.parse(readFileSync(`${dir}/${name}`, 'utf8')) }]; } catch { return []; }
  });
}
export const loadApproved = () => loadFiles('posts-approved-');
export const loadCancels = () => loadFiles('posts-cancel-').map((f) => f.data);
export const loadSent = () => loadFiles('posts-sent-').flatMap((f) => f.data.entries ?? []);

export const FINAL = new Set(['sent', 'skipped']);
export const isCancelled = (cancels, handle, key, approvedAt) => cancels.some((c) => lc(c.handle) === lc(handle) && Date.parse(c.at) >= Date.parse(approvedAt) && (c.all === true || (c.keys ?? []).includes(key)));

// Approved posts that are still waiting: not posted and not skipped for good.
export function pendingPosts({ approved, sent, cancels }) {
  const done = new Set(sent.filter((e) => FINAL.has(e.status)).map((e) => e.key));
  const out = [];
  for (const f of approved) {
    for (const it of f.data.items ?? []) {
      if (done.has(it.key) || out.some((o) => o.key === it.key)) continue;
      out.push({ ...it, approvedAt: f.data.approvedAt, approvedFile: f.name, cancelled: isCancelled(cancels, it.handle, it.key, f.data.approvedAt) });
    }
  }
  return out.sort((a, b) => Date.parse(a.approvedAt) - Date.parse(b.approvedAt) || a.n - b.n);
}

export { sleep, lc };
