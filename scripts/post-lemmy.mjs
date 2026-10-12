// Posts to Lemmy by a template: no AI, no paid API. See LEMMY.md.
// Two kinds of posts, independent of each other (the same rule as Nostr): ONE deal a day, and ONE guide of the site every few days.
//
//   node scripts/post-lemmy.mjs --kind deal               post today's deal (only if "autopost" is true for the account in data/lemmy-accounts.json)
//   node scripts/post-lemmy.mjs --kind article            post the next guide of the site
//   node scripts/post-lemmy.mjs --kind deal --dry-run     show the posts that would be made, publish nothing, change nothing, log in nowhere
//   node scripts/post-lemmy.mjs --kind article --account lemmy-cozy
//   Without --kind nothing is posted (a clear error).
//   GitHub -> Actions -> "Post to Lemmy": deal every day at 07:00 Bogota (after the daily brief), guide at 12:30 Bogota; or Run workflow (mode and kind).
//
// Where a post goes: every community of the account that lists the kind in "kinds" and has "enabled" true (data/lemmy-accounts.json). Communities have their own
// rules about advertising and affiliate links: they are switched on one by one, only after the owner has read the rules of that community (LEMMY.md).
//
// --kind deal: the FIRST deal of drafts/brief-<account>.json (the json of the daily brief, made by scripts/daily-brief.mjs; on GitHub it is read from the
// "brief" branch by scripts/nostr-branch.sh). The post is built from its numbers and dates only: title, price, old price, store, "Price checked <date>",
// sale end date (if any), "Why today" (if the brief has it), the cover as thumbnail with its alt text, the "Ad:" line last. The link is our own page of the game.
// --kind article: the oldest guide of src/pages/guides/ that was not posted yet and has no "lemmy: false" in its header (title, description, picture of the header).
// One guide at most every "articleEveryDays" days (2). Skipped (green) when it is too early, no guide waits, or the page of the guide does not answer 200 on the live site.
//
// The record of what was posted is drafts/posted-lemmy.json (on GitHub it lives on the "brief" branch, so the site is not rebuilt). Each community has its own entry,
// so a community that failed is tried again at the next run and the others are never posted twice. As a second guard the program asks the server for the newest
// posts of the community: a post of our account with the same page of ours there counts as posted, even if the record was lost.
//
// Exit code: 0 = posted or skipped (nothing to post is not an error), 1 = no --kind, bad settings, no login, or a community that failed.
// The password (secret LEMMY_PASSWORD) is only used to log in. It is never printed.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { file, readJson, lemmyAccounts, configProblems, communitiesFor, handleOf, postPage, loadPassword, createClient, buildDealPost, buildArticlePost, listGuides, pageLive, ownPost, dayKey, addDays, hoursSince, summary, finish, reasonOf, hintFor, KINDS, DEFAULT_TITLE } from './lib/lemmy.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const only = args.includes('--account') ? args[args.indexOf('--account') + 1] : null;
const KIND = args.includes('--kind') ? args[args.indexOf('--kind') + 1] : null;
const NOW = process.env.LEMMY_NOW ? Date.parse(process.env.LEMMY_NOW) : Date.now(); // the variable is for tests only
const PAUSE_MS = process.env.LEMMY_PAUSE_MS !== undefined ? Number(process.env.LEMMY_PAUSE_MS) : 2500; // between two posts of one run
const STATE = 'drafts/posted-lemmy.json';
const KEEP_DAYS = 60;
const DEAL_GUARD_HOURS = 36; // a post of the same game page that is younger than this counts as today's deal

const warn = (msg) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `WARNING: ${msg}`);
const fence = (text) => `\`\`\`\`text\n${text}\n\`\`\`\`\n`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

// What to post today. Returns { skip, warn } or { item, make, info, pending, note }:
// item = { kind, id, title, path } (path = our page), make(community) = the post for that community, pending = the communities that still need it.
function planDeal(id, account, targets, rec) {
  const pending = dryRun ? targets : targets.filter((c) => rec?.communities?.[c.community]?.status !== 'done');
  if (!dryRun && rec && !pending.length) return { skip: `already posted today (${rec.title}) to every community that takes deals. One deal a day.` };

  const brief = readJson(`drafts/brief-${id}.json`, null);
  if (!brief) return { skip: `there is no drafts/brief-${id}.json: the Daily brief did not make it (check the "Daily brief" workflow).`, warn: true };
  const age = hoursSince(brief.generatedAt, NOW);
  if (!(age <= account.maxBriefAgeHours)) return { skip: `the brief is ${Number.isFinite(age) ? Math.round(age) + ' h old' : 'of unknown age'}, the limit is ${account.maxBriefAgeHours} h. The Daily brief probably failed today.`, warn: true };
  let c = brief.candidates?.[0];
  if (!c) return { skip: `no deal passes the rules today.${brief.warnings?.length ? ' Brief says: ' + brief.warnings.join(' ') : ''}` };
  if (rec && !dryRun) {
    // Posted to some communities earlier today: the rest gets the SAME deal, never a different one.
    c = brief.candidates.find((x) => x.id === rec.id);
    if (!c) return { skip: `the deal posted earlier today (${rec.title}) is not in the brief any more, so the communities that are still missing are not given another deal today.`, warn: true };
  }
  if (c.kind !== 'deal') return { skip: `the first item of the brief is not a deal (${c.kind}).` };
  const priceAge = hoursSince(c.priceCheckedAt, NOW);
  if (!(priceAge <= account.maxPriceAgeHours)) return { skip: `the price of "${c.title}" was checked ${Number.isFinite(priceAge) ? Math.round(priceAge) + ' h' : '?'} ago, the limit is ${account.maxPriceAgeHours} h. Not posting an old price.`, warn: true };
  buildDealPost(c); // refuses a deal that is not complete (the error is shown by the caller)
  return {
    item: { kind: 'deal', id: c.id, title: c.title, path: new URL(c.link).pathname },
    make: (community) => buildDealPost(c, community.titleTemplate ?? DEFAULT_TITLE),
    info: `Deal: ${c.title} (${c.store}), brief of ${brief.generatedAt}.`,
    pending,
    retry: Boolean(rec && !dryRun), // some communities got this deal earlier today
  };
}

function planArticle(account, targets, arts, day, site) {
  const guides = listGuides();
  const bySlug = new Map(guides.map((g) => [g.slug, g]));
  const notes = [];

  // 1) A guide that went out to some communities but not to all (one was down, or a community was switched on a moment later): the missing ones are
  // tried again for "retryDays" days. It is not a new guide, so the "every N days" rule does not apply.
  for (const [slug, rec] of Object.entries(arts).sort((a, b) => a[1].day.localeCompare(b[1].day))) {
    const g = bySlug.get(slug);
    if (!g || g.off || daysBetween(rec.day, day) > account.retryDays) continue;
    const missing = targets.filter((c) => !rec.communities?.[c.community]);
    if (!missing.length || !Object.keys(rec.communities ?? {}).length) continue;
    try {
      const a = buildArticlePost(g, account, site);
      return { item: { kind: 'article', id: slug, slug, title: a.post.name, path: a.path }, make: () => a.post, info: `Guide: ${slug} (sent again to the communities that did not get it).`, pending: missing, retry: true, notes: a.notes };
    } catch (e) {
      notes.push(e.message);
    }
  }

  // 2) The next guide: the oldest one that was never posted, not more often than every "articleEveryDays" days.
  const last = Object.values(arts).map((r) => r.day).filter(Boolean).sort().at(-1) ?? null;
  const earliest = last && addDays(last, account.articleEveryDays) > day ? addDays(last, account.articleEveryDays) : day;
  const waiting = guides.filter((g) => !g.off && !arts[g.slug]);
  if (!waiting.length) return { skip: `no guides waiting (every guide is posted or has "lemmy: false" in its header).${notes.length ? ` Not usable: ${notes.join(' ')}` : ''}` };
  const tooEarly = earliest > day;
  if (tooEarly && !dryRun) return { skip: `next guide not before ${earliest} (the last guide went out on ${last}; one guide every ${account.articleEveryDays} days). Next: ${waiting[0].slug}.` };
  const broken = [];
  for (const g of waiting) {
    try {
      const a = buildArticlePost(g, account, site);
      const more = waiting.length - 1;
      return {
        item: { kind: 'article', id: g.slug, slug: g.slug, title: a.post.name, path: a.path },
        make: () => a.post,
        info: `Guide: ${g.slug} (updated ${g.updated ?? 'no date'}). ${more} more guide(s) wait after it.${a.notes.length ? ` Notes: ${a.notes.join('; ')}.` : ''}${broken.length ? ` Not usable, skipped: ${broken.join(' ')}` : ''}`,
        pending: targets,
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
  const head = `## Lemmy ${KIND}: ${account.name} (${id})\n\n`;
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
  const mine = (state.accounts[id] ??= {}); // { day: { deal: { id, title, communities: { "name@server": {...} } } } }
  const arts = (state.articles[id] ??= {}); // { slug: { day, communities: { "name@server": {...} } } }
  const listed = communitiesFor(account, KIND);
  const targets = listed.filter((c) => c.enabled !== false);

  const problems = configProblems(account);
  if (problems.length) {
    if (!dryRun) return fail(`data/lemmy-accounts.json: ${problems.join('; ')}.`);
    for (const p of problems) warn(`${id}: ${p}`);
  }
  if (!dryRun && !account.autopost) return skip('"autopost" is false for this account in data/lemmy-accounts.json (waiting for the owner\'s ok). Nothing was posted.');
  if (!dryRun && !targets.length) return skip(`no community takes "${KIND}" posts: every community with this kind is switched off ("enabled": false) or there is none in data/lemmy-accounts.json. Nothing was posted.`);
  if (dryRun && !listed.length) return skip(`no community lists "${KIND}" in its "kinds" in data/lemmy-accounts.json, so there is nothing to show.`);

  let plan;
  try {
    plan = KIND === 'deal' ? planDeal(id, account, dryRun ? listed : targets, mine[day]?.deal) : planArticle(account, dryRun ? listed : targets, arts, day, links?.site);
  } catch (e) {
    return fail(e.message); // a deal or guide that is not complete: red on purpose, someone has to look at it
  }
  if (plan.skip) return skip(plan.skip, plan.warn);
  if (plan.warnings?.length) warn(`${id}: guides that cannot become a post: ${plan.warnings.join(' ')}`);
  const { item, make, info, pending } = plan;

  // The page of a guide must open on the live site before a link to it goes out.
  let live = null;
  if (KIND === 'article') {
    live = await pageLive(links?.site, item.path);
    if (!live.ok && !dryRun) return skip(`page not live yet: ${live.url} answered ${live.reason}. The guide "${item.slug}" waits; nothing was posted.`, true);
  }

  // ---------- dry run: show every post, change nothing ----------
  if (dryRun) {
    let md = `${head}**Dry run: nothing was published.**\n\n- ${info}\n- Account: ${handleOf(account)}${account.autopost ? '' : ' ("autopost" is false: a real run is skipped until the owner switches it on)'}\n`;
    if (live && !live.ok) md += `- The page ${live.url} answered ${live.reason}: a real run would wait.\n`;
    if (plan.tooEarly) md += `- Too early: a real run today would be skipped. This guide goes out on ${plan.tooEarly} or later.\n`;
    if (KIND === 'deal' && mine[day]?.deal) md += `- A deal was already posted today (${mine[day].deal.title}); a real run today would not post another one. The text below is what the NEXT real run would post.\n`;
    for (const c of pending) {
      const p = make(c);
      const text = [`title: ${p.name}`, `link: ${p.url}`, p.custom_thumbnail ? `thumbnail: ${p.custom_thumbnail}\nalt text: ${p.alt_text}` : 'thumbnail: none', p.body ? `body:\n${p.body}` : 'body: none'].join('\n');
      const off = c.enabled === false ? ' (switched off)' : '';
      console.log(`\n----- ${KIND} post for ${c.community}${off} -----\n${text}\n`);
      md += `\n**${c.community}**${off}\n\n${fence(text)}`;
    }
    console.log(info);
    summary(md);
    return { code: 0 };
  }

  // ---------- real run ----------
  const password = loadPassword(account.passwordEnv);
  if (!password) return fail(`no password (${account.passwordEnv}). Add it as a GitHub Secret: npm run lemmy:secret.`);
  const client = createClient(account.instance);
  try {
    const found = await client.detect(account.apiVersion ?? null);
    console.log(`Server ${account.instance}: Lemmy ${found.version ?? '?'}, API ${found.api}.`);
    await client.login(account.username, password);
  } catch (e) {
    return fail(`${account.instance}: ${describe(e)}`);
  }

  const record = (c, data) => {
    if (KIND === 'deal') ((mine[day] ??= {}).deal ??= { id: item.id, title: item.title, communities: {} }).communities[c.community] = data;
    else (arts[item.slug] ??= { day, communities: {} }).communities[c.community] = data;
    saveState(state);
  };

  const results = [];
  for (const [i, c] of pending.entries()) {
    if (i) await sleep(PAUSE_MS);
    try {
      const community = await client.community(c.community);
      if (community.removed || community.deleted) throw Object.assign(new Error('the community is removed or deleted'), { code: 'community_removed' });
      const recent = await client.recentPosts(community.id, 50);
      const already = ownPost(recent, { username: account.username, instance: account.instance, site: links?.site, pathname: item.path, maxAgeHours: KIND === 'deal' ? DEAL_GUARD_HOURS : null, now: NOW });
      if (already) {
        record(c, { status: 'done', postId: already.id, url: postPage(account.instance, already.id), foundOnServer: true, postedAt: already.published });
        results.push({ community: c.community, result: 'already there (found on the server)', url: postPage(account.instance, already.id) });
        continue;
      }
      const post = make(c);
      const made = await client.createPost({ community_id: community.id, ...post, nsfw: false, ...(c.languageId !== undefined ? { language_id: c.languageId } : {}) });
      const url = postPage(account.instance, made.id);
      record(c, { status: 'done', postId: made.id, url, postedAt: new Date(NOW).toISOString() });
      results.push({ community: c.community, result: 'posted', url, post });
      console.log(`Posted to ${c.community}: ${url}`);
    } catch (e) {
      const reason = describe(e);
      console.error(`NOT posted to ${c.community}: ${reason}`);
      results.push({ community: c.community, result: 'FAILED', reason });
    }
  }

  const failed = results.filter((r) => r.result === 'FAILED');
  const shown = results.find((r) => r.post)?.post;
  const table = ['| Community | Result | Post or reason |', '|---|---|---|', ...results.map((r) => `| ${r.community} | ${r.result} | ${r.url ?? r.reason} |`)].join('\n');
  const verdict = failed.length ? `**${failed.length} of ${results.length} communities did NOT get the post.** They are tried again at the next run (press Run workflow, mode post, kind ${KIND}); the others are not posted twice.` : `**Posted${plan.retry ? ' again to the missing communities' : ''}.**`;
  const text = shown ? `\n**Text of the post:**\n\n${fence(`title: ${shown.name}\nlink: ${shown.url}\n${shown.custom_thumbnail ? `thumbnail: ${shown.custom_thumbnail} (alt text: ${shown.alt_text})\n` : ''}${shown.body ? `\n${shown.body}` : ''}`)}` : '';
  summary(`${head}${verdict}\n\n- Account: ${handleOf(account)}\n- ${info}\n\n${table}\n${text}`);
  return { code: failed.length ? 1 : 0 };
}

async function main() {
  if (!KINDS.includes(KIND)) {
    const msg = `Which post? Add --kind deal or --kind article (got: ${KIND ?? 'nothing'}). Nothing was posted.`;
    console.error(`ERROR: ${msg}`);
    summary(`## Lemmy\n\n**FAILED:** ${msg}\n`);
    return 1;
  }
  const accounts = lemmyAccounts(only).filter(({ account }) => account.enabled !== false);
  if (!accounts.length) {
    console.log('No enabled Lemmy accounts in data/lemmy-accounts.json: nothing to do.');
    summary('## Lemmy\n\n**Skipped:** no enabled Lemmy accounts.\n');
    return 0;
  }
  const state = loadState();
  let code = 0;
  for (const a of accounts) {
    try {
      code = Math.max(code, (await runAccount(a, state)).code);
    } catch (e) {
      console.error(`ERROR (${a.id}): ${reasonOf(e)}`);
      summary(`## Lemmy ${KIND}: ${a.account.name} (${a.id})\n\n**FAILED:** ${reasonOf(e)}\n`);
      code = 1;
    }
  }
  return code;
}

finish(await main());
