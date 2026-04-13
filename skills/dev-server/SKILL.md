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

1. **プロジェクトのポート設定**：`$PROJECT_ROOT/.claude/dev-server.yml` が存在する場合、その設定に従う（詳細は「プロジェクトポート設定」セクション参照）
2. **過去の履歴**：`~/.claude/projects/<プロジェクトパスをエンコード>/dev-server.yml` の現在のブランチのエントリがあれば優先
3. **プロジェクト設定**：以下のファイルからデフォルトポートを検出
   - `package.json` の scripts 内のポート指定（`--port`, `-p` オプション）
   - `.env` / `.env.local` / `.env.development` の `PORT` 変数
   - `next.config.js` / `next.config.mjs` の設定
   - `vite.config.ts` / `vite.config.js` の `server.port`
   - `angular.json` の serve オプション
4. **デフォルト値**：フレームワークごとの標準ポート
   - Next.js: 3000
   - Vite: 5173
   - Create React App: 3000
   - Angular: 4200
   - その他: 3000

#### プロジェクトポート設定（`.claude/dev-server.yml`）

プロジェクトルートに `.claude/dev-server.yml` が存在する場合、ポート決定で最優先される（引数指定の次）。
LINE ログインのコールバック URL 等でポートが固定されている場合に使う。

```yaml
# 固定ポート: 必ずこのポートを使う（soft モードでも別ポートに逃げない）
port: 3000
```

```yaml
# ポート範囲: この範囲内で空きポートを探す
port_range: [3000, 3010]
```

```yaml
# ポート競合時の動作モード: soft（デフォルト）または hard
# soft: 空きポートを探す / hard: 使用中のプロセスを停止して奪う
mode: hard
```

```yaml
# 組み合わせ例: LINE ログインでポート固定 + 競合時は自動で奪う
port: 3000
mode: hard
```

```yaml
# monorepo 例: packages ごとにポートを設定
packages:
  packages/web:
    port: 3000
    mode: hard
  packages/api:
    port: 8080
  packages/admin:
    port_range: [3100, 3110]
```

**動作ルール**：

- `port` が指定されている場合：そのポートを必ず使う。使用中の場合は soft モードでも別ポートに逃げず、hard モードと同様にプロセス情報を表示してユーザーに確認する
- `port_range` が指定されている場合：範囲内で空きポートを探す。範囲内に空きがなければエラーを報告
- `mode` が指定されている場合：引数で `soft` / `hard` が明示されない限り、この設定をデフォルトのモードとして使う
- 引数でポート番号や `soft` / `hard` が明示指定された場合は、このファイルの設定より引数が優先される
- `port` と `port_range` が両方指定されている場合は `port` を優先する
- このファイルはリポジトリに commit してチームで共有する設定ファイルである。**このファイルに履歴（ブランチ情報・last_used 等）を書き込んではならない**。履歴は従来通り `~/.claude/projects/` 側の `dev-server.yml` にのみ記録する

#### monorepo 対応

`.claude/dev-server.yml` に `packages` キーがある場合、monorepo として扱う。

**yml の構造**：
- `packages` の各キーは `$PROJECT_ROOT` からの相対パス
- 各パッケージに `port` / `port_range` / `mode` を個別に設定できる
- トップレベルの `port` / `mode` と `packages` は併用しない（`packages` がある場合はトップレベルの設定を無視する）

**起動対象の決定**：

1. **カレントディレクトリがパッケージ配下の場合**：そのパッケージのみ起動する
   - 例: `$PROJECT_ROOT/packages/web/src/` にいる → `packages/web` の設定を使用
2. **プロジェクトルートにいる場合**：ユーザーにどのパッケージを起動するか確認する。選択肢として `packages` に定義された全パッケージを提示し、「すべて起動」も選べるようにする
3. **引数でパッケージ名を指定された場合**（例: `/dev-server web`）：該当パッケージを起動する。パッケージ名は `packages` キーの末尾部分でマッチする（`web` → `packages/web`）

**複数パッケージの同時起動**：
- 「すべて起動」が選ばれた場合、`packages` の全エントリを順に起動する
- 各パッケージの起動は手順 2〜6 を個別に実行する（ポート確認・起動・記録をパッケージごとに行う）
- 起動コマンドは各パッケージの `package.json` を参照して決定する（`$PROJECT_ROOT/<パッケージパス>/package.json`）
- 起動時の `cd` 先は `$PROJECT_ROOT/<パッケージパス>` とする

**履歴の記録**（monorepo の場合）：
- `~/.claude/projects/` 側の `dev-server.yml` にパッケージパスも含めて記録する：

```yaml
branches:
  main:
    packages/web:
      port: 3000
      command: npm run dev
      last_used: 2024-01-20
    packages/api:
      port: 8080
      command: npm run dev
      last_used: 2024-01-20
```

### 2. ポート使用状況の確認

```bash
lsof -i :PORT -t
```

- 出力があれば、そのポートは使用中
- 出力がなければ、ポートは空いている

#### ポートが使用中の場合：該当プロジェクトのサービスか判定

ポートが使用中の場合、**軽量な判定を先に行い、必要な場合のみ curl で HTTP レスポンスを確認する**。

**ステップ 1: プロセス情報による軽量判定**

```bash
lsof -i :PORT -t | xargs -I{} ps -p {} -o pid,command=
```

以下の順で判定する（いずれかに該当した時点で判定完了）：

1. **コマンドラインにプロジェクトパスが含まれる**: `ps` の出力に `$PROJECT_ROOT` の **`realpath` で正規化したパス** が含まれていれば「該当プロジェクトのサービス」と判定
2. **YML 記録との一致**: `dev-server.yml` の現在ブランチの `port` が使用中のポートと一致し、かつプロセスのコマンドが記録された `command` と一致すれば「該当プロジェクトのサービス」と判定

上記で判定できなかった場合、ステップ 2 に進む。

**ステップ 2: curl による HTTP レスポンス確認**

```bash
PROBE_FILE="/tmp/dev-server-probe-$$.html"
PROBE_HEADERS="/tmp/dev-server-probe-$$-headers.txt"
curl -s -D "$PROBE_HEADERS" -o "$PROBE_FILE" -w '%{http_code}' --max-time 3 http://localhost:PORT
```

- `$$`（プロセス ID）を含めることで、複数同時実行時のファイル競合を防ぐ
- `-D` でレスポンスヘッダーも同時に取得する（curl 1 回で完結）
- 判定完了後、一時ファイルを `rm -f "$PROBE_FILE" "$PROBE_HEADERS"` で削除する

**curl が失敗した場合のフォールバック**:
- **タイムアウト / 接続拒否**: 非 HTTP サービス（MySQL、Redis 等）の可能性が高い。「該当プロジェクトのサービスではない」と判定し、プロセス情報（`ps` の出力）のみをユーザーに報告する
- **HTTPS リダイレクト（30x）**: `curl -sk --max-time 3 https://localhost:PORT` でリトライする

**レスポンスから確認する項目**:

1. **レスポンスヘッダー**: `X-Powered-By` 等からフレームワークを特定（例: `X-Powered-By: Next.js`）
2. **HTML ボディのフレームワーク固有パターン**:
   - Next.js: `__next` / `_next/static`
   - Vite: `/@vite/client`
   - Create React App: `react-app`
3. **HTML の `<title>` タグ**に `package.json` の `name` フィールドまたはディレクトリ名が **完全一致または前方一致** で含まれているか

**curl による判定**: フレームワーク種別がプロジェクトと一致し、**かつ** `<title>` にプロジェクト名が含まれる場合、「該当プロジェクトのサービス」と判定する。フレームワークのみ一致してプロジェクト名が確認できない場合は「判定不能」とし、プロセス情報と curl の結果をユーザーに提示して判断を委ねる。

**該当プロジェクトのサービスの場合**（モード共通）：
- ユーザーに「既に起動済みのdev serverがポート PORT で動作中です。再起動しますか？」と確認する
- 確認なしで別ポートに逃げてはいけない
- ユーザーが再起動を希望すれば、そのプロセスを停止して同じポートで起動する
- ユーザーがそのまま使い続けたい場合は、既存のURLを報告して終了

**該当プロジェクトのサービスではない場合**：

curl の結果から判明した情報をユーザーに報告する：
- 例: 「ポート 3000 は別のサービス（Next.js アプリ、タイトル: "Admin Dashboard"）が使用中です」
- **soft モード**: 別の空きポートを探す（下記参照）
- **hard モード**: そのポートのプロセスを停止する（手順 3 参照）

#### デフォルト（soft）モードの場合：空きポート探索

該当プロジェクトのサービスではない別プロセスがポートを使用中の場合のみ、別の空きポートを探す。

**`.claude/dev-server.yml` で `port` が固定されている場合**：別ポートに逃げない。使用中のプロセス情報を表示し、ユーザーに停止するか確認する。

**`.claude/dev-server.yml` で `port_range` が指定されている場合**：範囲内で空きポートを探す。範囲内に空きがなければエラーを報告。

**上記以外の通常の場合**：
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

起動ディレクトリに `cd` してからバックグラウンドで起動する。

- 通常プロジェクト：`$PROJECT_ROOT`
- monorepo：`$PROJECT_ROOT/<パッケージパス>`（例: `$PROJECT_ROOT/packages/web`）

**必ず `PORT` 環境変数をコマンドの先頭に付けてポートを明示する**（デフォルトポートの場合でも省略しない）：

```bash
cd $PROJECT_ROOT && PORT=3333 npm run dev
```

フレームワークによっては `PORT` 環境変数を読まないものがある。その場合は CLI オプションでもポートを指定する：

- Next.js: `PORT=3333 npm run dev -- -p 3333`
- Vite: `PORT=3333 npm run dev -- --port 3333`
- Angular: `PORT=4200 npm run serve -- --port 4200`
- その他: `PORT=3333 npm run dev`（多くのフレームワークは `PORT` 環境変数を尊重する）

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
