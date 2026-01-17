#!/bin/bash
#
# claude-config セットアップスクリプト
# ~/.claude/commands にシンボリックリンクを作成する

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$HOME/.claude/commands"

# ~/.claude が存在するか確認
if [ ! -d "$HOME/.claude" ]; then
    echo "Error: ~/.claude does not exist."
    echo "Claude Code を一度起動してから再実行してください。"
    exit 1
fi

# 既存の commands を確認
if [ -e "$TARGET_DIR" ]; then
    if [ -L "$TARGET_DIR" ]; then
        current_link=$(readlink "$TARGET_DIR")
        if [ "$current_link" = "$SCRIPT_DIR/command" ]; then
            echo "Already linked: $TARGET_DIR -> $SCRIPT_DIR/command"
            exit 0
        fi
        echo "Removing existing symlink: $TARGET_DIR -> $current_link"
        rm "$TARGET_DIR"
    else
        echo "Error: $TARGET_DIR exists and is not a symlink."
        echo "バックアップしてから手動で削除してください。"
        exit 1
    fi
fi

# シンボリックリンクを作成
ln -s "$SCRIPT_DIR/command" "$TARGET_DIR"
echo "Created symlink: $TARGET_DIR -> $SCRIPT_DIR/command"
echo "Setup complete!"
