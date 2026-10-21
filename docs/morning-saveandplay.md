# Morning run: phrase «день saveandplay»

Decided 21 Oct 2026 (docs/decisions.md). One phrase gives the owner EVERYTHING to approve in one message: the deal posts of the day, the post about the guide of the day and the comments of all accounts. One answer («ок все») and the programs do the rest. Claude never posts anything itself; nothing goes without the owner's «ок».

The steps and the short reply rules live in the skill `saveandplay-morning` (so the chat reads no long file in the morning). This file is the reference: change a rule here AND in the skill (propose_skills).

## The reading command (21 Oct: scripts/morning.mjs, `npm run morning:test`)
`cd REPO && git checkout -q main && git pull -q && node scripts/morning.mjs` (`--wide` for «день saveandplay 2», `--no-start` to never start the workflow by itself, `--stamp S` to fix the STAMP). It does in ONE command: `comments-branch.sh load`, `post-bluesky.mjs show`, `comments-drafts.mjs status`, `comments-show.mjs --all [--wide] --record-new-all STAMP`, and prints sections LOAD, POSTS (one summary line, the posts exactly as printed), SENDING STATUS (limits and QUALITY only), COMMENTS (one block per account, then the SAVE command), NEXT.
STALE LIST / NO LIST: it starts the workflow «Comment candidates» once, waits up to 6 minutes, loads the branch again and runs the step with `--partial`. If gh is refused or the run fails, it runs with `--partial` anyway and prints an ACTION line for the owner (press Actions, Comment candidates, Run workflow). Exit code 1 = a part failed (the part says so).
It writes only the "shown" files in drafts/ and posts, approves and saves nothing: the replies (`comments-drafts.mjs new`), the SAVE command, the approvals and the owner's «ок» stay with the chat.

## After the owner's answer
- Posts: `node scripts/post-bluesky.mjs approve --ok all` (numbers, `--skip`; `--now` only if he asks for everything at once), then the ONE command it prints. «стоп»: `post-bluesky.mjs cancel`.
- Guide («ок статья» or «ок все»): it must be on the site before its post goes. If not, run the publish steps of `PUBLISH.md` (`article-tools.mjs take SLUG`, build, checks, commit, push to main). That is a deploy: do it only when his answer names the guide or says «ок все»; if the system blocks it, say that exactly one thing is blocked and wait for «влей в main». Its post waits for the page by itself.
- Comments: `comments-drafts.mjs approve --account ACCOUNT --ok all` (as in docs/comments-saveandplay.md, «Sending through the program»), then the ONE command it prints. Mastodon: he sends by hand.
- Later («как дела»): `bash scripts/comments-branch.sh load`, read the newest `posts-sent-*.json`, tell which posts are live (links) and which wait for their hour.

## The hours (data/post-schedule.json)
Posts of ONE Bluesky account go `spacingHours` apart (3): the first at once, the second 3 h later, the guide 3 h after that (order: prices, prices-2, article, prices-kinguin). Cozy and Retro have their own lines. The sender on GitHub looks every hour (07:07-18:07 Bogota), so a post goes out within about an hour after its hour. Change the spacing or the order in `data/post-schedule.json` (no code change).

## Rules that stay
Post texts are made by the daily brief, never by a model; the program posts the exact approved text and checks it again right before it goes. The guide post has no `Ad` line. Mastodon is pasted by the owner from the Summary of the Daily brief: one line about it.
