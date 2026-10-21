# Posts to Bluesky after the owner's «ок» (phrase: «пост на сегодня»)

Decided 21 Oct 2026 (docs/decisions.md). The daily brief (06:00 Bogota) writes a ready post for every account in `drafts/post-<account>-bluesky.md` on the `brief` branch. The owner sees it in the chat, says «ок», and the program posts exactly that text. Claude never posts anything itself, and a post the owner did not approve is never posted. Mastodon is still copied by the owner by hand.

## Process («пост на сегодня»)
Read nothing else. Everything is in the repository alexbogota/saveandplay (REPO below; if `/home/claude/saveandplay` exists use it, else `add_repo` with access push and clone once).
1. `cd REPO && git checkout main && git pull -q && bash scripts/comments-branch.sh load && node scripts/post-bluesky.mjs show`. If `scripts/post-bluesky.mjs` is missing the program is not published yet: use the old way from the skill `post-for-today` (show the file, the owner pastes it) and tell him once to say `/publish`.
2. Show the owner each post EXACTLY as printed (English, in a code block), with the account name. `NO POST TODAY` is told with its reason. A post with PROBLEMS is told in one line and cannot be approved: a new brief comes tomorrow at 06:00 Bogota.
3. The owner says «ок» («ок все», «ок 1», «ок без 2»): `node scripts/post-bluesky.mjs approve --ok all` (or numbers, `--skip`), then the ONE command it prints (it saves the approval on the branch and starts the workflow «Post to Bluesky»). «стоп»: `node scripts/post-bluesky.mjs cancel`, then the command it prints.
4. After about a minute read the result: `gh run list -R alexbogota/saveandplay --workflow "Post to Bluesky" --limit 1`; the report with the link of every post is `posts-sent-*.json` on the `comments` branch (`bash scripts/comments-branch.sh load`, then the newest file in `drafts/`). Tell the owner (Russian, short) which posts are live and give their links. A post that could not go (our page did not open, a password problem) is named with the reason.
5. A dry run (nothing is posted): `gh workflow run "Post to Bluesky" -R alexbogota/saveandplay --ref main -f dry_run=true`.

## What the program does (and checks again right before each post)
Posts the approved text like the app: the link shortened to 25 characters (the full address in a facet), #tags as facets, a link card with the title, description and picture of OUR page of the game. Refuses: an approval older than 20 hours, a post older than 1 day, a last line that is not `Ad`, not exactly one link to our page, "lowest ever", a deal that is not listed any more or at another price, a sale that ends within the hour, our page that does not answer 200 (then it waits for the next run), a post with the same page of ours on the feed of the account in the last 36 hours (also a post made by hand). The account that posts is the one of the brief block; the Kinguin post goes from the main account as its second post. Passwords: the secrets of the three accounts (BSKY_APP_PASSWORD, _COZY, _RETRO), the same as for the replies; the program checks that the login is the right account.

## Settings
`data/accounts.json`: `accounts.<id>.channels.bluesky.publish` = `{ "enabled": true, "passwordEnv": "SECRET_NAME" }` (also `gapSeconds`, `maxApprovalAgeHours`, `maxDayAge`, `duplicateHours`, `minHoursLeft`, see `scripts/lib/bsky-posts.mjs`). Switch off: `enabled: false` (then the owner pastes the post by hand again). A new account = a new block, the code does not change.

## Reply format to the owner (Russian, short)
What was done, what is next, what is needed from him.
