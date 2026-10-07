// Article topics for the daily brief: news of the last hours that is NOT about one of our deals, grouped into stories.
// Only headlines, links and dates are used and saved. The text of the articles is never copied.
//
//   1. News already used for a deal candidate (matchNews) and the stores' own news are set aside.
//   2. The rest is grouped: headlines of different sites that say the same thing (same words) are one story.
//   3. A story is scored: how many independent sites wrote about it, how many of the account's keywords are in the headlines,
//      whether it is about a game we have a discount for (any game in data/deals.json, even if it is not offered today).
//   4. The best maxTopics stories are shown. Every news item gets a record saying what happened to it (items-<account>.json).

import { clean, hasName, nameVariants } from './titles.mjs';

const SITE_POINTS = 3; // each independent site that wrote about the story
const MAX_SITES = 4;
const KEYWORD_POINTS = 2; // each different keyword of the account found in the headlines
const MAX_KEYWORDS = 2;
const GAME_POINTS = 3; // the story is about a game we list with a discount

// Words that say nothing about the story. Two headlines are the same story only if they share other words.
const STOP = new Set(
  ('a an and are as at be but by can could do does for from get gets had has have how if in into is it its just more most new news not of on or our out ' +
    'over so than that the their them then there these they this to up us was we what when where which who why will with would you your ' +
    'game games gaming pc steam review reviews guide guides best top hands first look trailer update updates now today week').split(' '),
);
const tokens = (title) => new Set(clean(title).split(' ').filter((w) => w && !STOP.has(w) && (w.length > 1 || /\d/.test(w))));

const sameStory = (a, b) => {
  if (a.link && a.link === b.link) return true;
  let inter = 0;
  for (const w of a.tokens) if (b.tokens.has(w)) inter++;
  if (inter < 2) return false;
  const union = a.tokens.size + b.tokens.size - inter;
  return inter / union >= 0.5 || (inter >= 3 && inter / Math.min(a.tokens.size, b.tokens.size) >= 0.6);
};

// Groups items (with .title, .link, .t) into stories. Returns [{ items, lead }]. Union-find: A~B and B~C puts A, B, C together.
export function groupStories(items) {
  const nodes = items.map((it) => ({ it, link: it.link, tokens: tokens(it.title) }));
  const parent = nodes.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (sameStory(nodes[i], nodes[j])) parent[find(j)] = find(i);
  const groups = new Map();
  nodes.forEach((n, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(n);
  });
  return [...groups.values()].map((g) => {
    // The headline that shares the most words with the others stands for the story.
    const share = (n) => g.reduce((s, m) => s + (m === n ? 0 : [...n.tokens].filter((w) => m.tokens.has(w)).length), 0);
    const lead = [...g].sort((a, b) => share(b) - share(a) || b.it.t - a.it.t)[0];
    return { items: g.map((n) => n.it), lead: lead.it };
  });
}

// Which keywords of the account are in these headlines (whole words or phrases).
export function keywordHits(titles, keywords) {
  const text = ` ${titles.map(clean).join(' | ')} `;
  return [...new Set(keywords.map(clean).filter((k) => k && text.includes(` ${k} `)))];
}

// Games from data/deals.json that the headlines are about (by the game's name, same rules as for deal news).
export function gamesInHeadlines(titles, deals) {
  const heads = titles.map(clean);
  const found = new Set();
  for (const d of deals) if (nameVariants(d.title).some((n) => heads.some((h) => hasName(h, n)))) found.add(d.title);
  return [...found];
}

// items: [{ title, link, t, domain, source }]   usedKeys: Map `${link}|${title}` -> deal id, for news already used for deal candidates
// skipDomains: Set of domains of stores (their own news is not an independent site)
export function articleTopics({ items, usedKeys, skipDomains, deals, keywords, maxTopics }) {
  const records = new Map(); // item -> what happened to it
  const open = [];
  for (const it of items) {
    const key = `${it.link ?? ''}|${it.title}`;
    if (usedKeys.has(key)) records.set(it, { status: 'deal-news', deal: usedKeys.get(key) });
    else if (skipDomains.has(it.domain)) records.set(it, { status: 'store-own-news' });
    else open.push(it);
  }
  const stories = groupStories(open).map((g) => {
    const titles = g.items.map((i) => i.title);
    const domains = [...new Set(g.items.map((i) => i.domain))];
    const hits = keywordHits(titles, keywords);
    const games = gamesInHeadlines(titles, deals);
    const parts = [SITE_POINTS * Math.min(MAX_SITES, domains.length), KEYWORD_POINTS * Math.min(MAX_KEYWORDS, hits.length), games.length ? GAME_POINTS : 0];
    return { ...g, domains, hits, games, sites: domains.length, score: parts.reduce((a, b) => a + b, 0), latest: Math.max(...g.items.map((i) => i.t)) };
  });
  // A story needs a reason to be listed: two sites, or a keyword, or a game we have a deal for.
  const worthy = stories.filter((s) => s.sites >= 2 || s.hits.length || s.games.length).sort((a, b) => b.score - a.score || b.latest - a.latest);
  const topics = worthy.slice(0, maxTopics);
  for (const s of stories) {
    const n = topics.indexOf(s);
    const listed = worthy.includes(s);
    const status = n >= 0 ? 'topic' : listed ? 'topic-below-cut' : 'dropped';
    const note = listed ? undefined : 'one site, no keyword of the account, not about a game we list';
    for (const it of s.items) records.set(it, { status, topic: n >= 0 ? n + 1 : undefined, storyHeadline: s.items.length > 1 ? s.lead.title : undefined, score: s.score, note });
  }
  return { topics, records };
}
