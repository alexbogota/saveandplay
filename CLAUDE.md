# SaveAndPlay — project brief

Owner is a beginner with websites; explain steps simply, in Russian. Site copy is English only.

## What this is
saveandplay.com: a PC game deals site (discounts, bundles, free games) that earns affiliate commissions.
Tagline: "Save on the games. Play more of them." (footer: "Save more. Play more.")
A Bluesky bot will post the same deals. First goal: get approved by Sovrn Commerce (publisher), so the site must look real and complete.

## Stack decision
- Astro (static output) + a small data script. No database, no admin panel.
- Deals live in `src/data/deals.json` (title, store, price, was, discount, url, cover, historicalLow, updatedAt). Pages are generated from it.
- Editorial pages (guides, collections) as Markdown later.
- Hosting: Spaceship shared "Pro" (cPanel, PHP, cron, SSH jailed, FTP). Deploy the built `dist/` via GitHub Actions over SFTP/FTP. Check what the host really allows before assuming rsync.
- Contact form: small PHP handler on the host (or a form service). Mail: contact@saveandplay.com.

## Deals automation (later phase)
Script fetches deals from an API or feed, converts store URLs to affiliate links (Sovrn Commerce API or the network where the store is approved), writes deals.json, site rebuilds on a schedule, Bluesky bot posts the best ones.
Check each data source's terms (attribution, commercial use) before using it. Never use fake prices on the live site.
All outgoing buttons should go through our own `/go/<store>/<id>` redirect so the affiliate network can be swapped in one place and clicks can be counted.

## Design source
`design/*.dc.html` are mockups exported from Claude Design. They are reference only, they will not render by themselves (they need a runtime file). Read them as HTML + inline styles and rebuild as Astro components.
- Main.dc.html: home. Header, hero with featured deal, quick filter chips, 8 deal cards, bundles, free games, shop by store, how it works + affiliate disclosure, footer.
- About, Contact, Disclosure (affiliate disclosure), Privacy: simple text pages with the same header/footer.
Deal data in the mockups is placeholder ("Game Title 01"), covers are flat color tiles. Do not ship that as real content.

### Design tokens
- Fonts: Bricolage Grotesque (headings, 600/800), DM Sans (body, 400/500/700), from Google Fonts.
- Background #0D1117, panel #161B22, section band #10151C, border #262D38 / #2A323E, footer #0A0E13.
- Text #E8ECF1, headings #FFFFFF, muted #9AA5B4, body-muted #B4BDCA.
- Accent (mint) #3DDC97 with dark text #06150E. Discount badge #FFB454 on #1B1203. Good/free #5EEAA6 on #12372A. Focus ring #FFB454.
- Radius 10px (buttons), 14px (cards), 18px (hero card). Container max-width 1200px, side padding 24px. Must work at phone width. Touch targets at least 44px.

## Placeholders still open
- Bluesky handle on the Contact page.
- No analytics yet (owner will add later). Privacy page says "web analytics tools" generically; update it when the tool is chosen.
- Terms page does not exist yet (footer link is a stub).
- Real store logos and game covers need rights; use official store/press assets or API-provided images that allow it.

## Rules
- Affiliate disclosure must stay visible on the home page and in the footer.
- Always tell the owner what you changed in plain words. Commit often, small commits.
- Main principle (decided 7 Oct 2026): build a working system, not manual steps. Maximum automation. Never ask the owner to do routine work by hand (copying, pasting, uploading images, fixing links). If something is manual today, treat it as a gap: fix it in code or workflows. If that is truly impossible, say so and name the smallest remaining manual step. Every solution must be reusable for future niches and accounts (settings in data files such as data/accounts.json, no one-off fixes).
- Files that the owner's chat Claude writes straight into this folder (articles in src/pages/guides/ and src/pages/servers/, their pictures in public/og/, CLAUDE.md, START.md, PROJECT.md, docs/) arrive uncommitted. Publishing them is your job: when you see them in git status, or when the owner types /publish, follow `PUBLISH.md` (the same text is the `/publish` command in `.claude/commands/`) without asking the owner for the steps again.
- Every article in src/pages/guides/ has `image` (a 1200x630 file in public/og/) and `imageAlt` in its header, so the link card in Bluesky shows the article's own picture. Check this when you publish.
- Alt text is the default everywhere (decided 7 Oct 2026). Every picture that carries meaning is a real `<img>` with a non-empty `alt`, never a CSS background. Game covers: `Cover art for <game title>` (taken from the data, so new deals get it by themselves). Article pictures: `imageAlt` in the header. Any new component, page or niche follows the same rule. When you publish, check in `dist/` that no `<img>` lacks `alt`.

## Current state and decisions
Read @START.md first. It is short on purpose: what works now, the daily schedule, what waits for the owner, where the main files are, how to run things, the main rules. Do not read anything else until the task needs it. The long records live in `docs/` and `PROJECT.md` (its table of contents links to them): `docs/decisions.md` (decision log), `docs/partners.md` (affiliate programs and link templates), `docs/channels.md` (publishing rules and accounts), and `NOSTR.md` (everything about Nostr). Where START.md or these files conflict with this file, the newer one wins.
- Rule for memory (decided 9 Oct 2026): after every task, update START.md yourself (what changed, what now waits for the owner). Keep START.md at 60 lines or fewer, plain Russian, no long records. Put long records (decision log entries, partner details, channel notes) into `docs/`, never into START.md or CLAUDE.md. When a decision changes, add the entry to the end of `docs/decisions.md` and put only the result into START.md.
