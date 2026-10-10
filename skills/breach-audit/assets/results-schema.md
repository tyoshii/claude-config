# breach-audit の中間ファイルと results.json

```
$WORK/
├── inventory.json        scripts/inventory.mjs の出力
├── agents/<X>.json       各監査エージェントの出力（SKILL.md 手順 3 の形式）
├── verify.json           検証エージェントの出力
├── summary.json          メインが書く（下記）
├── results.json          scripts/merge-results.mjs が生成 → render-report.mjs の入力
├── report.html           scripts/render-report.mjs が生成
└── report.md             同上
```

文字列はすべてプレーンテキストで書く（HTML エンティティは merge 時にデコードされ、HTML 描画時にエスケープされる）。

## summary.json（メインが書く）

```jsonc
{
  "meta": {
    "repo": "owner/repo",
    "remote": "git@github.com:owner/repo.git",
    "commit": "abc123...",
    "dirty": false,                       // 未コミット変更の有無
    "date": "2026-10-11",
    "depth": "standard",
    "tools": ["inventory.mjs", "pnpm audit", "gitleaks"]   // 実際に実行したスキャナ
  },
  "summary": {
    "overview": "全体所見 3〜5 行。最も危ない経路（入口 → 何が漏れるか）を一文で含める",
    "topActions": [
      { "id": "A-1", "action": "やること", "reason": "理由" }
    ]
  },
  "notCovered": ["リポジトリから判断できない範囲（コンソール設定のクラウド権限 等）"],
  "merges": [
    { "keep": "D-1", "drop": ["E-2", "F-3"] }   // 同じ根本原因。keep に checklist・location を寄せ、深刻度は最大を採る
  ],
  "falsePositives": [
    { "title": "統合前に自分で除外した候補", "reason": "理由" }   // 任意。verify の false_positive は自動で追加される
  ]
}
```

## verify.json（検証エージェントが書く）

```json
[{ "id": "A-1", "verdict": "confirmed|downgraded|false_positive", "severity": "Medium", "reason": "根拠 file:line" }]
```

## results.json（merge-results.mjs が生成）

```jsonc
{
  "meta": { ... },                        // summary.json から
  "summary": { ... },                     // summary.json から
  "notCovered": [ ... ],                  // summary.json から
  "findings": [
    {
      "id": "D-1", "category": "D", "checklist": "D10 / E7",
      "severity": "Low", "confidence": "high",
      "verdict": "downgraded",            // verify.json から
      "originalSeverity": "High",         // 格下げ前
      "verifyReason": "検証の根拠",
      "mergedFrom": ["E-2"],              // merges で統合した id
      "title": "...", "location": "path:line, path:line",
      "evidence": "...", "impact": "...", "exploit_precondition": "...",
      "fix": "...", "effort": "S"
    }
  ],
  "vulnerablePackages": [
    { "name": "next", "version": "16.1.6", "fixed": ">=16.3.8", "advisory": "GHSA-...",
      "severity": "High", "direct": true, "scope": "本番", "reachable": "根拠付き" }
  ],
  "passed":  [{ "category": "B", "text": "..." }],
  "skipped": [{ "category": "B", "text": "..." }],
  "falsePositives": [{ "title": "...", "reason": "..." }]
}
```
