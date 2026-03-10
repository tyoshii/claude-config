# /dev-server [ポート番号|hard]

開発サーバーを起動する。ポートが使用中の場合はデフォルトで空いている別のポートを自動的に探して起動する（soft モード）。

ポート番号を引数で指定した場合、そのポートで起動する。

`hard` を引数に指定した場合、使用中のポートのプロセスを停止してからそのポートで起動する。

履歴はブランチ単位で記録するため、ブランチごとに異なるポートで開発できる。

## 実行手順

### 0. 作業ディレクトリの決定

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
```

- 以降のすべてのファイル検索（`package.json` 等）とサーバー起動はこのディレクトリで行う
- worktree 内ではworktree のルートが返されるため、worktree のコードで正しくサーバーが起動する

### 1. ポート番号の決定

**引数でポート番号が指定された場合**：そのポートを使用する（以下の優先順位をスキップ）。

**引数が `hard` の場合**：通常の優先順位でベースポートを決定した後、そのポートが使用中であればプロセスを停止する（手順 3 の hard モードを参照）。

**引数がないか `soft` の場合**（デフォルト）、以下の優先順位でベースポートを決定した後、使用中であれば空きポートを探す：

1. **過去の履歴**：`~/.claude/projects/<プロジェクトパスをエンコード>/dev-server.yml` の現在のブランチのエントリがあれば優先
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

#### ポートが使用中の場合：自分のプロセスか判定

ポートが使用中の場合、**まず自分（dev-server）が起動したプロセスかどうかを判定する**。

```bash
# PID のコマンドを確認
lsof -i :PORT -t | xargs -I{} ps -p {} -o pid,command=
```

以下の**いずれか**に該当すれば「自分のプロセス」と判定する：
1. `dev-server.yml` の現在ブランチの `port` が、使用中のポートと一致する
2. プロセスのコマンドが、`dev-server.yml` に記録された `command`（例: `npm run dev`, `next dev`）と一致する

**自分のプロセスの場合**（モード共通）：
- ユーザーに「既に起動済みのdev serverがポート PORT で動作中です。再起動しますか？」と確認する
- 確認なしで別ポートに逃げてはいけない
- ユーザーが再起動を希望すれば、そのプロセスを停止して同じポートで起動する
- ユーザーがそのまま使い続けたい場合は、既存のURLを報告して終了

**自分のプロセスではない場合**：モードに応じて処理する（下記参照）

#### デフォルト（soft）モードの場合：空きポート探索

自分のプロセスではない別プロセスがポートを使用中の場合のみ、別の空きポートを探す。

1. ベースポート + 1 から順に `lsof -i :PORT -t` で空きを確認
2. 空いているポートが見つかるまで最大 20 ポート分を探索（ベースポート〜ベースポート+20）
3. 見つかったポートを使用ポートとして採用
4. 20 ポート以内に空きが見つからない場合はエラーを報告

### 3. 使用中の場合のプロセス停止（hard モードのみ）

**デフォルト（soft）モードではこの手順をスキップする。**

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

1. **過去の履歴**：`~/.claude/projects/<プロジェクトパスをエンコード>/dev-server.yml` の現在のブランチのエントリにコマンドがあれば優先
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

`PROJECT_ROOT`（手順 0 で決定）に `cd` してからバックグラウンドで起動する：

```bash
cd $PROJECT_ROOT && npm run dev
```

起動後、ポートとプロセス情報をユーザーに報告。

### 7. 履歴の記録

成功したら `~/.claude/projects/<プロジェクトパスをエンコード>/dev-server.yml` に **現在のブランチ名をキー** にして記録する。

**パスのエンコード**: **メインリポジトリのルート**のパスの `/` を `-` に置換する。
worktree 内で実行された場合も、メインリポジトリのパスを使うことで履歴を共有する。

```bash
# メインリポジトリのルートを取得（worktree でもメインリポジトリのパスを返す）
MAIN_REPO=$(git rev-parse --path-format=absolute --git-common-dir | sed 's/\/\.git$//')
```

例: `/Users/tyoshii/github/tyoshii/my-app` → `~/.claude/projects/-Users-tyoshii-github-tyoshii-my-app/dev-server.yml`

ディレクトリが存在しない場合は `mkdir -p` で作成する。

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
