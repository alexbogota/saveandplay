// Posts ONE deal a day to Nostr, by a template: no AI, no API key. See NOSTR.md.
//
//   node scripts/post-nostr.mjs                 post (only if "autopost" is true for the account in data/nostr-accounts.json)
//   node scripts/post-nostr.mjs --dry-run       show the note that would be posted, publish nothing, change nothing
//   node scripts/post-nostr.mjs --account nostr-cozy
//   GitHub -> Actions -> "Post to Nostr" (every day at 06:30 Bogota, after the daily brief; or Run workflow, mode dry-run or post)
//
// What is posted: first the ARTICLES of the account's queue (data/nostr-articles.json: the next article that is approved and not posted yet),
// one a day. When there is none left, the deals. The text of an article is written by hand in that file (no AI); the program adds the link
// with the account's marks (utm_source = subid) and the picture with its alt text.
//
// Where a deal note comes from: the FIRST deal of drafts/brief-<account>.json (the json of the daily brief, made by scripts/daily-brief.mjs;
// on GitHub it is read from the "brief" branch by scripts/nostr-branch.sh). The text is built from its numbers and dates only:
// game, discount, price, old price, store, "Price checked <date>", sale end date (if any), "Why today" (if the brief has it), the "Ad:" line, picture address, link.
//
// "redo" (data/nostr-articles.json): an article whose note went out wrongly is deleted (the relays are asked, NIP-09) and posted again, once. See redoList in scripts/lib/nostr.mjs.
//
// One note a day per account: the record of what was posted is drafts/posted-nostr.json (on GitHub it lives on the "brief" branch, so the
// site is not rebuilt). Run it twice and the second run says "already posted today". As a second guard the relays are asked whether the
// account already has a note from the last 20 hours. A note that reached too few relays is sent again to all of them on the next run (the same note, not a new one).
//
// Exit code: 0 = posted or skipped (nothing to post is not an error), 1 = no relay accepted, too few accepted, or something is broken.
// The private key (secret NOSTR_NSEC) is only used to sign. It is never printed.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { file, readJson, nostrAccounts, loadRelayConfig, loadSecretKey, npubOf, getPublicKey, buildNote, buildArticleNote, articleQueue, redoList, signDeletion, signNote, verifyEvent, publishToAll, queryRelay, relayTable, summary, hoursSince, nip19, finish, BRAND_TAG, OLD_AD_TAG } from './lib/nostr.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const only = args.includes('--account') ? args[args.indexOf('--account') + 1] : null;
const NOW = process.env.NOSTR_NOW ? Date.parse(process.env.NOSTR_NOW) : Date.now(); // the variable is for tests only
const STATE = 'drafts/posted-nostr.json';
const KEEP_DAYS = 60;

const dayKey = (t, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t); // YYYY-MM-DD
const warn = (msg) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `WARNING: ${msg}`);
const fence = (text) => `\`\`\`\`text\n${text}\n\`\`\`\`\n`;

const loadState = () => readJson(STATE, { accounts: {}, articles: {}, redone: {} });
function saveState(state) {
  // Only the days are cleaned up. The record of posted articles (state.articles) is kept for good: an article must never go out twice.
  for (const days of Object.values(state.accounts)) {
    for (const d of Object.keys(days)) if ((NOW - Date.parse(d)) / 864e5 > KEEP_DAYS) delete days[d];
  }
  mkdirSync(dirname(file(STATE)), { recursive: true });
  writeFileSync(file(STATE), JSON.stringify(state, null, 2) + '\n');
}

// What to post today. Returns { skip, warn } or { kind: 'article' | 'deal', note, title, info, record }.
function plan(id, account, links, postedArticles) {
  const queue = articleQueue(id, postedArticles);
  const waiting = queue.waiting.length ? ` Waiting for approval (approved: true), not posted: ${queue.waiting.join(', ')}.` : '';
  if (queue.next) {
    const a = queue.next;
    const note = buildArticleNote(a, account, links?.site);
    const info = `Article: ${a.slug}. After it: ${queue.later} more approved article(s), then the deals.${waiting}`;
    return { kind: 'article', note, title: a.slug, info, record: { article: a.slug } };
  }

  const brief = readJson(`drafts/brief-${id}.json`, null);
  if (!brief) return { skip: `there is no drafts/brief-${id}.json: the Daily brief did not make it (check the "Daily brief" workflow).`, warn: true };
  const age = hoursSince(brief.generatedAt, NOW);
  if (!(age <= account.maxBriefAgeHours)) return { skip: `the brief is ${Number.isFinite(age) ? Math.round(age) + ' h old' : 'of unknown age'}, the limit is ${account.maxBriefAgeHours} h. The Daily brief probably failed today.`, warn: true };
  const c = brief.candidates?.[0];
  if (!c) return { skip: `no deal passes the rules today.${brief.warnings?.length ? ' Brief says: ' + brief.warnings.join(' ') : ''}${waiting}` };
  if (c.kind !== 'deal') return { skip: `the first item of the brief is not a deal (${c.kind}).` };
  const priceAge = hoursSince(c.priceCheckedAt, NOW);
  if (!(priceAge <= account.maxPriceAgeHours)) return { skip: `the price of "${c.title}" was checked ${Number.isFinite(priceAge) ? Math.round(priceAge) + ' h' : '?'} ago, the limit is ${account.maxPriceAgeHours} h. Not posting an old price.`, warn: true };
  const note = buildNote(c, account);
  return { kind: 'deal', note, title: c.title, info: `Deal: ${c.title} (${c.store}), brief of ${brief.generatedAt}.${waiting}`, record: { deal: c.id, title: c.title } };
}

// One account. Returns { code } (0 or 1).
async function runAccount({ id, account, links }, state) {
  const head = `## Nostr: ${account.name} (${id})\n\n`;
  const skip = (reason, isWarning = false) => {
    console.log(`Skipped (${id}): ${reason}`);
    if (isWarning) warn(`${id}: ${reason}`);
    summary(`${head}**Skipped:** ${reason}\n`);
    return { code: 0 };
  };

  const day = dayKey(NOW, account.timezone);
  const mine = (state.accounts[id] ??= {});
  const postedArticles = ((state.articles ??= {})[id] ??= {});
  const redone = ((state.redone ??= {})[id] ??= {}); // { slug: { deletedId, deletedAt, day } }: articles that were already deleted and posted again
  const deletedIds = new Set(Object.values(redone).map((r) => r.deletedId));
  let today = mine[day];

  if (!dryRun && !account.autopost) return skip('"autopost" is false for this account in data/nostr-accounts.json (waiting for the owner\'s ok). Nothing was posted.');

  // Articles to delete and post again: listed in "redo", already posted, not redone before.
  const redoPending = redoList(id).filter((slug) => postedArticles[slug] && !redone[slug]);
  let planned = postedArticles; // what the plan below thinks is already posted
  if (redoPending.length) {
    planned = { ...postedArticles };
    for (const slug of redoPending) delete planned[slug];
  }

  if (redoPending.length && !dryRun) {
    const sk0 = loadSecretKey(account.secretEnv);
    if (!sk0) {
      console.error(`ERROR (${id}): no private key (${account.secretEnv}). Add it as a GitHub Secret: npm run nostr:secret.`);
      summary(`${head}**FAILED:** no private key (${account.secretEnv}).\n`);
      return { code: 1 };
    }
    const relays0 = loadRelayConfig();
    for (const slug of redoPending) {
      const old = postedArticles[slug];
      const del = signDeletion([old.id], sk0, NOW);
      if (!verifyEvent(del)) throw new Error('The signed deletion request does not verify. Nothing was changed.');
      const results = await publishToAll(del, relays0.urls, relays0.timeoutMs);
      const ok = results.filter((r) => r.ok);
      console.log(`Redo of "${slug}": the relays were asked to delete note ${old.id}: ${ok.length} of ${results.length} accepted the request (needed ${relays0.minAccepted}).`);
      for (const r of results) console.log(`  ${r.ok ? 'accepted ' : 'REJECTED '} ${r.url} (${r.ms} ms)${r.reason ? ' - ' + r.reason : ''}`);
      if (ok.length < relays0.minAccepted) {
        summary(`${head}**Redo FAILED:** only ${ok.length} relay(s) accepted the request to delete note \`${old.id}\` (${relays0.minAccepted} needed). Nothing was changed and nothing was posted. Run the same mode again.\n\n${relayTable(results)}\n`);
        return { code: 1 };
      }
      redone[slug] = { deletedId: old.id, deletedAt: new Date(NOW).toISOString(), day: old.day, accepted: ok.map((r) => r.url) };
      deletedIds.add(old.id);
      delete postedArticles[slug];
      if (mine[old.day]?.id === old.id) delete mine[old.day]; // the day is free again: the corrected note takes its place
      saveState(state);
      summary(`${head}**Redo:** the relays were asked to delete the earlier note of the article \`${slug}\` (\`${old.id}\`, ${ok.length} of ${results.length} relays accepted the request). Relays honour this at their own pace, a client may keep showing the old note for a while.\n\n`);
    }
    today = mine[day];
    planned = postedArticles;
  }

  // A note that was already made today (posted, or sent to too few relays) is not planned again: it is only skipped or sent again.
  // Only a dry run looks at "what would be posted next".
  const madeToday = !dryRun && (today?.status === 'done' || today?.status === 'partial');
  let todays = null;
  if (!madeToday) {
    todays = plan(id, account, links, planned);
    if (todays.skip) return skip(todays.skip, todays.warn);
  }

  const sk = loadSecretKey(account.secretEnv);
  const npub = sk ? npubOf(sk) : /^npub1/.test(account.handle) ? account.handle : '(no key yet)';
  const profileLine = `- Account: \`${npub}\` ([profile](https://njump.me/${npub}))\n`;

  if (todays) {
    const { note } = todays;
    const textBlock = `**Text of the note:**\n\n${fence(note.content)}\nTags: \`${JSON.stringify(note.tags)}\`\n\n${profileLine}- ${todays.info}\n`;
    console.log(`\n${account.name} (${id}), ${npub}\n${todays.info}\n\n----- note -----\n${note.content}\n----------------\ntags: ${JSON.stringify(note.tags)}`);

    if (dryRun) {
      let extra = '';
      if (redoPending.length) extra = `\nRedo: a real run will FIRST ask the relays to delete ${redoPending.map((slug) => `the earlier note of the article ${slug} (${postedArticles[slug].id})`).join(' and ')}, and then post the note above in its place (once; it is remembered).\n`;
      else if (today?.status === 'done') extra = `\nNote: a note was already posted today (${today.id}); a real run today would be skipped. The text above is what the NEXT real run would post.\n`;
      else if (!account.autopost) extra = '\nNote: "autopost" is false, so a real run is skipped until the owner switches it on in data/nostr-accounts.json.\n';
      if (extra) console.log(extra.trim());
      summary(`${head}**Dry run: nothing was published.**\n\n${textBlock}${extra}`);
      return { code: 0 };
    }
  }

  if (!sk) {
    console.error(`ERROR (${id}): no private key (${account.secretEnv}). Add it as a GitHub Secret: npm run nostr:secret.`);
    summary(`${head}**FAILED:** no private key (${account.secretEnv}).\n`);
    return { code: 1 };
  }
  if (today?.status === 'done') return skip(`already posted today (${day}): note ${today.id}. One note a day.`);

  const relays = loadRelayConfig();
  const pk = getPublicKey(sk);
  let event;
  let again = false;
  let record;
  let shown;

  if (today?.status === 'partial') {
    // Posted earlier but too few relays took it: send the SAME note again, do not make a second one.
    event = today.event;
    if (!event || !verifyEvent(event) || event.pubkey !== pk) throw new Error(`The saved note of ${day} does not verify. Check drafts/posted-nostr.json.`);
    again = true;
    record = { ...(today.article ? { article: today.article } : { deal: today.deal, title: today.title }) };
    shown = { content: event.content, tags: event.tags, info: today.article ? `Article: ${today.article}.` : `Deal: ${today.title}.` };
    console.log(`The note of today reached only ${today.accepted.length} relay(s) earlier: sending the same note (${event.id}) again.`);
  } else {
    // Second guard: does the account already have a note from the last 20 hours on the relays? Replies (they have an "e" tag) do not count:
    // the owner may answer people from this account by hand.
    // Notes that we asked the relays to delete (redo) do not count, even where a relay still returns them.
    const found = (await Promise.all(relays.urls.map((u) => queryRelay(u, { authors: [pk], kinds: [1], '#t': [BRAND_TAG, OLD_AD_TAG], since: Math.floor(NOW / 1000) - 20 * 3600, limit: 20 }, Math.min(relays.timeoutMs, 6000))))).flat().filter((ev) => ev && !deletedIds.has(ev.id) && !ev.tags?.some((t) => t[0] === 'e'));
    if (found.length) {
      const ev = found.sort((a, b) => b.created_at - a.created_at)[0];
      mine[day] = { status: 'done', id: ev.id, npub, foundOnRelay: true, postedAt: new Date(ev.created_at * 1000).toISOString() };
      saveState(state);
      return skip(`the relays already have a note of this account from the last 20 hours (${ev.id}). One note a day.`);
    }
    event = signNote(todays.note, sk, NOW);
    if (!verifyEvent(event)) throw new Error('The signed note does not verify. Not published.');
    record = todays.record;
    shown = { content: todays.note.content, tags: todays.note.tags, info: todays.info };
  }

  const results = await publishToAll(event, relays.urls, relays.timeoutMs);
  const accepted = results.filter((r) => r.ok);
  const status = accepted.length >= relays.minAccepted ? 'done' : accepted.length > 0 ? 'partial' : 'failed';
  if (status !== 'failed') {
    mine[day] = { status, kind: record.article ? 'article' : 'deal', id: event.id, npub, ...record, postedAt: new Date(event.created_at * 1000).toISOString(), accepted: accepted.map((r) => r.url), failed: results.filter((r) => !r.ok).map((r) => ({ url: r.url, reason: r.reason })), event };
    if (record.article) postedArticles[record.article] = { day, id: event.id }; // never again, even after the day records are cleaned up
    saveState(state);
  }

  const nevent = nip19.neventEncode({ id: event.id, relays: accepted.slice(0, 2).map((r) => r.url), author: pk, kind: 1 });
  console.log(`\nRelays: ${accepted.length} of ${results.length} accepted (needed ${relays.minAccepted}).`);
  for (const r of results) console.log(`  ${r.ok ? 'accepted ' : 'REJECTED '} ${r.url} (${r.ms} ms)${r.reason ? ' - ' + r.reason : ''}`);
  console.log(`Note id: ${event.id}\nSee it: https://njump.me/${nevent}`);
  const verdict = status === 'done' ? `**Posted${again ? ' again (same note)' : ''}.**` : status === 'partial' ? `**Only ${accepted.length} relay(s) accepted the note, ${relays.minAccepted} needed.** The same note will be sent again at the next run (press Run workflow, mode post).` : '**FAILED: no relay accepted the note.** Nothing was posted. Check data/nostr-relays.json (GitHub -> Actions -> Post to Nostr -> mode check).';
  const textBlock = `**Text of the note:**\n\n${fence(shown.content)}\nTags: \`${JSON.stringify(shown.tags)}\`\n\n${profileLine}- ${shown.info}\n`;
  summary(`${head}${verdict}\n\n${textBlock}- Note id: \`${event.id}\` ([see it](https://njump.me/${nevent}))\n\n${relayTable(results)}\n`);
  return { code: status === 'done' ? 0 : 1 };
}

async function main() {
  const accounts = nostrAccounts(only).filter(({ account }) => account.enabled !== false);
  if (!accounts.length) {
    console.log('No enabled Nostr accounts in data/nostr-accounts.json: nothing to do.');
    summary('## Nostr\n\n**Skipped:** no enabled Nostr accounts.\n');
    return 0;
  }
  const state = loadState();
  state.accounts ??= {};
  state.articles ??= {};
  state.redone ??= {};
  let code = 0;
  for (const a of accounts) {
    try {
      code = Math.max(code, (await runAccount(a, state)).code);
    } catch (e) {
      console.error(`ERROR (${a.id}): ${e.message}`);
      summary(`## Nostr: ${a.account.name} (${a.id})\n\n**FAILED:** ${e.message}\n`);
      code = 1;
    }
  }
  return code;
}

finish(await main());
