// Posts ONE deal a day to Nostr, by a template: no AI, no API key. See PROJECT.md, section 11 ("Nostr").
//
//   node scripts/post-nostr.mjs                 post (only if "autopost" is true for the account in data/nostr-accounts.json)
//   node scripts/post-nostr.mjs --dry-run       show the note that would be posted, publish nothing, change nothing
//   node scripts/post-nostr.mjs --account nostr-cozy
//   GitHub -> Actions -> "Post to Nostr" (every day at 06:30 Bogota, after the daily brief; or Run workflow, mode dry-run or post)
//
// Where the note comes from: the FIRST deal of drafts/brief-<account>.json (the json of the daily brief, made by scripts/daily-brief.mjs;
// on GitHub it is read from the "brief" branch by scripts/nostr-branch.sh). The text is built from its numbers and dates only:
// game, discount, price, old price, store, "Price checked <date>", sale end date (if any), "Why today" (if the brief has it), #ad, picture address, link.
//
// One note a day per account: the record of what was posted is drafts/posted-nostr.json (on GitHub it lives on the "brief" branch, so the
// site is not rebuilt). Run it twice and the second run says "already posted today". As a second guard the relays are asked whether the
// account already has a note from the last 20 hours. A note that reached too few relays is sent again to all of them on the next run (the same note, not a new one).
//
// Exit code: 0 = posted or skipped (nothing to post is not an error), 1 = no relay accepted, too few accepted, or something is broken.
// The private key (secret NOSTR_NSEC) is only used to sign. It is never printed.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { file, readJson, nostrAccounts, loadRelayConfig, loadSecretKey, npubOf, getPublicKey, buildNote, signNote, verifyEvent, publishToAll, queryRelay, relayTable, summary, hoursSince, nip19, finish } from './lib/nostr.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const only = args.includes('--account') ? args[args.indexOf('--account') + 1] : null;
const NOW = process.env.NOSTR_NOW ? Date.parse(process.env.NOSTR_NOW) : Date.now(); // the variable is for tests only
const STATE = 'drafts/posted-nostr.json';
const KEEP_DAYS = 60;

const dayKey = (t, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t); // YYYY-MM-DD
const warn = (msg) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `WARNING: ${msg}`);
const fence = (text) => `\`\`\`\`text\n${text}\n\`\`\`\`\n`;

const loadState = () => readJson(STATE, { accounts: {} });
function saveState(state) {
  for (const days of Object.values(state.accounts)) {
    for (const d of Object.keys(days)) if ((NOW - Date.parse(d)) / 864e5 > KEEP_DAYS) delete days[d];
  }
  mkdirSync(dirname(file(STATE)), { recursive: true });
  writeFileSync(file(STATE), JSON.stringify(state, null, 2) + '\n');
}

// One account. Returns { code } (0 or 1).
async function runAccount({ id, account }, state) {
  const head = `## Nostr: ${account.name} (${id})\n\n`;
  const skip = (reason, isWarning = false) => {
    console.log(`Skipped (${id}): ${reason}`);
    if (isWarning) warn(`${id}: ${reason}`);
    summary(`${head}**Skipped:** ${reason}\n`);
    return { code: 0 };
  };

  const day = dayKey(NOW, account.timezone);
  const mine = (state.accounts[id] ??= {});
  const today = mine[day];

  if (!dryRun && !account.autopost) return skip('"autopost" is false for this account in data/nostr-accounts.json (waiting for the owner\'s ok). Nothing was posted.');

  const brief = readJson(`drafts/brief-${id}.json`, null);
  if (!brief) return skip(`there is no drafts/brief-${id}.json: the Daily brief did not make it (check the "Daily brief" workflow).`, true);
  const age = hoursSince(brief.generatedAt, NOW);
  if (!(age <= account.maxBriefAgeHours)) return skip(`the brief is ${Number.isFinite(age) ? Math.round(age) + ' h old' : 'of unknown age'}, the limit is ${account.maxBriefAgeHours} h. The Daily brief probably failed today.`, true);
  const c = brief.candidates?.[0];
  if (!c) return skip(`no deal passes the rules today.${brief.warnings?.length ? ' Brief says: ' + brief.warnings.join(' ') : ''}`);
  if (c.kind !== 'deal') return skip(`the first item of the brief is not a deal (${c.kind}).`);
  const priceAge = hoursSince(c.priceCheckedAt, NOW);
  if (!(priceAge <= account.maxPriceAgeHours)) return skip(`the price of "${c.title}" was checked ${Number.isFinite(priceAge) ? Math.round(priceAge) + ' h' : '?'} ago, the limit is ${account.maxPriceAgeHours} h. Not posting an old price.`, true);

  const note = buildNote(c, account);
  const sk = loadSecretKey(account.secretEnv);
  const npub = sk ? npubOf(sk) : /^npub1/.test(account.handle) ? account.handle : '(no key yet)';
  const textBlock = `**Text of the note:**\n\n${fence(note.content)}\nTags: \`${JSON.stringify(note.tags)}\`\n\n- Account: \`${npub}\` ([profile](https://njump.me/${npub}))\n- Deal: ${c.title} (${c.store}), brief of ${brief.generatedAt}\n`;

  console.log(`\n${account.name} (${id}), ${npub}\nDeal: ${c.title}, ${c.store}\n\n----- note -----\n${note.content}\n----------------\ntags: ${JSON.stringify(note.tags)}`);

  if (dryRun) {
    let extra = '';
    if (today?.status === 'done') extra = `\nNote: a note was already posted today (${today.id}); a real run would be skipped.\n`;
    else if (!account.autopost) extra = '\nNote: "autopost" is false, so a real run is skipped until the owner switches it on in data/nostr-accounts.json.\n';
    if (extra) console.log(extra.trim());
    summary(`${head}**Dry run: nothing was published.**\n\n${textBlock}${extra}`);
    return { code: 0 };
  }

  if (!sk) {
    console.error(`ERROR (${id}): no private key (${account.secretEnv}). Add it as a GitHub Secret: npm run nostr:secret.`);
    summary(`${head}**FAILED:** no private key (${account.secretEnv}).\n`);
    return { code: 1 };
  }
  if (today?.status === 'done') return skip(`already posted today (${dayKey(NOW, account.timezone)}): note ${today.id}. One note a day.`);

  const relays = loadRelayConfig();
  const pk = getPublicKey(sk);
  let event;
  let again = false;

  if (today?.status === 'partial') {
    // Posted earlier but too few relays took it: send the SAME note again, do not make a second one.
    event = today.event;
    if (!event || !verifyEvent(event) || event.pubkey !== pk) throw new Error(`The saved note of ${day} does not verify. Check drafts/posted-nostr.json.`);
    again = true;
    console.log(`The note of today reached only ${today.accepted.length} relay(s) earlier: sending the same note (${event.id}) again.`);
  } else {
    // Second guard: does the account already have a note from the last 20 hours on the relays?
    const found = (await Promise.all(relays.urls.map((u) => queryRelay(u, { authors: [pk], kinds: [1], '#t': ['ad'], since: Math.floor(NOW / 1000) - 20 * 3600, limit: 5 }, Math.min(relays.timeoutMs, 6000))))).flat().filter(Boolean);
    if (found.length) {
      const ev = found.sort((a, b) => b.created_at - a.created_at)[0];
      mine[day] = { status: 'done', id: ev.id, npub, foundOnRelay: true, postedAt: new Date(ev.created_at * 1000).toISOString() };
      saveState(state);
      return skip(`the relays already have a note of this account from the last 20 hours (${ev.id}). One note a day.`);
    }
    event = signNote(note, sk, NOW);
    if (!verifyEvent(event)) throw new Error('The signed note does not verify. Not published.');
  }

  const results = await publishToAll(event, relays.urls, relays.timeoutMs);
  const accepted = results.filter((r) => r.ok);
  const status = accepted.length >= relays.minAccepted ? 'done' : accepted.length > 0 ? 'partial' : 'failed';
  if (status !== 'failed') {
    mine[day] = { status, id: event.id, npub, deal: c.id, title: c.title, postedAt: new Date(event.created_at * 1000).toISOString(), accepted: accepted.map((r) => r.url), failed: results.filter((r) => !r.ok).map((r) => ({ url: r.url, reason: r.reason })), event };
    saveState(state);
  }

  const nevent = nip19.neventEncode({ id: event.id, relays: accepted.slice(0, 2).map((r) => r.url), author: pk, kind: 1 });
  console.log(`\nRelays: ${accepted.length} of ${results.length} accepted (needed ${relays.minAccepted}).`);
  for (const r of results) console.log(`  ${r.ok ? 'accepted ' : 'REJECTED '} ${r.url} (${r.ms} ms)${r.reason ? ' - ' + r.reason : ''}`);
  console.log(`Note id: ${event.id}\nSee it: https://njump.me/${nevent}`);
  const verdict = status === 'done' ? `**Posted${again ? ' again (same note)' : ''}.**` : status === 'partial' ? `**Only ${accepted.length} relay(s) accepted the note, ${relays.minAccepted} needed.** The same note will be sent again at the next run (press Run workflow, mode post).` : '**FAILED: no relay accepted the note.** Nothing was posted. Check data/nostr-relays.json (GitHub -> Actions -> Post to Nostr -> mode check).';
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
