// Finds Tumblr blogs worth following, for the THEME of a blog (data/tumblr-themes.json). READ ONLY: it never follows, likes or posts anything.
// A human opens the list and presses "Follow". See TUMBLR.md ("Поиск блогов").
//
//   node scripts/tumblr-find.mjs                      the theme of the first Tumblr account (default theme: games)
//   node scripts/tumblr-find.mjs --account tumblr     another account of data/tumblr-accounts.json
//   node scripts/tumblr-find.mjs --theme travel       another theme of data/tumblr-themes.json
//   node scripts/tumblr-find.mjs --top 10             a shorter list
//   node scripts/tumblr-find.mjs --again              show blogs that an earlier list already showed
//   node scripts/tumblr-find.mjs --no-save            do not remember what was shown (a trial run)
//   node scripts/tumblr-find.mjs --quick              skip the second look (see below): faster, but the list is rougher
//
// For every tag of the theme it reads the newest public posts (Tumblr API /v2/tagged), groups them by blog, drops what is not worth following (dead, only
// reblogs, too big, adult, off-topic art), and ranks the rest.
// SECOND LOOK: the tags show only the posts that carry them, not what the blog is. So the best of the ranking (the first "verifyTop", default 40, until "top" blogs
// are good) are looked at one by one: the last 20 posts of the blog are read (/v2/blog/<name>/posts) and the blog is dropped when its title or description has
// a word like "21+" or "nsfw", when ANY of those posts has an adult tag, when it has no post lately, or when too few of the posts are about the theme (minOnTopic).
// The list goes to the screen and to drafts/tumblr-candidates-<theme>.md. What was shown or dropped for its content is remembered in
// drafts/tumblr-find-seen.json, so the next run shows NEW blogs (a blog is looked at again only after 90 days, or with --again).
// Login: the same four secrets as the posting (.env locally). The reading uses about 30 requests for the tags and up to verifyTop for the second look (the limit of Tumblr is 1000 an hour).
//
// Exit code: 0 = a list was made (even an empty one), 1 = bad settings, missing secrets, a refused login, or no tag could be read.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { file, readJson, tumblrAccounts, configProblems, loadCreds, createClient, themeProblems, withThemeDefaults, rankBlogs, profileCheck, THEME_FILE, summary, finish, reasonOf, hintFor, clip, dayKey } from './lib/tumblr.mjs';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const NOW = process.env.TUMBLR_NOW ? Date.parse(process.env.TUMBLR_NOW) : Date.now(); // the variable is for tests only
const SEEN = 'drafts/tumblr-find-seen.json';
const SEEN_DAYS = 90;
const DELAY_MS = process.env.TUMBLR_FIND_DELAY_MS !== undefined ? Number(process.env.TUMBLR_FIND_DELAY_MS) : 300; // a pause between requests, so the app stays far below the limit
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const describe = (e) => `${reasonOf(e)}${hintFor(e?.code) ? ` ${hintFor(e.code)}` : ''}`;
const fail = (msg) => {
  console.log(`ERROR: ${msg}`);
  summary(`### Tumblr blog finder\n\nERROR: ${msg}\n`);
  finish(1);
};

const ago = (t) => {
  const h = (NOW - t) / 3600e3;
  return h < 1 ? 'less than an hour ago' : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
};
const plain = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

function loadSeen() {
  const s = readJson(SEEN, { themes: {} });
  s.themes ??= {};
  return s;
}

async function main() {
  let entry;
  try {
    [entry] = tumblrAccounts(opt('--account'));
  } catch (e) {
    return fail(reasonOf(e));
  }
  if (!entry) return fail('There is no Tumblr account in data/tumblr-accounts.json.');
  const { id, account } = entry;
  const problems = configProblems(account);
  if (problems.length) return fail(`Settings of "${id}": ${problems.join('; ')}.`);

  const themeName = opt('--theme') || account.theme || 'games';
  let themes;
  try {
    themes = readJson(THEME_FILE).themes ?? {};
  } catch (e) {
    return fail(reasonOf(e));
  }
  if (!themes[themeName]) return fail(`There is no theme "${themeName}" in ${THEME_FILE} (themes there: ${Object.keys(themes).join(', ') || 'none'}).`);
  const theme = withThemeDefaults(themes[themeName]);
  const top = opt('--top') ? Number(opt('--top')) : theme.top;
  const themeBad = themeProblems({ ...theme, top });
  if (themeBad.length) return fail(`Theme "${themeName}": ${themeBad.join('; ')}.`);

  const { creds, missing } = loadCreds(account);
  if (missing.length) return fail(`These secrets are not set: ${missing.join(', ')} (they are never printed). Run npm run tumblr:auth.`);
  const client = createClient(creds);

  const posts = [];
  const tagNotes = [];
  let readable = 0;
  const since = NOW - theme.maxAgeDays * 864e5;
  for (const tag of theme.tags) {
    let before = null;
    let got = 0;
    try {
      for (let page = 0; page < theme.pagesPerTag; page++) {
        if (posts.length || page || readable) await sleep(DELAY_MS);
        const items = await client.taggedPosts(tag, { before });
        if (!items.length) break;
        for (const p of items) posts.push({ ...p, viaTag: tag });
        got += items.length;
        const oldest = Math.min(...items.map((p) => p.timestamp ?? Infinity));
        if (!Number.isFinite(oldest) || oldest < since) break; // older than the window: no need to read further back
        before = oldest;
      }
      readable++;
      tagNotes.push(`"${tag}": ${got} posts`);
    } catch (e) {
      if (e?.code === 'http_401') return fail(describe(e)); // a wrong login is the same for every tag
      tagNotes.push(`"${tag}": could not be read (${describe(e)})`);
    }
  }
  if (!readable) return fail(`No tag could be read. ${tagNotes.join('; ')}`);

  const seen = loadSeen();
  const seenThis = (seen.themes[themeName] ??= {});
  const known = args.includes('--again') ? [] : Object.entries(seenThis).filter(([, day]) => (NOW - Date.parse(day)) / 864e5 < SEEN_DAYS).map(([b]) => b);
  const { list, dropped, blogsSeen } = rankBlogs(posts, theme, { now: NOW, skip: [...known, account.blog] });

  // The second look, in the order of the ranking. A blog that cannot be read right now (a hiccup of the network) is not remembered, so the next run tries it again.
  const quick = args.includes('--quick') || theme.verifyTop === 0;
  const shown = [];
  const droppedLater = {};
  const rejected = [];
  let checked = 0;
  let unreadable = 0;
  let firstError = '';
  if (quick) shown.push(...list.slice(0, top));
  else {
    for (const b of list) {
      if (shown.length >= top || checked >= theme.verifyTop) break;
      await sleep(DELAY_MS);
      checked++;
      const drop = (reason, remember = true) => {
        droppedLater[reason] = (droppedLater[reason] ?? 0) + 1;
        if (remember) rejected.push(b.blog);
      };
      let profile;
      try {
        profile = await client.blogPosts(b.blog);
      } catch (e) {
        if (e?.code === 'http_401') return fail(describe(e));
        unreadable++;
        firstError ||= reasonOf(e);
        if (e?.code === 'http_404' || e?.code === 'http_403') drop('blog private or removed');
        else drop('could not be looked at (network or Tumblr)', false);
        // the first three all unreadable: the reading itself does not work, so do not go on asking about dozens of blogs
        if (checked === 3 && unreadable === 3) return fail(`None of the first 3 blogs could be looked at (${firstError}). The list was not made. The second look reads /v2/blog/<name>/posts; run with --quick to get the rougher list without it.`);
        continue;
      }
      const verdict = profileCheck(profile, theme, { now: NOW });
      if (!verdict.ok) {
        drop(verdict.reason);
        continue;
      }
      shown.push({ ...b, check: verdict, description: b.description || profile.info.description });
    }
  }
  const notLooked = quick ? 0 : list.length - checked;

  const today = dayKey(NOW, account.timezone);
  const lines = [];
  lines.push(`# Tumblr: blogs to follow, theme "${themeName}", ${today}`);
  lines.push('');
  lines.push(`For the blog ${account.blog}. Open each one, check that the newest post is recent and really about the subject, then press Follow by hand.`);
  lines.push(`Read ${posts.length} posts from ${readable} of ${theme.tags.length} tags: ${blogsSeen} blogs, ${shown.length} shown.`);
  if (!quick) lines.push(`Second look (the last posts of ${checked} blog(s)): ${shown.length} fit.`);
  else lines.push('The second look was skipped (--quick): check each blog yourself, the list can include blogs that are not about the subject.');
  const allDropped = { ...dropped };
  for (const [k, n] of Object.entries(droppedLater)) allDropped[k] = (allDropped[k] ?? 0) + n;
  const why = Object.entries(allDropped).map(([k, n]) => `${k}: ${n}`);
  if (why.length) lines.push(`Left out: ${why.join('; ')}.`);
  if (tagNotes.some((n) => n.includes('could not'))) lines.push(`Tags with problems: ${tagNotes.filter((n) => n.includes('could not')).join('; ')}.`);
  lines.push('');
  if (shown.length < top && notLooked > 0) lines.push(`Only the first ${checked} of ${list.length} blogs were looked at (setting verifyTop). Run the command again (without --no-save): blogs that were looked at are not looked at twice.`);
  if (!shown.length) lines.push('No new blogs this time. Try again in a few days, or add tags to the theme.');
  shown.forEach((b, i) => {
    lines.push(`${i + 1}. **${b.blog}**${b.title && b.title !== b.blog ? ` (${clip(plain(b.title), 60)})` : ''}`);
    const about = clip(plain(b.description), 140);
    if (about) lines.push(`   ${about}`);
    const onTopic = b.check?.share != null ? `; of its last ${b.check.posts} posts ${Math.round(b.check.share * 100)}% are about the subject` : '';
    lines.push(`   newest post ${ago(b.check?.newest ?? b.newest)}; ${b.posts} post(s) in these tags, ${b.originals} of them own; typical notes ${b.medianNotes}${onTopic}; found by: ${b.tags.join(', ')}`);
    lines.push(`   ${b.newestUrl ?? b.url}`);
  });
  const text = lines.join('\n') + '\n';
  console.log(text);
  summary(`### Tumblr blog finder\n\n${text}`);

  const out = `drafts/tumblr-candidates-${themeName}.md`;
  mkdirSync(dirname(file(out)), { recursive: true });
  writeFileSync(file(out), text);
  console.log(`The list is saved in ${out}`);
  if (!args.includes('--no-save') && (shown.length || rejected.length)) {
    for (const b of [...shown.map((x) => x.blog), ...rejected]) seenThis[b.toLowerCase()] = today;
    writeFileSync(file(SEEN), JSON.stringify(seen, null, 2) + '\n');
    console.log(`Remembered ${shown.length} shown and ${rejected.length} dropped blog(s), so the next list shows new ones (${SEEN}).`);
  }
  finish(0);
}

main().catch((e) => fail(describe(e)));
