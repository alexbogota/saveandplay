// Niche scouting for Quora: pure functions, no network here. Used by scripts/quora-scout.mjs and its test.
// Idea: for each niche, run a handful of searches limited to quora.com (through a search API, never Quora itself),
// count how many DIFFERENT on-topic question pages come back, and say which of our articles already answer them.
// It measures how many questions exist, not how many people read them: Quora shows views only to a logged-in person.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Subdomains that are Quora in another language, not Spaces.
const LANGUAGE_HOSTS = new Set(['es', 'fr', 'de', 'it', 'pt', 'jp', 'ja', 'id', 'hi', 'nl', 'da', 'fi', 'no', 'sv', 'mr', 'bn', 'ta', 'ar', 'he', 'gu', 'kn', 'ml', 'te', 'pl', 'tr', 'ru', 'ko', 'zh']);
// First path segments on www.quora.com that are not questions.
const NOT_QUESTIONS = new Set(['profile', 'topic', 'q', 'about', 'search', 'spaces', 'contact', 'careers', 'press', 'answer', 'following', 'notifications', 'settings', 'partners', 'business', 'qemail', 'sitemap', 'tos']);

// { kind: 'question' | 'space' | 'foreign' | 'other', key }: key is the same for every address of one question.
// lang: the Quora the niche looks at: 'en' = www.quora.com, 'es' = es.quora.com and so on. Pages of another language are 'foreign'.
export function classifyUrl(url, lang = 'en') {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { kind: 'other', key: String(url) };
  }
  const host = u.hostname.toLowerCase();
  if (host !== 'quora.com' && !host.endsWith('.quora.com')) return { kind: 'other', key: url };
  const sub = host === 'quora.com' ? 'www' : host.slice(0, -'.quora.com'.length);
  const parts = u.pathname.split('/').filter(Boolean);
  const home = lang === 'en' ? 'www' : lang;
  if (sub !== home && (LANGUAGE_HOSTS.has(sub) || sub === 'www')) return { kind: 'foreign', key: `${host}/${parts[0] ?? ''}`.toLowerCase() };
  if (sub !== home) return { kind: 'space', key: `${host}/${parts[0] ?? ''}`.toLowerCase() };
  const first = parts[0] === 'unanswered' ? parts[1] : parts[0];
  if (!first || NOT_QUESTIONS.has(first.toLowerCase()) || !first.includes('-')) return { kind: 'other', key: `${host}/${parts.join('/')}`.toLowerCase() };
  let key = first;
  try {
    key = decodeURIComponent(first);
  } catch {}
  return { kind: 'question', key: key.toLowerCase() };
}

// "How do I ...? - Some Space - Quora" -> "How do I ...?"
export const cleanTitle = (title) =>
  String(title ?? '')
    .replace(/\s+[-|]\s+Quora\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

export function onTopic(title, niche, blockWords = []) {
  const t = title.toLowerCase();
  if ([...(niche.blockWords ?? []), ...blockWords].some((w) => t.includes(w.toLowerCase()))) return false;
  const words = niche.words ?? [];
  return words.length === 0 || words.some((w) => t.includes(w.toLowerCase()));
}

// The searches for one niche: its own queries first, then every seed with every stem ("how to" + "sell digital planners").
export function buildQueries(niche, settings = {}) {
  const out = [];
  const add = (q) => {
    const s = String(q).replace(/\s+/g, ' ').trim();
    if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  };
  for (const q of niche.queries ?? []) add(q);
  for (const seed of niche.seeds ?? []) {
    add(seed);
    for (const stem of niche.stems ?? settings.stems ?? []) add(`${stem} ${seed}`);
  }
  return out.slice(0, niche.maxQueries ?? settings.maxQueries ?? 12);
}

const STOP = new Set('a an the and or but of for to in on at by with from as is are was were be been it its this that these those i you we they my your our their me do does did can could should would will what which who whom when where why how if not no yes so than then there here have has had get got make made use used using any some more most much many about into out up down over under vs without within also just like one two best good way ways need want find free buy sell game games pc run play playing work check read tell say says know mean keep start stop take give look see try before after really actually thing things'.split(' '));

// Lowercase words that carry meaning, with a crude plural cut ("games" -> "game").
export function keyWords(text) {
  const out = new Set();
  for (const w of String(text ?? '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu) ?? []) {
    for (const part of w.split('-')) {
      if (part.length < 3 || STOP.has(part)) continue;
      out.add(part.length > 4 && part.endsWith('s') && !part.endsWith('ss') ? part.slice(0, -1) : part);
    }
  }
  return out;
}

// Words that sit in the titles of a quarter of the articles or more ("steam" on a Steam site) say nothing about one article.
export function commonWords(articles) {
  if (articles.length < 4) return new Set();
  const seen = new Map();
  for (const a of articles) for (const w of a.words) seen.set(w, (seen.get(w) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n / articles.length >= 0.25).map(([w]) => w));
}

// How many articles have each word in the title.
export function wordCounts(articles) {
  const seen = new Map();
  for (const a of articles) for (const w of a.words) seen.set(w, (seen.get(w) ?? 0) + 1);
  return seen;
}

// The article whose TITLE fits the question best, or null. It fits when they share minShared meaningful words
// (words common to many articles do not count), or ONE word that only this article has and that is a topic word of the niche
// ("old" for the niche of old games). It is a hint for a person, not a verdict.
export function matchArticle(title, articles, minShared = 2, { common = commonWords(articles), counts = wordCounts(articles), topicWords = new Set() } = {}) {
  const q = keyWords(title);
  let best = null;
  for (const a of articles) {
    const shared = [...a.words].filter((w) => q.has(w) && !common.has(w));
    const own = articles.length >= 4 && shared.some((w) => counts.get(w) === 1 && topicWords.has(w)); // with a few articles every word is "only here"
    if ((shared.length >= minShared || own) && (!best || shared.length > best.shared.length)) best = { article: a, shared };
  }
  return best;
}

// Articles of one niche. source: { dir: "src/pages/guides", base: "https://site/guides/" } reads the titles of .md files;
// { list: [{ title, url }] } takes them as written. A sitemap is read by the caller (network) and handed in as a list.
export function loadArticles(sources, root) {
  const out = [];
  for (const src of [].concat(sources ?? [])) {
    if (src.list) for (const a of src.list) out.push({ title: a.title, url: a.url, words: keyWords(a.title) });
    if (src.dir) {
      const dir = join(root, src.dir);
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
        const text = readFileSync(join(dir, name), 'utf8');
        const title = text.match(/^title:\s*"?(.*?)"?\s*$/m)?.[1]?.replace(/\\"/g, '"');
        if (!title) continue;
        const slug = name.replace(/\.md$/, '');
        out.push({ title, url: `${src.base ?? ''}${slug}/`, words: keyWords(`${title} ${slug}`) });
      }
    }
  }
  return out;
}

// Addresses of a sitemap -> articles (the title is made from the last part of the address).
export function articlesFromSitemap(xml, { include } = {}) {
  const out = [];
  for (const m of String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const url = m[1].replace(/&amp;/g, '&');
    if (include && !url.includes(include)) continue;
    const slug = url.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() ?? '';
    if (!slug.includes('-')) continue;
    const title = slug.replace(/\.html?$/, '').replace(/-/g, ' ');
    out.push({ title, url, words: keyWords(title) });
  }
  return out;
}

// raw: [{ query, results: [{ title, url }] }] for one niche -> the numbers and the list of questions.
// angles: { "как сделать": [words], "где взять": [words], ... } = the kinds of question we can answer with our material.
// A question may fit several. Old settings with focusWords still work as one angle.
export function scoutNiche(niche, raw, { articles = [], minShared = 2, blockWords = [], angles = null } = {}) {
  const angleSets = Object.entries(angles ?? (niche.focusWords?.length ? { "в цель": niche.focusWords } : {}));
  const common = commonWords(articles);
  const titleCounts = wordCounts(articles);
  const topicWords = keyWords((niche.words ?? []).join(" "));
  const byKey = new Map();
  const counts = { results: 0, spaces: 0, foreign: 0, other: 0, offTopic: 0 };
  const perQuery = [];
  for (const { query, results } of raw) {
    let fit = 0;
    for (const r of results ?? []) {
      counts.results++;
      const { kind, key } = classifyUrl(r.url, niche.lang ?? 'en');
      if (kind !== 'question') {
        counts[kind === 'space' ? 'spaces' : kind === 'foreign' ? 'foreign' : 'other']++;
        continue;
      }
      const title = cleanTitle(r.title);
      if (!onTopic(title, niche, blockWords)) {
        counts.offTopic++;
        continue;
      }
      fit++;
      const q = byKey.get(key) ?? { title, url: r.url.replace(/[?#].*$/, ''), queries: [] };
      if (!q.queries.includes(query)) q.queries.push(query);
      byKey.set(key, q);
    }
    perQuery.push({ query, results: (results ?? []).length, fit });
  }
  const questions = [...byKey.values()]
    .map((q) => {
      const m = articles.length ? matchArticle(q.title, articles, minShared, { common, counts: titleCounts, topicWords }) : null;
      const low = q.title.toLowerCase();
      const fits = angleSets.filter(([, words]) => words.some((w) => low.includes(w.toLowerCase()))).map(([name]) => name);
      return { ...q, focus: fits.length > 0, angles: fits, article: m ? { title: m.article.title, url: m.article.url, shared: m.shared } : null };
    })
    .sort((a, b) => Number(b.focus) - Number(a.focus) || b.queries.length - a.queries.length || a.title.localeCompare(b.title));
  const queries = raw.length;
  return {
    queries,
    ...counts,
    questions,
    unique: questions.length,
    share: counts.results ? questions.length / counts.results : 0,
    queriesWithQuestions: perQuery.filter((p) => p.fit >= 3).length,
    withArticle: questions.filter((q) => q.article).length,
    focused: angleSets.length ? questions.filter((q) => q.focus).length : null, // questions that fit at least one angle
    angles: Object.fromEntries(angleSets.map(([name]) => [name, questions.filter((q) => q.angles.includes(name)).length])),
    perQuery,
  };
}

// 'strong' | 'early' | 'medium' | 'weak' | 'no-data'. The limits live in the settings file; they are rough, compare niches with each other.
// 'early' = the share is high but there were too few searches to be sure.
export function verdict(stats, limits = {}) {
  if (!stats.results) return 'no-data';
  const { strongShare = 0.55, mediumShare = 0.3, minQueries = 3 } = limits;
  if (stats.share >= strongShare) return stats.queries < minQueries ? 'early' : 'strong';
  return stats.share >= mediumShare ? 'medium' : 'weak';
}

const LABEL = { strong: 'вопросов много', early: 'похоже, много (мало запросов, проверить шире)', medium: 'вопросы есть, но не везде', weak: 'вопросов мало', 'no-data': 'нет данных' };
export const verdictLabel = (v) => LABEL[v] ?? v;
const RANK = { strong: 0, early: 1, medium: 2, weak: 3, 'no-data': 4 };
// The order of the report: the surest niches first, then the ones with more questions.
export const byStrength = (a, b) => RANK[a.verdict] - RANK[b.verdict] || b.stats.unique - a.stats.unique;

const pct = (x) => `${Math.round(x * 100)}%`;

// The report for the owner (Russian). niches: [{ id, niche, stats, verdict, hasArticles }].
export function renderReport(niches, { date, source, top = 20 } = {}) {
  const lines = [
    `# Разведка Quora: есть ли вопросы по нишам (${date})`,
    '',
    `Источник поиска: ${source}. Саму Quora программа не открывает: она смотрит, какие страницы quora.com находит поисковик по запросам ниши.`,
    '',
    'Как читать: «вопросов» = сколько РАЗНЫХ вопросов по теме нашлось; «подходят нам» = сколько из них того вида, на который у нас есть чем ответить («как сделать»: уроки и курсы; «где взять»: каталог; «можно ли продавать»: лицензии), один вопрос может попасть в два вида, такие стоят в списке первыми; «доля» = какая часть всех найденных страниц оказалась вопросами по теме (остальное: чужие темы, рекламные «Spaces», повторы). Чем выше доля, тем плотнее ниша. Просмотры вопросов программа не видит. Пороги грубые: сравнивайте ниши между собой.',
    '',
    '| Ниша | Запросов | Вопросов | Подходят нам (по видам вопроса) | Доля | Запросов с 3+ вопросами | Рекламных Spaces | Есть наша статья | Вывод |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const n of niches) {
    const s = n.stats;
    lines.push(`| ${n.niche.name ?? n.id} | ${s.queries} | ${s.unique} | ${s.focused === null ? "не задано" : `${s.focused} (${Object.entries(s.angles).map(([n, c]) => `${n}: ${c}`).join(", ")})`} | ${pct(s.share)} | ${s.queriesWithQuestions} из ${s.queries} | ${s.spaces} | ${n.hasArticles ? `${s.withArticle} из ${s.unique}` : 'статьи не подключены'} | ${verdictLabel(n.verdict)} |`);
  }
  for (const n of niches) {
    const s = n.stats;
    lines.push('', `## ${n.niche.name ?? n.id}`, '');
    if (!s.results) {
      lines.push('Поиск ничего не вернул.');
      continue;
    }
    lines.push(`Найдено страниц: ${s.results}. Вопросов по теме: ${s.unique}. Не по теме: ${s.offTopic}. Spaces: ${s.spaces}. Другие языки: ${s.foreign}. Прочее: ${s.other}.`, '');
    lines.push('По запросам (сколько вопросов по теме дал каждый):');
    for (const p of s.perQuery) lines.push(`- ${p.fit} из ${p.results}: ${p.query}`);
    const shown = s.questions.slice(0, top);
    lines.push('', `Вопросы${s.unique > shown.length ? ` (первые ${shown.length} из ${s.unique})` : ''}:`);
    for (const q of shown) lines.push(`- ${q.angles?.length ? `(${q.angles.join(", ")}) ` : ""}[${q.title}](${q.url})${q.article ? `\n  наша статья: [${q.article.title}](${q.article.url})` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}
