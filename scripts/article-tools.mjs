#!/usr/bin/env node
// Tools for the daily article writer (workflow "Daily article"). No AI in here: these are the fixed, checkable parts.
// The writer (Claude, run by the workflow with the owner's subscription token, no paid API) only writes the draft files;
// everything that can be decided by rules is decided here. Settings: data/articles.json. Rules for the writer: docs/article-writer.md.
//
//   node scripts/article-tools.mjs gate                is it time for an article today? (writes drafts/article-run.json, sets workflow outputs)
//   node scripts/article-tools.mjs prompt              builds drafts/article-prompt.txt for the writer (rules + today's facts)
//   node scripts/article-tools.mjs image <svg> <png>   draws the link-card picture (1200x630) from the writer's SVG (needs the "sharp" package)
//   node scripts/article-tools.mjs check [dir]         checks a draft against the rules; prints the problems or OK (exit 1 on problems)
//   node scripts/article-tools.mjs finish              after the writer: picture, check, state, text for the run Summary
//   node scripts/article-tools.mjs list                drafts on the "articles" branch and what happened to them
//   node scripts/article-tools.mjs take [date|slug]    puts a draft into the site folders (src/pages/guides, public/og). /publish uses it after the owner's ok.
//
// A draft is a folder drafts/articles/<date>/ with: article.md, image.svg (and image.png after "finish"), posts.md, notes.md.
// The slug of the article is the name of its picture: image: /og/<slug>.png.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const DEFAULTS = {
  enabled: true,
  everyDays: 2,
  maxPending: 2,
  expireDays: 7,
  model: 'sonnet',
  maxTurns: 60,
  branch: 'articles',
  briefAccount: 'prices',
  section: 'guides',
  minWords: 600,
  maxWords: 2200,
  image: { width: 1200, height: 630 },
  posts: {
    bluesky: { account: 'prices', channel: 'bluesky', minTags: 2, maxTags: 3 },
    mastodon: { account: 'prices', channel: 'mastodon', minTags: 2, maxTags: 5 },
  },
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SITE = 'https://saveandplay.com';
// Top-level pages of the site. Anything else in an internal link is a typo.
const SITE_PAGES = new Set(['', 'deals', 'guides', 'servers', 'disclosure', 'about', 'contact', 'privacy', 'terms']);
// Hosts of affiliate and tracking redirects, and query keys that carry a partner id or a campaign. Guides must have none of them.
const AFFILIATE_HOSTS = ['qwpeg.com', 'admitad.com', 'sovrn.com', 'redirectingat.com', 'viglink.com', 'awin1.com', 'shareasale.com', 'impact.com', 'tkqlhce.com', 'anrdoezrs.net', 'jdoqocy.com', 'kqzyfj.com', 'dpbolvw.net', 'linksynergy.com', 'skimresources.com', 'tradedoubler.com', 'amzn.to', 'howl.me', 'bit.ly', 't.co'];
const TRACKING_PARAMS = /^(utm_.*|ref|ref_id|refid|aff|aff_id|affid|affiliate|affiliate_id|subid|sub_id|sid|clickid|click_id|partner|partner_id|pp|campaign|gclid|fbclid|mc_cid|mc_eid|igshid|cjevent|irclickid)$/i;
const NOTES_HEADINGS = ['## Тема', '## Откуда цифры и факты', '## Что проверить владельцу', '## Когда устареет'];

// ---------- small helpers ----------

const readJson = async (p, fallback) => {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = async (p, data) => {
  await mkdir(resolve(p, '..'), { recursive: true });
  await writeFile(p, JSON.stringify(data, null, 2) + '\n');
};
const output = (k, v) => (process.env.GITHUB_OUTPUT ? appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`) : console.log(`${k}=${v}`));
const summary = (text) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
};
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
const graphemes = (s) => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].length;
const hasCyrillic = (s) => /[Ѐ-ӿ]/.test(s);
const hasEmoji = (s) => /\p{Emoji_Presentation}|️/u.test(s);

export const todayUTC = () => process.env.ARTICLE_DATE || new Date().toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const longDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

export async function loadSettings(root = ROOT) {
  const s = await readJson(join(root, 'data/articles.json'), {});
  const posts = { ...DEFAULTS.posts };
  for (const [k, v] of Object.entries(s.posts ?? {})) if (v) posts[k] = { ...(posts[k] ?? {}), ...v };
  return { ...DEFAULTS, ...s, image: { ...DEFAULTS.image, ...(s.image ?? {}) }, posts };
}

// ---------- reading an article ----------

// Splits "---\nheader\n---\nbody". The header is a small YAML subset: key: value, values plain, "double" or 'single' quoted.
export function splitArticle(text) {
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: null, body: text };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const k = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!k) continue;
    let v = k[2].trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
      try {
        v = JSON.parse(v);
      } catch {
        v = v.slice(1, -1);
      }
    } else if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1).replace(/''/g, "'");
    fm[k[1]] = v;
  }
  return { fm, body: m[2] };
}

// Words of the text itself: pictures (figure, svg), code and link addresses do not count.
export function countWords(body) {
  const prose = body
    .replace(/<figure[\s\S]*?<\/figure>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\]\([^)]*\)/g, ']');
  return prose.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function linksOf(text) {
  const out = new Set();
  for (const m of text.matchAll(/\]\(\s*<?([^)\s>]+)>?[^)]*\)/g)) out.add(m[1]);
  for (const m of text.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) out.add(m[1]);
  for (const m of text.matchAll(/(?<![("'<=\w])https?:\/\/[^\s)<>"']+/g)) out.add(m[0].replace(/[.,;:]+$/, ''));
  return [...out];
}

// Why a link is not allowed in a guide, or null. Internal links (start with /) are checked elsewhere.
export function linkProblem(url) {
  if (url.startsWith('/') || url.startsWith('#') || url.startsWith('mailto:')) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return `not a valid link: ${url}`;
  }
  if (u.protocol !== 'https:') return `link is not https: ${url}`;
  const host = u.hostname.toLowerCase();
  if (AFFILIATE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return `affiliate, tracking or shortened link: ${url}`;
  if (host === 'saveandplay.com' || host === 'www.saveandplay.com') {
    if (u.pathname.startsWith('/go/')) return `our /go/ redirect is an affiliate link: ${url}`;
    return `link to our own site must start with / (not the full address): ${url}`;
  }
  for (const k of u.searchParams.keys()) if (TRACKING_PARAMS.test(k)) return `tracking parameter "${k}" in ${url}`;
  return null;
}

export const pngSize = (buf) =>
  buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR' ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null;

// ---------- posts ----------

// posts.md: "## Bluesky ..." and "## Mastodon ..." headings, each followed by the post in a ```text block.
export function parsePosts(text) {
  const out = {};
  for (const part of text.split(/^##\s+/m).slice(1)) {
    const name = part.split('\n', 1)[0].trim().toLowerCase();
    const m = part.match(/```[a-z]*\r?\n([\s\S]*?)\r?\n```/);
    if (m) out[name.replace(/[^a-z].*$/, '')] = m[1].trim();
  }
  return out;
}

export const postLength = (text, linkChars) => graphemes(text.replace(/https?:\/\/\S+/g, 'x'.repeat(linkChars)));

function checkPost(channelKey, text, cfg, channel, slug, problems) {
  const name = `posts.md, ${channelKey}`;
  if (!text) return problems.push(`${name}: no post found (needs a "## ${channelKey[0].toUpperCase()}${channelKey.slice(1)}" heading and the post in a \`\`\`text block)`);
  if (!channel) return problems.push(`${name}: channel "${cfg.channel ?? channelKey}" of account "${cfg.account}" is not in data/accounts.json`);
  const len = postLength(text, channel.linkChars ?? 25);
  if (len > channel.maxChars) problems.push(`${name}: ${len} characters, the limit is ${channel.maxChars} (the link counts as ${channel.linkChars ?? 25})`);
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  if (urls.length !== 1) problems.push(`${name}: needs exactly one link, found ${urls.length}`);
  else {
    const url = urls[0];
    const utm = channel.utmSource ?? channel.subid;
    if (!url.startsWith(`${SITE}/guides/${slug}/?`)) problems.push(`${name}: the link must go to ${SITE}/guides/${slug}/ with the utm marks`);
    if (!url.includes(`utm_source=${utm}`)) problems.push(`${name}: the link needs utm_source=${utm}`);
    if (!url.includes('utm_medium=social')) problems.push(`${name}: the link needs utm_medium=social`);
    if (!/utm_campaign=guide-[a-z0-9-]{2,40}(&|$)/.test(url)) problems.push(`${name}: the link needs utm_campaign=guide-<short-name>`);
    if (!text.split('\n').some((l) => l.trim() === url)) problems.push(`${name}: the link must stand alone on its own line`);
  }
  const tags = [...text.matchAll(/(?:^|\s)#([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]);
  if (tags.some((t) => t.toLowerCase() === 'ad')) problems.push(`${name}: no #ad (this guide has no affiliate links)`);
  if (tags.length < (cfg.minTags ?? 2) || tags.length > (cfg.maxTags ?? 5)) problems.push(`${name}: ${tags.length} hashtags, need ${cfg.minTags ?? 2} to ${cfg.maxTags ?? 5}`);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (/^ad$/i.test(lines.at(-1) ?? '')) problems.push(`${name}: no "Ad" line (the guide has no affiliate links)`);
  if (hasCyrillic(text)) problems.push(`${name}: English only`);
  if (hasEmoji(text)) problems.push(`${name}: no emoji`);
  if (/lowest (price )?ever|all[- ]time low|best price ever/i.test(text)) problems.push(`${name}: never write "lowest ever"`);
}

// ---------- the check ----------

// Checks one draft folder. Returns { problems: [text], info: {...} }. Used by the writer (to fix its own mistakes) and by "finish".
export async function checkDraft(dir, { root = ROOT, settings, accounts, today = todayUTC() } = {}) {
  settings ??= await loadSettings(root);
  accounts ??= await readJson(join(root, 'data/accounts.json'), { accounts: {} });
  const problems = [];
  const info = {};
  const file = async (name) => {
    try {
      return await readFile(join(dir, name), 'utf8');
    } catch {
      return null;
    }
  };

  // --- article.md ---
  const raw = await file('article.md');
  if (raw === null) problems.push('article.md is missing');
  let slug = null;
  let body = '';
  if (raw !== null) {
    const { fm, body: b } = splitArticle(raw);
    body = b;
    if (!fm) problems.push('article.md has no header (--- ... ---)');
    else {
      const allowed = ['layout', 'section', 'title', 'description', 'updated', 'image', 'imageAlt'];
      for (const k of Object.keys(fm)) if (!allowed.includes(k)) problems.push(`header: unknown key "${k}" (allowed: ${allowed.join(', ')})`);
      if (fm.layout !== '../../layouts/Article.astro') problems.push('header: layout must be ../../layouts/Article.astro');
      if (fm.section !== settings.section) problems.push(`header: section must be ${settings.section}`);
      if (!fm.title || fm.title.length > 100) problems.push('header: title is missing or longer than 100 characters');
      if (!fm.description || fm.description.length < 70 || fm.description.length > 200) problems.push(`header: description must be 70 to 200 characters (now ${fm.description?.length ?? 0})`);
      if (fm.updated !== today) problems.push(`header: updated must be today, ${today} (now "${fm.updated}")`);
      const im = String(fm.image ?? '').match(/^\/og\/([a-z0-9]+(?:-[a-z0-9]+)*)\.png$/);
      if (!im) problems.push('header: image must look like /og/<slug>.png (lowercase words with hyphens)');
      else {
        slug = im[1];
        if (slug.length > 70) problems.push('header: slug is longer than 70 characters');
        for (const section of ['guides', 'servers']) if (existsSync(join(root, 'src/pages', section, `${slug}.md`))) problems.push(`an article with the slug "${slug}" already exists (${section})`);
        if (existsSync(join(root, 'public/og', `${slug}.png`))) problems.push(`public/og/${slug}.png already exists`);
      }
      if (!fm.imageAlt || fm.imageAlt.length < 30 || fm.imageAlt.length > 420) problems.push(`header: imageAlt must describe the picture in 30 to 420 characters (now ${fm.imageAlt?.length ?? 0})`);
      info.title = fm.title;
      info.description = fm.description;
    }
    info.slug = slug;

    const words = countWords(body);
    info.words = words;
    if (words < settings.minWords || words > settings.maxWords) problems.push(`the text has ${words} words, it must have ${settings.minWords} to ${settings.maxWords} (pictures and code do not count)`);

    const sourcesAt = body.search(/^## Sources\s*$/m);
    if (sourcesAt < 0) problems.push('there is no "## Sources" section');
    else {
      const externals = linksOf(body.slice(sourcesAt)).filter((l) => /^https?:/i.test(l));
      if (externals.length < 2) problems.push('"## Sources" needs at least 2 links to the pages you read');
    }
    if (!/^## How we handle this\s*$/m.test(body)) problems.push('there is no "## How we handle this" section');
    if (!linksOf(body).includes('/disclosure/')) problems.push('link to /disclosure/ is missing (in "How we handle this")');
    const readOn = body.match(/\bread on ([A-Z][a-z]+ \d{1,2}, \d{4})/);
    if (!readOn) problems.push('say when you read the sources: "Pages were read on <Month D, YYYY>."');
    else if (readOn[1] !== longDate(today)) problems.push(`"read on" date must be today, ${longDate(today)} (now ${readOn[1]})`);

    for (const l of linksOf(raw)) {
      const p = linkProblem(l);
      if (p) problems.push(p);
      if (l.startsWith('/')) {
        const path = l.split(/[?#]/)[0];
        const parts = path.split('/').filter(Boolean);
        if (!SITE_PAGES.has(parts[0] ?? '')) problems.push(`internal link to an unknown page: ${l}`);
        else if (parts[0] === 'go') problems.push(`/go/ is an affiliate redirect: ${l}`);
        else if ((parts[0] === 'guides' || parts[0] === 'servers') && parts[1]) {
          const exists = existsSync(join(root, 'src/pages', parts[0], `${parts[1]}.md`)) || (parts[0] === 'guides' && parts[1] === slug);
          if (!exists) problems.push(`internal link to an article that does not exist: ${l}`);
        }
      }
    }
    if (/<\s*(script|iframe|object|embed|form|link|meta|style)\b/i.test(raw) || /\son[a-z]+\s*=/i.test(raw) || /javascript:/i.test(raw)) problems.push('no script, iframe, form, style tags or event handlers in the article');
    for (const m of body.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi)) {
      if (!/role\s*=\s*["']img["']/.test(m[0]) || !/<title\b/i.test(m[0])) problems.push('every <svg> in the text needs role="img" and a <title> (alt text for pictures)');
    }
    for (const m of body.matchAll(/<img\b[^>]*>/gi)) if (!/\balt\s*=\s*"[^"]+"/i.test(m[0])) problems.push('every <img> needs a non-empty alt');
    if (hasCyrillic(raw)) problems.push('article.md: English only (no Cyrillic)');
    if (hasEmoji(raw)) problems.push('article.md: no emoji');
    // A sentence that says we do NOT claim it is fine ("we do not claim lowest price ever"); a sentence that claims it is not.
    const claims = raw.split(/(?<=[.!?])\s+|\n+/).filter((s) => /lowest (price )?ever|all[- ]time low|best price ever/i.test(s) && !/\b(not|never|neither|nor|no|cannot|without)\b|n['’]t\b/i.test(s));
    if (claims.length) problems.push('article.md: never claim "lowest ever" or "all-time low"');
    if (/\bTODO\b|\bTBD\b|FIXME|lorem ipsum|\[(source|link|citation) needed\]/i.test(raw)) problems.push('article.md: unfinished text (TODO, TBD, lorem, "source needed")');
  }

  // --- picture ---
  const { width: W, height: H } = settings.image;
  const svg = await file('image.svg');
  let png = null;
  try {
    png = await readFile(join(dir, 'image.png'));
  } catch {}
  if (svg === null && png === null) problems.push('image.svg is missing (the picture for the link card)');
  if (svg !== null) {
    if (!svg.includes(`viewBox="0 0 ${W} ${H}"`)) problems.push(`image.svg: needs viewBox="0 0 ${W} ${H}"`);
    if (/var\(\s*--/.test(svg)) problems.push('image.svg: no CSS variables (var(--...)); use real hex colours');
    if (/<\s*(script|image|foreignObject|iframe)\b/i.test(svg) || /href\s*=\s*["']https?:/i.test(svg)) problems.push('image.svg: no script, <image>, foreignObject or outside links');
    if (hasCyrillic(svg)) problems.push('image.svg: English only');
  }
  if (png !== null) {
    const size = pngSize(png);
    if (!size) problems.push('image.png is not a PNG');
    else if (size.width !== W || size.height !== H) problems.push(`image.png is ${size.width}x${size.height}, it must be ${W}x${H}`);
  }

  // --- posts.md ---
  const postsText = await file('posts.md');
  if (postsText === null) problems.push('posts.md is missing');
  else if (slug) {
    const posts = parsePosts(postsText);
    for (const [key, cfg] of Object.entries(settings.posts)) {
      const channel = accounts.accounts?.[cfg.account]?.channels?.[cfg.channel ?? key];
      checkPost(key, posts[key], cfg, channel, slug, problems);
    }
  }

  // --- notes.md (for the owner, in Russian) ---
  const notes = await file('notes.md');
  if (notes === null) problems.push('notes.md is missing');
  else {
    for (const h of NOTES_HEADINGS) if (!notes.includes(h)) problems.push(`notes.md: heading "${h}" is missing`);
    if (notes.trim().length < 200) problems.push('notes.md is too short: say where every number comes from');
  }
  return { problems, info };
}

// ---------- state and the decision "write today?" ----------

async function listArticles(root = ROOT) {
  const out = [];
  for (const section of ['guides', 'servers']) {
    let names = [];
    try {
      names = await readdir(join(root, 'src/pages', section));
    } catch {}
    for (const n of names.filter((x) => x.endsWith('.md'))) {
      const { fm } = splitArticle(await readFile(join(root, 'src/pages', section, n), 'utf8'));
      out.push({ section, slug: n.slice(0, -3), title: fm?.title ?? n });
    }
  }
  return out;
}

// drafts = [{date, slug, title}] from the state file. Waiting = not on the site yet and not older than expireDays.
export function waitingDrafts(drafts, published, today, expireDays) {
  return drafts.filter((d) => !published.has(d.slug) && daysBetween(d.date, today) <= expireDays);
}

export function gateDecision({ settings, state, today, published, force = false }) {
  if (!settings.enabled) return { run: false, reason: 'The writer is switched off (enabled: false in data/articles.json).' };
  const drafts = state.drafts ?? [];
  if (drafts.some((d) => d.date === today)) return { run: false, reason: 'A draft for today already exists.' };
  if (!force) {
    if (state.lastDate && daysBetween(state.lastDate, today) < settings.everyDays) {
      return { run: false, reason: `The last draft was written on ${state.lastDate}. A new one is written every ${settings.everyDays} day(s).` };
    }
    const waiting = waitingDrafts(drafts, published, today, settings.expireDays);
    if (waiting.length >= settings.maxPending) {
      return { run: false, reason: `${waiting.length} draft(s) wait for your «ок»: ${waiting.map((d) => d.title).join('; ')}. No new draft until one is published (or ${settings.expireDays} days pass).` };
    }
  }
  return { run: true, reason: force ? 'Started by hand (force).' : 'It is time for a new draft.' };
}

export function buildPrompt({ rules, today, settings, articles, drafts, published, brief }) {
  const lines = [];
  lines.push('# Run info (made by scripts/article-tools.mjs)');
  lines.push(`- Today: ${longDate(today)} (${today}). Write "Pages were read on ${longDate(today)}." and updated: ${today}.`);
  lines.push(`- Output folder: drafts/articles/${today}/  (article.md, image.svg, posts.md, notes.md). Write nothing outside it.`);
  lines.push(`- Length of the text: ${settings.minWords} to ${settings.maxWords} words.`);
  lines.push(`- Check command: node scripts/article-tools.mjs check drafts/articles/${today}`);
  lines.push('');
  lines.push('## Articles already on the site (never repeat or overlap them)');
  for (const a of articles) lines.push(`- /${a.section}/${a.slug}/: ${a.title}`);
  if (!articles.length) lines.push('- none');
  lines.push('');
  lines.push('## Earlier drafts of the writer');
  for (const d of drafts) lines.push(`- ${d.date}, ${d.slug}: ${d.title} (${published.has(d.slug) ? 'published' : 'not published'})`);
  if (!drafts.length) lines.push('- none');
  lines.push('');
  lines.push("## Today's Daily brief");
  lines.push(brief ? "Only the block \"Topics for articles\" matters here (headlines and links, to be explained with our data and primary sources). The rest is about deals and posts: ignore it.\n\n" + brief : 'There is no brief today. Pick an evergreen topic.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(rules);
  return lines.join('\n');
}

// ---------- commands ----------

async function cmdGate() {
  const settings = await loadSettings();
  const state = await readJson(join(ROOT, 'drafts/articles-state.json'), { drafts: [] });
  const today = todayUTC();
  const published = new Set((await listArticles()).map((a) => a.slug));
  const d = gateDecision({ settings, state, today, published, force: /^true$/i.test(process.env.FORCE ?? '') });
  console.log(d.run ? `Write a draft: ${d.reason}` : `Skip: ${d.reason}`);
  output('run', d.run);
  output('model', settings.model);
  output('maxTurns', settings.maxTurns);
  output('date', today);
  await writeJson(join(ROOT, 'drafts/article-run.json'), { date: today, run: d.run, reason: d.reason });
  if (!d.run) summary(`## Daily article\n\nNo new draft today. ${d.reason}`);
}

async function cmdPrompt() {
  const settings = await loadSettings();
  const state = await readJson(join(ROOT, 'drafts/articles-state.json'), { drafts: [] });
  const today = todayUTC();
  let rules = await readFile(join(ROOT, 'docs/article-writer.md'), 'utf8');
  if (rules.startsWith('# Правила автора')) rules = rules.replace(/^[\s\S]*?\n---\n/, '').trim(); // the first block is a note for the owner, not for the writer
  let brief = null;
  try {
    brief = await readFile(join(ROOT, `drafts/brief-${settings.briefAccount}.md`), 'utf8');
  } catch {}
  const articles = await listArticles();
  const text = buildPrompt({ rules, today, settings, articles, drafts: state.drafts ?? [], published: new Set(articles.map((a) => a.slug)), brief });
  await mkdir(join(ROOT, 'drafts'), { recursive: true });
  await writeFile(join(ROOT, 'drafts/article-prompt.txt'), text);
  console.log(`Wrote drafts/article-prompt.txt (${text.length} characters).`);
}

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    fail('The "sharp" package is missing. Run: npm install --no-save sharp');
  }
}

export async function renderImage(svgPath, pngPath, width, height) {
  const sharp = await loadSharp();
  await sharp(await readFile(svgPath), { density: 72 }).resize(width, height, { fit: 'fill' }).png({ compressionLevel: 9 }).toFile(pngPath);
  const meta = await sharp(pngPath).metadata();
  if (meta.width !== width || meta.height !== height) throw new Error(`The picture came out ${meta.width}x${meta.height}, not ${width}x${height}`);
}

async function cmdImage(svg, png) {
  if (!svg || !png) fail('Usage: node scripts/article-tools.mjs image <svg> <png>');
  const { image } = await loadSettings();
  await renderImage(svg, png, image.width, image.height);
  console.log(`Wrote ${png} (${image.width}x${image.height}). Open it and look: nothing cut off, nothing overlapping.`);
}

async function cmdCheck(dirArg) {
  const today = todayUTC();
  const dir = resolve(dirArg ?? join(ROOT, 'drafts/articles', today));
  const { problems } = await checkDraft(dir);
  if (problems.length) {
    console.log(`PROBLEMS (${problems.length}):`);
    for (const p of problems) console.log(`- ${p}`);
    process.exit(1);
  }
  console.log('OK: the draft passes all checks.');
}

async function cmdFinish() {
  const run = await readJson(join(ROOT, 'drafts/article-run.json'), null);
  if (!run) fail('drafts/article-run.json is missing: the "gate" step did not run.');
  const settings = await loadSettings();
  const dir = join(ROOT, 'drafts/articles', run.date);
  if (!existsSync(dir)) {
    summary(`## Daily article\n\nThe writer finished but made no draft (no folder drafts/articles/${run.date}/). Look at the step "Write the draft with Claude".`);
    fail(`The writer made no folder ${dir}.`);
  }
  if (existsSync(join(dir, 'image.svg'))) await renderImage(join(dir, 'image.svg'), join(dir, 'image.png'), settings.image.width, settings.image.height);
  const { problems, info } = await checkDraft(dir, { settings });
  if (problems.length) {
    summary(`## Daily article: the draft did not pass the checks\n\nNothing was saved.\n\n${problems.map((p) => `- ${p}`).join('\n')}`);
    console.log(`PROBLEMS:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    process.exit(1);
  }
  const state = await readJson(join(ROOT, 'drafts/articles-state.json'), { drafts: [] });
  state.lastDate = run.date;
  state.drafts = [...(state.drafts ?? []).filter((d) => d.date !== run.date), { date: run.date, slug: info.slug, title: info.title }];
  await writeJson(join(ROOT, 'drafts/articles-state.json'), state);
  await writeJson(join(ROOT, 'drafts/article-run.json'), { ...run, slug: info.slug, title: info.title });

  const read = async (n) => readFile(join(dir, n), 'utf8');
  const { body } = splitArticle(await read('article.md'));
  const posts = parsePosts(await read('posts.md'));
  const repo = process.env.GITHUB_REPOSITORY;
  const where = repo ? `https://github.com/${repo}/tree/${settings.branch}/articles/${run.date}-${info.slug}` : `articles/${run.date}-${info.slug}`;
  const readable = body.replace(/<figure[\s\S]*?<\/figure>/gi, '*(a diagram is here in the real article)*');
  const md = [
    `## Article of the day: ${info.title}`,
    '',
    `**Status:** ready to read, all checks passed. ${info.words} words.`,
    '',
    `> ${info.description}`,
    '',
    `Files (text, picture, posts): ${where}`,
    '',
    '**Чтобы выложить:** прочитайте статью ниже, напишите Claude Code «ок, статья дня» (или команду `/publish`). Посты ниже копируйте только после того, как статья появилась на сайте.',
    '',
    '### Посты (кнопка Copy в углу блока)',
    '',
    ...Object.entries(posts).flatMap(([k, t]) => [`**${k[0].toUpperCase()}${k.slice(1)}**`, '', '```text', t, '```', '']),
    '### Заметки автора (для вас, на сайт не идут)',
    '',
    (await read('notes.md')).replace(/^## /gm, '#### '),
    '',
    '<details><summary>Полный текст статьи</summary>',
    '',
    readable,
    '',
    '</details>',
  ].join('\n');
  summary(md);
  console.log(`OK: draft ${run.date} "${info.title}" (${info.slug}) is ready.`);
}

// ---------- the "articles" branch: list and take (used on the owner's computer by /publish) ----------

const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

async function branchDrafts() {
  const { branch } = await loadSettings();
  try {
    git(['fetch', '--quiet', 'origin', branch]);
  } catch {
    fail(`Cannot fetch the "${branch}" branch from GitHub. No drafts yet, or no network.`);
  }
  const ref = `origin/${branch}`;
  let names = [];
  try {
    names = git(['ls-tree', '--name-only', `${ref}:articles`], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {}
  const published = new Set((await listArticles()).map((a) => a.slug));
  const out = [];
  for (const name of names.sort()) {
    try {
      const { fm } = splitArticle(git(['show', `${ref}:articles/${name}/article.md`], { encoding: 'utf8' }));
      const slug = String(fm?.image ?? '').replace(/^\/og\//, '').replace(/\.png$/, '');
      out.push({ name, date: name.slice(0, 10), slug, title: fm?.title ?? name, published: published.has(slug) });
    } catch {}
  }
  return { ref, drafts: out };
}

async function cmdList() {
  const { drafts } = await branchDrafts();
  if (!drafts.length) return console.log('No drafts on the branch yet.');
  for (const d of drafts) console.log(`${d.date}  ${d.published ? 'PUBLISHED ' : 'waiting   '} ${d.slug}  |  ${d.title}`);
}

async function cmdTake(key) {
  const { ref, drafts } = await branchDrafts();
  const waiting = drafts.filter((d) => !d.published);
  let pick;
  if (!key) {
    if (waiting.length === 1) pick = waiting[0];
    else return fail(waiting.length ? `Several drafts wait. Say which one (date or slug):\n${waiting.map((d) => `  ${d.date}  ${d.slug}  |  ${d.title}`).join('\n')}` : 'No drafts are waiting.');
  } else {
    const found = drafts.filter((d) => d.name === key || d.slug === key || d.date === key);
    if (found.length !== 1) return fail(found.length ? `"${key}" matches several drafts, use the slug.` : `No draft matches "${key}". Run: node scripts/article-tools.mjs list`);
    pick = found[0];
  }
  if (pick.published) return fail(`"${pick.slug}" is already on the site.`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pick.slug)) return fail(`Bad slug "${pick.slug}".`);
  const show = (f, buf) => git(['show', `${ref}:articles/${pick.name}/${f}`], { encoding: buf ? 'buffer' : 'utf8' });
  const d = new Date();
  const todayLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const article = show('article.md').replace(/^updated:.*$/m, `updated: ${todayLocal}`);
  await mkdir(join(ROOT, 'src/pages/guides'), { recursive: true });
  await mkdir(join(ROOT, 'public/og'), { recursive: true });
  await writeFile(join(ROOT, 'src/pages/guides', `${pick.slug}.md`), article);
  await writeFile(join(ROOT, 'public/og', `${pick.slug}.png`), show('image.png', true));
  const socialDir = join(ROOT, 'drafts/social');
  await mkdir(socialDir, { recursive: true });
  const nums = (await readdir(socialDir)).map((n) => Number(n.match(/^post-(\d+)-/)?.[1])).filter(Number.isFinite);
  const num = String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, '0');
  const postsFile = `post-${num}-${pick.slug}.md`;
  await writeFile(join(socialDir, postsFile), `# Post ${num}: ${pick.title}\n\nArticle: ${SITE}/guides/${pick.slug}/\nPost only after the article is live on the site (open the link first). No Ad line: the guide has no affiliate links.\n\n${show('posts.md')}`);
  console.log(`Took "${pick.title}":\n- src/pages/guides/${pick.slug}.md\n- public/og/${pick.slug}.png\n- drafts/social/${postsFile} (posts for Bluesky and Mastodon)\nNow continue with the usual publish steps (build, check, commit, push).`);
}

// ---------- main ----------

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [cmd, ...args] = process.argv.slice(2);
  const commands = { gate: cmdGate, prompt: cmdPrompt, image: cmdImage, check: cmdCheck, finish: cmdFinish, list: cmdList, take: cmdTake };
  if (!commands[cmd]) fail(`Usage: node scripts/article-tools.mjs ${Object.keys(commands).join('|')}`);
  commands[cmd](...args).catch((e) => fail(e.message ?? String(e)));
}
