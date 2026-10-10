# results.json スキーマ

`scripts/render-report.mjs` の入力。監査エージェントの JSON を統合し、検証結果を反映したもの。
文字列はすべてプレーンテキスト（HTML を入れても描画時にエスケープされる）。

```jsonc
{
  "meta": {
    "repo": "owner/repo",
    "remote": "git@github.com:owner/repo.git",
    "commit": "abc123...",
    "dirty": false,                       // 未コミット変更の有無
    "date": "2026-10-11",
    "depth": "standard",
    "tools": ["gitleaks", "npm audit"]    // 実際に実行したスキャナ
  },
  "summary": {
    "overview": "全体所見 3〜5 行。最も危ない経路を一文で含める",
    "topActions": [
      { "id": "C-1", "action": "やること", "reason": "理由" }
    ]
  },
  "notCovered": ["リポジトリから判断できない範囲（コンソール設定のクラウド権限 等）"],
  "findings": [
    {
      "id": "C-1", "category": "C", "checklist": "C2",
      "severity": "Critical", "confidence": "high",
      "verdict": "confirmed",             // confirmed | downgraded（false_positive は falsePositives へ）
      "originalSeverity": "Critical",     // downgraded のときの元の深刻度
      "verifyReason": "検証エージェントの根拠",
      "title": "一行要約",
      "location": "path:line, path:line",
      "evidence": "...", "impact": "...", "exploit_precondition": "...",
      "fix": "...", "effort": "S"
    }
  ],
  "vulnerablePackages": [
    {
      "name": "axios", "version": "1.6.0", "fixed": "1.8.2",
      "advisory": "GHSA-xxxx / CVE-2025-xxxx", "severity": "High",
      "direct": true, "scope": "本番", "reachable": "あり（src/api/client.ts で使用）"
    }
  ],
  "passed":  [{ "category": "B", "text": "全 Workflow で permissions: contents: read を設定済み" }],
  "skipped": [{ "category": "B", "text": "branch protection: 権限不足で取得できず" }],
  "falsePositives": [{ "title": "候補の要約", "reason": "除外理由 file:line" }]
}
```
