# breach-audit 観点チェックリスト

監査エージェントは担当カテゴリの節だけを読めばよい。各項目は
「何を見るか」「どう調べるか」「深刻度の目安」の順。深刻度は Critical / High / Medium / Low / Info。
ベースは OWASP Top 10 (2021/2025)・OWASP API Security Top 10・ASVS・CWE Top 25。
「実例」は観点の重要性を示す補足であり、実例が無い観点を軽視しないこと。

## 目次

- [A. 依存関係・サプライチェーン](#a-依存関係サプライチェーン)
- [B. CI/CD・GitHub リポジトリ設定](#b-cicdgithub-リポジトリ設定)
- [C. シークレット露出・AI エージェント設定](#c-シークレット露出ai-エージェント設定)
- [D. 認証・セッション・認可](#d-認証セッション認可)
- [E. インジェクション・入力処理（コード脆弱性）](#e-インジェクション入力処理コード脆弱性)
- [F. 個人情報保護・インフラ/クラウド設定](#f-個人情報保護インフラクラウド設定)

---

## A. 依存関係・サプライチェーン

| ID | 観点 | 調べ方 | 深刻度の目安 |
|----|------|--------|-------------|
| A1 | **既知脆弱性を持つパッケージ** | 下記「既知脆弱性スキャン」を実行。到達可能性（実際に import / 呼び出しているか、本番依存か dev のみか）まで確認する | CVSS と到達性で判断。本番依存で到達可能な RCE/認証バイパスは Critical |
| A2 | lockfile の欠如・不整合 | inventory の `manifestsWithoutLock`。CI が `npm ci` / `--frozen-lockfile` / `--immutable` を使っているか | lockfile 無しで本番ビルド: High |
| A3 | cooldown（最小リリース経過時間）未設定 | inventory の `npm.cooldown` が空 | Medium（公開直後の悪性版を即 install しうる。実例: Shai-Hulud 型ワーム） |
| A4 | install スクリプトの実行許可 | `ignore-scripts` / `enableScripts: false` / pnpm `onlyBuiltDependencies` の有無。lockfile 中の `hasInstallScript: true` / `requiresBuild` の数 | Low〜Medium |
| A5 | レジストリ外依存 | inventory の `nonRegistryDeps`（git URL・tarball URL・`github:`）。ブランチ参照は特に危険 | ブランチ参照: High、タグ/コミット: Low |
| A6 | 依存混同（dependency confusion） | 社内スコープ（`@org/*`）が `.npmrc` で社内レジストリに固定されているか。pip の `--extra-index-url` 併用 | 社内名が公開レジストリで取得可能: High |
| A7 | タイポスクワット・不審なパッケージ | 直接依存の名前が有名パッケージと 1〜2 文字違い、DL 数が極端に少ない、メンテナが最近変わった | 確証があれば Critical |
| A8 | メンテされていない依存 | 直接依存で最終リリースが 2 年以上前・archived・deprecated（`npm view <pkg> deprecated time.modified`） | Low（脆弱性が出ても直らない） |
| A9 | 自動更新の仕組み | Dependabot / Renovate の有無と、その cooldown 設定 | Info〜Low |
| A10 | コンテナベースイメージ | Dockerfile の `FROM` がタグのみ（digest 未固定）、`latest`、EOL の OS | Low〜Medium |

### 既知脆弱性スキャン（A1）

**install はしない。** lockfile を読むだけのコマンドを使う。ネットワークが必要。

| エコシステム | コマンド（存在するものだけ） |
|---|---|
| 横断 | `osv-scanner scan source -r . --format json`（あれば最優先） / `trivy fs --scanners vuln --format json .` |
| npm | `npm audit --json --package-lock-only` |
| pnpm | `pnpm audit --json` |
| yarn berry | `yarn npm audit --all --recursive --json` |
| yarn classic | `yarn audit --json` |
| Python | `pip-audit -r requirements.txt` / `uv pip audit`（無ければ OSV API） |
| Go | `govulncheck ./...`（到達性まで出る） |
| Ruby | `bundle-audit check --update` |
| Rust | `cargo audit --json` |
| GitHub 側 | `gh api repos/{owner}/{repo}/dependabot/alerts --paginate -q '.[] | select(.state=="open")'`（権限が無ければスキップ） |

ツールが無い場合の代替: lockfile から `name@version` を抜き出し、OSV API `https://api.osv.dev/v1/querybatch` に
`{"queries":[{"package":{"name":"...","ecosystem":"npm"},"version":"..."}]}` を POST する（直接依存を優先、最大 1000 件/リクエスト）。

結果は「パッケージ・現行版・修正版・CVE/GHSA・重大度・直接/間接・本番/dev・到達可能性」で表にする。
同じパッケージの複数 advisory はまとめる。

---

## B. CI/CD・GitHub リポジトリ設定

inventory の `actions.findings` は機械検出の**候補**。必ず該当行の前後を読んで真偽を判定する。

| ID | 観点 | 調べ方 | 深刻度の目安 |
|----|------|--------|-------------|
| B1 | **スクリプトインジェクション** | `run:` 内で `${{ github.event.issue.title }}` `pull_request.head.ref` `comment.body` などを直接展開（`untrusted-input-expression`）。`env:` 経由なら安全 | 外部の人が起動できるトリガーなら Critical |
| B2 | **pull_request_target / workflow_run の危険な checkout** | 特権トリガーで PR の head を checkout し、そのコードを実行（build/test/install）していないか | Critical（fork PR からシークレット窃取） |
| B3 | GITHUB_TOKEN の過剰権限 | トップレベル `permissions:` 欠如・`write-all`。リポジトリのデフォルト権限は `gh api repos/{o}/{r}/actions/permissions/workflow` | Medium（B1/B2 と組み合わさると High） |
| B4 | Actions の未ピン留め | `uses:` がタグ/ブランチ参照（`unpinned-action`）。サードパーティを優先して報告 | サードパーティ: Medium、`actions/*` 公式: Low |
| B5 | 長期クレデンシャル | `NPM_TOKEN` / AWS アクセスキー / GCP SA キーを secrets に保存。OIDC（npm trusted publishing, `aws-actions/configure-aws-credentials` の role-to-assume, GCP Workload Identity）に移行可能か | Medium |
| B6 | secrets の広すぎる受け渡し | `secrets: inherit`、`environment:` 保護なしの本番デプロイ、`pull_request` から本番 secrets 参照 | Medium |
| B7 | self-hosted runner | public リポジトリ + self-hosted は Critical。private でも永続 runner は汚染が残る | 状況次第 |
| B8 | ログへのシークレット出力 | `echo $SECRET`、`set -x`、`env` / `printenv` のダンプ、デバッグ用の `toJSON(secrets)` | High |
| B9 | artifact / cache 汚染 | 信頼できないジョブが作った artifact/cache を特権ジョブが利用。`.git` や `.npmrc` を含む artifact upload | Medium |
| B10 | リポジトリ保護 | 下記 gh api で確認。デフォルトブランチ保護・必須レビュー・force push 禁止・secret scanning / push protection・Dependabot alerts・CODEOWNERS | 未設定: Medium〜Low |

```bash
# 権限不足で失敗したら「確認できず」と記録してスキップ
gh api repos/{o}/{r} -q '{visibility, default_branch, security: .security_and_analysis}'
gh api repos/{o}/{r}/branches/{default}/protection
gh api repos/{o}/{r}/rulesets
gh api repos/{o}/{r}/actions/permissions
gh api repos/{o}/{r}/actions/permissions/workflow
gh api repos/{o}/{r}/code-scanning/alerts -q '[.[] | select(.state=="open")] | length'
gh api repos/{o}/{r}/secret-scanning/alerts -q '[.[] | select(.state=="open")] | length'
```

`zizmor` / `actionlint` があれば `zizmor --format json .github/workflows` も実行し、結果を突き合わせる。

---

## C. シークレット露出・AI エージェント設定

**報告時はシークレット値を絶対に全文表示しない。** 先頭 4 文字 + `****` + 種別 + ファイル:行 のみ。

| ID | 観点 | 調べ方 | 深刻度の目安 |
|----|------|--------|-------------|
| C1 | **作業ツリー内のシークレット** | `gitleaks dir . --report-format json --report-path <scratch>/gitleaks-dir.json --redact`。無ければ下記 grep パターン | 本番の有効な鍵: Critical |
| C2 | **git 履歴内のシークレット** | `gitleaks git . --report-format json --report-path <scratch>/gitleaks-git.json --redact`。inventory の `git.sensitiveInHistory`。**削除済みでも履歴に残っていれば漏えい扱い**（ローテーションが必要） | 同上 |
| C3 | 機微ファイルのコミット | inventory の `sensitiveFiles`（`.env.*`、`*.pem`、`*.tfstate`、サービスアカウント JSON 等）。中身を見てダミー/本物を判定 | 本物なら High〜Critical |
| C4 | `.gitignore` の穴 | `.env`・鍵・`tfstate`・`*.log`・ダンプファイル（`*.sql`、`*.dump`）が無視されているか | Low |
| C5 | クライアントへのシークレット同梱 | フロントエンド/モバイルのビルドに入る環境変数（`NEXT_PUBLIC_*`、`VITE_*`、`EXPO_PUBLIC_*`、`REACT_APP_*`）にサーバ用キーが入っていないか。モバイルのソースに API シークレット直書き | High |
| C6 | 設定ファイル直書き | `.npmrc` の `_authToken` 直書き（inventory `npmrcHasToken`）、`docker-compose.yml` のパスワード、`application.yml` / `settings.py` の `SECRET_KEY` | 本番値なら High |
| C7 | テスト/フィクスチャ内の実データ | fixture・seed・スナップショットに本物の個人情報、本番の DB ダンプ | High |
| C8 | **AI エージェント設定** | `.claude/settings*.json` の `permissions.allow` に `Bash(*)` 相当・`curl`/`ssh` 等の外部送信の無条件許可、`.mcp.json` にトークン直書き、信頼できない MCP サーバ、`CLAUDE.md`/`AGENTS.md` にシークレットや本番接続情報 | Medium〜High |
| C9 | LLM 機能のデータ流出経路 | アプリが LLM に渡すプロンプトに他ユーザーの PII が混ざる、LLM の出力を SQL/シェル/HTML にそのまま流す、外部入力（メール・Web ページ・issue 本文）を読んだ LLM にツール実行権限がある（間接プロンプトインジェクション） | High |

gitleaks が無い場合の簡易 grep（誤検知が多いので必ず中身を確認）:

```bash
git grep -nIE '(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{80,}|gho_[0-9A-Za-z]{36}|xox[baprs]-[0-9A-Za-z-]{10,}|sk-[A-Za-z0-9_-]{20,}|sk_live_[0-9A-Za-z]{24,}|AIza[0-9A-Za-z_-]{35}|npm_[0-9A-Za-z]{36}|glpat-[0-9A-Za-z_-]{20}|SG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})'
git grep -nIiE '(password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]\s*["'"'"'][^"'"'"'$\{]{8,}'
```

---

## D. 認証・セッション・認可

情報漏えいの主因。**エンドポイント単位で読む**。まずルーティング定義（Express/Nest/Next.js の `app/api`・`pages/api`/Rails routes/Django urls/GraphQL resolver/tRPC router 等）を列挙し、
各ハンドラで「誰が」「どのリソースに」アクセスしているかを追う。数が多い場合は個人情報・決済・管理機能を扱うものから優先する。

### 認証・アカウント乗っ取り耐性

| ID | 観点 | 調べ方 | 深刻度の目安 |
|----|------|--------|-------------|
| D1 | **クレデンシャルスタッフィング / ブルートフォース対策** | ログイン・OTP 検証・パスワードリセット・会員登録にレート制限 / ロックアウト / CAPTCHA があるか（ミドルウェア、WAF 設定、API Gateway 設定） | 無ければ High（会員アプリの大量漏えいの典型経路） |
| D2 | パスワード保存 | bcrypt/scrypt/argon2/PBKDF2 か。MD5/SHA1/SHA256 単発・平文・可逆暗号は Critical | — |
| D3 | 多要素認証 | 管理画面・社内ツール・高権限ロールで MFA 必須か | 管理系で無し: High |
| D4 | セッション/トークン | JWT の署名検証（`alg: none` 受け入れ、`decode` だけで `verify` していない、秘密鍵がハードコード/弱い）、有効期限、リフレッシュトークンのローテーション、ログアウト時の失効 | 検証漏れ: Critical |
| D5 | Cookie 属性 | `HttpOnly`・`Secure`・`SameSite`。トークンを `localStorage` に保存（XSS で窃取可能） | Medium |
| D6 | パスワードリセット/メール変更 | トークンの推測可能性・有効期限・一回限りか、Host ヘッダからリセット URL を組み立てていないか、メール変更時に再認証するか | High |
| D7 | ユーザー列挙 | ログイン/登録/リセットのレスポンスやタイミングでアカウント有無が分かる | Low〜Medium |
| D8 | OAuth / OIDC / SSO | `state` 検証、`redirect_uri` の完全一致、PKCE、ID トークンの `aud`/`iss` 検証、メールアドレスだけでのアカウント紐付け | High |

### 認可・アクセス制御（OWASP A01 / API1, API3, API5）

| ID | 観点 | 調べ方 | 深刻度の目安 |
|----|------|--------|-------------|
| D9 | **IDOR / BOLA** | `/users/:id`、`/orders/:id`、`?userId=` のように ID を受け取るハンドラで、取得したリソースの所有者が**ログインユーザーと照合されているか**。クエリに `where userId = currentUser.id` 相当があるか | 個人情報が取れるなら Critical |
| D10 | 機能レベル認可の欠如 | 管理用 API・内部 API・バッチ起動 API に認証/ロール確認があるか。認証ミドルウェアの適用漏れ（ルーター単位で付けていて一部だけ外れている等） | Critical〜High |
| D11 | マスアサインメント | リクエストボディをそのまま ORM の create/update に渡していないか（`role`・`isAdmin`・`ownerId`・`price` を上書きできる） | High |
| D12 | **過剰なデータ返却** | ユーザーオブジェクト丸ごと返却（パスワードハッシュ、メール、電話、住所、内部フラグ）。一覧 API で他人の PII。GraphQL のフィールド単位認可・introspection・クエリ深さ制限 | High |
| D13 | マルチテナント分離 | テナント ID の条件漏れ、RLS（Supabase/Postgres）未設定、Firebase Rules の `allow read, write: if true` / `if request.auth != null` だけ | Critical |
| D14 | 列挙・大量取得 | 連番 ID、ページングの上限なし（`limit=100000`）、エクスポート API のレート制限なし | Medium〜High |
| D15 | CSRF | Cookie 認証で状態変更 API に CSRF 対策（SameSite / トークン / Origin 検証）があるか | Medium |

---

## E. インジェクション・入力処理（コード脆弱性）

**source（外部入力）→ sink（危険な処理）の経路を追う。** grep で sink を見つけ、そこへ届く値が外部入力由来か・途中で検証/エスケープされているかを読む。
`semgrep` があれば `semgrep scan --config p/default --config p/secrets --json --metrics=off` を先に実行し、結果を出発点にする（偽陽性は読んで落とす）。

| ID | 観点 (CWE) | sink の探し方（例） | 深刻度の目安 |
|----|-----------|---------------------|-------------|
| E1 | **SQL インジェクション** (CWE-89) | 文字列連結/テンプレートで組んだ SQL: `query(\`...${`、`raw(`、`$queryRawUnsafe`、`sequelize.query(`、`knex.raw(`、`execute(f"`、`.extra(`、`cursor.execute(.*%` | Critical |
| E2 | NoSQL インジェクション (CWE-943) | リクエストボディを Mongo の filter にそのまま（`{ $ne: null }` が通る）、`$where` | High |
| E3 | **OS コマンドインジェクション** (CWE-78) | `exec(`、`execSync(`、`spawn(.*shell: true`、`child_process`、`os.system`、`subprocess.*shell=True`、バッククォート | Critical |
| E4 | コード実行 / 安全でないデシリアライズ (CWE-94, 502) | `eval(`、`new Function(`、`vm.run`、`pickle.loads`、`yaml.load(`（SafeLoader 無し）、`Marshal.load`、`ObjectInputStream`、`node-serialize` | Critical |
| E5 | **SSRF** (CWE-918) | ユーザー指定 URL への `fetch`/`axios`/`requests.get`。Webhook URL 登録、画像 URL 取り込み、PDF 生成（HTML 内の外部参照）。メタデータ IP `169.254.169.254` や内部ホストへの到達を防いでいるか | High（クラウド認証情報窃取） |
| E6 | パストラバーサル (CWE-22) | `path.join(base, req.*)`、`res.sendFile`、`fs.readFile(` にユーザー入力、ZIP 展開（Zip Slip） | High |
| E7 | **XSS** (CWE-79) | `dangerouslySetInnerHTML`、`v-html`、`innerHTML =`、`{{{ }}}`、`|safe`、`html_safe`、`bypassSecurityTrust*`、Markdown レンダラの HTML 許可、`href={userInput}`（`javascript:`） | Stored: High、Reflected: Medium |
| E8 | オープンリダイレクト (CWE-601) | `redirect(req.query.next)`、`location.href = params` | Medium（フィッシング・OAuth トークン窃取に連鎖） |
| E9 | ファイルアップロード (CWE-434) | 拡張子/MIME 検証、保存先が公開ディレクトリか、SVG/HTML のアップロード、サイズ上限 | High |
| E10 | XXE (CWE-611) | XML パーサの外部エンティティ有効（`libxmljs` `noent: true`、Java `DocumentBuilderFactory` 既定、`lxml` `resolve_entities`） | High |
| E11 | テンプレートインジェクション (CWE-1336) | ユーザー入力をテンプレート文字列としてコンパイル（`render_template_string`、`ejs.render(userInput)`、`Handlebars.compile(userInput)`） | Critical |
| E12 | ReDoS / リソース枯渇 (CWE-1333, 400) | ユーザー入力に適用するネストした量指定子の正規表現、ボディサイズ上限なし、GraphQL のクエリコスト制限なし | Medium |
| E13 | プロトタイプ汚染 (CWE-1321) | 再帰 merge/`set` にユーザー入力のキー（`__proto__`）、`lodash.merge` 旧版 | Medium〜High |
| E14 | 暗号の誤用 (CWE-327, 330, 295) | `Math.random()` でトークン生成、ECB、固定 IV、MD5/SHA1 で署名、`rejectUnauthorized: false`、`verify=False`、`NODE_TLS_REJECT_UNAUTHORIZED=0` | High |
| E15 | エラー/デバッグ情報の露出 (CWE-209) | 本番でスタックトレース返却、`DEBUG=True`、Express の既定エラーハンドラ、GraphQL のエラー詳細、ソースマップ公開 | Medium |
| E16 | ログインジェクション | ユーザー入力を改行込みでログへ、ログ経由の Log4Shell 型評価 | Low |

モバイル（React Native / iOS / Android）がある場合は追加で:
- 認証トークンを AsyncStorage / SharedPreferences / UserDefaults に平文保存（Keychain / Keystore / `expo-secure-store` を使うべき）
- `android:allowBackup="true"`、`android:exported` の過剰、`usesCleartextTraffic`、ATS 例外 (`NSAllowsArbitraryLoads`)
- WebView の `javaScriptEnabled` + `addJavascriptInterface` / `originWhitelist={['*']}`、ディープリンクのパラメータ未検証

---

## F. 個人情報保護・インフラ/クラウド設定

### 個人情報・データ保護

| ID | 観点 | 調べ方 | 深刻度の目安 |
|----|------|--------|-------------|
| F1 | **PII のログ出力** | `console.log(user)`、`logger.info(req.body)`、リクエスト/レスポンス全体のロギングミドルウェア、Sentry/Datadog 等への PII 送信（`sendDefaultPii`、`beforeSend` でのマスク有無） | High |
| F2 | 本人確認書類・機微情報の保存 | 免許証/保険証画像、マイナンバー、医療情報、決済情報の保存先・暗号化・アクセス制御・保存期間 | 公開状態なら Critical |
| F3 | **ストレージの公開設定** | S3/GCS/Azure Blob/Firebase Storage の public ACL、`BlockPublicAccess` 無効、`allUsers` 権限、署名付き URL の有効期限が長すぎる、推測可能なオブジェクトキー | Critical |
| F4 | 保存時暗号化・バックアップ | DB/ストレージ/スナップショットの暗号化、バックアップの公開・別アカウント共有 | Medium |
| F5 | 分析・サードパーティ送信 | 解析タグ・広告 SDK・チャットウィジェットに PII 送信、外部 SaaS（CRM、配信基盤、BI ツール）への過剰連携。連携先が侵害されたら何が漏れるか | Medium |
| F6 | データ最小化・削除 | 不要な PII の保持、退会時の削除、ログ/バックアップの保持期間 | Low〜Medium |

### インフラ・クラウド・Web 設定

| ID | 観点 | 調べ方 | 深刻度の目安 |
|----|------|--------|-------------|
| F7 | **IaC の公開設定** | Terraform/CDK/CloudFormation で `0.0.0.0/0` への DB・SSH(22)・RDP(3389) 開放、`publicly_accessible = true`、IAM の `"Action": "*"` / `"Resource": "*"`、KMS 未使用。`trivy config .` / `checkov` があれば実行 | Critical〜High |
| F8 | 管理画面・社内ツールの露出 | 管理画面、BI（Metabase/Redash/Grafana）、Swagger UI、GraphQL Playground、Spring Actuator、`/debug`・`/admin`・phpMyAdmin が認証無し/インターネット公開になっていないか。既定パスワード | Critical（実例: BI ツール経由の大量漏えい） |
| F9 | CORS | `Access-Control-Allow-Origin: *` + 認証付き API、`origin` をそのまま反映 + `credentials: true` | High |
| F10 | セキュリティヘッダ | CSP、HSTS、`X-Frame-Options`/`frame-ancestors`、`X-Content-Type-Options`（helmet / next.config headers / vercel.json / CDN 設定） | Low〜Medium |
| F11 | コンテナ | root 実行、`--privileged`、Docker ソケットのマウント、ビルド引数/レイヤにシークレット（`ARG TOKEN`、`COPY .env`）、`.dockerignore` の欠如 | Medium〜High |
| F12 | Kubernetes | `privileged: true`、`hostNetwork`、Secret を平文 ConfigMap に、RBAC の `*`、NetworkPolicy 無し | Medium〜High |
| F13 | BaaS ルール | Firebase/Firestore/Storage Rules、Supabase RLS と `anon` キーの権限、Hasura の権限設定 | Critical（全件取得されうる） |
| F14 | 環境分離 | 本番と開発でキー/DB を共有、本番データを開発環境にコピー、ステージングが公開されていて本番データを持つ | High |
| F15 | 監視・検知 | 認証失敗・大量取得・権限変更の監査ログ/アラートがあるか（漏えいに**気づける**か） | Info〜Medium |
