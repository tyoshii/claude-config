#!/usr/bin/env node
// breach-audit の結果 JSON から、外部リソースに依存しない単一 HTML と Markdown のレポートを作る。
//
// Usage: node render-report.mjs <results.json> <out-dir>   → <out-dir>/report.html, <out-dir>/report.md
// 入力スキーマは assets/results-schema.md を参照。
// HTML の指摘本文はすべて textContent で描画する（コード片や攻撃文字列を含むため innerHTML に入れない）。

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [input, outDir] = process.argv.slice(2);
if (!input || !outDir) {
  console.error("Usage: node render-report.mjs <results.json> <out-dir>");
  process.exit(1);
}

const data = JSON.parse(readFileSync(input, "utf8"));
for (const key of ["findings", "vulnerablePackages", "passed", "skipped", "falsePositives", "notCovered"]) {
  data[key] ??= [];
}
data.meta ??= {};
data.summary ??= {};

// </script> による脱出と HTML 解釈を防ぐ
const json = JSON.stringify(data).replace(/</g, "\\u003c");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const html = String.raw`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>セキュリティ監査 ${esc(data.meta.repo)}</title>
<style>
:root {
  --bg: #f6f7f9; --panel: #ffffff; --text: #1d2330; --muted: #5d6676; --border: #e2e5ea; --code: #f0f2f5;
  --critical: #b4232c; --high: #d4580f; --medium: #b98900; --low: #2f6fb3; --info: #6b7280; --ok: #1f7a4d;
  --critical-bg: #fde8e9; --high-bg: #fdeee3; --medium-bg: #fbf3d9; --low-bg: #e6f0fb; --info-bg: #eef0f3;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12151b; --panel: #1a1e26; --text: #e6e9ef; --muted: #9aa3b2; --border: #2b313c; --code: #232833;
    --critical: #ff6b73; --high: #ff9a52; --medium: #e8c14d; --low: #6aa8ec; --info: #9aa3b2; --ok: #4cc38a;
    --critical-bg: #3a1a1d; --high-bg: #3a2516; --medium-bg: #352d14; --low-bg: #172a40; --info-bg: #242a33;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", "Segoe UI", sans-serif; }
main { max-width: 1120px; margin: 0 auto; padding: 32px 16px 80px; }
h1 { font-size: 26px; margin: 0 0 4px; }
h2 { font-size: 19px; margin: 40px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.meta { color: var(--muted); font-size: 13px; display: flex; flex-wrap: wrap; gap: 4px 18px; }
.warn { margin: 16px 0 0; padding: 10px 14px; border-radius: 8px; background: var(--critical-bg); color: var(--critical); font-size: 13px; font-weight: 600; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; }
.tiles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-top: 24px; }
.tile { border-radius: 10px; padding: 14px; background: var(--panel); border: 1px solid var(--border); border-top: 4px solid var(--c); cursor: pointer; text-align: left; color: inherit; font: inherit; }
.tile[aria-pressed="false"] { opacity: .45; }
.tile .n { font-size: 30px; font-weight: 700; color: var(--c); line-height: 1.1; font-variant-numeric: tabular-nums; }
.tile .l { font-size: 12px; color: var(--muted); font-weight: 600; letter-spacing: .04em; }
.overview { margin-top: 16px; white-space: pre-wrap; }
ol.actions { margin: 0; padding-left: 22px; }
ol.actions li { margin: 6px 0; }
ol.actions .why { color: var(--muted); font-size: 13px; }
a.fid { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: inherit; }
.cov { width: 100%; border-collapse: collapse; font-size: 14px; }
.cov th, .cov td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
.cov th { color: var(--muted); font-weight: 600; font-size: 12px; }
.cov td.num { text-align: right; font-variant-numeric: tabular-nums; }
.bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--code); min-width: 120px; }
.bar span { display: block; }
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
.toolbar input, .toolbar select { font: inherit; font-size: 14px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel); color: var(--text); }
.toolbar input { flex: 1 1 220px; }
.toolbar .count { color: var(--muted); font-size: 13px; margin-left: auto; }
details.f { background: var(--panel); border: 1px solid var(--border); border-left: 4px solid var(--c); border-radius: 8px; margin-bottom: 8px; }
details.f > summary { list-style: none; cursor: pointer; padding: 10px 14px; display: grid; grid-template-columns: auto auto 1fr auto; gap: 10px; align-items: center; }
details.f > summary::-webkit-details-marker { display: none; }
details.f[open] > summary { border-bottom: 1px solid var(--border); }
.sev { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; color: var(--c); background: var(--cbg); white-space: nowrap; }
.title { font-weight: 600; min-width: 0; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.tag { font-size: 11px; color: var(--muted); border: 1px solid var(--border); padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
.body { padding: 12px 16px 16px; display: grid; grid-template-columns: 130px 1fr; gap: 8px 16px; font-size: 14px; }
.body dt { color: var(--muted); font-weight: 600; font-size: 12px; padding-top: 2px; }
.body dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
code, .loc { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; background: var(--code); padding: 1px 6px; border-radius: 4px; }
.loc { display: inline-block; margin: 0 4px 4px 0; }
.fix dd { color: var(--ok); }
.st { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px; white-space: nowrap; border: 1px solid currentColor; }
.st-open { color: var(--muted); } .st-in_progress { color: var(--medium); } .st-fixed { color: var(--ok); } .st-accepted { color: var(--low); }
details.f.done > summary .title { text-decoration: line-through; color: var(--muted); }
.progress { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; font-size: 14px; }
.progress .open-hi { color: var(--critical); font-weight: 600; }
.empty { color: var(--muted); font-style: italic; padding: 8px 0; }
.tbl-wrap { overflow-x: auto; }
table.pk { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 760px; }
table.pk th, table.pk td { padding: 7px 9px; border-bottom: 1px solid var(--border); text-align: left; }
table.pk th { color: var(--muted); font-size: 12px; }
ul.plain { margin: 0; padding-left: 20px; }
ul.plain li { margin: 3px 0; }
.cat { font-size: 11px; color: var(--muted); font-weight: 700; margin-right: 6px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 760px) {
  .tiles { grid-template-columns: repeat(3, 1fr); }
  .two { grid-template-columns: 1fr; }
  details.f > summary { grid-template-columns: auto 1fr; }
  details.f > summary .tags, details.f > summary .fid { grid-column: 1 / -1; justify-content: flex-start; }
  .body { grid-template-columns: 1fr; gap: 2px; }
  .body dd { margin-bottom: 8px; }
}
@media print {
  details.f { break-inside: avoid; }
  .toolbar { display: none; }
}
</style>
</head>
<body>
<main>
  <h1 id="h"></h1>
  <div class="meta" id="meta"></div>
  <div class="warn">このレポートは脆弱性の詳細を含みます。リポジトリへのコミットや外部への共有はしないでください。</div>

  <div class="tiles" id="tiles"></div>
  <div class="panel progress" id="progress"></div>
  <div class="panel overview" id="overview" hidden></div>

  <h2>今日やるべきこと</h2>
  <div class="panel"><ol class="actions" id="actions"></ol></div>

  <section id="adv" hidden>
    <h2 id="adv-h">注意喚起との対応</h2>
    <div class="panel tbl-wrap"><table class="cov" id="adv-t"></table><div id="adv-ioc"></div></div>
  </section>

  <h2>カテゴリ別の状況</h2>
  <div class="panel tbl-wrap"><table class="cov" id="cov"></table></div>

  <h2>指摘</h2>
  <div class="toolbar">
    <input id="q" type="search" placeholder="キーワード・ファイル名で絞り込み">
    <select id="cat"><option value="">すべてのカテゴリ</option></select>
    <select id="st"><option value="">すべての対応状況</option><option value="open">未対応</option><option value="in_progress">対応中</option><option value="fixed">対応済み</option><option value="accepted">リスク受容</option></select>
    <select id="conf"><option value="">すべての確度</option><option value="high">確度 high</option><option value="medium">確度 medium</option><option value="low">確度 low</option></select>
    <button class="tag" id="toggle" type="button">すべて開く</button>
    <span class="count" id="count"></span>
  </div>
  <div id="findings"></div>

  <h2>パッケージの既知脆弱性</h2>
  <div class="panel tbl-wrap" id="pkgs"></div>

  <div class="two">
    <div><h2>対策済みと確認できた項目</h2><div class="panel" id="passed"></div></div>
    <div><h2>調べていない範囲</h2><div class="panel" id="skipped"></div></div>
  </div>

  <h2>除外した候補（誤検知）</h2>
  <div class="panel" id="fps"></div>
</main>
<script type="application/json" id="data">${json}</script>
<script>
(() => {
  const D = JSON.parse(document.getElementById("data").textContent);
  const SEV = ["Critical", "High", "Medium", "Low", "Info"];
  const CATS = { A: "依存関係・サプライチェーン", B: "CI/CD・GitHub", C: "シークレット・AI エージェント", D: "認証・認可", E: "コードの脆弱性", F: "個人情報・インフラ" };
  const VERDICT = { confirmed: "検証済み", downgraded: "検証で格下げ" };
  const STATUS = { open: "未対応", in_progress: "対応中", fixed: "対応済み", accepted: "リスク受容" };
  const stOf = (x) => (x && x.resolution && STATUS[x.resolution.status] ? x.resolution.status : "open");
  const stBadge = (x) => el("span", { className: "st st-" + stOf(x) }, STATUS[stOf(x)]);
  const isUrl = (u) => /^https?:\/\//.test(String(u || ""));
  const resText = (r) => [r.date, r.note].filter(Boolean).join(" ");
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "style") n.style.cssText = v;
      else if (k.startsWith("data-") || k.startsWith("aria-")) n.setAttribute(k, v);
      else n[k] = v;
    }
    for (const c of kids.flat()) if (c != null && c !== "") n.append(c instanceof Node ? c : String(c));
    return n;
  };
  const sevVars = (s) => { const k = String(s || "Info").toLowerCase(); return "--c: var(--" + k + "); --cbg: var(--" + k + "-bg)"; };
  const catOf = (f) => (f.category || String(f.id || "").split("-")[0] || "?").toUpperCase().slice(0, 1);
  const order = (f) => { const i = SEV.indexOf(f.severity); return i < 0 ? 9 : i; };
  const findings = [...D.findings].sort((a, b) => order(a) - order(b) || String(a.id).localeCompare(String(b.id)));

  const m = D.meta;
  $("h").textContent = "セキュリティ監査: " + (m.repo || "");
  document.title = "セキュリティ監査 " + (m.repo || "");
  $("meta").append(...[
    m.date && "実施日 " + m.date,
    m.updated && "対応状況の更新 " + m.updated,
    m.remote,
    m.commit && "commit " + String(m.commit).slice(0, 10) + (m.dirty ? "（未コミット変更あり）" : ""),
    m.depth && "depth " + m.depth,
    m.tools && m.tools.length && "スキャナ " + m.tools.join(", "),
  ].filter(Boolean).map((t) => el("span", {}, t)));

  // severity tiles = フィルタ
  const active = new Set(SEV);
  for (const s of SEV) {
    const n = findings.filter((f) => f.severity === s).length;
    const b = el("button", { className: "tile", type: "button", style: sevVars(s), "aria-pressed": "true", title: "クリックで表示切替" },
      el("div", { className: "n" }, n), el("div", { className: "l" }, s.toUpperCase()));
    b.onclick = () => { active.has(s) ? active.delete(s) : active.add(s); b.setAttribute("aria-pressed", active.has(s)); render(); };
    $("tiles").append(b);
  }
  const stCount = (st) => findings.filter((f) => stOf(f) === st).length;
  $("progress").append(el("b", {}, "対応状況"), ...Object.keys(STATUS).map((st) => el("span", {}, stBadge({ resolution: { status: st } }), " " + stCount(st))));
  const openHi = findings.filter((f) => (f.severity === "Critical" || f.severity === "High") && (stOf(f) === "open" || stOf(f) === "in_progress")).length;
  $("progress").append(el("span", { className: openHi ? "open-hi" : "" }, "Critical/High の残り " + openHi + " 件"));
  if (D.summary.overview) { $("overview").hidden = false; $("overview").textContent = D.summary.overview; }

  const acts = D.summary.topActions || [];
  if (!acts.length) $("actions").replaceWith(el("div", { className: "empty" }, "なし"));
  for (const a of acts) {
    const af = findings.find((f) => f.id === a.id);
    $("actions").append(el("li", {}, af ? stBadge(af) : "", af ? " " : "",
      a.id ? el("a", { className: "fid", href: "#f-" + a.id }, a.id) : "", a.id ? " " : "",
      a.action || "", a.reason ? el("div", { className: "why" }, a.reason) : ""));
  }

  // advisory（注意喚起を起点にした点検のときだけ）
  const adv = D.summary.advisory;
  if (adv && (adv.viewpoints || []).length) {
    $("adv").hidden = false;
    $("adv-h").textContent = "注意喚起との対応: " + (adv.title || "");
    if (adv.url) $("adv-h").after(el("div", { className: "meta" }, adv.url));
    $("adv-t").append(el("tr", {}, ["観点", "判定", "該当する指摘"].map((h) => el("th", {}, h))));
    for (const v of adv.viewpoints) {
      const ids = v.ids || [];
      $("adv-t").append(el("tr", {}, el("td", {}, v.name || ""), el("td", {}, v.verdict || ""),
        el("td", {}, ids.length ? ids.flatMap((id, i) => [i ? " " : "", el("a", { className: "fid", href: "#f-" + id }, id)]) : "—")));
    }
    if ((adv.ioc || []).length) $("adv-ioc").append(el("p", {}, "公開 IoC（ログ突合用）: ", ...adv.ioc.flatMap((x, i) => [i ? " " : "", el("code", {}, x)]),
      adv.iocNote ? el("div", { className: "why" }, adv.iocNote) : ""));
  }

  // coverage
  const catKeys = [...new Set([...Object.keys(CATS), ...findings.map(catOf)])];
  const cnt = (list, c) => list.filter((x) => (x.category || "").toUpperCase().startsWith(c)).length;
  $("cov").append(el("tr", {}, ["カテゴリ", "指摘の内訳", "指摘", "対策済み", "未調査"].map((h) => el("th", {}, h))));
  for (const c of catKeys) {
    const fs = findings.filter((f) => catOf(f) === c);
    const bar = el("div", { className: "bar" });
    for (const s of SEV) {
      const n = fs.filter((f) => f.severity === s).length;
      if (n) bar.append(el("span", { style: "flex:" + n + ";background:var(--" + s.toLowerCase() + ")", title: s + " " + n }));
    }
    const skippedAll = D.skipped.filter((x) => (x.category || "").toUpperCase().startsWith(c));
    $("cov").append(el("tr", {},
      el("td", {}, el("span", { className: "cat" }, c), CATS[c] || ""),
      el("td", {}, fs.length ? bar : el("span", { className: "empty" }, "—")),
      el("td", { className: "num" }, fs.length),
      el("td", { className: "num" }, cnt(D.passed, c)),
      el("td", { className: "num" }, skippedAll.length)));
  }

  // findings
  for (const c of catKeys) if (findings.some((f) => catOf(f) === c)) $("cat").append(el("option", { value: c }, c + ". " + (CATS[c] || "")));
  const nodes = findings.map((f) => {
    const locs = String(f.location || "").split(/\s*[,、\n]\s*/).filter(Boolean);
    const row = (k, v, cls) => v ? [el("dt", { className: cls || "" }, k), el("dd", { className: cls || "" }, v)] : [];
    const dl = el("dl", { className: "body" },
      row("場所", locs.length ? el("span", {}, locs.map((l) => el("span", { className: "loc" }, l))) : ""),
      row("根拠", f.evidence), row("影響", f.impact), row("悪用の前提", f.exploit_precondition),
      ...(f.fix ? [el("dt", {}, "修正方針"), el("dd", { style: "color:var(--ok)" }, f.fix)] : []),
      row("検証", f.verifyReason),
      ...(f.resolution ? [el("dt", {}, "対応状況"), el("dd", {}, stBadge(f), " ", resText(f.resolution),
        f.resolution.ref ? [" ", isUrl(f.resolution.ref) ? el("a", { href: f.resolution.ref, target: "_blank", rel: "noopener" }, f.resolution.ref) : el("code", {}, f.resolution.ref)] : "")] : []));
    const tags = el("span", { className: "tags" },
      stBadge(f),
      f.checklist && el("span", { className: "tag" }, f.checklist),
      f.confidence && el("span", { className: "tag" }, "確度 " + f.confidence),
      VERDICT[f.verdict] && el("span", { className: "tag" }, VERDICT[f.verdict] + (f.originalSeverity ? "（元 " + f.originalSeverity + "）" : "")),
      f.effort && el("span", { className: "tag" }, "工数 " + f.effort));
    const d = el("details", { className: "f" + (stOf(f) === "fixed" || stOf(f) === "accepted" ? " done" : ""), id: "f-" + f.id, style: sevVars(f.severity) },
      el("summary", {}, el("span", { className: "sev" }, f.severity || "Info"), el("span", { className: "fid" }, f.id || ""), el("span", { className: "title" }, f.title || ""), tags),
      dl);
    d._f = f;
    d._text = [f.id, f.title, f.location, f.evidence, f.impact, f.fix, f.checklist, f.resolution && f.resolution.note].join(" ").toLowerCase();
    return d;
  });
  $("findings").append(...nodes);
  const empty = el("div", { className: "empty" }, "該当する指摘はありません");
  $("findings").append(empty);
  function render() {
    const q = $("q").value.trim().toLowerCase(), c = $("cat").value, cf = $("conf").value, st = $("st").value;
    let shown = 0;
    for (const n of nodes) {
      const ok = active.has(n._f.severity || "Info") && (!c || catOf(n._f) === c) && (!cf || n._f.confidence === cf) && (!st || stOf(n._f) === st) && (!q || n._text.includes(q));
      n.hidden = !ok; if (ok) shown++;
    }
    empty.hidden = shown > 0;
    $("count").textContent = shown + " / " + nodes.length + " 件";
  }
  for (const id of ["q", "cat", "st", "conf"]) $(id).addEventListener("input", render);
  $("toggle").onclick = () => {
    const open = $("toggle").textContent === "すべて開く";
    nodes.forEach((n) => { if (!n.hidden) n.open = open; });
    $("toggle").textContent = open ? "すべて閉じる" : "すべて開く";
  };
  // 今日やるべきことからのジャンプで開く
  const openHash = () => { const t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t && t.tagName === "DETAILS") t.open = true; };
  addEventListener("hashchange", openHash);
  render();
  openHash();

  // packages
  if (!D.vulnerablePackages.length) $("pkgs").append(el("div", { className: "empty" }, "検出なし（または未スキャン。調べていない範囲を参照）"));
  else {
    const cols = [["name", "パッケージ"], ["version", "現行版"], ["fixed", "修正版"], ["advisory", "Advisory"], ["severity", "重大度"], ["direct", "直接/間接"], ["scope", "本番/dev"], ["reachable", "到達性"], ["resolution", "対応"]];
    const t = el("table", { className: "pk" }, el("tr", {}, cols.map(([, h]) => el("th", {}, h))));
    const pk = [...D.vulnerablePackages].sort((a, b) => order(a) - order(b));
    for (const p of pk) t.append(el("tr", {}, cols.map(([k]) => el("td", {},
      k === "severity" ? el("span", { className: "sev", style: sevVars(p.severity) }, p.severity || "") :
      k === "resolution" ? [stBadge(p), p.resolution ? " " + resText(p.resolution) : ""] :
      k === "name" || k === "version" || k === "fixed" ? el("code", {}, p[k] ?? "") :
      typeof p[k] === "boolean" ? (k === "direct" ? (p[k] ? "直接" : "間接") : (p[k] ? "あり" : "なし")) : (p[k] ?? "")))));
    $("pkgs").append(t);
  }

  const list = (target, items, fmt) => {
    if (!items.length) return $(target).append(el("div", { className: "empty" }, "なし"));
    $(target).append(el("ul", { className: "plain" }, items.map((x) => el("li", {}, ...fmt(x)))));
  };
  const catLabel = (x) => typeof x === "string" ? ["", x] : [el("span", { className: "cat" }, x.category || ""), x.text || ""];
  list("passed", D.passed, catLabel);
  list("skipped", [...D.notCovered.map((t) => ({ category: "全体", text: t })), ...D.skipped], catLabel);
  list("fps", D.falsePositives, (x) => [el("b", {}, x.title || ""), x.reason ? " — " + x.reason : ""]);
})();
</script>
</body>
</html>
`;

// ---------- Markdown ----------
const SEV = ["Critical", "High", "Medium", "Low", "Info"];
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");
const m = data.meta;
const sevCount = SEV.map((s) => data.findings.filter((f) => f.severity === s).length);
const list = (items, fmt) => (items.length ? items.map((x) => `- ${fmt(x)}`).join("\n") : "- なし");
const STATUS = { open: "未対応", in_progress: "対応中", fixed: "対応済み", accepted: "リスク受容" };
const stOf = (x) => (STATUS[x?.resolution?.status] ? x.resolution.status : "open");
const stLabel = (x) => STATUS[stOf(x)];
const resLine = (r) => [r.date, r.note, r.ref].filter(Boolean).join(" / ");
const openHi = data.findings.filter((f) => ["Critical", "High"].includes(f.severity) && ["open", "in_progress"].includes(stOf(f))).length;
const catText = (x) => (typeof x === "string" ? x : `${x.category ? `[${x.category}] ` : ""}${x.text ?? ""}`);
function advisoryMd(adv) {
  if (!adv?.viewpoints?.length) return [];
  return [
    `## 注意喚起との対応: ${adv.title ?? ""}`,
    "",
    ...(adv.url ? [adv.url, ""] : []),
    "| 観点 | 判定 | 該当する指摘 |",
    "|------|------|------|",
    ...adv.viewpoints.map((v) => `| ${cell(v.name)} | ${cell(v.verdict)} | ${(v.ids ?? []).join(", ") || "—"} |`),
    "",
    ...(adv.ioc?.length ? [`公開 IoC（ログ突合用）: ${adv.ioc.map((x) => `\`${x}\``).join(", ")}${adv.iocNote ? `（${adv.iocNote}）` : ""}`, ""] : []),
  ];
}
const md = [
  `# セキュリティ監査レポート: ${m.repo ?? ""}`,
  "",
  ...[
    m.date && `- 実施日: ${m.date}`,
    m.updated && `- 対応状況の更新: ${m.updated}`,
    (m.remote || m.commit) && `- 対象: ${[m.remote, m.commit && String(m.commit).slice(0, 10)].filter(Boolean).join(" @ ")}${m.dirty ? "（未コミット変更あり）" : ""}`,
    m.depth && `- depth: ${m.depth}`,
    m.tools?.length && `- 使用スキャナ: ${m.tools.join(", ")}`,
  ].filter(Boolean),
  "- **このレポートは脆弱性の詳細を含む。リポジトリにコミットせず、共有範囲を限定すること。**",
  "",
  "## サマリー",
  "",
  `| ${SEV.join(" | ")} |`,
  `|${SEV.map(() => "---:").join("|")}|`,
  `| ${sevCount.join(" | ")} |`,
  "",
  `対応状況: ${Object.keys(STATUS).map((st) => `${STATUS[st]} ${data.findings.filter((f) => stOf(f) === st).length}`).join(" / ")}（Critical/High の残り ${openHi} 件）`,
  "",
  data.summary.overview ?? "",
  "",
  "### 今日やるべきこと",
  "",
  ...(data.summary.topActions ?? []).map((a, i) => `${i + 1}. ${a.id ? `[${stLabel(data.findings.find((f) => f.id === a.id))}] ${a.id}: ` : ""}${a.action ?? ""}${a.reason ? `（${a.reason}）` : ""}`),
  "",
  ...advisoryMd(data.summary.advisory),
  "## 調べていない範囲",
  "",
  list([...data.notCovered, ...data.skipped], catText),
  "",
  "## 指摘一覧",
  "",
  "| ID | 深刻度 | 確度 | 対応 | 概要 | 場所 | 工数 |",
  "|----|--------|------|------|------|------|------|",
  ...data.findings.map((f) => `| ${f.id} | ${f.severity} | ${f.confidence ?? ""} | ${stLabel(f)} | ${cell(f.title)} | \`${cell(f.location)}\` | ${f.effort ?? ""} |`),
  "",
  "## 指摘の詳細",
  "",
  ...data.findings.flatMap((f) => [
    `### ${f.id}: ${f.title}`,
    "",
    `- **深刻度 / 確度**: ${f.severity} / ${f.confidence ?? ""}${f.verdict ? `（検証: ${f.verdict}${f.originalSeverity ? `、元 ${f.originalSeverity}` : ""}）` : ""}`,
    `- **場所**: \`${f.location ?? ""}\``,
    `- **根拠**: ${f.evidence ?? ""}`,
    `- **影響**: ${f.impact ?? ""}`,
    `- **悪用の前提**: ${f.exploit_precondition ?? ""}`,
    `- **修正方針**: ${f.fix ?? ""}`,
    ...(f.verifyReason ? [`- **検証の根拠**: ${f.verifyReason}`] : []),
    `- **対応状況**: ${stLabel(f)}${f.resolution && resLine(f.resolution) ? `（${resLine(f.resolution)}）` : ""}`,
    "",
  ]),
  "## パッケージの既知脆弱性",
  "",
  ...(data.vulnerablePackages.length
    ? [
        "| パッケージ | 現行版 | 修正版 | Advisory | 重大度 | 直接/間接 | 本番/dev | 到達性 | 対応 |",
        "|---|---|---|---|---|---|---|---|---|",
        ...data.vulnerablePackages.map((p) =>
          `| ${cell(p.name)} | ${cell(p.version)} | ${cell(p.fixed)} | ${cell(p.advisory)} | ${p.severity ?? ""} | ${p.direct ? "直接" : "間接"} | ${cell(p.scope)} | ${cell(p.reachable)} | ${stLabel(p)}${p.resolution && resLine(p.resolution) ? ` ${cell(resLine(p.resolution))}` : ""} |`),
      ]
    : ["検出なし"]),
  "",
  "## 対策済みと確認できた項目",
  "",
  list(data.passed, catText),
  "",
  "## 付録: 除外した候補（誤検知）",
  "",
  list(data.falsePositives, (x) => `${x.title ?? ""}${x.reason ? ` — ${x.reason}` : ""}`),
  "",
].join("\n");

writeFileSync(join(outDir, "report.html"), html);
writeFileSync(join(outDir, "report.md"), md);
console.log(join(outDir, "report.html"));
console.log(join(outDir, "report.md"));
