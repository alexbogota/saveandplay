// Daily brief: collects the material for ONE post per account. Publishes nothing, changes nothing on the site.
//
//   npm run brief                    all accounts that are enabled in data/accounts.json
//   node scripts/daily-brief.mjs --account prices      only one account
//   GitHub -> Actions -> "Daily brief" (runs every morning by itself, or press Run workflow)
//
// Three sieves (see docs/decisions.md, the entry about the daily program):
//   1. Only the sources whose topic is the account's topic (data/sources.json, status ok or rare).
//   2. Only news from the last windowHours hours. One story written by several sites = "hot today".
//   3. Only news that is about a deal we have (data/deals.json), found by the game's link or by its name in the headline.
//      Deals nobody wrote about stay in the list too (ranked lower), so there is always something to post.
//   The news that is NOT about a deal goes to "Topics for articles" (scripts/lib/topics.mjs): up to maxTopics stories, headlines and links only.
//
// Result per account: drafts/brief-<account>.md (the only file Claude needs to read, about 2,000 tokens),
// drafts/brief-<account>.json (same data for programs), drafts/items-<account>.json (every news item of the window and what happened
// to it: used for a deal, shown as a topic, dropped and why) and drafts/brief-state.json (what was suggested, to avoid repeats).
// On GitHub the same text is also shown on the run page (Summary), ready to copy.
//
// Prices come only from our own data/deals.json. News is only a hint why a deal is interesting today.
// Good-citizen rules for the feeds are in scripts/lib/feeds.mjs (robots.txt, one request per feed, honest User-Agent).
//
// For tests the files and times can be set in the environment: ACCOUNTS_FILE, SOURCES_FILE, DEALS_FILE, HISTORY_FILE,
// LOG_FILE, STATE_FILE, FACTS_FILE, OUT_DIR, BRIEF_NOW, FEED_TIMEOUT_MS, FEED_PAUSE_MS.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadFeed, sleep } from './lib/feeds.mjs';
import { clean, hasName, nameVariants } from './lib/titles.mjs';
import { articleTopics } from './lib/topics.mjs';
import { slug as slugOf, dealPagePath as pagePathOf } from './lib/deal-paths.mjs';
import { channelWithDefaults, buildPost } from './lib/posts.mjs';
import { nicheMiss, selectProblems } from './lib/facts.mjs';

const UA = 'SaveAndPlay-brief/1.0 (+https://saveandplay.com)';
const TIMEOUT_MS = Number(process.env.FEED_TIMEOUT_MS) || 20000;
const PAUSE_MS = Number(process.env.FEED_PAUSE_MS ?? 1000);
const HOUR = 3600e3;
const DAY = 24 * HOUR;

// Scoring: bigger = better candidate for today's post.
const PER_DOMAIN = 3; // each different news site that wrote about the deal (up to MAX_DOMAINS)
const MAX_DOMAINS = 3;
const ENDS_SOON_HOURS = 48;
const ENDS_SOON_BONUS = 2;
const GOG_BONUS = 1; // we earn more from GOG
const LOWEST_BONUS = 1; // lowest price we have tracked (needs at least the account's minHistoryDays of data)
const REPEAT_PENALTY = 8; // was the top pick of an earlier brief, or drafted, within repeatDays

// What an account gets when data/accounts.json does not say otherwise.
const DEFAULTS = { minDiscount: 50, windowHours: 48, maxPriceAgeHours: 48, minHoursLeft: 6, repeatDays: 7, maxCandidates: 5, minHistoryDays: 14, dealsWithoutNews: true, gogNews: false, keywords: [], maxTopics: 5, rules: [], cadence: null, select: null, family: null, repeatSkip: false };
const REQUIRED = ['name', 'handle', 'topic', 'subid', 'stores'];
export function withDefaults(id, account) {
  const missing = REQUIRED.filter((k) => !account[k] || (Array.isArray(account[k]) && !account[k].length));
  if (missing.length) throw new Error(`Account "${id}" in data/accounts.json lacks: ${missing.join(', ')}.`);
  const c = account.cadence;
  if (c && (!Number.isInteger(c.everyDays) || c.everyDays < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(c.startDay ?? '') || Number.isNaN(Date.parse(c.startDay)))) {
    throw new Error(`Account "${id}" in data/accounts.json: cadence must look like { "everyDays": 2, "startDay": "2026-10-16" } (a whole number of days, and the first day of posting).`);
  }
  if (account.select) {
    const bad = selectProblems(account.select);
    if (bad.length) throw new Error(`Account "${id}" in data/accounts.json: select: ${bad.join('; ')}.`);
  }
  return { ...DEFAULTS, ...account };
}

// "family": accounts of one family are one voice on other networks (Bluesky, Nostr, Lemmy, Tumblr of "Honest prices") and may post the same game on the same
// day. Accounts of different families never do (Cozy, Retro, the main account): the one that comes first in data/accounts.json takes the game.
// No family = the account is its own family.
export const familyOf = (id, account) => account?.family || id;

// The games (gameKey) that accounts of OTHER families have already taken today, from the picks saved in the state of the brief.
export function takenToday({ state, accounts, deals, id, today }) {
  const me = familyOf(id, accounts.get(id));
  const byId = new Map(deals.map((d) => [dealId(d), d]));
  const taken = new Set();
  for (const [other, mem] of Object.entries(state.top ?? {})) {
    if (other === id || !accounts.has(other) || familyOf(other, accounts.get(other)) === me) continue;
    for (const [pick, day] of Object.entries(mem)) if (day === today && byId.has(pick)) taken.add(gameKey(byId.get(pick)));
  }
  return taken;
}

// What counts as already offered to this account: the manual drafts (log), its own picks of earlier days (mem) and, with
// "avoidRepeatsOf": ["prices"], the picks of those accounts on earlier days too (the second deal of the day of the main account must not
// repeat what the main account posted yesterday). The newest day wins.
export function offeredFor({ log = {}, mem = {}, state = { top: {} }, account, today }) {
  const offered = { ...log, ...Object.fromEntries(Object.entries(mem).filter(([, day]) => day !== today)) };
  for (const other of account.avoidRepeatsOf ?? []) {
    for (const [k, day] of Object.entries(state.top?.[other] ?? {})) if (day !== today && (!offered[k] || day > offered[k])) offered[k] = day;
  }
  return offered;
}

// "cadence": { everyDays, startDay } = the account posts only on startDay and then every everyDays days (UTC days, like the rest of the brief).
// No cadence = every day. On the other days the account gets no brief and its posts say "NO POST TODAY" with the next day.
const dayNo = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / (24 * 3600e3));
export function isPostDay(cadence, now) {
  if (!cadence) return true;
  const n = dayNo(new Date(now).toISOString().slice(0, 10)) - dayNo(cadence.startDay);
  return n >= 0 && n % cadence.everyDays === 0;
}
// The next day (YYYY-MM-DD) after today on which the account posts.
export function nextPostDay(cadence, now) {
  const n = dayNo(new Date(now).toISOString().slice(0, 10)) - dayNo(cadence.startDay);
  const k = n < 0 ? 0 : (Math.floor(n / cadence.everyDays) + 1) * cadence.everyDays;
  return new Date((dayNo(cadence.startDay) + k) * 24 * 3600e3).toISOString().slice(0, 10);
}

// ---------- small helpers ----------

const path = (envName, rel) => (process.env[envName] ? resolve(process.env[envName]) : fileURLToPath(new URL(rel, import.meta.url)));
const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (fallback !== undefined && e.code === 'ENOENT') return fallback;
    throw new Error(`Cannot read ${file}: ${e.message}`);
  }
};

export const slug = slugOf; // same as src/lib/deals.ts (the rule lives in scripts/lib/deal-paths.mjs)
export const dealId = (d) => slug(`${d.store}-${d.title}`);
export const dealPagePath = pagePathOf; // same as dealPath in src/lib/deals.ts
export const coverAlt = (d) => `Cover art for ${d.title}`; // same text as on the game page
const money = (n) => `$${n.toFixed(2)}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayOf = (t) => `${MONTHS[new Date(t).getUTCMonth()]} ${new Date(t).getUTCDate()}`;
const stampOf = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const hoursText = (ms) => {
  const h = Math.round(Math.abs(ms) / HOUR);
  return h >= 48 ? `${Math.round(h / 24)} days` : `${h} h`;
};
const domainOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').split('.').slice(-2).join('.');
  } catch {
    return url;
  }
};
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// ---------- deals ----------

const steamOf = (d) => String(d.steamId ?? d.image?.match(/\/apps\/(\d+)\//)?.[1] ?? '') || null;
const gogSlugOf = (url) => url?.match(/gog\.com\/(?:[a-z]{2}\/)?game\/([a-z0-9_]+)/i)?.[1]?.toLowerCase() ?? null;
const steamIdOfUrl = (url) => url?.match(/store\.steampowered\.com\/app\/(\d+)/i)?.[1] ?? null;

// The site shows one card per game: the cheapest offer, same price GOG first, then IndieGala (same rule as src/lib/deals.ts
// and scripts/make-drafts.mjs). We do not post about an offer that is hidden there.
const storeRank = (store) => {
  const i = ['GOG', 'IndieGala'].indexOf(store);
  return i === -1 ? 99 : i;
};
const gameKey = (d) => (steamOf(d) ? `steam-${steamOf(d)}` : `title-${slug(d.title)}`);
// An official store beats a marketplace key (Kinguin) whatever the price: the same rule as src/lib/deals.ts.
const beats = (a, b) => (!!a.marketplace !== !!b.marketplace ? !a.marketplace : a.price !== b.price ? a.price < b.price : storeRank(a.store) < storeRank(b.store));
export function visibleIds(deals) {
  const best = new Map();
  for (const d of deals) if (!best.has(gameKey(d)) || beats(d, best.get(gameKey(d)))) best.set(gameKey(d), d);
  return new Set([...best.values()].map(dealId));
}

// Which deals may be offered to this account, and why the others are left out.
// ctx.facts = data/game-facts.json (for an account with "select"), ctx.taken = games other families took today (see takenToday).
// fit = how many games of the account's stores pass its niche rule, before the price and date checks (for the report).
export function eligibleDeals(deals, account, now, offered, ctx = {}) {
  const left = { otherStore: 0, hidden: 0, notNiche: 0, noFacts: 0, taken: 0, repeat: 0, smallDiscount: 0, ended: 0, endsTooSoon: 0, oldPrice: 0 };
  const onSite = visibleIds(deals);
  const eligible = [];
  let fit = 0;
  for (const d of deals) {
    const id = dealId(d);
    const last = offered[id];
    const mine = account.stores.includes(d.store) && onSite.has(id);
    const miss = mine ? nicheMiss(ctx.facts?.[id], account.select) : '';
    if (mine && !miss) fit++;
    if (!account.stores.includes(d.store)) left.otherStore++;
    else if (!onSite.has(id)) left.hidden++;
    else if (miss) left[miss]++;
    else if (ctx.taken?.has(gameKey(d))) left.taken++;
    else if (account.repeatSkip && last && last !== isoDay(now) && (now - Date.parse(last)) / DAY < account.repeatDays) left.repeat++; // repeatSkip: the same game is not offered again within repeatDays
    else if (d.discountPct < account.minDiscount) left.smallDiscount++;
    else if (d.endsAt && new Date(d.endsAt) < now) left.ended++;
    else if (d.endsAt && new Date(d.endsAt) - now < account.minHoursLeft * HOUR) left.endsTooSoon++; // over before anyone can use the post
    else if (!d.checkedAt || now - new Date(d.checkedAt) > account.maxPriceAgeHours * HOUR) left.oldPrice++;
    else eligible.push({ deal: d, id, offeredOn: last && last !== isoDay(now) && (now - Date.parse(last)) / DAY < account.repeatDays ? last : null });
  }
  return { eligible, left, fit };
}

// ---------- news ----------

// Sources this account reads: its topic, and working (ok) or rare.
export const pickSources = (sources, account) => sources.filter((s) => (s.status === 'ok' || s.status === 'rare') && s.topics.includes(account.topic));

// News items of the last windowMs, with the source attached. Items without a date are not used.
export function recentItems(feeds, sources, now, windowMs) {
  const out = [];
  const seen = new Set();
  for (const src of sources) {
    const feed = feeds.get(src.id);
    if (feed?.kind !== 'OK') continue;
    for (const it of feed.items) {
      if (it.t == null || now - it.t > windowMs || it.t - now > 12 * HOUR) continue;
      const key = `${src.id}|${it.link ?? ''}|${it.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...it, src });
    }
  }
  return out;
}

// For every deal: which news items are about it. 'link' = the item links to the game's Steam or GOG page, 'title' = the name is in the headline.
export function matchNews(items, deals) {
  const index = deals.map(({ deal, id }) => ({ id, steam: steamOf(deal), gog: gogSlugOf(deal.url), names: nameVariants(deal.title) }));
  const mentions = new Map();
  for (const it of items) {
    const urls = [...(it.urls ?? []), it.link].filter(Boolean);
    const steamIds = new Set(urls.map(steamIdOfUrl).filter(Boolean));
    const gogSlugs = new Set(urls.map(gogSlugOf).filter(Boolean));
    const headline = clean(it.title);
    for (const d of index) {
      let how = null;
      if ((d.steam && steamIds.has(d.steam)) || (d.gog && gogSlugs.has(d.gog))) how = 'link';
      else if (d.names.some((n) => hasName(headline, n))) how = 'title';
      if (!how) continue;
      if (!mentions.has(d.id)) mentions.set(d.id, []);
      mentions.get(d.id).push({ source: it.src.name, domain: domainOf(it.src.feed), title: it.title, link: it.link, t: it.t, how });
    }
  }
  return mentions;
}

// GOG news about games that are not in our deals (new releases, out of early access): no price known.
export function gogNews(items, deals, limit = 3) {
  const taken = new Set(deals.map((d) => gogSlugOf(d.url)).filter(Boolean));
  const out = [];
  const seen = new Set();
  for (const it of [...items].sort((a, b) => b.t - a.t)) {
    if (domainOf(it.src.feed) !== 'gog.com') continue;
    const game = (it.urls ?? []).map(gogSlugOf).find(Boolean);
    if (!game || taken.has(game) || seen.has(game)) continue;
    seen.add(game);
    out.push({ title: it.title, game, url: `https://www.gog.com/en/game/${game}`, newsLink: it.link, t: it.t });
    if (out.length >= limit) break;
  }
  return out;
}

// News about a topic, without a deal: the headline contains one of the account's keywords.
export function keywordNews(items, keywords, limit = 5) {
  const words = keywords.map(clean).filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const it of [...items].sort((a, b) => b.t - a.t)) {
    const h = ` ${clean(it.title)} `;
    const hit = words.find((w) => h.includes(` ${w} `));
    const key = clean(it.title);
    if (!hit || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: it.title, source: it.src.name, link: it.link, t: it.t, keyword: hit, summary: cut(it.summary ?? '', 160) });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- candidates ----------

const gogLink = (links, url, subid) => `${links.gogDeeplink}?subid=${subid}&ulp=${encodeURIComponent(url)}`;
// Our own link goes to the page of that one game, so the post's preview card shows the game's title and cover.
const siteLink = (links, d, subid, day) => `${links.site}${dealPagePath(d)}?utm_source=${subid}&utm_medium=social&utm_campaign=deals-${day}`;

// days = how many days we have a recorded price of this game. "Lowest price we've tracked" needs at least minDays of them.
export function historyFacts(rows, price, today, minDays) {
  const days = rows.length;
  const earlier = rows.filter((r) => r.date !== today);
  const lowest = days >= minDays && earlier.length > 0 && price <= Math.min(...earlier.map((r) => r.price));
  return { days, lowest, since: rows[0]?.date ?? null };
}

export function buildCandidates({ eligible, mentions, history, account, links, now, gameFacts = {} }) {
  const today = isoDay(now);
  const byDiscount = [...eligible].sort((a, b) => b.deal.discountPct - a.deal.discountPct);
  const list = eligible.map(({ deal: d, id, offeredOn }) => {
    const found = (mentions.get(id) ?? []).sort((a, b) => (a.how === b.how ? b.t - a.t : a.how === 'link' ? -1 : 1));
    const domains = new Set(found.map((m) => m.domain).filter((x) => x !== domainOf(d.url))); // the store's own news is not an independent site
    const facts = historyFacts(history[id] ?? [], d.price, today, account.minHistoryDays);
    const endsInH = d.endsAt ? (new Date(d.endsAt) - now) / HOUR : null;
    const parts = [d.discountPct / 10];
    parts.push(PER_DOMAIN * Math.min(MAX_DOMAINS, domains.size));
    if (endsInH != null && endsInH <= ENDS_SOON_HOURS) parts.push(ENDS_SOON_BONUS);
    if (d.store === 'GOG') parts.push(GOG_BONUS);
    if (facts.lowest) parts.push(LOWEST_BONUS);
    if (offeredOn) parts.push(-REPEAT_PENALTY);
    return {
      id,
      kind: 'deal',
      title: d.title,
      store: d.store,
      price: d.price,
      was: d.was,
      discount: d.discountPct,
      endsAt: d.endsAt ?? null,
      endsInHours: endsInH == null ? null : Math.round(endsInH),
      priceCheckedAt: d.checkedAt,
      cover: d.image ?? null,
      drminfo: d.drminfo ?? null, // from the IndieGala feed; a post may use it for a note (see storeNote in data/accounts.json)
      coverAlt: d.image ? coverAlt(d) : null,
      facts: gameFacts[id] ? { year: gameFacts[id].year, genres: gameFacts[id].genres, tags: gameFacts[id].tags } : null, // for the tags of the post (factTags in data/accounts.json)
      marketplace: !!d.marketplace, // Kinguin: the post must say Marketplace key and compare with compareTo (see posts.mjs)
      compareTo: d.compareTo ?? null,
      score: Math.round(parts.reduce((a, b) => a + b, 0) * 10) / 10,
      discountRank: byDiscount.findIndex((x) => x.id === id) + 1,
      sites: domains.size,
      mentions: found.slice(0, 3),
      history: facts,
      offeredOn,
      link: siteLink(links, d, account.subid, today), // always our own page of the game, never a store link
      linkKind: 'link to our site',
    };
  });
  const usable = account.dealsWithoutNews ? list : list.filter((c) => c.sites > 0);
  return usable.sort((a, b) => b.score - a.score || b.discount - a.discount || a.price - b.price);
}

// ---------- the brief ----------

// Which code made this brief. On GitHub: the commit, how the run started and which attempt it is (attempt 2+ = "Re-run" button).
// Added after a run used old code: a re-run of an old run keeps the old commit.
export const buildInfo = (env = process.env) =>
  env.GITHUB_SHA ? `commit ${env.GITHUB_SHA.slice(0, 7)}, ${env.GITHUB_EVENT_NAME}, run #${env.GITHUB_RUN_NUMBER} attempt ${env.GITHUB_RUN_ATTEMPT}` : 'local run';

// The reasons "why today", one short clause each. They go into the text brief and, as a list (whyToday), into the json,
// so a program that posts by a template (scripts/post-nostr.mjs) can reuse the same words without parsing the markdown.
export function whyClauses(c, account, offeredCount) {
  const why = [];
  if (c.mentions.length) why.push(`${c.sites} news site${c.sites > 1 ? 's' : ''} wrote about the game in the last ${account.windowHours} h`);
  if (c.endsInHours != null && c.endsInHours <= ENDS_SOON_HOURS) why.push(`sale ends in ${hoursText(c.endsInHours * HOUR)}`);
  if (c.history.lowest) why.push(`lowest price we've tracked (${c.history.days} days of data)`);
  why.push(`deepest-discount rank ${c.discountRank} of ${offeredCount}`);
  return why;
}

export function buildBrief({ account, links, deals, history, offered, feeds, sources, now, facts = {}, taken = new Set() }) {
  const windowMs = account.windowHours * HOUR;
  const mine = pickSources(sources, account);
  const failed = mine.filter((s) => feeds.get(s.id)?.kind !== 'OK').map((s) => ({ name: s.name, why: feeds.get(s.id)?.note || 'not read' }));
  const items = recentItems(feeds, mine, now, windowMs);
  const { eligible, left, fit } = eligibleDeals(deals, account, now, offered, { facts, taken });
  const mentions = matchNews(items, eligible);
  const all = buildCandidates({ eligible, mentions, history, account, links, now, gameFacts: facts });
  const candidates = all.slice(0, account.maxCandidates);
  for (const c of candidates) c.whyToday = whyClauses(c, account, eligible.length);
  const news = account.gogNews ? gogNews(items, deals).map((n) => ({ ...n, link: gogLink(links, n.url, account.subid) })) : [];
  const topicalAll = account.keywords?.length ? keywordNews(items, account.keywords) : [];

  // News that is not about an offered deal: grouped into stories, the best ones become article topics. Headlines and links only.
  const newsItems = items.map((it) => ({ title: it.title, link: it.link, t: it.t, source: it.src.name, domain: domainOf(it.src.feed) }));
  const usedKeys = new Map();
  for (const [dealKey, list] of mentions) for (const m of list) usedKeys.set(`${m.link ?? ''}|${m.title}`, dealKey);
  const storeDomains = new Set(deals.map((d) => domainOf(d.url)));
  const { topics, records } = articleTopics({ items: newsItems, usedKeys, skipDomains: storeDomains, deals, keywords: account.keywords ?? [], maxTopics: account.maxTopics });
  // A keyword story that is already shown as an article topic is not repeated in "News on the topic".
  const shown = new Set(topics.flatMap((s) => s.items.map((i) => i.link)));
  const topical = topicalAll.filter((n) => !shown.has(n.link));
  const itemRecords = newsItems
    .map((it) => ({ source: it.source, domain: it.domain, title: it.title, link: it.link ?? null, published: new Date(it.t).toISOString(), ...records.get(it) }))
    .sort((a, b) => b.published.localeCompare(a.published));

  const checked = deals.map((d) => d.checkedAt).filter(Boolean).sort().at(-1);
  const warnings = [];
  if (!deals.length) warnings.push('data/deals.json is empty.');
  else if (!eligible.length && account.select) {
    // A niche account says so and posts nothing: it never takes any other game to fill the day.
    warnings.push(
      `No game fits the niche today (${fit} fit the rule, ${left.notNiche} do not, ${left.noFacts} have no facts yet, ${left.taken} were taken by another account today, ${left.repeat} offered in the last ${account.repeatDays} days, ${left.smallDiscount} under ${account.minDiscount}%, ${left.oldPrice} prices older than ${account.maxPriceAgeHours} h, ${left.ended + left.endsTooSoon} sales over or ending soon).`,
    );
  } else if (!eligible.length) {
    warnings.push(
      `No deal passes the rules (${left.oldPrice} prices older than ${account.maxPriceAgeHours} h, ${left.ended + left.endsTooSoon} sales over or ending within ${account.minHoursLeft} h, ${left.smallDiscount} under ${account.minDiscount}%${left.taken ? `, ${left.taken} taken by another account today` : ''}${left.repeat ? `, ${left.repeat} offered in the last ${account.repeatDays} days` : ''}). The prices in data/deals.json probably need a refresh; then run the brief again.`,
    );
  } else if (checked && now - new Date(checked) > account.maxPriceAgeHours * HOUR * 0.75) {
    warnings.push(`Prices are getting old (${hoursText(now - new Date(checked))}); soon they will be too old to offer.`);
  }
  if (!candidates.length && !news.length && !topical.length) warnings.unshift('NOTHING TO OFFER today.');
  if (mine.length && failed.length > mine.length / 2) warnings.push(`Most news sources failed (${failed.length} of ${mine.length}). Picks are mostly by price.`);

  const lines = [];
  const push = (...l) => lines.push(...l);
  push(`# Brief: ${account.name} (${account.handle}), ${stampOf(now)}`);
  push(
    `Prices checked ${checked ? `${stampOf(new Date(checked))} (${hoursText(now - new Date(checked))} ago)` : 'unknown'}. ` +
      `News: ${mine.length - failed.length} of ${mine.length} sources read, ${items.length} items from the last ${account.windowHours} h, ${mentions.size} of ${eligible.length} offered deals mentioned.`,
  );
  if (account.select) push(`Niche ${account.select.label ?? account.name}: ${fit} games fit the rule today (${eligible.length} of them can be posted now).`);
  for (const w of warnings) push(`WARNING: ${w}`);
  push('', 'Write ONE post about the first item below (take another one only if it looks wrong, and say why).');
  if (account.rules?.length) push('Rules:', ...account.rules.map((r) => `- ${r}`));

  candidates.forEach((c, i) => {
    push('', `## ${i + 1}. ${c.title}: ${c.store} ${money(c.price)} (was ${money(c.was)}, -${c.discount}%)`);
    const ends = c.endsAt ? `Sale ends ${stampOf(new Date(c.endsAt))} (in ${hoursText(c.endsInHours * HOUR)})` : 'No end date known';
    push(`${ends}. Price checked ${stampOf(new Date(c.priceCheckedAt))}. Score ${c.score}.`);
    push(`Why today: ${c.whyToday.join('; ')}.`);
    for (const m of c.mentions) push(`- ${m.source}, ${dayOf(m.t)}${m.how === 'link' ? ' (links to the game page)' : ''}: "${cut(m.title, 90)}" ${m.link ?? ''}`.trimEnd());
    if (c.offeredOn) push(`Note: suggested on ${c.offeredOn}, already used recently.`);
    push(`Link for the post (${c.linkKind}): ${c.link}`);
    if (c.cover) push(`Cover image: ${c.cover}`, `Alt text: ${c.coverAlt}`);
    else push('Cover image: none (post without a picture)');
  });

  if (news.length) {
    push('', '## GOG news without a price (use only if no deal fits; do not mention any price)');
    for (const n of news) push(`- ${n.title} (${dayOf(n.t)}). Link for the post (affiliate link): ${n.link}`);
  }
  if (topical.length) {
    push('', '## News on the topic (no deal)');
    for (const n of topical) push(`- ${n.source}, ${dayOf(n.t)}: "${cut(n.title, 100)}" ${n.link ?? ''}${n.summary ? ` | ${n.summary}` : ''}`.trimEnd());
  }
  if (topics.length) {
    push('', '## Topics for articles (stories without a deal; headlines and links only. Write an article only if the owner asks)');
    topics.forEach((s, i) => {
      push(`${i + 1}. ${cut(s.lead.title, 110)} (score ${s.score})`);
      const why = [`${s.sites} site${s.sites > 1 ? 's' : ''} wrote about it in the last ${account.windowHours} h (${s.domains.slice(0, 4).join(', ')})`];
      if (s.hits.length) why.push(`matches keywords: ${s.hits.join(', ')}`);
      if (s.games.length) why.push(`about a game we list: ${s.games.slice(0, 2).join(', ')}`);
      push(`Why now: ${why.join('; ')}; newest ${dayOf(s.latest)}.`);
      const seen = new Set();
      for (const it of [...s.items].sort((a, b) => b.t - a.t)) {
        if (seen.has(it.domain) || seen.size >= 3) continue;
        seen.add(it.domain);
        push(`- ${it.source}, ${dayOf(it.t)}: "${cut(it.title, 100)}" ${it.link ?? ''}`.trimEnd());
      }
    });
  }
  push(
    '',
    `Left out: ${left.otherStore} other-store deals, ${left.hidden} hidden duplicates, ${left.smallDiscount} under ${account.minDiscount}%, ${left.ended} ended, ${left.endsTooSoon} ending within ${account.minHoursLeft} h, ${left.oldPrice} old prices${account.select ? `, ${left.notNiche} outside the niche, ${left.noFacts} without facts` : ''}${left.taken ? `, ${left.taken} taken by another account today` : ''}.`,
    `Sources not read: ${failed.length ? failed.map((f) => `${f.name} (${f.why})`).join(', ') : 'none'}.`,
    `Built by: ${buildInfo()}.`,
  );

  return { md: lines.join('\n') + '\n', json: { account: account.name, generatedAt: new Date(now).toISOString(), builtBy: buildInfo(), pricesCheckedAt: checked ?? null, warnings, ...(account.select ? { niche: { label: account.select.label ?? account.name, fit, postable: eligible.length } } : {}), candidates, gogNews: news, topical, topics: topics.map((s) => ({ headline: s.lead.title, score: s.score, sites: s.domains, keywords: s.hits, games: s.games, items: s.items.map((i) => ({ source: i.source, title: i.title, link: i.link ?? null, published: new Date(i.t).toISOString() })) })), left, sources: { total: mine.length, failed } }, top: candidates[0] ?? null, itemRecords };
}

// ---------- ready posts ----------

// One post per channel of the account (accounts.<id>.channels in data/accounts.json), all about the same first deal of the brief.
// Accounts without "channels" (the Nostr account has its own program) get nothing here. A channel that cannot be made honestly
// (no deal today, a broken template, an incomplete deal) gets a file that says "NO POST TODAY" and why, never an invented post.
export function makePosts({ id, account, brief, links, now }) {
  const day = isoDay(now);
  const posts = [];
  for (const [name, raw] of Object.entries(account.channels ?? {})) {
    if (raw?.enabled === false) continue;
    try {
      const c = brief.candidates[0];
      if (!c) {
        posts.push({ channel: name, none: `No deal passes the rules today.${brief.warnings.length ? ' ' + brief.warnings.join(' ') : ''}`, expected: true });
        continue;
      }
      const channel = channelWithDefaults(id, name, raw);
      posts.push({ channel: name, deal: c.id, title: c.title, ...buildPost({ candidate: c, channel, links, day, every: account.cadence?.everyDays ?? 1 }) });
    } catch (e) {
      posts.push({ channel: name, none: e.message });
    }
  }
  return posts;
}

// ---------- run ----------

async function fetchFeeds(sources) {
  const feeds = new Map();
  console.log(`Reading ${sources.length} feeds, pause ${PAUSE_MS} ms between requests.`);
  for (const [i, src] of sources.entries()) {
    if (i) await sleep(PAUSE_MS);
    const r = await loadFeed(src.feed, { ua: UA, timeoutMs: TIMEOUT_MS });
    feeds.set(src.id, r);
    console.log(`${String(i + 1).padStart(2)}/${sources.length} ${r.kind.padEnd(8)} ${src.name}${r.kind === 'OK' ? ` (${r.items.length} items)` : ' - ' + r.note}`);
  }
  return feeds;
}

async function main() {
  const now = process.env.BRIEF_NOW ? Date.parse(process.env.BRIEF_NOW) : Date.now();
  const outDir = path('OUT_DIR', '../drafts/');
  const cfg = await readJson(path('ACCOUNTS_FILE', '../data/accounts.json'));
  const sources = (await readJson(path('SOURCES_FILE', '../data/sources.json'))).sources;
  const deals = await readJson(path('DEALS_FILE', '../data/deals.json'));
  const history = await readJson(path('HISTORY_FILE', '../data/history.json'), {});
  const facts = await readJson(path('FACTS_FILE', '../data/game-facts.json'), {});
  const log = await readJson(path('LOG_FILE', '../data/drafts-log.json'), {});
  const state = await readJson(path('STATE_FILE', '../drafts/brief-state.json'), { top: {} });

  const only = process.argv.includes('--account') ? process.argv[process.argv.indexOf('--account') + 1] : null;
  const accounts = Object.entries(cfg.accounts)
    .filter(([id, a]) => a.enabled !== false && (!only || id === only))
    .map(([id, a]) => [id, withDefaults(id, a)]);
  if (!accounts.length) throw new Error(only ? `No enabled account "${only}" in data/accounts.json.` : 'No enabled accounts in data/accounts.json.');

  const needed = new Map();
  for (const [, a] of accounts) for (const s of pickSources(sources, a)) needed.set(s.id, s);
  const feeds = await fetchFeeds([...needed.values()]);

  await mkdir(outDir, { recursive: true });
  const today = isoDay(now);
  state.top ??= {};
  // A new run replaces today's picks of every account it makes, so an earlier run of the same day cannot take a game away from an account.
  for (const [id] of accounts) for (const [k, day] of Object.entries(state.top[id] ?? {})) if (day === today) delete state.top[id][k];
  const byId = new Map(accounts);
  for (const [id, account] of accounts) {
    if (!isPostDay(account.cadence, now)) {
      // Off day of an account with a cadence: no brief, no pick (so nothing is marked as used), and the post files say why.
      const next = nextPostDay(account.cadence, now);
      const why = `Off day: this account posts every ${account.cadence.everyDays} days. Next post: ${dayOf(Date.parse(next))}.`;
      await writeFile(resolve(outDir, `brief-${id}.md`), `# Brief: ${account.name} (${account.handle}), ${stampOf(now)}\n${why}\n`);
      await writeFile(resolve(outDir, `brief-${id}.json`), JSON.stringify({ account: account.name, generatedAt: new Date(now).toISOString(), offDay: true, nextPostDay: next, candidates: [], posts: {} }, null, 2) + '\n');
      for (const [name, raw] of Object.entries(account.channels ?? {})) if (raw?.enabled !== false) await writeFile(resolve(outDir, `post-${id}-${name}.md`), `NO POST TODAY: ${why}\n`);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${account.name}: no post today\n\n${why}\n\n`);
      console.log(`\n${account.name}: ${why}`);
      continue;
    }
    const mem = (state.top[id] ??= {});
    for (const [k, day] of Object.entries(mem)) if (day === today) delete mem[k]; // a second run on the same day replaces today's pick
    const offered = offeredFor({ log, mem, state, account, today });
    const taken = takenToday({ state, accounts: byId, deals, id, today });
    const { md, json, top, itemRecords } = buildBrief({ account, links: cfg.links, deals, history, offered, feeds, sources, now, facts, taken });
    if (top?.kind === 'deal') mem[top.id] = today;
    for (const [k, day] of Object.entries(mem)) if ((now - Date.parse(day)) / DAY > 30) delete mem[k];
    const posts = makePosts({ id, account, brief: json, links: cfg.links, now });
    json.posts = Object.fromEntries(posts.map((p) => [p.channel, p.none ? { none: p.none } : { text: p.text, length: p.length, max: p.max, link: p.link, deal: p.deal }]));
    await writeFile(resolve(outDir, `brief-${id}.md`), md);
    await writeFile(resolve(outDir, `brief-${id}.json`), JSON.stringify(json, null, 2) + '\n');
    // Every news item of the window and what happened to it (used for a deal, shown as a topic, dropped and why).
    await writeFile(resolve(outDir, `items-${id}.json`), JSON.stringify({ account: account.name, generatedAt: new Date(now).toISOString(), windowHours: account.windowHours, count: itemRecords.length, items: itemRecords }, null, 1) + '\n');
    // The ready posts: one small file per channel (only the text, ready to copy), also shown on the run page.
    const warn = (msg) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `WARNING: ${msg}`);
    for (const p of posts) {
      await writeFile(resolve(outDir, `post-${id}-${p.channel}.md`), p.none ? `NO POST TODAY: ${p.none}\n` : p.text + '\n');
      if (process.env.GITHUB_STEP_SUMMARY) {
        const head = `## Post for ${p.channel} (${account.name}, ${p.none ? 'no post today' : `${p.length} of ${p.max} characters`}): copy this`;
        const notes = (p.warnings ?? []).map((w) => `- ${w}\n`).join('');
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${head}\n\n\`\`\`\`text\n${p.none ? 'NO POST TODAY: ' + p.none : p.text}\n\`\`\`\`\n\n${notes}\n`);
      }
      if (p.none && !p.expected) warn(`Post for ${p.channel} of ${id}: ${p.none}`);
      for (const w of p.warnings ?? []) warn(`Post for ${p.channel} of ${id}: ${w}`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${account.name}: the full brief (only for the chat, if you want to change the post)\n\n\`\`\`\`text\n${md}\`\`\`\`\n\n`);
    console.log('\n' + md);
    for (const p of posts) console.log(`----- post for ${p.channel} (${p.none ? 'none' : `${p.length}/${p.max}`}) -----\n${p.none ? 'NO POST TODAY: ' + p.none : p.text}\n`);
  }
  await writeFile(resolve(outDir, 'brief-state.json'), JSON.stringify(state, null, 2) + '\n');
  console.log(`Files in ${outDir}: ${accounts.map(([id]) => `brief-${id}.md`).join(', ')}, brief-state.json`);
}

// Running the file always makes the brief. Only the tests set this variable, to import the functions without running it.
if (!process.env.DAILY_BRIEF_AS_MODULE) await main();
