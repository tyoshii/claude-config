# /dev-server [ポート番号|soft]

開発サーバーを起動する。ポートが使用中の場合は該当プロセスのみを停止して再起動する。

ポート番号を引数で指定した場合、そのポートで起動する。

`soft` を引数に指定した場合、既存プロセスを停止せず、空いている別のポートを自動的に探して起動する。

履歴はブランチ単位で記録するため、ブランチごとに異なるポートで開発できる。

## 実行手順

### 1. ポート番号の決定

**引数でポート番号が指定された場合**：そのポートを使用する（以下の優先順位をスキップ）。

**引数が `soft` の場合**：通常の優先順位でベースポートを決定した後、そのポートが使用中であれば空きポートを探す（手順 2 の soft モードを参照）。

**引数がない場合**、以下の優先順位でポートを決定する：

1. **過去の履歴**：`.claude/dev-server.yml` の現在のブランチのエントリがあれば優先
2. **プロジェクト設定**：以下のファイルからデフォルトポートを検出
   - `package.json` の scripts 内のポート指定（`--port`, `-p` オプション）
   - `.env` / `.env.local` / `.env.development` の `PORT` 変数
   - `next.config.js` / `next.config.mjs` の設定
   - `vite.config.ts` / `vite.config.js` の `server.port`
   - `angular.json` の serve オプション
3. **デフォルト値**：フレームワークごとの標準ポート
   - Next.js: 3000
   - Vite: 5173
   - Create React App: 3000
   - Angular: 4200
   - その他: 3000

### 2. ポート使用状況の確認

```bash
lsof -i :PORT -t
```

- 出力があれば、そのポートは使用中
- 出力がなければ、ポートは空いている

#### soft モードの場合：空きポート探索

ポートが使用中であれば、既存プロセスを停止せず、別の空きポートを探す。

1. ベースポート + 1 から順に `lsof -i :PORT -t` で空きを確認
2. 空いているポートが見つかるまで最大 20 ポート分を探索（ベースポート〜ベースポート+20）
3. 見つかったポートを使用ポートとして採用
4. 20 ポート以内に空きが見つからない場合はエラーを報告

### 3. 使用中の場合のプロセス停止（通常モードのみ）

**soft モードではこの手順をスキップする。**

**重要：pkill は使用しない。特定の PID のみを停止する。**

```bash
# PID を取得
PID=$(lsof -i :PORT -t)

# PID が存在すれば kill
if [ -n "$PID" ]; then
  kill $PID
fi
```

- 複数の PID がある場合は全て停止する
- プロセスが停止しない場合（2-3 秒待っても）、`kill -9` を使用

### 4. 起動コマンドの決定

以下の優先順位で起動コマンドを決定する：

1. **過去の履歴**：`.claude/dev-server.yml` の現在のブランチのエントリにコマンドがあれば優先
2. **package.json の scripts**：
   - `dev` があれば `npm run dev`（または `yarn dev` / `pnpm dev`）
   - `start` があれば `npm run start`
   - `serve` があれば `npm run serve`
3. **フレームワーク検出**：
   - `next` が依存にあれば `npx next dev`
   - `vite` が依存にあれば `npx vite`
   - その他は `npm start`

### 5. パッケージマネージャーの検出

以下のファイルで判定：

- `pnpm-lock.yaml` → pnpm
- `yarn.lock` → yarn
- `bun.lockb` → bun
- `package-lock.json` または上記なし → npm

### 6. サーバー起動

バックグラウンドで起動し、ログを出力する：

```bash
npm run dev
```

起動後、ポートとプロセス情報をユーザーに報告。

### 7. 履歴の記録

成功したら `.claude/dev-server.yml` に **現在のブランチ名をキー** にして記録する。

ブランチ名は `git rev-parse --abbrev-ref HEAD` で取得する（worktree でも正しく動作する）。

```yaml
branches:
  main:
    port: 3000
    command: npm run dev
    last_used: 2024-01-20
  feature/auth:
    port: 3001
    command: npm run dev
    last_used: 2024-01-21
```

## 注意事項

- **pkill / killall は使用しない**（他のプロセスを巻き込む可能性がある）
- lsof で取得した特定の PID のみを停止する
- サーバー起動に失敗した場合はエラーメッセージを確認して報告
- ポートが既に別のプロジェクトで使用されている可能性を考慮し、kill 前にプロセス情報を確認
