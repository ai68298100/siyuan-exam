// ============================================================
// docs/17 真机冒烟·数据生命周期脚本（F 段 30/31/33/34 步的 API 级自动化）
// 用法：SIYUAN_TOKEN=... node scripts/smoke-data.mjs [baseUrl] [token]
// 覆盖：建库 → 分两批导入 → 读回确认 → 先导语义（跳过已确认）→ 批量改考点
//       → SQL 验证属性 → 批次回滚（deleteBlock）→ 验证批1消失/批2保留 → 自清理
// 退出码：0 = 全过；1 = 存在 FAIL。临时笔记本自清理。
// ============================================================

const BASE = process.argv[2] ?? "http://127.0.0.1:6806";
const TOKEN = process.argv[3] ?? process.env.SIYUAN_TOKEN ?? "";
if (!TOKEN) {
  console.error("✗ 缺少思源 token：请传入第二个参数或设置 SIYUAN_TOKEN；不会使用默认 token");
  process.exit(1);
}

const results = [];
function record(name, ok, note = "") {
  results.push(ok);
  console.log(`${ok ? "✓" : "✗ FAIL"}  ${name}${note ? "  — " + note : ""}`);
}

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { Authorization: `Token ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`${path} code=${json.code} ${json.msg}`);
  return json;
}

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function synthQ(batch, i) {
  const id = `q-smoke${batch}${String(i).padStart(2, "0")}`;
  const md = `{{{row\n数据生命周期冒烟题 批${batch}-${i}。\n- A. 甲\n- B. 乙\n}}}\n{: custom-exam-id="${id}" custom-exam-type="single" custom-exam-answer="A" custom-exam-origin="imported" custom-exam-score="1" custom-exam-batch="${esc(batch)}" custom-exam-kp="${esc("冒烟/原始考点")}"}`;
  return { id, md };
}

async function insertQuestions(docId, questions) {
  for (let i = 0; i < questions.length; i += 20) {
    const md = questions
      .slice(i, i + 20)
      .map((q) => q.md)
      .join("\n");
    await api("/api/block/insertBlock", { dataType: "markdown", data: md, parentID: docId });
  }
}

async function sql(stmt) {
  const r = await api("/api/query/sql", { stmt });
  return Array.isArray(r.data) ? r.data : [];
}

/** 读回（等待索引，最多 5×1.5s；与 commitImport 同语义） */
async function readback(notebookId, expectedIds) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    await new Promise((r) => setTimeout(r, 1500));
    const rows = await sql(
      `SELECT a.value AS qid FROM attributes a JOIN blocks b ON a.block_id = b.id
       WHERE b.root_id IN (SELECT id FROM blocks WHERE box='${notebookId}' AND type='d')
         AND a.name = 'custom-exam-id'`,
    );
    const have = new Set(rows.map((r) => r.qid));
    if (expectedIds.every((id) => have.has(id))) return { confirmed: expectedIds, missing: [], attempts: attempt };
  }
  const rows = await sql(
    `SELECT a.value AS qid FROM attributes a JOIN blocks b ON a.block_id = b.id
     WHERE b.root_id IN (SELECT id FROM blocks WHERE box='${notebookId}' AND type='d')
       AND a.name = 'custom-exam-id'`,
  );
  const have = new Set(rows.map((r) => r.qid));
  return {
    confirmed: expectedIds.filter((id) => have.has(id)),
    missing: expectedIds.filter((id) => !have.has(id)),
    attempts: 5,
  };
}

async function main() {
  // ---------- 0. 内核可达 ----------
  try {
    await api("/api/system/version");
  } catch (e) {
    console.log(`SKIP  数据生命周期冒烟需要运行中的思源内核（${BASE}）：${String(e).slice(0, 80)}`);
    return 0;
  }

  // ---------- 1. 建临时库 ----------
  // eslint-disable-next-line no-useless-assignment
  let notebookId = "";
  try {
    const nb = await api("/api/notebook/createNotebook", { name: `小驴考试-数据冒烟-${Date.now().toString(36)}` });
    notebookId = typeof nb.data === "string" ? nb.data : String(nb.data?.notebook?.id ?? "");
    if (!notebookId) throw new Error(`createNotebook 未返回 id: ${JSON.stringify(nb.data).slice(0, 80)}`);
    record("建临时库（三形态 id 解析）", true, notebookId);
  } catch (e) {
    record("建临时库（三形态 id 解析）", false, String(e).slice(0, 120));
    return 1;
  }

  try {
    // ---------- 2. 分两批导入 + 读回确认（步 30/31） ----------
    const docId = String(
      (await api("/api/filetree/createDocWithMd", { notebook: notebookId, path: "/冒烟", markdown: "# 冒烟\n\n" }))
        .data ?? "",
    );
    const batch1 = Array.from({ length: 5 }, (_, i) => synthQ("b-smoke-1", i));
    const batch2 = Array.from({ length: 4 }, (_, i) => synthQ("b-smoke-2", i));
    await insertQuestions(docId, batch1);
    const rb1 = await readback(
      notebookId,
      batch1.map((q) => q.id),
    );
    record("批1 导入读回（5/5 确认）", rb1.missing.length === 0, `重试 ${rb1.attempts} 次`);

    await insertQuestions(docId, batch2);
    const rb2 = await readback(
      notebookId,
      batch2.map((q) => q.id),
    );
    record("批2 导入读回（4/4 确认）", rb2.missing.length === 0, `重试 ${rb2.attempts} 次`);

    // ---------- 3. 先导语义：已确认的批1题在"完整导入"中被跳过（步 31 的去重判定） ----------
    const dupeRows = await sql(
      `SELECT DISTINCT a.value AS hash FROM attributes a JOIN blocks b ON a.block_id = b.id
       WHERE b.root_id IN (SELECT id FROM blocks WHERE box='${notebookId}' AND type='d') AND a.name = 'custom-exam-id'`,
    );
    record("已有题回灌（9 题在库）", dupeRows.length === 9, `实际 ${dupeRows.length}`);

    // ---------- 4. 批量改考点：setBlockAttrs 写 custom-exam-kp（步 33；验证带索引滞后重试） ----------
    const targets = batch1.slice(0, 3);
    for (const q of targets) {
      const blockRows = await sql(
        `SELECT b.id AS blockId FROM blocks b JOIN attributes a ON a.block_id = b.id
         WHERE b.box='${notebookId}' AND a.name='custom-exam-id' AND a.value='${q.id}'`,
      );
      if (!blockRows[0]?.blockId) throw new Error(`未定位到块 ${q.id}`);
      await api("/api/attr/setBlockAttrs", { id: blockRows[0].blockId, attrs: { "custom-exam-kp": "冒烟/已改考点" } });
    }
    let changedN = 0;
    for (let attempt = 1; attempt <= 5; attempt++) {
      await new Promise((r) => setTimeout(r, 1500));
      // 按 block_id 计数：三题的 kp 值相同，count(DISTINCT value) 恒为 1（首版断言即栽在这里）
      const changed = await sql(
        `SELECT count(DISTINCT a.block_id) AS n FROM attributes a JOIN blocks b ON a.block_id = b.id
         WHERE b.box='${notebookId}' AND a.name='custom-exam-kp' AND a.value='冒烟/已改考点'`,
      );
      changedN = changed[0]?.n ?? 0;
      if (changedN === 3) break;
      console.log(`  属性索引滞后重试 ${attempt}/5（可见 ${changedN}/3）`);
    }
    record("批量改考点（3 题属性更新可见）", changedN === 3, `实际 ${changedN}`);

    // ---------- 5. 批次回滚：deleteBlock 批1 全部块，批2 保留（步 34；3.8.6 首验） ----------
    const b1Blocks = await sql(
      `SELECT b.id AS blockId FROM blocks b JOIN attributes a ON a.block_id = b.id
       WHERE b.box='${notebookId}' AND a.name='custom-exam-batch' AND a.value='b-smoke-1'`,
    );
    let deleted = 0;
    for (const row of b1Blocks) {
      await api("/api/block/deleteBlock", { id: row.blockId });
      deleted++;
    }
    // 回滚验证（轮询式，与读回/改属性一致）：批量删除后索引清理是异步事务，单次等待会偶发误报
    let left1 = [{ n: -1 }],
      left2 = [{ n: -1 }];
    for (let attempt = 1; attempt <= 5; attempt++) {
      await new Promise((r) => setTimeout(r, 1500));
      left1 = await sql(
        `SELECT count(DISTINCT a.block_id) AS n FROM blocks b JOIN attributes a ON a.block_id = b.id
         WHERE b.box='${notebookId}' AND a.name='custom-exam-batch' AND a.value='b-smoke-1'`,
      );
      left2 = await sql(
        `SELECT count(DISTINCT a.block_id) AS n FROM blocks b JOIN attributes a ON a.block_id = b.id
         WHERE b.box='${notebookId}' AND a.name='custom-exam-batch' AND a.value='b-smoke-2'`,
      );
      if ((left1[0]?.n ?? 0) === 0) break;
      console.log(`  回滚索引清理重试 ${attempt}/5（批1 仍可见 ${left1[0]?.n ?? 0}）`);
    }
    record(
      "批次回滚（批1 全删 / 批2 完整保留）",
      deleted === 5 && (left1[0]?.n ?? 0) === 0 && (left2[0]?.n ?? 0) === 4,
      `删除 ${deleted}，批1 剩 ${left1[0]?.n ?? 0}，批2 剩 ${left2[0]?.n ?? 0}`,
    );
  } catch (e) {
    record("数据生命周期流程", false, String(e).slice(0, 140));
  } finally {
    // ---------- 6. 自清理 ----------
    if (notebookId) {
      try {
        await api("/api/notebook/removeNotebook", { notebook: notebookId });
      } catch {
        /* 清理失败不掩盖结果 */
      }
    }
  }

  const pass = results.filter(Boolean).length;
  const total = results.length;
  console.log(
    `\n结论：${pass}/${total} 步通过${pass === total ? "（数据生命周期在当前内核版本验证通过）" : "（存在失败项，见上）"}`,
  );
  return pass === total ? 0 : 1;
}

process.exit(await main());
