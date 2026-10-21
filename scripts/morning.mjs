// The whole reading part of the morning run («день saveandplay») in ONE command, with a short combined result. See docs/morning-saveandplay.md.
//
//   node scripts/morning.mjs                 normal day: posts + guide + comments of every account
//   node scripts/morning.mjs --wide          the comments in the wide mode («день saveandplay 2»)
//   node scripts/morning.mjs --stamp STAMP   use this STAMP in the names of the shown files (default: now, UTC, YYYYMMDD-HHMMSS)
//   node scripts/morning.mjs --no-start      never start the workflow «Comment candidates» by itself (only say that the list is stale)
//
// It does what used to be 4-6 commands with long output:
//   1. bash scripts/comments-branch.sh load                 (one line is kept)
//   2. node scripts/post-bluesky.mjs show                   (the posts exactly as printed; the repeated "link:" lines and the hint are dropped)
//   3. node scripts/comments-drafts.mjs status              (only the sending lines and QUALITY; the TOP replies are in the skill)
//   4. node scripts/comments-show.mjs --all [--wide] --record-new-all STAMP
//      STALE LIST / NO LIST (exit 3 or 2, nothing shown or remembered): starts the workflow «Comment candidates» ONCE, waits for it to end (up to 6 minutes),
//      loads the branch again and runs the step with --partial (an account without a usable list is named and skipped). If gh is refused or the run fails,
//      it still runs with --partial and says in the line «ACTION» what the owner must press.
// It changes nothing outside this folder (the files of the "shown" memory in drafts/) except that start of the workflow. It posts and approves nothing.
// The reply drafts (comments-drafts.mjs new), the SAVE command and the owner's «ок» stay the chat's job.
// Exit code: 0 all parts read, 1 a part failed (the part says so under its title).

import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO = 'alexbogota/saveandplay';
const WORKFLOW = 'Comment candidates';

// 20261021-153045, the same shape as `date -u +%Y%m%d-%H%M%S`
export const stampNow = (d = new Date()) => d.toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-');

// the output of `post-bluesky.mjs show`: sections "## N. title" with the lines of the post, OK / PROBLEMS / NO POST TODAY
export function postSections(text) {
  const parts = String(text).split(/^(?=## \d+\. )/m).filter((p) => /^## \d+\. /.test(p));
  return parts.map((p) => ({
    title: p.split('\n')[0].replace(/^## \d+\. /, '').trim(),
    status: /^\s+PROBLEMS /m.test(p) ? 'problem' : /^\s+NO POST TODAY/m.test(p) ? 'none' : /^\s+OK:/m.test(p) ? 'ok' : 'unknown',
  }));
}

export function trimPosts(text) {
  const lines = String(text).split('\n').filter((l) => !/^ {3}link: /.test(l) && !/^Show the owner these posts EXACTLY/.test(l));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function postsLine(text) {
  const s = postSections(text);
  const n = (k) => s.filter((x) => x.status === k).length;
  const bad = s.filter((x) => x.status === 'problem').map((x) => x.title.split(' ')[0]);
  return `POSTS: ${n('ok')} can be approved, ${n('problem')} with problems${bad.length ? ` (${bad.join(', ')})` : ''}, ${n('none')} no post today, of ${s.length} items.`;
}

// the output of `comments-drafts.mjs status`: keep SENDING / Last run / Sent in the last 24 h / QUALITY, drop the TOP replies
export function trimStatus(text) {
  return String(text).split('\n')
    .filter((l) => l.trim() && !/^\s*TOP replies/.test(l) && !/^\s+likes \d+, replies \d+:/.test(l))
    .map((l) => (/^\s*QUALITY/.test(l) ? l.replace(/\s*\(counted [^)]*\)/, '').replace(/ our replies of the last 14 days that are older than 24 h/, '') : l))
    .join('\n');
}

// "Loaded 137 files from the comments branch." -> kept as is; anything else (errors) is kept whole
export const trimLoad = (text) => String(text).trim().split('\n').filter(Boolean).join(' ');

// what the owner must press when the workflow could not be started or did not finish
export const ACTION = 'ACTION (tell the owner in Russian): press Actions, "Comment candidates", Run workflow on GitHub (one tap), wait about two minutes, then say the phrase again. Until then the accounts named SKIPPED have no new posts.';

export function realRun(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const realSleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

// Starts the workflow and waits for ITS run (a run newer than the newest one seen before). Returns { ok, why }.
export async function startAndWait({ run, sleep, log, waitSeconds = 360, pollSeconds = 10 }) {
  const list = () => {
    const r = run('gh', ['run', 'list', '-R', REPO, '--workflow', WORKFLOW, '--limit', '1', '--json', 'databaseId,status,conclusion']);
    if (r.code !== 0) return null;
    try { return JSON.parse(r.out)[0] ?? { databaseId: 0 }; } catch { return null; }
  };
  const before = list();
  if (!before) return { ok: false, why: 'gh could not list the runs (no permission?)' };
  const start = run('gh', ['workflow', 'run', WORKFLOW, '-R', REPO, '--ref', 'main']);
  if (start.code !== 0) return { ok: false, why: `gh could not start the workflow: ${start.out.trim().split('\n').slice(-2).join(' ')}` };
  log(`Started the workflow "${WORKFLOW}", waiting for it to end.`);
  for (let waited = 0; waited <= waitSeconds; waited += pollSeconds) {
    await sleep(pollSeconds);
    const now = list();
    if (!now || now.databaseId === before.databaseId) continue; // the new run is not listed yet
    if (now.status === 'completed') {
      if (now.conclusion === 'success') return { ok: true };
      const why = run('gh', ['run', 'view', String(now.databaseId), '-R', REPO, '--log-failed']).out.trim().split('\n').slice(-20).join('\n');
      return { ok: false, why: `the workflow ended in ${now.conclusion}:\n${why}` };
    }
  }
  return { ok: false, why: `the workflow did not end in ${Math.round(waitSeconds / 60)} minutes` };
}

// The whole morning. Returns { text, code }; deps can be replaced in tests.
export async function morning(argv = [], deps = {}) {
  const run = deps.run ?? realRun;
  const sleep = deps.sleep ?? realSleep;
  const lines = [];
  const log = (s) => lines.push(s);
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
  const wide = argv.includes('--wide');
  const noStart = argv.includes('--no-start');
  const stamp = arg('--stamp') ?? stampNow();
  let code = 0;
  const part = (title, body) => { log(`\n===== ${title} =====`); log(body); };

  log(`MORNING RUN (${wide ? 'wide mode' : 'normal'}), STAMP ${stamp}`);

  // 1. the state of earlier runs from the comments branch
  const load = run('bash', ['scripts/comments-branch.sh', 'load']);
  part('LOAD', trimLoad(load.out) + (load.code ? `\nFAILED (exit ${load.code}): the old state could not be loaded; the posts below may repeat earlier ones.` : ''));
  if (load.code) code = 1;

  // 2. the posts of the day and the guide post
  const posts = run('node', ['scripts/post-bluesky.mjs', 'show']);
  if (posts.code) { code = 1; part('POSTS', `FAILED (exit ${posts.code}):\n${posts.out.trim()}`); }
  else part('POSTS', `${postsLine(posts.out)}\n${trimPosts(posts.out)}\nApprove (after «ок»): node scripts/post-bluesky.mjs approve --ok all`);

  // 3. what the sender did last time and the room in the daily limit
  const status = run('node', ['scripts/comments-drafts.mjs', 'status']);
  part('SENDING STATUS', status.code ? `FAILED (exit ${status.code}):\n${status.out.trim()}` : trimStatus(status.out));

  // 4. the comments of every account
  const showArgs = (partial) => ['scripts/comments-show.mjs', '--all', ...(wide ? ['--wide'] : []), ...(partial ? ['--partial'] : []), '--record-new-all', stamp];
  let shown = run('node', showArgs(false));
  let note = '';
  if (shown.code === 2 || shown.code === 3) {
    const first = shown.out.trim().split('\n')[0];
    note = `${first}\n`;
    let res = { ok: false, why: 'not started (--no-start)' };
    if (!noStart) res = await startAndWait({ run, sleep, log: (s) => { note += `${s}\n`; }, waitSeconds: deps.waitSeconds, pollSeconds: deps.pollSeconds });
    if (res.ok) { const again = run('bash', ['scripts/comments-branch.sh', 'load']); note += `Loaded again: ${trimLoad(again.out)}\n`; }
    else note += `The list could not be refreshed: ${res.why}\n${ACTION}\n`;
    shown = run('node', showArgs(true));
  }
  if (shown.code) { code = 1; part('COMMENTS', `${note}FAILED (exit ${shown.code}):\n${shown.out.trim()}`); }
  else part('COMMENTS', `${note}${shown.out.trim()}`);

  log('\n===== NEXT (the chat) =====');
  log('Write the replies of each account that has new posts (drafts through `node scripts/comments-drafts.mjs new --account ACCOUNT --stamp ' + stamp + ' --in FILE`), run the SAVE command above with the drafts files added, then ONE message to the owner.');
  return { text: lines.join('\n'), code };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { text, code } = await morning(process.argv.slice(2));
  console.log(text);
  process.exit(code);
}
