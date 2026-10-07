// @ts-nocheck
// ============================================================
// 可视化测试台入口：真实 ExamApp（离线内核桩 + 种子数据）× 真实三个 Tab 组件
// 目的：不启动思源 GUI 即可对真实 UI 截图，做"原型 vs 实现"的质感对比与回归。
// 仅供开发/验收，不进发行包（eslint/tsconfig/vite 主构建均已排除）。
// ============================================================
import { mount, unmount } from "svelte";
import PracticeTab from "@/ui/practice/PracticeTab.svelte";
import MockTab from "@/ui/mock/MockTab.svelte";
import ReportTab from "@/ui/report/ReportTab.svelte";
import "@/index.scss";
import { ExamApp } from "@/app";
import { KernelApiClient } from "@/kernel/client";
import i18n from "../../public/i18n/zh-CN.json";

// ---------- 种子数据 ----------
const BANK_ID = "20260101000000-hhseedbk";
const now = Date.now();
const DAY = 86_400_000;

function q(id, type, stem, options, answer, kp, extra = {}) {
  return {
    content: `${stem}\n${options.map((o, i) => `- ${String.fromCharCode(65 + i)}. ${o}`).join("\n")}`,
    attrs: {
      "custom-exam-id": id,
      "custom-exam-type": type,
      "custom-exam-answer": answer,
      "custom-exam-kp": kp,
      "custom-exam-score": "1",
      "custom-exam-origin": "imported",
      "custom-exam-batch": "seed-01",
      "custom-exam-difficulty": String((id.length % 5) + 1),
      "custom-exam-source": "种子卷 2026",
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`custom-exam-${k}`, v])),
    },
  };
}

const SEED_QUESTIONS = [
  q(
    "seed-q01",
    "single",
    "FSRS 调度算法的期望保留率默认建议设为多少？",
    ["0.70", "0.80", "0.90", "0.97"],
    "C",
    "记忆/FSRS",
  ),
  q(
    "seed-q02",
    "single",
    "思源笔记中，块引用的语法是？",
    ["((块ID))", "((块ID", "[[块ID]]", "#{块ID}"],
    "A",
    "思源/基础",
  ),
  q("seed-q03", "single", "错题连对多少次后会移出错题本？", ["1", "2", "3", "4"], "B", "机制/错题本"),
  q(
    "seed-q04",
    "multiple",
    "下列哪些属于间隔重复的收益？",
    ["对抗遗忘曲线", "减少集中复习时长", "保证永不遗忘", "提高长期保持率"],
    "ABD",
    "记忆/原理",
  ),
  q(
    "seed-q05",
    "single",
    "模考交卷审计主要防止什么？",
    ["作弊", "误交卷后无法恢复", "时间统计造假", "题目泄露"],
    "B",
    "模考/审计",
  ),
  q("seed-q06", "judge", "先回忆模式会先隐藏选项。", ["对", "错"], "对", "机制/先回忆"),
  q("seed-q07", "fill", "FSRS 调度唯一需要理解的参数是期望____率。", [], "保留", "记忆/FSRS"),
  q(
    "seed-q08",
    "single",
    "纸笔回录的流水会以什么标记来源？",
    ["mode=paper", "mode=mock", "mode=recite", "source=paper"],
    "A",
    "打印/回录",
  ),
  q("seed-q09", "single", "资料登记后支持哪些定位方式？", ["页码", "时间点", "链接锚点", "以上都是"], "D", "资料/定位"),
  q("seed-q10", "single", "考纲对照的「零题节点」用什么颜色提示？", ["红", "琥珀", "绿", "灰"], "A", "考纲/覆盖"),
  q("seed-q11", "fill", "声音在 15℃ 空气中的传播速度约为多少（填数值与单位）？", [], "340 m/s", "物理/声学", {
    "answer-spec": JSON.stringify({ v: 1, kind: "numeric", unit: "m/s" }),
  }),
  q("seed-q12", "fill", "写出两种天文学里的距离单位名称（用 ;; 分隔）。", [], "光年;;天文单位", "物理/单位", {
    "answer-spec": JSON.stringify({
      v: 1,
      kind: "multiBlank",
      blanks: [{ answers: ["光年"] }, { answers: ["天文单位"] }],
    }),
  }),
];

function sqlRowsFor(box) {
  if (box !== BANK_ID) return [];
  const rows = [];
  SEED_QUESTIONS.forEach((question, i) => {
    const blockId = `20260101000000-q${String(i + 1).padStart(2, "0")}`;
    for (const [name, value] of Object.entries(question.attrs)) {
      rows.push({
        blockId,
        rootId: blockId,
        content: question.content,
        hpath: `/示例章节/第 ${(i % 3) + 1} 节`,
        attrName: name,
        attrValue: value,
      });
    }
  });
  return rows;
}

// ---------- 离线内核桩：按端点形状回seeded数据 ----------
const transport = {
  async post(endpoint, payload = {}) {
    if (endpoint === "/api/system/version") return { code: 0, msg: "", data: { version: "3.8.6" } };
    // 内置 AI 通道仿真（stub 固定响应）：驱动 AI 解读/讲解的结果卡与历史落盘验证
    if (endpoint === "/api/ai/chatGPT") {
      return {
        code: 0,
        msg: "",
        data: "模拟解读：样本 19 次作答、正确率 89%、连胜 5 天；信心×结果显示「犹豫但答对」3 题值得安排延迟独立复测；低样本口径保留不确定。（stub 固定响应，不调用真实模型）",
      };
    }
    if (endpoint === "/api/lute/md2html") {
      const md = String(payload.markdown ?? "");
      const esc = md.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      return { code: 0, msg: "", data: { html: `<p>${esc.split("\n").join("</p><p>")}</p>` } };
    }
    if (endpoint === "/api/query/sql") {
      const stmt = String(payload.stmt ?? "");
      if (stmt.includes("FROM attributes a JOIN blocks b")) {
        const box = stmt.match(/box='([^']+)'/)?.[1] ?? "";
        return { code: 0, msg: "", data: sqlRowsFor(box) };
      }
      return { code: 0, msg: "", data: [] };
    }
    if (endpoint === "/api/filetree/createDocWithMd") return { code: 0, msg: "", data: "20260101000000-docseed" };
    if (endpoint === "/api/notebook/createNotebook") return { code: 0, msg: "", data: { notebook: { id: BANK_ID } } };
    return { code: 0, msg: "", data: {} };
  },
};

// ---------- 内存存储 + 种子（题库注册表 + 5 天作答流水） ----------
const seedEvents = [];
let seq = 0;
const mkEvent = (daysAgo, qid, kind, mode, verdict, extra = {}) => ({
  v: 2,
  eid: `seed-${++seq}`,
  ts: now - daysAgo * DAY + seq * 60_000,
  qid,
  kind,
  mode,
  verdict,
  myAnswer: verdict === "not_attempted" ? null : "A",
  timeMs: 12_000 + seq * 900,
  sessionId: `seed-sess-${1 + (seq % 3)}`,
  examId: null,
  queue: "normal",
  device: "harness",
  seq: seq,
  ...extra,
});
// 4 天前 3 对 1 错；3 天前 4 对（含 1 受助）；2 天前模考 6 题；昨天 5 对；今天 2 对
// 错题固定为 q11（数值）与 q12（多空）：错题重练可确定性触达 54 第三刀作答框
[
  [4, "seed-q01", "practice", "daily", "correct", { confidence: "sure" }],
  [4, "seed-q02", "practice", "daily", "correct", { confidence: "fuzzy" }],
  [4, "seed-q03", "practice", "daily", "correct", { confidence: "guess" }],
  [3, "seed-q04", "practice", "daily", "correct", { confidence: "sure" }],
  [3, "seed-q05", "practice", "daily", "correct", { help: "hint", confidence: "fuzzy" }],
  [3, "seed-q06", "practice", "daily", "correct", { confidence: "sure" }],
  [3, "seed-q07", "practice", "daily", "correct", { confidence: "sure" }],
  [2, "seed-q01", "mock", "paper", "correct", { examId: "seed-mock-1" }],
  [2, "seed-q03", "mock", "paper", "correct", { examId: "seed-mock-1" }],
  [2, "seed-q05", "mock", "paper", "correct", { examId: "seed-mock-1" }],
  [2, "seed-q08", "mock", "paper", "not_attempted", { examId: "seed-mock-1" }],
  [2, "seed-q09", "mock", "paper", "correct", { examId: "seed-mock-1" }],
  [2, "seed-q10", "mock", "paper", "correct", { examId: "seed-mock-1" }],
  [1, "seed-q02", "practice", "daily", "correct", { confidence: "sure" }],
  [1, "seed-q04", "practice", "daily", "correct", { confidence: "sure" }],
  [1, "seed-q06", "practice", "daily", "correct", { confidence: "fuzzy" }],
  [0, "seed-q09", "practice", "daily", "correct", { confidence: "sure" }],
  [0, "seed-q10", "practice", "daily", "correct", { confidence: "guess" }],
  [0, "seed-q11", "practice", "daily", "wrong", { myAnswer: "350 m/s", confidence: "fuzzy" }],
  [0, "seed-q12", "practice", "daily", "wrong", { myAnswer: "光年;;秒差距", confidence: "guess" }],
].forEach(([d, qid, kind, mode, verdict, extra]) => seedEvents.push(mkEvent(d, qid, kind, mode, verdict, extra)));

const memStorage = new Map([
  ["banks", [{ id: BANK_ID, name: "示例题库", createdAt: now - 30 * DAY }]],
  ["attempts/log", { v: 2, events: seedEvents }],
  // 错因标注种子（wrongbook/reasons）：驱动错题本错因分布与报告复习信号
  [
    "wrongbook/reasons",
    { "seed-q11": { reason: "unknown", at: now - DAY }, "seed-q12": { reason: "careless", at: now - DAY } },
  ],
  // AI 候选队列种子（ai/review-queue）：驱动待审卡片流 UI 验证
  [
    "ai/review-queue",
    {
      queue: [
        {
          id: "seed-ai-01",
          type: "single",
          stem: "下列哪项属于间隔重复的核心机制？",
          options: ["遗忘曲线对抗", "集中一次性复习", "随机翻页", "多任务并行"],
          answer: "A",
          analysis: "间隔重复通过对抗遗忘曲线提升长期保持率。",
          kp: "记忆/FSRS",
          difficulty: "2",
          source: "AI 候选 · 示例",
        },
        {
          id: "seed-ai-02",
          type: "fill",
          stem: "FSRS 的中文全称是____。",
          options: [],
          answer: "自由间隔重复调度",
          analysis: "Free Spaced Repetition Scheduler。",
          kp: "记忆/FSRS",
          difficulty: "3",
          source: "AI 候选 · 示例",
        },
      ],
      rejected: [],
      duplicates: 0,
      bankId: BANK_ID,
    },
  ],
]);
// save 同步镜像到 localStorage——支撑「刷新后恢复」等跨刷新流程测试（smoke-ui）
const LS = "lv-harness-storage";
const persisted: Record<string, unknown> = (() => {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? "{}");
  } catch {
    return {};
  }
})();
const storage = {
  async load(key) {
    if (persisted[key] !== undefined) return persisted[key];
    return memStorage.get(`${key}.json`) ?? memStorage.get(key);
  },
  async save(key, value) {
    persisted[key] = value;
    memStorage.set(`${key}.json`, value);
    try {
      localStorage.setItem(LS, JSON.stringify(persisted));
    } catch {
      /* 配额满则仅内存 */
    }
  },
};

// ---------- 组装真实 ExamApp + 挂载 ----------
const app = new ExamApp({ client: new KernelApiClient(transport), storage });
await app.init("harness-device");

const plugin = {
  i18n,
  data: {} as Record<string, any>,
  loadData: async () => undefined,
  saveData: async () => undefined,
  settingUtils: {
    get: (k: string) =>
      ({ sprintDays: 14, dailyGoal: 10, reciteGroupSize: 15, perQuestionTimeoutS: 0, desiredRetention: 0.9 })[k],
    settings: new Map(),
  },
  openReport: () => window.__show("report"),
};

// 设置页预览：真实 SettingUtils + 真实 i18n 文案（宿主 Setting 渲染由桩仿真）
import { SettingUtils } from "@/libs/setting-utils";
const realSettings = new SettingUtils({ plugin: plugin as any });
(
  [
    ["setting.examDate.title", "setting.examDate.desc", "textinput", "examDate", ""],
    ["setting.sprintDays.title", "setting.sprintDays.desc", "number", "sprintDays", 14],
    ["setting.dailyGoal.title", "setting.dailyGoal.desc", "number", "dailyGoal", 10],
    ["setting.reciteGroup.title", "setting.reciteGroup.desc", "number", "reciteGroupSize", 15],
    ["setting.perQuestionTimeout.title", "setting.perQuestionTimeout.desc", "number", "perQuestionTimeoutS", 0],
    ["setting.feedbackTiming.title", "setting.feedbackTiming.desc", "checkbox", "feedbackEndReview", false],
    ["setting.materialInterleave.title", "setting.materialInterleave.desc", "checkbox", "materialInterleave", false],
    ["setting.examProfiles.title", "setting.examProfiles.desc", "textarea", "examProfiles", ""],
    ["setting.checkinItemId.title", "setting.checkinItemId.desc", "textinput", "checkinItemId", ""],
    ["setting.checkinThreshold.title", "setting.checkinThreshold.desc", "number", "checkinThreshold", 0],
    ["setting.retention.title", "setting.retention.desc", "slider", "desiredRetention", 0.9],
    ["setting.aiEndpoint.title", "setting.aiEndpoint.desc", "textinput", "aiEndpoint", ""],
    ["setting.aiModel.title", "setting.aiModel.desc", "textinput", "aiModel", "gpt-4o-mini"],
    ["setting.aiCustomHint.title", "setting.aiCustomHint.desc", "textarea", "aiCustomHint", ""],
    ["setting.aiKey.title", "setting.aiKey.desc", "textinput", "aiKey", ""],
  ] as const
).forEach(([title, description, type, key, value]) =>
  realSettings.addItem({
    title: i18n[title] ?? title,
    description: i18n[description] ?? description,
    type: type as any,
    key,
    value,
    direction: key === "examProfiles" || key === "aiCustomHint" ? "column" : "row",
  } as any),
);

let instance = null;
window.__show = (name) => {
  if (instance) unmount(instance);
  const target = document.getElementById("app");
  target.innerHTML = "";
  const comp = { practice: PracticeTab, mock: MockTab, report: ReportTab }[name];
  instance = mount(comp, { target, props: { plugin, examApp: app } });
  document.querySelectorAll("#bar [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
};
// 命令面板跨 Tab 跳转（与宿主 open* 同语义）
plugin.openPractice = () => window.__show("practice");
plugin.openMock = () => window.__show("mock");
plugin.openReport = () => window.__show("report");
window.__theme = (dark) => {
  // 与思源宿主同机制：:root 翻转 + body.dark 双轨（lv-tokens 阴影档读 data-theme-mode）
  document.documentElement.toggleAttribute("data-theme-mode", dark);
  if (dark) document.documentElement.setAttribute("data-theme-mode", "dark");
  else document.documentElement.removeAttribute("data-theme-mode");
  document.body.classList.toggle("dark", dark);
  document.getElementById("theme").textContent = dark ? "☀️ 亮" : "🌙 暗";
};
window.__app = app;
window.__settings = () => (plugin as any).setting.open("settings");

document
  .querySelectorAll("#bar [data-tab]")
  .forEach((b) => b.addEventListener("click", () => window.__show(b.dataset.tab)));
document
  .getElementById("theme")
  .addEventListener("click", () => window.__theme(!document.body.classList.contains("dark")));
// 宿主全局桩：libs/dialog 的确认框读取 window.siyuan.languages（渲染确认/取消按钮文案）
(window as any).siyuan = { languages: { confirm: "确认", cancel: "取消" } };
window.__show("practice");
