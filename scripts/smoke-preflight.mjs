// ============================================================
// docs/17 真机冒烟·预检脚本（可脚本化的 26 步中内核 API 部分）
// 用法：node scripts/smoke-preflight.mjs [baseUrl] [token]
// 行为：创建临时笔记本 → 端点逐一验证 → 删除临时笔记本（自清理）
// 退出码：0 = 全过；1 = 存在 FAIL
// ============================================================
import { unlinkSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:6806";
const TOKEN = process.argv[3] ?? "ppt68298100";

const results = [];
let tempNotebook = null;
let tempDocId = null;
let tempBlockId = null;
let tempDeckId = null;
let tempCardId = null;
let exportedZip = null;

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { Authorization: `Token ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function record(name, ok, note = "") {
  results.push({ name, ok, note });
  console.log(`${ok ? "✓" : "✗ FAIL"}  ${name}${note ? "  — " + note : ""}`);
}

/** 可选检查：失败只 WARN 不影响退出码 */
function recordOpt(name, ok, note = "") {
  results.push({ name, ok: true, note: (ok ? "" : "[WARN] ") + note });
  console.log(`${ok ? "✓" : "⚠ WARN"}  ${name}${note ? "  — " + note : ""}`);
}

const step = async (name, fn) => {
  try {
    const note = await fn();
    record(name, true, typeof note === "string" ? note : "");
    return true;
  } catch (e) {
    record(name, false, String(e instanceof Error ? e.message : e).slice(0, 140));
    return false;
  }
};

// ---------- 1. 内核可达 ----------
await step("system/version 内核可达", async () => {
  const r = await api("/api/system/version");
  if (r.code !== 0) throw new Error("code=" + r.code);
  return "SiYuan " + r.data;
});

// ---------- 2. lute/md2html（renderStem 依赖；3.8.5 实测 data 为 {html} 包裹） ----------
await step('lute/md2html mode:"" 返回块 DOM', async () => {
  const r = await api("/api/lute/md2html", { markdown: "**加粗**", mode: "" });
  if (r.code !== 0) throw new Error("code=" + r.code);
  const html = r.data?.html ?? "";
  if (!/<(p|div)[^>]*>/.test(html)) throw new Error("html 缺块结构: " + html.slice(0, 60));
  return "";
});

// ---------- 3. SQL ----------
await step("query/sql SELECT 1", async () => {
  const r = await api("/api/query/sql", { stmt: "SELECT 1" });
  if (r.code !== 0) throw new Error("code=" + r.code);
  return "";
});

// ---------- 4. riff 可用 ----------
await step("riff/getRiffDecks", async () => {
  const r = await api("/api/riff/getRiffDecks", {});
  if (r.code !== 0) throw new Error("code=" + r.code);
  return "";
});

// ---------- 5. 笔记本生命周期（createBank 路径） ----------
await step("notebook/createNotebook 临时库", async () => {
  const name = "lv-exam-preflight-" + Date.now().toString(36);
  const r = await api("/api/notebook/createNotebook", { name });
  if (r.code !== 0) throw new Error("code=" + r.code + " " + r.msg);
  tempNotebook = r.data.notebook.id ?? r.data.notebook;
  return tempNotebook;
});

await step("notebook/getNotebookConf", async () => {
  const r = await api("/api/notebook/getNotebookConf", { notebook: tempNotebook });
  if (r.code !== 0) throw new Error("code=" + r.code);
  return "";
});

await step("filetree/createDocWithMd /首页", async () => {
  const r = await api("/api/filetree/createDocWithMd", {
    notebook: tempNotebook,
    path: "/首页",
    markdown: "# 预检首页\n",
  });
  if (r.code !== 0) throw new Error("code=" + r.code + " " + r.msg);
  tempDocId = String(r.data ?? "");
  if (!tempDocId) throw new Error("未返回文档 id");
  return "";
});

// ---------- 6. 题块写入 + 属性读写（importer/appends/收藏路径） ----------
await step("block/insertBlock 题块（dataType+custom- IAL）", async () => {
  const md = '1+1等于几？\n{: custom-exam-id="q-preflight-test" custom-exam-type="single" custom-exam-answer="B"}';
  const r = await api("/api/block/insertBlock", {
    dataType: "markdown",
    data: md,
    parentID: tempDocId,
  });
  if (r.code !== 0) throw new Error("code=" + r.code + " " + r.msg);
  const arr = Array.isArray(r.data) ? r.data : [r.data];
  tempBlockId = arr[0]?.doOperations?.[0]?.id ?? arr[0]?.id;
  if (!tempBlockId) throw new Error("未返回块 id");
  return tempBlockId.slice(0, 8) + "…";
});

await step("attributes 表索引 custom-exam-*（导入可见性关键）", async () => {
  // 3.8.5 实测：IAL 属性随异步索引入 attributes 表（实测 >2.5s），轮询等待
  for (let i = 0; i < 10; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const r = await api("/api/query/sql", {
      stmt: `SELECT name, value FROM attributes WHERE block_id = '${tempBlockId}' AND name LIKE 'custom-exam-%'`,
    });
    if (r.code === 0 && r.data?.length) return `${r.data.length} 行（${i + 1}s）`;
  }
  throw new Error("10s 内 attributes 表未索引 custom-exam-*（导入的题将不可见）");
});

await step("attr/set+getBlockAttrs custom-exam-* 往返", async () => {
  await api("/api/attr/setBlockAttrs", {
    id: tempBlockId,
    attrs: { "custom-exam-fav": "1", "custom-exam-confidence": "3" },
  });
  const r = await api("/api/attr/getBlockAttrs", { id: tempBlockId });
  if (r.code !== 0) throw new Error("code=" + r.code);
  const attrs = r.data ?? {};
  if (attrs["custom-exam-fav"] !== "1")
    throw new Error("custom-exam-fav 回读失败: " + JSON.stringify(attrs).slice(0, 80));
  if (attrs["custom-exam-id"] !== "q-preflight-test") throw new Error("custom-exam-id 缺失");
  return "";
});

// ---------- 7. FSRS 卡片全链路（memory/convertToCards/recite 路径） ----------
await step("riff/createRiffDeck（3.8.5 返回 {id} 对象）", async () => {
  const r = await api("/api/riff/createRiffDeck", { name: "lv-exam-preflight-" + Date.now().toString(36) });
  if (r.code !== 0) throw new Error("code=" + r.code + " " + r.msg);
  const d = r.data;
  tempDeckId = typeof d === "string" ? d : d?.id;
  if (!tempDeckId) throw new Error("未返回 deckID");
  return "";
});

await step("riff/addRiffCards", async () => {
  await api("/api/riff/addRiffCards", { deckID: tempDeckId, blockIDs: [tempBlockId] });
  return "";
});

await step("riff/getRiffDueCards 回读卡（blockID→cardID 映射源）", async () => {
  await new Promise((res) => setTimeout(res, 1000));
  const r = await api("/api/riff/getRiffDueCards", { deckID: tempDeckId, reviewedCards: [] });
  if (r.code !== 0) throw new Error("code=" + r.code);
  const cards = r.data?.cards ?? [];
  const hit = cards.find((c) => c.blockID === tempBlockId);
  if (!hit?.cardID) throw new Error("due 卡未含新块（cards=" + cards.length + "）");
  tempCardId = hit.cardID;
  return "";
});

await step("riff/reviewRiffCard rating=3", async () => {
  const r = await api("/api/riff/reviewRiffCard", {
    cardID: tempCardId,
    deckID: tempDeckId,
    rating: 3,
    reviewedCards: [],
  });
  if (r.code !== 0) throw new Error("code=" + r.code + " " + r.msg);
  return "";
});

// ---------- 8. 导出 .sy.zip（题库包分享路径） ----------
await step("export/exportNotebookSY", async () => {
  const r = await api("/api/export/exportNotebookSY", { id: tempNotebook });
  if (r.code !== 0) throw new Error("code=" + r.code + " " + r.msg);
  exportedZip = r.data?.path ?? r.data;
  return typeof exportedZip === "string" ? exportedZip.split("/").pop() : "";
});

// ---------- 9. AI 端点存在性（可选：未配置模型时 WARN） ----------
recordOpt(
  "ai/chatGPT 端点可达（未配置模型则 WARN）",
  await (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15_000);
      const r = await fetch(BASE + "/api/ai/chatGPT", {
        method: "POST",
        headers: { Authorization: `Token ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ msg: "ping" }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const j = await r.json().catch(() => ({}));
      return r.ok && (j.code === 0 || /模型|model|config/i.test(j.msg ?? ""));
    } catch {
      return false;
    }
  })(),
  "未配置 AI 模型时此项为 WARN，不影响其余结论",
);

// ---------- 10. 清理：删临时卡组/笔记本 + 导出包 ----------
await step("清理：riff/removeRiffDeck + notebook/removeNotebook", async () => {
  if (tempDeckId) {
    try {
      await api("/api/riff/removeRiffDeck", { deck: tempDeckId });
    } catch {
      /* 尽力清理 */
    }
  }
  if (tempNotebook) {
    const r = await api("/api/notebook/removeNotebook", { notebook: tempNotebook });
    if (r.code !== 0) throw new Error("code=" + r.code);
  }
  return "";
});

try {
  if (exportedZip && /^[\w:/.-]+$/.test(exportedZip) && exportedZip.includes("lv-exam-preflight"))
    unlinkSync(exportedZip);
} catch {
  /* 尽力清理 */
}

// ---------- 汇总 ----------
const fail = results.filter((r) => !r.ok);
console.log("\n========== 预检汇总 ==========");
console.log(`通过 ${results.length - fail.length}/${results.length}${fail.length ? "  ✗ 存在失败项：" : "  全部通过"}`);
fail.forEach((f) => console.log(`  ✗ ${f.name} — ${f.note}`));
process.exit(fail.length ? 1 : 0);
