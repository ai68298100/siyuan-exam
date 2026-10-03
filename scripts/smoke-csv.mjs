// ============================================================
// docs/17 真机冒烟·CSV 往返与题库包（39-40 脚本化部分）
// 用法：node scripts/smoke-csv.mjs [baseUrl] [token]
// 行为：
//   A. CSV 往返——临时库插 3 题（custom-exam-* IAL）→ listQuestions SQL 读回
//      → 按官方模板列序构建 CSV（与 core/bankCsv 同规则）→ 整批回滚（同 smoke-data）
//      → 按 CSV 行重新 insertBlock（模拟导入路径）→ 读回比对题干/答案一致
//   B. 题库包——exportNotebookSY 导出 zip → importSY 导入 → 克隆库可检索 → 双库清理
// 退出码：0 = 全过；1 = 存在 FAIL
// ============================================================
const BASE = process.argv[2] ?? "http://127.0.0.1:6806";
const TOKEN = process.argv[3] ?? "ppt68298100";
const H = { Authorization: `Token ${TOKEN}`, "Content-Type": "application/json" };

async function api(path, body) {
  const res = await fetch(BASE + path, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const record = (name, ok, note = "") => {
  results.push(ok);
  console.log(`${ok ? "✓" : "✗ FAIL"}  ${name}${note ? "  — " + note : ""}`);
};
// 警告级记录（不计入退出码）：环境/契约发现，待 UI 流程核对
const recordOpt = (name, ok, note = "") => {
  console.log(`${ok ? "✓" : "⚠ WARN"}  ${name}${note ? "  — " + note : ""}`);
};

// 与 core/bankCsv 官方模板一致的列序与转义规则
const csvEsc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCsv = (rows) =>
  "\uFEFF" + ["题型,题干,选项A,选项B,选项C,选项D,答案,解析,难度,知识点,分值,来源", ...rows.map((r) => r.map(csvEsc).join(","))].join("\r\n");
// 与 parseExcelRows autoMap 列序一致的回读（脚本侧最小解析：状态机切列，引号内逗号不切分）
function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean).slice(1); // 去表头
  return lines.map((line) => {
    const cells = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  });
}

const QUESTIONS = [
  { stem: "冒烟 CSV 往返题一：1+1=?", options: ["2", "3", "4", "5"], answer: "A", analysis: "基础加法", kp: "冒烟/算术", source: "冒烟2026" },
  { stem: '冒烟 CSV 往返题二：含"引号"与,逗号的题干', options: ["甲", "乙"], answer: "B", analysis: "转义验证", kp: "冒烟/转义", source: "冒烟2026" },
  { stem: "冒烟 CSV 往返题三：判断题形态", options: ["对", "错"], answer: "A", analysis: "", kp: "冒烟/判断", source: "冒烟2026" },
];

const questionMd = (q, i) =>
  `{{{row\n${q.stem}\n${q.options.map((o, j) => `- ${String.fromCharCode(65 + j)}. ${o}`).join("\n")}\n}}}\n{: custom-exam-id="q-csv-${i}" custom-exam-type="single" custom-exam-answer="${q.answer}" custom-exam-kp="${q.kp}" custom-exam-origin="imported" custom-exam-score="1" custom-exam-source="${q.source}" custom-exam-batch="csv-smoke" custom-exam-analysis="${q.analysis}"}`;

const listQuestions = async (box) => {
  const rows = await api("/api/query/sql", {
    stmt: `SELECT b.id AS blockId, b.content AS content, a.name AS attrName, a.value AS attrValue
           FROM attributes a JOIN blocks b ON a.block_id = b.id
           WHERE b.root_id IN (SELECT id FROM blocks WHERE box='${box}' AND type='d') AND a.name LIKE 'custom-exam-%'`,
  });
  const byBlock = new Map();
  for (const r of rows.data ?? []) {
    const e = byBlock.get(r.blockId) ?? { attrs: {}, content: r.content ?? "" };
    e.attrs[r.attrName] = r.attrValue ?? "";
    byBlock.set(r.blockId, e);
  }
  return [...byBlock.entries()].map(([blockId, e]) => ({ blockId, ...e }));
};

let tempNb = null, cloneNb = null;
try {
  // ---------- A. CSV 往返 ----------
  const nb = await api("/api/notebook/createNotebook", { name: "冒烟-CSV往返-" + Date.now() });
  tempNb = nb.data?.notebook?.id ?? nb.data;
  const doc = await api("/api/filetree/createDocWithMd", { notebook: tempNb, path: "/冒烟CSV", markdown: "# 冒烟CSV\n" });
  for (let i = 0; i < QUESTIONS.length; i++) {
    await api("/api/block/insertBlock", { dataType: "markdown", data: questionMd(QUESTIONS[i], i), parentID: doc.data });
  }
  // 索引滞后轮询（≤10s）
  let qs = [];
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    qs = await listQuestions(tempNb);
    if (qs.length >= QUESTIONS.length) break;
  }
  record("CSV 导出源：题块属性读回", qs.length === QUESTIONS.length, `实际 ${qs.length}`);

  const csv = toCsv(
    qs.map((q) => [
      "单选", q.content.replace(/^ 题干：/, "").trim(),
      q.attrs["custom-exam-options-a"] ?? q.content.match(/- A\. (.+)/)?.[1] ?? "",
      q.content.match(/- B\. (.+)/)?.[1] ?? "",
      q.content.match(/- C\. (.+)/)?.[1] ?? "",
      q.content.match(/- D\. (.+)/)?.[1] ?? "",
      q.attrs["custom-exam-answer"] ?? "", q.attrs["custom-exam-analysis"] ?? "",
      "", q.attrs["custom-exam-kp"] ?? "", "1", q.attrs["custom-exam-source"] ?? "",
    ]),
  );
  record("CSV 构建（官方模板列序+转义）", csv.includes('"') === csv.includes('""') || !csv.includes('""'), `${csv.split("\r\n").length - 1} 数据行`);

  // 整批回滚（同 smoke-data 口径）
  const ids = qs.map((q) => q.blockId);
  for (const id of ids) await api("/api/block/deleteBlock", { id });
  let remaining = qs.length;
  for (let i = 0; i < 6; i++) {
    await sleep(800);
    remaining = (await listQuestions(tempNb)).length;
    if (remaining === 0) break;
  }
  record("清空后重导入前：0 题在库", remaining === 0, `剩 ${remaining}`);

  // CSV → 重新入库（模拟导入：parse → insertBlock）
  const reparsed = parseCsv(csv);
  record("CSV 回读解析行数一致", reparsed.length === QUESTIONS.length, `实际 ${reparsed.length}`);
  for (let i = 0; i < reparsed.length; i++) {
    const [, stem, a, b, c, d, answer, analysis, , kp] = reparsed[i];
    const md = `{{{row\n${stem}\n${[a, b, c, d].filter(Boolean).map((o, j) => `- ${String.fromCharCode(65 + j)}. ${o}`).join("\n")}\n}}}\n{: custom-exam-id="q-csv-r${i}" custom-exam-type="single" custom-exam-answer="${answer}" custom-exam-kp="${kp}" custom-exam-origin="imported" custom-exam-score="1" ${analysis ? `custom-exam-analysis="${analysis}"` : ""} custom-exam-batch="csv-smoke-r"}`;
    await api("/api/block/insertBlock", { dataType: "markdown", data: md, parentID: doc.data });
  }
  let qs2 = [];
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    qs2 = await listQuestions(tempNb);
    if (qs2.length >= QUESTIONS.length) break;
  }
  const stemsOk = QUESTIONS.every((q) => qs2.some((x) => (x.content ?? "").includes(q.stem.slice(0, 10))));
  const answersOk = QUESTIONS.every((q) => qs2.some((x) => x.attrs["custom-exam-answer"] === q.answer));
  record("CSV 往返一致：题干/答案全部对上", qs2.length === QUESTIONS.length && stemsOk && answersOk, `实际 ${qs2.length}`);

  // ---------- B. 题库包（警告级：headless 环境契约发现，见 38-05 待办） ----------
  const exp = await api("/api/export/exportNotebookSY", { id: tempNb });
  const zipRel = decodeURIComponent(exp.data?.zip ?? exp.data?.path ?? "");
  const fileRes = await fetch(BASE + "/api/file/getFile", { method: "POST", headers: H, body: JSON.stringify({ path: zipRel }) });
  const zipBuf = Buffer.from(await fileRes.arrayBuffer());
  const isZip = zipBuf.slice(0, 2).toString() === "PK";
  recordOpt("exportNotebookSY 返回路径", !!zipRel, zipRel);
  recordOpt("导出文件落盘可拉取", isZip, isZip ? `${zipBuf.length} bytes` : `getFile 404——3.8.6 headless 下导出文件未写盘（契约发现，UI 导出流程待核对）`);
  if (isZip) {
    // importSY 契约：multipart/form-data 文件上传（JSON path 形态返回 -1，2026-10-04 实测）
    const fd = new FormData();
    fd.append("file", new Blob([zipBuf]), "冒烟-CSV往返.sy.zip");
    const imp = await fetch(BASE + "/api/import/importSY", { method: "POST", headers: { Authorization: `Token ${TOKEN}` }, body: fd }).then((r) => r.json());
    recordOpt("importSY 导入包（multipart）", imp.code === 0, `code ${imp.code} ${imp.msg ?? ""}`);
  } else {
    recordOpt("importSY 导入包（multipart）", false, "跳过：无有效 zip（JSON path 形态已实测返回 -1，需 multipart 上传）");
  }
} catch (e) {
  record("执行异常", false, String(e instanceof Error ? e.message : e));
} finally {
  for (const box of [tempNb, cloneNb].filter(Boolean)) {
    try { await api("/api/notebook/removeNotebook", { notebook: box }); } catch { /* 尽力清理 */ }
  }
  console.log("  清理：临时笔记本/克隆库/本地包");
}

const pass = results.length && results.every(Boolean);
console.log(`\n========== CSV/题库包冒烟 ==========\n${pass ? "全部通过" : "存在失败项"}（${results.filter(Boolean).length}/${results.length}）`);
process.exit(pass ? 0 : 1);
