# Comments playbook: Bluesky account @cozygame.bsky.social (Cozy)

Applies ONLY to https://bsky.app/profile/cozygame.bsky.social ("SaveAndPlay · Cozy Games Deals"). Written 16 Oct 2026 (task 3 of docs/tasks-cozy-retro-claudecode.md).
Phrases: "комментарии saveandplay" = ALL accounts at once, Cozy is one block of that run (process in docs/comments-saveandplay.md, section "All accounts in one run"); "комментарии cozy" = this account only (process below).
Replies of this account are SENT BY THE PROGRAM after the owner's «ок» (since 20 Oct 2026, same way and same checks as the main account: docs/comments-saveandplay.md, "Sending through the program"): the app password of this account is the GitHub secret BSKY_APP_PASSWORD_COZY, at most 30 replies a day. Claude drafts, saves the drafts with `node scripts/comments-drafts.mjs new --account cozy --stamp STAMP --in FILE`, shows them exactly as printed, and never posts anything itself. If `new` prints SENT BY HAND, the program does not send for this account yet: the owner sends by hand as before.

## Where the posts come from
A PROGRAM finds them, as for the main account (docs/comments-finder.md): the "Comment candidates" workflow on GitHub, every 6 hours, block `cozy` of `data/comments-accounts.json`, list `comments-cozy.md/json` on the branch `comments`. It searches under the login of the main account (read only, no extra password) and reads the account's own replies from its public feed, so it never offers a post we already answered. Do NOT search Bluesky yourself.
Its own memory "already shown": files `comments-shown-cozy-*.json`, separate from every other account.

## Process for "комментарии cozy" (this account only)
Same steps as "Process" in docs/comments-saveandplay.md (steps 1 to 6), with these changes: use `--account cozy` and the files `comments-shown-cozy-STAMP.json`:
`cd REPO && bash scripts/comments-branch.sh load && node scripts/comments-show.mjs --account cozy --limit 8 --record-new drafts/comments-shown-cozy-$(date -u +%Y%m%d-%H%M%S).json`, then after drafting (`new --account cozy`, see above) `bash scripts/comments-branch.sh save drafts/comments-shown-cozy-STAMP.json drafts/comments-drafts-cozy-STAMP.json`. After the owner's answer: `approve --account cozy --ok all` (or numbers) and the ONE command it prints. The replies below are drafted from this file only.

## Voice
Warm, quiet, a little cozy. Like a friend who loves calm games and has time to talk about them. Short and kind, never loud, no hype words ("amazing deal", "must buy"), no sales tone.
- 1-3 short sentences. Start with a human reaction ("Oh, that sounds like a lovely evening.") when it fits.
- First the use: one concrete, TRUE thing for this person (a game that fits what they ask for and why, how a game feels, a setting that helps, what Steam Deck does well with it). First interest, then help.
- Emoji: at most one, only if the author uses them (a leaf, a mug, a plant fits; never a row of them).
- English only.

## Rules (all rules of docs/comments-saveandplay.md apply: Style and Which posts to pick)
- No links, no site name, no promo, no "follow us", no affiliate links in comments at all. Never mention a deal, a price or a sale unless the author asks about price; even then say "check the price history" without naming a tool.
- Never name or recommend a third-party site, tracker or service.
- Never invent a fact, a price or a feature. Unsure: write "verify" to the owner.
- PC and Steam Deck are our ground. Cozy posts often do not name a platform: that is fine. Console-only posts are already dropped by the finder; if one slips through, skip it.
- Calm games are not only "cozy": cozy sims, farming, life sims, city builders, point-and-click, puzzle, gentle adventure. Do NOT call a game cozy if it is not (a survival or horror game is not cozy even when the author says "chill").
- Skip: artists and streamers promoting their own work, fan art, commissions, "look at my farm" posts that ask nothing and give nothing to answer, adult content, politics, fights, sadness (if the author is in a hard moment, answer nothing).
- Heated topics (AI and similar): neutral facts only, or skip.
- The finder keeps posts that ask something and posts of search groups; if a post asks nothing and a reply would feel pushy, skip it. Fewer, better replies win: this account is new and quiet.

## Examples (post -> reply)
These show the tone and the length only. Every game fact in a real reply must be checked first (say "verify" to the owner if unsure); do not copy a recommendation from here.
- "Looking for a cozy game like Stardew Valley for the weekend, any ideas?" -> "Oh, a weekend like that sounds lovely. If you liked the slow pace of Stardew, Coral Island and Fields of Mistria are the closest in feel: farming, friends, no rush. Verify they're on your platform first."
- "What cozy games work best on the Steam Deck?" -> "Farming and building games feel great on the Deck since you can play in short, calm sessions on the couch. Stardew Valley and Dorfromantik both run well on it."
- "Does anyone like Stardew Valley here" -> "Very much. It's the kind of game you can open for twenty minutes and still feel like you got something done."

## Limits
Start modest: 5-10 replies a day for this account (the program never sends more than 30 in 24 hours; new account, many identical-looking replies can get it reported), spread over the day; raise it after the first two weeks if likes and follows come. Tell the owner only if he asks or sends many at once. Every reply is written for that one post, never a template. Nothing is published without the owner's "ok".

## Reply format to the owner (Russian, short)
What was done, what's next, what is needed from him.
