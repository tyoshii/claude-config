# /pr [merge]

変更内容をもとに PR を作成する。未コミットの変更があればコミットし、push して PR を出すまでを一気に行う。

`merge` が指定された場合、PR 作成後にそのままマージまで実行する。

## 実行手順

### 1. 現在のブランチを確認

```bash
git branch --show-current
```

- メインブランチ（`main`, `master`, `develop`）にいる場合 → **ステップ 2 へ**
- それ以外のブランチにいる場合 → **ステップ 3 へ**

メインブランチの判定：
```bash
git remote show origin | grep 'HEAD branch'
```
この結果と現在のブランチが一致すればメインブランチとみなす。

### 2. ブランチの作成（メインブランチにいる場合のみ）

変更内容からブランチ名を自動生成する：

- `git diff` と `git status` で変更内容を把握
- 形式: `<prefix>/<短い英語の要約>`
- prefix はタスクの種類で決める：
  - `feat/` : 新機能
  - `fix/` : バグ修正
  - `refactor/` : リファクタリング
  - `chore/` : 設定・雑務
- 例: `feat/add-login-validation`, `fix/api-timeout`

```bash
git checkout -b <生成したブランチ名>
```

### 3. 未コミットの変更を処理

`git status` で未コミット・未ステージの変更があるか確認する。

**変更がある場合：**
`/commit` コマンドと同じ手順でコミットを実行する：

- `git diff` で差分を確認
- `git log --oneline -10` でコミットスタイルを確認
- `config.yml` に従って言語・footer を決定
- 適切なコミットメッセージを作成してコミット

**変更がない場合：**
既存のコミットがあることを確認してそのまま進む。

### 4. push

```bash
git push -u origin <現在のブランチ名>
```

- upstream が未設定の場合も `-u` で自動設定される

### 5. 既存 PR の確認

```bash
gh pr view --json url,state 2>/dev/null
```

- 既に PR が存在する場合はその URL を表示して終了
- PR がない場合 → ステップ 6 へ

### 6. PR の作成

#### PR の内容を決定

以下の情報から PR タイトルと本文を作成する：

- `git log --oneline <メインブランチ>..HEAD` でこのブランチの全コミットを確認
- `git diff <メインブランチ>...HEAD` で変更の全体像を把握

#### タイトル

- 70 文字以内
- コミットメッセージの言語に合わせる（日本語コミットなら日本語タイトル）

#### 本文

```markdown
## Summary
- 変更点を箇条書きで簡潔に

## Test plan
- テスト方法や確認事項を箇条書きで
```

#### 実行

```bash
gh pr create --title "<タイトル>" --body "<本文>"
```

- `--fill` は使わない（タイトルと本文を明示的に指定する）

### 7. マージ（`merge` が指定された場合のみ）

引数に `merge` が指定されている場合、PR を作成（または既存 PR を確認）した後にマージを実行する。

```bash
gh pr merge --merge --delete-branch
```

- `--merge` でマージコミットを作成する（squash や rebase ではない）
- `--delete-branch` でマージ後にリモート・ローカルのブランチを自動削除する
- マージ後、メインブランチに切り替える：

```bash
git checkout <メインブランチ>
git pull
```

### 8. 結果の報告

- PR の URL を表示する
- `merge` が指定されていた場合はマージ完了の旨も報告する

## 注意事項

- `gh` CLI がインストール・認証済みであることが前提
- draft PR にはしない（draft にしたい場合はユーザーが明示的に指示する）
- 機密情報を含むファイルがステージされていないか確認する（`.env`, `*.secret`, `credentials` など）
