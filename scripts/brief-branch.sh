#!/usr/bin/env bash
# Keeps the daily brief on its own git branch called "brief", so the main branch (and the site deploy) is never touched.
#
#   bash scripts/brief-branch.sh load    before the brief: get yesterday's state (drafts/brief-state.json)
#   bash scripts/brief-branch.sh save    after the brief: put drafts/brief-*.md, brief-*.json and items-*.json on the branch and push it
#
# Used by the "Daily brief" workflow on GitHub. Every day is one commit, so the branch history is an archive of all briefs.
# Environment: BRIEF_BRANCH (default "brief"), BRIEF_REMOTE (default "origin").
set -euo pipefail

BRANCH="${BRIEF_BRANCH:-brief}"
REMOTE="${BRIEF_REMOTE:-origin}"
cd "$(git rev-parse --show-toplevel)"

load() {
  if git fetch --quiet "$REMOTE" "$BRANCH" 2>/dev/null && git cat-file -e FETCH_HEAD:brief-state.json 2>/dev/null; then
    mkdir -p drafts
    git show FETCH_HEAD:brief-state.json > drafts/brief-state.json
    echo "Loaded the earlier state from the $BRANCH branch."
  else
    echo "No earlier state yet (first run)."
  fi
}

save() {
  shopt -s nullglob
  local files=(drafts/brief-*.md drafts/brief-*.json drafts/items-*.json)
  if [ ${#files[@]} -eq 0 ]; then
    echo "No brief files in drafts/, nothing to save." >&2
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
  cp "${files[@]}" "$WT"/
  git -C "$WT" add -A
  if git -C "$WT" diff --cached --quiet; then
    echo "The brief did not change, nothing to save."
    return
  fi
  git -C "$WT" -c user.name="saveandplay-bot" -c user.email="bot@saveandplay.com" commit --quiet -m "Daily brief $(date -u +%F)"
  git -C "$WT" push --quiet "$REMOTE" "$BRANCH"
  echo "Saved to the $BRANCH branch."
}

case "${1:-}" in
  load) load ;;
  save) save ;;
  *) echo "Usage: bash scripts/brief-branch.sh load|save" >&2; exit 2 ;;
esac
