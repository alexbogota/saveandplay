# Comments playbook: Bluesky account @saveandplay.com

Applies ONLY to https://bsky.app/profile/saveandplay.com (PC game deals site). Other accounts get their own files: docs/comments-NAME.md.
Mastodon (@saveandplay@mastodon.social) has its own file: docs/comments-saveandplay-mastodon.md. Phrases (decided 14 Oct 2026): "комментарии saveandplay" = Bluesky AND Mastodon together (see "Both accounts in one run" below); "комментарии bluesky" = Bluesky only; "комментарии mastodon" = Mastodon only (the process in its own file).
The owner sends replies manually from this account. Claude only drafts replies, never publishes.
Posts are found by a PROGRAM, not by Claude: the "Comment candidates" workflow on GitHub (repository alexbogota/saveandplay) runs every 6 hours and keeps its list on the branch `comments`. Its settings (search queries, feeds, stop words, scores) are in `data/comments-accounts.json`, the description is in `docs/comments-finder.md`. Do NOT search Bluesky through the browser: it costs many tokens and has no memory of what was already shown.
The owner's computer and his project folder are NOT needed: the chat takes the code and the list from GitHub, so it works from any device. The owner never has to type commands. Never ask him to connect a folder or to attach files. The chat needs only two tools: `add_repo` and the shell (Bash). If this tab has neither (for example a plain chat outside the project), tell him in Russian to open a new task from the project "saveandplay" in the Claude desktop app and to write the phrase again, and stop; do not ask for a folder.

## Both accounts in one run (owner says "комментарии saveandplay")
Do the Process below for Bluesky, and the same steps for Mastodon, with ONE `add_repo` and ONE clone. In addition to this file, read docs/comments-saveandplay-mastodon.md (only if the Mastodon list has new posts: its Style and "Which posts to pick" differ: no hashtags, never start with @name, two links per post). REPO below is the code folder found in Process step 1. Order:
1. `add_repo` and the clone as in Process step 1. The checks of step 1 apply: `grep -c record-new REPO/scripts/comments-show.mjs` and `grep -c mastodon-prices REPO/data/comments-accounts.json`; if either prints 0, tell the owner (Russian) to say `/publish` to Claude Code, and stop.
2. ONE shell command: `cd REPO && bash scripts/comments-branch.sh load && node scripts/comments-show.mjs --limit 15 --record-new drafts/comments-shown-prices-$(date -u +%Y%m%d-%H%M%S).json && node scripts/comments-show.mjs --account mastodon-prices --limit 8 --record-new drafts/comments-shown-mastodon-prices-$(date -u +%Y%m%d-%H%M%S).json`. Two REMEMBERED lines come out, one per account. If either list is `STALE LIST` or `NO LIST`, start the workflow ONCE (it refreshes both lists) as in Process step 2, then repeat this step.
3. Draft and show the owner two blocks, "Bluesky" first, then "Mastodon", each by its own file's rules. Say honestly if few fit; an empty block is fine. Publish nothing.
4. Save BOTH memories right away, before the owner answers, even if every post was skipped, in ONE command: `cd REPO && bash scripts/comments-branch.sh save drafts/comments-shown-prices-STAMP.json && bash scripts/comments-branch.sh save drafts/comments-shown-mastodon-prices-STAMP.json` (exact file names from the REMEMBERED lines). Each must print `Saved to the comments branch.`; if not, tell the owner which one failed.
5. Daily limits for the owner, spread over the day: about 20-25 replies on Bluesky (raised 14 Oct 2026 from 10-15: start near 15 for the first days, then go up) and about 10 on Mastodon. Say so only if he asks or if he sends many at once.

## Process (Bluesky only; the first half of "комментарии saveandplay" and all of "комментарии bluesky")
Read nothing except what is listed here. Do NOT read comments-prices.md. A program, not you, decides which posts are new: your own eyes miss repeats.
1. Get the code and the list from GitHub. Call `add_repo` (owner alexbogota, repo saveandplay, access push). Then find the code folder, called REPO below: if `/home/claude/saveandplay/scripts/comments-show.mjs` exists, REPO is `/home/claude/saveandplay` (add_repo may have cloned it there; run `git -C REPO pull -q` to get the newest code). Otherwise make ONE clone with a 10 minute timeout: `git clone -q --depth 1 --branch main https://github.com/alexbogota/saveandplay /home/claude/sp` and REPO is `/home/claude/sp` (if it already exists in this chat, run `git -C /home/claude/sp pull -q` instead). Write the real path instead of REPO in every command below (the shell forgets everything between commands). Do not call register_repo_root and do not read the repository's other files.
   - If `grep -c record-new REPO/scripts/comments-show.mjs` prints 0, the new code is not published yet: tell the owner (Russian) to say `/publish` to Claude Code, and stop.
   - If add_repo says there is no access to the repository: the owner must install the Claude app on GitHub for this repository (github.com/apps/claude, Only select repositories, saveandplay). Tell him so and stop.
2. Run in ONE shell command (the shell forgets everything between commands): `cd REPO && bash scripts/comments-branch.sh load && node scripts/comments-show.mjs --limit 15 --record-new drafts/comments-shown-prices-$(date -u +%Y%m%d-%H%M%S).json`. It prints the age of the list and ONLY the posts that were not shown before (this is what stops repeats), and writes a NEW shown file named in its last line (REMEMBERED).
   - `STALE LIST` or `NO LIST` (no posts are shown then): the list on GitHub is older than 8 hours, the automatic run is late or failed. Start the search yourself: `cd REPO && gh workflow run "Comment candidates" -R alexbogota/saveandplay --ref main`, then every 10 seconds `gh run list -R alexbogota/saveandplay --workflow "Comment candidates" --limit 1` until it says completed (usually under a minute), then repeat this step. `gh auth status` says the token is invalid: ignore it, the commands work. If the run ends in `failure`, show the owner (Russian) the reason from `gh run view RUN_ID -R alexbogota/saveandplay --log-failed | tail -20` (never print secrets) and stop. If gh is refused ("no permission"), ask the owner to press Actions, Comment candidates, Run workflow on GitHub (one tap), and stop.
   - `NEW POSTS: 0`: tell the owner there is nothing new yet (the next list comes within 6 hours, or start the workflow as above if he wants it now). No file to save, go to step 6.
3. Draft replies only for posts that really fit (see "Which posts to pick"). The others are remembered as shown and never come back. 8-12 good drafts are better than 15 weak ones. Say honestly if few fit.
4. Show the owner: direct post link, handle, draft (and "verify" for any fact you are unsure about). Publish nothing.
5. Save the memory right away, before the owner answers, even if you skipped every post: `cd REPO && bash scripts/comments-branch.sh save drafts/comments-shown-prices-STAMP.json` (the exact file name from the REMEMBERED line). It must print `Saved to the comments branch.` If it does not, say so to the owner: the next chat may repeat these posts.
6. Owner sends manually. If he edits a draft, note the change and offer to update this playbook.

Posts older than 30 hours (`maxAgeHours`) are never listed, and a list older than 8 hours is never used, so after a day without the owner the chat starts from a fresh list and never from old posts.

Reply format to the owner (Russian, short): what was done, what's next, what is needed from him.

## Style (replies always in English)
Write like a very helpful community member, not a brand. These replies get likes and follows.
- 1-3 short sentences, conversational tone.
- Exactly one practical tip related to the post.
- If it fits, start with a short reaction ("Nice find.", "Backlog first is a solid plan.").
- No links, no site name, no promo, no "follow us". #ad is not needed. If an affiliate link ever appears, add #ad.
- Never name or recommend any third-party site, tracker or service (no gg.deals, IsThereAnyDeal, key shops, etc.): it is free spam for someone else. Name one only if the post author named it first. Say "check the price history" or "wishlist it" without naming a tool. Naming the big stores (Steam, GOG, Epic) as plain facts is fine.
- Emoji: at most one, only if it matches the author's tone.
- Never argue, lecture, or push "buy it".
- Never invent prices, numbers or rules. If unsure about a fact (refunds, DRM, Steam Deck settings), check the official page or flag it to the owner ("verify").

## Examples that worked (post -> reply)
- Wants games not locked to a platform. -> "Yes, that's the idea. GOG sells every game DRM-free: you download the installer, keep the files, and can back them up. No account or launcher needed to run them. Steam works differently, it's a license tied to your account"
- Surprised how many DRM-free offline games exist. -> "Agreed, and it's not only GOG. Itch.io is DRM-free too, and a lot of older classics are on both. Buy once, keep the installer, done."
- Wants to wait for a sale on a new game. -> "Backlog first is a solid plan. If you do wait, look at the game's price history before buying so you know what a real low looks like"
- Author recommended a price comparison site (so naming it is fine). -> "gg.deals is a handy one. Quick tip: check whether a price is from an official store or a key reseller, since refunds are usually easier with official stores"
- Steam games won't run on a MacBook. -> "On Steam's search page you can narrow results by operating system, so you only see games with a Mac version. The system requirements section on each store page also lists it before you buy"
- Low-end PC, which RTS to play. -> "Older RTS games are the safe bet for a low-end PC, and Age of Empires II is a good place to learn the basics. Keep your workers building non-stop, scout early, and don't let resources pile up unspent. Those habits carry over to most RTS games."
- Found a $2 game on GOG. -> "Nice find. Worth remembering that GOG copies are DRM-free, so you can keep the installer and play offline whenever you like."
- Finally bought a horror game on sale. -> "Waiting it out paid off, nice. Hope the scares lived up to it."

## Which posts to pick
- Real people (not bots, stores, or devs promoting their own game), PC games only (Steam, GOG, Epic, Steam Deck). Skip console-only posts and posts about books or comics.
- Best: questions, or someone unsure before buying. Statements are fine if one short tip fits.
- Skip: piracy, emulation, rants and fights, politics, NSFW, people in a hard emotional state, other people's ads.
- Skip anything about bypassing regional pricing (VPN, region-locked keys): Steam forbids it, we never give that advice.
- Skip "is Kinguin / key site safe" questions: answer only after checking facts, and flag to the owner ("verify").
- Heated topics (AI in games and similar, the list has a separate "Heated" block): reply only if someone asks a factual question, neutrally, with a verified fact (for example where Steam shows AI disclosure on a store page). Never take a side. Otherwise skip.

## Broad groups (temporary, while the account is new)
Decision of the owner, 13 Oct 2026: to raise activity of the new account, the list also has groups marked `broadPlaying` and `broadAsk`: general PC-game talk (what people just finished, what they play, asks for recommendations). Switch them off with `enabled: false` in `data/comments-accounts.json` when the account is established.
- Still only video games, no politics, no fights, no promo, no links, no site names. All Style rules stay.
- For these posts the "one practical tip" is NOT required: a friendly reaction plus one specific, true detail about the game is enough. Never a deals pitch.
- Every reply must be different and written for that post, never a template. Pick at most 8-10 broad posts per list, and tell the owner to send no more than about 20-25 replies a day in total (about 15 in the first days), spread over the day (many identical-looking replies from a new account can get it reported).
- Core groups (deals, bundles, sale questions, Steam Deck, backlog) come first when both kinds fit.

## Pictures, video, quotes
The list holds only the text, and Claude cannot see pictures. Under the text a line like `[image: description]`, `[image, no description]`, `[video, ...]`, `[link card: ...]` or `[quotes @name: ...]` says what is attached. Posts with only a picture and no text are never in the list.
- If the description explains the picture, use it. Never say what is in a picture that has no description.
- If the post depends on the picture (the text is only "look at this", "what do you think?", "found it") and there is no description, skip the post, or answer only what the text itself says. Do not guess.
- For `[quotes @name: ...]` the reply is to the quoting author's words, and the quoted text is the context.

## Feed posts (a group named after a feed: `pcGaming`, `gamingLiked`)
The finder also reads curated feeds (someone else's list of posts by topic; list and weights in `data/comments-accounts.json`, `feeds`). A feed is a source, not a topic: judge the post by the normal rules. With a price, sale or buying angle, answer as in the core groups; otherwise treat it as broad (friendly reaction + one true detail, no pitch). Feeds hold many bots, news sites and developers: skip them as usual and never name the feed in a reply. The finder already drops console-only posts, non-English text and ads (a link with three or more hashtags); if one still slips through, skip it: we answer PC only. `gamingLiked` holds popular posts: heated debates and crowded threads, prefer posts with few replies. The feeds `videogames` and `gamingNintendo` are switched off (14 Oct 2026, nothing usable came from them).

## Posts with limited replies
Rare. Do NOT run any check for it. If the owner cannot reply to a post, he skips it and tells Claude. A "threadgate" on a post does not always mean limited replies.

## When the owner gets a reply to one of our comments
The app shows only "Replied to you". To find which comment it answers: in the browser page (bsky.app) fetch
`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=HANDLE&filter=posts_with_replies&limit=30`,
find their post by its text, and read `reply.parent` (our comment) and `reply.root` (original post). Give the owner a link: `https://bsky.app/profile/saveandplay.com/post/RKEY`.
Do not answer jokes or sarcasm. Answer only real questions.

## Notes
- The audience of Bluesky is mostly in the US and Europe. Few fresh posts appear when it is night in the US; a run during the US day gives more.
- Tuning the search (queries, stop words, scores) is done in `data/comments-accounts.json`, not here.
