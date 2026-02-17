#!/bin/bash
#
# claude-config セットアップスクリプト
# ~/.claude/commands と statusline.sh のシンボリックリンクを作成する

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ~/.claude が存在するか確認
if [ ! -d "$HOME/.claude" ]; then
    echo "Error: ~/.claude does not exist."
    echo "Claude Code を一度起動してから再実行してください。"
    exit 1
fi

# シンボリックリンクを作成する関数
link() {
    local src="$1"
    local dest="$2"

    if [ -e "$dest" ]; then
        if [ -L "$dest" ]; then
            current_link=$(readlink "$dest")
            if [ "$current_link" = "$src" ]; then
                echo "Already linked: $dest -> $src"
                return
            fi
            echo "Removing existing symlink: $dest -> $current_link"
            rm "$dest"
        else
            echo "Error: $dest exists and is not a symlink."
            echo "バックアップしてから手動で削除してください。"
            exit 1
        fi
    fi

    ln -s "$src" "$dest"
    echo "Created symlink: $dest -> $src"
}

# commands ディレクトリ
link "$SCRIPT_DIR/command" "$HOME/.claude/commands"

# statusline.sh
link "$SCRIPT_DIR/statusline.sh" "$HOME/.claude/statusline.sh"

echo "Setup complete!"
