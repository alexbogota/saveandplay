# Comments playbook: Mastodon account @saveandplay@mastodon.social

Applies ONLY to https://mastodon.social/@saveandplay (PC game deals site). The Bluesky account has its own file: docs/comments-saveandplay.md. Started 13 Oct 2026; the settings and this text will be tuned from the first live runs.
The owner sends replies manually from this account. Claude only drafts replies, never publishes.
Posts are found by a PROGRAM, not by Claude: the "Comment candidates" workflow on GitHub (repository alexbogota/saveandplay) runs every 6 hours and keeps the list on the branch `comments`, file `comments-mastodon-prices.md` (the Bluesky list is `comments-prices.md`). Settings (hashtags, stop words, scores) are the block `mastodon-prices` in `data/comments-accounts.json` (it inherits the word lists of the Bluesky block `prices`), the description is in `docs/comments-finder.md`. Do NOT browse Mastodon by hand: it costs many tokens and has no memory of what was already shown.
The owner's computer and his project folder are NOT needed: the chat takes the code and the list from GitHub, so it works from any device. The owner never has to type commands.

## How Mastodon differs from Bluesky (why the list looks different)
- Mastodon cannot search other people's posts by words. The program reads the PUBLIC HASHTAG TIMELINES of mastodon.social (#steamdeck, #backlog, #gamerecommendations ...). The `group` in a list line is the hashtag group. No password is used.
- Hashtag timelines hold many news feeds and shops (often not marked as bots). The program drops posts with a link and no question, bot accounts, news/shop/developer names and servers, bridged accounts, posts behind a content warning, people who opted out of search (`noindex`) and profiles that say "no bots" / "no promo". Expect fewer posts than on Bluesky; say honestly if few fit.
- The hashtags were chosen by guess. `Sources so far` in the run log shows how many posts each group gave; tune the hashtags in the settings, not here.

## Process (owner says "комментарии mastodon")
Read nothing except what is listed here. Do NOT read comments-mastodon-prices.md. A program, not you, decides which posts are new: your own eyes miss repeats.
1. Get the code and the list from GitHub. Call `add_repo` (owner alexbogota, repo saveandplay, access push). Then ONE clone with a 10 minute timeout: `git clone -q --depth 1 --branch main https://github.com/alexbogota/saveandplay /home/claude/sp` (if /home/claude/sp already exists in this chat, run `git -C /home/claude/sp pull -q` instead). Do not call register_repo_root and do not read the repository's other files.
   - If `grep -c mastodon-prices /home/claude/sp/data/comments-accounts.json` prints 0, the Mastodon code is not published yet: tell the owner (Russian) to say `/publish` to Claude Code, and stop.
   - If add_repo says there is no access to the repository: the owner must install the Claude app on GitHub for this repository (github.com/apps/claude, Only select repositories, saveandplay). Tell him so and stop.
2. Run in ONE shell command (the shell forgets everything between commands): `cd /home/claude/sp && bash scripts/comments-branch.sh load && node scripts/comments-show.mjs --account mastodon-prices --limit 8 --record-new drafts/comments-shown-mastodon-prices-$(date -u +%Y%m%d-%H%M%S).json`. It prints the age of the list and ONLY the posts that were not shown before, and writes a NEW shown file named in its last line (REMEMBERED).
   - `STALE LIST` or `NO LIST` (no posts are shown then): the list on GitHub is older than 8 hours, or Mastodon was never searched. Start the search yourself: `cd /home/claude/sp && gh workflow run "Comment candidates" -R alexbogota/saveandplay --ref main`, then every 10 seconds `gh run list -R alexbogota/saveandplay --workflow "Comment candidates" --limit 1` until it says completed (usually under a minute), then repeat this step. `gh auth status` says the token is invalid: ignore it, the commands work. If the run ends in `failure`, show the owner (Russian) the reason from `gh run view RUN_ID -R alexbogota/saveandplay --log-failed | tail -20` (never print secrets) and stop. Note: the run searches Bluesky too, so a Bluesky problem can also make the run red; read which account failed. If gh is refused ("no permission"), ask the owner to press Actions, Comment candidates, Run workflow on GitHub (one tap), and stop.
   - `NEW POSTS: 0`: tell the owner there is nothing new yet (the next list comes within 6 hours, or start the workflow as above if he wants it now). No file to save, go to step 6.
3. Draft replies only for posts that really fit (see "Which posts to pick"). The others are remembered as shown and never come back. 3-6 good drafts are better than 10 weak ones.
4. Show the owner for each post: the handle, the FIRST link, the `original:` link, and the draft (and "verify" for any fact you are unsure about). Publish nothing.
5. Save the memory right away, before the owner answers, even if you skipped every post: `cd /home/claude/sp && bash scripts/comments-branch.sh save drafts/comments-shown-mastodon-prices-STAMP.json` (the exact file name from the REMEMBERED line). It must print `Saved to the comments branch.` If it does not, say so to the owner: the next chat may repeat these posts.
6. Owner sends manually. If he edits a draft, note the change and offer to update this playbook.

## How the owner opens a post to reply
The post usually lives on another server. Every line of the list has two links:
- The FIRST link goes through mastodon.social (`mastodon.social/@name@server/number`). In the Mastodon app, or in a browser where the owner is logged in as @saveandplay, it should open the post with a reply button.
- The line `original:` is the post's own page on its own server. If the first link shows "You are leaving mastodon.social", a login page or nothing, copy the `original:` link into the search field of mastodon.social (or of the app): the post opens and can be answered.
NOT checked in a logged-in browser yet (13 Oct): after the first real use ask the owner which link worked and write it into "Journal" below. If neither works, the program's link format has to be changed (scripts/lib/comments.mjs, fromMastodon).

## Style (replies always in English)
Same as on Bluesky: write like a very helpful community member, not a brand.
- 1-3 short sentences, conversational. The server allows 500 characters, but short is better.
- Exactly one practical tip related to the post. A friendly reaction first if it fits.
- No links, no site name, no promo, no "follow us". Never name or recommend any third-party site, tracker or service unless the author named it first. Big stores (Steam, GOG, Epic) as plain facts are fine.
- At most one emoji, only if it matches the author's tone. Never argue, lecture, or push "buy it". Never invent prices, numbers or rules; if unsure, say "verify".
- Mastodon only: no hashtags in replies (on Mastodon they look like promotion). Do not start with the author's @name: Mastodon puts the mention in automatically when the owner presses reply. Content warnings: the program already skipped posts that have one.

## Which posts to pick
Same as on Bluesky (docs/comments-saveandplay.md, "Which posts to pick", "Broad groups", "Pictures, video, quotes", "Heated topics"): real people, PC games only, best are questions or someone unsure before buying; skip piracy, emulation, rants, politics, NSFW, regional-price tricks (VPN, region-locked keys), "is Kinguin safe" questions, people in a hard emotional state, other people's ads.
- Mastodon people are often privacy-minded and wary of brands. When in doubt, skip. A reply that adds nothing is worse than no reply.
- The groups `broadPlaying` and `broadAsk` (general game talk) are on for a new account, as on Bluesky. Pick at most 5-6 per list. The owner should send no more than about 10 replies a day on Mastodon, spread over the day.
- Posts of the group `deck` (#steamdeck, #steamos) and `practical` (#linuxgaming, #protondb, #drmfree) are often by Linux and Steam Deck users: a short, true, practical tip is welcome there.

## When the owner gets a reply to one of our comments
The Mastodon app shows the notification with the conversation: the owner opens it from there. Do not answer jokes or sarcasm. Answer only real questions.

## Notes
- The bio of the account says the publications are automated (docs/channels.md). Posts are published by the owner and replies are written by a human. If the profile switch "This is an automated account" (Edit profile) is ON, many Mastodon people ignore or block replies from such an account. If replies get no reaction after 1-2 weeks, ask the owner whether to turn the switch off.
- mastodon.social is a large general server and, like every big Mastodon server, treats unsolicited promotion as spam. One short helpful reply to a person who asked is not spam; a template sent to many people is. Every reply must be written for that post.
- The audience is smaller than on Bluesky. A quiet list is normal.

## Journal (fill in yourself)
- 2026-10-13: Mastodon added to the finder. Live checks that were done: the hashtag timeline `/api/v1/timelines/tag/pcgaming` and `/steamdeck` of mastodon.social opens without a login (40 posts per request); the posts have the fields the program reads (bot, noindex, language, card, acct, url). Of 5 fresh #pcgaming posts, 4 were one news feed (not marked as a bot) and the fifth also looked like news: that is why a post with a link and no question is dropped. NOT checked yet: a full run from GitHub (the first live run), and the first link in a logged-in browser.
