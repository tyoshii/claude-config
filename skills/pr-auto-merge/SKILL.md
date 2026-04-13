# /pr-auto-merge

PR を作成し auto-merge を設定した上で、バックグラウンドでマージ完了を監視する。ユーザーはマージを待たずに次の作業に着手できる。

## 実行手順

### 1. PR の作成と auto-merge の設定

`/pr merge` を実行する（`draft` と `review` は指定しない）。

`/pr merge` の結果を確認する：

- **即マージされた場合**（`gh pr merge` の出力に "merged" が含まれる、または `gh pr view --json state --jq .state` が "MERGED"）：
  - 「✅ PR <PR URL> が即マージされました」と報告して終了
- **auto-merge が予約された場合**（`gh pr merge` の出力に "auto-merge" が含まれる）：
  - PR URL と PR 番号を控えてステップ 2 へ

### 2. バックグラウンド監視エージェントの起動

Agent ツールで**監視エージェント**をバックグラウンドで起動する。

```
Agent ツール:
  subagent_type: general-purpose
  run_in_background: true
```

監視エージェントへの指示：

```
## 役割
PR のマージ完了を監視し、結果を報告する。

## PR 情報
- PR URL: <PR の URL>
- PR 番号: <PR 番号>
- リポジトリ: <リポジトリのパス>

## 監視手順

30秒間隔で以下のコマンドを実行し、PR の状態を確認する：

```bash
gh pr view <PR番号> --json state,mergeable,mergeStateStatus,statusCheckRollup --jq '{state: .state, mergeable: .mergeable, mergeStateStatus: .mergeStateStatus, checks: [(.statusCheckRollup // [])[] | {name: .name, status: .status, conclusion: .conclusion}]}'
```

### エラーハンドリング

gh コマンドが失敗した場合（終了コードが 0 以外、またはレスポンスが不正な JSON）：
- 30秒後にリトライする
- 連続 3 回失敗したら「❌ PR <PR URL> の監視中にエラーが発生しました。`gh pr view <PR番号>` で状態を確認してください。」と報告して終了

### 判定ロジック

1. **state が "MERGED"** → 成功：
   「✅ PR <PR URL> がマージされました。」

2. **state が "CLOSED"** → 失敗：
   「❌ PR <PR URL> がクローズされました（マージされていません）。」

3. **mergeable が "CONFLICTING"** → 失敗：
   「❌ PR <PR URL> にマージコンフリクトが発生しました。手動で解決してください。」

4. **mergeStateStatus が "BEHIND"** → ブランチが base branch より古い。以下のコマンドでブランチを更新する：
   ```bash
   gh api repos/<owner>/<repo>/pulls/<PR番号>/update-branch -X PUT -f update_method=merge
   ```
   - 成功したら「🔄 PR <PR URL> のブランチを更新しました。CI の再実行を待機します。」と報告し、60 秒後に再確認（CI 再実行の反映を待つため通常より長く待機する）
   - 失敗したら API レスポンスのエラーメッセージを含めて「❌ PR <PR URL> のブランチ更新に失敗しました（理由: <エラーメッセージ>）。手動で Update branch してください。」と報告して終了
   - ブランチ更新は監視全体を通じて通算最大 3 回まで試行する。3 回を超えたら「❌ PR <PR URL> のブランチ更新が繰り返し必要になっています。手動で確認してください。」と報告して終了
   - ブランチ更新成功直後のポーリングで再度 BEHIND が返った場合は、API の非同期反映待ちの可能性があるため、試行回数をカウントせず 30 秒後に再確認する

5. **mergeable が "UNKNOWN"** → まだ計算中。30秒後に再確認

6. **statusCheckRollup に conclusion が "FAILURE", "CANCELLED", "TIMED_OUT" のいずれかであるチェックがある** → 失敗：
   「❌ PR <PR URL> の CI チェックが失敗しました。」
   失敗したチェック名と conclusion を一覧で報告する。

7. **上記いずれでもない**（チェック実行中）→ 30秒後に再確認

### タイムアウト
- 最大 15 分間監視する。ただし、ブランチ更新（ステップ 4）を実行した場合は CI 再実行分を考慮して最大 25 分に延長する
- タイムアウトした場合：「⏱️ PR <PR URL> の監視がタイムアウトしました。`gh pr view <PR番号>` で状態を確認してください。」

### ルール
- sleep コマンドで待機する（`sleep 30`）
- 監視中に余計な操作（コードの変更、push 等）は一切行わない
- 報告メッセージには必ず PR URL を含める
```

### 3. ユーザーへの報告

バックグラウンドエージェントを起動したら、即座にユーザーに以下を報告する：

```
PR を作成し auto-merge を設定しました: <PR URL>
バックグラウンドでマージ完了を監視中です。完了時に通知します。
他の作業に着手できます。
```

バックグラウンドエージェントの完了通知を受け取ったら、その結果をユーザーに伝える。

## 注意事項

- `gh` CLI がインストール・認証済みであることが前提
- リポジトリで auto-merge が有効化されている必要がある（GitHub リポジトリ設定 > Allow auto-merge）
- 監視エージェントはローカルのファイル変更や git 操作は一切行わない。ただし GitHub API 経由のブランチ更新（update-branch）は許容する
