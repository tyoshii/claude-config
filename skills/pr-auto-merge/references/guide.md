# PR Auto Merge — 実行ガイド

`/pr merge` 実行 → auto-merge 予約 → バックグラウンドでマージ完了を監視する。ユーザーはマージ完了を待たずに次の作業に移れる。

## 実行手順

### 1. PR の作成と auto-merge の設定

`/pr merge` を実行する（`draft` と `review` は指定しない）。

`/pr merge` 完了後、以下で状態を **確実に** 判定する:

```bash
gh pr view <PR番号> --json state,autoMergeRequest --jq '{state, hasAutoMerge: (.autoMergeRequest != null)}'
```

判定:

- `state == "MERGED"` → 即マージ完了として「✅ PR <PR URL> が即マージされました」と報告して終了
- `state == "OPEN"` かつ `hasAutoMerge == true` → auto-merge 予約済みとしてステップ 2 へ
- その他（state OPEN かつ hasAutoMerge false など）→ `/pr merge` 自体の失敗の可能性があるので、ユーザーに `gh pr view` の出力とともに報告して終了

### 2. バックグラウンド監視エージェントの起動

Agent ツールで監視エージェントをバックグラウンドで起動する:

- `subagent_type: general-purpose`
- `run_in_background: true`

監視エージェントへの指示は以下のテンプレートを渡す（ネストを避けるためインラインで指示する）。

---

監視エージェント指示テンプレート:

**役割**: PR のマージ完了を監視し、結果を報告する。

**PR 情報**:
- PR URL: `<PR の URL>`
- PR 番号: `<PR 番号>`
- リポジトリ: `<リポジトリのパス>`

**初動待機**: 監視開始直後は GitHub 側の状態反映待ち（mergeable 計算・CI トリガ）のため、**初回ポーリングを 60 秒遅延** させる（`sleep 60` してから最初の `gh pr view`）。以降は通常 30 秒間隔。

**経過時間の計測**: bash の `date +%s` で開始時刻を取り、ループごとに比較する。

実装例:

    START_TIME=$(date +%s)
    MAX_DURATION=1800   # 30 分
    sleep 60            # 初動待機
    while true; do
      ELAPSED=$(( $(date +%s) - START_TIME ))
      if [ "$ELAPSED" -ge "$MAX_DURATION" ]; then break; fi
      # gh pr view --json ... で状態確認
      sleep 30
    done

ブランチ更新を 1 回でも実行した場合は `MAX_DURATION=2700`（45 分）に拡張する。

**ポーリングコマンド**:

    gh pr view <PR番号> --json state,mergeable,mergeStateStatus,statusCheckRollup \
      --jq '{state: .state, mergeable: .mergeable, mergeStateStatus: .mergeStateStatus, checks: [(.statusCheckRollup // [])[] | {name: .name, status: .status, conclusion: .conclusion}]}'

**エラーハンドリング**:

`gh` コマンドが失敗（終了コード 0 以外、または不正 JSON）した場合は **指数バックオフでリトライ**:

- 1 回目失敗 → 30 秒待機
- 2 回目失敗 → 60 秒待機
- 3 回目失敗 → 120 秒待機
- 連続 5 回失敗 → 「❌ PR <PR URL> の監視中にエラーが発生しました（合計 5 回失敗）。`gh pr view <PR番号>` で状態を確認してください。」と報告して終了

**判定ロジック**:

1. `state == "MERGED"` → 成功: 「✅ PR <PR URL> がマージされました。」

2. `state == "CLOSED"` → 失敗: 「❌ PR <PR URL> がクローズされました（マージされていません）。意図したクローズか確認し、必要なら再オープン: `gh pr reopen <PR番号>`」

3. `mergeable == "CONFLICTING"` または `mergeStateStatus == "DIRTY"` → 失敗:
   「❌ PR <PR URL> にマージコンフリクトが発生しました。ローカルで `gh pr checkout <PR番号>` → `git merge origin/<base>` で解決し push してください。」

4. `mergeStateStatus == "BEHIND"` → ブランチが base branch より古い。以下でブランチを更新:

       gh api repos/<owner>/<repo>/pulls/<PR番号>/update-branch -X PUT -f update_method=merge

   - 成功 → 「🔄 PR <PR URL> のブランチを更新しました。CI 再実行を待機します。」と報告し、`MAX_DURATION` を 2700 秒に拡張、60 秒後に再確認
   - 失敗 → API エラーメッセージを含めて「❌ PR <PR URL> のブランチ更新に失敗しました（理由: <エラー>）。手動で Update branch してください。」と報告して終了
   - ブランチ更新は通算 **最大 3 回** まで。超過したら「❌ PR <PR URL> のブランチ更新が繰り返し必要です。手動で確認してください。」と報告して終了
   - 更新成功直後のポーリングで再度 BEHIND が返った場合は API の非同期反映待ちの可能性があるため、試行回数をカウントせず 30 秒後に再確認

5. `mergeStateStatus == "BLOCKED"` → 「⚠️ PR <PR URL> がブロック状態です（必須レビュー未承認、required check 未完了、ブランチ保護違反のいずれか）。`gh pr view <PR番号>` で詳細を確認してください。」と報告し、**連続 3 回 BLOCKED** が続いたらタイムアウトを待たず終了

6. `mergeStateStatus == "UNSTABLE"` → statusCheckRollup を確認:
   - `conclusion` が `FAILURE`/`CANCELLED`/`TIMED_OUT` のチェックがあれば 7 と同じ報告で終了
   - なければ 30 秒後に再確認（auto-merge は進まないが mergeable 状態自体は維持）

7. `statusCheckRollup` に `conclusion` が `FAILURE`/`CANCELLED`/`TIMED_OUT` のチェックがある → 失敗:
   「❌ PR <PR URL> の CI チェックが失敗しました。」 + 失敗したチェック名と conclusion を一覧で報告

8. `mergeable == "UNKNOWN"` → まだ計算中。30 秒後に再確認

9. 上記いずれでもない（チェック実行中） → 30 秒後に再確認

**タイムアウト**:
タイムアウトに到達したら以下で報告:
「⏱️ PR <PR URL> の監視がタイムアウトしました（auto-merge 自体は GitHub 側で有効なまま）。`gh pr view <PR番号>` で状態を確認してください。マージは GitHub 側で完了する可能性があります。」

**ルール**:
- 監視中に余計な操作（コードの変更、push 等）は一切行わない（GitHub API 経由のブランチ更新は許容）
- 報告メッセージには必ず PR URL を含める

---

### 3. ユーザーへの即時報告

監視エージェント起動後、即座に以下を報告:

```
PR を作成し auto-merge を設定しました: <PR URL>
バックグラウンドでマージ完了を監視中です。完了時に通知します。
他の作業に着手できます。
```

監視エージェントの完了通知を受け取ったら、その結果をユーザーに伝える。

## 注意事項

- `gh` CLI がインストール・認証済みであることが前提
- リポジトリで auto-merge が有効化されている必要がある（GitHub リポジトリ設定 > Allow auto-merge）
- 監視エージェントはローカルのファイル変更や git 操作は一切行わない（GitHub API 経由のブランチ更新は許容）
