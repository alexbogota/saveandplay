# Comments playbook: wide mode of the main Bluesky account ("комментарии saveandplay 2")

Written 20 Oct 2026 at the owner's request: "too few comments come out per day". It is the SAME account (@saveandplay.com) and the same Style rules as docs/comments-saveandplay.md, with a lower threshold, more search words and more posts per visit.
The owner sends replies manually. Claude only drafts replies, never publishes.

## Which phrase does what
- "комментарии saveandplay 2" = ONLY this wide mode of the main Bluesky account. It does NOT take Mastodon, Cozy or Retro.
- "комментарии saveandplay" (no 2) = all accounts at once, the normal mode (docs/comments-saveandplay.md, "All accounts in one run"). The wide mode is not part of it.
- The two modes share ONE memory "already shown", so a post shown in one mode never comes back in the other.

## What is different (settings: block `prices-wide` in data/comments-accounts.json, which extends `prices`)
- Threshold `minScore` 3 instead of 5: more statements without a question and older posts get into the list. The safety rules are the same as in the main mode (bots, shops, studios, promo, adult, non-English, console-only).
- Eight more groups of plain-word queries: `justBought`, `priceTalk`, `freeStuff`, `buyingHelp`, `playingNow`, `libraryChat`, `stores`, `bestOf`, and 6 queries from every group per run (the main mode takes 4).
- The visit shows up to 25 posts (the main mode 15).
- The finder builds its own list for it every 6 hours (`comments-prices-wide.json` on the branch `comments`), together with the other lists.

## Process
Read this file and, from docs/comments-saveandplay.md, only the sections Style, Which posts to pick and Pictures, video, quotes. Do NOT read comments-prices-wide.md. A program, not you, decides which posts are new.
1. Get the code and the list from GitHub exactly as in Process step 1 of docs/comments-saveandplay.md (`add_repo`, then the clone or `git pull`). The check here is: `grep -c '"prices-wide"' REPO/data/comments-accounts.json` and `grep -c shownAs REPO/scripts/comments-show.mjs`; if either prints 0, the wide mode is not published yet: tell the owner (Russian) to say `/publish` to Claude Code, and stop.
2. ONE shell command: `cd REPO && bash scripts/comments-branch.sh load && node scripts/comments-show.mjs --account prices-wide --record-new drafts/comments-shown-prices-wide-$(date -u +%Y%m%d-%H%M%S).json`. The new shown file MUST start with `comments-shown-prices-` (that is the shared memory); the name above does.
   - `STALE LIST` or `NO LIST`: start the workflow as in Process step 2 of docs/comments-saveandplay.md (one run makes every list, including this one; right after the first `/publish` the wide list may not exist yet), then repeat the command.
   - `NEW POSTS: 0`: tell the owner there is nothing new yet. No file to save.
3. Draft replies in English. The threshold is lower, so the list has weaker posts: take the ones where one true, specific thing can be said; skip the rest (they are remembered as shown and never come back). Do not relax any content rule: real people, PC games only, no links, no site or tool names, no promo, no invented prices or facts, never "buy it". For statements without a question a friendly reaction plus one true detail is enough (as in "Broad groups" of the main file).
   - `buyingHelp` and `priceTalk` are the core: neutral help ("check the price history", "reviews first"), never a price number you did not check.
   - `justBought`: congratulate, one short true detail; no deal talk.
   - `freeStuff`, `stores`: plain verified facts only (for example that GOG games are DRM-free); say "verify" to the owner if unsure.
   - `playingNow`, `libraryChat`, `bestOf`: broad talk, a different reply for every post.
4. Show the owner: direct post link, handle, draft (and "verify" where needed). Publish nothing.
5. Save the memory right away, before the owner answers, even if every post was skipped: `cd REPO && bash scripts/comments-branch.sh save drafts/comments-shown-prices-wide-STAMP.json` (the exact name from the REMEMBERED line). It must print `Saved to the comments branch.`; if not, tell the owner it failed.
6. Owner sends manually. If he edits a draft, note the change and offer to update this playbook.

## Limits
Meant for a couple of days (the owner's decision 20 Oct 2026). Up to about 30-35 replies a day on the main account in total, spread over the day, never in a burst: a new account with many same-looking replies can get reported. Every reply is written for that one post, never a template. Say this only if he asks or sends many at once.
Stop the wide mode: use only "комментарии saveandplay" again; to switch the finder run off too, set `enabled: false` in the block `prices-wide`.

## Reply format to the owner (Russian, short)
What was done, what's next, what is needed from him.
