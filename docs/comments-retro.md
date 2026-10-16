# Comments playbook: Bluesky account @retrogamedeals.bsky.social (Retro)

Applies ONLY to https://bsky.app/profile/retrogamedeals.bsky.social (retro and classic PC game deals). Written 16 Oct 2026 (task 3 of docs/tasks-cozy-retro-claudecode.md).
Phrases: "комментарии saveandplay" = ALL accounts at once, Retro is one block of that run (process in docs/comments-saveandplay.md, section "All accounts in one run"); "комментарии retro" = this account only (process below).
The owner sends replies manually from this account. Claude only drafts replies, never publishes.

## Where the posts come from
A PROGRAM finds them, as for the main account (docs/comments-finder.md): the "Comment candidates" workflow on GitHub, every 6 hours, block `retro` of `data/comments-accounts.json`, list `comments-retro.md/json` on the branch `comments`. It searches under the login of the main account (read only, no extra password) and reads the account's own replies from its public feed. Do NOT search Bluesky yourself.
Its own memory "already shown": files `comments-shown-retro-*.json`, separate from every other account.
Unlike the main account, the finder does NOT drop console posts here: retro talk is mostly about consoles and nostalgia. You decide what to answer (see "Which posts").

## Process for "комментарии retro" (this account only)
Same steps as "Process" in docs/comments-saveandplay.md (steps 1 to 6), with these changes: use `--account retro` and the files `comments-shown-retro-STAMP.json`:
`cd REPO && bash scripts/comments-branch.sh load && node scripts/comments-show.mjs --account retro --limit 8 --record-new drafts/comments-shown-retro-$(date -u +%Y%m%d-%H%M%S).json`, then after drafting `bash scripts/comments-branch.sh save drafts/comments-shown-retro-STAMP.json`.

## Voice
Knowledgeable and friendly, without snobbery. Someone who remembers these games and likes talking about them, who does not look down on anyone for what they played or how. Plain words, a little dry humor allowed, no "back in my day", no gatekeeping ("real gamers"), no "actually".
- 1-3 short sentences. A shared memory or a short reaction first ("That soundtrack never leaves you."), then one useful, TRUE thing.
- Useful means: how to get an old game running on a modern PC in general terms, that GOG sells many classics DRM-free with fixes included, which version of a classic is the easy one to start with, what to expect from the controls or the pace today.
- Emoji: at most one, only if the author uses them.
- English only.

## Rules (all rules of docs/comments-saveandplay.md apply: Style and Which posts to pick, except where this file says otherwise)
- No links, no site name, no promo, no affiliate links in comments. The link to our own page of a game is allowed only if the author asks where to get that exact game AND we list it (check data/deals.json: the game must be there with a price); even then prefer words ("GOG has it, and it runs on modern Windows out of the box") and let the owner decide. Never name a third-party tracker or service.
- Do not claim a game is on sale unless data/deals.json says so; never invent a price or a date. Unsure: "verify".
- Console posts are allowed here (NES, SNES, Game Boy, PlayStation, Sega...). Be honest about what we know: we know PC and GOG. For a console memory give a human reaction only, with no PC advice, or skip it. Never suggest emulation, ROMs, or any download of copyrighted files.
- Skip: emulation how-tos, ROM or piracy talk (the finder already skips most), collectors selling hardware, hardware repair and modding, creators promoting their own channel, politics, fights about "best console", adult content, hard emotional moments.
- Heated topics (remakes versus originals, AI upscaling and similar): neutral facts only, or skip.
- Childhood and nostalgia posts without a question are fine if one short true detail or a warm reaction fits; do not force advice.
- Keep the rule "fewer, better replies": this account is new and quiet.

## Examples (post -> reply)
These show the tone and the length only. Every game fact in a real reply must be checked first (say "verify" to the owner if unsure); do not copy a recommendation from here.
- "What was your first PC game?" -> "Prince of Persia: The Sands of Time for me. Fun fact, it's one of those classics you can still buy DRM-free on GOG, so it runs on a modern PC without fiddling."
- "Does anyone still play old DOS games?" -> "All the time. The easy way in is a version that already comes set up for modern Windows, so you skip the sound card menus. Doom and the old Sierra adventures hold up surprisingly well."
- "Which old games actually hold up?" -> "The ones built on clear rules rather than graphics: SimCity 4, Syberia, the Prince of Persia trilogy all still play fine. Start with whichever you remember best, nostalgia helps with the clunky camera."
- (only a console memory, no PC angle) -> "That intro music is stuck in my head now." or skip.

## Limits
Start modest: 5-10 replies a day for this account, spread over the day; raise it after two weeks if the account gets likes and follows. Every reply is written for that one post, never a template. Nothing is published without the owner's "ok".

## Reply format to the owner (Russian, short)
What was done, what's next, what is needed from him.
