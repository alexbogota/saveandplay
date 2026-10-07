// Daily brief: collects the material for ONE post per account. Publishes nothing, changes nothing on the site.
//
//   npm run brief                    all accounts that are enabled in data/accounts.json
//   node scripts/daily-brief.mjs --account prices      only one account
//   GitHub -> Actions -> "Daily brief" (runs every morning by itself, or press Run workflow)
//
// Three sieves (see PROJECT.md, section 11):
//   1. Only the sources whose topic is the account's topic (data/sources.json, status ok or rare).
//   2. Only news from the last windowHours hours. One story written by several sites = "hot today".
//   3. Only news that is about a deal we have (data/deals.json), found by the game's link or by its name in the headline.
//      Deals nobody wrote about stay in the list too (ranked lower), so there is always something to post.
//
// Result per account: drafts/brief-<account>.md (the only file Claude needs to read, about 1,500 tokens),
// drafts/brief-<account>.json (same data for programs) and drafts/brief-state.json (what was suggested, to avoid repeats).
// On GitHub the same text is also shown on the run page (Summary), ready to copy.
//
// Prices come only from our own data/deals.json. News is only a hint why a deal is interesting today.
// Good-citizen rules for the feeds are in scripts/lib/feeds.mjs (robots.txt, one request per feed, honest User-Agent).
//
// For tests the files and times can be set in the environment: ACCOUNTS_FILE, SOURCES_FILE, DEALS_FILE, HISTORY_FILE,
// LOG_FILE, STATE_FILE, OUT_DIR, BRIEF_NOW, FEED_TIMEOUT_MS, FEED_PAUSE_MS.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadFeed, sleep } from './lib/feeds.mjs';
import { clean, hasName, nameVariants } from './lib/titles.mjs';

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
const LOWEST_BONUS = 1; // lowest price we have tracked (needs at least MIN_HISTORY_DAYS of data)
const MIN_HISTORY_DAYS = 3;
const REPEAT_PENALTY = 8; // was the top pick of an earlier brief, or drafted, within repeatDays

// What an account gets when data/accounts.json does not say otherwise.
const DEFAULTS = { minDiscount: 50, windowHours: 48, maxPriceAgeHours: 48, minHoursLeft: 6, repeatDays: 7, maxCandidates: 5, dealsWithoutNews: true, gogNews: false, keywords: [], directLinkStores: [], rules: [] };
const REQUIRED = ['name', 'handle', 'topic', 'subid', 'stores'];
export function withDefaults(id, account) {
  const missing = REQUIRED.filter((k) => !account[k] || (Array.isArray(account[k]) && !account[k].length));
  if (missing.length) throw new Error(`Account "${id}" in data/accounts.json lacks: ${missing.join(', ')}.`);
  return { ...DEFAULTS, ...account };
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

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); // same as src/lib/deals.ts
export const dealId = (d) => slug(`${d.store}-${d.title}`);
export const dealPagePath = (d) => `/deals/${slug(d.store)}/${slug(d.title)}/`; // same as dealPath in src/lib/deals.ts
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
const beats = (a, b) => (a.price !== b.price ? a.price < b.price : storeRank(a.store) < storeRank(b.store));
export function visibleIds(deals) {
  const best = new Map();
  for (const d of deals) if (!best.has(gameKey(d)) || beats(d, best.get(gameKey(d)))) best.set(gameKey(d), d);
  return new Set([...best.values()].map(dealId));
}

// Which deals may be offered to this account, and why the others are left out.
export function eligibleDeals(deals, account, now, offered) {
  const left = { otherStore: 0, hidden: 0, smallDiscount: 0, ended: 0, endsTooSoon: 0, oldPrice: 0 };
  const onSite = visibleIds(deals);
  const eligible = [];
  for (const d of deals) {
    const id = dealId(d);
    const last = offered[id];
    if (!account.stores.includes(d.store)) left.otherStore++;
    else if (!onSite.has(id)) left.hidden++;
    else if (d.discountPct < account.minDiscount) left.smallDiscount++;
    else if (d.endsAt && new Date(d.endsAt) < now) left.ended++;
    else if (d.endsAt && new Date(d.endsAt) - now < account.minHoursLeft * HOUR) left.endsTooSoon++; // over before anyone can use the post
    else if (!d.checkedAt || now - new Date(d.checkedAt) > account.maxPriceAgeHours * HOUR) left.oldPrice++;
    else eligible.push({ deal: d, id, offeredOn: last && last !== isoDay(now) && (now - Date.parse(last)) / DAY < account.repeatDays ? last : null });
  }
  return { eligible, left };
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

export function historyFacts(rows, price, today) {
  const days = rows.length;
  const earlier = rows.filter((r) => r.date !== today);
  const lowest = days >= MIN_HISTORY_DAYS && earlier.length > 0 && price <= Math.min(...earlier.map((r) => r.price));
  return { days, lowest, since: rows[0]?.date ?? null };
}

export function buildCandidates({ eligible, mentions, history, account, links, now }) {
  const today = isoDay(now);
  const byDiscount = [...eligible].sort((a, b) => b.deal.discountPct - a.deal.discountPct);
  const list = eligible.map(({ deal: d, id, offeredOn }) => {
    const found = (mentions.get(id) ?? []).sort((a, b) => (a.how === b.how ? b.t - a.t : a.how === 'link' ? -1 : 1));
    const domains = new Set(found.map((m) => m.domain).filter((x) => x !== domainOf(d.url))); // the store's own news is not an independent site
    const facts = historyFacts(history[id] ?? [], d.price, today);
    const endsInH = d.endsAt ? (new Date(d.endsAt) - now) / HOUR : null;
    const parts = [d.discountPct / 10];
    parts.push(PER_DOMAIN * Math.min(MAX_DOMAINS, domains.size));
    if (endsInH != null && endsInH <= ENDS_SOON_HOURS) parts.push(ENDS_SOON_BONUS);
    if (d.store === 'GOG') parts.push(GOG_BONUS);
    if (facts.lowest) parts.push(LOWEST_BONUS);
    if (offeredOn) parts.push(-REPEAT_PENALTY);
    const direct = account.directLinkStores.includes(d.store) && d.url?.startsWith('https://www.gog.com/');
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
      coverAlt: d.image ? coverAlt(d) : null,
      score: Math.round(parts.reduce((a, b) => a + b, 0) * 10) / 10,
      discountRank: byDiscount.findIndex((x) => x.id === id) + 1,
      sites: domains.size,
      mentions: found.slice(0, 3),
      history: facts,
      offeredOn,
      link: direct ? gogLink(links, d.url, account.subid) : siteLink(links, d, account.subid, today),
      linkKind: direct ? 'affiliate link' : 'link to our site',
    };
  });
  const usable = account.dealsWithoutNews ? list : list.filter((c) => c.sites > 0);
  return usable.sort((a, b) => b.score - a.score || b.discount - a.discount || a.price - b.price);
}

// ---------- the brief ----------

export function buildBrief({ account, links, deals, history, offered, feeds, sources, now }) {
  const windowMs = account.windowHours * HOUR;
  const mine = pickSources(sources, account);
  const failed = mine.filter((s) => feeds.get(s.id)?.kind !== 'OK').map((s) => ({ name: s.name, why: feeds.get(s.id)?.note || 'not read' }));
  const items = recentItems(feeds, mine, now, windowMs);
  const { eligible, left } = eligibleDeals(deals, account, now, offered);
  const mentions = matchNews(items, eligible);
  const all = buildCandidates({ eligible, mentions, history, account, links, now });
  const candidates = all.slice(0, account.maxCandidates);
  const news = account.gogNews ? gogNews(items, deals).map((n) => ({ ...n, link: gogLink(links, n.url, account.subid) })) : [];
  const topical = account.keywords?.length ? keywordNews(items, account.keywords) : [];

  const checked = deals.map((d) => d.checkedAt).filter(Boolean).sort().at(-1);
  const warnings = [];
  if (!deals.length) warnings.push('data/deals.json is empty.');
  else if (!eligible.length) {
    warnings.push(
      `No deal passes the rules (${left.oldPrice} prices older than ${account.maxPriceAgeHours} h, ${left.ended + left.endsTooSoon} sales over or ending within ${account.minHoursLeft} h, ${left.smallDiscount} under ${account.minDiscount}%). The prices in data/deals.json probably need a refresh; then run the brief again.`,
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
  for (const w of warnings) push(`WARNING: ${w}`);
  push('', 'Write ONE post about the first item below (take another one only if it looks wrong, and say why).');
  if (account.rules?.length) push('Rules:', ...account.rules.map((r) => `- ${r}`));

  candidates.forEach((c, i) => {
    push('', `## ${i + 1}. ${c.title}: ${c.store} ${money(c.price)} (was ${money(c.was)}, -${c.discount}%)`);
    const ends = c.endsAt ? `Sale ends ${stampOf(new Date(c.endsAt))} (in ${hoursText(c.endsInHours * HOUR)})` : 'No end date known';
    push(`${ends}. Price checked ${stampOf(new Date(c.priceCheckedAt))}. Score ${c.score}.`);
    const why = [];
    if (c.mentions.length) why.push(`${c.sites} news site${c.sites > 1 ? 's' : ''} wrote about the game in the last ${account.windowHours} h`);
    if (c.endsInHours != null && c.endsInHours <= ENDS_SOON_HOURS) why.push(`sale ends in ${hoursText(c.endsInHours * HOUR)}`);
    if (c.history.lowest) why.push(`lowest price we've tracked (${c.history.days} days of data)`);
    why.push(`deepest-discount rank ${c.discountRank} of ${eligible.length}`);
    push(`Why today: ${why.join('; ')}.`);
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
  push(
    '',
    `Left out: ${left.otherStore} other-store deals, ${left.hidden} hidden duplicates, ${left.smallDiscount} under ${account.minDiscount}%, ${left.ended} ended, ${left.endsTooSoon} ending within ${account.minHoursLeft} h, ${left.oldPrice} old prices.`,
    `Sources not read: ${failed.length ? failed.map((f) => `${f.name} (${f.why})`).join(', ') : 'none'}.`,
  );

  return { md: lines.join('\n') + '\n', json: { account: account.name, generatedAt: new Date(now).toISOString(), pricesCheckedAt: checked ?? null, warnings, candidates, gogNews: news, topical, left, sources: { total: mine.length, failed } }, top: candidates[0] ?? null };
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
  for (const [id, account] of accounts) {
    const mem = (state.top[id] ??= {});
    for (const [k, day] of Object.entries(mem)) if (day === today) delete mem[k]; // a second run on the same day replaces today's pick
    const offered = { ...log, ...Object.fromEntries(Object.entries(mem).filter(([, day]) => day !== today)) }; // earlier briefs' top picks and manual drafts
    const { md, json, top } = buildBrief({ account, links: cfg.links, deals, history, offered, feeds, sources, now });
    if (top?.kind === 'deal') mem[top.id] = today;
    for (const [k, day] of Object.entries(mem)) if ((now - Date.parse(day)) / DAY > 30) delete mem[k];
    await writeFile(resolve(outDir, `brief-${id}.md`), md);
    await writeFile(resolve(outDir, `brief-${id}.json`), JSON.stringify(json, null, 2) + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${account.name}: copy this block into the chat\n\n\`\`\`\`text\n${md}\`\`\`\`\n\n`);
    console.log('\n' + md);
  }
  await writeFile(resolve(outDir, 'brief-state.json'), JSON.stringify(state, null, 2) + '\n');
  console.log(`Files in ${outDir}: ${accounts.map(([id]) => `brief-${id}.md`).join(', ')}, brief-state.json`);
}

// Running the file always makes the brief. Only the tests set this variable, to import the functions without running it.
if (!process.env.DAILY_BRIEF_AS_MODULE) await main();
