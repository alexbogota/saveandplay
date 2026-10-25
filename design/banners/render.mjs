// Draws the profile banners from banners.json with banner.html (see "about" in banners.json).
// Usage: node design/banners/render.mjs [key]      (needs: npm install --no-save playwright; CHROMIUM_PATH can point to a browser)
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(await readFile(path.join(dir, 'banners.json'), 'utf8'));
const only = process.argv[2];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const [key, banner] of Object.entries(cfg.banners)) {
  if (only && only !== key) continue;
  const page = await browser.newPage({ viewport: { width: 1500, height: 500 }, deviceScaleFactor: 1 });
  await page.addInitScript((b) => { window.__banner = b; }, banner);
  await page.goto(pathToFileURL(path.join(dir, 'banner.html')).href);
  await page.waitForSelector('html[data-ready="1"]');
  const out = path.join(dir, `banner-${key}.png`);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1500, height: 500 } });
  console.log('written', out);
  await page.close();
}
await browser.close();
