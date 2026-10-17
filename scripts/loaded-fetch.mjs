// Reads the deals page of Loaded (https://www.loaded.com/cdkeys-deals) ONCE and writes the small file data/loaded.json:
// name, price and address of each PC Steam key on the page. Nothing else is taken (no pictures, no texts, no old prices, no percents).
// scripts/update-deals.mjs then checks every game against Steam with our own rules (scripts/lib/loaded.mjs).
//
//   node scripts/loaded-fetch.mjs                 reads the live page
//   node scripts/loaded-fetch.mjs --html page.html   reads a saved page (for tests; nothing is downloaded)
//
// Politeness and limits (docs/tasks-loaded-claudecode.md):
//  - one request a day, an honest User-Agent with the name of the site, no cookies, no tricks;
//  - only the clean address /cdkeys-deals (it is not closed in their robots.txt); the closed addresses (/catalogsearch/, ?q=, ?region=, ?platforms=) are never used;
//  - if the site answers with a guard page (Cloudflare "Just a moment", 403, 429, 503) we STOP: nothing is written and we do not try to get around it;
//  - if the page has too few cards, its markup has changed: nothing is written either.
// A missing or old file changes nothing on the site (update-deals ignores a file older than maxFileAgeHours).
//
// For tests: LOADED_OUT (where to write), LOADED_NOW.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePage, candidates, looksBlocked, PAGE } from './lib/loaded.mjs';

const UA = 'SaveAndPlay-prices/1.0 (+https://saveandplay.com)';
const MIN_CARDS = 10; // the page has about 64; fewer means the markup changed or the page is not the deals page

const out = process.env.LOADED_OUT ? resolve(process.env.LOADED_OUT) : fileURLToPath(new URL('../data/loaded.json', import.meta.url));
const args = process.argv.slice(2);
const htmlFile = args.includes('--html') ? args[args.indexOf('--html') + 1] : null;

const say = (md) => {
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
};
const stop = (why) => {
  say(`## Loaded: страница скидок не прочитана\n\n${why}\n\nДанные Loaded не обновлены, на сайте всё остаётся как было (старые записи уйдут сами через 48 часов).`);
  process.exitCode = 1;
};

let status = 200;
let html;
try {
  if (htmlFile) html = await readFile(htmlFile, 'utf8');
  else {
    const res = await fetch(PAGE, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.8' }, signal: AbortSignal.timeout(30000) });
    status = res.status;
    html = await res.text();
  }
} catch (e) {
  stop(`Страница не открылась: ${e.message}.`);
}

if (html !== undefined) {
  if (looksBlocked(status, html)) {
    stop(`Сайт ответил защитной страницей (код ${status}, похоже на проверку Cloudflare). Обходить защиту мы не будем. Это может пройти само; если так день за днём, этап 2 остаётся выключенным, а нужно просить у Loaded разрешение или фид (см. docs/tasks-loaded-claudecode.md).`);
  } else if (status !== 200) {
    stop(`Сайт ответил кодом ${status}.`);
  } else {
    const page = parsePage(html);
    if (page.seen < MIN_CARDS || page.items.length < MIN_CARDS) {
      stop(`На странице карточек: ${page.seen}, из них разобрано ${page.items.length} (нужно хотя бы ${MIN_CARDS}). Скорее всего изменилась разметка. Не разобрано: нет ссылки ${page.bad.noLink}, нет названия ${page.bad.noName}, нет цены ${page.bad.noPrice}, неясная цена ${page.bad.twoPrices}.`);
    } else {
      const { items, skipped } = candidates(page.items);
      const now = process.env.LOADED_NOW ? new Date(process.env.LOADED_NOW) : new Date();
      const file = { generatedAt: now.toISOString(), source: PAGE, currency: 'USD', cardsOnPage: page.seen, items };
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify(file, null, 2) + '\n');
      say(`## Loaded: страница скидок прочитана\n\nКарточек на странице ${page.seen}, разобрано ${page.items.length}, в файл попало ${items.length} ключей Steam для PC. Пропущено: не ключ Steam для PC ${skipped.notSteamKey}, не игра (приставки, валюта, карты) ${skipped.notAGame}; не разобрано: нет ссылки ${page.bad.noLink}, нет названия ${page.bad.noName}, нет цены ${page.bad.noPrice}, неясная цена ${page.bad.twoPrices}.`);
    }
  }
}
