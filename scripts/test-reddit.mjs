// npm run reddit:test: checks the feed reader and the filter on a made-up feed. No internet needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, evaluate, choose, render } from './reddit-find.mjs';

const now = Date.parse('2026-10-21T20:00:00Z');
const entry = (id, title, body, updated, author = 'someone') => `<entry><author><name>/u/${author}</name></author><category term="gamingsuggestions" label="r/gamingsuggestions"/><content type="html">&lt;div class=&quot;md&quot;&gt;&lt;p&gt;${body}&lt;/p&gt;&lt;/div&gt; submitted by &lt;a href=&quot;x&quot;&gt; /u/${author} &lt;/a&gt; &lt;span&gt;&lt;a href=&quot;y&quot;&gt;[link]&lt;/a&gt;&lt;/span&gt;</content><id>t3_${id}</id><link href="https://www.reddit.com/r/gamingsuggestions/comments/${id}/slug/"/><updated>${updated}</updated><title>${title}</title></entry>`;
const feed = `<?xml version="1.0"?><feed>${[
  entry('aaa111', 'Looking for a cozy game, is Stardew worth it?', 'I have $10 and a long backlog. Any game like it &amp;amp; cheap?', '2026-10-21T18:30:00+00:00'),
  entry('bbb222', 'Game of the year thread', 'Just chatting', '2026-10-21T19:00:00+00:00'),
  entry('ccc333', 'Where to find a crack for this? worth it?', 'torrent please', '2026-10-21T19:00:00+00:00'),
  entry('ddd444', 'Should I buy this on sale?', 'It is 60% off', '2026-10-19T10:00:00+00:00'),
  entry('eee555', 'Should I buy this on sale?', 'It is 60% off', '2026-10-21T17:00:00+00:00', 'saveandplay_me'),
].join('')}</feed>`;
const settings = { username: 'saveandplay_me', maxAgeHours: 24, perRun: 10, perSubreddit: 3, minScore: 3,
  cues: ['worth it', 'cheap', 'sale', 'backlog', 'any game', 'looking for'], blockWords: ['crack', 'torrent'] };

test('reads the feed: ids, titles, clean text', () => {
  const posts = parseFeed(feed);
  assert.equal(posts.length, 5);
  assert.equal(posts[0].id, 'aaa111');
  assert.equal(posts[0].subreddit, 'gamingsuggestions');
  assert.match(posts[0].text, /^I have \$10 and a long backlog\. Any game like it & cheap\?$/);
  assert.ok(!posts[0].text.includes('submitted by'));
});

test('keeps a real question, drops the rest with a reason', () => {
  const [a, b, c, d, e] = parseFeed(feed);
  assert.equal(evaluate(a, settings, now).keep, true);
  assert.equal(evaluate(b, settings, now).keep, false);
  assert.match(evaluate(c, settings, now).reason, /blocked/);
  assert.equal(evaluate(d, settings, now).reason, 'too old');
  assert.equal(evaluate(e, settings, now).reason, 'our own post');
});

test('limits per subreddit and writes the list', () => {
  const posts = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, title: `t${i}?`, link: `https://x/${i}`, subreddit: 'a', text: '', score: 5 - i, matched: [], ageH: 1 }));
  assert.equal(choose(posts, settings).length, 3);
  const md = render('main', posts.slice(0, 1), { total: 5, dropped: { 'too old': 2 }, failed: [] }, now);
  assert.match(md, /r\/a: t0\?/);
  assert.match(md, /too old 2/);
});
