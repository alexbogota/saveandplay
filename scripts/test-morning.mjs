// Tests for the one-command morning run (scripts/morning.mjs). No internet, no GitHub: the commands are replaced by fakes.
//   npm run morning:test
import test from 'node:test';
import assert from 'node:assert/strict';
import { stampNow, postSections, trimPosts, postsLine, trimStatus, trimLoad, morning, startAndWait } from './morning.mjs';

const SHOW = `
## 1. prices (@saveandplay.com)
   | Game A: -85% at GOG
   | $2.99 (was $19.99)
   | Ad
   link: https://saveandplay.com/deals/gog/a/
   OK: can be approved. Our page and the feed are checked again by the sender.

## 2. prices-2 (@saveandplay.com)
   | Game B: -90% at GOG
   | Ad
   link: https://saveandplay.com/deals/gog/b/
   PROBLEMS (cannot be approved): already posted (https://bsky.app/profile/x/post/1)

## 3. prices-kinguin (@saveandplay.com)
   NO POST TODAY: Off day.

Show the owner these posts EXACTLY as printed (the program posts only these texts). Approve: node scripts/post-bluesky.mjs approve --ok all
`;

const STATUS = `SENDING @saveandplay.com (prices: limit 30 in 24 h):
  Last run 2026-10-21 14:45 UTC: 3 sent.
  Sent in the last 24 h: 9. Approved and waiting: 0.
  QUALITY (counted 2026-10-21 13:12 UTC; our replies of the last 14 days that are older than 24 h): 96 replies, 42 with a like (44%).
  TOP replies (real ones that worked: match their spirit, never copy their words):
    likes 1, replies 2: "A thousand games, respect." (to @someone)
    likes 2, replies 1: "Yes, that's the idea." (to @other)
SENDING @cozygame.bsky.social (cozy: limit 30 in 24 h):
  Last run 2026-10-21 14:50 UTC: 1 sent.
`;

const COMMENTS = '==================== prices (@saveandplay.com) ====================\nNEW POSTS: 2\n\n==================== SAVE ====================\nbash scripts/comments-branch.sh save drafts/comments-shown-prices-S.json';

// a fake machine: `script` maps "cmd arg1 arg2" prefixes to a function or a fixed answer; every call is recorded
function fake(script) {
  const calls = [];
  const run = (cmd, args) => {
    const line = [cmd, ...args].join(' ');
    calls.push(line);
    const key = Object.keys(script).filter((k) => line.startsWith(k)).sort((a, b) => b.length - a.length)[0]; // the longest match wins
    if (!key) return { code: 1, out: `no fake for: ${line}` };
    const v = script[key];
    return typeof v === 'function' ? v(line) : v;
  };
  return { run, calls };
}
const ok = (out) => ({ code: 0, out });
const base = (extra = {}) => ({
  'bash scripts/comments-branch.sh load': ok('Loaded 137 files from the comments branch.\n'),
  'node scripts/post-bluesky.mjs show': ok(SHOW),
  'node scripts/comments-drafts.mjs status': ok(STATUS),
  'node scripts/comments-show.mjs --all': ok(COMMENTS),
  ...extra,
});
const noSleep = async () => {};

test('stampNow has the shape of date -u +%Y%m%d-%H%M%S', () => {
  assert.equal(stampNow(new Date('2026-10-21T15:30:45.123Z')), '20261021-153045');
});

test('postSections reads OK, PROBLEMS and NO POST TODAY', () => {
  assert.deepEqual(postSections(SHOW).map((s) => s.status), ['ok', 'problem', 'none']);
  assert.equal(postsLine(SHOW), 'POSTS: 1 can be approved, 1 with problems (prices-2), 1 no post today, of 3 items.');
});

test('trimPosts drops the link lines and the hint, keeps the post text exactly', () => {
  const t = trimPosts(SHOW);
  assert.ok(!t.includes('link:'));
  assert.ok(!t.includes('Show the owner these posts'));
  assert.ok(t.includes('   | Game A: -85% at GOG\n   | $2.99 (was $19.99)\n   | Ad'));
  assert.ok(t.includes('PROBLEMS (cannot be approved)'));
});

test('trimStatus keeps the sending lines and QUALITY, drops the TOP replies', () => {
  const t = trimStatus(STATUS);
  assert.ok(t.includes('Last run 2026-10-21 14:45 UTC: 3 sent.'));
  assert.ok(t.includes('QUALITY: 96 replies'));
  assert.ok(!t.includes('TOP replies'));
  assert.ok(!t.includes('A thousand games'));
  assert.ok(t.includes('SENDING @cozygame.bsky.social'));
});

test('trimLoad puts a message on one line', () => {
  assert.equal(trimLoad('Loaded 5 files.\n'), 'Loaded 5 files.');
});

test('a normal morning: four commands, one section each, nothing else started', async () => {
  const f = fake(base());
  const { text, code } = await morning(['--stamp', 'S1'], { run: f.run, sleep: noSleep });
  assert.equal(code, 0);
  assert.deepEqual(f.calls, [
    'bash scripts/comments-branch.sh load',
    'node scripts/post-bluesky.mjs show',
    'node scripts/comments-drafts.mjs status',
    'node scripts/comments-show.mjs --all --record-new-all S1',
  ]);
  for (const title of ['LOAD', 'POSTS', 'SENDING STATUS', 'COMMENTS', 'NEXT (the chat)']) assert.ok(text.includes(`===== ${title} =====`), title);
  assert.ok(text.includes('POSTS: 1 can be approved'));
  assert.ok(text.includes('bash scripts/comments-branch.sh save drafts/comments-shown-prices-S.json'));
  assert.ok(!/\bgh (run|workflow)/.test(text));
});

test('the wide mode passes --wide to the finder step', async () => {
  const f = fake(base());
  await morning(['--wide', '--stamp', 'S2'], { run: f.run, sleep: noSleep });
  assert.ok(f.calls.includes('node scripts/comments-show.mjs --all --wide --record-new-all S2'));
});

test('a stale list: the workflow is started once, waited for, the branch loaded again, then --partial', async () => {
  let listed = 0;
  const f = fake(base({
    'node scripts/comments-show.mjs --all --record-new-all': { code: 3, out: 'STALE LIST: no list for prices (stale). Nothing was shown.\nmore' },
    'node scripts/comments-show.mjs --all --partial --record-new-all': ok(COMMENTS),
    'gh run list': () => {
      listed++;
      if (listed === 1) return ok('[{"databaseId":10,"status":"completed","conclusion":"success"}]'); // before the start
      if (listed === 2) return ok('[{"databaseId":10,"status":"completed","conclusion":"success"}]'); // new run not listed yet
      if (listed === 3) return ok('[{"databaseId":11,"status":"in_progress","conclusion":""}]');
      return ok('[{"databaseId":11,"status":"completed","conclusion":"success"}]');
    },
    'gh workflow run': ok(''),
  }));
  const { text, code } = await morning(['--stamp', 'S3'], { run: f.run, sleep: noSleep });
  assert.equal(code, 0);
  assert.equal(f.calls.filter((c) => c.startsWith('gh workflow run')).length, 1);
  assert.equal(f.calls.filter((c) => c === 'bash scripts/comments-branch.sh load').length, 2);
  assert.ok(f.calls.at(-1).endsWith('--partial --record-new-all S3'));
  assert.ok(text.includes('STALE LIST: no list for prices'));
  assert.ok(text.includes('Loaded again:'));
  assert.ok(!text.includes('ACTION'));
});

test('a stale list and gh is refused: still runs with --partial and says what the owner must press', async () => {
  const f = fake(base({
    'node scripts/comments-show.mjs --all --record-new-all': { code: 2, out: 'NO LIST: no list for cozy (missing).' },
    'node scripts/comments-show.mjs --all --partial --record-new-all': ok(COMMENTS),
    'gh run list': { code: 1, out: 'HTTP 403' },
  }));
  const { text, code } = await morning(['--stamp', 'S4'], { run: f.run, sleep: noSleep });
  assert.equal(code, 0);
  assert.ok(!f.calls.some((c) => c.startsWith('gh workflow run')));
  assert.ok(text.includes('ACTION (tell the owner in Russian)'));
  assert.ok(text.includes('NEW POSTS: 2'));
});

test('--no-start never starts the workflow', async () => {
  const f = fake(base({
    'node scripts/comments-show.mjs --all --record-new-all': { code: 3, out: 'STALE LIST: x' },
    'node scripts/comments-show.mjs --all --partial --record-new-all': ok(COMMENTS),
  }));
  const { text } = await morning(['--no-start', '--stamp', 'S5'], { run: f.run, sleep: noSleep });
  assert.ok(!f.calls.some((c) => c.startsWith('gh ')));
  assert.ok(text.includes('not started (--no-start)'));
});

test('a failed workflow run shows the reason, never hangs', async () => {
  let listed = 0;
  const f = fake({
    'gh run list': () => (++listed === 1 ? ok('[{"databaseId":1,"status":"completed","conclusion":"success"}]') : ok('[{"databaseId":2,"status":"completed","conclusion":"failure"}]')),
    'gh workflow run': ok(''),
    'gh run view': ok('line1\nBad credentials\n'),
  });
  const res = await startAndWait({ run: f.run, sleep: noSleep, log: () => {} });
  assert.equal(res.ok, false);
  assert.ok(res.why.includes('failure') && res.why.includes('Bad credentials'));
});

test('a run that never ends stops after the wait', async () => {
  let listed = 0;
  const f = fake({
    'gh run list': () => (++listed === 1 ? ok('[{"databaseId":1,"status":"completed","conclusion":"success"}]') : ok('[{"databaseId":2,"status":"in_progress","conclusion":""}]')),
    'gh workflow run': ok(''),
  });
  const res = await startAndWait({ run: f.run, sleep: noSleep, log: () => {}, waitSeconds: 30, pollSeconds: 10 });
  assert.equal(res.ok, false);
  assert.ok(res.why.includes('did not end'));
});

test('a failing posts step is reported and the exit code is 1, the rest still runs', async () => {
  const f = fake(base({ 'node scripts/post-bluesky.mjs show': { code: 1, out: 'PROBLEM: no brief file.' } }));
  const { text, code } = await morning(['--stamp', 'S6'], { run: f.run, sleep: noSleep });
  assert.equal(code, 1);
  assert.ok(text.includes('FAILED (exit 1):\nPROBLEM: no brief file.'));
  assert.ok(text.includes('===== COMMENTS ====='));
});

test('a failing branch load is reported with a warning', async () => {
  const f = fake(base({ 'bash scripts/comments-branch.sh load': { code: 1, out: 'fetch failed' } }));
  const { text, code } = await morning(['--stamp', 'S7'], { run: f.run, sleep: noSleep });
  assert.equal(code, 1);
  assert.ok(text.includes('the old state could not be loaded'));
});
