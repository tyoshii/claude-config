# /reset

初心に戻るためのコマンド。作業をリセットし、main ブランチに戻り、
マージ済みブランチを掃除して、まっさらな状態から再スタートする。

## 実行手順

### 1. 現状確認

```bash
git branch --show-current
git status --short
git stash list
```

- メインブランチにいる場合 → ステップ 3 へ
- 他のブランチにいる場合 → ステップ 2 へ

### 2. 未コミットの変更の処理

`git status --short` で変更がある場合、ユーザーに選択肢を提示する：

| 選択肢 | 動作 |
|--------|------|
| **stash** | `git stash push -m "reset: <ブランチ名> の作業中の変更"` |
| **commit** | `/commit` コマンドと同じ手順でコミット & push |
| **破棄** | `git checkout -- .` で変更を破棄（確認を取ってから） |

選択後、メインブランチに切り替える：

```bash
git checkout main
git pull origin main
```

### 3. マージ済みブランチの削除

#### ローカルブランチ

```bash
git branch --merged main | grep -v -E '^\*|main|master|develop'
```

- 該当ブランチの一覧をユーザーに表示し、削除してよいか確認する
- 確認後に `git branch -d <branch>` で削除

#### リモートブランチ

```bash
git branch -r --merged main | grep -v -E 'main|master|develop|HEAD' | sed 's|origin/||'
```

- 該当ブランチの一覧をユーザーに表示し、削除してよいか確認する
- 確認後に `git push origin --delete <branch>` で削除
- リモートの参照を更新：`git fetch --prune`

### 4. コンテキストのリフレッシュ

プロジェクトの基本情報を読み直す。以下のファイルが存在すれば読む：

- `CLAUDE.md`（プロジェクトルート）
- `.claude/rules` ディレクトリ以下のすべてのファイル
- `.cursorrules`、`.windsurfrules`（あれば参考程度に）

### 5. 完了報告

以下の形式で報告する：

```
## リセット完了

- ブランチ: main（最新）
- 削除したローカルブランチ: <一覧 or なし>
- 削除したリモートブランチ: <一覧 or なし>
- 未コミットの変更: <stash / commit / 破棄 / なし>

準備ができました。次は何をしましょう？
```

## 注意事項

- メインブランチの名前は `git symbolic-ref refs/remotes/origin/HEAD` で判定する（main / master）
- ブランチ削除は必ずユーザー確認を取ってから実行する
- `develop`、`staging` など保護すべきブランチは削除対象から除外する
- worktree 内で実行された場合は警告を出し、メインの作業ディレクトリで実行するよう案内する
