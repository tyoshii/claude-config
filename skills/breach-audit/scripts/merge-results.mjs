#!/usr/bin/env node
// breach-audit の監査エージェント・検証エージェントの出力を統合し、results.json を作る。
//
// Usage:
//   node merge-results.mjs <WORK> --candidates   重複候補（同じファイルの近い行を指す指摘）を表示するだけ
//   node merge-results.mjs <WORK>                <WORK>/results.json を書き出す
//
// 入力（<WORK> 配下）:
//   agents/<X>.json   各カテゴリのエージェント出力（必須。コードフェンス付きでも可）
//   verify.json       検証エージェントの出力 [{id, verdict, severity, reason}]（任意）
//   summary.json      メインが書く {meta, summary, notCovered, merges:[{keep, drop:[...]}]}（任意）
//   status.json       監査後の対応状況 {updated, findings:{<id>:{status,note,ref,date}}, packages:{<name>:{...}}}（任意）
//
// 正規化: HTML エンティティのデコード、深刻度表記の統一（critical→Critical, moderate→Medium）、
// passed/skipped の文字列を {category, text} に、merges の統合、verdict の反映（false_positive は除外欄へ）。

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [work, flag] = process.argv.slice(2);
if (!work) {
  console.error("Usage: node merge-results.mjs <WORK> [--candidates]");
  process.exit(1);
}

const SEV = ["Critical", "High", "Medium", "Low", "Info"];
const SEV_ALIAS = { critical: "Critical", high: "High", medium: "Medium", moderate: "Medium", low: "Low", info: "Info", informational: "Info" };
const normSev = (s) => SEV_ALIAS[String(s ?? "").toLowerCase()] ?? "Info";
const rank = (s) => SEV.indexOf(normSev(s));

const ENTITIES = { "&gt;": ">", "&lt;": "<", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'" };
const decode = (v) =>
  typeof v === "string"
    ? v.replace(/&(gt|lt|amp|quot|apos|#39);/g, (m) => ENTITIES[m])
    : Array.isArray(v)
      ? v.map(decode)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]))
        : v;

function readJson(path) {
  const raw = readFileSync(path, "utf8");
  // コードフェンスや前後の説明文があっても、最初の { / [ から最後の } / ] までを読む
  const start = raw.search(/[[{]/);
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (start < 0 || end < start) throw new Error(`JSON が見つからない: ${path}`);
  try {
    return decode(JSON.parse(raw.slice(start, end + 1)));
  } catch (e) {
    throw new Error(`JSON を解析できない: ${path}: ${e.message}`);
  }
}

const agentsDir = join(work, "agents");
if (!existsSync(agentsDir)) {
  console.error(`${agentsDir} がない。各エージェントの出力を agents/<X>.json に保存すること`);
  process.exit(1);
}
const agentOutputs = readdirSync(agentsDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => ({ file: f, data: readJson(join(agentsDir, f)) }));

let findings = [];
const vulnerablePackages = [];
const passed = [];
const skipped = [];
for (const { file, data } of agentOutputs) {
  const cat = String(data.category ?? file.replace(/\.json$/, "")).toUpperCase();
  for (const f of data.findings ?? []) findings.push({ ...f, category: f.category ?? cat, severity: normSev(f.severity) });
  for (const p of data.vulnerablePackages ?? []) vulnerablePackages.push({ ...p, severity: normSev(p.severity) });
  for (const p of data.passed ?? []) passed.push(typeof p === "string" ? { category: cat, text: p } : p);
  for (const s of data.skipped ?? []) skipped.push(typeof s === "string" ? { category: cat, text: s } : s);
}

// 重複候補: 同じファイルを指し、行番号が 10 行以内で重なる、または同じファイルで checklist の観点が近いもの
const locs = (f) =>
  String(f.location ?? "")
    .split(/\s*[,、\n]\s*/)
    .map((l) => l.match(/^([^:\s]+\.[\w]+)(?::(\d+))?/))
    .filter(Boolean)
    .map((m) => ({ path: m[1], line: m[2] ? Number(m[2]) : null }));
function candidates(list) {
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.category === b.category) continue;
      const hit = locs(a).some((x) => locs(b).some((y) => x.path === y.path && (x.line == null || y.line == null || Math.abs(x.line - y.line) <= 10)));
      if (hit) pairs.push([a, b]);
    }
  }
  return pairs;
}

if (flag === "--candidates") {
  const pairs = candidates(findings);
  if (!pairs.length) console.log("重複候補なし");
  for (const [a, b] of pairs) console.log(`${a.id} (${a.severity}) ~ ${b.id} (${b.severity})\n  ${a.title}\n  ${b.title}`);
  console.log(`\n合計 ${findings.length} 件 / 重複候補 ${pairs.length} 組。統合するものは summary.json の merges に {"keep": "...", "drop": [...]} で書く。`);
  process.exit(0);
}

const summary = existsSync(join(work, "summary.json")) ? readJson(join(work, "summary.json")) : {};

// merges の適用: keep に drop の checklist・location を寄せ、深刻度は最大を採る
const byId = new Map(findings.map((f) => [f.id, f]));
for (const { keep, drop = [] } of summary.merges ?? []) {
  const k = byId.get(keep);
  if (!k) throw new Error(`merges.keep が見つからない: ${keep}`);
  for (const id of drop) {
    const d = byId.get(id);
    if (!d) throw new Error(`merges.drop が見つからない: ${id}`);
    if (rank(d.severity) < rank(k.severity)) k.severity = d.severity;
    k.checklist = [...new Set([k.checklist, d.checklist].join(" / ").split(/\s*\/\s*/).filter(Boolean))].join(" / ");
    const extra = String(d.location ?? "").split(/\s*,\s*/).filter((l) => l && !String(k.location ?? "").includes(l));
    if (extra.length) k.location = [k.location, ...extra].filter(Boolean).join(", ");
    k.mergedFrom = [...(k.mergedFrom ?? []), id];
    byId.delete(id);
  }
}
findings = [...byId.values()];
for (const f of findings) {
  if (f.mergedFrom) f.evidence = `${f.evidence ?? ""}\n（${f.mergedFrom.join("・")} と同じ根本原因のため統合）`.trim();
}

// verify の反映
const falsePositives = [...(summary.falsePositives ?? [])];
const verify = existsSync(join(work, "verify.json")) ? readJson(join(work, "verify.json")) : [];
for (const v of Array.isArray(verify) ? verify : verify.results ?? []) {
  const f = findings.find((x) => x.id === v.id);
  if (!f) continue;
  if (v.verdict === "false_positive") {
    falsePositives.push({ title: `${f.id}: ${f.title}`, reason: v.reason ?? "" });
    findings = findings.filter((x) => x !== f);
    continue;
  }
  f.verdict = v.verdict;
  f.verifyReason = v.reason;
  const ns = normSev(v.severity ?? f.severity);
  if (ns !== f.severity) {
    f.originalSeverity = f.severity;
    f.severity = ns;
  }
}

// 対応状況（status.json）の反映。監査後に対応が進むたびにメインが更新し、merge → render をやり直す
const STATUS = ["open", "in_progress", "fixed", "accepted", "false_positive"];
const status = existsSync(join(work, "status.json")) ? readJson(join(work, "status.json")) : {};
const resolution = (key, s) => {
  if (!STATUS.includes(s.status)) throw new Error(`status.json の status が不正: ${key}: ${s.status}（${STATUS.join(" / ")}）`);
  return { status: s.status, note: s.note, ref: s.ref, date: s.date };
};
for (const [id, s] of Object.entries(status.findings ?? {})) {
  const f = findings.find((x) => x.id === id) ?? findings.find((x) => x.mergedFrom?.includes(id));
  if (!f) {
    console.error(`注意: status.json の ${id} に対応する指摘がない（verify で除外済み？）`);
    continue;
  }
  if (s.status === "false_positive") {
    falsePositives.push({ title: `${f.id}: ${f.title}`, reason: `対応時に誤検知と判明${s.date ? `（${s.date}）` : ""}: ${s.note ?? ""}` });
    findings = findings.filter((x) => x !== f);
    continue;
  }
  f.resolution = resolution(id, s);
}
for (const [name, s] of Object.entries(status.packages ?? {})) {
  const hits = vulnerablePackages.filter((p) => p.name === name);
  if (!hits.length) console.error(`注意: status.json の packages.${name} に対応するパッケージがない`);
  for (const p of hits) p.resolution = resolution(name, s);
}

findings.sort((a, b) => rank(a.severity) - rank(b.severity) || String(a.id).localeCompare(String(b.id)));
vulnerablePackages.sort((a, b) => rank(a.severity) - rank(b.severity) || (a.scope === "dev") - (b.scope === "dev"));

const results = {
  meta: { ...(summary.meta ?? {}), ...(status.updated ? { updated: status.updated } : {}) },
  summary: summary.summary ?? {},
  notCovered: summary.notCovered ?? [],
  findings,
  vulnerablePackages,
  passed,
  skipped,
  falsePositives,
};
writeFileSync(join(work, "results.json"), JSON.stringify(results, null, 2));

const count = Object.fromEntries(SEV.map((s) => [s, findings.filter((f) => f.severity === s).length]));
const progress = Object.fromEntries(STATUS.slice(0, 4).map((st) => [st, findings.filter((f) => (f.resolution?.status ?? "open") === st).length]));
console.log(JSON.stringify({ results: join(work, "results.json"), count, progress, packages: vulnerablePackages.length, falsePositives: falsePositives.length }));
if (!summary.summary?.overview) console.log("注意: summary.json の summary.overview / topActions が未記入");
