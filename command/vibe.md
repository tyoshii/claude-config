# /vibe <タスク説明>

worktree を作成し、隔離された環境でタスクに取りかかる。

新しい Claude セッションの最初に実行される前提のコマンド。

## 実行手順

### 1. ブランチ名の生成

タスク説明からブランチ名を自動生成する：

- 形式: `<prefix>/<短い英語の要約>`
- prefix はタスクの種類で決める：
  - `feat/` : 新機能
  - `fix/` : バグ修正
  - `refactor/` : リファクタリング
  - `chore/` : 設定・雑務
- 例:
  - 「ログイン画面のバリデーション追加」→ `feat/login-validation`
  - 「APIのレスポンスが遅いバグ」→ `fix/slow-api-response`
  - 「認証周りを整理して」→ `refactor/auth-cleanup`

### 2. worktree の作成

```bash
eval "$(command vibe start <branch>)" && pwd
```

- 出力の最後の行が新しい作業ディレクトリのパス
- このパスを以降すべてのファイル操作・コマンド実行で使う

### 3. 作業環境の確認

worktree 内でプロジェクトの状態を把握する：

- 言語・フレームワークの確認
- 依存関係のインストール状況
- CLAUDE.md やプロジェクト固有の設定があれば読む

### 4. 開発モードに入る

以降は `/dev` コマンドと同じルールで作業する：

- `git add` / `git commit` は `/commit` コマンドが明示的に実行されるまで禁止
- 開発完了を宣言しない
- 判断と操作の主導権はユーザーにある

### 5. タスクの開始

タスク説明に基づいて作業を開始する。

## worktree 内での作業ルール

- ファイルの読み書きは worktree の絶対パスを使う
- Bash コマンドは `cd <worktree-path> &&` で実行する
- `command vibe` を使う（シェル関数ではなくバイナリを直接呼ぶ）
- `eval` しないと worktree の作成やセットアップが完了しない

## 作業の区切りでの提案

タスクが一段落したとき、状況に応じて以下の操作をユーザーに提案する：

| 状況 | 提案する操作 |
|------|-------------|
| 実装が完了した | `/commit push` でコミット＆プッシュ |
| PR にしたい | `/commit push` 後に `gh pr create` |
| この worktree はもう不要 | シェルで `vibe clean` を実行 |
| ブランチごと消したい | シェルで `vibe clean --delete-branch` を実行 |
| メインに戻りたいが worktree は残す | シェルで `vibe home` を実行 |
| 別の worktree に切り替えたい | シェルで `vibe jump <branch>` を実行 |

- 提案するだけで勝手に実行しない（`/commit` 以外の vibe 操作はシェルで行うもの）
- Claude が直接実行してよいのは `/commit` と `gh pr create` のみ

## シェルからの起動例

```bash
# 直接起動
claude "/vibe ログイン画面のバリデーションを追加して"

# エイリアスを定義しておくと便利
cvibe() { claude "/vibe $*"; }
cvibe "APIのレスポンスが遅いバグを直して"
```
