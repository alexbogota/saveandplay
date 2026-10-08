#!/usr/bin/env bash
# Keeps the record of Nostr posts (posted-nostr.json) on the same git branch as the daily brief, called "brief",
# so the main branch (and the site deploy) is never touched. Also reads the brief files made by the daily brief from that branch.
#
#   bash scripts/nostr-branch.sh load    before posting: get drafts/brief-*.json and drafts/posted-nostr.json from the branch
#   bash scripts/nostr-branch.sh save    after posting: put drafts/posted-nostr.json on the branch and push it (nothing to do if it did not change)
#
# Used by the "Post to Nostr" workflow on GitHub. Environment: BRIEF_BRANCH (default "brief"), BRIEF_REMOTE (default "origin").
set -euo pipefail

BRANCH="${BRIEF_BRANCH:-brief}"
REMOTE="${BRIEF_REMOTE:-origin}"
STATE_FILE="posted-nostr.json"
cd "$(git rev-parse --show-toplevel)"

load() {
  if ! git fetch --quiet "$REMOTE" "$BRANCH" 2>/dev/null; then
    echo "There is no $BRANCH branch yet: the Daily brief has not run, so there is nothing to post." >&2
    return 0
  fi
  mkdir -p drafts
  local name
  for name in $(git ls-tree --name-only FETCH_HEAD); do
    case "$name" in
      brief-*.json | "$STATE_FILE")
        git show "FETCH_HEAD:$name" > "drafts/$name"
        echo "Loaded $name from the $BRANCH branch."
        ;;
    esac
  done
}

save() {
  if [ ! -f "drafts/$STATE_FILE" ]; then
    echo "No drafts/$STATE_FILE, nothing to save."
    return 0
  fi
  local attempt WT
  for attempt in 1 2 3; do
    WT="$(mktemp -d)"
    if git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
      git fetch --quiet "$REMOTE" "$BRANCH"
      git worktree add --quiet -B "$BRANCH" "$WT" FETCH_HEAD
    else
      echo "There is no $BRANCH branch to save to." >&2
      rm -rf "$WT"
      return 1
    fi
    cp "drafts/$STATE_FILE" "$WT/$STATE_FILE"
    git -C "$WT" add "$STATE_FILE"
    if git -C "$WT" diff --cached --quiet; then
      echo "The record of Nostr posts did not change, nothing to save."
      git worktree remove --force "$WT" >/dev/null 2>&1 || true
      return 0
    fi
    git -C "$WT" -c user.name="saveandplay-bot" -c user.email="bot@saveandplay.com" commit --quiet -m "Nostr posts $(date -u +%F)"
    if git -C "$WT" push --quiet "$REMOTE" "$BRANCH"; then
      echo "Saved to the $BRANCH branch."
      git worktree remove --force "$WT" >/dev/null 2>&1 || true
      return 0
    fi
    echo "Push was refused (another run changed the branch), trying again ($attempt of 3)." >&2
    git worktree remove --force "$WT" >/dev/null 2>&1 || true
    sleep $((attempt * 3))
  done
  echo "Could not save the record of Nostr posts after 3 tries. The note WAS posted: do NOT run the posting again before the record is fixed." >&2
  return 1
}

case "${1:-}" in
  load) load ;;
  save) save ;;
  *) echo "Usage: bash scripts/nostr-branch.sh load|save" >&2; exit 2 ;;
esac
