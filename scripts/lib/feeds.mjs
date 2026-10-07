// Shared code for reading news feeds. Used by scripts/check-sources.mjs and scripts/daily-brief.mjs.
// No packages needed: RSS 2.0, RSS 1.0 and Atom are read with plain text rules.
//
// Good-citizen rules live here, so both programs follow them the same way:
// robots.txt is respected, one request per feed, no cookies, a User-Agent that says who we are.

// ---------- reading a feed ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const unwrap = (s) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
const stripTags = (s) => s.replace(/<[^>]*>/g, ' ');
const squash = (s) => s.replace(/\s+/g, ' ').trim();
// Text without markup. Done twice, because some feeds hide the HTML as &lt;p&gt;Tom &amp;amp; Jerry&lt;/p&gt;.
export const plain = (raw) => squash(decode(stripTags(decode(stripTags(raw)))));

// Web addresses inside a piece of feed text (links in the HTML or written as text), without trailing punctuation.
// Links to Steam and GOG game pages come first: they are the ones that tell which game a news item is about.
const GAME_PAGE = /store\.steampowered\.com\/app\/|gog\.com\/(?:[a-z]{2}\/)?game\//i;
export function urlsIn(raw) {
  const text = decode(decode(raw));
  const found = new Set();
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)) {
    found.add(m[0].replace(/[.,;:!?)\]]+$/, ''));
    if (found.size >= 500) break;
  }
  const all = [...found];
  return [...all.filter((u) => GAME_PAGE.test(u)).slice(0, 15), ...all.filter((u) => !GAME_PAGE.test(u)).slice(0, 10)];
}

// First <name>...</name> inside a block (name may have a colon, like content:encoded).
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? unwrap(m[1]) : null;
}

function linkOf(block) {
  const t = tag(block, 'link');
  if (t && /^https?:/i.test(t.trim())) return t.trim();
  const attrs = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
  const pick = attrs.find((a) => /rel=["']alternate["']/i.test(a)) ?? attrs.find((a) => !/rel=/i.test(a)) ?? attrs[0];
  const href = pick?.match(/href=["']([^"']+)["']/i);
  return href ? decode(href[1]) : null;
}

// JavaScript does not know zone names like EEST or CEST (GOG writes "Tue, 06 Oct 2026 10:49:31 EEST"),
// so for those the name is replaced by a numeric offset first.
export const ZONES = { EEST: '+0300', EET: '+0200', CEST: '+0200', CET: '+0100', BST: '+0100', WEST: '+0100', WET: '+0000', MSK: '+0300', JST: '+0900', KST: '+0900', AEST: '+1000', AEDT: '+1100', NZST: '+1200', NZDT: '+1300', AKST: '-0900', AKDT: '-0800', HST: '-1000', UT: '+0000' };
export function parseDate(value) {
  const s = value.trim();
  let t = Date.parse(s);
  if (Number.isNaN(t)) {
    const zone = s.match(/\s([A-Z]{2,4})$/)?.[1];
    if (zone && ZONES[zone]) t = Date.parse(s.slice(0, -zone.length) + ZONES[zone]);
  }
  return Number.isNaN(t) ? null : t;
}

function dateOf(block) {
  for (const name of ['pubDate', 'dc:date', 'published', 'updated']) {
    const v = tag(block, name);
    const t = v ? parseDate(v) : null;
    if (t != null) return t;
  }
  return null;
}

const SUMMARY_CHARS = 400;

// Result: { isFeed, items: [{ title, link, t, len, summary, urls }] }. t = time in ms or null.
export function parseFeed(xml) {
  const head = xml.slice(0, 20000);
  if (/^\s*<!doctype html|^\s*<html/i.test(head) || !/<(rss|feed|rdf:RDF)\b/i.test(head)) return { isFeed: false, items: [] };
  const items = [];
  for (const m of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const b = m[0];
    const body = tag(b, 'content:encoded') ?? tag(b, 'content') ?? tag(b, 'description') ?? tag(b, 'summary') ?? '';
    const text = plain(body);
    items.push({
      title: plain(tag(b, 'title') ?? ''),
      link: linkOf(b),
      t: dateOf(b),
      len: text.length,
      summary: text.slice(0, SUMMARY_CHARS),
      urls: urlsIn(body),
    });
  }
  return { isFeed: true, items };
}

// ---------- robots.txt ----------

// Does robots.txt allow this user agent to read this path? Longest matching rule wins; a tie goes to "allow".
export function robotsAllows(txt, ua, path) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.replace(/#.*/, '').trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', pattern: val });
    }
  }
  const token = ua.split('/')[0].toLowerCase();
  const own = groups.filter((g) => g.agents.some((a) => a !== '*' && a !== '' && token.includes(a)));
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes('*'));
  let best = null;
  for (const g of chosen) {
    for (const r of g.rules) {
      if (r.pattern === '') continue; // an empty Disallow means "everything is allowed"
      const re = new RegExp('^' + r.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
      if (!re.test(path)) continue;
      if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
    }
  }
  return best ? best.allow : true;
}

// ---------- fetching ----------

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readLimited(res, max) {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    if (n >= max) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

const robotsCache = new Map();
function robotsTxt(url, ua, timeoutMs) {
  const key = `${ua}|${url.origin}`;
  if (!robotsCache.has(key)) {
    robotsCache.set(
      key,
      (async () => {
        try {
          const res = await fetch(new URL('/robots.txt', url), { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(timeoutMs) });
          return res.ok ? await readLimited(res, 500_000) : ''; // no robots.txt = no restrictions
        } catch {
          return '';
        }
      })(),
    );
  }
  return robotsCache.get(key);
}

const NET_ERRORS = {
  ENOTFOUND: 'такого сайта нет (DNS)',
  ECONNREFUSED: 'сайт не принимает соединение',
  ECONNRESET: 'соединение сброшено',
  ETIMEDOUT: 'соединение зависло',
  CERT_HAS_EXPIRED: 'просрочен сертификат',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'проблема с сертификатом',
  ERR_TLS_CERT_ALTNAME_INVALID: 'сертификат не подходит к сайту',
};

function explain(e, timeoutMs) {
  const code = e?.cause?.code;
  if (e?.name === 'TimeoutError') return `нет ответа за ${timeoutMs / 1000} с`;
  if (NET_ERRORS[code]) return `${NET_ERRORS[code]} (${code})`;
  return String(code ?? e?.cause?.message ?? e?.message ?? 'неизвестная ошибка');
}

// Opens one web address politely: robots.txt first, one request, a time limit, a size limit. Always answers, never throws.
// Result: { ok, http, text, note, robots }. robots = true when robots.txt forbids the address (nothing was requested).
export async function fetchText(address, { ua, timeoutMs = 20000, maxBytes = 3_000_000, accept = '*/*' }) {
  const result = { ok: false, http: null, text: '', note: '', robots: false };
  try {
    const url = new URL(address);
    if (!robotsAllows(await robotsTxt(url, ua, timeoutMs), ua, url.pathname + url.search)) return { ...result, robots: true, note: 'robots.txt запрещает чтение' };
    const res = await fetch(url, { headers: { 'user-agent': ua, accept }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    result.http = res.status;
    if (!res.ok) return { ...result, note: `HTTP ${res.status}` };
    return { ...result, ok: true, text: await readLimited(res, maxBytes) };
  } catch (e) {
    return { ...result, note: explain(e, timeoutMs) };
  }
}

// Opens one feed politely. Always answers, never throws.
// Result: { kind: 'OK' | 'ROBOTS' | 'NOT_FEED' | 'FAIL', note, http, items }
export async function loadFeed(feedUrl, { ua, timeoutMs = 20000, maxBytes = 3_000_000 }) {
  const r = await fetchText(feedUrl, { ua, timeoutMs, maxBytes, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' });
  if (!r.ok) return { kind: r.robots ? 'ROBOTS' : 'FAIL', note: r.note, http: r.http, items: [] };
  try {
    const feed = parseFeed(r.text);
    if (!feed.isFeed) return { kind: 'NOT_FEED', note: 'это не RSS/Atom (страница сайта?)', http: r.http, items: [] };
    return { kind: 'OK', note: '', http: r.http, items: feed.items };
  } catch (e) {
    return { kind: 'FAIL', note: explain(e, timeoutMs), http: r.http, items: [] };
  }
}
