// Tests for scripts/article-tools.mjs (the checks and the "is it time" decision of the daily article writer).
// Run: npm run articles:test   (no network, no AI; uses the real guide steam-key-vs-drm-free as a good example).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitArticle, countWords, linksOf, linkProblem, parsePosts, postLength, checkDraft, gateDecision, waitingDrafts, daysBetween, longDate, buildPrompt, loadSettings, pngSize } from './article-tools.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TODAY = '2026-10-12';
const SLUG = 'test-fixture-guide';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#0D1117"/><text x="80" y="200" font-size="64" fill="#FFFFFF">Steam or GOG</text></svg>`;
const POST_BSKY = `Steam says its games are "licensed, not sold". GOG says you can back up the files.

Which one do you really get? Our short guide:
https://saveandplay.com/guides/${SLUG}/?utm_source=bluesky-prices&utm_medium=social&utm_campaign=guide-test-fixture

#PCGaming #GameDeals`;
const POST_MASTO = `Steam says its games are "licensed, not sold". GOG says you can back up the files and install them on as many devices as you wish.

Which one do you really get? Our short guide, no affiliate links:
https://saveandplay.com/guides/${SLUG}/?utm_source=mastodon-prices&utm_medium=social&utm_campaign=guide-test-fixture

Do you keep installers of your games?

#PCGaming #GameDeals #Steam #GOG`;
const NOTES = `## Тема
Проверочный черновик для теста.

## Откуда цифры и факты
- Все цитаты: страницы Steam и GOG из списка Sources в статье. Других цифр нет, это тестовая копия готового гида.

## Что проверить владельцу
Ничего, это тест.

## Когда устареет
Не устареет.
`;

// Builds a draft folder from the real guide. mutate(files) may change any file (strings; image.png is a Buffer).
async function makeDraft(mutate = () => {}) {
  const dir = await mkdtemp(join(tmpdir(), 'draft-'));
  let article = await readFile(join(ROOT, 'src/pages/guides/steam-key-vs-drm-free.md'), 'utf8');
  article = article
    .replace(/^updated:.*$/m, `updated: ${TODAY}`)
    .replace(/^image: .*$/m, `image: /og/${SLUG}.png`)
    .replace(/Pages were read on October 7, 2026/, `Pages were read on ${longDate(TODAY)}`);
  const files = {
    'article.md': article,
    'image.svg': SVG,
    'image.png': await readFile(join(ROOT, 'public/og/steam-key-vs-drm-free.png')),
    'posts.md': `# Posts\n\n## Bluesky\n\`\`\`text\n${POST_BSKY}\n\`\`\`\n\n## Mastodon\n\`\`\`text\n${POST_MASTO}\n\`\`\`\n`,
    'notes.md': NOTES,
  };
  mutate(files);
  for (const [name, content] of Object.entries(files)) if (content !== null) await writeFile(join(dir, name), content);
  return dir;
}
const check = async (mutate) => {
  const dir = await makeDraft(mutate);
  try {
    return await checkDraft(dir, { root: ROOT, today: TODAY });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
const has = (res, re) => assert.ok(res.problems.some((p) => re.test(p)), `expected a problem like ${re}, got:\n${res.problems.join('\n')}`);

test('a good draft built from a real guide passes', async () => {
  const res = await check();
  assert.deepEqual(res.problems, []);
  assert.equal(res.info.slug, SLUG);
  assert.ok(res.info.words > 600);
});

test('the three real guides parse and have what the checks expect', async () => {
  for (const f of ['steam-key-vs-drm-free', 'real-vs-fake-game-discounts']) {
    const text = await readFile(join(ROOT, 'src/pages/guides', `${f}.md`), 'utf8');
    const { fm, body } = splitArticle(text);
    assert.equal(fm.layout, '../../layouts/Article.astro');
    assert.match(fm.image, /^\/og\/[a-z0-9-]+\.png$/);
    assert.ok(fm.imageAlt.length >= 30);
    assert.match(body, /^## Sources\s*$/m);
    assert.match(body, /^## How we handle this\s*$/m);
    assert.ok(countWords(body) > 600, `${f} words`);
    for (const l of linksOf(text)) assert.equal(linkProblem(l), null, `${f}: ${l}`);
  }
});

test('header problems are found', async () => {
  has(await check((f) => (f['article.md'] = f['article.md'].replace(/^layout:.*$/m, 'layout: x'))), /layout/);
  has(await check((f) => (f['article.md'] = f['article.md'].replace(/^updated:.*$/m, 'updated: 2026-10-01'))), /updated must be today/);
  has(await check((f) => (f['article.md'] = f['article.md'].replace(/^imageAlt:.*$/m, 'imageAlt: "x"'))), /imageAlt/);
  has(await check((f) => (f['article.md'] = f['article.md'].replace(/^image: .*$/m, 'image: /og/steam-key-vs-drm-free.png'))), /already exists/);
  has(await check((f) => (f['article.md'] = f['article.md'].replace('section: guides', 'section: guides\nauthor: me'))), /unknown key/);
});

test('body problems are found', async () => {
  has(await check((f) => (f['article.md'] = f['article.md'].replace(/^## Sources\s*$/m, '## Links'))), /Sources/);
  has(await check((f) => (f['article.md'] = f['article.md'].replace(/^## How we handle this\s*$/m, '## About'))), /How we handle this/);
  has(await check((f) => (f['article.md'] = f['article.md'].replace('/disclosure/', '/about/'))), /disclosure/);
  has(await check((f) => (f['article.md'] = f['article.md'].replace(/Pages were read on [^.]*\./, 'Pages were read.'))), /read on/);
  has(await check((f) => (f['article.md'] = f['article.md'].replace(/Pages were read on [^,]*, 2026/, 'Pages were read on October 7, 2026'))), /"read on" date must be today/);
  has(await check((f) => (f['article.md'] += '\nThe lowest ever price.\n')), /never claim/);
  has(await check((f) => (f['article.md'] += '\nПривет\n')), /English only/);
  has(await check((f) => (f['article.md'] += '\nTODO: add numbers\n')), /unfinished/);
  has(await check((f) => (f['article.md'] = f['article.md'].replace(/^## What Steam says you get[\s\S]*?(?=^## How we handle)/m, ''))), /words, it must have/);
});

test('affiliate and tracking links are refused', async () => {
  has(await check((f) => (f['article.md'] += '\n[Buy](https://qwpeg.com/g/abc/)\n')), /affiliate/);
  has(await check((f) => (f['article.md'] += '\n[GOG](https://www.gog.com/game/x?pp=123)\n')), /tracking parameter "pp"/);
  has(await check((f) => (f['article.md'] += '\n[x](https://example.com/?utm_source=a)\n')), /tracking parameter/);
  has(await check((f) => (f['article.md'] += '\n[x](/go/gog/123/)\n')), /\/go\//);
  has(await check((f) => (f['article.md'] += '\n[x](https://saveandplay.com/go/gog/1/)\n')), /\/go\//);
  has(await check((f) => (f['article.md'] += '\n[x](/guides/no-such-article/)\n')), /does not exist/);
  has(await check((f) => (f['article.md'] += '\n[x](/nope/)\n')), /unknown page/);
  has(await check((f) => (f['article.md'] += '\n[x](http://example.com/a)\n')), /not https/);
});

test('unsafe markup and pictures without alt are refused', async () => {
  has(await check((f) => (f['article.md'] += '\n<script>alert(1)</script>\n')), /script/);
  has(await check((f) => (f['article.md'] += '\n<img src="/a.png">\n')), /alt/);
  has(await check((f) => (f['article.md'] += '\n<svg viewBox="0 0 10 10"><rect/></svg>\n')), /role="img"/);
});

test('picture problems are found', async () => {
  has(await check((f) => (f['image.svg'] = SVG.replace('0 0 1200 630', '0 0 800 400'))), /viewBox/);
  has(await check((f) => (f['image.svg'] = SVG.replace('fill="#FFFFFF"', 'style="fill:var(--heading)"'))), /CSS variables/);
  has(await check((f) => (f['image.svg'] = SVG.replace('Steam or GOG', 'Привет'))), /English only/);
  has(await check((f) => (f['image.svg'] = null, (f['image.png'] = null))), /image\.svg is missing/);
});

test('post problems are found', async () => {
  const swap = (a, b) => (f) => (f['posts.md'] = f['posts.md'].replace(a, b));
  has(await check(swap('#PCGaming #GameDeals\n```\n\n## Mastodon', '#PCGaming #GameDeals\nAd\n```\n\n## Mastodon')), /Ad/);
  has(await check(swap('#PCGaming #GameDeals\n```\n\n## Mastodon', '#PCGaming\n```\n\n## Mastodon')), /hashtags/);
  has(await check(swap('utm_source=bluesky-prices', 'utm_source=other')), /utm_source/);
  has(await check(swap(`/guides/${SLUG}/?utm_source=mastodon`, '/guides/other/?utm_source=mastodon')), /must go to/);
  has(await check(swap('Which one do you really get?', 'x'.repeat(400))), /characters, the limit is 300/);
  has(await check(swap('Which one do you really get?', 'Лучшая цена')), /English only/);
  has(await check(swap('## Mastodon', '## Other')), /no post found/);
  has(await check((f) => (f['posts.md'] = null)), /posts\.md is missing/);
});

test('notes for the owner are required', async () => {
  has(await check((f) => (f['notes.md'] = '## Тема\nкоротко')), /notes\.md/);
  has(await check((f) => (f['notes.md'] = null)), /notes\.md is missing/);
});

test('posts are counted the way the networks count (link = fixed length)', () => {
  assert.equal(postLength('a https://saveandplay.com/guides/very-long-name/?utm_source=x b', 25), 2 + 25 + 2);
  const posts = parsePosts('## Bluesky (limit 300)\n```text\nHello\n```\n## Mastodon\n```text\nWorld\n```');
  assert.deepEqual(posts, { bluesky: 'Hello', mastodon: 'World' });
});

test('png size is read without any package', async () => {
  assert.deepEqual(pngSize(await readFile(join(ROOT, 'public/og/steam-key-vs-drm-free.png'))), { width: 1200, height: 630 });
  assert.equal(pngSize(Buffer.from('nope')), null);
});

test('the decision "write today?"', () => {
  const settings = { enabled: true, everyDays: 2, maxPending: 2, expireDays: 7 };
  const pub = new Set(['a']);
  const d = (date, slug, title = slug) => ({ date, slug, title });
  const go = (state, today = '2026-10-12', over = {}, force = false) => gateDecision({ settings: { ...settings, ...over }, state, today, published: pub, force });
  assert.equal(go({ drafts: [] }).run, true, 'first run');
  assert.equal(go({ lastDate: '2026-10-11', drafts: [d('2026-10-11', 'a')] }).run, false, 'too soon');
  assert.equal(go({ lastDate: '2026-10-10', drafts: [d('2026-10-10', 'a')] }).run, true, 'two days later');
  assert.equal(go({ lastDate: '2026-10-11', drafts: [d('2026-10-11', 'a')] }, '2026-10-12', { everyDays: 1 }).run, true, 'daily');
  assert.equal(go({ lastDate: '2026-10-08', drafts: [d('2026-10-06', 'b'), d('2026-10-08', 'c')] }).run, false, 'two drafts wait');
  assert.equal(go({ lastDate: '2026-10-08', drafts: [d('2026-10-06', 'b'), d('2026-10-08', 'a')] }).run, true, 'one is published, one waits');
  assert.equal(go({ lastDate: '2026-10-01', drafts: [d('2026-10-01', 'b'), d('2026-10-02', 'c')] }).run, true, 'old drafts expire');
  assert.equal(go({ lastDate: '2026-10-11', drafts: [d('2026-10-11', 'b'), d('2026-10-10', 'c')] }, '2026-10-12', {}, true).run, true, 'force');
  assert.equal(go({ lastDate: '2026-10-12', drafts: [d('2026-10-12', 'b')] }, '2026-10-12', {}, true).run, false, 'never twice a day');
  assert.equal(go({ drafts: [] }, '2026-10-12', { enabled: false }).run, false, 'switched off');
  assert.equal(waitingDrafts([d('2026-10-01', 'b')], pub, '2026-10-12', 7).length, 0);
  assert.equal(daysBetween('2026-09-30', '2026-10-02'), 2);
  assert.equal(longDate('2026-10-12'), 'October 12, 2026');
});

test('settings have sane defaults and the prompt carries the facts', async () => {
  const s = await loadSettings(ROOT);
  assert.ok(s.everyDays >= 1 && s.maxPending >= 1 && s.image.width === 1200 && s.image.height === 630);
  assert.ok(s.posts.bluesky && s.posts.mastodon);
  const text = buildPrompt({
    rules: 'RULES',
    today: TODAY,
    settings: s,
    articles: [{ section: 'guides', slug: 'x', title: 'Existing' }],
    drafts: [{ date: '2026-10-10', slug: 'y', title: 'Old draft' }],
    published: new Set(['x']),
    brief: 'BRIEF TEXT',
  });
  for (const part of ['October 12, 2026', 'drafts/articles/2026-10-12/', '/guides/x/: Existing', 'Old draft (not published)', 'BRIEF TEXT', 'RULES']) assert.ok(text.includes(part), part);
  assert.ok(buildPrompt({ rules: 'R', today: TODAY, settings: s, articles: [], drafts: [], published: new Set(), brief: null }).includes('evergreen'));
});
