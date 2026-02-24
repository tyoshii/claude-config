#!/bin/bash
input=$(cat)

DIR=$(echo "$input" | jq -r '.workspace.current_dir')

# Git branch
OUTPUT=""
if git -C "$DIR" rev-parse --git-dir > /dev/null 2>&1; then
    BRANCH=$(git -C "$DIR" branch --show-current 2>/dev/null)
    GIT_DIR=$(git -C "$DIR" rev-parse --git-dir 2>/dev/null)
    if [[ "$GIT_DIR" == *".git/worktrees/"* ]]; then
        OUTPUT="$BRANCH (worktree)"
    else
        OUTPUT="$BRANCH"
    fi
else
    OUTPUT="${DIR##*/}"
fi

# Dev server port from .claude/dev-server.yml
DEV_YML="$DIR/.claude/dev-server.yml"
if [ -f "$DEV_YML" ] && [ -n "$BRANCH" ]; then
    PORT=$(awk -v b="$BRANCH" '
        $0 == "  " b ":" { found=1; next }
        found && /port:/ { gsub(/[^0-9]/, ""); print; exit }
        found && /^  [^ ]/ { exit }
    ' "$DEV_YML")
    if [ -n "$PORT" ] && lsof -i ":$PORT" -t > /dev/null 2>&1; then
        OUTPUT="$OUTPUT | :$PORT"
    fi
fi

echo "$OUTPUT"
