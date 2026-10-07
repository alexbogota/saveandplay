---
description: Publish everything that is waiting in the folder (articles, pictures, docs): build, check, commit in small commits, push, confirm the deploy.
---

Publish the waiting changes of this project. Do all steps yourself; do not ask the owner for anything unless a step fails. $ARGUMENTS

1. `git status` and `git pull --rebase`. The bots (`update-deals`, `daily-brief`) change `data/deals.json`, `data/history.json` and the `brief` branch, so always pull first. If a conflict appears, stop and explain it in plain words.
2. Look at what is waiting (changed and new files). Typical items: articles in `src/pages/guides/*.md` or `src/pages/servers/*.md`, their pictures in `public/og/`, `src/layouts/`, `CLAUDE.md`, `PROJECT.md`. Do not touch secrets (`.env`, keys) and never use a forced push.
3. Check the articles you are about to publish:
   - the header has `title`, `description`, `updated` (YYYY-MM-DD);
   - guides have `image` (file exists in `public/`, 1200x630) and `imageAlt`;
   - the text has no affiliate links in guides, and facts have a "Sources" list.
4. Run `npm run build`. If it fails, find the cause and fix it if it is small; otherwise stop and report. Never push a broken build.
5. In the built `dist/` open the page of every new or changed article and check: `og:image` points to the article's own picture (a full address), `og:title` and `og:description` are present, the article appears in the `/guides/` or `/servers/` list.
6. Commit in small commits by topic (for example: the article with its picture; the layout change; the docs). Clear messages in English. If a decision changed, update `PROJECT.md` (section 11, the decision log) in the same push.
7. `git push`. The push starts the deploy. If `gh` is available, watch the deploy workflow until it ends and report the result. When it succeeds, open the live address of each published article and confirm it loads.
8. Report to the owner in Russian, in plain words and briefly: what was published, the live links, anything that needs attention. Do not list steps.
