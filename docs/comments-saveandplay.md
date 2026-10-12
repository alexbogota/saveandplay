# Comments playbook: Bluesky account @saveandplay.com

Applies ONLY to https://bsky.app/profile/saveandplay.com (PC game deals site). Other accounts get their own files: docs/comments-NAME.md.
The owner sends replies manually from this account. Claude only finds posts and drafts replies, never publishes.
The built-in browser is logged in to a DIFFERENT account. That is fine: searching needs only public posts. Never enter passwords or add accounts.
Do not re-read the account's past replies and do not check for duplicates: the owner sees it himself.

## Style (replies always in English)
Write like a very helpful community member, not a brand. These replies get likes and follows.
- 1-3 short sentences, conversational tone.
- Exactly one practical tip related to the post.
- If it fits, start with a short reaction ("Nice find.", "Backlog first is a solid plan.").
- No links, no site name, no promo, no "follow us". #ad is not needed. If an affiliate link ever appears, add #ad.
- Never name or recommend any third-party site, tracker or service (no gg.deals, IsThereAnyDeal, key shops, etc.): it is free spam for someone else. Name one only if the post author named it first. Say "check the price history" or "wishlist it" without naming a tool. Naming the big stores (Steam, GOG, Epic) as plain facts is fine.
- Emoji: at most one, only if it matches the author's tone.
- Never argue, lecture, or push "buy it".
- Never invent prices, numbers or rules. If unsure about a fact (refunds, DRM), check the official page or flag it to the owner ("verify").

## Examples that worked (post -> reply)
- Wants games not locked to a platform. -> "Yes, that's the idea. GOG sells every game DRM-free: you download the installer, keep the files, and can back them up. No account or launcher needed to run them. Steam works differently, it's a license tied to your account"
- Surprised how many DRM-free offline games exist. -> "Agreed, and it's not only GOG. Itch.io is DRM-free too, and a lot of older classics are on both. Buy once, keep the installer, done."
- Wants to wait for a sale on a new game. -> "Backlog first is a solid plan. If you do wait, look at the game's price history before buying so you know what a real low looks like"
- Recommends a price comparison site. -> "gg.deals is a handy one. Quick tip: check whether a price is from an official store or a key reseller, since refunds are usually easier with official stores"
- Steam games won't run on a MacBook. -> "On Steam's search page you can narrow results by operating system, so you only see games with a Mac version. The system requirements section on each store page also lists it before you buy"
- Low-end PC, which RTS to play. -> "Older RTS games are the safe bet for a low-end PC, and Age of Empires II is a good place to learn the basics. Keep your workers building non-stop, scout early, and don't let resources pile up unspent. Those habits carry over to most RTS games."
- Found a $2 game on GOG. -> "Nice find. Worth remembering that GOG copies are DRM-free, so you can keep the installer and play offline whenever you like."
- Finally bought a horror game on sale. -> "Waiting it out paid off, nice. Hope the scares lived up to it."

## Which posts to pick
- Real people (not bots, stores, or devs promoting their own game), post age under 1-2 days.
- Topics: PC game discounts, Steam/GOG/Epic/itch sales, wishlists, DRM-free, refunds, price history, system requirements and compatibility, games for low-end PCs, bundles, backlog, what to play.
- Best: questions, or someone unsure before buying.
- Skip: posts where replies are limited (see the check below), piracy, rants and fights, politics, NSFW, people in a hard emotional state, other people's ads.
- Skip posts by devs promoting their own game (so no `indie dev` / `game dev` queries).
- Skip anything about bypassing regional pricing (VPN, region-locked keys): Steam forbids it, we never give that advice.
- Skip "is Kinguin / key site safe" questions: answer only after checking facts, and flag to the owner ("verify").

## Keyword groups
Each run: take 2-3 queries from DIFFERENT groups (rotate, do not repeat the same group twice in a row).

1. Bundles (warm topic, we have guides): `is this bundle worth it`, `worth it bundle`, `Humble Bundle`, `Humble Choice`, `Fanatical bundle`, `Indie Gala`, `itch.io bundle`, `bundle tiers`, `pay what you want games`, `redeem key`, `key activation`
2. Deal hunting: `steam sale`, `Steam Next Fest`, `historical low`, `all-time low`, `wishlist`, `Steam wishlist`, `game deals`, `PC game deals`, `free games this week`, `free on Epic`, `Epic free game`, `GOG sale`, `gg.deals`, `IsThereAnyDeal`, `price tracker`, `price drop alert`, `Steam gift card`
3. Pre-purchase questions (best group, people ask for advice): `should I buy`, `worth buying`, `wait for a sale`, `is it on sale`
4. Backlog and what to play: `backlog`, `pile of shame`, `unplayed games`, `what should I play`, `game recommendations`, `looking for games like`, `cozy games`, `co-op games`, `short games`, `games under $10`, `games under $5`, `hidden gems`, `underrated games`
5. Genres and communities: `roguelike`, `deckbuilder`, `metroidvania`, `soulslike`, `farming sim`, `visual novel`, `city builder`, `horror games`, `JRPG`, `Steam Deck`, `Steam Deck verified`, `handheld PC`, `low-end PC games`
6. Releases and editions: `Halloween games`, `spooky games`, `horror sale`, `Scream Fest` (Steam Halloween sale: verify the dates before mentioning), `remaster`, `GOTY edition`, `complete edition`, `DLC sale`
7. Practical pains (answer only with facts we can verify): `refund steam`, `Steam refund policy`, `Game Pass vs buying`, `subscription vs own`, `physical vs digital`, `digital ownership`, `DRM-free`

Seasonal: in October lean on group 6 (Halloween). Change the seasonal queries each month.

## How to search
Open https://bsky.app/search?q=QUERY&tab=latest (it must be tab=latest), wait 3 seconds, then pull posts and links with javascript_tool (loop over a[href*="/post/"], take the nearest container text). API search from the page does not work.
2-3 queries and 4-6 posts per run is enough. Do not browse endlessly.

## What the search showed (2026-10-12)
- Bad queries (mostly devs promoting their games or off-topic): `should I buy`, `steam wishlist`, `horror games recommend`. Do not use alone.
- Good queries (real people, fresh): `"wait for a sale"`, `steam backlog`, `"Humble Bundle"`. Add `steam` or `PC` when the query is generic.
- Posts are often about consoles (Switch, PS5). Check the platform before replying, we only help with PC.
- Run the extraction in one JS call and filter by age (`· Nм`, `· Nч`, `· 1д`). Search results show many old posts.
- Also good: `steam deck games` (people ask for recommendations; filter out news bots). Weak: Epic/free-game queries (only deal bots), `cozy games pc`, `cheap games steam under $10`, `bundle worth it games` (empty or our own posts).
- Expect 6-8 usable posts per run, not 10. Do not pad the list with weak posts.

## Check that replies are open (do this before drafting)
Some authors limit who can reply ("Some people can reply" in the app). Then the owner cannot answer, so skip those posts.
For each candidate, run in the browser page (bsky.app) with javascript_tool, using the public API (no login):
1. Resolve the handle: `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=HANDLE` -> did.
2. `https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=at://DID/app.bsky.feed.post/RKEY` -> if `posts[0].threadgate` exists, replies are limited: skip.
3. If the post is itself a reply (`posts[0].record.reply.root.uri`), run step 2 on the ROOT post too. The root's limit applies to the whole thread.

## When the owner gets a reply to one of our comments
The app shows only "Replied to you". To find which comment it answers: in the browser page fetch
`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=HANDLE&filter=posts_with_replies&limit=30`,
find their post by its text, and read `reply.parent` (our comment) and `reply.root` (original post). Give the owner a link: `https://bsky.app/profile/saveandplay.com/post/RKEY`.
Do not answer jokes or sarcasm. Answer only real questions.

## Process
1. Find posts, write drafts.
2. Show the owner: direct post link, handle, draft. Publish nothing.
3. Owner sends manually. If he edits a draft, note the change and offer to update this playbook.

Reply format to the owner (Russian, short): what was done, what's next, what is needed from him.
