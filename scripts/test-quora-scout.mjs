// Tests of the Quora niche scout (no network). Run: npm run quora:scout:test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUrl, cleanTitle, onTopic, buildQueries, keyWords, matchArticle, articlesFromSitemap, scoutNiche, verdict, byStrength, renderReport } from './lib/quora-scout.mjs';

const art = (title, url = `https://x.test/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/`) => ({ title, url, words: keyWords(title) });

test('classifyUrl tells questions from Spaces, other languages and service pages', () => {
  assert.deepEqual(classifyUrl('https://www.quora.com/How-do-you-play-old-games-on-your-new-PC'), { kind: 'question', key: 'how-do-you-play-old-games-on-your-new-pc' });
  assert.equal(classifyUrl('https://www.quora.com/How-much-would-it-cost-to-host-a-Rust-server?top_ans=1').key, 'how-much-would-it-cost-to-host-a-rust-server');
  assert.equal(classifyUrl('https://www.quora.com/unanswered/Is-GOG-safe').key, 'is-gog-safe');
  assert.equal(classifyUrl('https://www.quora.com/Is-GOG-safe/answer/Some-Person').key, 'is-gog-safe');
  assert.equal(classifyUrl('https://freesvgfiles.quora.com/Half-Sun-Svg-Free-Download').kind, 'space');
  assert.equal(classifyUrl('https://es.quora.com/Como-se-juega').kind, 'foreign');
  assert.equal(classifyUrl('https://www.quora.com/profile/Save-And-Play').kind, 'other');
  assert.equal(classifyUrl('https://www.quora.com/topic/PC-Gaming').kind, 'other');
  assert.equal(classifyUrl('https://example.com/How-do-I').kind, 'other');
  assert.equal(classifyUrl('not a url').kind, 'other');
});

test('cleanTitle drops the Quora suffix', () => {
  assert.equal(cleanTitle('How to sell a planner - Quora'), 'How to sell a planner');
  assert.equal(cleanTitle('Is it worth it?'), 'Is it worth it?');
});

test('onTopic needs one topic word and no blocked word', () => {
  const niche = { words: ['font', 'cricut'], blockWords: ['creative cloud'] };
  assert.equal(onTopic('Where can I download free fonts for commercial use?', niche), true);
  assert.equal(onTopic('Is an Adobe subscription worth it?', niche), false);
  assert.equal(onTopic('Fonts in Creative Cloud?', niche), false);
  assert.equal(onTopic('Cricut with a cracked app?', niche, ['crack']), false);
  assert.equal(onTopic('Anything goes', {}), true);
});

test('buildQueries: own queries first, then seeds with stems, no repeats, capped', () => {
  const q = buildQueries({ queries: ['is X worth it'], seeds: ['digital planner'] }, { stems: ['how to', 'best'], maxQueries: 3 });
  assert.deepEqual(q, ['is X worth it', 'digital planner', 'how to digital planner']);
  assert.deepEqual(buildQueries({ queries: ['A', 'a ', 'B'] }), ['A', 'B']);
});

test('matchArticle: two shared words, or one topic word that only this article has', () => {
  const articles = [art('How to run old PC games on Windows 11'), art('How Steam refunds work'), art('Is a game bundle worth it'), art('Steam key or DRM-free'), art('Steam wishlist and sale calendar')];
  const topic = { topicWords: keyWords('old windows') };
  assert.equal(matchArticle('Will old disc games work on Windows 11?', articles, 2, topic).article.title, 'How to run old PC games on Windows 11');
  assert.equal(matchArticle('How to play old games on your new PC', articles, 2, topic).article.title, 'How to run old PC games on Windows 11');
  assert.equal(matchArticle('How to play old games on your new PC', articles, 2), null, 'one shared word is not enough without a topic word');
  assert.equal(matchArticle('Is Xbox Game Pass worth it?', articles, 2, topic), null);
  assert.equal(matchArticle('What happens to my Steam library?', articles, 2, topic), null, '"steam" is common to many titles');
});

test('articlesFromSitemap takes article addresses and makes titles from them', () => {
  const xml = '<urlset><url><loc>https://x.test/</loc></url><url><loc>https://x.test/blog/best-fonts-for-cricut/</loc></url><url><loc>https://x.test/shop/item-one/</loc></url></urlset>';
  const a = articlesFromSitemap(xml, { include: '/blog/' });
  assert.equal(a.length, 1);
  assert.equal(a[0].title, 'best fonts for cricut');
  assert.ok(a[0].words.has('font') && a[0].words.has('cricut'));
});

test('scoutNiche counts different on-topic questions and the rest', () => {
  const niche = { words: ['planner'] };
  const raw = [
    { query: 'q1', results: [
      { title: 'How to sell a planner - Quora', url: 'https://www.quora.com/How-do-I-sell-a-planner' },
      { title: 'How to sell a planner - Quora', url: 'https://www.quora.com/How-do-I-sell-a-planner?top_ans=5' },
      { title: 'Free planner - Some Space - Quora', url: 'https://somespace.quora.com/Free-planner' },
      { title: 'Is Adobe worth it? - Quora', url: 'https://www.quora.com/Is-Adobe-worth-it' },
    ] },
    { query: 'q2', results: [
      { title: 'How to sell a planner - Quora', url: 'https://www.quora.com/How-do-I-sell-a-planner' },
      { title: 'Best digital planner apps? - Quora', url: 'https://www.quora.com/Best-digital-planner-apps' },
    ] },
  ];
  const s = scoutNiche(niche, raw, { articles: [art('How to make a digital planner')] });
  assert.equal(s.results, 6);
  assert.equal(s.unique, 2);
  assert.equal(s.spaces, 1);
  assert.equal(s.offTopic, 1);
  assert.equal(s.questions[0].title, 'How to sell a planner');
  assert.deepEqual(s.questions[0].queries, ['q1', 'q2']);
  assert.equal(s.withArticle, 1);
  assert.equal(s.questions.find((q) => q.article).title, 'Best digital planner apps?');
  assert.equal(Math.round(s.share * 100), 33);
});

test('verdict: strong needs enough searches, order puts the surest first', () => {
  const limits = { strongShare: 0.55, mediumShare: 0.3, minQueries: 3 };
  assert.equal(verdict({ results: 80, queries: 8, share: 0.8 }, limits), 'strong');
  assert.equal(verdict({ results: 10, queries: 1, share: 1 }, limits), 'early');
  assert.equal(verdict({ results: 40, queries: 4, share: 0.4 }, limits), 'medium');
  assert.equal(verdict({ results: 40, queries: 4, share: 0.1 }, limits), 'weak');
  assert.equal(verdict({ results: 0, queries: 4, share: 0 }, limits), 'no-data');
  const list = [{ verdict: 'early', stats: { unique: 10 } }, { verdict: 'strong', stats: { unique: 5 } }, { verdict: 'early', stats: { unique: 30 } }].sort(byStrength);
  assert.deepEqual(list.map((n) => n.stats.unique), [5, 30, 10]);
});

test('renderReport writes the table and the questions', () => {
  const niche = { name: 'Планеры', words: ['planner'] };
  const stats = scoutNiche(niche, [{ query: 'q1', results: [{ title: 'How to sell a planner - Quora', url: 'https://www.quora.com/How-do-I-sell-a-planner' }] }]);
  const md = renderReport([{ id: 'planners', niche, stats, verdict: 'early', hasArticles: false }], { date: '2026-11-15', source: 'test' });
  assert.ok(md.includes('| Планеры | 1 | 1 | не задано | 100% |'));
  assert.ok(md.includes('статьи не подключены'));
  assert.ok(md.includes('[How to sell a planner](https://www.quora.com/How-do-I-sell-a-planner)'));
});

test('a niche in another language counts the pages of that Quora and skips the English ones', () => {
  assert.equal(classifyUrl('https://es.quora.com/C%C3%B3mo-vender-en-Etsy', 'es').kind, 'question');
  assert.equal(classifyUrl('https://es.quora.com/C%C3%B3mo-vender-en-Etsy', 'es').key, 'cómo-vender-en-etsy');
  assert.equal(classifyUrl('https://www.quora.com/How-do-I-sell-on-Etsy', 'es').kind, 'foreign');
  assert.equal(classifyUrl('https://de.quora.com/Wie-verkauft-man-auf-Etsy', 'es').kind, 'foreign');
  assert.equal(classifyUrl('https://es.quora.com/C%C3%B3mo-vender-en-Etsy').kind, 'foreign');
  assert.ok(keyWords('¿Qué tipografía debo elegir?').has('tipografía'));
  const s = scoutNiche({ lang: 'es', words: ['etsy'] }, [{ query: 'q', results: [{ title: '¿Cómo vender en Etsy? - Quora', url: 'https://es.quora.com/C%C3%B3mo-vender-en-Etsy' }, { title: 'How to sell on Etsy - Quora', url: 'https://www.quora.com/How-do-I-sell-on-Etsy' }] }]);
  assert.equal(s.unique, 1);
  assert.equal(s.foreign, 1);
  assert.deepEqual(buildQueries({ seeds: ['vender en Etsy'], stems: ['cómo'] }, { stems: ['how to'] }), ['vender en Etsy', 'cómo vender en Etsy']);
});

test('focusWords count the questions that hit the exact angle and put them first', () => {
  const niche = { words: ['font'], focusWords: ['commercial', 'license'] };
  const s = scoutNiche(niche, [{ query: 'q', results: [
    { title: 'What is the best font for a book? - Quora', url: 'https://www.quora.com/What-is-the-best-font-for-a-book' },
    { title: 'Where can I download free fonts for commercial use? - Quora', url: 'https://www.quora.com/Where-can-I-download-free-fonts-for-commercial-use' },
  ] }]);
  assert.equal(s.unique, 2);
  assert.equal(s.focused, 1);
  assert.equal(s.questions[0].title, 'Where can I download free fonts for commercial use?');
  assert.equal(scoutNiche({ words: ['font'] }, []).focused, null);
  const two = scoutNiche({ words: ['font'] }, [{ query: 'q', results: [{ title: 'How to find fonts for commercial use - Quora', url: 'https://www.quora.com/How-do-I-find-fonts-for-commercial-use' }, { title: 'What font is this? - Quora', url: 'https://www.quora.com/What-font-is-this' }] }], { angles: { make: ['how to'], sell: ['commercial'] } });
  assert.deepEqual(two.angles, { make: 1, sell: 1 });
  assert.equal(two.focused, 1);
  assert.deepEqual(two.questions[0].angles, ['make', 'sell']);
});
