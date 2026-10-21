# Morning run: phrase «день saveandplay»

Decided 21 Oct 2026 (docs/decisions.md). One phrase in the morning gives the owner EVERYTHING to approve in one message: the deal posts of the day, the post about the guide of the day, and the comments of all accounts. One answer («ок все») and the programs do the rest. Claude never posts anything itself; nothing goes without the owner's «ок».

Read only this file, `docs/posts-bluesky.md` and `docs/comments-saveandplay.md` (section «All accounts in one run» and the files of the accounts that have posts). Nothing else.

## Steps
REPO = `/home/claude/saveandplay` if it exists, else `add_repo` (owner alexbogota, repo saveandplay, access push) and one clone as in docs/comments-saveandplay.md, Process step 1.
1. `cd REPO && git checkout main && git pull -q`. If `scripts/post-bluesky.mjs` or `data/post-schedule.json` is missing, the new code is not on main yet: tell him (Russian, one line) to say «влей в main» / `/publish`, then do only what exists (comments by the old playbook, posts by the skill `post-for-today`).
2. Posts and guide: `bash scripts/comments-branch.sh load && node scripts/post-bluesky.mjs show`. It prints, numbered: the deal of the main account, the second deal, the Kinguin post (every second day), Cozy, Retro, and the GUIDE POST (the oldest draft of the daily writer that is not on the site yet). Show each EXACTLY as printed, in a code block. For each, say the hour it will go (see «The hours» below).
3. Guide: also give, in 3-4 lines in Russian, what the guide is about (title and the first lines of the draft: `node scripts/article-tools.mjs list`; the notes «откуда каждая цифра» are in the Summary of the «Daily article» run; give him that link only if he asks). He does not have to read it all: the checks of the program have passed (words, links, no affiliate links, picture).
4. Comments: do «All accounts in one run» of docs/comments-saveandplay.md, steps 2-5 (the ONE command, drafts for the accounts that have new posts through `comments-drafts.mjs new`, save the memory). Show the blocks after the posts, in the same message. If it is the wide mode day he can say “день saveandplay 2”: use docs/comments-saveandplay-2.md for this step instead.
5. ONE message to the owner (Russian, short), in this order: 1) the posts and their hours, 2) the guide, 3) the comments blocks with how to answer. At the end, one line: «ок все» = everything; or name parts: «ок посты», «ок статья», «ок комменты», «ок cozy», «ок без 3», «стоп».
6. His answer:
   - Posts («ок все» / «ок посты» / numbers): `node scripts/post-bluesky.mjs approve --ok all` (or numbers, `--skip`; `--now` only if he asks for everything at once), then the ONE command it prints.
   - Guide («ок статья», or «ок все»): the guide must be on the site before its post goes. If it is not yet: run the publish steps of `PUBLISH.md` for it (`node scripts/article-tools.mjs take SLUG`, build, checks, commit, push to main). That is a deploy of the site: do it only when his answer names the guide or says «ок все», and if the system asks for a permission, tell him exactly that one thing is blocked and wait for his word «влей в main» / «да, выкладывай статью». Its post waits for its hour and for the page: the program opens the page before posting.
   - Comments: as in docs/comments-saveandplay.md, «Sending through the program» (approve per account, ONE command that saves the approvals and starts «Send comments»).
7. Tell him (Russian, short): how many posts and replies go, the hours of the posts, and that the result (with links) will be in the Summary of the runs and in `status`. «стоп» works for both (`post-bluesky.mjs cancel`, `comments-drafts.mjs cancel`).
8. Later in the day, when he asks «как дела» or says the phrase again: `bash scripts/comments-branch.sh load`, read the newest `posts-sent-*.json` and tell which posts are live (links) and which are still waiting for their hour.

## The hours (data/post-schedule.json)
The posts of ONE Bluesky account go one after another, `spacingHours` apart (now 3): the first at once, the second 3 hours later, the guide 3 hours after that (order: prices, prices-2, article, prices-kinguin). Cozy and Retro have their own lines. The sender on GitHub looks every hour (07:07-18:07 Bogota), so a post goes out within about an hour after its hour. The times are written into the approval file and shown in Bogota time by `approve`. To change the spacing or the order, edit `data/post-schedule.json` (no code change).

## Rules that stay
Text of posts is made by the daily brief, never by a model; the program posts the exact approved text and checks it again right before it goes. The guide post has no `Ad` line (no affiliate links in guides). Mastodon is still pasted by the owner from the Summary of the Daily brief: mention it in one line.
