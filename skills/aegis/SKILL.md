# /aegis [サブコマンド] [引数...]

Aegis セキュリティスキャナーの操作スキル。結果表示・脆弱性修正・再スキャンに対応。

## サブコマンド

| コマンド | 説明 |
|----------|------|
| `/aegis` or `/aegis [repo]` | スキャン結果を表示（デフォルト） |
| `/aegis fix [severity]` | 指定 severity の findings を修正 |
| `/aegis scan [repo]` | 再スキャンを実行 |

## 共通手順

### A. リポジトリ名の決定

**引数でリポジトリ名が指定された場合**：そのリポジトリ名を使用する。

**引数がない場合**：以下の順で特定する。

```bash
REPO_NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)")
```

リポ名が取得できない場合はユーザーに入力を求める。

### B. Aegis インストールディレクトリの探索

`api/index.mjs` が存在するディレクトリを Aegis のインストール先とする。

**探索手順**：

1. カレントディレクトリから上方向に探索（現在のリポが aegis 自体の場合）
   ```bash
   dir=$(pwd)
   while [[ "$dir" != "/" ]]; do
     [[ -f "$dir/api/index.mjs" && -f "$dir/bin/aegis" ]] && echo "$dir" && break
     dir=$(dirname "$dir")
   done
   ```

2. `find` で `$HOME` 配下を探索（深さ4まで、高速に）
   ```bash
   find "$HOME" -maxdepth 4 -path "*/aegis/api/index.mjs" -type f 2>/dev/null | head -1
   ```

3. `/tmp/aegis-app` を確認

すべて見つからない場合、ユーザーに確認してから `/tmp/aegis-app` にクローンする：

```bash
gh repo clone CureApp/aegis /tmp/aegis-app -- --depth 1
cd /tmp/aegis-app && npm install
```

### C. Aegis API の起動確認

```bash
curl -s http://localhost:3939/api/health
```

レスポンスが `{"ok":true}` でなければ API を起動する：

```bash
cd $AEGIS_DIR
PORT=3939 node api/index.mjs &
```

API は `lib/firebase-init.mjs` で以下の優先順位で Firebase 認証を解決する（環境変数を使わない）：
1. macOS Keychain（`security find-generic-password` で取得 — プロセス内メモリのみ）
2. Application Default Credentials（`gcloud auth application-default login` で設定）

バックグラウンドで起動し、最大 5 秒待って health check が通ることを確認する。

**認証エラーで起動できない場合**は、以下を案内する：
- `cd $AEGIS_DIR && ./bin/setup` — SA キーを Keychain にセットアップ
- `gcloud auth application-default login` — gcloud ADC でフォールバック

---

## 1. 結果表示（デフォルト）: `/aegis` or `/aegis [repo]`

### 1-1. スキャン結果の取得

```bash
curl -s "http://localhost:3939/internal/scan/${REPO_NAME}"
```

### 1-2. 結果の表示

#### スキャン結果が見つかった場合

```
## 🛡️ Aegis Security Report: {リポジトリ名}

**スキャン日時**: {scanned_at}
**スキャナー**: {scanned_by}

### サマリー
| Critical | High | Medium | Low | Info |
|----------|------|--------|-----|------|
| {n}      | {n}  | {n}    | {n} | {n}  |

### Findings

#### [{severity}] {title}
- **ファイル**: {file}:{line}
- **説明**: {description}
- **対応策**: {remediation}

（findings を severity 順に全件表示）

### 総評
{notes}
```

#### スキャン結果が見つからなかった場合（404）

```
{リポジトリ名} のスキャン結果が見つかりません。

Aegis でスキャンを実行してください:
  cd {AEGIS_DIR} && ./bin/scan {リポジトリ名}
```

### 1-3. コンテキスト活用

スキャン結果を表示した後、ユーザーが特定の finding について質問したり修正を依頼した場合は、**現在のリポジトリのコード**を参照して具体的な修正提案を行う。finding の `file` と `line` を使ってコードを読み、修正案を提示する。

---

## 2. 脆弱性修正: `/aegis fix [severity]`

指定した severity（critical, high, medium, low, info）以上の findings を自動修正する。

### 2-1. スキャン結果の取得

共通手順 A〜C を実施した後、結果表示と同じ API でスキャン結果を取得する。

```bash
curl -s "http://localhost:3939/internal/scan/${REPO_NAME}"
```

### 2-2. 対象 findings のフィルタリング

severity 引数に基づいて findings をフィルタリングする。severity の優先順:

```
critical > high > medium > low > info
```

- `fix critical` → critical のみ
- `fix high` → critical + high
- `fix medium` → critical + high + medium
- `fix` （引数なし）→ `fix high` と同じ（critical + high）

### 2-3. 修正の実施

対象 findings を severity の高い順に処理する。各 finding について：

1. **該当ファイルを読む**: finding の `file` と `line` を使って Read ツールでコードを確認
2. **修正方針を決定**: finding の `description` と `remediation` を参考に、具体的な修正内容を決める
3. **コードを修正**: Edit ツールで修正を適用
4. **修正内容を記録**: 何をどう修正したか記録しておく

### 2-4. 修正結果の報告

すべての修正が完了したら、以下の形式で報告する：

```
## 🔧 Aegis Fix Report: {リポジトリ名}

### 修正済み ({n}件)

#### [{severity}] {title}
- **ファイル**: {file}:{line}
- **修正内容**: {何をどう変更したか}

### 修正不可 ({n}件)
（自動修正が難しい場合、理由と手動修正のガイダンスを記載）

#### [{severity}] {title}
- **理由**: {なぜ自動修正できないか}
- **推奨対応**: {手動での対処方法}
```

### 2-5. 注意事項

- **破壊的変更に注意**: API の変更やパッケージのメジャーアップデートが必要な場合は、修正前にユーザーに確認する
- **テストの実行**: 修正後、テストが存在する場合は実行して回帰がないか確認する
- **コミットしない**: 修正だけ行い、コミットはユーザーの指示を待つ

---

## 3. 再スキャン: `/aegis scan [repo]`

Aegis の `bin/scan` を使ってリポジトリの再スキャンを実行する。

### 3-1. スキャンの実行

```bash
cd $AEGIS_DIR && ./bin/scan ${REPO_NAME}
```

スキャンはバックグラウンドで実行され、完了まで数分かかる。Bash ツールの `run_in_background` を使って実行し、完了を待つ。

### 3-2. 完了後

スキャンが完了したら、自動的に結果表示（セクション 1）のフローに進み、新しいスキャン結果を表示する。
