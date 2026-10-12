// Posts to Tumblr by a template: no AI, no paid API. See TUMBLR.md.
// Two kinds of posts, independent of each other (the same rule as Nostr and Lemmy): ONE deal a day, and ONE guide of the site every few days.
//
//   node scripts/post-tumblr.mjs --kind deal               post today's deal (only if "autopost" is true for the account in data/tumblr-accounts.json)
//   node scripts/post-tumblr.mjs --kind article            post the next guide of the site
//   node scripts/post-tumblr.mjs --kind deal --dry-run     show the post that would be made, publish nothing, change nothing, log in nowhere
//   node scripts/post-tumblr.mjs --kind article --account tumblr-cozy
//   Without --kind nothing is posted (a clear error).
//   GitHub -> Actions -> "Post to Tumblr": deal every day at 08:00 Bogota (after the daily brief), guide at 13:00 Bogota; or Run workflow (mode and kind).
//
// --kind deal: the FIRST deal of drafts/brief-<account>.json (the json of the daily brief, made by scripts/daily-brief.mjs; on GitHub it is read from the
// "brief" branch by scripts/nostr-branch.sh). The post is built from its numbers and dates only: heading, cover (with its alt text), price, old price, store,
// "Price checked <date>", sale end date (if any), "Why today" (if the brief has it), a link block to OUR page of the game, the "Ad:" line last.
// --kind article: the oldest guide of src/pages/guides/ that was not posted yet and has no "tumblr: false" in its header (title, picture with imageAlt,
// description, link to the guide). One guide at most every "articleEveryDays" days (2). Skipped (green) when it is too early, no guide waits, or the page
// of the guide does not answer 200 on the live site.
//
// The record of what was posted is drafts/posted-tumblr.json (on GitHub it lives on the "brief" branch, so the site is not rebuilt). As a second guard the
// program asks Tumblr for the newest posts of the blog: a post with the same page of ours there counts as posted, even if the record was lost.
//
// Exit code: 0 = posted or skipped (nothing to post is not an error), 1 = no --kind, bad settings, missing secrets, or a post that failed.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { file, readJson, tumblrAccounts, configProblems, handleOf, postPage, loadCreds, createClient, probeImage, buildDealPost, buildArticlePost, listGuides, pageLive, ownPost, dayKey, addDays, hoursSince, summary, finish, reasonOf, hintFor, KINDS } from './lib/tumblr.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const only = args.includes('--account') ? args[args.indexOf('--account') + 1] : null;
const KIND = args.includes('--kind') ? args[args.indexOf('--kind') + 1] : null;
const NOW = process.env.TUMBLR_NOW ? Date.parse(process.env.TUMBLR_NOW) : Date.now(); // the variable is for tests only
const STATE = 'drafts/posted-tumblr.json';
const KEEP_DAYS = 60;
const DEAL_GUARD_HOURS = 36; // a post of the same game page that is younger than this counts as today's deal

const warn = (msg) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `WARNING: ${msg}`);
const fence = (t) => `\`\`\`\`text\n${t}\n\`\`\`\`\n`;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
// An error as one plain sentence, with what the owner can do about it.
const describe = (e) => `${reasonOf(e)}${hintFor(e?.code) ? ` ${hintFor(e.code)}` : ''}`;

function loadState() {
  const state = readJson(STATE, { accounts: {}, articles: {} });
  state.accounts ??= {};
  state.articles ??= {};
  return state;
}
function saveState(state) {
  // Only the days of deals are cleaned up. The record of posted guides (state.articles) is kept for good: a guide must never go out twice.
  for (const days of Object.values(state.accounts)) {
    for (const d of Object.keys(days)) if ((NOW - Date.parse(d)) / 864e5 > KEEP_DAYS) delete days[d];
  }
  mkdirSync(dirname(file(STATE)), { recursive: true });
  writeFileSync(file(STATE), JSON.stringify(state, null, 2) + '\n');
}

// The text of a post for the Summary and the dry run: blocks as plain lines.
function show(post) {
  const lines = post.content.map((b) => {
    if (b.type === 'text') return `${b.subtype ? `[${b.subtype}] ` : ''}${b.text}${b.formatting?.length ? ` -> link ${b.formatting[0].url}` : ''}`;
    if (b.type === 'image') return `[image ${b.media[0].width}x${b.media[0].height}] ${b.media[0].url}\n  alt text: ${b.alt_text}`;
    if (b.type === 'link') return `[link] ${b.url}`;
    return `[${b.type}]`;
  });
  return `${lines.join('\n')}\ntags: ${post.tags.join(', ') || '(none)'}`;
}

// What to post today. Returns { skip, warn } or { item, make(cover), coverUrl, info, retry, note }:
// item = { kind, id, title, path } (path = our page), make(cover) = the post, coverUrl = picture to measure (or null).
function planDeal(id, account, rec) {
  if (!dryRun && rec) return { skip: `already posted today (${rec.title}). One deal a day.` };
  const brief = readJson(`drafts/brief-${id}.json`, null);
  if (!brief) return { skip: `there is no drafts/brief-${id}.json: the Daily brief did not make it (check the "Daily brief" workflow).`, warn: true };
  const age = hoursSince(brief.generatedAt, NOW);
  if (!(age <= account.maxBriefAgeHours)) return { skip: `the brief is ${Number.isFinite(age) ? Math.round(age) + ' h old' : 'of unknown age'}, the limit is ${account.maxBriefAgeHours} h. The Daily brief probably failed today.`, warn: true };
  const c = brief.candidates?.[0];
  if (!c) return { skip: `no deal passes the rules today.${brief.warnings?.length ? ' Brief says: ' + brief.warnings.join(' ') : ''}` };
  if (c.kind !== 'deal') return { skip: `the first item of the brief is not a deal (${c.kind}).` };
  const priceAge = hoursSince(c.priceCheckedAt, NOW);
  if (!(priceAge <= account.maxPriceAgeHours)) return { skip: `the price of "${c.title}" was checked ${Number.isFinite(priceAge) ? Math.round(priceAge) + ' h' : '?'} ago, the limit is ${account.maxPriceAgeHours} h. Not posting an old price.`, warn: true };
  buildDealPost(c, account); // refuses a deal that is not complete (the error is shown by the caller)
  return {
    item: { kind: 'deal', id: c.id, title: c.title, path: new URL(c.link).pathname },
    make: (cover) => buildDealPost(c, account, cover),
    coverUrl: c.cover ?? null,
    info: `Deal: ${c.title} (${c.store}), brief of ${brief.generatedAt}.`,
  };
}

function planArticle(account, arts, day, site) {
  const guides = listGuides();
  const last = Object.values(arts).map((r) => r.day).filter(Boolean).sort().at(-1) ?? null;
  const earliest = last && addDays(last, account.articleEveryDays) > day ? addDays(last, account.articleEveryDays) : day;
  const waiting = guides.filter((g) => !g.off && !arts[g.slug]);
  if (!waiting.length) return { skip: 'no guides waiting (every guide is posted or has "tumblr: false" in its header).' };
  const tooEarly = earliest > day;
  if (tooEarly && !dryRun) return { skip: `next guide not before ${earliest} (the last guide went out on ${last}; one guide every ${account.articleEveryDays} days). Next: ${waiting[0].slug}.` };
  const broken = [];
  for (const g of waiting) {
    try {
      const a = buildArticlePost(g, account, site);
      return {
        item: { kind: 'article', id: g.slug, slug: g.slug, title: a.title, path: a.path },
        make: (cover) => buildArticlePost(g, account, site, cover).post,
        coverUrl: a.imageUrl,
        info: `Guide: ${g.slug} (updated ${g.updated ?? 'no date'}). ${waiting.length - 1} more guide(s) wait after it.${a.notes.length ? ` Notes: ${a.notes.join('; ')}.` : ''}${broken.length ? ` Not usable, skipped: ${broken.join(' ')}` : ''}`,
        tooEarly: tooEarly ? earliest : null,
        warnings: broken,
      };
    } catch (e) {
      broken.push(e.message);
    }
  }
  return { skip: `no guide can become a post. ${broken.join(' ')}`, warn: true };
}

// One account. Returns { code } (0 or 1).
async function runAccount({ id, account, links }, state) {
  const head = `## Tumblr ${KIND}: ${account.name} (${id})\n\n`;
  const skip = (reason, isWarning = false) => {
    console.log(`Skipped (${id}, ${KIND}): ${reason}`);
    if (isWarning) warn(`${id}: ${reason}`);
    summary(`${head}**Skipped:** ${reason}\n`);
    return { code: 0 };
  };
  const fail = (reason) => {
    console.error(`ERROR (${id}): ${reason}`);
    summary(`${head}**FAILED:** ${reason}\n`);
    return { code: 1 };
  };

  const day = dayKey(NOW, account.timezone);
  const mine = (state.accounts[id] ??= {}); // { day: { deal: { id, title, postId, url, postedAt } } }
  const arts = (state.articles[id] ??= {}); // { slug: { day, postId, url, postedAt } }

  const problems = configProblems(account);
  if (problems.length) {
    if (!dryRun) return fail(`data/tumblr-accounts.json: ${problems.join('; ')}.`);
    for (const p of problems) warn(`${id}: ${p}`);
  }
  if (!account.kinds.includes(KIND)) return skip(`this account does not take "${KIND}" posts ("kinds" in data/tumblr-accounts.json). Nothing was posted.`);
  if (!dryRun && !account.autopost) return skip('"autopost" is false for this account in data/tumblr-accounts.json (waiting for the owner\'s ok). Nothing was posted.');

  let plan;
  try {
    plan = KIND === 'deal' ? planDeal(id, account, mine[day]?.deal) : planArticle(account, arts, day, links?.site);
  } catch (e) {
    return fail(e.message); // a deal or guide that is not complete: red on purpose, someone has to look at it
  }
  if (plan.skip) return skip(plan.skip, plan.warn);
  if (plan.warnings?.length) warn(`${id}: guides that cannot become a post: ${plan.warnings.join(' ')}`);
  const { item, info } = plan;

  // The page of a guide must open on the live site before a link to it goes out.
  let live = null;
  if (KIND === 'article') {
    live = await pageLive(links?.site, item.path);
    if (!live.ok && !dryRun) return skip(`page not live yet: ${live.url} answered ${live.reason}. The guide "${item.slug}" waits; nothing was posted.`, true);
  }

  // Tumblr wants the size of every picture: the program reads it from the picture itself. No picture = a post without it, with a note.
  let cover = null;
  let coverNote = null;
  if (plan.coverUrl) {
    const p = await probeImage(plan.coverUrl);
    cover = p.info ?? null;
    if (!cover) coverNote = `the post goes out without its picture: ${p.reason}`;
  }
  let post;
  try {
    post = plan.make(cover);
  } catch (e) {
    return fail(e.message);
  }

  // ---------- dry run: show the post, change nothing ----------
  if (dryRun) {
    let md = `${head}**Dry run: nothing was published.**\n\n- ${info}\n- Blog: ${handleOf(account)}${account.autopost ? '' : ' ("autopost" is false: a real run is skipped until the owner switches it on)'}\n`;
    if (live && !live.ok) md += `- The page ${live.url} answered ${live.reason}: a real run would wait.\n`;
    if (plan.tooEarly) md += `- Too early: a real run today would be skipped. This guide goes out on ${plan.tooEarly} or later.\n`;
    if (KIND === 'deal' && mine[day]?.deal) md += `- A deal was already posted today (${mine[day].deal.title}); a real run today would not post another one. The text below is what the NEXT real run would post.\n`;
    if (coverNote) md += `- Note: ${coverNote}.\n`;
    const t = show(post);
    console.log(`\n----- ${KIND} post for ${handleOf(account)} -----\n${t}\n`);
    console.log(info);
    summary(`${md}\n${fence(t)}`);
    return { code: 0 };
  }

  // ---------- real run ----------
  const { creds, missing } = loadCreds(account);
  if (missing.length) return fail(`no login for Tumblr: ${missing.join(', ')} not set. Run npm run tumblr:auth, then npm run tumblr:secret.`);
  const client = createClient(creds);

  const record = (data) => {
    if (KIND === 'deal') mine[day] = { ...(mine[day] ?? {}), deal: { id: item.id, title: item.title, ...data } };
    else arts[item.slug] = { day, title: item.title, ...data };
    saveState(state);
  };

  let result;
  try {
    // Second guard: our post may already be there (the record was lost, or a run was cut off after the post went through).
    const recent = await client.recentPosts(account.blog, 20);
    const already = ownPost(recent, { site: links?.site, pathname: item.path, maxAgeHours: KIND === 'deal' ? DEAL_GUARD_HOURS : null, now: NOW });
    if (already) {
      const url = already.url ?? postPage(account.blog, already.id);
      record({ status: 'done', postId: already.id, url, foundOnServer: true, postedAt: already.timestamp ? new Date(already.timestamp).toISOString() : new Date(NOW).toISOString() });
      result = { text: 'already there (found on the blog)', url };
    } else {
      const made = await client.createPost(account.blog, post);
      const url = postPage(account.blog, made.id);
      record({ status: 'done', postId: made.id, url, postedAt: new Date(NOW).toISOString() });
      result = { text: 'posted', url, post };
      console.log(`Posted: ${url}`);
    }
  } catch (e) {
    return fail(`${handleOf(account)}: ${describe(e)} The post was not recorded; the next run tries again (it first looks whether the post is already on the blog).`);
  }

  const shown = result.post ? `\n**Text of the post:**\n\n${fence(show(result.post))}` : '';
  summary(`${head}**${result.text === 'posted' ? 'Posted.' : 'Nothing new to post: ' + result.text + '.'}**\n\n- Blog: ${handleOf(account)}\n- ${info}\n- ${result.url}\n${coverNote ? `- Note: ${coverNote}.\n` : ''}${shown}`);
  return { code: 0 };
}

async function main() {
  if (!KINDS.includes(KIND)) {
    const msg = `Which post? Add --kind deal or --kind article (got: ${KIND ?? 'nothing'}). Nothing was posted.`;
    console.error(`ERROR: ${msg}`);
    summary(`## Tumblr\n\n**FAILED:** ${msg}\n`);
    return 1;
  }
  const accounts = tumblrAccounts(only).filter(({ account }) => account.enabled !== false);
  if (!accounts.length) {
    console.log('No enabled Tumblr accounts in data/tumblr-accounts.json: nothing to do.');
    summary('## Tumblr\n\n**Skipped:** no enabled Tumblr accounts.\n');
    return 0;
  }
  const state = loadState();
  let code = 0;
  for (const a of accounts) {
    try {
      code = Math.max(code, (await runAccount(a, state)).code);
    } catch (e) {
      console.error(`ERROR (${a.id}): ${reasonOf(e)}`);
      summary(`## Tumblr ${KIND}: ${a.account.name} (${a.id})\n\n**FAILED:** ${reasonOf(e)}\n`);
      code = 1;
    }
  }
  return code;
}

finish(await main());
