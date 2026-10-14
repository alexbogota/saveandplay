// Which guides of the site still have no post in our Bluesky and Mastodon feeds? The program looks at the real feeds, so nobody has to say "I posted it".
//
//   npm run social:pending           plain text, for the owner and for the reports
//   npm run social:pending -- --json    the same as JSON, for programs
//
// A guide counts as posted when one of our own posts (not a reply, not a repost) holds a link to https://saveandplay.com/guides/<slug>.
// Reads only public data (no password). Settings: data/social-check.json. Nothing is posted, liked or changed.
//   Bluesky: the handle comes from data/accounts.json (accounts.prices.handle).
//   Mastodon: needs "instance" and "acct" in data/social-check.json (public statuses of the account). Without them Mastodon is reported as "not set".
// Environment (tests): SOCIAL_ROOT, BSKY_PUBLIC_API, MASTODON_API_BASE, SOCIAL_TIMEOUT_MS.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = process.env.SOCIAL_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const readJson = (path, fallback) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } };

export function loadSettings(root = ROOT) {
  const s = readJson(join(root, 'data', 'social-check.json'), {});
  const accounts = readJson(join(root, 'data', 'accounts.json'), {});
  const handle = String(accounts?.accounts?.[s.accountKey ?? 'prices']?.handle ?? '').replace(/^@/, '');
  return {
    site: String(s.site ?? 'https://saveandplay.com').replace(/\/+$/, ''),
    handle,
    bluesky: { enabled: s.bluesky?.enabled !== false, pages: s.bluesky?.pages ?? 3 },
    mastodon: { instance: String(s.mastodon?.instance ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, ''), acct: String(s.mastodon?.acct ?? '').replace(/^@/, '').split('@')[0], pages: s.mastodon?.pages ?? 3 },
    ignore: new Set(s.ignore ?? []),
  };
}

// The guides of the site: one file per guide in src/pages/guides/. The date is the "updated" line of the file.
export function loadGuides(root = ROOT, ignore = new Set()) {
  const dir = join(root, 'src', 'pages', 'guides');
  if (!existsSync(dir)) return [];
  const guides = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const slug = f.slice(0, -3);
    if (ignore.has(slug)) continue;
    const head = readFileSync(join(dir, f), 'utf8').split(/\r?\n---/)[0];
    const title = head.match(/^title:\s*"?(.*?)"?\s*$/m)?.[1] ?? slug;
    const updated = head.match(/^updated:\s*(\d{4}-\d{2}-\d{2})/m)?.[1] ?? null;
    guides.push({ slug, title, updated });
  }
  return guides.sort((a, b) => String(a.updated).localeCompare(String(b.updated)) || a.slug.localeCompare(b.slug));
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const mentions = (links, site, slug) => {
  const host = esc(site.replace(/^https?:\/\//, ''));
  const re = new RegExp(`${host}/guides/${esc(slug)}(?=[/?#\\s"'<>]|$)`, 'i');
  return links.some((l) => re.test(l));
};

const timeoutMs = () => Number(process.env.SOCIAL_TIMEOUT_MS ?? 15000);
async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs()), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

// Our own posts on Bluesky: { links, createdAt } for each (replies are left out by the filter, reposts by the check below).
export async function blueskyPosts(handle, { pages = 3 } = {}) {
  const base = process.env.BSKY_PUBLIC_API ?? 'https://public.api.bsky.app';
  const posts = [];
  let cursor = null;
  let more = false;
  for (let i = 0; i < pages; i++) {
    const q = new URLSearchParams({ actor: handle, filter: 'posts_no_replies', limit: '100' });
    if (cursor) q.set('cursor', cursor);
    const j = await getJson(`${base}/xrpc/app.bsky.feed.getAuthorFeed?${q}`);
    for (const item of j.feed ?? []) {
      if (item.reason) continue; // a repost of somebody else's post
      const p = item.post ?? {};
      if (p.author?.handle && p.author.handle.toLowerCase() !== handle.toLowerCase()) continue;
      const rec = p.record ?? {};
      const links = [rec.text ?? ''];
      for (const f of rec.facets ?? []) for (const x of f.features ?? []) if (x?.uri) links.push(x.uri);
      const e = p.embed;
      for (const ext of [e?.external, e?.media?.external]) if (ext?.uri) links.push(ext.uri);
      posts.push({ links, createdAt: rec.createdAt ?? p.indexedAt ?? null });
    }
    cursor = j.cursor ?? null;
    more = !!cursor && (j.feed ?? []).length > 0;
    if (!more) break;
  }
  return { posts, complete: !more };
}

// Our own public statuses on Mastodon.
export async function mastodonPosts({ instance, acct }, { pages = 3 } = {}) {
  const base = process.env.MASTODON_API_BASE ?? `https://${instance}`;
  const account = await getJson(`${base}/api/v1/accounts/lookup?acct=${encodeURIComponent(acct)}`);
  const posts = [];
  let maxId = null;
  let more = false;
  for (let i = 0; i < pages; i++) {
    const q = new URLSearchParams({ limit: '40', exclude_replies: 'true', exclude_reblogs: 'true' });
    if (maxId) q.set('max_id', maxId);
    const list = await getJson(`${base}/api/v1/accounts/${account.id}/statuses?${q}`);
    if (!Array.isArray(list)) throw new Error('unexpected answer from Mastodon');
    for (const s of list) {
      const links = [String(s.content ?? '').replace(/<[^>]+>/g, ' ')];
      for (const m of String(s.content ?? '').matchAll(/href="([^"]+)"/g)) links.push(m[1]);
      if (s.card?.url) links.push(s.card.url);
      posts.push({ links, createdAt: s.created_at ?? null });
    }
    more = list.length >= 40;
    maxId = list.at(-1)?.id ?? null;
    if (!more || !maxId) break;
  }
  return { posts, complete: !more };
}

// status of one guide in one feed: posted | missing | unchecked (the guide is older than the part of the feed we could read) | error
export function judge(guide, feed, site) {
  const hit = feed.posts.find((p) => mentions(p.links, site, guide.slug));
  if (hit) return { state: 'posted', when: hit.createdAt };
  if (!feed.complete) {
    const dates = feed.posts.map((p) => Date.parse(p.createdAt)).filter(Number.isFinite);
    const oldest = dates.length ? Math.min(...dates) : Infinity;
    const g = Date.parse(guide.updated ?? '');
    if (!Number.isFinite(g) || g < oldest) return { state: 'unchecked' };
  }
  return { state: 'missing' };
}

export async function check(root = ROOT) {
  const s = loadSettings(root);
  const guides = loadGuides(root, s.ignore);
  const channels = {};
  const run = async (name, ready, notSet, fetcher) => {
    if (!ready) { channels[name] = { state: 'not set', note: notSet }; return; }
    try { channels[name] = { state: 'ok', feed: await fetcher() }; } catch (e) { channels[name] = { state: 'error', note: String(e?.message ?? e) }; }
  };
  if (s.bluesky.enabled) await run('Bluesky', !!s.handle, 'no handle in data/accounts.json', () => blueskyPosts(s.handle, s.bluesky));
  if (s.mastodon.instance || s.mastodon.acct) await run('Mastodon', !!(s.mastodon.instance && s.mastodon.acct), 'instance and acct are both needed in data/social-check.json', () => mastodonPosts(s.mastodon, s.mastodon));
  else channels.Mastodon = { state: 'not set', note: 'put the instance and the account name of the Mastodon account into data/social-check.json (mastodon.instance, mastodon.acct)' };
  const rows = guides.map((g) => ({
    slug: g.slug, title: g.title, updated: g.updated,
    channels: Object.fromEntries(Object.entries(channels).map(([name, c]) => [name, c.state === 'ok' ? judge(g, c.feed, s.site) : { state: c.state === 'error' ? 'error' : 'not set' }])),
  }));
  const waiting = rows.flatMap((r) => Object.entries(r.channels).filter(([, v]) => v.state === 'missing').map(([name]) => ({ slug: r.slug, title: r.title, channel: name, url: `${s.site}/guides/${r.slug}/` })));
  return { guides: rows, channels: Object.fromEntries(Object.entries(channels).map(([k, c]) => [k, { state: c.state, note: c.note ?? null }])), waiting };
}

export function render(res) {
  const out = ['Guide posts in our own feeds (public data, nothing is posted or changed):'];
  for (const r of res.guides) {
    const parts = Object.entries(r.channels).map(([name, v]) => {
      if (v.state === 'posted') return `${name} posted${v.when ? ` ${String(v.when).slice(0, 10)}` : ''}`;
      if (v.state === 'missing') return `${name} NOT POSTED`;
      if (v.state === 'unchecked') return `${name} too old to check`;
      if (v.state === 'error') return `${name} could not be checked`;
      return `${name} not set`;
    });
    out.push(`- ${r.slug}${r.updated ? ` (${r.updated})` : ''}: ${parts.join(', ')}`);
  }
  for (const [name, c] of Object.entries(res.channels)) if (c.state === 'error') out.push(`Could not check ${name}: ${c.note}. Nothing is claimed about it.`);
  for (const [name, c] of Object.entries(res.channels)) if (c.state === 'not set') out.push(`${name} is not checked yet: ${c.note}.`);
  const broken = Object.entries(res.channels).filter(([, c]) => c.state === 'error').map(([name]) => name);
  const waiting = res.waiting.map((w) => `${w.slug} on ${w.channel}`).join('; ');
  if (res.waiting.length) out.push(`WAITING FOR A POST: ${waiting}.${broken.length ? ` (${broken.join(' and ')} could not be read, so it may be more.)` : ''}`);
  else if (broken.length) out.push(`WAITING FOR A POST: unknown, ${broken.join(' and ')} could not be read. Run it again later.`);
  else out.push('WAITING FOR A POST: nothing (every guide has a post in each feed that could be checked).');
  return out.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const res = await check();
  console.log(process.argv.includes('--json') ? JSON.stringify(res, null, 2) : render(res));
}
