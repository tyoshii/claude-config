#!/bin/bash
input=$(cat)

DIR=$(echo "$input" | jq -r '.workspace.current_dir')

if git -C "$DIR" rev-parse --git-dir > /dev/null 2>&1; then
    BRANCH=$(git -C "$DIR" branch --show-current 2>/dev/null)
    GIT_DIR=$(git -C "$DIR" rev-parse --git-dir 2>/dev/null)
    if [[ "$GIT_DIR" == *".git/worktrees/"* ]]; then
        echo "$BRANCH (worktree)"
    else
        echo "$BRANCH"
    fi
else
    echo "${DIR##*/}"
fi
