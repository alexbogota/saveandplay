#!/usr/bin/env bash
# Keeps the daily article drafts on their own git branch called "articles", so the main branch (and the site deploy) is never touched.
#
#   bash scripts/article-branch.sh load    before the writer: get the earlier state (drafts/articles-state.json) and the latest Daily brief
#                                          (drafts/brief-<account>.md, read from the "brief" branch)
#   bash scripts/article-branch.sh save    after the writer: put the new draft on the branch as articles/<date>-<slug>/ and push it
#
# Used by the "Daily article" workflow on GitHub. Every draft is one commit, so the branch history is an archive of all drafts.
# Environment: ARTICLE_BRANCH (default "articles"), BRIEF_BRANCH (default "brief"), ARTICLE_REMOTE (default "origin").
set -euo pipefail

BRANCH="${ARTICLE_BRANCH:-articles}"
BRIEF_BRANCH="${BRIEF_BRANCH:-brief}"
REMOTE="${ARTICLE_REMOTE:-origin}"
cd "$(git rev-parse --show-toplevel)"

load() {
  mkdir -p drafts
  if git fetch --quiet "$REMOTE" "$BRANCH" 2>/dev/null && git cat-file -e FETCH_HEAD:articles-state.json 2>/dev/null; then
    git show FETCH_HEAD:articles-state.json > drafts/articles-state.json
    echo "Loaded the earlier state from the $BRANCH branch."
  else
    echo "No earlier drafts yet (first run)."
  fi
  local account
  account="$(node -p "require('./data/articles.json').briefAccount || 'prices'" 2>/dev/null || echo prices)"
  if git fetch --quiet "$REMOTE" "$BRIEF_BRANCH" 2>/dev/null && git cat-file -e "FETCH_HEAD:brief-$account.md" 2>/dev/null; then
    git show "FETCH_HEAD:brief-$account.md" > "drafts/brief-$account.md"
    echo "Loaded the latest brief ($account) from the $BRIEF_BRANCH branch."
  else
    echo "No brief found on the $BRIEF_BRANCH branch; the writer will pick an evergreen topic."
  fi
}

save() {
  if [ ! -f drafts/article-run.json ]; then
    echo "No drafts/article-run.json: nothing to save." >&2
    exit 1
  fi
  local date slug src dest
  date="$(node -p "require('./drafts/article-run.json').date")"
  slug="$(node -p "require('./drafts/article-run.json').slug || ''")"
  if [ -z "$slug" ]; then
    echo "The draft was not finished (no slug in drafts/article-run.json), nothing to save." >&2
    exit 1
  fi
  src="drafts/articles/$date"
  dest="articles/$date-$slug"
  if [ ! -d "$src" ]; then
    echo "Missing folder $src." >&2
    exit 1
  fi
  WT="$(mktemp -d)"
  trap 'git worktree remove --force "$WT" >/dev/null 2>&1 || true' EXIT
  if git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
    git fetch --quiet "$REMOTE" "$BRANCH"
    git worktree add --quiet -B "$BRANCH" "$WT" FETCH_HEAD
  else
    # first run: a new branch with no history and none of the site files
    git worktree add --quiet --detach "$WT" HEAD
    git -C "$WT" checkout --quiet --orphan "$BRANCH"
    git -C "$WT" rm -rfq .
  fi
  mkdir -p "$WT/$dest"
  cp -r "$src"/. "$WT/$dest"/
  cp drafts/articles-state.json "$WT/articles-state.json"
  git -C "$WT" add -A
  if git -C "$WT" diff --cached --quiet; then
    echo "The draft did not change, nothing to save."
    return
  fi
  git -C "$WT" -c user.name="saveandplay-bot" -c user.email="bot@saveandplay.com" commit --quiet -m "Daily article $date: $slug"
  git -C "$WT" push --quiet "$REMOTE" "$BRANCH"
  echo "Saved to the $BRANCH branch as $dest."
}

case "${1:-}" in
  load) load ;;
  save) save ;;
  *) echo "Usage: bash scripts/article-branch.sh load|save" >&2; exit 2 ;;
esac
