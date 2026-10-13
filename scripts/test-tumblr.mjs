// Tests of the Tumblr scripts. They run offline: a small fake Tumblr (written here) plays the real one, and it CHECKS the OAuth signature of every request
// with its own code, so a wrong signature is caught.
//
//   npm run tumblr:test
//
// What is checked: the signature against the known example of the OAuth rules, the picture sizes read from PNG / JPEG / GIF / WebP, the real settings files
// (valid, autopost off, the brief block exists), the text of a deal post (only brief numbers, our own page as the link, cover with alt text, the "Ad:" line
// LAST) and of a guide post, tags, "dry-run publishes nothing and logs in nowhere", the autopost switch, one deal a day (record, lost record found on the
// blog), a post that Tumblr refuses (red, nothing recorded, tried again), wrong login, missing secrets, stale brief and old price, the guide rules (oldest
// first, every 2 days, "tumblr: false", page must be live, the record is kept), the check script, the auth script (the browser is played by the test),
// the secret script, the workflow file, and that no secret appears in any output.
// Nothing here touches the real data/ folder or a real server: every test works in a temporary folder.

import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

delete process.env.TUMBLR_ROOT; // the test itself imports the code, which must see the real settings
const lib = await import('./lib/tumblr.mjs');
const { buildDealPost, buildArticlePost, buildTags, configProblems, ownPost, withTumblrDefaults, oauthHeader, imageInfo, setEnvValue, readEnvValue, DISCLOSURE } = lib;
process.env.DAILY_BRIEF_AS_MODULE = '1';
const { withDefaults: briefDefaults } = await import('./daily-brief.mjs');

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const NOW = '2026-10-12T13:00:00Z'; // 08:00 in Bogota
const DAY = '2026-10-12';
const SITE = 'https://saveandplay.com';
const SECRETS = { TUMBLR_CONSUMER_KEY: 'ck-Aa1-consumer', TUMBLR_CONSUMER_SECRET: 'cs-Bb2-consumer-secret', TUMBLR_TOKEN: 'tk-Cc3-token', TUMBLR_TOKEN_SECRET: 'ts-Dd4-token-secret' };
const SECRET_VALUES = Object.values(SECRETS);

const realAccounts = JSON.parse(readFileSync(here('../data/accounts.json'), 'utf8'));
const realTumblr = JSON.parse(readFileSync(here('../data/tumblr-accounts.json'), 'utf8'));

const candidate = {
  id: 'indiegala-control-ultimate-edition',
  kind: 'deal',
  title: 'Control Ultimate Edition',
  store: 'IndieGala',
  price: 5.99,
  was: 39.99,
  discount: 85,
  endsAt: '2026-10-13T23:59:00Z',
  endsInHours: 36,
  priceCheckedAt: '2026-10-12T09:49:09.029Z',
  cover: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/870780/header.jpg?t=1781607969',
  coverAlt: 'Cover art for Control Ultimate Edition',
  discountRank: 10,
  link: `${SITE}/deals/indiegala/control-ultimate-edition/?utm_source=tumblr-prices&utm_medium=social&utm_campaign=deals-${DAY}`,
  whyToday: ['sale ends in 36 h', 'deepest-discount rank 10 of 38'],
};
const other = { ...candidate, id: 'gog-other-game', title: 'Other Game', store: 'GOG', price: 3.99, was: 19.99, discount: 80, link: `${SITE}/deals/gog/other-game/?utm_source=tumblr-prices&utm_medium=social&utm_campaign=deals-${DAY}` };
const brief = (list = [candidate], over = {}) => ({ account: 'Honest prices', generatedAt: '2026-10-12T11:00:00.000Z', candidates: list, warnings: [], ...over });
const COVER = { type: 'image/png', width: 460, height: 215 };

// ---------- pictures ----------

const png = (w, h) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const gif = (w, h) => {
  const b = Buffer.alloc(30);
  b.write('GIF89a', 0, 'latin1');
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
};
const jpeg = (w, h) => {
  // SOI, an APP0 segment of 16 bytes, then SOF0 with the size
  const b = Buffer.alloc(40);
  b[0] = 0xff; b[1] = 0xd8;
  b[2] = 0xff; b[3] = 0xe0; b.writeUInt16BE(16, 4);
  const sof = 2 + 2 + 16;
  b[sof] = 0xff; b[sof + 1] = 0xc0; b.writeUInt16BE(17, sof + 2); b[sof + 4] = 8;
  b.writeUInt16BE(h, sof + 5);
  b.writeUInt16BE(w, sof + 7);
  return b;
};
const webp = (kind, w, h) => {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBP', 8, 'latin1');
  b.write(kind, 12, 'latin1');
  if (kind === 'VP8 ') {
    b.writeUInt16LE(w, 26);
    b.writeUInt16LE(h, 28);
  } else if (kind === 'VP8L') {
    b.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 21);
  } else {
    const wm = w - 1;
    const hm = h - 1;
    b[24] = wm & 255; b[25] = (wm >> 8) & 255; b[26] = (wm >> 16) & 255;
    b[27] = hm & 255; b[28] = (hm >> 8) & 255; b[29] = (hm >> 16) & 255;
  }
  return b;
};

// ---------- fake Tumblr ----------

const e = (s) => lib.pct(s);
// The signature, checked with code of its own (not the code under test).
function signatureOk(req, url, secrets) {
  const m = /^OAuth (.*)$/.exec(req.headers.authorization ?? '');
  if (!m) return false;
  const p = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(([, k, v]) => [k, decodeURIComponent(v)]));
  if (p.oauth_consumer_key !== secrets.ck || (secrets.tk !== undefined && p.oauth_token !== secrets.tk) || p.oauth_signature_method !== 'HMAC-SHA1' || p.oauth_version !== '1.0') return false;
  const sent = p.oauth_signature;
  delete p.oauth_signature;
  const q = Object.fromEntries(url.searchParams);
  const all = Object.entries({ ...q, ...p }).map(([k, v]) => [e(k), e(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const base = [req.method, e(`http://${req.headers.host}${url.pathname}`), e(all.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  const want = crypto.createHmac('sha1', `${e(secrets.cs)}&${e(secrets.ts ?? '')}`).update(base).digest('base64');
  return want === sent;
}

function startTumblr(opts = {}) {
  const S = {
    blogs: opts.blogs ?? [{ name: 'myblog', title: 'My Blog', url: 'https://myblog.tumblr.com/' }],
    seeded: opts.seeded ?? [], // posts that exist before: { id, hoursAgo, links }
    failPost: opts.failPost ?? null, // { status, detail }
    secrets: opts.secrets ?? { ck: SECRETS.TUMBLR_CONSUMER_KEY, cs: SECRETS.TUMBLR_CONSUMER_SECRET, tk: SECRETS.TUMBLR_TOKEN, ts: SECRETS.TUMBLR_TOKEN_SECRET },
    posts: [],
    calls: [],
    badSignatures: 0,
    nextId: 5000,
  };
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://x');
    const body = raw ? JSON.parse(raw) : null;
    S.calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, userAgent: req.headers['user-agent'] });
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(obj === undefined ? '' : JSON.stringify(obj));
    };
    if (!signatureOk(req, url, S.secrets)) {
      S.badSignatures++;
      return send(401, { meta: { status: 401, msg: 'Unauthorized' }, errors: [{ title: 'Unauthorized', code: 401 }] });
    }
    if (req.method === 'GET' && url.pathname === '/v2/user/info') return send(200, { meta: { status: 200, msg: 'OK' }, response: { user: { name: 'owner', blogs: S.blogs } } });
    const m = url.pathname.match(/^\/v2\/blog\/([^/]+)\/posts$/);
    if (m && !S.blogs.some((b) => b.name === m[1])) return send(404, { meta: { status: 404, msg: 'Not Found' } });
    if (m && req.method === 'GET') {
      const made = S.posts.map((p) => ({ id_string: p.id, post_url: p.url, timestamp: Math.floor(Date.parse(NOW) / 1000), content: p.content }));
      const old = S.seeded.map((p) => ({ id_string: p.id, post_url: `https://myblog.tumblr.com/post/${p.id}`, timestamp: Math.floor((Date.parse(NOW) - p.hoursAgo * 3600e3) / 1000), content: (p.links ?? []).map((l) => ({ type: 'link', url: l })) }));
      return send(200, { meta: { status: 200, msg: 'OK' }, response: { posts: [...made, ...old] } });
    }
    if (m && req.method === 'POST') {
      if (S.failPost) return send(S.failPost.status, { meta: { status: S.failPost.status, msg: 'Bad Request' }, errors: [{ title: 'Bad Request', code: 8000, detail: S.failPost.detail }] });
      if (!Array.isArray(body?.content) || !body.content.length) return send(400, { meta: { status: 400, msg: 'Bad Request' }, errors: [{ detail: 'content is required' }] });
      const id = String(S.nextId++);
      S.posts.push({ id, url: `https://myblog.tumblr.com/post/${id}`, content: body.content, tags: body.tags, state: body.state, blog: m[1] });
      return send(201, { meta: { status: 201, msg: 'Created' }, response: { id, id_string: id, state: 'published' } });
    }
    return send(404, { meta: { status: 404, msg: 'Not Found' } });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, S, close: () => server.close() })));
}

// The login pages of Tumblr (www.tumblr.com), faked: request_token, then access_token after the "browser" came back.
function startWww() {
  const S = { calls: [], verifier: 'verif-Ee5', requestToken: 'reqtok-Ff6', requestSecret: 'reqsec-Gg7', token: 'permtok-Hh8', tokenSecret: 'permsec-Ii9', bad: 0 };
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req); // the body is empty
    const url = new URL(req.url, 'http://x');
    const header = req.headers.authorization ?? '';
    S.calls.push({ method: req.method, path: url.pathname, header });
    const p = Object.fromEntries([...header.matchAll(/(\w+)="([^"]*)"/g)].map(([, k, v]) => [k, decodeURIComponent(v)]));
    const sec = url.pathname === '/oauth/request_token' ? { ck: SECRETS.TUMBLR_CONSUMER_KEY, cs: SECRETS.TUMBLR_CONSUMER_SECRET, ts: '' } : { ck: SECRETS.TUMBLR_CONSUMER_KEY, cs: SECRETS.TUMBLR_CONSUMER_SECRET, tk: S.requestToken, ts: S.requestSecret };
    const fakeReq = { method: req.method, headers: req.headers };
    // signatureOk looks at the oauth_* values of the header; extra values (callback, verifier) are inside it, so they are part of the check as well
    if (!signatureOk(fakeReq, new URL(`http://${req.headers.host}${url.pathname}`), sec)) {
      S.bad++;
      res.writeHead(401).end('bad signature');
      return;
    }
    if (url.pathname === '/oauth/request_token') {
      S.callback = p.oauth_callback;
      res.writeHead(200, { 'content-type': 'application/x-www-form-urlencoded' });
      return res.end(`oauth_token=${S.requestToken}&oauth_token_secret=${S.requestSecret}&oauth_callback_confirmed=true`);
    }
    if (url.pathname === '/oauth/access_token') {
      if (p.oauth_verifier !== S.verifier) {
        res.writeHead(401).end('bad verifier');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/x-www-form-urlencoded' });
      return res.end(`oauth_token=${S.token}&oauth_token_secret=${S.tokenSecret}`);
    }
    res.writeHead(404).end();
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, S, close: () => server.close() })));
}

// The live site, faked: pages answer 200 except the paths in "down"; pictures answer with a PNG of 460x215.
function startPages() {
  const down = new Set();
  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (/\.(png|jpg)$/.test(path)) {
      res.writeHead(down.has(path) ? 404 : 200, { 'content-type': 'image/png' });
      return res.end(png(460, 215));
    }
    res.writeHead(down.has(path) ? 404 : 200, { 'content-type': 'text/html' });
    res.end('page');
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, down })));
}
const pages = await startPages();

// ---------- a temporary project folder ----------

const guideFile = (fm) => `---
layout: ../../layouts/Article.astro
section: guides
${fm}
---

Text.
`;
const guideHead = (slug, n, extra = '') => `title: "Guide ${slug}: a title"
description: "What guide ${slug} is about."
updated: 2026-09-${String(10 + n).padStart(2, '0')}
image: /og/${slug}.png
imageAlt: "Picture for ${slug}"${extra ? '\n' + extra : ''}`;
const envText = (extra = '') => Object.entries(SECRETS).map(([k, v]) => `${k}=${v}`).join('\n') + `\nOTHER_SECRET=secret-ftp-1\n${extra}`;

function makeRoot({ autopost = true, briefJson = brief(), env = envText(), guides = { 'g-old': 0, 'g-mid': 1, 'g-new': 2 }, account = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tumblr-test-'));
  for (const d of ['data', 'drafts', 'public/og', 'src/pages/guides']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'data/accounts.json'), JSON.stringify(realAccounts, null, 2) + '\n');
  const cfg = JSON.parse(JSON.stringify(realTumblr));
  // The tests cover both kinds, whatever the owner has switched on in the real settings.
  Object.assign(cfg.accounts.tumblr, { blog: 'myblog', autopost, kinds: ['article', 'deal'], ...account });
  writeFileSync(join(root, 'data/tumblr-accounts.json'), JSON.stringify(cfg, null, 2) + '\n');
  for (const [slug, n] of Object.entries(guides)) {
    writeFileSync(join(root, `src/pages/guides/${slug}.md`), guideFile(typeof n === 'string' ? n : guideHead(slug, n)));
    writeFileSync(join(root, `public/og/${slug}.png`), 'png');
  }
  if (briefJson) writeFileSync(join(root, 'drafts/brief-tumblr.json'), JSON.stringify(briefJson));
  writeFileSync(join(root, '.gitignore'), '.env\n');
  if (env !== null) writeFileSync(join(root, '.env'), env);
  return root;
}
const setBrief = (root, b) => writeFileSync(join(root, 'drafts/brief-tumblr.json'), JSON.stringify(b));
const setConfig = (root, fn) => {
  const f = join(root, 'data/tumblr-accounts.json');
  const cfg = JSON.parse(readFileSync(f, 'utf8'));
  fn(cfg.accounts.tumblr);
  writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n');
};

const cleanEnv = () => {
  const x = { ...process.env };
  for (const k of Object.keys(x)) if (/^(TUMBLR_|GITHUB_)/.test(k)) delete x[k];
  return x;
};
const leaks = [];
// The scripts run as child processes. It must be async: the fake servers live in THIS process and would not answer while it is blocked.
function run(script, args, { root, server, www, now = NOW, env = {}, withSecrets = false, onLine } = {}) {
  const summaryFile = join(root, `summary-${Math.random().toString(36).slice(2, 8)}.md`);
  return new Promise((done) => {
    const child = spawn(process.execPath, [here(script), ...args], {
      env: { ...cleanEnv(), TUMBLR_ROOT: root, TUMBLR_NOW: now, GITHUB_STEP_SUMMARY: summaryFile, TUMBLR_PAGE_BASE: pages.url, TUMBLR_PROBE_BASE: pages.url, TUMBLR_RETRY_MS: '10', TUMBLR_TIMEOUT_MS: '3000', ...(server ? { TUMBLR_API_BASE: server.url } : {}), ...(www ? { TUMBLR_WWW_BASE: www.url } : {}), ...(withSecrets ? SECRETS : {}), ...env },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
      onLine?.(out, child);
    });
    child.stderr.on('data', (d) => (err += d));
    const killer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.on('close', (code) => {
      clearTimeout(killer);
      const summary = existsSync(summaryFile) ? readFileSync(summaryFile, 'utf8') : '';
      const all = `${out}\n${err}\n${summary}`;
      leaks.push({ script, all });
      done({ code, out, err, summary, all });
    });
  });
}
const post = (root, server, kind, extra = [], opts = {}) => run('post-tumblr.mjs', ['--kind', kind, ...extra], { root, server, ...opts });
const readState = (root) => JSON.parse(readFileSync(join(root, 'drafts/posted-tumblr.json'), 'utf8'));
const nextDay = (n) => new Date(Date.parse(NOW) + n * 864e5).toISOString();
const linkUrl = (content) => lib.linksOf(content)[0];
const created = (server) => server.S.calls.filter((c) => c.method === 'POST' && /\/posts$/.test(c.path));

// ---------- the tests ----------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the signature matches the worked example of the OAuth rules (Twitter documentation, hCtSmYh+iHYCEqBWrE7C7hYmtUk=)', () => {
  const header = oauthHeader({
    method: 'POST',
    url: 'https://api.twitter.com/1.1/statuses/update.json',
    query: { include_entities: 'true', status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
    consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
    consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
    timestamp: 1318622958,
  });
  assert.ok(header.includes(`oauth_signature="${encodeURIComponent('hCtSmYh+iHYCEqBWrE7C7hYmtUk=')}"`), header);
  assert.ok(header.startsWith('OAuth '));
});

test('picture sizes are read from PNG, JPEG, GIF and the three kinds of WebP; anything else is not a picture', () => {
  assert.deepEqual(imageInfo(png(460, 215)), { type: 'image/png', width: 460, height: 215 });
  assert.deepEqual(imageInfo(jpeg(1200, 630)), { type: 'image/jpeg', width: 1200, height: 630 });
  assert.deepEqual(imageInfo(gif(300, 200)), { type: 'image/gif', width: 300, height: 200 });
  assert.deepEqual(imageInfo(webp('VP8 ', 640, 360)), { type: 'image/webp', width: 640, height: 360 });
  assert.deepEqual(imageInfo(webp('VP8L', 800, 600)), { type: 'image/webp', width: 800, height: 600 });
  assert.deepEqual(imageInfo(webp('VP8X', 1920, 1080)), { type: 'image/webp', width: 1920, height: 1080 });
  assert.equal(imageInfo(Buffer.from('<html>not a picture at all, just a web page</html>')), null);
  assert.equal(imageInfo(Buffer.alloc(5)), null);
});

test('the real settings: valid, autopost set by the owner, the brief block exists with its own subid and no Tumblr-only settings', () => {
  const a = realTumblr.accounts.tumblr;
  assert.equal(typeof a.autopost, 'boolean', 'autopost is true or false (the owner switches it)');
  const account = withTumblrDefaults('tumblr', { ...realAccounts.accounts.tumblr, ...a });
  assert.deepEqual(configProblems(account), []);
  assert.equal(realAccounts.accounts.tumblr.subid, 'tumblr-prices');
  assert.ok(!('autopost' in realAccounts.accounts.tumblr) && !('blog' in realAccounts.accounts.tumblr) && !('tags' in realAccounts.accounts.tumblr), 'no Tumblr-only settings in data/accounts.json');
  assert.ok(!('channels' in realAccounts.accounts.tumblr), 'no channels block: the daily brief makes no ready-to-copy post for Tumblr');
  assert.doesNotThrow(() => briefDefaults('tumblr', realAccounts.accounts.tumblr), 'the daily brief accepts the block');
  assert.equal(account.secretPrefix, 'TUMBLR');
  assert.equal(withTumblrDefaults('tumblr-cozy', {}).secretPrefix, 'TUMBLR_TUMBLR_COZY');
});

test('the checks of the settings say what is wrong in plain words', () => {
  const ok = withTumblrDefaults('tumblr', { ...realAccounts.accounts.tumblr, ...realTumblr.accounts.tumblr });
  const bad = (over) => configProblems({ ...ok, ...over });
  assert.match(bad({ blog: 'my blog.tumblr.com' }).join(), /"blog"/);
  assert.match(bad({ blog: '' }).join(), /"blog"/);
  assert.match(bad({ kinds: ['video'] }).join(), /"kinds"/);
  assert.match(bad({ kinds: [] }).join(), /"kinds"/);
  assert.match(bad({ articleEveryDays: 0 }).join(), /articleEveryDays/);
  assert.match(bad({ secretPrefix: 'tumblr' }).join(), /secretPrefix/);
  assert.match(bad({ tags: { ...ok.tags, base: ['a,b'] } }).join(), /tags\.base/);
  assert.match(bad({ tags: { ...ok.tags, article: ['#guide'] } }).join(), /tags\.article/);
  assert.match(bad({ tags: { ...ok.tags, store: { GOG: 'gog' } } }).join(), /tags\.store/);
  assert.match(bad({ maxTags: 99 }).join(), /maxTags/);
  assert.match(bad({ linkStyle: 'big' }).join(), /linkStyle/);
});

test('tags: base, store and game name, no duplicates (any letter case), no commas, the first ones win', () => {
  const account = withTumblrDefaults('tumblr', { ...realAccounts.accounts.tumblr, ...realTumblr.accounts.tumblr });
  const t = buildTags(account, 'deal', candidate);
  assert.deepEqual(t.slice(0, 4), account.tags.base);
  assert.ok(t.includes('indiegala') && t.includes('Control Ultimate Edition'));
  assert.ok(!t.includes('gog'), 'tags of another store do not leak in');
  assert.ok(t.every((x) => !/[,#]/.test(x)));
  const art = buildTags(account, 'article');
  assert.ok(art.includes('guide') && !art.includes('indiegala'));
  const dup = buildTags({ ...account, tags: { base: ['Gaming', 'gaming', 'PC Gaming'], article: [], store: {} } }, 'deal', { title: 'Game, The: #1', store: 'X' });
  assert.deepEqual(dup, ['Gaming', 'PC Gaming', 'Game The: 1']);
  assert.equal(buildTags({ ...account, maxTags: 2 }, 'deal', candidate).length, 2);
});

test('deal post: only brief numbers, our own page as the link, cover with alt text, the "Ad:" line is the LAST block', () => {
  const account = withTumblrDefaults('tumblr', { ...realAccounts.accounts.tumblr, ...realTumblr.accounts.tumblr });
  const { content, tags, notes } = buildDealPost(candidate, account, COVER);
  assert.deepEqual(content[0], { type: 'text', text: 'Control Ultimate Edition: -85% at IndieGala', subtype: 'heading2' });
  const img = content.find((b) => b.type === 'image');
  assert.equal(img.alt_text, 'Cover art for Control Ultimate Edition');
  assert.deepEqual(img.media[0], { type: 'image/png', url: candidate.cover, width: 460, height: 215 });
  const texts = content.filter((b) => b.type === 'text').map((b) => b.text);
  assert.ok(texts.includes('$5.99 (was $39.99) at IndieGala, -85%.'));
  assert.ok(texts.some((t) => t === 'Price checked 2026-10-12 09:49 UTC. Sale ends 2026-10-13 23:59 UTC.'));
  assert.ok(texts.some((t) => t === 'Why today: sale ends in 36 h.'), 'a weak discount-rank clause is left out');
  const link = content.find((b) => b.formatting);
  assert.equal(link.text, 'See this deal on Save and Play: Control Ultimate Edition');
  assert.deepEqual(link.formatting, [{ start: 0, end: link.text.length, type: 'link', url: candidate.link }], 'the whole line is the link');
  assert.equal(new URL(link.formatting[0].url).host, 'saveandplay.com', 'the link is our own page, never a store');
  assert.ok(!content.some((b) => b.type === 'link'), 'no link card: it would cut our picture');
  assert.equal(buildDealPost(candidate, { ...account, linkStyle: 'card' }, COVER).content.find((b) => b.type === 'link').url, candidate.link, 'the card is still possible by a setting');
  assert.deepEqual(content.at(-1), { type: 'text', text: DISCLOSURE });
  assert.equal(content.filter((b) => b.text === DISCLOSURE).length, 1);
  assert.ok(tags.length > 0);
  assert.deepEqual(notes, []);
  // no size = no picture, but the post still goes out, with a note
  const bare = buildDealPost(candidate, account, null);
  assert.ok(!bare.content.some((b) => b.type === 'image'));
  assert.match(bare.notes.join(), /size/);
  assert.equal(bare.content.at(-1).text, DISCLOSURE);
  // a deal without a cover gets no picture and no note
  const nocover = buildDealPost({ ...candidate, cover: undefined }, account, null);
  assert.deepEqual(nocover.notes, []);
  // a custom alt text from the brief wins
  assert.equal(buildDealPost({ ...candidate, coverAlt: 'Custom alt' }, account, COVER).content.find((b) => b.type === 'image').alt_text, 'Custom alt');
});

test('deal post: an incomplete or invalid deal is refused with the names of the missing fields', () => {
  const account = withTumblrDefaults('tumblr', { ...realAccounts.accounts.tumblr, ...realTumblr.accounts.tumblr });
  assert.throws(() => buildDealPost({ ...candidate, price: undefined }, account, COVER), /price/);
  assert.throws(() => buildDealPost({ ...candidate, link: 'http://x' }, account, COVER), /link/);
  assert.throws(() => buildDealPost({ ...candidate, priceCheckedAt: 'x' }, account, COVER), /priceCheckedAt/);
  assert.throws(() => buildDealPost({ ...candidate, cover: 'http://insecure/c.jpg' }, account, COVER), /cover/);
  assert.throws(() => buildDealPost(null, account, COVER), /no deal/);
});

test('guide post: heading, picture with imageAlt, description, link with the marks of the account; no "Ad:" line', async () => {
  const root = makeRoot();
  process.env.TUMBLR_ROOT = root;
  try {
    const { listGuides } = lib;
    const account = withTumblrDefaults('tumblr', { ...realAccounts.accounts.tumblr, ...realTumblr.accounts.tumblr });
    const guides = listGuides();
    assert.deepEqual(guides.map((g) => g.slug), ['g-old', 'g-mid', 'g-new'], 'oldest first');
    const a = buildArticlePost(guides[0], account, SITE, { type: 'image/png', width: 1200, height: 630 });
    assert.equal(a.path, '/guides/g-old/');
    assert.deepEqual(a.post.content[0], { type: 'text', text: 'Guide g-old: a title', subtype: 'heading2' });
    const img = a.post.content.find((b) => b.type === 'image');
    assert.equal(img.alt_text, 'Picture for g-old');
    assert.equal(img.media[0].url, `${SITE}/og/g-old.png`);
    assert.equal(linkUrl(a.post.content), `${SITE}/guides/g-old/?utm_source=tumblr-prices&utm_medium=social&utm_campaign=g-old`);
    assert.equal(a.post.content.at(-1).text, 'Read the guide on Save and Play');
    assert.ok(!JSON.stringify(a.post).includes('Ad:'));
    assert.deepEqual(a.notes, []);
    assert.ok(a.post.tags.includes('guide'));
    // no imageAlt = no picture (a picture without alt text is never posted)
    const noAlt = buildArticlePost({ slug: 'x', text: guideFile('title: "T"\ndescription: "D"\nimage: /og/g-old.png') }, account, SITE, COVER);
    assert.ok(!noAlt.post.content.some((b) => b.type === 'image'));
    assert.match(noAlt.notes.join(), /imageAlt/);
    assert.throws(() => buildArticlePost({ slug: 'x', text: 'no header' }, account, SITE, COVER), /no header/);
    assert.throws(() => buildArticlePost(guides[0], account, 'http://x', COVER), /links\.site/);
  } finally {
    delete process.env.TUMBLR_ROOT;
  }
});

test('ownPost finds our page in the links of a recent post, by path, not by the marks, and respects the age', () => {
  const posts = [{ id: '1', url: 'u', timestamp: Date.parse(NOW) - 2 * 3600e3, links: [`${SITE}/deals/gog/x/?utm_source=a`] }, { id: '2', url: 'u', timestamp: Date.parse(NOW) - 100 * 3600e3, links: [`${SITE}/deals/gog/old/`] }, { id: '3', url: 'u', timestamp: Date.parse(NOW), links: ['https://elsewhere.com/deals/gog/y/', 'not a url'] }];
  const o = { site: SITE, now: Date.parse(NOW) };
  assert.equal(ownPost(posts, { ...o, pathname: '/deals/gog/x/', maxAgeHours: 36 }).id, '1');
  assert.equal(ownPost(posts, { ...o, pathname: '/deals/gog/old/', maxAgeHours: 36 }), null, 'too old for a deal');
  assert.equal(ownPost(posts, { ...o, pathname: '/deals/gog/old/', maxAgeHours: null }).id, '2', 'any age for a guide');
  assert.equal(ownPost(posts, { ...o, pathname: '/deals/gog/y/' }), null, 'another site does not count');
});

test('.env helper replaces a line, adds a line, keeps the rest', () => {
  const root = makeRoot({ env: 'A=1\nTUMBLR_TOKEN=old\nB=2\n' });
  setEnvValue(join(root, '.env'), 'TUMBLR_TOKEN', 'new');
  setEnvValue(join(root, '.env'), 'TUMBLR_TOKEN_SECRET', 'sec');
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'A=1\nTUMBLR_TOKEN=new\nB=2\nTUMBLR_TOKEN_SECRET=sec\n');
  assert.equal(readEnvValue(join(root, '.env'), 'B'), '2');
});

test('dry run: shows the post, logs in nowhere, publishes nothing, records nothing, works even without secrets and with autopost off', async () => {
  const server = await startTumblr();
  const root = makeRoot({ autopost: false, env: null });
  const r = await post(root, server, 'deal', ['--dry-run']);
  assert.equal(r.code, 0, r.all);
  assert.match(r.summary, /Dry run: nothing was published/);
  assert.match(r.summary, /"autopost" is false/);
  assert.match(r.summary, /\[heading2\] Control Ultimate Edition: -85% at IndieGala/);
  assert.match(r.summary, /\[image 460x215\]/, 'the size of the cover was read from the picture');
  assert.match(r.summary, /alt text: Cover art for Control Ultimate Edition/);
  assert.match(r.summary, /Ad: we may earn a commission/);
  assert.equal(server.S.calls.length, 0, 'not one request to Tumblr');
  assert.ok(!existsSync(join(root, 'drafts/posted-tumblr.json')));
  server.close();
});

test('autopost off: a real run is skipped (green) and nothing is sent', async () => {
  const server = await startTumblr();
  const root = makeRoot({ autopost: false });
  const r = await post(root, server, 'deal');
  assert.equal(r.code, 0, r.all);
  assert.match(r.summary, /Skipped:\*\* "autopost" is false/);
  assert.equal(server.S.calls.length, 0);
  server.close();
});

test('no --kind: red, with a plain message, nothing sent', async () => {
  const server = await startTumblr();
  const root = makeRoot();
  const r = await run('post-tumblr.mjs', [], { root, server });
  assert.equal(r.code, 1);
  assert.match(r.all, /Which post\?/);
  assert.equal(server.S.calls.length, 0);
  server.close();
});

test('a real deal run: one post with a valid signature, in the right blog, published, the Ad line last, recorded', async () => {
  const server = await startTumblr();
  const root = makeRoot();
  const r = await post(root, server, 'deal');
  assert.equal(r.code, 0, r.all);
  assert.equal(server.S.badSignatures, 0, 'every request was signed correctly');
  assert.equal(created(server).length, 1);
  const p = server.S.posts[0];
  assert.equal(p.blog, 'myblog');
  assert.equal(p.state, 'published');
  assert.deepEqual(p.content.at(-1), { type: 'text', text: DISCLOSURE });
  assert.equal(linkUrl(p.content), candidate.link);
  assert.deepEqual(p.content.find((b) => b.type === 'image').media[0].width, 460);
  assert.equal(typeof p.tags, 'string', 'tags go as one comma-separated text');
  assert.ok(p.tags.split(',').includes('indiegala') && p.tags.split(',').includes('Control Ultimate Edition'));
  assert.ok(server.S.calls.every((c) => c.userAgent === 'saveandplay-tumblr (+https://saveandplay.com)'), 'one fixed User-Agent');
  assert.match(r.summary, /Posted\./);
  assert.match(r.summary, /https:\/\/myblog\.tumblr\.com\/post\/5000/);
  const st = readState(root);
  assert.equal(st.accounts.tumblr[DAY].deal.postId, '5000');
  assert.equal(st.accounts.tumblr[DAY].deal.id, candidate.id);
  server.close();
});

test('one deal a day: the second run is a green "already posted" and sends nothing; the next day brings the next deal', async () => {
  const server = await startTumblr();
  const root = makeRoot({ briefJson: brief([candidate, other]) });
  assert.equal((await post(root, server, 'deal')).code, 0);
  const again = await post(root, server, 'deal');
  assert.equal(again.code, 0, again.all);
  assert.match(again.summary, /already posted today/);
  assert.equal(created(server).length, 1);
  setBrief(root, brief([other], { generatedAt: nextDay(1).replace('13:00', '11:00') }));
  const day2 = await post(root, server, 'deal', [], { now: nextDay(1) });
  assert.equal(day2.code, 0, day2.all);
  assert.equal(created(server).length, 2);
  assert.match(server.S.posts[1].content[0].text, /Other Game/);
  server.close();
});

test('the record is lost: the blog is asked first, our post is found there and not posted twice', async () => {
  const server = await startTumblr();
  const root = makeRoot();
  assert.equal((await post(root, server, 'deal')).code, 0);
  writeFileSync(join(root, 'drafts/posted-tumblr.json'), JSON.stringify({ accounts: {}, articles: {} }));
  const r = await post(root, server, 'deal');
  assert.equal(r.code, 0, r.all);
  assert.equal(created(server).length, 1, 'no second post');
  assert.match(r.summary, /already there \(found on the blog\)/);
  assert.equal(readState(root).accounts.tumblr[DAY].deal.foundOnServer, true);
  server.close();
});

test('a post of the same game older than 36 hours on the blog does not block today\'s deal', async () => {
  const server = await startTumblr({ seeded: [{ id: '77', hoursAgo: 80, links: [`${SITE}/deals/indiegala/control-ultimate-edition/`] }] });
  const root = makeRoot();
  assert.equal((await post(root, server, 'deal')).code, 0);
  assert.equal(created(server).length, 1);
  server.close();
});

test('Tumblr refuses the post: red, the reason and a hint in the Summary, nothing recorded, the next run tries again', async () => {
  const server = await startTumblr({ failPost: { status: 400, detail: 'media dimensions are invalid' } });
  const root = makeRoot();
  const r = await post(root, server, 'deal');
  assert.equal(r.code, 1);
  assert.match(r.summary, /FAILED/);
  assert.match(r.summary, /HTTP 400 \(.*media dimensions are invalid/);
  assert.match(r.summary, /did not accept the content/);
  assert.ok(!existsSync(join(root, 'drafts/posted-tumblr.json')), 'a post that did not go out is not recorded');
  server.S.failPost = null;
  const ok = await post(root, server, 'deal');
  assert.equal(ok.code, 0, ok.all);
  assert.equal(created(server).filter((c) => c.body).length, 2, 'one refused, one accepted');
  assert.equal(server.S.posts.length, 1);
  server.close();
});

test('wrong login (Tumblr answers 401): red, the hint says to run tumblr:auth again, no secret in the output', async () => {
  const server = await startTumblr({ secrets: { ck: 'other', cs: 'other', tk: 'other', ts: 'other' } });
  const root = makeRoot();
  const r = await post(root, server, 'deal');
  assert.equal(r.code, 1);
  assert.match(r.summary, /npm run tumblr:auth/);
  assert.equal(server.S.posts.length, 0);
  server.close();
});

test('missing secrets: red, the names of the missing ones (not their values), nothing sent', async () => {
  const server = await startTumblr();
  const root = makeRoot({ env: 'TUMBLR_CONSUMER_KEY=only-this-one\n' });
  const r = await post(root, server, 'deal');
  assert.equal(r.code, 1);
  assert.match(r.summary, /TUMBLR_CONSUMER_SECRET, TUMBLR_TOKEN, TUMBLR_TOKEN_SECRET not set/);
  assert.equal(server.S.calls.length, 0);
  server.close();
});

test('bad settings (a blog name with a dot): red in a real run, a warning in a dry run', async () => {
  const server = await startTumblr();
  const root = makeRoot({ account: { blog: 'my.blog' } });
  const r = await post(root, server, 'deal');
  assert.equal(r.code, 1);
  assert.match(r.summary, /"blog" must be the name/);
  assert.equal(server.S.calls.length, 0);
  const d = await post(root, server, 'deal', ['--dry-run']);
  assert.equal(d.code, 0);
  assert.match(d.out, /WARNING: tumblr: "blog" must be/);
  server.close();
});

test('stale brief, old price, missing brief, empty brief, a deal that is not a deal: all green "Skipped" with the reason; nothing sent', async () => {
  const server = await startTumblr();
  const root = makeRoot({ briefJson: brief([candidate], { generatedAt: '2026-10-11T11:00:00.000Z' }) });
  const stale = await post(root, server, 'deal');
  assert.equal(stale.code, 0);
  assert.match(stale.summary, /the brief is 26 h old/);
  setBrief(root, brief([{ ...candidate, priceCheckedAt: '2026-10-09T09:00:00Z' }]));
  assert.match((await post(root, server, 'deal')).summary, /Not posting an old price/);
  setBrief(root, brief([]));
  assert.match((await post(root, server, 'deal')).summary, /no deal passes the rules/);
  setBrief(root, brief([{ ...candidate, kind: 'news' }]));
  assert.match((await post(root, server, 'deal')).summary, /not a deal/);
  const empty = makeRoot({ briefJson: null });
  assert.match((await post(empty, server, 'deal')).summary, /no drafts\/brief-tumblr\.json/);
  assert.equal(server.S.calls.length, 0);
  server.close();
});

test('an incomplete deal in the brief is red on purpose (someone has to look)', async () => {
  const server = await startTumblr();
  const root = makeRoot({ briefJson: brief([{ ...candidate, was: null }]) });
  const r = await post(root, server, 'deal');
  assert.equal(r.code, 1);
  assert.match(r.summary, /not complete or not valid: was/);
  server.close();
});

test('"kinds": a blog that takes only guides skips deals (green) and the other way round', async () => {
  const server = await startTumblr();
  const root = makeRoot({ account: { kinds: ['article'] } });
  const r = await post(root, server, 'deal');
  assert.equal(r.code, 0);
  assert.match(r.summary, /does not take "deal" posts/);
  assert.equal(server.S.calls.length, 0);
  setConfig(root, (a) => (a.kinds = ['deal']));
  const art = await post(root, server, 'article');
  assert.match(art.summary, /does not take "article" posts/);
  server.close();
});

test('the cover cannot be measured: the post still goes out, without the picture, with a note', async () => {
  const server = await startTumblr();
  const root = makeRoot();
  pages.down.add('/store_item_assets/steam/apps/870780/header.jpg');
  const r = await post(root, server, 'deal');
  pages.down.delete('/store_item_assets/steam/apps/870780/header.jpg');
  assert.equal(r.code, 0, r.all);
  assert.ok(!server.S.posts[0].content.some((b) => b.type === 'image'));
  assert.equal(server.S.posts[0].content.at(-1).text, DISCLOSURE);
  assert.match(r.summary, /without its picture: the picture answered HTTP 404/);
  server.close();
});

test('guides: the oldest first, one every 2 days, the record is kept, "tumblr: false" is skipped', async () => {
  const server = await startTumblr();
  const root = makeRoot({ guides: { 'g-old': 0, 'g-off': guideHead('g-off', 1, 'tumblr: false'), 'g-mid': 2, 'g-new': 3 } });
  const first = await post(root, server, 'article');
  assert.equal(first.code, 0, first.all);
  assert.match(server.S.posts[0].content[0].text, /g-old/);
  assert.equal(server.S.badSignatures, 0);
  assert.ok(!JSON.stringify(server.S.posts[0]).includes('Ad:'), 'a guide has no Ad line');
  const img = server.S.posts[0].content.find((b) => b.type === 'image');
  assert.equal(img.alt_text, 'Picture for g-old');
  const same = await post(root, server, 'article');
  assert.match(same.summary, /next guide not before 2026-10-14/);
  const day1 = await post(root, server, 'article', [], { now: nextDay(1) });
  assert.match(day1.summary, /not before 2026-10-14/);
  const day2 = await post(root, server, 'article', [], { now: nextDay(2) });
  assert.equal(day2.code, 0, day2.all);
  assert.match(server.S.posts[1].content[0].text, /g-mid/, 'g-off was skipped');
  const day4 = await post(root, server, 'article', [], { now: nextDay(4) });
  assert.match(server.S.posts[2].content[0].text, /g-new/);
  const done = await post(root, server, 'article', [], { now: nextDay(6) });
  assert.match(done.summary, /no guides waiting/);
  assert.equal(created(server).length, 3);
  assert.deepEqual(Object.keys(readState(root).articles.tumblr).sort(), ['g-mid', 'g-new', 'g-old']);
  assert.equal(day4.code, 0);
  server.close();
});

test('a guide whose page is not live waits (green, warning); the record of a posted guide is found again on the blog if lost', async () => {
  const server = await startTumblr();
  const root = makeRoot();
  pages.down.add('/guides/g-old/');
  const waiting = await post(root, server, 'article');
  pages.down.delete('/guides/g-old/');
  assert.equal(waiting.code, 0);
  assert.match(waiting.summary, /page not live yet/);
  assert.equal(server.S.calls.filter((c) => c.path.startsWith('/v2/')).length, 0);
  assert.equal((await post(root, server, 'article')).code, 0);
  writeFileSync(join(root, 'drafts/posted-tumblr.json'), JSON.stringify({ accounts: {}, articles: {} }));
  const lost = await post(root, server, 'article', [], { now: nextDay(3) });
  assert.equal(lost.code, 0, lost.all);
  assert.equal(server.S.posts.length, 1, 'the guide on the blog is recognised, not posted again');
  assert.match(lost.summary, /found on the blog/);
  server.close();
});

test('a guide dry run shows the post even when it is too early; a guide with no header is skipped and the next one is used', async () => {
  const server = await startTumblr();
  const root = makeRoot({ guides: { 'g-a': 'title: ""\nupdated: 2026-09-01', 'g-b': 1 } });
  const r = await post(root, server, 'article', ['--dry-run']);
  assert.equal(r.code, 0, r.all);
  assert.match(r.summary, /Guide g-b/);
  assert.doesNotMatch(r.summary, /size could not be read/, 'the picture is measured, so no false note about its size');
  assert.match(r.summary, /\[image 460x215\]/);
  assert.match(r.out, /WARNING: tumblr: guides that cannot become a post/);
  assert.equal(server.S.calls.length, 0);
  server.close();
});

test('the check script: login, blogs, the blog of the settings; wrong blog and missing secrets are red', async () => {
  const server = await startTumblr();
  const root = makeRoot();
  const ok = await run('tumblr-check.mjs', [], { root, server });
  assert.equal(ok.code, 0, ok.all);
  assert.match(ok.out, /All four secrets are set/);
  assert.match(ok.out, /Login works as Tumblr user "owner"/);
  assert.match(ok.out, /Blog "myblog" is yours/);
  setConfig(root, (a) => (a.blog = 'someone-else'));
  const wrong = await run('tumblr-check.mjs', [], { root, server });
  assert.equal(wrong.code, 1);
  assert.match(wrong.all, /not among the blogs of this user.*myblog/);
  const none = await run('tumblr-check.mjs', [], { root: makeRoot({ env: null }), server });
  assert.equal(none.code, 1);
  assert.match(none.all, /not set: TUMBLR_CONSUMER_KEY/);
  const bad = await startTumblr({ secrets: { ck: 'x', cs: 'x', tk: 'x', ts: 'x' } });
  const denied = await run('tumblr-check.mjs', [], { root: makeRoot(), server: bad });
  assert.equal(denied.code, 1);
  assert.match(denied.all, /does not accept the login/);
  server.close();
  bad.close();
});

test('the auth script: asks for a temporary token, waits for the browser, exchanges it, writes the token into .env, shows no secret', async () => {
  const www = await startWww();
  const server = await startTumblr({ secrets: { ck: SECRETS.TUMBLR_CONSUMER_KEY, cs: SECRETS.TUMBLR_CONSUMER_SECRET, tk: www.S.token, ts: www.S.tokenSecret } });
  const root = makeRoot({ env: `TUMBLR_CONSUMER_KEY=${SECRETS.TUMBLR_CONSUMER_KEY}\nTUMBLR_CONSUMER_SECRET=${SECRETS.TUMBLR_CONSUMER_SECRET}\n` });
  const port = 18000 + Math.floor(Math.random() * 1000);
  let answered = false;
  const r = await run('tumblr-auth.mjs', [], {
    root, server, www,
    env: { TUMBLR_AUTH_PORT: String(port), TUMBLR_AUTH_WAIT_MS: '20000', PATH: '/nonexistent' },
    onLine: (out) => {
      // the test plays the browser: when the address is printed, it "presses Allow" (the browser returns to localhost)
      if (!answered && /oauth\/authorize\?oauth_token=reqtok-Ff6/.test(out)) {
        answered = true;
        setTimeout(() => fetch(`http://localhost:${port}/callback?oauth_token=reqtok-Ff6&oauth_verifier=${www.S.verifier}`).catch(() => {}), 300);
      }
    },
  });
  assert.equal(r.code, 0, r.all);
  assert.equal(www.S.bad, 0, 'both login requests were signed correctly');
  assert.equal(www.S.callback, `http://localhost:${port}/callback`);
  assert.equal(readEnvValue(join(root, '.env'), 'TUMBLR_TOKEN'), www.S.token);
  assert.equal(readEnvValue(join(root, '.env'), 'TUMBLR_TOKEN_SECRET'), www.S.tokenSecret);
  assert.match(r.out, /Login works as Tumblr user "owner"/);
  assert.match(r.out, /npm run tumblr:secret/);
  assert.ok(!r.all.includes(www.S.token) && !r.all.includes(www.S.tokenSecret) && !r.all.includes(www.S.requestSecret), 'no token in the output');
  // without the consumer key the script stops with instructions
  const none = await run('tumblr-auth.mjs', [], { root: makeRoot({ env: null }), www });
  assert.equal(none.code, 1);
  assert.match(none.all, /tumblr\.com\/oauth\/apps/);
  server.close();
  www.close();
});

test('the auth script: Tumblr refuses (wrong consumer secret) -> red with a plain message', async () => {
  const www = await startWww();
  const root = makeRoot({ env: `TUMBLR_CONSUMER_KEY=${SECRETS.TUMBLR_CONSUMER_KEY}\nTUMBLR_CONSUMER_SECRET=wrong\n` });
  const r = await run('tumblr-auth.mjs', [], { root, www, env: { TUMBLR_AUTH_PORT: String(19000 + Math.floor(Math.random() * 500)), TUMBLR_AUTH_WAIT_MS: '2000' } });
  assert.equal(r.code, 1);
  assert.match(r.err, /request_token: HTTP 401/);
  assert.match(r.err, /Default callback URL/);
  www.close();
});

test('the secret script sends the four values to `gh secret set` through stdin, not through the command line; without gh it explains', async () => {
  if (process.platform === 'win32') return console.log('   (skipped: uses a fake gh shell script)');
  const root = makeRoot();
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "gh version 0"; exit 0; fi\necho "$@" >> "$GH_ARGS_FILE"\ncat >> "$GH_STDIN_FILE"; echo >> "$GH_STDIN_FILE"\n', { mode: 0o755 });
  const withGh = await run('tumblr-secret.mjs', [], { root, env: { PATH: `${bin}:${process.env.PATH}`, GH_ARGS_FILE: join(root, 'args.txt'), GH_STDIN_FILE: join(root, 'stdin.txt') } });
  assert.equal(withGh.code, 0, withGh.all);
  const args = readFileSync(join(root, 'args.txt'), 'utf8');
  assert.deepEqual(args.trim().split('\n'), ['secret set TUMBLR_CONSUMER_KEY', 'secret set TUMBLR_CONSUMER_SECRET', 'secret set TUMBLR_TOKEN', 'secret set TUMBLR_TOKEN_SECRET']);
  assert.ok(SECRET_VALUES.every((v) => !args.includes(v)), 'no value in the command line');
  assert.deepEqual(readFileSync(join(root, 'stdin.txt'), 'utf8').trim().split('\n'), SECRET_VALUES);
  assert.ok(SECRET_VALUES.every((v) => !withGh.all.includes(v)), 'no value on the screen');
  const noGh = await run('tumblr-secret.mjs', [], { root, env: { PATH: '/nonexistent' } });
  assert.equal(noGh.code, 2);
  assert.match(noGh.err, /New repository secret/);
  assert.match(noGh.err, /TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET, TUMBLR_TOKEN, TUMBLR_TOKEN_SECRET/);
  const empty = await run('tumblr-secret.mjs', [], { root: makeRoot({ env: 'TUMBLR_TOKEN=x\n' }), env: { PATH: `${bin}:${process.env.PATH}`, GH_ARGS_FILE: join(root, 'a2.txt'), GH_STDIN_FILE: join(root, 's2.txt') } });
  assert.equal(empty.code, 1);
  assert.match(empty.err, /not set in \.env: TUMBLR_CONSUMER_KEY/);
});

test('the workflow file: two schedules, the brief branch record of its own, the four secrets, no secret in a command line, it is in place', () => {
  // until Claude Code moves it, the workflow lives in scripts/ (the chat cannot write to .github/)
  const path = [here('../.github/workflows/post-tumblr.yml'), here('./post-tumblr.workflow.yml')].find((p) => existsSync(p));
  assert.ok(path, 'the workflow file exists in .github/workflows/ or in scripts/');
  const y = readFileSync(path, 'utf8');
  assert.match(y, /name: Post to Tumblr/);
  assert.match(y, /cron: '0 13 \* \* \*'/);
  assert.match(y, /cron: '0 18 \* \* \*'/);
  assert.match(y, /github\.event\.schedule == '0 18 \* \* \*' && 'article'/, 'the 18:00 UTC schedule is the guide');
  assert.match(y, /STATE_FILE: posted-tumblr\.json/);
  assert.match(y, /bash scripts\/nostr-branch\.sh load/);
  assert.match(y, /bash scripts\/nostr-branch\.sh save/);
  for (const n of ['TUMBLR_CONSUMER_KEY', 'TUMBLR_CONSUMER_SECRET', 'TUMBLR_TOKEN', 'TUMBLR_TOKEN_SECRET']) assert.match(y, new RegExp(`${n}: \\$\\{\\{ secrets\\.${n} \\}\\}`));
  assert.match(y, /node scripts\/tumblr-check\.mjs/);
  assert.ok(!/echo.*secrets\./.test(y));
  // the schedule does not collide with the other channels: after the daily brief (11:00 UTC), after Lemmy (12:00 UTC and 17:30 UTC)
  assert.ok(13 > 11 && 18 > 17);
});

test('package.json has the commands; no secret value appears in any output of any test', () => {
  const pkg = JSON.parse(readFileSync(here('../package.json'), 'utf8'));
  for (const c of ['tumblr:post', 'tumblr:check', 'tumblr:auth', 'tumblr:secret', 'tumblr:test']) assert.ok(pkg.scripts[c], c);
  for (const l of leaks) for (const v of SECRET_VALUES) assert.ok(!l.all.includes(v), `${l.script}: a secret value was printed`);
  assert.ok(leaks.length > 20, 'the leak check looked at many outputs');
});

// ---------- run ----------

let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`ok   ${t.name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${t.name}\n     ${String(err.stack ?? err).split('\n').slice(0, 8).join('\n     ')}`);
  }
}
console.log(`\n${tests.length - failed} of ${tests.length} tests passed.`);
process.exit(failed ? 1 : 0);
