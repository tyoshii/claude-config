#!/usr/bin/env node
// breach-audit 用の棚卸しスクリプト（読み取り専用）。
// リポジトリのスタック・依存管理・CI・IaC・機微ファイルを検出し、
// 機械的に判定できる危険シグナルを JSON で出力する。
//
// Usage: node inventory.mjs [repo-root]   (default: cwd)
// Output: JSON to stdout. 何も書き換えない・何も install しない。

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";

const root = process.argv[2] ?? process.cwd();

function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024, ...opts }).trim();
  } catch {
    return null;
  }
}

function read(rel) {
  try {
    return readFileSync(join(root, rel), "utf8");
  } catch {
    return null;
  }
}

const has = (bin) => sh("sh", ["-c", `command -v ${bin}`]) !== null;

const isGit = sh("git", ["rev-parse", "--is-inside-work-tree"]) === "true";
const files = isGit
  ? (sh("git", ["ls-files", "-z"]) ?? "").split("\0").filter(Boolean)
  : (sh("find", [".", "-type", "f", "-not", "-path", "*/node_modules/*", "-not", "-path", "./.git/*"]) ?? "")
      .split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, ""));

const byName = (re) => files.filter((f) => re.test(basename(f)));
const byPath = (re) => files.filter((f) => re.test(f));

// ---------- スタック / 依存管理 ----------
const manifests = {
  npm: byName(/^package\.json$/).filter((f) => !f.includes("node_modules/")),
  python: byName(/^(pyproject\.toml|requirements.*\.txt|Pipfile|setup\.py)$/),
  go: byName(/^go\.mod$/),
  ruby: byName(/^Gemfile$/),
  rust: byName(/^Cargo\.toml$/),
  java: byName(/^(pom\.xml|build\.gradle(\.kts)?)$/),
  php: byName(/^composer\.json$/),
  swift: byName(/^(Package\.swift|Podfile)$/),
  dart: byName(/^pubspec\.yaml$/),
};

const lockfiles = byName(
  /^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|uv\.lock|Pipfile\.lock|go\.sum|Gemfile\.lock|Cargo\.lock|composer\.lock|Podfile\.lock|pubspec\.lock|gradle\.lockfile)$/,
);

// manifest があるのに同じディレクトリ（または monorepo ルート）に lockfile が無いもの
const lockDirs = new Set(lockfiles.map((f) => dirname(f)));
const manifestsWithoutLock = Object.entries(manifests).flatMap(([eco, list]) =>
  list
    .filter((m) => !lockDirs.has(dirname(m)) && !lockDirs.has("."))
    .map((m) => ({ ecosystem: eco, manifest: m })),
);

// ---------- npm 系の詳細 ----------
const npm = { packageManager: null, cooldown: [], installScriptsInOwnPackages: [], nonRegistryDeps: [], ignoreScripts: false };
const rootPkg = read("package.json");
if (rootPkg) {
  try {
    npm.packageManager = JSON.parse(rootPkg).packageManager ?? null;
  } catch {}
}
for (const [file, re] of [
  ["pnpm-workspace.yaml", /^\s*minimumReleaseAge\s*:\s*(.+)$/m],
  [".yarnrc.yml", /^\s*npmMinimalAgeGate\s*:\s*(.+)$/m],
  [".npmrc", /^\s*min-release-age\s*=\s*(.+)$/m],
  ["bunfig.toml", /^\s*minimumReleaseAge\s*=\s*(.+)$/m],
]) {
  const m = read(file)?.match(re);
  if (m) npm.cooldown.push({ file, value: m[1].trim() });
}
const npmrc = read(".npmrc") ?? "";
npm.ignoreScripts = /^\s*ignore-scripts\s*=\s*true/m.test(npmrc);
npm.npmrcHasToken = /_authToken\s*=\s*(?!\$\{)/.test(npmrc); // 環境変数参照でない直書きトークン
const yarnrc = read(".yarnrc.yml") ?? "";
npm.yarnEnableScriptsFalse = /^\s*enableScripts\s*:\s*false/m.test(yarnrc);
for (const m of manifests.npm) {
  let pkg;
  try {
    pkg = JSON.parse(read(m) ?? "{}");
  } catch {
    continue;
  }
  const s = pkg.scripts ?? {};
  for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
    if (s[hook]) npm.installScriptsInOwnPackages.push({ file: m, hook, command: s[hook] });
  }
  for (const sec of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(pkg[sec] ?? {})) {
      if (/^(git\+|git:|github:|https?:|file:|link:)|^[\w-]+\/[\w.-]+(#.*)?$/.test(String(spec))) {
        npm.nonRegistryDeps.push({ file: m, name, spec });
      }
    }
  }
}

// ---------- GitHub Actions ----------
const workflows = byPath(/^\.github\/workflows\/.+\.ya?ml$/);
const actions = { files: workflows, findings: [] };
const add = (file, line, rule, text) => actions.findings.push({ file, line, rule, text: text.trim().slice(0, 200) });
for (const wf of workflows) {
  const src = read(wf) ?? "";
  const lines = src.split("\n");
  if (!/^permissions\s*:/m.test(src)) add(wf, 1, "no-top-level-permissions", "トップレベルの permissions: が無い（GITHUB_TOKEN がデフォルト権限）");
  if (/^\s*permissions\s*:\s*write-all/m.test(src)) add(wf, 1, "permissions-write-all", "permissions: write-all");
  const prTarget = /pull_request_target/.test(src);
  const wfRun = /^\s*workflow_run\s*:/m.test(src);
  lines.forEach((l, i) => {
    const n = i + 1;
    const uses = l.match(/^\s*-?\s*uses\s*:\s*([^\s#]+)/);
    if (uses && !uses[1].startsWith("./") && !uses[1].startsWith("docker://")) {
      const ref = uses[1].split("@")[1] ?? "";
      if (!/^[0-9a-f]{40}$/.test(ref)) add(wf, n, "unpinned-action", l);
    }
    // run: 内での信頼できない入力の直接展開（スクリプトインジェクション）
    // with: の ref: はシェル評価されないので除外（特権 checkout は別ルールで見る）
    if (!/^\s*ref\s*:/.test(l) && /\$\{\{\s*github\.(event\.(issue|pull_request|comment|review|review_comment|discussion|head_commit|commits|pages)\b[^}]*(title|body|message|name|label|ref|email)|head_ref)[^}]*\}\}/.test(l)) {
      add(wf, n, "untrusted-input-expression", l);
    }
    if ((prTarget || wfRun) && /ref\s*:\s*\$\{\{\s*github\.(event\.pull_request\.head\.(sha|ref)|head_ref|event\.workflow_run\.head_(sha|branch))/.test(l)) {
      add(wf, n, "privileged-checkout-of-untrusted-code", l);
    }
    if (/runs-on\s*:.*self-hosted/.test(l)) add(wf, n, "self-hosted-runner", l);
    if (/secrets\s*:\s*inherit/.test(l)) add(wf, n, "secrets-inherit", l);
    if (/(NPM_TOKEN|NODE_AUTH_TOKEN|AWS_SECRET_ACCESS_KEY|GOOGLE_CREDENTIALS|GCP_SA_KEY|AZURE_CREDENTIALS)/.test(l)) add(wf, n, "long-lived-credential", l);
    if (/persist-credentials\s*:\s*false/.test(l)) add(wf, n, "info-persist-credentials-false", l);
  });
  if (prTarget) add(wf, 1, "pull_request_target", "pull_request_target トリガーを使用");
}
actions.hasDependabot = existsSync(join(root, ".github/dependabot.yml")) || existsSync(join(root, ".github/dependabot.yaml"));
actions.hasRenovate = files.some((f) => /^(renovate\.json5?|\.renovaterc(\.json)?|\.github\/renovate\.json5?)$/.test(f));
actions.hasCodeowners = files.some((f) => /(^|\/)CODEOWNERS$/.test(f));

// ---------- 機微ファイル / シークレットの可能性 ----------
const sensitiveFiles = byName(
  /^(\.env(\..+)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|.*\.jks|.*\.keystore|id_(rsa|dsa|ecdsa|ed25519)|credentials(\.json)?|service[-_]?account.*\.json|.*\.tfstate(\.backup)?|\.htpasswd|.*\.mobileprovision|google-services\.json|GoogleService-Info\.plist|\.netrc|\.pgpass)$/,
).filter((f) => !/\.(example|sample|template|dist)$/.test(f) && !/\.env\.(example|sample|template)/.test(f));

const gitignore = read(".gitignore") ?? "";
const gitignoreCovers = {
  env: /(^|\n)\s*\/?\.env/.test(gitignore),
  tfstate: /tfstate/.test(gitignore),
  keys: /\*\.(pem|key)/.test(gitignore),
};

// ---------- IaC / インフラ ----------
const iac = {
  terraform: byName(/\.tf$/),
  cloudformation: byPath(/(cloudformation|cfn|template)\.(ya?ml|json)$/i),
  cdk: byName(/^cdk\.json$/),
  serverless: byName(/^serverless\.(ya?ml|ts|js)$/),
  kubernetes: byPath(/(k8s|kubernetes|helm|charts|manifests)\/.+\.ya?ml$/i),
  docker: byName(/^(Dockerfile.*|docker-compose.*\.ya?ml|compose\.ya?ml)$/),
  firebase: byName(/^(firebase\.json|firestore\.rules|storage\.rules|database\.rules\.json)$/),
  supabase: byPath(/^supabase\//),
  vercel: byName(/^vercel\.json$/),
};

// ---------- AI エージェント設定 ----------
const agentConfig = byPath(/(^|\/)(\.claude\/settings(\.local)?\.json|\.mcp\.json|\.cursor\/mcp\.json|\.vscode\/mcp\.json|AGENTS\.md|CLAUDE\.md|\.codex\/config\.toml)$/);

// ---------- 利用可能な外部スキャナ ----------
const tools = Object.fromEntries(
  ["gitleaks", "trufflehog", "osv-scanner", "zizmor", "actionlint", "semgrep", "trivy", "npm", "pnpm", "yarn", "gh", "jq"].map((t) => [t, has(t)]),
);

// ---------- git 情報 ----------
const git = isGit
  ? {
      remote: sh("git", ["remote", "get-url", "origin"]),
      commits: Number(sh("git", ["rev-list", "--count", "HEAD"]) ?? 0),
      // 履歴上で一度でも追加された機微ファイル（現在は削除済みでも漏えい扱い）
      sensitiveInHistory: (sh("git", ["log", "--all", "--diff-filter=A", "--name-only", "--pretty=format:"]) ?? "")
        .split("\n")
        .filter((f) => /(^|\/)(\.env(\.[\w-]+)?|[^/]*\.(pem|key|p12|pfx|jks|keystore|tfstate)|id_(rsa|ed25519|ecdsa)|credentials\.json|service[-_]?account[^/]*\.json)$/.test(f))
        .filter((f) => !/\.(example|sample|template)$/.test(f))
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 100),
    }
  : null;

console.log(
  JSON.stringify(
    {
      root,
      isGit,
      fileCount: files.length,
      manifests: Object.fromEntries(Object.entries(manifests).filter(([, v]) => v.length)),
      lockfiles,
      manifestsWithoutLock,
      npm: manifests.npm.length ? npm : null,
      actions,
      sensitiveFiles,
      gitignoreCovers,
      iac: Object.fromEntries(Object.entries(iac).filter(([, v]) => v.length)),
      agentConfig,
      tools,
      git,
    },
    null,
    2,
  ),
);
