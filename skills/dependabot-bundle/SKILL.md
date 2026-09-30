# /dependabot-bundle [draft] [PR番号...]

Dependabot が出している open な PR を 1 本にまとめる。リポジトリのお作法
（ビルド・lint・テスト・PR テンプレート・コミット規約）に従って検証したうえで
まとめ PR を作成し、取り込んだ元の Dependabot PR はクローズする。

## 引数

- `draft` : まとめ PR を Draft で作成する
- `PR番号...` : 対象を指定した PR に絞る（例: `/dependabot-bundle 12 15 18`）。
  省略時は Dependabot が出している open PR すべてが対象

## 前提

- `gh` CLI がインストール・認証済み
- 対象リポジトリのルートで実行する

## 用語

- **対象外**: 最初から取り込み対象に入れない PR（base がデフォルトブランチ以外、
  指定番号が見つからない等）
- **除外**: 取り込もうとしたが外した PR。open のまま残す
- **再生成対象**: パッケージマネージャが生成するファイル。PR の差分からは当てず、
  最後に作り直す
  - lockfile: `package-lock.json` / `npm-shrinkwrap.json` / `pnpm-lock.yaml` /
    `yarn.lock` / `bun.lock` / `bun.lockb` / `Gemfile.lock` / `go.sum` /
    `poetry.lock` / `uv.lock` / `Pipfile.lock` / `Podfile.lock` / `Package.resolved` /
    `Cargo.lock` / `composer.lock` / `gradle.lockfile` / `mix.lock` / `packages.lock.json`
  - 生成物: `.pnp.cjs` / `.pnp.loader.mjs` / `.yarn/cache/*` / `.yarn/install-state.gz` /
    `vendor/*`（Yarn zero-install や vendoring を使うリポジトリで PR に含まれる。
    バイナリはパッチで当てられない）

## 実行手順

### 1. 開始前チェック

```bash
git status --short
gh repo view --json defaultBranchRef -q .defaultBranchRef.name
```

- 未コミットの変更があれば停止し、ユーザーに確認する
- 以降 `<default>` は取得したデフォルトブランチ名に読み替える

### 2. Dependabot PR の収集

```bash
gh pr list --author "app/dependabot" --state open --limit 100 \
  --json number,title,body,headRefName,headRefOid,baseRefName,labels,files
```

この 1 回の結果だけで以下を行う（PR ごとに `gh` を呼ばない）：

- 引数で PR 番号が指定されていればそれに絞る。一覧に見つからない番号（Dependabot 以外・
  クローズ済み）は対象外
- `baseRefName` が `<default>` 以外の PR は対象外
- `headRefOid` を控える（パッチ作成とクローズ前の再照合に使う）
- 分類する（`files` は先頭 100 件で打ち切られる。Yarn zero-install のグループ更新などで
  100 件に達している PR は、ステップ 3 の fetch 後に
  `git diff --name-only origin/<default>...<headRefOid>` の全件で分類し直す）：
  - **manifest あり**: 再生成対象以外のファイル（`package.json` / `Gemfile` / `go.mod` /
    `pyproject.toml` / `.github/workflows/*.yml` / `Dockerfile` 等）に差分がある。
    Go は間接依存も `go.mod` に載るため常にこちら
  - **lockfile のみ**: 再生成対象だけが変わっている（間接依存のセキュリティ更新に多い）
- タイトル（`Bump <pkg> from <X> to <Y>` 等）と `body` から、パッケージ名・
  from / to バージョン・ecosystem・ディレクトリを一覧化する。グループ更新の PR
  （`Bump the npm group ... with 5 updates` 等）は本文からパッケージを列挙する。
  ただし除外は PR 単位で、グループ内の 1 パッケージでも問題があればその PR ごと除外する
- 対象 PR が 0 件なら「対象なし」と報告して終了
- 一覧（番号 / パッケージ / from → to / major 更新か / 分類）をユーザーに提示し、
  承認を待たずに進む。**major 更新**は破壊的変更の可能性が高いので一覧で目立たせる

### 3. 作業ブランチの作成

```bash
git fetch origin
git switch -c <branch> origin/<default>
```

- ブランチ名は `git branch -r` で見える命名規約に合わせる。規約がなければ
  `chore/dependabot-bundle-YYYYMMDD`
- 以降のお作法の読み込みがデフォルトブランチの内容に対して行われるよう、先にブランチを切る

### 4. リポジトリのお作法を把握

以下を並列に読み、検証コマンドと PR の作法を決める（存在するものだけ）：

- `CLAUDE.md` / `AGENTS.md` / `.claude/rules/` / `CONTRIBUTING.md` / `README.md`
- `.github/pull_request_template.md`（または `.github/PULL_REQUEST_TEMPLATE/`）
- `.github/workflows/` の PR トリガーのワークフロー（CI が実際に走らせるコマンド）
- パッケージマネージャと scripts（`package.json` の `scripts`、`packageManager`
  フィールド、lockfile の種類、`Makefile`、`Taskfile` 等）
- `.nvmrc` / `.tool-versions` / `mise.toml` などのランタイム指定
- `git log --oneline -20 origin/<default>` で PR タイトルの規約（Conventional Commits か、
  言語）を確認する。コミットメッセージの規約は 5-5 で `/commit` に従う

検証コマンド一覧（例: build → lint → typecheck → test）を決め、ユーザーに提示して
そのまま進む。CI と同じコマンドを優先する。install は 5-3 で済ませるので含めない。

### 5. 更新の取り込み

lockfile は PR 同士でほぼ確実に衝突するため、**manifest の差分だけを当て、
再生成対象は最後にパッケージマネージャで作り直す**。

#### 5-1. manifest ありの PR

まず `git fetch origin refs/pull/<N>/head` で PR の先頭を取得し、`FETCH_HEAD` が控えた
`headRefOid` と一致するか確認する（不一致なら Dependabot が PR を更新中なので、その PR は
除外。fetch 自体が失敗した場合は除外ではなく失敗として扱う）。PR ごとにローカルでパッチを作り、
再生成対象を除いて 3-way で当てる：

```bash
git diff --binary origin/<default>...<headRefOid> > "$SCRATCH/pr-<N>.patch"
git apply --3way \
  --exclude='*package-lock.json' --exclude='*yarn.lock' \
  --exclude='*.yarn/cache/*' --exclude='*vendor/*' ... \
  "$SCRATCH/pr-<N>.patch"        # 再生成対象すべてを先頭 * 付きで --exclude 指定
```

- `$SCRATCH` はセッションのスクラッチパッドディレクトリ。パッチは 5-6 の作り直しで
  再利用するので消さない
- `git apply --exclude` の `*` は `/` をまたぐので、先頭に `*` を付ければ
  `vendor/github.com/...` や `pkg/.yarn/cache/...` のような深い階層にも一致する
- 衝突した場合（同じ行を複数 PR が触る等）は、**新しい方のバージョン**を採用して
  手で解消し、**`git add <file>` してから**次の PR を当てる（未解消・未ステージの
  ままだと次の `git apply --3way` が失敗する）
- 衝突以外の理由で当たらない PR（元になる blob がない等）は除外し、理由を控えて続行する
- GitHub Actions の更新（`uses: xxx@<sha> # vX.Y.Z` 等）はコメントのバージョン表記も
  含めて差分どおりに当てる

#### 5-2. lockfile のみの PR

差分は当てず、パッケージマネージャで対象パッケージを to バージョン以上に上げる。
**lockfile があるディレクトリで**、同じディレクトリ・同じ PM の対象は **1 コマンドに
まとめて**実行する（例: `(cd <dir> && pnpm update a b c --recursive --depth Infinity)`）：

| PM | コマンド例 |
| --- | --- |
| npm | `npm update <pkg>...`。上がらない場合は無理に上げず、`package.json` に `overrides` を追加するかユーザーに確認 |
| pnpm | `pnpm update <pkg>... --recursive --depth Infinity` |
| yarn (berry) | `yarn up -R <pkg>...` |
| yarn (v1) | `yarn upgrade <pkg>...` |
| bun | `bun update <pkg>...` |
| bundler | `bundle update --conservative <gem>...` |
| poetry | `poetry update <pkg>...` |
| uv | `uv lock --upgrade-package <pkg> --upgrade-package ...` |
| pipenv | `pipenv update <pkg>...` |
| cargo | `cargo update -p <crate> -p ...` |
| composer | `composer update <pkg>... --with-dependencies` |

表にない PM の PR は除外する。

#### 5-3. 再生成対象の作り直し

ecosystem・ディレクトリごとに、そのディレクトリで install を 1 回実行する
（例: `npm install` / `pnpm install` / `yarn install` / `bun install` /
`bundle install` / `go mod tidy` / `uv lock` / `pipenv lock` /
`cargo update --workspace` / `composer update --lock` / `pod install`）。

- Poetry は `poetry --version` を確認し、1.x なら `poetry lock --no-update`、
  2.x 以降なら `poetry lock`（2.0 で `--no-update` は廃止され、既定動作になった）
- `vendor/` があるリポジトリでは `go mod vendor` / `bundle cache` で生成物も作り直す
- 作り直す方法が分からない ecosystem の PR は除外する（古い lockfile のまま
  manifest だけ更新してコミットしない）

#### 5-4. バージョンの突き合わせ

lockfile（または `npm ls <pkg>` / `pnpm why <pkg>` 等）で、各パッケージが to バージョン
**以上**になっていることを確認し、実際に入ったバージョンを控える（5-2 のコマンドや
5-3 の作り直しでは範囲内の最新版が入るため、PR 公開後に新しい版が出ていると
to バージョンを超える。PR 本文には実際の版を書く）。
届いていないものがあれば原因を調べ、解消できなければその PR を除外する。

ここまでに除外が出たら、まとめて 1 回 5-6 を行う。

#### 5-5. 依存更新のコミット

ここまでの変更（manifest・再生成対象・5-2 で足した `overrides` 等）を 1 コミットにする。
メッセージは `/commit` の規約（`config.yml` の言語・footer、リポジトリのコミット規約）に
従い、本文に取り込んだ PR 番号と `pkg from → 実際の版` の一覧を書く。

#### 5-6. PR の除外手順

差分を逆適用して戻す方式は、衝突を手で解消した箇所や追従修正と重なると失敗し、
作り直し済みの lockfile や `overrides` に除外したはずの更新が残る。除外は
**残す PR だけでブランチを作り直す**方式で行い、その時点で分かっている除外対象は
まとめて 1 回で外す：

1. ステップ 6 から来た場合：追従修正（未コミット）があれば、新規ファイルを
   `git add -N` したうえで `git diff --binary HEAD > "$SCRATCH/fixes.patch"` で退避する
   （5-5 でコミット済みなので、この差分は追従修正だけ。ステージ済みの修正も含めるため
   `HEAD` と比較する）。5-4 までに来た場合：まだコミット前なので、未コミットの
   依存更新はそのまま破棄してよい
2. `git reset --hard origin/<default>` で作業ブランチをデフォルトブランチに戻し、
   `git status --short` で再生成対象のパス（`.yarn/cache` / `vendor/` 等）に未追跡ファイルが
   残っていれば削除する（ステップ 3 で作ったこのスキル専用のブランチでだけ行う）
3. 除外する PR を外す。**残りが 0 件なら PR を作らずに停止し**、除外理由を報告する
4. 残りの PR で 5-1〜5-5 をやり直す（パッチは `$SCRATCH` のものを再利用）
5. 退避した追従修正があれば `git apply --3way "$SCRATCH/fixes.patch"` で戻し、除外した
   PR のための修正は取り除く
6. どちらから来た場合もステップ 6（検証）から再開する

### 6. 検証

ステップ 4 で決めた検証コマンドを実行する。互いに独立なコマンド（lint と test 等）は
最初の失敗で止めずに最後まで流し、原因の更新を一度に洗い出す。

- **全部通過** → ステップ 7 へ
- **失敗した場合**：
  1. エラーメッセージから原因の更新を特定する（major 更新・型定義・lint ルール変更が
     典型）
  2. 修正が小さく明確（型の付け替え、設定キーのリネーム、非推奨 API の置換等）なら
     修正を入れ、修正内容を控える
  3. 修正が大きい・判断が要る場合は、その PR を除外する（原因の PR をまとめて 5-6 へ）
  4. 再度検証する。修正・除外をまたいだ通算で 3 回検証しても通らなければ停止し、
     状況をユーザーに報告して判断を仰ぐ

### 7. 追従修正のコミット

ステップ 6 で追従修正を入れた場合だけ、5-5 と同じ規約で依存更新とは別に
コミットする（例: `fix: <pkg> v<Y> への追従`）。

### 8. push と PR 作成

```bash
git push -u origin <branch>
gh pr create --base <default> --title "<タイトル>" --body-file "$SCRATCH/pr-body.md"
```

- `draft` 引数があれば `--draft` を付ける
- タイトルはリポジトリの規約に合わせる（例: `chore(deps): Dependabot の更新 N 件をまとめて取り込み`）
- PR テンプレートがあればその見出し構成に沿って埋める。なければ以下：

```markdown
## Summary
Dependabot の PR N 件をまとめて取り込み。

| PR | パッケージ | 更新 | 備考 |
| --- | --- | --- | --- |
| #12 | foo | 1.2.3 → 1.3.0 | |
| #14 | qux | 0.9.0 → 0.9.2 | PR は 0.9.1。範囲内の最新が入った |
| #15 | bar | 2.0.0 → 3.0.0 | major。`xxx` の API 変更に追従 |

## 追従のための修正
- <ビルド修正の内容。なければ「なし」>

## 除外した PR
- #18 baz 4 → 5: <理由>（open のまま）

## Test plan
- [x] <実行した検証コマンド>
- [ ] <手動確認が必要な項目があれば>
```

- 元 PR に付いているラベル（`dependencies` 等）を同じく付ける

### 9. 元の Dependabot PR をクローズ

取り込んだ PR だけをクローズする。除外した PR は open のまま残す。
作業中に Dependabot が PR を更新・クローズしていることがあるので、直前に再照合する：

```bash
gh pr list --author "app/dependabot" --state open --limit 100 --json number,headRefOid
```

- open で `headRefOid` が控えた値と一致する PR だけをクローズする（互いに独立なので
  並列でよい）
- 既にクローズ済み、または `headRefOid` が変わった PR はクローズせず、「状態変化のため
  未クローズ」として完了報告に載せる

```bash
gh pr close <N> --comment "#<まとめPR番号> にまとめて取り込みました。" --delete-branch
```

### 10. 完了報告

```
## dependabot-bundle 完了

- まとめ PR: <URL>
- 取り込み: N 件（うち major M 件）
- 追従修正: <あり（概要） / なし>
- 検証: <実行したコマンドと結果>
- クローズした PR: #12, #15, ...
- 状態変化のため未クローズ: #16（Dependabot が更新済み）
- 除外（open のまま）: #18 <理由>
- 対象外: #20 (base: release/1.x) / #21（Dependabot の open PR ではない）

⚠️ Dependabot は手動クローズされた PR と同じバージョンの PR を再作成しません。
まとめ PR をマージせずに閉じる場合、クローズした PR の更新は次の新バージョンまで来ません。
```

- 該当がない行は省く

## 注意事項

- 元 PR のクローズはまとめ PR の作成が成功した後に行う。それ以前に失敗したら
  元 PR には一切触れない
- auto-merge やマージは行わない（必要ならユーザーが `/pr-auto-merge` 等で行う）
- 機密情報を含むファイル（`.env` 等）をコミットしない

## 失敗時の扱い

いずれかのステップが失敗したら**その場で停止**し、以下を報告してユーザーに委ねる：

- 完了したステップ
- 失敗したコマンドとその出力の要点
- PR の状況（取り込み済み / 除外 / 未処理、クローズ済み / 未クローズの番号）
- 現在の git の状態（ブランチ、未コミットの変更、push 済みか）

勝手にリトライや巻き戻しはしない。例外は、手順に書かれた PR の除外（5-1〜5-4 と
ステップ 6）、5-6 の作業ブランチの作り直し、ステップ 6 の修正→再検証ループだけ。
