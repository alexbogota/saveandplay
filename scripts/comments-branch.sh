#!/usr/bin/env bash
# Keeps the comment candidates on their own git branch called "comments", so the main branch (and the site deploy) is never touched.
#
#   bash scripts/comments-branch.sh load    before the search: get the state of earlier runs (and the "shown" lists) into drafts/
#   bash scripts/comments-branch.sh save    after the search: put drafts/comments-*.md and drafts/comments-*.json on the branch and push it
#
# Used by the "Comment candidates" workflow on GitHub (not meant to be run on a working computer: it deletes a local branch named "comments"). On the branch, in its root folder:
#   comments-<account>.md             the short list Claude reads ("комментарии saveandplay")
#   comments-<account>.json           the same with all fields
#   comments-state-<account>.json     which queries are next, which posts are still fresh
#   comments-shown-<account>-*.json   posts Claude already showed (Claude adds these files; the search never lists such posts again)
# Every run is one commit, so the branch history is an archive. Environment: COMMENTS_BRANCH (default "comments"), COMMENTS_REMOTE (default "origin").
set -euo pipefail

BRANCH="${COMMENTS_BRANCH:-comments}"
REMOTE="${COMMENTS_REMOTE:-origin}"
cd "$(git rev-parse --show-toplevel)"

load() {
  if git fetch --quiet "$REMOTE" "$BRANCH" 2>/dev/null; then
    mkdir -p drafts
    local f n=0
    for f in $(git ls-tree --name-only FETCH_HEAD); do
      case "$f" in
        comments-*.json|comments-*.md) git show "FETCH_HEAD:$f" > "drafts/$f"; n=$((n + 1)) ;;
      esac
    done
    echo "Loaded $n files from the $BRANCH branch."
  else
    echo "No earlier state yet (first run)."
  fi
}

# One try inside a fresh checkout of the branch: copy the files, commit, push.
# Returns 0 = saved or nothing changed, 1 = the push lost a race (try again), 2 = a git command failed (stop).
# It is called inside "||", where "set -e" does not work, so every command that can fail is checked by hand.
save_into() {
  local WT="$1"; shift
  if git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
    git fetch --quiet "$REMOTE" "$BRANCH" || return 2
    git worktree add --quiet -B "$BRANCH" "$WT" FETCH_HEAD || return 2
  else
    # first run: a new branch with no history and none of the site files
    git worktree add --quiet --detach "$WT" HEAD || return 2
    git -C "$WT" checkout --quiet --orphan "$BRANCH" || return 2
    git -C "$WT" rm -rfq . || return 2
  fi
  cp "$@" "$WT"/ || return 2
  git -C "$WT" add -A || return 2
  if git -C "$WT" diff --cached --quiet; then
    echo "The list did not change, nothing to save."
    return 0
  fi
  git -C "$WT" -c user.name="saveandplay-bot" -c user.email="bot@saveandplay.com" commit --quiet -m "Comment candidates $(date -u +%FT%H:%MZ)" || return 2
  if git -C "$WT" push --quiet "$REMOTE" "$BRANCH" 2>/dev/null; then
    echo "Saved to the $BRANCH branch."
    return 0
  fi
  return 1
}

try_save() {
  local WT rc=0
  WT="$(mktemp -d)"
  git worktree prune
  git branch -D "$BRANCH" >/dev/null 2>&1 || true   # left over from an earlier try in this same run
  save_into "$WT" "$@" || rc=$?
  git worktree remove --force "$WT" >/dev/null 2>&1 || true
  return $rc
}

save() {
  shopt -s nullglob
  local files=(drafts/comments-*.md drafts/comments-*.json) i rc
  if [ ${#files[@]} -eq 0 ]; then
    echo "No comment files in drafts/, nothing to save." >&2
    exit 1
  fi
  for i in 1 2 3; do
    rc=0
    try_save "${files[@]}" || rc=$?
    case "$rc" in
      0) return 0 ;;
      1) echo "The push lost a race (someone else wrote to $BRANCH at the same time), trying again ($i of 3)." >&2; sleep 2 ;;
      *) echo "A git command failed while saving to the $BRANCH branch, see the message above." >&2; exit 1 ;;
    esac
  done
  echo "Could not save to the $BRANCH branch after 3 tries." >&2
  exit 1
}

case "${1:-}" in
  load) load ;;
  save) save ;;
  *) echo "Usage: bash scripts/comments-branch.sh load|save" >&2; exit 2 ;;
esac
