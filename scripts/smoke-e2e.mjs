// ============================================================
// 真机数据层走查（docs/17 27/28/36-38 的可自动化面）
// 只读：不调用内核写接口、不修改 petal 存储文件——与并行插件开发零干扰。
// 验证面：
//   37-01  petal 存储路径语义（含 / 的 key → 子目录）+ 各存储文件存在性
//   27/28  mock/run 快照 schema（runId/wall-clock 字段）与 attempts/log 信封
//   36     attempts 事件 confidence 字段
//   37     actions/items schema
//   38     ai/explain-history + ai/usage schema
//   48-03  checkin 桥 pending/事件痕迹（exam: 前缀是否已出现在打卡侧）
// 用法：node scripts/smoke-e2e.mjs [--json]
// 退出码：0 = 所有关键面通过或"尚未产生数据"（待用户使用后复跑）；
//         1 = 存在的数据不符合 schema（真缺陷）
// ============================================================
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WORKSPACE = "D:/小飞驴的SIYUAN";
const PETAL = join(WORKSPACE, "storage/petal/siyuan-exam");

const results = [];
const record = (name, status, note = "") => {
  // pass | wait(尚无数据，待使用后复跑) | fail(数据存在但不符合 schema)
  results.push({ name, status, note });
  const icon = status === "pass" ? "✓" : status === "wait" ? "…" : "✗ FAIL";
  console.log(`${icon}  ${name}${note ? "  — " + note : ""}`);
};

const readJson = (rel) => {
  const p = join(PETAL, ...rel.split("/"));
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null; // 存在但解析失败
  }
};

// ---------- 0. 插件安装态 ----------
const pluginJson = join(WORKSPACE, "data/plugins/siyuan-exam/plugin.json");
let version = "?";
try {
  version = JSON.parse(readFileSync(pluginJson, "utf8")).version;
} catch { /* 未安装 */ }
const deployed = existsSync(pluginJson);
console.log(`安装态：${deployed ? "已部署 v" + version : "未找到"} · petal 存储：${existsSync(PETAL) ? "已建立" : "尚未建立（首次保存时创建）"}\n`);

// ---------- 1. 37-01 路径语义 + 存储存在性 ----------
const EXPECTED = [
  { key: "attempts/log", file: "attempts/log.json", label: "27/28 作答流水（信封 v2）", critical: true },
  { key: "mock/run", file: "mock/run.json", label: "27 模考运行快照", critical: false },
  { key: "mock/blueprint", file: "mock/blueprint.json", label: "模考蓝图", critical: false },
  { key: "mock/results", file: "mock/results.json", label: "模考成绩历史", critical: false },
  { key: "session/active", file: "session/active.json", label: "练习续做快照", critical: false },
  { key: "actions/items", file: "actions/items.json", label: "37 下一步行动", critical: false },
  { key: "ai/explain-history", file: "ai/explain-history.json", label: "38 AI 讲解记录", critical: false },
  { key: "ai/usage", file: "ai/usage.json", label: "AI 用量记账", critical: false },
  { key: "wrongbook/overlays", file: "wrongbook/overlays.json", label: "错题处置覆盖层", critical: false },
];

let anyData = false;
for (const { key, file, label } of EXPECTED) {
  const data = readJson(file);
  if (data === undefined) {
    record(`${label}（${key}）`, "wait", "尚无数据");
    continue;
  }
  anyData = true;
  if (data === null) {
    record(`${label}（${key}）`, "fail", "文件存在但非合法 JSON");
    continue;
  }
  // 37-01 路径语义：key 含 "/" → 文件确实落在子目录（join 路径已隐式验证 existsSync）
  record(`${label}（${key}）`, "pass", "schema 可解析，路径语义正确");
}

// ---------- 2. 27/28 attempts/log 信封 + 36 confidence ----------
const log = readJson("attempts/log");
if (log) {
  const events = Array.isArray(log?.events) ? log.events : Array.isArray(log) ? log : null;
  if (!events) {
    record("作答流水信封", "fail", "既非 {v,events} 也非数组");
  } else {
    record("作答流水信封 {v,events}", "pass", `${events.length} 事件 · schema v${log.v ?? "?"}`);
    const withConf = events.filter((e) => e.confidence);
    const withHelp = events.filter((e) => e.help);
    const withRecall = events.filter((e) => e.recall);
    record("36 信心字段（confidence）", withConf.length ? "pass" : "wait",
      withConf.length ? `${withConf.length} 事件携带` : "尚无携带 confidence 的作答");
    record("114-01 受助字段（help）", withHelp.length ? "pass" : "wait",
      withHelp.length ? `${withHelp.length} 事件携带` : "尚无");
    record("52-02 先回忆字段（recall）", withRecall.length ? "pass" : "wait",
      withRecall.length ? `${withRecall.length} 事件携带` : "尚无");
    // 28 过期口径：mock 事件的 examId 应为 runId（r- 前缀），与蓝图 id 分离
    const mockEvents = events.filter((e) => e.kind === "mock");
    const badExamId = mockEvents.filter((e) => e.examId && !String(e.examId).startsWith("r-"));
    record("28 模考事件 examId=runId", mockEvents.length ? (badExamId.length ? "fail" : "pass") : "wait",
      mockEvents.length ? `${mockEvents.length} 事件${badExamId.length ? `，${badExamId.length} 个非 r- 前缀` : ""}` : "尚无模考作答");
  }
} else if (log === null) {
  record("作答流水信封 {v,events}", "fail", "文件存在但非合法 JSON");
}

// ---------- 3. 27 mock/run 快照字段 ----------
const run = readJson("mock/run");
if (run && typeof run === "object") {
  const required = ["runId", "bp", "qids", "startedAt", "savedAt"];
  const missing = required.filter((k) => run[k] == null);
  const hasQVersions = run.qVersions != null; // 55-07 冻结题版
  record("27 模考运行快照 schema", missing.length ? "fail" : "pass",
    `runId=${String(run.runId).slice(0, 12)}…${missing.length ? `，缺 ${missing.join("/")}` : ""}${hasQVersions ? "，含冻结题版" : ""}`);
} else if (run === null) {
  record("27 模考运行快照 schema", "fail", "文件存在但非合法 JSON");
} else {
  record("27 模考运行快照 schema", "wait", "尚无进行中/已保存的模考");
}

// ---------- 4. 37 actions/items ----------
const actions = readJson("actions/items");
if (actions !== undefined) {
  const ok = Array.isArray(actions);
  record("37 下一步行动 schema", ok ? "pass" : "fail", ok ? `${actions.length} 条` : "非数组");
} else {
  record("37 下一步行动 schema", "wait", "尚无数据");
}

// ---------- 5. 38 AI 记录 ----------
const explain = readJson("ai/explain-history");
if (explain !== undefined) {
  const n = Object.keys(explain ?? {}).length;
  record("38 AI 讲解记录", typeof explain === "object" && explain !== null ? "pass" : "fail", `${n} 题有记录`);
} else {
  record("38 AI 讲解记录", "wait", "尚无数据");
}

// ---------- 6. 48-03 打卡桥痕迹（exam: 前缀是否已出现在打卡侧，只读窥探） ----------
const checkinBridge = join(WORKSPACE, "storage/petal/siyuan-checkin/bridge/events.ndjson");
if (existsSync(checkinBridge)) {
  const text = readFileSync(checkinBridge, "utf8");
  const examEvents = text.split("\n").filter((l) => l.includes("exam:")).length;
  record("48-03 打卡侧 exam: 事件", examEvents ? "pass" : "wait", examEvents ? `${examEvents} 条 exam: 引用` : "桥已装但尚无 exam: 事件");
} else {
  record("48-03 打卡侧 exam: 事件", "wait", "打卡桥文件不存在（未触发过写入）");
}

// ---------- 汇总 ----------
const fails = results.filter((r) => r.status === "fail");
const waits = results.filter((r) => r.status === "wait");
console.log(`\n========== 真机数据层走查 ==========`);
console.log(`通过 ${results.filter((r) => r.status === "pass").length} · 待数据 ${waits.length} · 失败 ${fails.length}`);
if (fails.length) {
  console.log("\n存在不符合 schema 的数据（真缺陷，见上方 ✗ 项）");
} else if (!anyData) {
  console.log("\n插件尚未产生任何数据：请在思源中重载插件并做一次练习/模考，然后复跑本脚本。");
  console.log("重载方式：设置 → 集市/已安装 → siyuan-exam 停用再启用；或 Ctrl+R 重载界面。");
}
console.log(`（只读走查：未调用任何内核写接口，可随时与并行插件开发同时运行）`);
process.exit(fails.length ? 1 : 0);
