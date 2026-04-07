# /supply-chain-guard

npm サプライチェーン攻撃の対策を導入・監査する。

## 前提条件

- `gh` CLI が認証済みであること
- `curl` が利用可能であること
- npm registry（または `.npmrc` で指定されたレジストリ）にアクセス可能であること

## 実行手順

以下のステップ 1（Actions ピン留め）とステップ 2（npm パッケージ監査）は独立しているため、**並列に実行**する。

### 1. GitHub Actions のバージョンピン留め

#### 1-1. ワークフローファイルの検出

`.github/workflows/` 配下のすべての YAML ファイルを読み込む。

#### 1-2. タグ・ブランチ参照の検出

`uses:` で指定されているアクションのうち、コミット SHA 以外の参照を使用しているものをすべてリストアップする。

以下は対象外とする：
- ローカルアクション（`./` で始まるもの）
- Docker アクション（`docker://` で始まるもの）

#### 1-3. コミット SHA の解決

検出した各アクションについて、**並列に** SHA を解決する。

**タグ参照の場合（`@v4` など）：**

1. `gh api repos/{owner}/{repo}/git/ref/tags/{tag}` でタグの参照先を取得
2. レスポンスの `object.type` を確認：
   - `"tag"`（annotated tag）: `object.sha` を使って `gh api repos/{owner}/{repo}/git/tags/{sha}` を呼び、レスポンスの `object.sha`（コミット SHA）を取得
   - `"commit"`（lightweight tag）: `object.sha` をそのまま使用

**ブランチ参照の場合（`@main` など）：**

1. `gh api repos/{owner}/{repo}/git/ref/heads/{branch}` で参照先を取得
2. レスポンスの `object.sha` を使用

**API 呼び出しが失敗した場合**（404、レート制限など）は、該当アクションをスキップし、出力の「Actions ピン留め」セクションにエラーとして報告する。

#### 1-4. ピン留めの適用

参照をコミット SHA に置き換える。元の参照をコメントとして残す：

```yaml
# 変更前
- uses: actions/checkout@v4

# 変更後
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4
```

### 2. npm パッケージの公開日チェック

#### 2-1. 対象ファイルの検出

1. ルートの `package.json` を読み込む
2. `workspaces` フィールドがあれば glob パターンを展開し、サブパッケージの `package.json` も検出する

#### 2-2. バージョンの解決

`dependencies` と `devDependencies` のパッケージについて、実際にインストールされるバージョンを特定する：

1. `package-lock.json` または `yarn.lock` が存在する場合、ロックファイルから解決済みバージョンを読み取る
2. ロックファイルがない場合は、npm registry の `dist-tags.latest` を使用する

ワークスペース内の相互参照パッケージ（`"@myorg/utils": "workspace:*"` など）はレジストリチェックの対象外とする。

#### 2-3. 公開日の確認と危険シグナルのチェック

各パッケージについて npm registry API で情報を取得する（**並列に**実行可能）：

```bash
# スコープ付きパッケージは %2F でエンコードする
# @types/node → @types%2Fnode
curl -s "https://registry.npmjs.org/{package}/{version}"
```

`.npmrc` でカスタムレジストリが設定されている場合はそちらを使用する。API 呼び出しが失敗した場合はスキップし、出力にエラーとして報告する。

取得したレスポンスから以下を **一括で** 確認する：

1. **公開日** — `.time["{version}"]` フィールドから公開日を取得し、3 日未満かチェック
2. **install スクリプト** — `.scripts.preinstall` / `.scripts.postinstall` の有無を確認
3. **タイポスクワッティング** — パッケージ名が人気パッケージと 1-2 文字違い（置換・挿入・削除・転置）でないか確認。npm の `@npmcli/name-from-folder` の命名規則を参考に、既知の人気パッケージ（lodash, express, react, axios, chalk 等）との類似度を検証する

#### 2-4. 結果の報告

公開から 3 日未満のパッケージを検出した場合：

| パッケージ名 | バージョン | 公開日 | 経過日数 |
|---|---|---|---|
| example-pkg | 1.2.3 | 2026-04-05 | 2 日 |

**3 日未満のパッケージが見つかった場合、ユーザーに確認を求め、承認なしにインストールや lock ファイルの更新を行わない。**

## 出力

最後に以下をまとめて報告する：

1. **Actions ピン留め** — 変更したアクションの一覧（変更前 → 変更後）。エラーがあればその旨も記載
2. **npm パッケージ監査** — 検出した問題の一覧（問題がなければ「問題なし」）
3. **推奨事項** — 追加で対処すべき項目があれば提案する
