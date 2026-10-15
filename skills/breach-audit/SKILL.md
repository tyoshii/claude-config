---
name: breach-audit
description: 既存リポジトリに情報漏えい・侵害につながるリスクがないかを、依存パッケージの既知脆弱性とサプライチェーン、CI/CD、シークレット露出、認証・認可、コードの脆弱性（インジェクション等）、個人情報保護、インフラ設定の観点で並列に読み取り監査し、検証済みの指摘を深刻度順のレポートにまとめる。「セキュリティ監査」「脆弱性診断」「情報漏えいリスクを調べて」「うちのリポジトリ大丈夫？」「パッケージの脆弱性」「コードの脆弱性」「breach-audit」等で使用。修正はしない。監査後に指摘へ対応したとき（修正 PR・Issue 化・リスク受容・誤検知の判明）に、既存レポートの対応状況を更新するのにも使う。
---

# /breach-audit [対象パス] [depth]

既存リポジトリを「攻撃者ならどこから入って何を持ち出すか」の目線で棚卸しし、
6 カテゴリを並列のサブエージェントで監査、Critical/High は反証検証してからレポートにする。
観点は OWASP Top 10・OWASP API Security Top 10・ASVS・CWE Top 25 を下敷きにした
`$SKILL_DIR/references/checklist.md`。

**このスキルは読み取り専用。** コード・設定・lockfile を書き換えない。`install` しない。
アプリやテストを起動しない。外部への攻撃的なリクエスト（本番 URL へのスキャン等）もしない。
修正は監査後にユーザーが選んだものだけ、別作業として行う。

## 引数

| 引数 | 説明 | デフォルト |
|------|------|-----------|
| `対象パス` | 監査するリポジトリのルート | カレントディレクトリ（git ルート） |
| `depth` | `quick` / `standard` / `deep` | `standard` |

| depth | 監査エージェント | 検証 |
|-------|-----------------|------|
| `quick` | A・B・C の 3 カテゴリのみ（機械的に見つかる穴） | 検証エージェント無し。Critical/High は自分で該当行を読み直す |
| `standard` | A〜F の 6 カテゴリ | Critical/High をまとめて 1 体の検証エージェントで反証 |
| `deep` | A〜F。D と E はエンドポイント/モジュール単位で分割して最大 2 体ずつ | Critical/High を 1 件ずつ検証エージェントで反証 |

## 実行手順

### 1. 準備

1. 対象のルートへ移動し、`git rev-parse --show-toplevel`・`git remote get-url origin`・
   `git status --short` を確認する。未コミット変更があっても監査は続ける（作業ツリーを監査対象とする）。
2. 作業ディレクトリを決める: `WORK=${XDG_STATE_HOME:-$HOME/.local/state}/breach-audit/<repo名>/<YYYY-MM-DD>`。
   後日の対応状況の更新（手順 8）で別セッションからも開けるよう、セッション限りの scratchpad には置かない。
   同じ日に再監査するときは `-2` のように連番を付ける。中間ファイルはすべてここに置き、**リポジトリ内には書かない**。
   `mkdir -p "$WORK/agents"` で作っておく（エージェントの出力先）。

### 2. 棚卸し

```bash
node "$SKILL_DIR/scripts/inventory.mjs" "<repo-root>" > "$WORK/inventory.json"
```

出力の要点（スタック・lockfile・Workflow の検出件数・機微ファイル・IaC・使えるスキャナ）を
ユーザーに 5〜10 行で伝える。`tools` を見て、`gitleaks` / `osv-scanner` / `semgrep` / `zizmor` /
`trivy` が無い場合は「入れると精度が上がる」と一言添える（インストールはしない）。

inventory の `actions.findings` や `sensitiveFiles` は**正規表現による候補**であり、そのまま指摘にしない。


### 3. 並列監査

Agent ツール（`subagent_type: general-purpose`）で、depth に応じたカテゴリを**1 メッセージで並列起動**する。
対象に該当するものが無いカテゴリ（例: Workflow も GitHub リモートも無いのに B）は起動せず、
レポートで「対象なし」と書く。

| カテゴリ | 担当 | checklist の節 |
|---|---|---|
| A | 依存関係・サプライチェーン（**パッケージの既知脆弱性スキャン含む**） | A |
| B | CI/CD・GitHub リポジトリ設定 | B |
| C | シークレット露出（作業ツリー + git 履歴）・AI エージェント設定・LLM 機能 | C |
| D | 認証・セッション・認可（IDOR / 過剰返却 / マルチテナント） | D |
| E | **コードの脆弱性**（インジェクション・SSRF・XSS・デシリアライズ・暗号誤用 等） | E |
| F | 個人情報保護・インフラ/クラウド/BaaS 設定 | F |

**主担当の決まり（重複指摘を防ぐ）**: 同じ穴を複数カテゴリが別々に指摘しないよう、次の観点は主担当だけが
finding にする。主担当でないエージェントは、気づいても finding にせず `related` に一行で書くだけにする。

| 観点 | 主担当 |
|---|---|
| エンドポイント/ルートの認証・認可の欠如、トークン/シークレットの比較方法、OAuth の state | D |
| 外部入力が危険な sink に届く問題、エラー応答での内部情報の露出 | E |
| 環境変数・`.env`・設定ファイル中のシークレット（未使用の残骸も含む） | C |
| Dependabot / Renovate / 依存の自動更新・alerts | A |
| ブランチ保護・secret scanning など GitHub の設定、Workflow | B |
| 本番/開発の環境分離、ストレージ公開設定、セキュリティヘッダ、監査ログ | F |

各エージェントへのプロンプトには以下をすべて含める（`{}` は埋める。主担当の表もそのまま貼る）:

```
あなたはリポジトリ {repo-root} のセキュリティ監査担当（カテゴリ {X}: {名前}）です。
目的: 情報漏えい・侵害につながる実在のリスクを、根拠付きで見つけること。

1. {SKILL_DIR}/references/checklist.md の「{X}.」の節を読み、全項目を順に調べる。
2. 棚卸し結果 {WORK}/inventory.json を参照する（候補は真偽を自分で確認すること）。
3. 外部スキャナの出力は {WORK}/ 以下に保存する。リポジトリ内には何も書かない。
4. 次の「主担当」の表で自カテゴリ以外が主担当の観点は finding にせず、related に一行で書く。
   {主担当の表}

厳守:
- 読み取り専用。ファイル編集・git 操作（commit/checkout/stash 等）・パッケージの install・
  アプリ/テストの起動・本番/ステージング URL へのリクエストは禁止。
  許可される外部通信は、脆弱性 DB の照会（npm audit / osv / gh api の GET 等）だけ。
  例外として、最終結果の JSON を {WORK}/agents/{X}.json に書き出すことだけは許可する。
- シークレット値は先頭 4 文字 + **** でマスクし、全文を出力しない。
- 推測で指摘しない。各指摘に file:line と、その行を読んで確認した根拠を付ける。
  確認しきれないものは confidence: low として出し、何が未確認かを書く。
- 「対策済み」と確認できた項目も passed に短く挙げる（何を見て対策済みと判断したか）。
- 調べられなかった項目（権限不足・ツール無し・対象なし）は skipped に理由付きで挙げる。
- JSON の文字列には生の文字を書く。&gt; &lt; &amp; などの HTML エンティティにしない。
- 深刻度は Critical / High / Medium / Low / Info のいずれか（advisory の moderate は Medium）。

最終結果は次の形の JSON を {WORK}/agents/{X}.json に書き出し、返答は「書き出したパスと件数」だけにする:
{"category":"{X}","findings":[{"id":"{X}-連番","checklist":"A1 等","severity":"Critical|High|Medium|Low|Info",
"confidence":"high|medium|low","title":"一行要約","location":"path:line（複数可、カンマ区切り）",
"evidence":"何を読んで何が問題と判断したか","impact":"悪用されると何が漏れる/起きるか",
"exploit_precondition":"攻撃に必要な前提（未認証で可能か、社内のみか 等）",
"fix":"具体的な修正方針","effort":"S|M|L"}],
"vulnerablePackages":[{"name","version","fixed","advisory","severity","direct":true,"scope":"本番|dev","reachable":"根拠付き"}],
"passed":["..."],"skipped":["..."],"related":["他カテゴリ主担当の気づき（path:line と一行）"]}
（vulnerablePackages はカテゴリ A のみ）
```

D・E は対象が大きいと 1 体で読み切れない。`deep` のときや、ルート/ハンドラが概ね 50 を超えるときは、
ディレクトリ（例: `packages/api` と `packages/web`）や機能単位で 2 体に分け、担当範囲をプロンプトで明示する
（出力は `agents/D1.json`・`agents/D2.json` のように分け、id も `D1-1` のように重複させない）。

**深刻度の基準**（エージェントにも同じ基準で付けさせる）:
- **Critical**: 外部の攻撃者が今すぐ悪用でき、個人情報の大量取得・任意コード実行・本番の認証情報奪取につながる
- **High**: 悪用に条件（ログイン済み、特定の設定、内部者）が要るが、成立すれば漏えい/侵害になる
- **Medium**: 単体では漏えいしないが、他の穴と組み合わさると深刻化する／防御層が欠けている
- **Low**: 衛生面・ベストプラクティスからの逸脱
- **Info**: 参考情報・検知/運用面の改善余地

### 4. 統合（重複の整理）

全エージェントが終わったら、重複候補を出す:

```bash
node "$SKILL_DIR/scripts/merge-results.mjs" "$WORK" --candidates
```

同じファイルの近い行を指す、カテゴリ違いの指摘ペアが表示される。同じ根本原因なら主担当の表に従って
残す側（keep）を決め、`$WORK/summary.json` の `merges` に書く（形式は `$SKILL_DIR/assets/results-schema.md`）。
各エージェントの `related` も読み、主担当側が見落としているものがあれば自分で該当行を確認して扱いを決める。

### 5. 検証（反証）

統合後に残る Critical/High（と、連鎖すると High 以上になる Medium）を検証にかける。

- `quick`: 該当箇所を自分で読み直して確認し、結果を `$WORK/verify.json` に書く。
- `standard`: まとめて 1 体の検証エージェントに渡す。
- `deep`: 1 件ずつ並列の検証エージェントに渡し、結果を 1 つの配列にまとめる。

検証エージェントへのプロンプト要旨:

```
以下の指摘が誤検知である可能性を本気で探してください（読み取り専用・同じ禁止事項）。
上流のミドルウェア/バリデーション/フレームワークの自動エスケープ/ORM のパラメータ化/
ネットワーク境界（社内限定・認証プロキシ配下）/dev 依存のみ/到達不能コード/テスト用ダミー値/
前提条件の不成立（advisory の影響条件、外部サービスの設定）など、悪用を妨げる要因が無いかを
実際のコードとドキュメントで確認する。JSON の文字列に HTML エンティティを使わない。
結果を {WORK}/verify.json に次の配列で書き出し、返答はパスと件数だけにする:
[{"id","verdict":"confirmed|downgraded|false_positive","severity":"見直し後","reason":"根拠 file:line"}]
```

`false_positive` は統合時に本編から外れ、付録の「除外した候補」に理由付きで残る。
`downgraded` は見直し後の深刻度が採用され、元の深刻度も記録される。

### 6. レポート（HTML + Markdown）

1. `$WORK/summary.json` に `meta`・`summary`（overview と topActions）・`notCovered`・`merges` を書く。
   overview には「最も危ない経路（入口 → 何が漏れるか）」を必ず一文入れる。topActions は 3〜5 件。
2. 統合して results.json を作り、レポートを生成して開く:
   ```bash
   node "$SKILL_DIR/scripts/merge-results.mjs" "$WORK"
   node "$SKILL_DIR/scripts/render-report.mjs" "$WORK/results.json" "$WORK"
   open "$WORK/report.html"   # macOS。Linux は xdg-open
   ```

HTML は外部リソースを読まない単一ファイルで、深刻度タイルでの絞り込み・キーワード検索・
カテゴリ別の状況・指摘ごとの詳細（根拠/影響/修正方針/検証結果）・パッケージ脆弱性表を表示する。
同じ内容の `report.md` も出力される。

**脆弱性の詳細を含むので、リポジトリ内に保存・コミットしない。** Artifact・社内 HTML 共有サービス等での公開や
共有 URL の発行もしない。共有先（Issue・Slack・PR 等）へは、ユーザーの明示的な指示があるときだけ出し、
その場合も private であることと共有範囲を確認する。public リポジトリの Issue には絶対に書かない。

チャットでは次だけを返す:
1. 深刻度別の件数と、Critical/High の一覧（1 件 1〜2 行: 何が・どこで・何が漏れるか）。検証で格下げしたものはその旨
2. 「今日やるべきこと」上位 3〜5 件
3. report.html と report.md のパス
4. 対応したら「C-1 対応した」のように伝えればレポートの対応状況を更新できること

### 7. 次のアクションの提案

修正はしない。以下の対応づけで、ユーザーに次の一手を提案して終える。

| 指摘 | 提案 |
|---|---|
| シークレットの露出（C1〜C3） | **まず失効・ローテーション**（コードから消すだけでは不十分。履歴に残る）。その後に履歴の書き換えを検討 |
| cooldown 未設定（A3） | `/release-cooldown` |
| Actions 未ピン留め（B4） | `/pinned-actions-manager` |
| 依存の既知脆弱性（A1） | 修正版への更新。cooldown を満たす版を選ぶ |
| コード・認可・設定の指摘 | 指摘単位で修正 PR を作るか、Issue 化するかをユーザーに確認 |

### 8. 対応後のレポート更新

監査後に指摘への対応が進んだら（このセッションでも後日の別セッションでも）、再監査はせず、
`$WORK/status.json` を更新してレポートを作り直す。次のどれかに当たったら、ユーザーに言われなくても更新する。

- 指摘に対する修正をコミット/PR にした、マージされた
- 指摘を Issue 化した
- ユーザーがリスク受容・対応しないと決めた
- 対応の途中で誤検知と分かった
- 依存パッケージを修正版に更新した

手順:

1. `$WORK` を特定する。このセッションで監査したならそのパス。別セッションなら
   `ls -t "${XDG_STATE_HOME:-$HOME/.local/state}/breach-audit/<repo名>/"` の最新（違う回の可能性があれば確認する）。
2. `$WORK/status.json` を読み、該当する指摘の id（パッケージは名前）のエントリを追加・上書きし、`updated` を今日にする
   （形式は `$SKILL_DIR/assets/results-schema.md`）。
   - `fixed` は、修正後のコードの該当行を読んで穴が塞がったと確認できたときだけ付ける。PR が未マージなら `in_progress`
   - `ref` には PR/Issue の URL か `owner/repo#番号` を入れる。`note` には何をしたかを一文で書く
   - `false_positive` にした指摘は本編から外れ、付録の「除外した候補」に理由付きで移る
   - シークレット露出（C1〜C3）は、失効・ローテーションまで済んで初めて `fixed`。コードから消しただけなら `in_progress`
3. 作り直す（agents/・verify.json・summary.json はそのまま使う）:
   ```bash
   node "$SKILL_DIR/scripts/merge-results.mjs" "$WORK"
   node "$SKILL_DIR/scripts/render-report.mjs" "$WORK/results.json" "$WORK"
   ```
4. merge の出力の `progress` を元に、更新した指摘と「Critical/High の残り件数」を 1〜3 行で伝える。

## 注意

- 監査は「見つけた穴」の報告であり、「穴が無い」ことの証明ではない。レポートの冒頭に、
  調べなかった範囲（skipped・対象外のリポジトリ・本番の実際の設定）を必ず明記する。
- IaC に無いクラウド設定（コンソールで手作業した S3 の公開設定、WAF、IdP の MFA 設定 等）は
  リポジトリからは分からない。該当しそうな場合は「要確認」として列挙する。
- monorepo で対象が大きい場合、最初に棚卸し結果を見せて、監査範囲（パッケージ単位）を
  ユーザーと合意してから並列監査に進んでよい。
