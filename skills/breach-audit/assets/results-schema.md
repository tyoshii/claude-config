# breach-audit の中間ファイルと results.json

```
$WORK/
├── inventory.json        scripts/inventory.mjs の出力
├── agents/<X>.json       各監査エージェントの出力（SKILL.md 手順 3 の形式）
├── verify.json           検証エージェントの出力
├── summary.json          メインが書く（下記）
├── status.json           監査後の対応状況。対応のたびにメインが更新する（下記）
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
    ],
    "advisory": {                         // 任意。注意喚起（NICT・JPCERT・IPA 等）を起点に点検したときだけ書く
      "title": "NICT A2B 攻撃 注意喚起 Rev1.1",
      "url": "https://...",
      "viewpoints": [                     // 注意喚起が挙げる観点を全部並べる。該当なしも「問題なし」で残す
        { "name": "認可不備（IDOR / BOLA）", "verdict": "要修正", "ids": ["D-1", "D-2"] },
        { "name": "SSRF", "verdict": "問題なし", "ids": [] }
      ],
      "ioc": ["198.51.100.1"],            // 注意喚起に載っている IoC（IP・UA・ハッシュ等）。そのまま転記
      "iocNote": "注意喚起の観測開始以降の API Gateway / WAF ログと突合"
    }
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

## status.json（対応のたびにメインが更新する）

```jsonc
{
  "updated": "2026-10-15",                // 最後に更新した日。レポートに「対応状況の更新」として表示
  "findings": {
    "C-1": { "status": "fixed", "note": "鍵を失効・ローテーションし .env を削除", "ref": "https://github.com/owner/repo/pull/12", "date": "2026-10-15" },
    "D-2": { "status": "in_progress", "ref": "owner/repo#34" },
    "F-1": { "status": "accepted", "note": "社内ネットワーク限定のため受容（〇〇さん判断）", "date": "2026-10-16" },
    "E-3": { "status": "false_positive", "note": "上流のミドルウェアで検証済み src/mw.ts:20" }
  },
  "packages": {                           // vulnerablePackages の name をキーにする
    "next": { "status": "fixed", "ref": "owner/repo#35", "date": "2026-10-15" }
  }
}
```

- `status`: `open`（未対応。エントリが無ければこれ）/ `in_progress`（対応中）/ `fixed`（対応済み）/ `accepted`（リスク受容）/ `false_positive`（対応中に誤検知と判明）
- `false_positive` は本編から外し、`falsePositives` に移す
- merges で drop した id を書いても、keep 側の指摘に反映される

## verify.json（検証エージェントが書く）

```json
[{ "id": "A-1", "verdict": "confirmed|downgraded|false_positive", "severity": "Medium", "reason": "根拠 file:line" }]
```

## results.json（merge-results.mjs が生成）

```jsonc
{
  "meta": { ... },                        // summary.json から。status.json の updated があれば meta.updated に入る
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
      "fix": "...", "effort": "S",
      "resolution": { "status": "fixed", "note": "...", "ref": "...", "date": "..." }   // status.json から（無ければ未対応）
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
