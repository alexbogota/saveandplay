// Tests for scripts/x-sheet.mjs and for the "x" channel of data/accounts.json. Run: npm run x:test
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { flatten, xLength, problemsOf, toCsv, merge, build } from './x-sheet.mjs';

process.env.DAILY_BRIEF_AS_MODULE = '1';
const { makePosts, withDefaults } = await import('./daily-brief.mjs');
const accountsFile = JSON.parse(await readFile(new URL('../data/accounts.json', import.meta.url), 'utf8'));

const POST = 'Hades: -75% at GOG\n$4.99 (was $19.99)\nPrice checked Oct 21. Sale ends Oct 25.\n\nhttps://saveandplay.com/deals/gog/hades/?utm_source=x-prices&utm_medium=social&utm_campaign=deals-2026-10-21\n\n#PCGaming #GOG\nAd';

test('flatten keeps the order, one line, ends with Ad', () => {
  const f = flatten(POST);
  assert.ok(!f.includes('\n'));
  assert.ok(f.startsWith('Hades: -75% at GOG | $4.99 (was $19.99) | Price checked Oct 21. Sale ends Oct 25. https://'));
  assert.ok(f.endsWith('#PCGaming #GOG Ad'));
});

test('X counts a link as 23 characters', () => {
  const f = flatten(POST);
  assert.equal(xLength('a https://saveandplay.com/deals/x/y/?utm_source=x-prices'), 2 + 23);
  assert.ok(xLength(f) < 280);
  assert.deepEqual(problemsOf(f), []);
});

test('problems: no Ad, foreign link, too long', () => {
  assert.ok(problemsOf(flatten(POST).replace(/ Ad$/, '')).length);
  assert.ok(problemsOf('x https://gog.com/game https://saveandplay.com/deals/a/b/ Ad').some((p) => /not ours/.test(p)));
  assert.ok(problemsOf('x '.repeat(200) + 'https://saveandplay.com/deals/a/b/ Ad').some((p) => /X allows/.test(p)));
});

test('csv quotes commas, quotes and keeps one row per post', () => {
  const csv = toCsv([{ day: '2026-10-21', account: 'prices', post: 'He said "hi", ok Ad', chars: 20 }]);
  assert.equal(csv, 'day,account,post,chars\n"2026-10-21","prices","He said ""hi"", ok Ad","20"\n');
});

test('merge replaces the same day and account, drops old days, newest first', () => {
  const old = [{ day: '2026-10-20', account: 'prices', post: 'a', chars: 1, order: 1 }, { day: '2026-10-21', account: 'prices', post: 'old run', chars: 1, order: 1 }, { day: '2026-10-01', account: 'prices', post: 'ancient', chars: 1, order: 1 }];
  const fresh = [{ day: '2026-10-21', account: 'prices', post: 'new run', chars: 1, order: 1 }, { day: '2026-10-21', account: 'cozy', post: 'c', chars: 1, order: 2 }];
  const r = merge(old, fresh, '2026-10-21');
  assert.deepEqual(r.map((x) => `${x.day} ${x.account} ${x.post}`), ['2026-10-21 prices new run', '2026-10-21 cozy c', '2026-10-20 prices a']);
});

test('build reads every account with an x channel and skips NO POST TODAY', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'xsheet-'));
  await writeFile(resolve(dir, 'post-prices-x.md'), POST + '\n');
  await writeFile(resolve(dir, 'post-cozy-x.md'), 'NO POST TODAY: no game fits\n');
  const { fresh, notes } = await build({ accountsFile: new URL('../data/accounts.json', import.meta.url).pathname, draftsDir: dir, today: '2026-10-21' });
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].account, 'prices');
  assert.ok(notes.some((n) => n.startsWith('cozy: NO POST TODAY')));
});

test('real accounts: the x channel makes a post that fits X for the main, second, Cozy and Retro accounts', () => {
  const links = { site: 'https://saveandplay.com' };
  const deal = { id: 'gog-hades', kind: 'deal', title: 'Hades', store: 'GOG', price: 4.99, was: 19.99, discount: 75, endsAt: '2026-10-25T23:59:00Z', priceCheckedAt: '2026-10-21T09:00:00.000Z', history: { days: 5, lowest: false }, whyToday: [], discountRank: 1, facts: { tags: ['Cozy'], genres: ['Farming'] } };
  for (const id of ['prices', 'prices-2', 'cozy', 'retro']) {
    const account = withDefaults(id, { ...accountsFile.accounts[id], channels: { x: accountsFile.accounts[id].channels.x } });
    assert.ok(account.channels.x, `${id} has an x channel`);
    const posts = makePosts({ id, account, brief: { candidates: [deal], warnings: [] }, links, now: Date.parse('2026-10-21T12:00:00Z') });
    const p = posts[0];
    assert.ok(!p.none, `${id}: ${p.none}`);
    const flat = flatten(p.text);
    assert.deepEqual(problemsOf(flat), [], `${id}: ${flat}`);
    assert.match(p.text, /utm_source=x-(prices|cozy|retro)/);
    assert.ok((p.text.match(/#\w+/g) ?? []).length <= 2, `${id}: at most 2 tags on X`);
  }
});
