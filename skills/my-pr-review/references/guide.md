# My PR Review — 実行ガイド

他者が出した PR に対して、シニアエンジニア視点の **先生レビュー** と **コードレビュー**（バグ検出）を並列で実行し、`/refine` で品質改善を適用した上で、元 PR ブランチ向けに改善 PR を作成する。

レビュー指摘を **コメントではなくコードで返す** ためのスキル。

## 全体フロー（11 ステップ）

```
1. 前提チェック (git/gh 状態 + カレントリポジトリ確認)
2. 対象 PR メタ情報取得 (gh pr view --json)
3. 元 PR ブランチを checkout (gh pr checkout)
4. 改善ブランチ作成 (review/pr-<N>) — 既存時の分岐あり
5-6. ★並列★ 先生レビュー & コードレビュー (サブエージェント 2 つ)
7. 集約された指摘を Edit で適用 → SENPAI_REVIEW / FIX_SUMMARY を確定
8. /refine で品質改善 (focus 引数で先生レビュー懸念を渡す)
9. .claude/rules/ への変更を破棄、変更なしなら先生レビューだけ提示して終了
10. コミット → push (権限なし時は format-patch でフォールバック)
11. 改善 PR 作成 (--base は元 PR の HEAD ブランチ)
```

## 引数

- `<PR番号 or PR URL>`（必須）: 対象 PR の番号（例: `123`）または URL
  （例: `https://github.com/<owner>/<repo>/pull/123`）。
  URL の場合は所属リポジトリも特定できる。番号の場合はカレントリポジトリの PR とみなす。

## 前提

- `gh` CLI がインストール・認証済み
- 対象 PR のあるリポジトリを `git clone` 済みでカレントディレクトリにある
- カレントブランチがクリーン（未コミットの変更なし）

## 実行手順

### 1. 開始前チェック（前提検証 — 失敗時は即停止）

```bash
git status --short
gh auth status
gh repo view --json nameWithOwner --jq .nameWithOwner
```

それぞれ:
- `git status --short` に出力があれば「未コミットの変更があります。stash か commit してから再実行してください」と報告して停止
- `gh auth status` が失敗したら `gh auth login` を促して停止
- `gh repo view` が失敗したら「カレントディレクトリは GitHub リポジトリにリンクされていません」と報告して停止

PR URL 指定時は、URL の `<owner>/<repo>` と `gh repo view` の値が一致するか比較し、不一致なら「対象 PR が別リポジトリのものです。`cd <該当リポジトリ>` してから再実行してください」と報告して停止。

### 2. 対象 PR のメタ情報を取得

引数を `<PR_REF>` とする。

```bash
gh pr view <PR_REF> --json number,title,headRefName,headRepository,headRepositoryOwner,baseRefName,author,url,body
```

ここから以下を取り出す：

- `PR_NUMBER` : PR 番号
- `PR_TITLE` : PR タイトル
- `HEAD_BRANCH` : 元 PR の作業ブランチ名（`headRefName`）
- `HEAD_OWNER` : `headRepositoryOwner.login`
- `HEAD_REPO` : `headRepository.name`
- `BASE_BRANCH` : 元 PR のベースブランチ名（`baseRefName`）
- `PR_AUTHOR` : 作者
- `PR_URL` : 元 PR の URL

**フォーク PR 判定**: `HEAD_OWNER` がカレントリポジトリの owner と異なればフォーク PR。

### 3. 元 PR のブランチをチェックアウト

```bash
gh pr checkout <PR_NUMBER>
```

フォーク PR でも `gh pr checkout` が自動で remote 追加してくれる。
ただし `permission denied` / `repository not found` 等で失敗した場合は、その場で停止して「フォーク元（`<HEAD_OWNER>/<HEAD_REPO>`）へのアクセス権を確認してください」と報告。自分で remote add や protocol 切り替えは行わない。

```bash
git branch --show-current
git log --oneline -5
```

### 4. 改善ブランチ作成（既存時の安全な分岐）

```bash
git checkout -b review/pr-<PR_NUMBER>
```

**すでに同名ブランチがある場合**は以下を確認したうえでユーザーに選択肢を提示する:

```bash
gh pr list --head review/pr-<PR_NUMBER> --state open
git rev-parse --verify origin/review/pr-<PR_NUMBER> 2>/dev/null
```

選択肢:
- (a) 既存ブランチ・PR を残して中止
- (b) 別名（例: `review/pr-<PR_NUMBER>-v2`）で作り直し
- (c) 既存をローカル削除のみ（リモートと PR は残す）
- (d) 既存をリモート含め完全削除（**要明示同意**。`git branch -D` 前に「削除予定ブランチ名」と「最新コミット sha」を表示）

### 5-6. ★並列★ 先生レビュー & コードレビュー

**重要**: ここで Agent ツールを **1 つのメッセージで 2 つ並列起動** する。先生レビューは読み取り専用、コードレビューも読み取り専用なので並列で衝突しない。

#### Agent 1: 先生レビュー（設計・アーキテクチャ観点）

```
## 役割
あなたはシニアエンジニアとして、他の開発者が出した PR をレビューします。
細かい指摘よりも、設計・アーキテクチャ・全体の整合性・将来の保守性を重視してください。

## PR 情報
- PR URL: <PR_URL>
- PR タイトル: <PR_TITLE>
- 作者: <PR_AUTHOR>
- ベースブランチ: <BASE_BRANCH>
- 作業ブランチ: <HEAD_BRANCH>（すでにローカルにチェックアウト済み）

## 手順
1. `gh pr diff <PR_NUMBER>` で差分を取得
2. 必要に応じて `git log <BASE_BRANCH>..HEAD --oneline` でコミット履歴も確認
3. 周辺コードを Read して文脈を理解する
4. 以下の観点で所見をまとめる：
   - 設計・アーキテクチャ上の判断は妥当か
   - 同様の処理が既存にないか（再利用の余地）
   - エッジケース・エラーハンドリングの考慮
   - テストの十分性
   - セキュリティ上のリスク
   - 将来の保守性に響く設計の歪み

## 出力フォーマット（Markdown で返す）

### 総評
（3〜5 行の所見。良い点と懸念点を率直に）

### 良い点 🟢
- ...

### 改善提案 🟡
- ...（重要度順）

### 重要な懸念 🔴
- ...（あれば。設計上の問題やバグの可能性）

## ルール
- 軽微なスタイル指摘は省略してよい（refine が拾う）
- gh pr comment などのコメント投稿はしない
- ファイルの編集もしない
```

返り値を `SENPAI_REVIEW` として保持。

#### Agent 2: コードレビュー（バグ検出）

```
## 役割
あなたは厳密なコードレビュアーとして、PR の差分にバグや不具合を探します。
設計の議論ではなく、動作の正しさ・エッジケース・型安全・並行処理の不具合に集中してください。

## PR 情報
- PR URL: <PR_URL>
- ベースブランチ: <BASE_BRANCH>
- 作業ブランチ: <HEAD_BRANCH>（すでにローカルにチェックアウト済み）

## 手順
1. `git diff <BASE_BRANCH>...HEAD` で差分を取得
2. 周辺コードを Read してロジックの前提を確認
3. 以下を厳密にチェック:
   - null / undefined / 空配列の扱い
   - off-by-one、境界条件
   - エラーハンドリング漏れ、try/catch の握りつぶし
   - 非同期処理の競合状態、await 漏れ
   - 型の取り違え、暗黙の型変換
   - リソースリーク（リスナー、ファイルハンドル）
   - 後方互換性の破壊
   - セキュリティ（インジェクション、認可漏れ）

## 出力フォーマット（JSON で返す）

```json
{
  "findings": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "severity": "bug" | "concern",
      "description": "問題の説明",
      "suggestion": "修正方針"
    }
  ]
}
```

## ルール
- 確信度が低い指摘は含めない（false positive を厳しく排除）
- スタイル指摘は対象外
- ファイルの編集はしない
```

返り値を `CR_FINDINGS` として保持。

### 7. 指摘を集約して修正適用

両エージェントが返ったら、`SENPAI_REVIEW` と `CR_FINDINGS` を統合する:

1. `CR_FINDINGS.findings` のうち `severity == "bug"` を優先して Edit で修正
2. `severity == "concern"` のものは先生レビューの懸念と照合し、両方が触れているものは優先
3. 先生レビューが触れた懸念のうち、コードで直せるものは追加修正

各修正の概要を `FIX_SUMMARY` として控える（後で PR 本文に載せる）。

修正後、テスト・ビルドがあれば実行し、壊れていないことを確認。

### 8. /refine で品質改善

```
/refine "<SENPAI_REVIEW から抽出した重要懸念キーワードを 1-2 個>"
```

先生レビューに重要懸念がなければ無引数で `/refine` を実行。

- 適用された変更の概要を `REFINE_SUMMARY` として控える
- `/refine` が **スキップした指摘** を報告した場合、その一覧を `REFINE_SKIPPED` として保持

### 9. .claude/rules/ 破棄 & 変更なし判定

`/refine` 完了後、まず `.claude/rules/` への変更を破棄する（他人の PR に自分のルール変更を混入させないため）:

```bash
git status --short -- .claude/
```

`.claude/` 配下に変更があれば、その内容をユーザーに「以下のルール変更を破棄しました」と報告したうえで:

```bash
git checkout -- .claude/
git clean -fd .claude/
```

その後、全体に変更が残っているか確認:

```bash
git status --short
```

**何も変更がない場合** は PR を作る意味がないので、以下のテンプレートで先生レビューだけ提示して終了:

```markdown
## my-pr-review 完了（改善 PR なし）
- 対象 PR: #<PR_NUMBER> <PR_TITLE>
- 結果: 並列レビュー + /refine の両方で変更なし。改善 PR は作成しませんでした。

### 先生レビュー
<SENPAI_REVIEW をそのまま貼る>
```

### 10. コミット & push（権限なし時のフォールバック）

**コミット手順**:

```bash
git status --short
git diff --cached --stat
```

1. `git status --short` で未追跡ファイル `??` を列挙
2. 未追跡ファイルを AI が「PR の改善に関連するか」判定:
   - 改善に関係（新規ヘルパー、テスト、抽出モジュール）→ `git add <path>` で個別追加
   - 無関係（ローカル設定、エディタ一時ファイル等）→ 追加せず、ユーザーに「未追跡ファイルがあるが PR には含めない」と報告
3. `git add -u` で追跡済みファイルの変更をステージ
4. `git diff --cached --stat` でステージ内容を **コミット前に提示**

```bash
git commit -m "$(cat <<'EOF'
review: apply senpai review and code review to PR #<PR_NUMBER>

- senpai review (design observations)
- code review (bug findings applied)
- /refine improvements
EOF
)"
```

**push**:

```bash
git push -u origin review/pr-<PR_NUMBER>
```

**push が `403`/`permission denied` で失敗した場合** は以下を報告して停止（自動で fork 作成・remote 追加・別ブランチ push などは行わない）:

- 改善コミットの SHA: `git rev-parse HEAD`
- patch のファイル化提案: `git format-patch <BASE_BRANCH>..HEAD -o /tmp/review-pr-<PR_NUMBER>/`
- 選択肢: 「ユーザー自身の fork へ push」または「patch を元 PR 作者に共有」

### 11. 改善 PR の作成

ベースブランチは **元 PR の `HEAD_BRANCH`**（`BASE_BRANCH` ではない）。

PR 本文テンプレート:

```markdown
PR #<PR_NUMBER>（<PR_TITLE>）に対するレビューと改善提案です。

このブランチには先生レビュー・コードレビュー・`/refine` による自動改善を適用済みです。
そのまま取り込むか、参考にしてご自身で取捨選択してください。

---

## 先生レビュー

<SENPAI_REVIEW をそのまま貼る>

---

## 適用した変更

### バグ修正・指摘対応（コードレビュー由来）
<FIX_SUMMARY を箇条書きで>

### 品質改善（/refine 由来）
<REFINE_SUMMARY を箇条書きで>

### /refine がスキップした指摘
<REFINE_SKIPPED があれば箇条書きで。なければ「なし」>

---

## レビュー対象

- 元 PR: #<PR_NUMBER>（<PR_URL>）
- 作者: @<PR_AUTHOR>
```

```bash
gh pr create \
  --base "<HEAD_BRANCH>" \
  --head "review/pr-<PR_NUMBER>" \
  --title "review: PR #<PR_NUMBER> に対するレビューと改善" \
  --body "<上記本文>"
```

`--base` を **元 PR の HEAD ブランチ** に向けることで、元 PR の作者が merge ボタンを押せば自分の PR に取り込める状態になる。

### 12. 結果の報告

```
## my-pr-review 完了

- 対象 PR: #<PR_NUMBER> <PR_TITLE> by @<PR_AUTHOR>
- 改善 PR: <作成した PR の URL>
- ベースブランチ: <HEAD_BRANCH>（元 PR の作業ブランチ）

### 先生レビュー要旨
（SENPAI_REVIEW の総評を 2〜3 行で）

### 適用した自動修正
- コードレビュー由来: <件数または概要>
- refine 由来: <件数または概要>
- refine skipped: <件数 or なし>
```

## 注意事項

- 元 PR への直接コメントは一切行わない（先生レビューは改善 PR 本文に集約）
- `.claude/rules/` への変更は **コミット前にステップ 9 で必ず破棄**
- 並列レビュー（5・6）以外のステップは順次実行する
- 失敗時は停止し、状態を報告してユーザーに委ねる（自動巻き戻しはしない）
