// ============================================================
// 万题级性能基准脚本（TODO 0 组：性能基准脚本）
// 用法：SIYUAN_TOKEN=... SIYUAN_BASE_URL=http://127.0.0.1:6807 node scripts/perf-bank.mjs [baseUrl] [token] [题量=500]
// 行为：临时笔记本写入合成题 → 计时 写入/SQL 检索/渲染 → 自清理
// 离线（内核不可达）：打印 SKIP 并以退出码 0 结束（与 preflight 的必过语义不同）。
// 阈值只作 WARN 参考不计失败——性能受机器差异影响大，看趋势不看绝对值。
// 防呆：写型基准拒打共享内核（存在非临时笔记本即退出）；豁免见 SIYUAN_E2E_ALLOW_SHARED。
// ============================================================
import { sweepOrphans, guardScratch } from "./lib/smoke-kernel.mjs";

// 注意：本脚本缺 token 走 SKIP 退出 0（可选脚本语义），故不用 resolveTarget 的硬退出
const BASE = (process.argv[2] ?? process.env.SIYUAN_BASE_URL ?? "http://127.0.0.1:6806").replace(/\/+$/, "");
const TOKEN = process.argv[3] ?? process.env.SIYUAN_TOKEN ?? "";
const N = Math.max(50, Math.min(5000, parseInt(process.argv[4] ?? "500", 10) || 500));

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

/** createNotebook 双形态解析（3.8.5 裸 id / 3.8.6 { notebook: { id } }——本脚本实测发现的漂移） */
function parseNotebookId(r) {
  const d = r.data;
  const id = typeof d === "string" ? d : String(d?.notebook?.id ?? "");
  if (!id) throw new Error(`createNotebook 未返回 id: ${JSON.stringify(d).slice(0, 80)}`);
  return id;
}

const t = (ms, warnMs) => `${ms.toFixed(0)}ms${ms > warnMs ? `  ⚠ 超参考值 ${warnMs}ms` : ""}`;

// ---------- 合成题（与 questionToMarkdown 同构：块 + custom-exam-* IAL） ----------
function synthQuestion(i) {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `{{{row\n这是性能基准合成题 ${i}：计算 ${i} + ${i * 2} 的结果并选择正确选项。\n- A. ${i * 3}\n- B. ${i * 2}\n- C. ${i}\n- D. 无法计算\n}}}\n{: custom-exam-id="q-perf${i.toString(36).padStart(4, "0")}" custom-exam-type="single" custom-exam-answer="A" custom-exam-origin="imported" custom-exam-score="1" custom-exam-kp="${esc("基准/考点" + (i % 20))}" custom-exam-batch="b-perf"}`;
}

async function main() {
  if (!TOKEN) {
    console.log("SKIP  性能基准需要 SIYUAN_TOKEN（不会使用默认 token）");
    return 0;
  }
  // ---------- 0. 内核可达（离线 → SKIP） ----------
  // eslint-disable-next-line no-useless-assignment
  let version = "";
  try {
    const r = await api("/api/system/version");
    version = String(r.data ?? "");
  } catch (e) {
    console.log(`SKIP  性能基准需要运行中的思源内核（${BASE}）：${String(e).slice(0, 80)}`);
    console.log("      这是可选脚本；真机数据请连上内核后重跑。");
    return 0;
  }
  console.log(`[lv-exam] 性能基准 · SiYuan ${version} · 合成题 ${N} 道`);

  await sweepOrphans(api); // 清上次崩溃残留的临时库（只动冒烟前缀）
  await guardScratch(api, { base: BASE }); // 共享内核拒跑：500+ 题写入会真实搅动索引与事件

  const nb = await api("/api/notebook/createNotebook", { name: `lv-exam-smoke-perf-${Date.now().toString(36)}` });
  const notebookId = parseNotebookId(nb);
  // eslint-disable-next-line no-useless-assignment
  let docId = "";
  let failed = false;
  try {
    // ---------- 1. 写入（分批 20，与 appendQuestions 同批策略） ----------
    docId = parseNotebookId(
      await api("/api/filetree/createDocWithMd", { notebook: notebookId, path: "/perf", markdown: "# perf\n\n" }),
    );
    if (!docId) throw new Error("createDocWithMd 未返回文档 id");
    const batches = [];
    for (let i = 0; i < N; i += 20)
      batches.push(Array.from({ length: Math.min(20, N - i) }, (_, j) => synthQuestion(i + j)).join("\n"));
    let t0 = performance.now();
    for (const md of batches) {
      await api("/api/block/insertBlock", { dataType: "markdown", data: md, parentID: docId });
    }
    const writeMs = performance.now() - t0;
    console.log(`写入 ${N} 题（${batches.length} 批）: ${t(writeMs, N * 6)}`);

    // ---------- 2. 索引滞后等待（3.8.5 实测 1-3s） ----------
    await new Promise((r) => setTimeout(r, 2000));

    // ---------- 3. listQuestions 式 SQL 检索（attributes join；含索引滞后重试，等待不计入查询耗时） ----------
    let rows = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      await new Promise((r) => setTimeout(r, 1500));
      const t0 = performance.now();
      const q = await api("/api/query/sql", {
        stmt: `SELECT b.id AS blockId, b.root_id AS rootId, a.name AS attrName, a.value AS attrValue
             FROM attributes a JOIN blocks b ON a.block_id = b.id
             WHERE b.root_id IN (SELECT id FROM blocks WHERE box='${notebookId}' AND type='d')
               AND a.name LIKE 'custom-exam-%'`,
      });
      const queryMs = performance.now() - t0;
      rows = Array.isArray(q.data) ? q.data : [];
      if (rows.length >= N * 6) {
        console.log(`SQL 检索（${rows.length} 行属性，索引等待 ${attempt * 1.5}s 后）: ${t(queryMs, 800)}`);
        break;
      }
      if (attempt === 5) console.log(`SQL 检索：5 次重试后仍只有 ${rows.length} 行（索引未就绪或内核行为变化）`);
    }

    // ---------- 4. 渲染（md2html 20 题） ----------
    t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      await api("/api/lute/md2html", { markdown: synthQuestion(i), mode: "" });
    }
    const renderMs = performance.now() - t0;
    console.log(`渲染 20 题: ${t(renderMs, 1000)}`);

    // ---------- 5. 结论 ----------
    console.log(`\n结论：写入 ${t(writeMs, N * 6)}  渲染 ${t(renderMs, 1000)}（参考值随机器浮动，只看趋势）`);
  } catch (e) {
    failed = true;
    console.error("✗ FAIL", String(e).slice(0, 160));
  } finally {
    if (notebookId) {
      try {
        await api("/api/notebook/removeNotebook", { notebook: notebookId });
      } catch {
        /* 清理失败不掩盖结果 */
      }
    }
  }
  return failed ? 1 : 0;
}

process.exit(await main());
