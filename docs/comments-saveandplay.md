# Comments playbook: Bluesky account @saveandplay.com

Applies ONLY to https://bsky.app/profile/saveandplay.com (PC game deals site). Other accounts get their own files: docs/comments-NAME.md.
The owner sends replies manually from this account. Claude only drafts replies, never publishes.
Posts are found by a PROGRAM, not by Claude: `npm run comments:find` (run by the owner in C:\saveandplay, or by a schedule) writes `C:\saveandplay\drafts\comments-prices.md`. Its settings (search queries, stop words, scores) are in `data/comments-accounts.json`, the description is in `docs/comments-finder.md`. Do NOT search Bluesky through the browser: it costs many tokens and has no memory of what was already shown.

## Process (owner says "комментарии saveandplay")
1. Read ONLY `C:\saveandplay\drafts\comments-prices.md` (device_stage_files, then Read). If the file is missing, or the "Made ..." time at the top is older than 12 hours, tell the owner to run `npm run comments:find` in C:\saveandplay and stop. Do not read other files.
2. The list is pre-filtered but not perfect. Pick only posts that really fit (see "Which posts to pick"). 3-6 good drafts are better than 10 weak ones. Say honestly if few posts fit.
3. Show the owner: direct post link, handle, draft (and "verify" for any fact you are unsure about). Publish nothing.
4. Record EVERY post that was in the list (also the ones you skipped as weak), so it is never offered again: write a new small file `comments-shown-prices-YYYYMMDD-HHMM.json` (a JSON array of the post links from the list) to /mnt/user-data/outputs/ and send it with device_commit_files to `C:\saveandplay\drafts\comments-shown-prices-YYYYMMDD-HHMM.json`. Always a NEW file, never edit older ones. The program reads all of them and skips these posts. (It already skips posts our account has answered.)
5. Owner sends manually. If he edits a draft, note the change and offer to update this playbook.

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
