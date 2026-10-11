// Updates data/deals.json by itself: fresh prices, ended sales removed, new good deals added.
//
//   npm run update-deals                  on your computer (changes data/deals.json and data/history.json)
//   npm run update-deals -- --dry-run     only shows what would change, writes nothing
//   GitHub -> Actions -> "Update deals"   every morning by itself, or press Run workflow
//
// What it does, store by store:
//   IndieGala  runs scripts/indiegala-candidates.mjs (IndieGala's own sale feed + the rules from that script:
//              known publisher, 60%+ off, Steam reviews) and takes its list as the new IndieGala deals.
//   GOG        asks GOG's open catalog for the current price of every GOG game already in deals.json
//              (the sale is over -> the game is removed), reads the sale end date from the game's page,
//              then adds up to a few new best-selling discounted games that pass the quality rules in data/deals-rules.json
//              (enough GOG reviews, and the same Steam check as for IndieGala).
//   Kinguin    reads the small ready list data/kinguin.json of the PUBLIC repo saveandplay-feeds (that repo reads the big Kinguin feed
//              and compares every key with the current Steam price; the address is in data/deals-rules.json). Here the list is checked
//              again with our own rules (scripts/lib/kinguin.mjs) and only a few games a day are added (maxNew, maxTotal).
//              Runs last, so a game that GOG or IndieGala already sell is not shown from Kinguin.
// Then: games listed in "exclude" are removed, a price nobody checked for dropOlderThanHours is removed (we show nothing
// rather than an old price), one price snapshot per deal per day goes to data/history.json.
// Covers (the "image" field) are filled by "npm run covers", the GitHub workflow runs it after this program.
//
// Safe by design: if a store does not answer, its old entries are left as they were (and disappear after
// dropOlderThanHours). Prices are never guessed. Nothing is published.
//
// For tests: DEALS_FILE, HISTORY_FILE, RULES_FILE, ACCOUNTS_FILE, REPORT_DIR, INDIEGALA_SCRIPT, INDIEGALA_OUT,
// STEAM_MOCK_FILE, UPDATE_NOW, FEED_TIMEOUT_MS, FEED_PAUSE_MS, GOG_CATALOG_URL, GOG_PAGE_ORIGIN, KINGUIN_FILE (a local copy of kinguin.json).

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { makeClient, lookup, topDiscounted, endDate } from './lib/gog.mjs';
import { updateKinguin } from './lib/kinguin.mjs';

const UA = 'SaveAndPlay-prices/1.0 (+https://saveandplay.com)';
const HOUR = 3600e3;
const INDIEGALA_TIMEOUT = 40 * 60e3;

// ---------- small helpers ----------

const path = (envName, rel) => (process.env[envName] ? resolve(process.env[envName]) : fileURLToPath(new URL(rel, import.meta.url)));
const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (fallback !== undefined && e.code === 'ENOENT') return fallback;
    throw new Error(`Не удалось прочитать ${file}: ${e.message}`);
  }
};
const money = (n) => `$${Number(n).toFixed(2)}`;

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); // same as src/lib/deals.ts
export const dealId = (d) => slug(`${d.store}-${d.title}`);
export const gogSlug = (url) => url?.match(/gog\.com\/(?:[a-z]{2}\/)?game\/([a-z0-9_]+)/i)?.[1]?.toLowerCase() ?? null;

// Why a deal cannot be shown, or '' when it is fine.
export function problem(d) {
  if (!d || typeof d.title !== 'string' || !d.title || typeof d.store !== 'string' || typeof d.url !== 'string') return 'нет названия, магазина или адреса';
  if (![d.price, d.was, d.discountPct].every(Number.isFinite)) return 'цена или скидка не число';
  if (!(d.price > 0 && d.price < d.was)) return 'цена не меньше старой цены';
  if (Math.abs(Math.round((1 - d.price / d.was) * 100) - d.discountPct) > 2) return 'скидка не сходится с ценами';
  if (!d.checkedAt || Number.isNaN(Date.parse(d.checkedAt))) return 'нет даты проверки';
  return '';
}

// ---------- IndieGala ----------

// The new list of IndieGala deals replaces the old one; covers already found are kept.
export function mergeIndieGala(deals, fresh) {
  const old = deals.filter((d) => d.store === 'IndieGala');
  const byUrl = new Map(old.map((d) => [d.url, d]));
  const bySteam = new Map(old.filter((d) => d.steamId).map((d) => [d.steamId, d]));
  const next = fresh.map((f) => {
    const prev = byUrl.get(f.url) ?? bySteam.get(f.steamId);
    return prev?.image && !f.image ? { ...f, image: prev.image } : f;
  });
  const nextUrls = new Set(next.map((d) => d.url));
  return {
    deals: [...deals.filter((d) => d.store !== 'IndieGala'), ...next],
    added: next.filter((n) => !byUrl.has(n.url)).map((d) => d.title),
    dropped: old.filter((o) => !nextUrls.has(o.url)).map((d) => d.title),
    refreshed: next.filter((n) => byUrl.has(n.url)).length,
  };
}

// The reason a child program failed, in one short line for the report: the error lines it printed
// ("Error: Feed page 1: HTTP 403", "[cause]: ...") and the last thing it said before stopping.
export function whyFailed(said, complained) {
  const lines = complained.split('\n').map((l) => l.trim()).filter(Boolean);
  const errors = lines.filter((l) => /^(\w*Error\b|\[cause\]|Caused by|code:)/.test(l)).slice(0, 3);
  const reason = (errors.length ? errors : lines.slice(-2)).join(' | ');
  const last = said.split('\n').map((l) => l.trim()).filter(Boolean).pop();
  return [reason && `Причина: ${reason.slice(0, 300)}`, last && `Последняя строка перед остановкой: ${last.slice(0, 160)}`].filter(Boolean).join('. ') || 'Программа ничего не написала.';
}

async function runIndieGala() {
  const script = process.env.INDIEGALA_SCRIPT ? resolve(process.env.INDIEGALA_SCRIPT) : fileURLToPath(new URL('./indiegala-candidates.mjs', import.meta.url));
  const out = path('INDIEGALA_OUT', '../drafts/indiegala.json');
  await rm(out, { force: true }); // an old file must never be mistaken for a new answer
  // Its output still goes to the log, and we keep a copy so the report can say WHY it failed.
  let said = '';
  let complained = '';
  const code = await new Promise((done) => {
    const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'], cwd: fileURLToPath(new URL('..', import.meta.url)) });
    const timer = setTimeout(() => child.kill(), INDIEGALA_TIMEOUT);
    child.stdout.on('data', (b) => ((said = (said + b).slice(-4000)), process.stdout.write(b)));
    child.stderr.on('data', (b) => ((complained = (complained + b).slice(-4000)), process.stderr.write(b)));
    child.on('close', (c) => (clearTimeout(timer), done(c)));
    child.on('error', () => (clearTimeout(timer), done(-1)));
  });
  if (code !== 0) throw new Error(`программа IndieGala закончилась с ошибкой (код ${code}). ${whyFailed(said, complained)}`);
  const list = JSON.parse(await readFile(out, 'utf8'));
  if (!Array.isArray(list) || !list.length) throw new Error('программа IndieGala не нашла ни одной подходящей игры (лента могла не открыться): старые записи оставлены');
  return list;
}

// ---------- GOG ----------

export const isExcluded = (rules, d) => (rules.exclude ?? []).some((x) => d.url?.includes(x) || d.title?.toLowerCase() === String(x).toLowerCase());

// get = polite fetcher, steam = (title) => info | null, link = (url) => affiliate link
export async function updateGog({ deals, rules, now, get, steam, link }) {
  const g = rules.gog;
  const s = rules.steam;
  const nowIso = new Date(now).toISOString();
  const out = { refreshed: [], dropped: [], unknown: [], added: [], skipped: { notOnSteam: 0, fewReviews: 0, lowScore: 0, adult: 0, steamError: 0 }, problems: [], answered: 0, found: 0 };
  const existing = deals.filter((d) => d.store === 'GOG');
  const result = [];

  for (const d of existing) {
    const id = gogSlug(d.url);
    if (!id) {
      result.push(d);
      out.unknown.push(`${d.title}: в адресе нет названия игры GOG`);
      continue;
    }
    const r = await lookup(get, d.title, id);
    if (r.error) {
      result.push(d);
      out.problems.push(`${d.title}: ${r.error}`);
      continue;
    }
    out.answered++;
    if (!r.product) {
      result.push(d);
      out.unknown.push(`${d.title}: каталог такую игру не нашёл, запись оставлена`);
      continue;
    }
    const p = r.product;
    if (p.pct < g.keepMinDiscount) {
      out.dropped.push(`${d.title} (скидка ${p.pct}%)`);
      continue;
    }
    const end = await endDate(get, d.url, now);
    if (end.error) out.problems.push(`${d.title}: страница игры не открылась (${end.error})`);
    const next = { ...d, was: p.base, price: p.final, discountPct: p.pct, checkedAt: nowIso };
    if (end.iso) next.endsAt = end.iso;
    else if (!(d.endsAt && Date.parse(d.endsAt) > now)) delete next.endsAt;
    if (!end.error && !end.iso) out.problems.push(`${d.title}: на странице игры нет даты конца акции`);
    out.refreshed.push(p.final !== d.price ? `${d.title}: ${money(d.price)} → ${money(p.final)}` : `${d.title}: без изменений`);
    result.push(next);
  }

  // New games: best sellers on sale that pass the rules, then the Steam check.
  const room = Math.min(g.maxNew, Math.max(0, g.maxTotal - result.length));
  if (room > 0 && g.catalogPages > 0 && steam) {
    const { products, problems } = await topDiscounted(get, g.catalogPages);
    out.problems.push(...problems);
    out.found = products.length;
    const have = new Set(existing.map((d) => gogSlug(d.url)));
    const pool = products
      .filter((p) => !have.has(p.slug) && !isExcluded(rules, { url: p.url, title: p.title }))
      .filter((p) => p.pct >= g.minDiscount && p.base >= g.minBase && p.reviews >= g.minReviews && p.rating >= g.minRating)
      .sort((a, b) => b.base - b.final - (a.base - a.final));
    const perPublisher = {};
    let checked = 0;
    for (const p of pool) {
      if (out.added.length >= room || checked >= g.maxChecked) break;
      if ((perPublisher[p.publisher] ?? 0) >= g.maxPerPublisher) continue;
      checked++;
      let info = null;
      try {
        info = await steam(p.title);
      } catch {
        out.skipped.steamError++;
        continue;
      }
      const why = !info ? 'notOnSteam' : info.total < s.minReviews ? 'fewReviews' : info.pct < s.minPositive ? 'lowScore' : info.descriptors?.some((x) => s.adultFlags.includes(x)) ? 'adult' : '';
      if (why) {
        out.skipped[why]++;
        continue;
      }
      const end = await endDate(get, p.url, now);
      const deal = {
        store: 'GOG',
        title: p.title.replace(/[™®©]/g, '').trim(),
        currency: 'USD',
        was: p.base,
        price: p.final,
        discountPct: p.pct,
        url: p.url,
        image: '',
        status: 'gog-catalog',
        checkedAt: nowIso,
        ...(end.iso ? { endsAt: end.iso } : {}),
        ...(link ? { affiliateUrl: link(p.url) } : {}),
        steamId: info.appid,
      };
      perPublisher[p.publisher] = (perPublisher[p.publisher] ?? 0) + 1;
      out.added.push(`${deal.title}: ${money(p.final)} (−${p.pct}%)`);
      result.push(deal);
    }
  }
  const ok = out.answered > 0 || out.found > 0 || existing.length === 0;
  return { deals: [...result, ...deals.filter((d) => d.store !== 'GOG')], out, ok };
}

// ---------- Kinguin ----------

// The ready list from the public repo (or a local file for tests). Three tries, then an error: the old entries stay as they were.
async function loadKinguin(k) {
  if (process.env.KINGUIN_FILE) return readJson(resolve(process.env.KINGUIN_FILE));
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(k.source, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      if (i < 3) await new Promise((done) => setTimeout(done, 2000 * i));
    }
  }
  throw new Error(`файл ${k.source} не открылся: ${last.message}`);
}

// ---------- clean-up and history ----------

// Final checks on the whole list. Returns the list and what was removed.
export function tidy(deals, rules, now) {
  const removed = { excluded: [], invalid: [], stale: [] };
  const kept = [];
  for (const d of deals) {
    const why = problem(d);
    if (isExcluded(rules, d)) removed.excluded.push(d.title);
    else if (why) removed.invalid.push(`${d.title}: ${why}`);
    else if (now - Date.parse(d.checkedAt) > rules.dropOlderThanHours * HOUR) removed.stale.push(`${d.title} (${d.store}), цена проверена ${d.checkedAt.slice(0, 10)}`);
    else kept.push(d);
  }
  const rank = (d) => ['GOG', 'IndieGala'].indexOf(d.store) + 1 || 99;
  return { deals: kept.map((d, i) => [d, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]), removed };
}

// One price snapshot per deal per day (a second run on the same day only refreshes today's line). Same format as scripts/make-drafts.mjs.
export function snapshot(history, deals, today) {
  for (const d of deals) {
    const rows = (history[dealId(d)] ??= []);
    const row = { date: today, price: d.price, was: d.was };
    if (rows.at(-1)?.date === today) rows[rows.length - 1] = row;
    else rows.push(row);
  }
  return history;
}

// ---------- the report ----------

export function report({ now, dry, before, after, ig, gog, kg, removed, errors }) {
  const L = [];
  const list = (title, items) => items.length && L.push(`${title} (${items.length}):`, ...items.map((i) => `- ${i}`), '');
  L.push(`# Обновление цен, ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC${dry ? ' (пробный запуск, ничего не записано)' : ''}`, '');
  L.push(`Было записей: ${before}, стало: ${after}.`, '');
  if (errors.length) list('Ошибки', errors);
  if (ig) {
    L.push(`## IndieGala: обновлено ${ig.refreshed}, добавлено ${ig.added.length}, убрано ${ig.dropped.length}`, '');
    list('Добавлены', ig.added);
    list('Убраны (акция кончилась или игра больше не проходит правила)', ig.dropped);
  }
  if (gog) {
    const o = gog.out;
    L.push(`## GOG: обновлено ${o.refreshed.length}, добавлено ${o.added.length}, убрано ${o.dropped.length}`, '');
    list('Новые', o.added);
    list('Убраны (акция кончилась)', o.dropped);
    list('Цены', o.refreshed);
    list('Не удалось уточнить', [...o.unknown, ...o.problems]);
    const sk = o.skipped;
    L.push(`Новые игры не прошли проверку Steam: нет в Steam ${sk.notOnSteam}, мало отзывов ${sk.fewReviews}, низкая оценка ${sk.lowScore}, взрослый контент ${sk.adult}, Steam не ответил ${sk.steamError}. Найдено скидок в каталоге: ${o.found}.`, '');
  }
  if (kg) {
    const o = kg.out;
    L.push(`## Kinguin: обновлено ${o.refreshed.length}, добавлено ${o.added.length}, убрано ${o.dropped.length}`, '');
    list('Новые', o.added);
    list('Убраны', o.dropped);
    list('Цены', o.refreshed);
    list('Замечания', o.problems);
    const sk = o.skipped;
    L.push(`В файле ${o.inFile} игр (ему ${o.fileAgeHours} ч), прошли наши правила ${o.valid}. Не прошли: запись повреждена ${sk.invalid}, скидка к Steam вне границ ${sk.savings}, мало отзывов ${sk.fewReviews}, низкая оценка ${sk.lowScore}, нет региона ${sk.noRegion}, ссылка не прошла проверку ${sk.badLink}, в списке exclude ${sk.excluded}, игру уже продаёт обычный магазин ${sk.officialHasIt}, повтор ${sk.duplicate}.`, '');
  }
  list('Убрано как исключённое (data/deals-rules.json)', removed.excluded);
  list('Убрано как некорректное', removed.invalid);
  list('Убрано: цену слишком давно не проверяли', removed.stale);
  return L.join('\n');
}

// ---------- run ----------

async function main() {
  const now = process.env.UPDATE_NOW ? Date.parse(process.env.UPDATE_NOW) : Date.now();
  const dry = process.argv.includes('--dry-run');
  const dealsFile = path('DEALS_FILE', '../data/deals.json');
  const historyFile = path('HISTORY_FILE', '../data/history.json');
  const rules = await readJson(path('RULES_FILE', '../data/deals-rules.json'));
  const accounts = await readJson(path('ACCOUNTS_FILE', '../data/accounts.json'), {});
  const original = await readJson(dealsFile);
  const history = await readJson(historyFile, {});
  const today = new Date(now).toISOString().slice(0, 10);
  const nowIso = new Date(now).toISOString();

  let deals = structuredClone(original);
  const errors = [];
  let ig = null;
  let gog = null;
  let kg = null;
  let updatedStores = 0;

  if (rules.indiegala?.enabled) {
    try {
      const fresh = await runIndieGala();
      const merged = mergeIndieGala(deals, fresh);
      deals = merged.deals;
      ig = merged;
      updatedStores++;
    } catch (e) {
      errors.push(`IndieGala: ${e.message}`);
    }
  }

  if (rules.gog?.enabled) {
    try {
      const get = makeClient({ ua: UA, timeoutMs: Number(process.env.FEED_TIMEOUT_MS) || 20000, pauseMs: Number(process.env.FEED_PAUSE_MS ?? 1000) });
      let steam = null;
      if (process.env.STEAM_MOCK_FILE) {
        const mock = await readJson(resolve(process.env.STEAM_MOCK_FILE));
        steam = async (title) => (title in mock ? mock[title] : null);
      } else {
        const { steamInfo } = await import('./steam.mjs');
        steam = (title) => steamInfo(title);
      }
      const template = accounts.links?.gogDeeplink;
      const link = template ? (url) => `${template}?subid=site&ulp=${encodeURIComponent(url)}` : null;
      const r = await updateGog({ deals, rules, now, get, steam, link });
      if (r.ok) {
        deals = r.deals;
        gog = r;
        updatedStores++;
      } else {
        errors.push(`GOG: каталог не ответил (${r.out.problems.slice(0, 2).join('; ') || 'нет данных'}), записи оставлены как были`);
      }
    } catch (e) {
      errors.push(`GOG: ${e.message}`);
    }
  }

  // Kinguin goes last: it needs the final list of GOG and IndieGala to leave out games that an official store already sells.
  if (rules.kinguin?.enabled) {
    try {
      const file = await loadKinguin(rules.kinguin);
      const r = updateKinguin({ deals, rules, now, file, isExcluded });
      if (r.ok) {
        deals = r.deals;
        kg = r;
        updatedStores++;
      } else {
        errors.push(`Kinguin: ${r.out.problems.join('; ')}. Записи оставлены как были`);
      }
    } catch (e) {
      errors.push(`Kinguin: ${e.message}. Записи оставлены как были`);
    }
  }

  const { deals: finalDeals, removed } = tidy(deals, rules, now);
  const md = report({ now, dry, before: original.length, after: finalDeals.length, ig, gog, kg, removed, errors });
  console.log(md);

  const reportDir = path('REPORT_DIR', '../drafts/');
  await mkdir(reportDir, { recursive: true });
  await writeFile(resolve(reportDir, 'deals-update.md'), md + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');

  if (!updatedStores) {
    console.error('Ни один магазин не ответил, data/deals.json не тронут.');
    process.exitCode = 1;
    return;
  }
  if (!finalDeals.length) console.log('Внимание: после обновления не осталось ни одной скидки.');
  if (dry) return;
  await writeFile(dealsFile, JSON.stringify(finalDeals, null, 2) + '\n');
  await writeFile(historyFile, JSON.stringify(snapshot(history, finalDeals, today), null, 2) + '\n');
  console.log(`Записано: ${dealsFile}, ${historyFile} (${nowIso.slice(0, 16)} UTC).`);
}

// Running the file always updates. Only the tests set this variable, to import the functions without running it.
if (!process.env.UPDATE_DEALS_AS_MODULE) await main();
