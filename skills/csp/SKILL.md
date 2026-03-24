# /csp <やりたいこと>

調整さんplus CLI (`csp`) を自然言語で操作する。

## 引数

- `やりたいこと` : 自然言語での指示（例：「今週の予定みせて」「土曜の練習に参加で回答」）

## csp コマンドリファレンス

```
csp auth login              API キーでログイン
csp auth status             認証状態を表示
csp auth logout             ログアウト

csp events list [options]   予定一覧（--from, --to, --status draft|published）
csp events get <eventId>    予定詳細（質問 ID も表示される）
csp events create [options] 予定作成（下書き状態）
  --title, --start-at (必須), --questions, --description,
  --event-type (練習/公式戦/練習試合/主力大会/イベント),
  --location, --end-at, --meeting-at, --meeting-location,
  --dismissal-at, --dismissal-location, --tag-ids
csp events update <eventId> [options]  予定更新（指定フィールドのみ）
csp events delete <eventId>            予定削除（ソフトデリート）
csp events publish <eventId>           予定公開（子ども自動登録、保護者に通知）

csp children list           自分の子ども一覧（名前・学年・タグ）
csp tags list               タグ一覧（ラベル・色・カテゴリ・ID）

csp responses list [options]  回答一覧（--from, --to, --child-id）
csp responses submit <eventId> --child-id <id> --answer <qId>=yes|maybe|no [--note "メモ"]
  回答値: yes (○), maybe (△), no (×)
```

## 実行手順

1. ユーザーの指示を解釈し、必要な `csp` コマンドを特定する
2. 情報が足りない場合はコマンドを実行して補う（ID の解決など）
   - 例：「土曜の練習」→ まず `csp events list` で該当イベントの ID を取得
   - 例：出欠回答 → `csp children list` で child-id、`csp events get` で question-id を取得
3. 破壊的操作（作成・公開・回答送信）の前に、実行内容をユーザーに確認する
4. コマンドを実行し、結果をわかりやすく伝える

## 日付の扱い

- 「今週」「来週」「今月」などの相対表現は今日の日付から計算する
- 日付フィルタが指定されない一覧表示では、今日以降の直近の予定を表示する（`--from` に今日の日付を使う）

## 注意事項

- `csp events publish` は保護者全員に通知が届く。必ず実行前に確認を取る
- 回答送信（`csp responses submit`）も確認を取ってから実行する
- 予定作成は下書き状態で作られるので、確認なしで実行してよい
- ID の解決は自動で行い、ユーザーに UUID を見せる必要はない
