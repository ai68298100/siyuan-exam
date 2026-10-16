/* Standalone design preview. All state is synthetic and exists only in this page. */
const $ = (s) => document.querySelector(s);
const root = $(".lv-exam-demo"),
  main = $("#screen"),
  dialog = $("#dialog");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const paths = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  bank: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 8h10M7 12h10M7 16h5"/>',
  pen: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z"/>',
  exam: '<path d="M8 4H5v17h14V4h-3M9 2h6v5H9Z M8 12h8M8 16h5"/>',
  chart: '<path d="M4 3v17h17M8 16v-5m5 5V6m5 10V9"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  spark: '<path d="m12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  doc: '<path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8M8 16h5"/>',
  book: '<path d="M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3ZM12 6v15"/>',
  star: '<path d="m12 3 2.8 5.6 6.2.9-4.5 4.4 1.1 6.1-5.6-2.9-5.6 2.9 1.1-6.1L3 9.5l6.2-.9Z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  flag: '<path d="M5 22V3m0 1c5-5 9 5 14 0v10c-5 5-9-5-14 0"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v.1"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z"/>',
};
const ico = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.doc}</svg>`;
const tile = (name, tone = "") => `<span class="icon-tile ${tone}">${ico(name)}</span>`;
const btn = (label, action, cls = "", attrs = "") =>
  `<button class="${cls}" data-action="${action}" ${attrs}>${label}</button>`;
const tag = (s, t = "") => `<span class="tag ${t}">${esc(s)}</span>`;
const types = { single: "单选题", multiple: "多选题", judge: "判断题", fill: "填空题", short: "解答题" };
const initial = [
  {
    type: "single",
    q: "下列哪种方式更有助于记住刚学过的知识？",
    options: ["反复划线", "合上资料，尝试回忆", "只看参考答案", "快速浏览标题"],
    answer: "B",
    analysis: "先尝试提取知识，再核对答案，可以发现理解和记忆的缺口。",
    kp: "学习方法",
    source: "学习入门 / 主动回忆",
    wrong: true,
  },
  {
    type: "multiple",
    q: "安排一场练习前，哪些做法有助于获得可解释的结果？",
    options: ["明确题目范围", "记录是否使用提示", "遇到困难立即看答案并算作独立答对", "区分客观判分与自评"],
    answer: "ABD",
    analysis: "练习范围、提示使用和证据类型共同影响结果解释。受助完成应单独记录。",
    kp: "学习方法",
    source: "学习入门 / 练习证据",
    star: true,
  },
  {
    type: "judge",
    q: "使用提示后答对，可以直接视为独立掌握了这道题。",
    options: ["正确", "错误"],
    answer: "B",
    analysis: "提示后的表现属于受助证据，应与独立作答分开。",
    kp: "学习方法",
    source: "学习入门 / 练习证据",
    wrong: true,
  },
  {
    type: "fill",
    q: "把 1 米换算成厘米，结果是 ____ 厘米。",
    answer: "100",
    answerSpec: { v: 1, kind: "numeric", unit: "厘米", absTol: 0.5 },
    analysis: "1 米 = 100 厘米。请填写数字，允许绝对误差 ±0.5 厘米。",
    kp: "单位换算",
    source: "基础常识 / 长度单位",
  },
  {
    type: "fill",
    q: "地球围绕 ____ 运行，自转轴相对公转轨道面倾斜约 ____。",
    answer: "太阳；66.5°",
    answerSpec: {
      v: 1,
      kind: "multiBlank",
      blanks: [{ answers: ["太阳"] }, { answers: ["66.5°", "66.5"] }],
    },
    analysis: "地球围绕太阳公转，地轴倾角约为 66.5°。两个空分别作答。",
    kp: "地球运动",
    source: "基础常识 / 地球与天体",
  },
  {
    type: "short",
    q: "用一两句话说明：发现自己答错后，可以怎样进行一次有效复盘？",
    answer: "核对参考答案，找出具体错因；间隔一段时间后，在不看提示的情况下重新作答。",
    analysis: "参考要点：核对、辨认错因、延迟重练。表达合理即可，不用逐字一致。",
    kp: "学习方法",
    source: "学习入门 / 错题复盘",
    wrong: true,
  },
  {
    type: "single",
    q: "已知 3 × 4 = 12，下列算式正确的是？",
    options: ["12 ÷ 3 = 4", "12 ÷ 4 = 4", "3 + 4 = 12", "12 − 3 = 4"],
    answer: "A",
    analysis: "乘除互为逆运算，12 ÷ 3 = 4。",
    kp: "基础运算",
    source: "基础常识 / 四则运算",
  },
  {
    type: "fill",
    q: "一天有 ____ 小时。",
    answer: "24",
    analysis: "一天通常按 24 小时计。",
    kp: "单位换算",
    source: "基础常识 / 时间单位",
    star: true,
  },
  {
    type: "judge",
    q: "0 是偶数。",
    options: ["正确", "错误"],
    answer: "A",
    analysis: "0 能被 2 整除，因此是偶数。",
    kp: "基础运算",
    source: "基础常识 / 整数",
  },
  {
    type: "multiple",
    q: "以下哪些数是偶数？",
    options: ["2", "3", "4", "5"],
    answer: "AC",
    analysis: "能够被 2 整除的整数是偶数。",
    kp: "基础运算",
    source: "基础常识 / 整数",
  },
  {
    type: "single",
    q: "阅读资料时遇到不理解的概念，哪一步更合适？",
    options: ["跳过并标记已掌握", "保留来源，查证后用自己的话解释", "只复制定义", "不再学习这一章"],
    answer: "B",
    analysis: "保留来源便于核对，用自己的话解释可以检验理解。",
    kp: "学习方法",
    source: "学习入门 / 阅读资料",
  },
  {
    type: "fill",
    q: "1 千克等于 ____ 克。",
    answer: "1000",
    analysis: "1 千克 = 1000 克。",
    kp: "单位换算",
    source: "基础常识 / 质量单位",
  },
  {
    type: "short",
    q: "为一段笔记设计一道题时，你会怎样让题干更清楚？",
    answer: "限定范围，一题聚焦一个要点，说明需要填写的内容或作答方式，并准备可核对的参考答案。",
    analysis: "参考要点：范围清楚、任务明确、答案可核对。",
    kp: "学习方法",
    source: "学习入门 / 手工出题",
  },
].map((q, i) => ({ ...q, id: `q${i + 1}`, star: !!q.star, wrong: !!q.wrong }));
const materials = [
  {
    id: "m1",
    title: "主动回忆与间隔练习",
    section: "学习入门 · 本地笔记",
    text: "主动回忆，是在不看答案时尝试提取知识，再核对自己的表达。间隔练习，是把重复学习安排在不同时间，而不是一次集中完成。练习后记录是否使用提示，有助于解释结果。",
  },
  {
    id: "m2",
    title: "生活中的单位换算",
    section: "基础常识 · 资料片段",
    text: "长度：1 米 = 100 厘米。质量：1 千克 = 1000 克。时间：1 天 = 24 小时。换算时先确认题目要求的单位，再填写数值。",
  },
];
function materialForQuestion(q) {
  const source = String(q?.source || "");
  const group = source.split(/[/·]/)[0].trim();
  return (
    materials.find((m) => {
      const materialGroup = m.section.split(/[·/]/)[0].trim();
      return source.includes(m.title) || group === materialGroup;
    }) || null
  );
}
const store = {
  questions: structuredClone(initial),
  log: [],
  onboardingDismissed: false,
  aiConfigured: false,
  candidates: [],
  accepted: new Set(),
  materialNotes: {},
  created: [],
  mockHistory: [],
  importedKeys: new Set(),
};
const mockAutoGradedTypes = new Set(["single", "multiple", "judge", "fill"]);
const mockEligibleQuestions = () => store.questions.filter((q) => mockAutoGradedTypes.has(q.type));
if (new URLSearchParams(location.search).has("test")) {
  Object.defineProperty(window, "__r54Test", {
    value: Object.freeze({
      addMaterialQuestion() {
        store.questions.unshift({ ...structuredClone(initial[0]), id: "test-material", type: "material", q: "[测试] 资料题不应进入自动判分模考。" });
        render();
      },
      get eligibleMockCount() { return mockEligibleQuestions().length; },
    }),
  });
}
const ui = {
  page: "today",
  scene: "ready",
  theme: "light",
  bankFilter: "all",
  query: "",
  selected: new Set(),
  studioTab: "manual",
  dirty: false,
  draft: structuredClone(initial[0]),
  draftSpecEdited: false,
  draftSaved: false,
  aiMaterial: materials[0].text,
  aiBusy: false,
  aiEpoch: 0,
  candidate: 0,
  importStep: 0,
  importRows: [],
  imported: new Set(),
  importText:
    "单选题|先尝试回忆，还是先看答案？|先尝试回忆/先看答案|A|先回忆，再核对。\n判断题|1 米等于 100 厘米。|正确/错误|A|这是常用的长度换算关系。\n填空题|一小时有 ____ 分钟。|||请填写 60。",
  material: "m1",
  materialQuery: "",
  materialSaving: false,
  reportTab: "overview",
  reportRange: "week",
  session: null,
  returnPage: "today",
  scroll: {},
  mockCount: 6,
  mockMinutes: 20,
  mockStrict: true,
  mockSubmitError: "",
  mockRetryArmed: false,
  storageOpen: false,
  storageStatus: "idle",
  storageRows: [],
  storageError: "",
  auditStatus: "idle",
  auditResult: null,
  auditError: "",
  auditSkippedBanks: 0,
  defaultMode: "practice",
  confidence: "一般",
  assisted: false,
  navOpen: false,
};
const primary = [
  ["today", "今日", "sun"],
  ["bank", "题库", "bank"],
  ["manual", "出题", "pen"],
  ["mocksetup", "模考", "exam"],
  ["report", "复盘", "chart"],
];
const pages = [
  ["today", "今日"],
  ["bank", "题库"],
  ["wrongbook", "错题本"],
  ["manual", "出题 · 手工录题"],
  ["ai", "出题 · AI 出题"],
  ["import", "出题 · 批量导入"],
  ["materials", "出题 · 资料"],
  ["practice", "专注练习"],
  ["recite", "背诵"],
  ["mocksetup", "模考 · 配卷"],
  ["mock", "模考 · 作答"],
  ["result", "本场结果"],
  ["report", "复盘"],
  ["settings", "设置"],
  ["onboarding", "首次使用"],
];
const scenePage = {
  "practice-loading": "today",
  "practice-empty": "today",
  "practice-load-error": "today",
  "today-no-attempts": "today",
  "materials-empty": "materials",
  "materials-no-match": "materials",
  "materials-saving": "materials",
  "materials-error": "materials",
  "mock-loading": "mocksetup",
  "mock-load-error": "mocksetup",
  "mock-empty-bank": "mocksetup",
  "mock-blueprint-invalid": "mocksetup",
  "mock-invalid": "mocksetup",
  "mock-submit-error": "mock",
  "report-loading": "report",
  "report-error": "report",
  "report-no-bank": "report",
  "scope-loading": "report",
  "scope-error": "report",
  "report-no-attempts": "report",
  "report-no-evidence": "report",
  "report-storage-loading": "report",
  "report-storage-empty": "report",
  "report-storage-error": "report",
  "report-audit-loading": "report",
  "report-audit-partial": "report",
  "report-audit-error": "report",
};
$("#page-picker").innerHTML = pages.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
let toastTimer, opener, pendingPage, pendingDraft, pendingSession, practiceLoadTimer, mockLoadTimer;
let storageLoadTimer, auditLoadTimer, storageEpoch = 0, auditEpoch = 0;
function cancelPreviewLoads() {
  clearTimeout(practiceLoadTimer);
  clearTimeout(mockLoadTimer);
  practiceLoadTimer = mockLoadTimer = undefined;
}
function retryPreviewLoad(kind) {
  cancelPreviewLoads();
  const loadingScene = kind === "practice" ? "practice-loading" : "mock-loading";
  const readyPage = kind === "practice" ? "today" : "mocksetup";
  ui.scene = loadingScene;
  ui.page = readyPage;
  render();
  const timer = setTimeout(() => {
    if (ui.scene !== loadingScene || ui.page !== readyPage) return;
    if (kind === "practice") practiceLoadTimer = undefined;
    else mockLoadTimer = undefined;
    ui.scene = "ready";
    render();
    notify(kind === "practice" ? "演示题库读取成功。" : "演示模考题库读取成功。");
  }, 900);
  if (kind === "practice") practiceLoadTimer = timer;
  else mockLoadTimer = timer;
}
const storagePreviewRows = [
  { key: "questions", bytes: 24832, present: true },
  { key: "attempts", bytes: 12288, present: true },
  { key: "preferences", bytes: 0, present: false },
];
function cancelReportPreviewLoads() {
  clearTimeout(storageLoadTimer);
  clearTimeout(auditLoadTimer);
  storageLoadTimer = auditLoadTimer = undefined;
  storageEpoch++;
  auditEpoch++;
  if (ui.storageStatus === "loading") ui.storageStatus = "idle";
  if (ui.auditStatus === "loading") ui.auditStatus = "idle";
}
function loadStoragePreview({ empty = false } = {}) {
  if (ui.storageStatus === "loading") return;
  clearTimeout(storageLoadTimer);
  const epoch = ++storageEpoch;
  ui.storageOpen = true;
  ui.storageStatus = "loading";
  ui.storageError = "";
  render();
  storageLoadTimer = setTimeout(() => {
    if (epoch !== storageEpoch || ui.page !== "report" || !ui.storageOpen) return;
    storageLoadTimer = undefined;
    ui.storageRows = empty ? [] : structuredClone(storagePreviewRows);
    ui.storageStatus = empty ? "empty" : "success";
    ui.scene = "ready";
    render();
    notify(empty ? "演练读取完成：没有可显示的存储记录。" : "演练存储占用已读取。未访问真实插件存储。");
  }, 520);
}
function loadAuditPreview({ outcome = "success" } = {}) {
  if (ui.auditStatus === "loading") return;
  clearTimeout(auditLoadTimer);
  const epoch = ++auditEpoch;
  ui.auditStatus = "loading";
  ui.auditError = "";
  ui.auditResult = null;
  ui.auditSkippedBanks = 0;
  render();
  auditLoadTimer = setTimeout(() => {
    if (epoch !== auditEpoch || ui.page !== "report") return;
    auditLoadTimer = undefined;
    if (outcome === "partial") {
      ui.auditStatus = "partial";
      ui.auditSkippedBanks = 1;
      ui.auditResult = { events: 132, duplicateEids: 1, badEvents: 2, futureEvents: 1, problemCount: 4 };
    } else {
      ui.auditStatus = "success";
      ui.auditResult = { events: 132, duplicateEids: 0, badEvents: 0, futureEvents: 0, problemCount: 0 };
    }
    ui.scene = "ready";
    render();
    notify(outcome === "partial" ? "演练体检部分完成：有题库未能读取，可重试。" : "演练体检完成：没有发现示例问题。未扫描真实数据。");
  }, 620);
}
function notify(s) {
  clearTimeout(toastTimer);
  $("#toast").textContent = s;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 3800);
}
function routeKey() {
  return ui.page === "studio"
    ? ui.studioTab
    : ui.page === "bank" && ui.bankFilter === "wrong"
      ? "wrongbook"
      : ui.page === "practice" && ui.session?.mode === "recite"
        ? "recite"
        : ui.page;
}
function navActive(id) {
  return id === "manual"
    ? ui.page === "studio"
    : id === "mocksetup"
      ? ["mocksetup", "mock"].includes(ui.page)
      : ui.page === id;
}
function nav(id, l, icon) {
  const wrongDisabled = id === "wrongbook" && !store.questions.some((q) => q.wrong);
  return `<button data-page="${id}" title="${l}" ${wrongDisabled ? 'disabled aria-describedby="wrongbook-reason"' : ""} ${navActive(id) ? 'aria-current="page"' : ""}>${ico(icon)}<span class="nav-label">${l}</span>${id === "bank" ? `<span class="nav-count">${store.questions.length}</span>` : ""}</button>`;
}
function chrome() {
  const focus = ["practice", "mock", "result"].includes(ui.page);
  $("#shell").classList.toggle("focus", focus);
  $("#sidebar").innerHTML =
    `<div class="brand"><svg class="brandmark" viewBox="0 0 32 38" fill="none" aria-hidden="true"><path d="m9 15-3-9c-1-5 4-6 6-1l3 8m5 0 3-9c2-5 6-3 5 1l-2 13" fill="currentColor" opacity=".65"/><path d="M5 16c3-5 18-7 23 0v11c-2 10-22 11-24 0Z" fill="currentColor"/><ellipse cx="17" cy="28" rx="9" ry="5" fill="var(--lavender)"/><circle cx="11" cy="20" r="1.4" fill="var(--surface)"/><circle cx="22" cy="20" r="1.4" fill="var(--surface)"/></svg><span>小驴考试</span><button class="nav-drawer-close" data-action="nav-close" aria-label="关闭导航">${ico("close")}</button></div><button class="quick-create soft" data-page="manual" title="录入一道题">${ico("plus")}<span>录入一道题</span></button><nav>${primary.map((x) => nav(...x)).join("")}<div class="nav-sub">${nav("settings", "设置", "settings")}${nav("onboarding", "上手与示例", "help")}</div></nav><div class="sidebar-bottom"><div class="sidebar-note"><strong>练一点，也有收获。</strong><p>先尝试回答，再核对原因。</p></div><span class="small-copy nav-label">内测版 · 设计预览</span></div>`;
  $("#mobile-nav").innerHTML = primary.map((x) => nav(...x)).join("");
  $("#topbar").innerHTML = focus
    ? `<div class="flex">${btn(ico("menu"), "nav-toggle", "icon-only ghost nav-trigger", `id="nav-trigger" aria-expanded="${ui.navOpen}" aria-controls="sidebar" aria-label="${ui.navOpen ? "关闭导航" : "打开导航"}"`)}${tile(ui.page === "mock" ? "exam" : "book")}<strong>${ui.page === "mock" ? "专注模考" : ui.page === "result" ? "本场结果" : "专注学习"}</strong>${tag("演练", "purple")}</div><span class="local-status">只保留本页进度 · 不写入思源</span>${btn(ico("help"), "session-help", "icon-only ghost", 'aria-label="本场说明"')}`
    : `<div class="flex">${btn(ico("menu"), "nav-toggle", "icon-only ghost nav-trigger", `id="nav-trigger" aria-expanded="${ui.navOpen}" aria-controls="sidebar" aria-label="${ui.navOpen ? "关闭导航" : "打开导航"}"`)}${tag("示例题库", "purple")}<span class="small-copy">${store.questions.length} 道题</span></div><div class="flex">${btn(`${ico("search")}<span>搜索题目或功能</span><kbd>Ctrl K</kbd>`, "search", "search-trigger")}<span class="local-status">本页演示</span>${btn(ico("settings"), "open-settings", "icon-only ghost", 'aria-label="打开设置"')}</div>`;
  const sidebar = $("#sidebar");
  sidebar.classList.toggle("open", ui.navOpen);
  sidebar.setAttribute("role", ui.navOpen ? "dialog" : "navigation");
  if (ui.navOpen) sidebar.setAttribute("aria-modal", "true");
  else sidebar.removeAttribute("aria-modal");
  $("#nav-backdrop").hidden = !ui.navOpen;
  const workspace = $("#workspace");
  if (ui.navOpen) {
    workspace.setAttribute("inert", "");
    workspace.setAttribute("aria-hidden", "true");
  } else {
    workspace.removeAttribute("inert");
    workspace.removeAttribute("aria-hidden");
  }
  $("#page-picker").value = routeKey();
  $("#state-picker").value = ui.scene;
}
function setNavOpen(open, restoreFocus = true) {
  if (ui.navOpen === open) return;
  ui.navOpen = open;
  render(false);
  if (open) $("#sidebar .nav-drawer-close")?.focus();
  else {
    const trigger = restoreFocus ? $("#nav-trigger") : null;
    if (trigger?.getClientRects().length) trigger.focus({ preventScroll: true });
    else main.focus({ preventScroll: true });
  }
}
if (typeof ResizeObserver !== "undefined") {
  const navObserver = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width >= 760 && ui.navOpen) setNavOpen(false, false);
  });
  navObserver.observe($("#app"));
}
function head(k, title, desc, action = "") {
  return `<header class="page-head"><div><div class="eyebrow">${k}</div><h2>${title}</h2><p>${desc}</p></div>${action}</header>`;
}
function tabs(items, value, action) {
  return `<div class="subtabs" role="group" aria-label="任务分区">${items.map(([id, l]) => `<button data-action="${action}" data-value="${id}" aria-selected="${value === id}">${l}</button>`).join("")}</div>`;
}
function art() {
  return `<svg class="art" viewBox="0 0 220 210" fill="none" aria-hidden="true"><ellipse cx="111" cy="184" rx="80" ry="10" fill="var(--accent)" opacity=".08"/><rect x="60" y="31" width="113" height="148" rx="13" transform="rotate(12 60 31)" fill="var(--accent)" opacity=".13"/><rect x="39" y="28" width="114" height="148" rx="13" transform="rotate(-8 39 28)" fill="var(--surface)" stroke="var(--accent)" stroke-opacity=".23"/><path d="m63 68 6 5 11-15m-13 43 6 5 11-15m-13 43 6 5 11-15" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/><path d="m93 64 34-5m-30 37 34-5m-30 37 24-4" stroke="var(--line)" stroke-width="6" stroke-linecap="round"/><circle cx="164" cy="144" r="28" fill="var(--warm)"/><path d="m151 144 9 9 17-19" stroke="var(--warm-ink)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="m166 41 3-10m6 15 9-3M28 126l-8 4" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" opacity=".4"/></svg>`;
}
function empty(title, desc, actions, icon = "bank") {
  return `<section class="panel empty">${tile(icon)}<h3>${title}</h3><p>${desc}</p><div class="actions">${actions}</div></section>`;
}
function issue() {
  if (ui.scene === "partial")
    return `<div class="notice warm state-banner" role="status"><strong>部分成功 · 状态预览</strong>2 项已确认，1 项需要处理。成功项不会重复执行。${btn("查看逐项回执", "partial-details", "text")}</div>`;
  if (ui.scene === "unknown")
    return `<div class="notice warm state-banner" role="status"><strong>结果待核对 · 状态预览</strong>尚未确认上一笔结果，相关提交暂不可重复。${btn("核对样例结果", "reconcile", "text")}</div>`;
  return "";
}
function today() {
  const wrongCount = store.questions.filter((q) => q.wrong).length;
  const firstRun = store.log.length === 0 && !store.onboardingDismissed && ui.scene === "ready" && store.questions.some((q) => q.type !== "material")
    ? `<section class="panel first-run" aria-label="五分钟上手"><strong class="first-run-title">${ico("compass")}五分钟上手</strong><p>三步开始：① 题目进来（任选其一）→ ② 答第一题 → ③ 看报告。首条作答记录后会自动消失。</p><ol class="first-run-steps" aria-label="五分钟上手"><li class="first-run-step"><span class="first-run-no">01</span><span class="first-run-icon">${ico("upload")}</span><strong>准备题目</strong><p>已有题目可导入，也可以手工录入；AI 需配置模型，发送前会再次确认。</p><div class="actions"><button data-page="import">导入题目</button><button data-page="manual">手工录题</button><button data-page="ai">AI 出题</button></div></li><li class="first-run-step"><span class="first-run-no">02</span><span class="first-run-icon">${ico("spark")}</span><strong>开始快刷</strong><p>先做一组题，熟悉答题和错因记录。</p><button class="primary" data-action="start">开始快刷</button></li><li class="first-run-step"><span class="first-run-no">03</span><span class="first-run-icon">${ico("chart")}</span><strong>打开报告</strong><p>查看正确率之外的独立作答与薄弱点。</p><button data-page="report">打开报告</button></li></ol><div class="first-run-dismiss"><button class="text" data-action="dismiss-onboarding">跳过引导</button></div></section>`
    : "";
  const emptyWeek = ui.scene === "today-no-attempts";
  const weekCounts = emptyWeek ? [0, 0, 0, 0, 0, 0, 0] : [2, 0, 1, 0, 0, 3, 0];
  const weekTotal = weekCounts.reduce((total, count) => total + count, 0);
  const weekMax = Math.max(1, ...weekCounts);
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - 6 + index);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { key, label: ["日", "一", "二", "三", "四", "五", "六"][date.getDay()] };
  });
  if (ui.scene === "practice-loading") return head("练习台 · 正在载入", "正在读取题库。", "读取完成后才会显示可练题量。") + `<section class="panel prototype-load-state" aria-busy="true"><div class="skeleton hero"></div><div class="skeleton"></div><p class="small-copy"><span class="spinner" aria-hidden="true"></span> 正在读取当前题库…</p>${btn("正在读取…", "retry-practice-load", "soft", "disabled")}</section>`;
  if (ui.scene === "practice-empty") return head("练习台 · 空题库", "当前没有可练习题。", "先导入或录入题目；也可以体验内置示例题库。") + empty("还没有可练习题", "你可以先载入示例题，熟悉选择、填空、判断与解答流程。", btn("体验示例题库", "load-sample", "primary") + `<button data-page="manual">手工录入</button>` + `<button data-page="import">批量导入</button>`, "book");
  if (ui.scene === "practice-load-error")
    return head("练习台 · 读取失败", "暂时没能读取题库。", "已有草稿与进行中的作答保留，恢复后可以继续。") + `<div class="lv-error-like notice warm" role="alert"><strong>题库读取失败</strong><p>演示错误：本地数据服务暂时不可用。不会把未读取误显示成 0 道题。</p><div class="actions">${btn("重试读取", "retry-practice-load", "primary")}${btn("查看恢复说明", "error-help")}</div></div>`;
  if (ui.scene === "empty" || !store.questions.length)
    return (
      head("从这里开始", "第一道题，很快就能开始。", "不用准备资料，也可以先了解一次完整练习。") +
      empty(
        "还没有题库",
        "先体验 12 道简单示例，了解选择、判断、填空与解答；也可以录入自己的第一道题。",
        btn("体验示例题库", "load-sample", "primary") + `<button data-page="manual">手工录入</button>`,
      ) +
      `<div class="guide-inline">${tile("help")}<div class="grow"><strong>三步完成第一次练习</strong><p>选择范围 → 尝试作答 → 核对答案与复盘</p></div><button data-page="onboarding">查看引导</button></div>`
    );
  const active = ui.session && ui.session.index < ui.session.questions.length && !ui.session.complete;
  return (
    firstRun + head(
      "星期日 · 学一点，记得更久",
      "今天，从一道题开始。",
      "当前范围：示例题库 · 练习结果仅用于原型演练。",
      btn("学习方式", "modes", "ghost"),
    ) +
    `<div class="home-grid"><div><section class="panel hero"><div class="hero-copy">${tag(active ? "本场可以继续" : "今日建议 · 独立练习", "purple")}<h3>${active ? "继续刚才的练习。" : "用 5 分钟，巩固一点知识。"}</h3><p class="hero-summary">${active ? `已完成 ${Object.keys(ui.session.results).length} / ${ui.session.questions.length} 题，作答现场保留。` : `${Math.min(6, store.questions.length)} 道典型题 · 含 ${wrongCount} 道待重练 · 不使用 AI`}</p><div class="actions">${btn(`${active ? "继续本场" : "开始练习"} ${ico("arrow")}`, active ? "continue" : "start", "primary large")}${btn("调整范围与方式", "modes", "text")}</div></div><div class="hero-art">${art()}</div></section><div class="metric-strip">${[
      ["bank", "题库总量", store.questions.length, "bank"],
      ["wrongbook", "待重练", wrongCount, "book"],
      ["report", "本页已练", store.log.length, "check"],
    ]
      .map(
        ([p, l, n, i]) =>
          `<button class="metric" data-page="${p}" ${p === "wrongbook" && !wrongCount ? 'disabled title="当前没有待重练题" aria-label="待重练，当前没有题目"' : ""}><div><small>${l}</small><strong>${n}</strong></div>${ico(i)}</button>`,
      )
      .join(
        "",
      )}</div></div><aside class="panel week-card"><div class="section-head"><h3>这一周，慢慢来</h3>${emptyWeek ? tag("0 题") : tag("合成样例")}</div><div class="week-grid" role="img" aria-label="${emptyWeek ? "近七天还没有作答记录" : `近七天合成示例，共 ${weekTotal} 题`}">${weekDays.map(({ key, label }, i) => `<div class="week-day ${i === 6 ? "today" : ""}" title="${key} · ${weekCounts[i]} 题"><i class="${weekCounts[i] ? "has-attempts" : ""}" style="--week-fill:${Math.round((weekCounts[i] / weekMax) * 100)}%">${weekCounts[i] || "·"}</i><span>${label}</span></div>`).join("")}</div><p class="small-copy">${emptyWeek ? "近七天还没有作答记录，完成练习后会显示在这里。" : "固定合成示例，不代表你的历史记录。"}</p></aside></div><div class="section-head" style="margin-top:25px"><h3>按你的需要学</h3>${btn("全部学习方式", "modes", "text")}</div><div class="decks">${[
      [
        "wrong-start",
        "book",
        "warm",
        "重练错题",
        wrongCount ? `${wrongCount} 道待重练 · 找到原因再继续` : "还没有错题；完成一次练习后会出现在这里",
      ],
      ["recite", "doc", "", "先回忆，再揭晓", "不计客观正确率 · 四级自评"],
      ["open-mock", "exam", "green", "来一场小模考", "先配卷 · 作答时隐藏答案"],
    ]
      .map(
        ([a, i, t, l, d]) =>
          `<button class="deck" data-action="${a}" ${a === "wrong-start" && !wrongCount ? 'disabled title="当前没有错题可重练"' : ""}>${tile(i, t)}<div class="deck-title">${l}</div><p>${d}</p></button>`,
      )
      .join(
        "",
      )}</div><div class="home-bottom"><section class="panel"><div class="section-head"><h3>把资料变成题目</h3><button class="text" data-page="materials">查看资料 ${ico("arrow")}</button></div><div class="row">${tile("doc")}<div class="grow"><strong>主动回忆与间隔练习</strong><p>保留来源，手工出题随时可用</p></div><button class="small" data-page="manual">去出题</button></div></section><section class="panel"><div class="section-head"><h3>练完之后，做什么？</h3></div><p class="small-copy">先看薄弱考点，再挑一组题重练。受助作答和自评会单独说明。</p><button class="text" data-page="report">打开复盘 ${ico("arrow")}</button></section></div><div class="guide-inline">${tile("help")}<div class="grow"><strong>第一次使用小驴考试？</strong><p>看看题库、出题、练习与模考怎样衔接。</p></div><button data-page="onboarding">两分钟上手</button></div>`
  );
}
function filtered() {
  return store.questions.filter(
    (q) =>
      (ui.bankFilter !== "wrong" || q.wrong) &&
      (ui.bankFilter !== "star" || q.star) &&
      (ui.bankFilter !== "created" || store.created.includes(q.id)) &&
      (!ui.query || [q.q, q.kp, q.source, types[q.type]].join(" ").includes(ui.query)),
  );
}
function bankRows() {
  const qs = filtered();
  return qs.length
    ? `<div class="table-head"><input type="checkbox" id="select-all" aria-label="选择当前范围全部题目" ${qs.every((q) => ui.selected.has(q.id)) ? "checked" : ""}><span>题目与来源</span><span class="column-source">考点</span><span>题型</span><span class="row-more"></span></div>${qs.map((q) => `<div class="question-row ${ui.selected.has(q.id) ? "selected" : ""}"><input type="checkbox" data-select="${q.id}" aria-label="选择题目：${esc(q.q)}" ${ui.selected.has(q.id) ? "checked" : ""}>${btn(`<span class="question-title">${esc(q.q)}</span><span class="question-source">${esc(q.source)}${q.wrong ? " · 待重练" : ""}</span>`, "detail", "question-open", `data-id="${q.id}"`)}<span class="column-source small-copy">${esc(q.kp)}</span>${tag(types[q.type])}${btn(ico(q.star ? "star" : "more"), "detail", "icon-only ghost row-more", `data-id="${q.id}" aria-label="查看题目详情"`)}</div>`).join("")}`
    : `<div class="empty">${tile("search")}<h3>${ui.bankFilter === "wrong" && !ui.query ? "当前没有待重练题" : "这个范围没有匹配题目"}</h3><p>${ui.bankFilter === "wrong" ? "可以回题库练习其他题，也可以清除当前筛选。" : "试试更短的关键词，或清除筛选；题库内容仍然保留。"}</p>${btn("清除筛选", "clear-filters", "primary")}</div>`;
}
function bank() {
  return (
    head(
      "题库 · 找到，再深入",
      "让每道题，都有来处。",
      "题型、考点与来源就近呈现；详情里完成编辑和回看。",
      `<button data-page="manual" class="primary">${ico("plus")}录入题目</button>`,
    ) +
    tabs(
      [
        ["all", "全部题目"],
        ["wrong", "错题本"],
        ["star", "收藏"],
        ["created", "本页新增"],
      ],
      ui.bankFilter,
      "bank-filter",
    ) +
    `<div class="library-tools"><label class="search-field">${ico("search")}<input id="bank-search" value="${esc(ui.query)}" placeholder="搜索题干、考点或题型" aria-label="搜索题目"></label><div class="actions">${btn("练习当前范围", "practice-range", "soft", filtered().length ? "" : 'disabled aria-describedby="scope-reason"')}${btn("更多维护", "maintenance", "ghost")}</div></div><p id="scope-reason" class="small-copy">${filtered().length ? `当前匹配 ${filtered().length} 道题；练习使用此范围。` : "当前范围没有可练题目，请清除筛选。"}</p><div id="batch-area">${batch()}</div><div class="table-wrap" id="question-list">${bankRows()}</div><div class="library-footer"><span id="bank-count">共 ${filtered().length} 道 · 合成示例</span><span>选择题提供选项 · 解答题核对要点后自评</span></div>`
  );
}
function batch() {
  return ui.selected.size
    ? `<div class="batchbar"><strong>已选 ${ui.selected.size} 道</strong>${btn("练习所选", "practice-selected", "small")}${btn("导出预览", "export-selected", "small")}${btn("清除选择", "clear-selected", "text")}</div>`
    : "";
}
function questionPreview(q, answer = true) {
  const answerSpecNote = q.answerSpec?.kind === "numeric"
    ? `<p class="small-copy">判分单位：${esc(q.answerSpec.unit || "未设置")} · 绝对容差：${q.answerSpec.absTol ?? 0} · 相对容差：${q.answerSpec.relTolerance ? `${q.answerSpec.relTolerance * 100}%` : "未设置"}</p>`
    : q.answerSpec?.kind === "multiBlank"
      ? `<p class="small-copy">逐空判分 · ${q.answerSpec.blanks.length} 个空，按题目顺序分别核对</p>`
      : "";
  return `<div class="preview-face">${tag(types[q.type], "purple")}<h3>${esc(q.q || "在左侧写下清楚的题干")}</h3>${q.options?.length ? `<div class="choice-list">${q.options.map((o, i) => `<div class="flex"><span class="choice-letter">${String.fromCharCode(65 + i)}</span><span>${esc(o || "待填写选项")}</span></div>`).join("")}</div>` : ""}${answer ? `<div class="answer"><strong>参考答案：</strong>${esc(q.answer || "尚未填写")}<p class="small-copy">${esc(q.analysis || "补充解析，让这道题更容易复盘。")}</p>${answerSpecNote}</div>` : ""}</div>`;
}
function inferManualAnswerSpec(q) {
  if (q.type !== "fill") return undefined;
  const text = String(q.answer ?? "").trim();
  if (!text) return undefined;
  if (text.includes(";;")) {
    const parts = text.split(";;").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) return { v: 1, kind: "multiBlank", blanks: parts.map((answer) => ({ answers: [answer] })) };
  }
  const match = text.match(/^([-+]?[\d.,]+)\s*(\S+)?$/);
  if (match && Number.isFinite(Number(match[1].replace(/,/g, "")))) {
    return { v: 1, kind: "numeric", ...(match[2] ? { unit: match[2] } : {}) };
  }
  return undefined;
}
function answerSpecEditor(q) {
  if (q.type !== "fill") return "";
  const spec = q.answerSpec?.kind === "numeric" ? q.answerSpec : {};
  return `<section class="structured-author"><div class="small-copy">数值判分设置（可选）</div><div class="flex wrap"><label class="field grow">单位<input id="draft-spec-unit" value="${esc(spec.unit || "")}" placeholder="m/s"></label><label class="field grow">绝对容差<input id="draft-spec-abs" inputmode="decimal" value="${spec.absTol ?? ""}" placeholder="0.5"></label><label class="field grow">相对容差（%）<input id="draft-spec-rel" inputmode="decimal" value="${spec.relTolerance != null ? spec.relTolerance * 100 : ""}" placeholder="5"></label></div><small>留空时按普通填空处理；填写单位或容差后，练习会显示对应提示。</small></section>`;
}
function studio() {
  return (
    head("出题 · 从知识到练习", "让好问题，慢慢成形。", "先手工录一道题，或从资料、导入与 AI 开始。") +
    tabs(
      [
        ["manual", "手工录题"],
        ["materials", "资料"],
        ["import", "批量导入"],
        ["ai", "AI 出题"],
      ],
      ui.studioTab,
      "studio-tab",
    ) +
    { manual, materials: materialPage, import: importPage, ai: aiPage }[ui.studioTab]()
  );
}
function manual() {
  const q = ui.draft;
  return `<div class="studio-grid"><section class="panel"><div class="section-head"><h3>题目内容</h3>${tag(ui.dirty ? "未保存草稿" : ui.draftSaved ? "已加入本页题库" : "示例草稿", ui.dirty ? "warm" : "")}</div><div class="type-grid" aria-label="题型">${Object.entries(
    types,
  )
    .map(([id, l]) => btn(l, "draft-type", "", `data-value="${id}" aria-pressed="${q.type === id}"`))
    .join(
      "",
    )}</div><label class="field">题干<textarea id="draft-q" rows="3">${esc(q.q)}</textarea><small>${q.type === "fill" ? "用 ____ 表示待填写位置；多空参考答案按顺序用 ;; 分隔；纯数值可填写单位。" : q.type === "multiple" ? "可以选择多个正确项；填写完整选项。" : q.type === "short" ? "说明回答的范围与长度，提供可核对的参考要点。" : "让用户知道需要回答什么。"}</small></label>${q.options ? `<div><span class="small-copy">选项 · 勾选正确项</span>${q.options.map((o, i) => `<label class="option-editor"><input type="${q.type === "multiple" ? "checkbox" : "radio"}" name="correct-option" data-correct="${String.fromCharCode(65 + i)}" ${q.answer.includes(String.fromCharCode(65 + i)) ? "checked" : ""} aria-label="${String.fromCharCode(65 + i)} 为正确选项"><span>${String.fromCharCode(65 + i)}</span><input type="text" data-option="${i}" value="${esc(o)}" aria-label="选项 ${String.fromCharCode(65 + i)}" ${q.type === "judge" ? "readonly" : ""}></label>`).join("")}</div>` : `<label class="field">${q.type === "fill" ? "参考答案（多空用 ;; 分隔）" : "参考要点"}<textarea id="draft-answer" rows="3">${esc(q.answer)}</textarea><small>${q.type === "fill" ? "纯数值（可带单位）会自动启用数值作答；用 ;; 分隔至少两个答案会启用逐空作答。" : "答案应能被人工核对。"}</small></label>`}${answerSpecEditor(q)}<label class="field">解析<textarea id="draft-analysis" rows="2">${esc(q.analysis)}</textarea></label><div class="flex"><label class="field grow">考点<input id="draft-kp" value="${esc(q.kp)}"></label><label class="field grow">来源<input id="draft-source" value="${esc(q.source)}"></label></div><div class="studio-footer"><span class="small-copy">本原型仅在当前页面内存中保存；刷新会重置。实际插件会自动保存草稿，并在重载后恢复。</span><div class="actions">${btn("换一道空白题", "blank-draft")}${btn(ui.draftSaved && !ui.dirty ? "本题已加入" : "加入本页题库", "save-draft", "primary", ui.draftSaved && !ui.dirty ? "disabled" : "")}</div></div></section><section class="panel"><div class="section-head"><h3>实际题面预览</h3>${tag("同步预览", "purple")}</div><div id="draft-preview">${questionPreview(q)}</div><div class="notice" style="margin-top:18px">保存后，题库、今日数量与可练范围使用同一份本页样例数据。真实插件需要思源确认写入后再更新。</div></section></div>`;
}
function materialPage() {
  const filteredMaterials = ui.scene === "materials-empty"
    ? []
    : materials.filter((item) => `${item.title} ${item.section} ${item.text}`.toLowerCase().includes(ui.materialQuery.trim().toLowerCase()));
  const selected = filteredMaterials.find((item) => item.id === ui.material) || filteredMaterials[0];
  const busy = ui.scene === "materials-saving" || ui.materialSaving;
  const failure = ui.scene === "materials-error";
  const list = filteredMaterials.length
    ? filteredMaterials.map((item) => btn(`${tile("doc")}<span>${esc(item.title)}<small>${esc(item.section)}</small></span>`, "material-select", item.id === selected?.id ? "active" : "", `data-id="${item.id}" ${busy ? "disabled" : ""} aria-current="${item.id === selected?.id ? "true" : "false"}`)).join("")
    : `<div class="empty material-empty" role="status">${tile(ui.scene === "materials-empty" ? "book" : "search")}<h3>${ui.scene === "materials-empty" ? "还没有学习资料" : "没有匹配的资料"}</h3><p>${ui.scene === "materials-empty" ? "导入一份本地资料或登记链接，再从原文整理题目。" : "试试更短的关键词，或清空搜索继续浏览。"}</p>${ui.scene === "materials-empty" ? btn("去批量导入", "material-help", "primary") : btn("清除搜索", "material-clear-search", "primary")}</div>`;
  const emptyDetail = !selected
    ? `<section class="panel material-detail-empty"><div class="empty">${tile("doc")}<h3>选择资料后开始整理</h3><p>资料、笔记和来源定位会在这里并排查看。</p></div></section>`
   : `<section class="panel" ${busy ? 'aria-busy="true"' : ""}><div class="section-head"><h3>${esc(selected.title)}</h3>${btn("来源", "material-source", "text", busy ? "disabled" : "")}</div>${failure ? `<div class="notice warm" role="alert"><strong>笔记保存失败</strong>输入仍保留在编辑区。检查资料是否可写后重试。<div class="actions">${btn("重试保存", "retry-material-save", "small soft", busy ? "disabled" : "")}</div></div>` : ""}${busy ? `<div class="notice" role="status"><span class="spinner" aria-hidden="true"></span> 正在保存笔记；资料切换与编辑已暂时锁定。</div>` : ""}<div class="source-doc">${esc(selected.text)}</div><label class="field">我的笔记<textarea id="material-note" rows="4" placeholder="写下想转成题目的要点" ${busy ? "disabled" : ""}>${esc(store.materialNotes[selected.id] || "")}</textarea><small>各份资料保留独立笔记草稿；保存失败时内容不会清空。</small></label><div class="actions">${btn("带入手工录题", "material-manual", "primary", busy ? "disabled" : "")}${btn("带入 AI 材料", "material-ai", "", busy ? "disabled" : "")}${btn(busy ? "正在保存…" : "保存笔记预览", "save-note", "ghost", busy ? "disabled aria-busy=\"true\"" : "")}</div></section>`;
  return `<div class="studio-grid materials-workspace"><section class="panel"><div class="section-head"><h3>资料列表</h3>${tag(`${filteredMaterials.length} 份`, "purple")}</div><label class="search-field material-search">${ico("search")}<input id="material-search" type="search" value="${esc(ui.materialQuery)}" placeholder="搜索资料" aria-label="搜索资料" ${busy ? "disabled" : ""}></label><div class="material-list" ${busy ? 'aria-busy="true"' : ""}>${list}</div><div class="notice" style="margin-top:18px">先选资料，再阅读和整理。真实文件、外链与定位沿用现有资料能力。</div>${btn("资料管理说明", "material-help", "text")}</section>${emptyDetail}</div>`;
}
function aiPage() {
  const c = store.candidates[ui.candidate];
  return `<div class="studio-grid ai"><section class="panel"><div class="section-head"><h3>这次使用的资料</h3>${tag(store.aiConfigured ? "已配置样例" : "未配置 AI", store.aiConfigured ? "green" : "warm")}</div><label class="field">仅发送选中的内容<textarea id="ai-material" rows="8" ${ui.aiBusy ? "readonly" : ""}>${esc(ui.aiMaterial)}</textarea><small>原型只生成固定样例，不发送网络请求。</small></label>${store.aiConfigured ? `<div class="notice">示例服务：example.invalid · 演示模型<br>费用未知；生成前仍需核对本次实际材料。</div>` : `<div class="notice warm"><strong>AI 需要先完成设置</strong>可使用思源内置 AI 或自定义服务；未配置时，手工录题和导入仍可使用。<div class="actions">${btn("查看接入引导", "ai-setup", "text")}<button data-page="manual" class="text">先手工录题</button></div></div>`}<div class="actions" style="margin-top:18px">${ui.aiBusy ? btn("正在生成样例…", "noop", "primary", "disabled") + btn("取消生成", "cancel-ai") : btn("核对材料并生成", "preflight", "primary", store.aiConfigured && ui.aiMaterial.trim() ? "" : 'disabled aria-describedby="ai-reason"')}</div><p id="ai-reason" class="small-copy" style="margin-top:8px">${!store.aiConfigured ? "请先查看配置引导；仅演练已配置状态。" : !ui.aiMaterial.trim() ? "请填写本次材料。" : "生成候选不会直接入库，需要你逐题审核。"}</p></section><section class="panel" ${ui.aiBusy ? 'aria-busy="true"' : ""}><div class="section-head"><h3>候选与题面</h3>${tag(`${store.accepted.size} 道已审核`, "purple")}</div>${ui.aiBusy ? `<div class="skeleton hero"></div><p class="small-copy">模拟请求中；取消后保留材料并隔离迟到结果。</p>` : c ? `<div>${store.candidates.map((c, i) => `<div class="candidate ${i === ui.candidate ? "active" : ""}">${btn(`${i + 1}. ${esc(c.q)}`, "candidate", "", `data-index="${i}"`)}<label class="check-line"><input type="checkbox" data-accept="${i}" ${store.accepted.has(i) ? "checked" : ""}>已核对题目与答案</label></div>`).join("")}</div><label class="field">选中题干<textarea id="candidate-q" rows="2">${esc(c.q)}</textarea><small>编辑后需重新审核这一题。</small></label><div id="candidate-preview">${questionPreview(c)}</div><div class="studio-footer"><span class="small-copy">只创建已审核的候选</span>${btn(`加入 ${store.accepted.size} 道已审题`, "save-candidates", "primary", store.accepted.size ? "" : "disabled")}</div>` : `<div class="empty">${tile("spark")}<h3>题目先成为候选。</h3><p>选材料 → 核对发送范围 → 逐题审阅 → 确认入库。解析和题型始终可以检查。</p></div>`}</section></div>`;
}
function importPage() {
  const invalid = ui.importRows.filter((r) => !r.valid && !r.skipped);
  const skipped = ui.importRows.filter((r) => r.skipped).length;
  const canCommit = ui.importRows.some((r, i) => r.valid && !r.skipped && !ui.imported.has(i));
  const notice = invalid.length
    ? `有 ${invalid.length} 行需要处理：${esc(invalid[0].invalidReason || "请检查题目内容")}`
    : skipped
      ? `有 ${skipped} 行与已有或本批题目重复，提交时会跳过；其余题目可以加入。`
      : "本批题目校验通过。已加入的题目不会重复写入。";
  return `<div class="steps"><span class="${ui.importStep === 0 ? "active" : ""}">1 选择内容</span><span>→</span><span class="${ui.importStep === 1 ? "active" : ""}">2 校对与试导</span><span>→</span><span class="${ui.importStep === 2 ? "active" : ""}">3 逐项回执</span></div><section class="panel">${ui.importStep === 0 ? `<div class="section-head"><h3>先体验一次导入</h3>${tag("文本样例")}</div><p class="small-copy">演练格式：题型 | 题干 | 选项（/ 分隔）| 答案 | 解析。选择题答案用字母；填空多空答案用“；”分隔。</p><label class="field">粘贴题目<textarea id="import-text" rows="7">${esc(ui.importText)}</textarea><small>正式迁移保留现有 Excel / CSV / 文本解析、映射与重复策略。</small></label><div class="actions">${btn("校验并预览", "parse-import", "primary")}${btn("格式与映射说明", "import-help")}</div>` : `<div class="section-head"><h3>${ui.importStep === 2 ? "逐项处理结果" : "校对题型与答案"}</h3>${tag(`已加入 ${ui.imported.size} 道`, "green")}</div><div class="notice ${invalid.length ? "warm" : skipped ? "warm" : "green"}">${notice}</div><div class="data-table-wrap"><table class="import-table"><thead><tr><th>行</th><th>题目</th><th>结果</th><th>处理</th></tr></thead><tbody>${ui.importRows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.q)}<div class="small-copy">${esc(r.typeError ? `${r.inputType || "未知题型"} · 未识别` : types[r.type] || "未知题型")}</div></td><td>${ui.imported.has(i) ? tag("已加入", "green") : r.skipped ? tag("重复，已跳过", "warm") : r.valid ? tag("待加入", "purple") : tag(r.invalidReason || "需要处理", "red")}</td><td>${ui.imported.has(i) ? "—" : btn("修改", "fix-import", "small", `data-index="${i}"`)}</td></tr>`).join("")}</tbody></table></div><div class="studio-footer"><span class="small-copy">只处理通过校验且尚未加入的行 · 重复项不会写入 · 仅预览</span><div class="actions">${btn("返回内容", "import-back")}${btn(ui.importStep === 2 ? "只重试待处理项" : "加入有效题目", "commit-import", "primary", canCommit ? "" : "disabled")}</div></div>`}</section>`;
}
function current() {
  return ui.session?.questions[ui.session.index];
}
function answerValue(q) {
  return ui.session?.answers[q.id] ?? (q.type === "multiple" ? [] : "");
}
function hasAnswer(q) {
  const a = answerValue(q);
  if (q.answerSpec?.kind === "multiBlank") {
    return splitMultiBlankAnswer(a, q.answerSpec.blanks.length).some((part) => part.trim().length > 0);
  }
  return Array.isArray(a) ? a.length > 0 : String(a).trim().length > 0;
}
function splitBlankAnswer(value) {
  return String(value ?? "")
    .split(/[|;；]/)
    .map((part) => part.trim())
    .filter(Boolean);
}
function splitMultiBlankAnswer(value, count) {
  const parts = String(value ?? "").split(";;").slice(0, count);
  while (parts.length < count) parts.push("");
  return parts;
}
function parseNumericAnswer(raw) {
  const normalized = String(raw ?? "")
    .trim()
    .replace(/．/g, ".")
    .replace(/－/g, "-")
    .replace(/[，\s]/g, "")
    .replace(/,/g, "")
    .replace(/[×xX]\s*10\s*\^?/i, "e");
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
function numericAnswerMatches(spec, expectedRaw, givenRaw) {
  let expectedText = String(expectedRaw ?? "").trim();
  if (spec.unit && expectedText.toLowerCase().endsWith(spec.unit.toLowerCase())) {
    expectedText = expectedText.slice(0, expectedText.length - spec.unit.length).trim();
  }
  const expected = parseNumericAnswer(expectedText);
  let givenText = String(givenRaw ?? "").trim();
  let givenUnit = spec.unit || "";
  const units = [
    ...(spec.altUnits || []).map((unit) => String(unit.unit)),
    ...(spec.unit ? [String(spec.unit)] : []),
  ].sort((a, b) => b.length - a.length);
  const matchedUnit = units.find((unit) => givenText.toLowerCase().endsWith(unit.toLowerCase()));
  if (matchedUnit) {
    givenUnit = matchedUnit;
    givenText = givenText.slice(0, givenText.length - matchedUnit.length).trim();
  }
  const given = parseNumericAnswer(givenText);
  if (expected == null || given == null) return false;
  const alt = (spec.altUnits || []).find((item) => String(item.unit).toLowerCase() === String(givenUnit).toLowerCase());
  const converted = alt ? given * alt.factor : given;
  if (!Number.isFinite(converted)) return false;
  const diff = Math.abs(converted - expected);
  const epsilon = 1e-9;
  if (diff <= epsilon) return true;
  if (spec.absTol != null && diff <= spec.absTol + epsilon) return true;
  return spec.relTolerance != null && expected !== 0 && diff <= Math.abs(expected) * (spec.relTolerance / 100) + epsilon;
}
function objective(q, a) {
  if (q.type === "short") return false;
  if (q.type === "fill") {
    if (q.answerSpec?.kind === "numeric") return numericAnswerMatches(q.answerSpec, q.answer, a);
    if (q.answerSpec?.kind === "multiBlank") {
      const parts = splitMultiBlankAnswer(a, q.answerSpec.blanks.length);
      return q.answerSpec.blanks.length > 0 && q.answerSpec.blanks.every((blank, index) => {
        const given = String(parts[index] ?? "").trim();
        return given !== "" && blank.answers.some((answer) => blank.caseSensitive ? answer === given : answer.toLowerCase() === given.toLowerCase());
      });
    }
    return splitBlankAnswer(a).join("\u0000") === splitBlankAnswer(q.answer).join("\u0000");
  }
  return (Array.isArray(a) ? a.slice().sort().join("") : String(a).trim()) === q.answer;
}
function answerControls(q, locked = false) {
  const a = answerValue(q);
  const spec = q.answerSpec;
  if (q.options)
    return `<div class="choice-list" role="group" aria-label="${types[q.type]}选项">${q.options
      .map((o, i) => {
        const l = String.fromCharCode(65 + i);
        return btn(
          `<span class="choice-letter">${q.type === "judge" ? ico(i === 0 ? "check" : "close") : l}</span><span>${esc(o)}</span>`,
          "choose",
          "",
          `data-value="${l}" aria-pressed="${Array.isArray(a) ? a.includes(l) : a === l}" ${locked ? "disabled" : ""}`,
        );
      })
      .join("")}</div>`;
  if (spec?.kind === "numeric")
    return `<div class="structured-answer"><label class="field" for="session-answer">填写数值<input id="session-answer" class="answer-numeric" type="text" inputmode="decimal" autocomplete="off" placeholder="${spec.unit ? `输入数值（${esc(spec.unit)}）` : "输入数值"}" value="${esc(a)}" ${locked ? "disabled" : ""}>${spec.unit ? `<span class="tag num answer-unit">单位：${esc(spec.unit)}</span>` : ""}<small>${spec.unit ? `按 ${esc(spec.unit)} 判分。` : "按题目要求填写。"}${spec.absTol != null ? `允许绝对误差 ±${esc(spec.absTol)}。` : ""}${spec.relTolerance != null ? `允许相对误差 ${esc(spec.relTolerance * 100)}%。` : ""}</small></label></div>`;
  if (spec?.kind === "multiBlank") {
    const parts = splitMultiBlankAnswer(a, spec.blanks.length);
    return `<div class="structured-answer" role="group" aria-label="多空填空作答"><p class="answer-guidance">按题目顺序逐空填写；每个空分别保存，可以先留空某一项。</p><div class="answer-blank-list">${spec.blanks
      .map(
        (_blank, i) =>
          `<label class="field answer-blank-field" for="session-answer-part-${i}"><span>第 ${i + 1} 空</span><input id="session-answer-part-${i}" class="answer-blank" type="text" autocomplete="off" data-answer-part="${i}" data-answer-question="${esc(q.id)}" aria-label="第 ${i + 1} 空作答" placeholder="填写第 ${i + 1} 空" value="${esc(parts[i])}" ${locked ? "disabled" : ""}></label>`,
      )
      .join("")}</div></div>`;
  }
  return `<label class="field">${q.type === "fill" ? "填写答案" : "写下你的解答"}<textarea id="session-answer" rows="${q.type === "fill" ? 2 : 5}" placeholder="${q.type === "fill" ? "只填写空缺内容；多个空用“；”分隔" : "先用自己的话回答，再核对参考要点"}" ${locked ? "readonly" : ""}>${esc(a)}</textarea></label>`;
}
function practice() {
  const s = ui.session,
    q = current();
  if (!q) return empty("本场已经结束", "返回结果查看已确认的演练记录。", btn("查看结果", "show-result", "primary"));
  const r = s.results[q.id],
    locked = !!r || ui.scene === "unknown",
    recite = s.mode === "recite";
  const needsShortGrade = q.type === "short" && r && !r.selfRated;
  const answerPrompt = q.answerSpec?.kind === "numeric"
    ? `请填写一个数值${q.answerSpec.unit ? `，单位为 ${esc(q.answerSpec.unit)}` : ""}。`
    : q.answerSpec?.kind === "multiBlank"
      ? "请按题目顺序填写各空；每空分别作答，不需要写在同一个输入框。"
      : "请先作答；多选题可选择多个选项，填空题只填写空缺内容。";
  return `<div class="session-top"><div class="flex wrap">${btn(`${ico("back")} 暂停与返回`, "pause", "ghost")}${tag(recite ? "背诵 · 自评" : "独立练习", "purple")}<span class="small-copy num">${s.index + 1} / ${s.questions.length} 题</span></div>${btn("查看来源", "session-source", "text")}</div><div class="progress session-progress"><i style="width:${(100 * s.index) / s.questions.length}%"></i></div><article class="study-face"><div class="flex between wrap">${tag(types[q.type], "purple")}<span class="small-copy">${esc(q.kp)} · ${recite ? "先尝试回忆" : "选择 / 填写后提交"}</span></div><h2>${esc(q.q)}</h2><p class="study-source">来源：${esc(q.source)}</p>${recite ? "" : answerControls(q, locked)}${r || s.revealed ? `<div class="answer"><div class="flex wrap">${tag(recite || q.type === "short" ? "参考要点" : r.correct ? "回答正确" : "需要再看一遍", recite || q.type === "short" ? "purple" : r.correct ? "green" : "warm")}${r?.assisted ? tag("受助证据", "warm") : ""}</div><p style="margin-top:12px"><strong>参考答案：</strong>${esc(q.answer)}</p><p class="small-copy" style="margin-top:8px">${esc(q.analysis)}</p></div>` : ""}</article>${recite ? `${s.revealed ? `<div class="rating">${["没想起来", "有些困难", "基本想起", "很熟悉"].map((l, i) => btn(`${l}<small>自评 · ${i + 1} 级</small>`, "self-rate", "", `data-rate="${i + 1}" ${ui.scene === "unknown" ? "disabled" : ""}`)).join("")}</div>` : `<div class="study-bottom"><span class="small-copy">先在心里回答；背诵自评与正确率分开。</span>${btn("揭晓参考答案", "reveal", "primary", ui.scene === "unknown" ? "disabled" : "")}</div>`}` : `<div class="study-bottom"><div class="actions">${btn("上一题", "prev", "", s.index ? "" : "disabled")}${btn("提示", "hint", "ghost", locked ? "disabled" : "")}${!r ? `<label class="small-copy">把握度 <select id="confidence"><option ${ui.confidence === "一般" ? "selected" : ""}>一般</option><option ${ui.confidence === "确定" ? "selected" : ""}>确定</option><option ${ui.confidence === "不确定" ? "selected" : ""}>不确定</option></select></label>` : ""}</div>${r ? btn(needsShortGrade ? "先完成自评" : s.index === s.questions.length - 1 ? "完成并看结果" : "下一题 " + ico("arrow"), "next", needsShortGrade ? "primary" : "primary", needsShortGrade ? 'disabled aria-describedby="answer-reason"' : "") : btn(q.type === "short" ? "核对参考要点" : "提交答案", "submit", "primary", hasAnswer(q) && ui.scene !== "unknown" ? "" : 'disabled aria-describedby="answer-reason"')}</div><p id="answer-reason" class="small-copy" style="margin-top:9px">${r ? (needsShortGrade ? "请先完成下方解答题自评，再进入下一题。" : "本题已登记到本页演练；切题不会带入上一题答案。") : hasAnswer(q) ? "提交后显示参考答案与解析。" : answerPrompt}</p>${q.type === "short" && r && !r.selfRated ? `<div class="notice warm" style="margin-top:16px">解答题不按文本相似度自动判分，请核对要点后自评。<div class="actions">${btn("要点不完整", "short-grade", "", `data-value="needs-work" ${ui.scene === "unknown" ? "disabled" : ""}`)}${btn("要点基本完整", "short-grade", "soft", `data-value="complete" ${ui.scene === "unknown" ? "disabled" : ""}`)}</div></div>` : ""}`}`;
}
function mockSetup() {
  const eligibleQuestions = mockEligibleQuestions();
  const eligible = eligibleQuestions.length;
  const countValid = Number.isInteger(ui.mockCount) && ui.mockCount >= 1 && ui.mockCount <= eligible;
  const minutesValid = Number.isInteger(ui.mockMinutes) && ui.mockMinutes >= 1 && ui.mockMinutes <= 180;
  if (ui.scene === "mock-loading")
    return head("模考 · 正在读取题库", "正在准备本次配卷。", "读取完成前不会显示可用题量，也不能重复开考。") +
      '<section class="panel prototype-load-state" aria-busy="true"><div class="skeleton hero"></div><div class="skeleton"></div><p class="small-copy"><span class="spinner" aria-hidden="true"></span>正在读取当前题库与配卷范围…</p><button class="soft" data-action="loading-preview-done" disabled>正在读取…</button></section>';
  if (ui.scene === "mock-load-error")
    return head("模考 · 读取失败", "暂时没能读取题库。", "当前状态不会误显示成 0 道题；你可以重试，或返回题库检查。") +
      '<section class="panel prototype-load-state" role="alert"><div class="icon-tile warm">' + ico("help") + '</div><h3>题库读取失败</h3><p>演示错误：本地数据服务暂时不可用。不会丢弃已有的本场作答。</p><div class="actions">' +
      btn("重试读取", "retry-mock-load", "primary") + btn("查看题库", "mock-open-bank", "ghost") + '</div></section>';
  if (ui.scene === "mock-empty-bank")
    return head("模考 · 空题库", "还没有可用于模考的题目。", "先加入客观题；解答题可在练习台核对要点后自评。") +
      empty("题库还是空的", "载入示例题库熟悉配卷流程，或先录入、导入自己的题目。",
        btn("体验示例题库模考", "mock-load-sample", "primary") + '<button data-page="manual">手工录题</button><button data-page="import">批量导入</button>', "exam");
  if (ui.scene === "mock-blueprint-invalid")
    return head("模考 · 蓝图校验", "配卷蓝图暂时无法满足。", "配额不足时不能开考，避免生成与要求不符的试卷。") +
      '<section class="panel prototype-load-state" role="alert"><div class="icon-tile warm">' + ico("exam") + '</div><h3>题型配额不足</h3><p>演示蓝图要求“学习方法”至少 4 道，但当前题目范围只有 3 道。正式功能需调整蓝图配额或扩大题目范围。</p><div class="actions">' +
      btn("退出错误态预览", "mock-blueprint-adjust", "primary") + btn("查看题库", "mock-open-bank", "ghost") + '</div><p class="small-copy">当前原型仅展示校验结果，不提供蓝图编辑与保存。</p></section>';
  const canStart = countValid && minutesValid && !["unknown", "mock-invalid", "mock-loading", "mock-load-error", "mock-empty-bank", "mock-blueprint-invalid"].includes(ui.scene);
  return (
    head(
      "模考 · 先定范围，再开始",
      "给自己一次完整检验。",
      "考试过程中隐藏答案与解析；严格模式不提供 AI 和提示。",
      btn("历史记录", "mock-history", "ghost"),
    ) +
    `<div class="two-col"><section class="panel"><h3>本次配卷</h3><label class="field">题目范围<select id="mock-scope"><option>示例题库 · 自动判分题</option></select><small id="mock-eligibility">当前可用于模考 ${eligible} 道；范围仅含单选、多选、判断和填空。解答题需自评、资料题用于阅读，均不进入自动判分试卷。</small></label><div class="flex"><label class="field grow">题数<input id="mock-count" type="number" min="1" max="${eligible}" value="${ui.mockCount}"></label><label class="field grow">时长（分钟）<input id="mock-minutes" type="number" min="1" max="180" value="${ui.mockMinutes}"></label></div><label class="check-line"><input id="mock-strict" type="checkbox" ${ui.mockStrict ? "checked" : ""}>严格模式 · 不提供提示与 AI</label>${ui.scene === "mock-invalid" ? `<div id="mock-validation" class="notice warm" role="alert"><strong>题量不足，暂不能开考。</strong>当前要求 ${ui.mockCount} 道，但只有 ${eligible} 道可自动判分题。请减少题数或先补充客观题。</div>` : !countValid || !minutesValid ? `<div id="mock-validation" class="notice warm" role="alert">题数需要为 1–${eligible}，时长需要为 1–180 分钟。</div>` : `<div id="mock-validation" class="notice" role="status">当前范围足够：${ui.mockCount} 道 · ${ui.mockMinutes} 分钟。</div>`}<div class="studio-footer"><span class="small-copy">此处仅演练配卷与作答流程。</span>${btn("生成试卷并开始", "start-mock", "primary", !canStart ? 'disabled aria-describedby="mock-validation"' : "")}</div></section><section class="panel"><div class="section-head"><h3>这场会发生什么？</h3>${tag("考试模式", "purple")}</div><div class="step-list">${[
      ["专注作答", "支持跳题、标记与答题卡，不会提前透露答案。"],
      ["检查后交卷", "未答题数量就近说明；交卷确认前仍可修改。"],
      ["成绩与复盘", "客观题自动核对，解答题列为待自评，不混成一个准确总分。"],
    ]
      .map(([t, d], i) => `<div class="step"><b>${i + 1}</b><div><h4>${t}</h4><p>${d}</p></div></div>`)
      .join(
        "",
      )}</div><div class="pace-note"><strong>成绩只解释这一次。</strong><p>题目范围、是否受助与作答条件一起保留。</p></div></section></div>`
  );
}
function mockPage() {
  const s = ui.session,
    q = current();
  if (!q)
    return empty(
      "没有进行中的模考",
      "先配卷，再进入专注考试。",
      `<button data-page="mocksetup" class="primary">去配卷</button>`,
    );
  const assisted = !!s.meta[q.id]?.assisted;
  return `${ui.scene === "mock-submit-error" ? `<div class="notice warm state-banner" role="alert"><strong>成绩暂未保存</strong>${esc(ui.mockSubmitError || "网络或宿主服务暂时不可用。你的答案仍保留在本场。")} ${btn("重试交卷", "retry-mock-submit", "soft")}</div>` : ""}<div class="session-top"><div class="flex wrap">${tag(s.strict ? "严格模考" : "普通模考", "purple")}<span class="small-copy num">${s.index + 1} / ${s.questions.length} 题</span></div><div class="actions">${tag(`${s.minutes}:00 · 演示计时`, "warm")}${btn("答题卡", "answer-sheet")}${btn("交卷", "finish-mock", "primary", ui.scene === "unknown" || ui.scene === "mock-submit-error" ? "disabled" : "")}</div></div><div class="progress session-progress"><i style="width:${(100 * s.questions.filter((question) => hasAnswer(question)).length) / s.questions.length}%"></i></div><article class="study-face"><div class="flex between">${tag(types[q.type], "purple")}${btn(`${ico("flag")} ${s.flags.has(q.id) ? "已标记" : "稍后检查"}`, "flag", "ghost", `aria-pressed="${s.flags.has(q.id)}"`)}</div><h2>${esc(q.q)}</h2><p class="study-source">每题 10 分 · ${s.strict ? "严格模式不提供提示、答案或 AI" : "普通模式可使用提示，交卷前隐藏答案与解析"}</p>${answerControls(q, ui.scene === "unknown" || ui.scene === "mock-submit-error")}${!s.strict ? `<div class="actions" style="margin-top:16px">${btn(assisted ? "已使用提示" : "使用提示", "mock-hint", "ghost", `${assisted || ui.scene === "unknown" || ui.scene === "mock-submit-error" ? "disabled" : ""}`)}<span class="small-copy">使用提示会记录为受助证据。</span></div>` : ""}</article><div class="study-bottom"><span class="small-copy">作答保留在本场；可以返回修改。</span><div class="actions">${btn("上一题", "prev", "", s.index ? "" : "disabled")}${btn(s.index === s.questions.length - 1 ? "检查并交卷" : "下一题 " + ico("arrow"), s.index === s.questions.length - 1 ? "finish-mock" : "mock-next", "primary", ui.scene === "unknown" || ui.scene === "mock-submit-error" ? "disabled" : "")}</div></div>`;
}
function results() {
  const s = ui.session;
  if (!s) return empty("还没有本场结果", "开始一组题后，在这里查看已确认记录。", btn("体验一组题", "start", "primary"));
  const rs = Object.values(s.results),
    obj = rs.filter((r) => r.kind === "objective"),
    self = rs.filter((r) => r.kind !== "objective" && !r.unanswered && r.selfRated),
    pendingSelf = rs.filter((r) => r.kind !== "objective" && !r.unanswered && !r.selfRated),
    unanswered = rs.filter((r) => r.unanswered),
    attempted = obj.filter((r) => !r.unanswered),
    correct = attempted.filter((r) => r.correct).length,
    assisted = rs.filter((r) => r.assisted).length;
  return `<section class="panel result-panel"><div class="result-mark">${ico("check")}</div>${tag(s.mode === "mock" ? "模考已交卷" : s.mode === "recite" ? "背诵自评" : "本场练习", "purple")}<h2 style="margin-top:13px">这一小步，已经完成。</h2><p>示例题库 · ${rs.length} 道已登记 · 全部为本页演练结果</p><div class="result-stats"><div><strong>${correct} / ${attempted.length}</strong><small>客观题答对</small></div><div><strong>${unanswered.length}</strong><small>未作答</small></div><div><strong>${self.length}</strong><small>解答 / 背诵自评</small></div></div><div class="notice warm"><strong>${attempted.length ? `客观题 ${correct * 10} / ${attempted.length * 10} 分，仅限已作答题。` : "本场没有已作答的客观题。"}</strong>${unanswered.length ? `另有 ${unanswered.length} 道未作答，不归为答错。` : ""} ${pendingSelf.length ? `另有 ${pendingSelf.length} 道解答题待自评。` : ""} ${assisted ? `有 ${assisted} 条受助证据。` : ""}自评与受助证据分开列示；解答题未自评不能计为自动答对。原型不计算长期掌握率。</div><div class="actions">${btn("查看本场逐题结果", "result-details")}${btn("去复盘", "result-report", "primary")}${btn("回到原任务", "return-origin")}</div><div class="divider"></div><p class="small-copy">这次发现的问题，下次可以从错题本继续。</p></section>`;
}
function reportDataOperations() {
  const storageBusy = ui.storageStatus === "loading";
  const auditBusy = ui.auditStatus === "loading";
  const storageBody = !ui.storageOpen
    ? `<p class="small-copy">按需查看题目、作答记录等存储条目的占用。</p>`
    : storageBusy
      ? `<div class="report-operation-state" role="status" aria-busy="true"><span class="spinner" aria-hidden="true"></span> 正在读取存储占用…<div class="skeleton"></div><small>读取期间会锁定重复操作。</small></div>`
      : ui.storageStatus === "error"
        ? `<div class="report-operation-state report-operation-error" role="alert"><strong>存储占用读取失败</strong><p>${esc(ui.storageError || "示例服务暂时不可用，请重试。")}</p>${btn("重试读取", "report-storage-retry", "small soft")}</div>`
        : ui.storageStatus === "empty"
          ? `<div class="report-operation-state report-operation-empty"><div class="report-empty-art" aria-hidden="true">${ico("doc")}</div><strong>没有可显示的存储记录</strong><p>读取成功但当前没有可列出的条目；这与读取失败不同。</p>${btn("重新读取", "report-storage-retry", "small soft")}</div>`
          : ui.storageStatus === "success"
            ? `<div class="report-storage-rows">${ui.storageRows.map((row) => `<div class="row"><div class="grow"><strong>${esc(row.key)}</strong><p>${row.present ? `${(row.bytes / 1024).toFixed(1)} KB · 示例条目` : "尚未创建"}</p></div>${tag(row.present ? "已记录" : "空")}</div>`).join("")}</div><div class="actions">${btn("重新读取", "report-storage-retry", "small soft")}</div>`
            : `<p class="small-copy">尚未读取。打开后会显示加载反馈、结果或可重试的错误说明。</p>`;
  const auditBody = auditBusy
    ? `<div class="report-operation-state" role="status" aria-busy="true"><span class="spinner" aria-hidden="true"></span> 正在扫描示例题库与作答流水…<div class="skeleton"></div><small>体检期间会锁定重复操作。</small></div>`
    : ui.auditStatus === "error"
      ? `<div class="report-operation-state report-operation-error" role="alert"><strong>数据体检失败</strong><p>${esc(ui.auditError || "示例数据暂时不可用，请重试体检。")}</p>${btn("重试体检", "report-audit-retry", "small soft")}</div>`
      : ui.auditStatus === "partial"
        ? `<div class="report-operation-state report-operation-partial" role="alert"><strong>体检部分完成，结果不完整</strong><p>有 ${ui.auditSkippedBanks} 个示例题库读取失败；下方数字仅代表已成功读取的部分。</p>${ui.auditResult ? auditSummary(ui.auditResult) : ""}${btn("重试体检", "report-audit-retry", "small soft")}</div>`
        : ui.auditStatus === "success"
          ? `<div class="report-operation-state" role="status"><strong>${ui.auditResult?.problemCount ? "体检发现需要核对的项目" : "示例数据看起来正常"}</strong>${ui.auditResult ? auditSummary(ui.auditResult) : ""}<p>已读取 ${ui.auditResult?.events ?? 0} 条示例作答记录。</p>${btn("重新体检", "report-audit-run", "small soft")}</div>`
          : `<p class="small-copy">检查重复流水、异常记录与未来日期；本演练只展示状态，不修复或修改数据。</p>`;
  return `<section class="panel report-data-tools" aria-label="数据与存储检查"><div class="section-head"><div><h3>数据与存储检查</h3><p class="small-copy">状态完整性演练 · 全部结果均为内存样例</p></div>${tag("原型演练", "purple")}</div><div class="report-operation-grid"><section class="report-operation-card"><div class="section-head"><div class="flex">${tile("doc")}<div><h4>存储占用</h4><p class="small-copy">只读预览条目占用与空结果</p></div></div>${btn(storageBusy ? "正在读取…" : ui.storageOpen ? "收起" : "查看占用", "report-storage-toggle", "small", storageBusy ? "disabled aria-busy=\"true\"" : "")}</div>${storageBody}</section><section class="report-operation-card"><div class="section-head"><div class="flex">${tile("check", "warm")}<div><h4>数据体检</h4><p class="small-copy">重复项、异常流水与日期边界</p></div></div>${btn(auditBusy ? "正在体检…" : ui.auditStatus === "idle" ? "开始体检" : "重新体检", "report-audit-run", "small", auditBusy ? "disabled aria-busy=\"true\"" : "")}</div>${auditBody}</section></div><p class="small-copy report-data-disclaimer">原型只演练加载、成功、失败与空结果反馈；不会访问思源本地存储、扫描真实题库或写入修改。</p></section>`;
}
function auditSummary(result) {
  return `<div class="report-audit-summary"><span>${result.events} 条流水</span><span>${result.duplicateEids} 条重复</span><span>${result.badEvents} 条异常</span><span>${result.futureEvents} 条未来日期</span></div>`;
}
function report() {
  const n = store.log.length;
  const reportHead = head(
    "复盘 · 先发现，再行动",
    "看清下一步，练习才有方向。",
    "作答统计按日期范围覆盖全部题库；考点掌握与薄弱项按当前题库累计历史；热力图、连胜与消灭错题按全局状态统计。下方图表为固定样例，范围切换不会真实筛选图表；本页练习记录在「记录与证据」单独显示。",
    `<label class="small-copy">范围 <select id="report-range" ${["report-loading", "report-error", "scope-loading"].includes(ui.scene) ? "disabled" : ""}><option value="week" ${ui.reportRange === "week" ? "selected" : ""}>近 7 天</option><option value="day" ${ui.reportRange === "day" ? "selected" : ""}>今天</option></select></label>`,
  );
  const reportTabs = tabs([ ["overview", "概览"], ["knowledge", "考点与错题"], ["evidence", "记录与证据"] ], ui.reportTab, "report-tab");
  const special = {
    "report-loading": ["正在读取复盘数据", "正在汇总作答记录、题库范围与考点。", "report-load", "chart"],
    "report-error": ["暂时没能读取复盘", "历史记录与草稿不会被删除；恢复后可重试。", "report-load-error", "help"],
    "report-no-bank": ["还没有题库", "先创建或导入题库，复盘才有可用的范围。", "report-no-bank", "bank"],
    "report-no-attempts": ["当前范围还没有作答", "完成一次练习或模考后，这里会出现可解释的统计。", "report-no-attempts", "chart"],
    "report-no-evidence": ["还没有学习记录", "完成一次练习或模考后，作答过程和证据会显示在这里。", "report-no-evidence", "doc"],
  }[ui.scene];
  if (special) {
    const [title, desc, actionKind, icon] = special;
    const isError = actionKind === "report-load-error" || actionKind === "scope-load-error";
    const isLoading = actionKind === "report-load" || actionKind === "scope-load";
    const action = actionKind === "report-no-bank" ? `<button data-page="manual" class="primary">录入第一道题</button>` : actionKind === "report-no-evidence" || actionKind === "report-no-attempts" ? btn("开始一组练习", "start", "primary") : btn(isLoading ? "正在读取…" : "重试读取", actionKind, "primary", isLoading ? "disabled aria-busy=\"true\"" : "");
    return reportHead + reportTabs + `<section class="panel report-state ${isError ? "report-state-error" : ""}" role="${isError ? "alert" : "status"}" ${isLoading ? 'aria-busy="true"' : ""}>${tile(icon)}<h3>${esc(title)}</h3><p>${esc(desc)}</p>${isLoading ? `<div class="skeleton" style="margin:18px auto;max-width:420px"></div>` : ""}<div class="actions">${action}${actionKind === "report-no-bank" ? `<button data-page="onboarding">查看上手引导</button>` : ""}</div></section>`;
  }
  if (ui.scene === "scope-loading") return reportHead + reportTabs + `<section class="panel report-state" role="status" aria-busy="true">${tile("chart")}<h3>正在读取题库范围</h3><p>范围切换期间不展示旧范围统计，完成后会加载所选题库的数据。</p><div class="skeleton" style="margin:18px auto;max-width:420px"></div><span class="small-copy">正在读取…</span></section>`;
  return (
    reportHead + reportTabs +
    (ui.scene === "scope-error"
        ? `<div class="notice warm" role="alert"><strong>题库范围读取失败</strong>已保留上次确认的统计。${btn("重试读取范围", "retry-report-scope", "small soft")}</div>`
        : "") +
    (ui.reportTab === "overview"
      ? `<div class="notice warm"><strong>示例结论：先练「学习方法」中的受助与独立证据。</strong>固定样例中，这个考点出现过两次疑问。重练时先不使用提示，结果更容易解释。</div><div class="metrics"><div><small>样例练习题数</small><strong>${ui.reportRange === "day" ? 6 : 28}</strong></div><div><small>样例独立答对</small><strong>${ui.reportRange === "day" ? "3 / 5" : "18 / 24"}</strong></div><div><small>本页新增记录</small><strong>${n}</strong></div></div><div class="two-col"><section class="panel"><div class="section-head"><h3>练习节奏</h3>${tag("固定样例")}</div><div class="chart-bars" role="img" aria-label="固定合成样例：周一4题，周二2题，周三6题，周四3题，周五5题，周六2题，周日6题">${[4, 2, 6, 3, 5, 2, 6].map((v, i) => `<div class="chart-column"><span>${v}</span><i style="height:${v * 20}px"></i><small>${["一", "二", "三", "四", "五", "六", "日"][i]}</small></div>`).join("")}</div><details><summary>查看等价数据表与口径</summary><p class="small-copy">周一 4 · 周二 2 · 周三 6 · 周四 3 · 周五 5 · 周六 2 · 周日 6。图表固定展示完整示例周；范围切换只演示上方摘要。生产中全部模块需使用同一范围查询。</p></details></section><section class="panel"><div class="section-head"><h3>接下来可以做</h3></div><div class="row">${tile("book", "warm")}<div class="grow"><strong>不看提示，重练 3 道错题</strong><p>打开任务不代表任务已经完成。</p></div>${btn("去重练", "wrong-start", "small soft")}</div><div class="row">${tile("doc")}<div class="grow"><strong>核对主动回忆的概念</strong><p>回到来源，再用自己的话解释。</p></div><button data-page="materials" class="small">看资料</button></div>${btn("说明数据口径", "report-help", "text")}${btn("预览今日战报范围", "write-daily", "text")}<p class="small-copy">写入范围：当前题库今日作答，不受上方日期筛选影响。本原型只预览，不写入笔记。</p></section></div>`
      : ui.reportTab === "knowledge"
        ? `<section class="panel"><div class="section-head"><h3>薄弱考点</h3>${tag("合成样例")}</div>${[
            ["学习方法", 50, "区分受助与独立证据"],
            ["单位换算", 75, "先确认目标单位"],
            ["基础运算", 86, "保持间隔练习"],
          ]
            .map(
              ([l, v, d]) =>
                `<div class="knowledge-row"><div class="flex between"><div><strong>${l}</strong><p class="small-copy">${d} · 样例答对比例 ${v}%</p></div>${btn("查看对应题目", "knowledge-scope", "small", `data-value="${l}"`)}</div><div class="progress"><i style="width:${v}%"></i></div></div>`,
            )
            .join(
              "",
            )}</section><div class="notice" style="margin-top:18px">低样本比例不等于掌握率；延迟重练、独立完成与受助表现应分开核对。</div>`
        : `<section class="panel"><div class="section-head"><h3>本页演练记录</h3>${tag(`${n} 条`, "purple")}</div>${n ? store.log.map((r) => `<div class="row"><div class="grow"><strong>${esc(r.q)}</strong><p>${r.mode === "mock" ? "模考" : r.mode === "recite" ? "背诵" : "练习"} · ${r.assisted ? "使用过提示" : "未使用提示"} · ${r.unanswered ? "未作答" : r.kind === "objective" ? (r.correct ? "客观题答对" : "客观题答错") : r.grade ? `自评：${esc(r.grade)}` : "解答题待自评"}</p></div>${btn("题目详情", "detail", "small", `data-id="${r.id}"`)}</div>`).join("") : `<div class="empty"><h3>还没有本页练习记录</h3><p>上方概览是固定样例；真正完成本页练习后，记录会出现在这里。</p>${btn("开始一组练习", "start", "primary")}</div>`}</section>${reportDataOperations()}<div class="notice" style="margin-top:18px">正式迁移保留独立、受助、自评、延迟复测、改答等现有证据。未知与未读取显示说明，不冒充零；模考未作答单独列示，不混入答错。</div>`)
  );
}
function settings() {
  return (
    head("设置 · 按需配置", "本地可用，AI 按需开启。", "设置的生效范围就近说明；不要求新用户先配置模型。") +
    `<div class="health-grid"><div class="health">${tile("bank")}<strong>本地题库与练习</strong>${tag("无需 AI", "green")}</div><div class="health">${tile("spark", "warm")}<strong>AI 出题</strong>${tag(store.aiConfigured ? "已配置样例" : "未配置", store.aiConfigured ? "green" : "warm")}</div><div class="health">${tile("doc")}<strong>数据与来源</strong>${tag("仅演示内存")}</div></div><section class="panel"><h3>外观与学习</h3><div class="setting-row"><div class="grow"><strong>主题</strong><p>跟随宿主时仅读取明暗，使用插件自己的配色。</p></div><select id="theme-choice" aria-label="插件主题"><option value="light" ${ui.theme === "light" ? "selected" : ""}>浅色</option><option value="dark" ${ui.theme === "dark" ? "selected" : ""}>深色</option></select></div><div class="setting-row"><div class="grow"><strong>默认练习方式</strong><p>只影响下一场，不改正在进行的试卷。</p></div><select id="default-mode" aria-label="默认练习方式"><option value="practice" ${ui.defaultMode === "practice" ? "selected" : ""}>题型作答</option><option value="recite" ${ui.defaultMode === "recite" ? "selected" : ""}>先回忆再揭晓</option></select></div><div class="setting-row"><div class="grow"><strong>AI 接入</strong><p>内置 AI 或自定义服务；端点、模型、预算与外发范围都需明确。</p></div>${btn("配置引导", "ai-setup")}</div><div class="setting-row"><div class="grow"><strong>题库维护与数据</strong><p>导出、健康检查、勘误和打印沿用现有能力。</p></div>${btn("入口预览", "maintenance")}</div><div class="setting-row"><div class="grow"><strong>OCR 相关功能</strong><p>等待思源 3.8.7 正式版后再开发；当前原型不展示可用开关。</p></div>${tag("尚未接入")}</div><div class="studio-footer"><span class="small-copy">演练设置只在本页生效，不保存真实配置。</span>${btn("保存设置预览", "save-settings", "primary")}</div></section><div class="guide-inline">${tile("help")}<div class="grow"><strong>小驴考试（内测版）</strong><p>反馈问题或需求：QQ 群 871707735</p></div><button data-page="onboarding">重新查看引导</button></div>`
  );
}
function onboarding() {
  return (
    head("上手与示例 · 无需准备资料", "把第一场练习，变简单。", "先用几道典型题走通流程，再加入自己的资料。") +
    `<div class="two-col"><section class="panel onboard-hero">${art()}<h3>从示例开始，放心试一试。</h3><p class="small-copy" style="margin:10px 0 20px">包含单选、多选、判断、填空、解答。<br>本原型不会创建真实题库或学习记录。</p>${btn("体验示例练习", "load-sample", "primary large")}</section><section class="panel"><div class="step-list">${[
      ["题库：题目在哪里？", "搜索、收藏和错题都在这里，打开详情可以核对来源。"],
      ["出题：怎样加入自己的内容？", "手工录题无需 AI；也可以导入题目，从资料整理或审核 AI 候选。"],
      ["学习：先回答，再核对。", "选择题给出选项，填空只填空缺，解答题按要点自评。"],
      ["模考与复盘：接上下一步。", "模考隐藏答案；复盘按考点和证据解释结果，再回到重练。"],
    ]
      .map(([t, d], i) => `<div class="step"><b>${i + 1}</b><div><h4>${t}</h4><p>${d}</p></div></div>`)
      .join(
        "",
      )}</div><div class="actions" style="margin-top:22px"><button data-page="today">先看看今日</button><button data-page="manual" class="soft">录入我的第一道题</button></div></section></div>`
  );
}
function render(keep = true) {
  const active = document.activeElement,
    id = active?.id,
    start = active?.selectionStart,
    end = active?.selectionEnd,
    scroll = main.scrollTop,
    focusScope = active?.closest("#sidebar,#topbar,#mobile-nav,#screen")?.id,
    focusData = active?.dataset ? { ...active.dataset } : {};
  chrome();
  let content;
  if (ui.scene === "loading")
    content =
      head("读取状态", "正在核对当前范围。", "未取得结果时，不显示虚假的零。") +
      `<section class="panel" aria-busy="true"><div class="skeleton hero"></div><div class="skeleton"></div><p class="small-copy">加载状态预览 · ${btn("完成样例读取", "retry", "text")}</p></section>`;
  else if (ui.scene === "error")
    content =
      head("读取失败", "暂时没能读取题库。", "已有作答与草稿保留在本页，恢复后可继续。") +
      empty(
        "当前状态不可用",
        "这是错误状态演练；生产中需要显示真实错误原因与可执行恢复方式。",
        btn("重试样例读取", "retry", "primary") + btn("查看恢复说明", "error-help"),
        "help",
      );
  else if (ui.scene === "empty" && ui.page !== "today")
    content =
      head("空状态 · 从示例开始", "还没有可用题库。", "先载入示例题库，再继续查看题库、出题与练习流程。") +
      empty(
        "题库还是空的",
        "载入 12 道简单示例题后，所有入口会使用同一份题库状态。",
        btn("载入示例题库", "load-sample", "primary") + `<button data-page="onboarding">查看首次引导</button>`,
      );
  else
    content =
      issue() +
      (
        {
          today,
          bank,
          studio,
          practice,
          mocksetup: mockSetup,
          mock: mockPage,
          result: results,
          report,
          settings,
          onboarding,
        }[ui.page] || today
      )();
  main.innerHTML = `<div class="page-inner">${content}</div>`;
  if (ui.scene === "unknown")
    main
      .querySelectorAll(
        '[data-action="save-draft"],[data-action="save-candidates"],[data-action="commit-import"],[data-action="finish-mock"],[data-action="next"],[data-action="mock-next"],[data-action="short-grade"]',
      )
      .forEach((el) => (el.disabled = true));
  if (keep) {
    main.scrollTop = scroll;
    const scope = focusScope && document.getElementById(focusScope);
    const el =
      (id && document.getElementById(id)) ||
      (scope &&
        Object.keys(focusData).length &&
        [...scope.querySelectorAll(active.tagName)].find((candidate) =>
          Object.entries(focusData).every(([key, value]) => candidate.dataset[key] === value),
        ));
    if (el) {
      if (!el.disabled) el.focus({ preventScroll: true });
      else (main.querySelector('[data-action="next"]') || main).focus({ preventScroll: true });
      if (typeof start === "number" && el.setSelectionRange)
        try {
          el.setSelectionRange(start, end);
        } catch {
          /* number inputs do not support selection ranges */
        }
    }
  }
}
function navigate(page, force = false) {
  if (page === "result" && ui.session && !ui.session.complete && !force) {
    const done = Object.keys(ui.session.results).length;
    const total = ui.session.questions.length;
    $("#page-picker").value = routeKey();
    history.replaceState(null, "", `#${routeKey()}`);
    modal(
      "本场还在进行",
      `<p>当前已登记 ${done} / ${total} 题，未完成的题目不会被当作本场结果。</p><div class="notice warm" style="margin-top:16px">可以继续原来的作答；也可以先离开，稍后从今日继续，本场现场会保留在本页。</div><div class="actions">${btn("继续本场", "continue", "primary")}${btn(ui.returnPage === "today" ? "回到今日" : "回到上一处", "return-origin")}</div>`,
    );
    return;
  }
  if (ui.dirty && ui.page === "studio" && ui.studioTab === "manual" && !force && page !== "manual") {
    pendingPage = page;
    $("#page-picker").value = routeKey();
    history.replaceState(null, "", `#${routeKey()}`);
    modal(
      "还有一份未保存草稿",
      `<p>这道题还没有加入题库。离开后草稿仍保留在本页内存，刷新页面会丢失。</p><div class="actions">${btn("继续编辑", "close-dialog")}${btn("保留本页草稿并离开", "leave-draft", "primary")}</div>`,
    );
    return;
  }
  const closeDrawer = ui.navOpen;
  ui.navOpen = false;
  ui.scroll[routeKey()] = main.scrollTop;
  cancelPreviewLoads();
  if (page !== "report") {
    cancelReportPreviewLoads();
    ui.storageOpen = false;
  }
  if (dialog.open) dialog.close();
  ui.scene = "ready";
  if (["manual", "ai", "import", "materials"].includes(page)) {
    ui.page = "studio";
    ui.studioTab = page;
  } else if (page === "wrongbook") {
    ui.page = "bank";
    ui.bankFilter = "wrong";
    ui.query = "";
  } else if (page === "recite") {
    begin("recite");
    return;
  } else if (page === "practice" && (!ui.session || ui.session.mode !== "practice" || ui.session.complete)) {
    begin("practice");
    return;
  } else if (page === "mock" && ui.session?.mode !== "mock") {
    begin("mock");
    return;
  } else ui.page = page;
  render(false);
  main.scrollTop = ui.scroll[routeKey()] || 0;
  if (closeDrawer) $("#nav-trigger")?.focus({ preventScroll: true });
  else main.focus({ preventScroll: true });
  history.replaceState(null, "", `#${routeKey()}`);
}
function selectScene(scene) {
  cancelPreviewLoads();
  cancelReportPreviewLoads();
  ui.scene = scene;
  ui.materialSaving = false;
  if (scene !== "mock-invalid" && ui.mockCount > mockEligibleQuestions().length) ui.mockCount = Math.max(1, mockEligibleQuestions().length);
  if (scene === "materials-empty" || scene === "materials-error" || scene === "materials-saving") ui.materialQuery = "";
  if (scene === "materials-no-match") ui.materialQuery = "没有这份资料";
  if (scene === "mock-invalid") ui.mockCount = mockEligibleQuestions().length + 1;
  else if (scene === "mock-submit-error") {
    ui.mockRetryArmed = false;
    ui.mockSubmitError = "宿主服务暂时不可用，保存成绩失败。";
    if (!ui.session || ui.session.mode !== "mock" || ui.session.complete) {
      ui.session = null;
      ui.page = "mocksetup";
      begin("mock", mockEligibleQuestions().slice(0, 4), true);
      ui.mockSubmitError = "宿主服务暂时不可用，保存成绩失败。";
      ui.scene = scene;
    }
  }
  const target = scenePage[scene];
  if (target) {
    ui.page = target === "materials" ? "studio" : target;
    if (target === "materials") ui.studioTab = "materials";
    if (target === "report") {
      ui.reportTab = ["report-no-evidence", "report-storage-loading", "report-storage-empty", "report-storage-error", "report-audit-loading", "report-audit-partial", "report-audit-error"].includes(scene) ? "evidence" : "overview";
      if (scene === "report-storage-loading") {
        ui.storageOpen = true;
        ui.storageStatus = "idle";
      } else if (scene === "report-storage-empty") {
        ui.storageOpen = true;
        ui.storageStatus = "empty";
        ui.storageRows = [];
      } else if (scene === "report-storage-error") {
        ui.storageOpen = true;
        ui.storageStatus = "error";
        ui.storageError = "示例存储服务暂时不可用。";
      } else if (scene === "report-audit-loading") {
        ui.auditStatus = "idle";
      } else if (scene === "report-audit-partial") {
        ui.auditStatus = "partial";
        ui.auditSkippedBanks = 1;
        ui.auditResult = { events: 132, duplicateEids: 1, badEvents: 2, futureEvents: 1, problemCount: 4 };
      } else if (scene === "report-audit-error") {
        ui.auditStatus = "error";
        ui.auditError = "示例数据读取超时，请重试体检。";
      }
    }
    if (target === "mock") {
      if (!ui.session || ui.session.mode !== "mock" || ui.session.complete) {
        ui.session = null;
        begin("mock", mockEligibleQuestions().slice(0, 4), true);
      } else ui.page = "mock";
    }
    history.replaceState(null, "", `#${target}`);
  }
  if (scene === "report-storage-loading") loadStoragePreview();
  if (scene === "report-audit-loading") loadAuditPreview();
  render();
}
function modal(title, body, drawer = false) {
  if (!dialog.open) opener = document.activeElement;
  else dialog.close();
  dialog.classList.toggle("drawer", drawer);
  dialog.innerHTML = `<header class="dialog-head"><h3 id="dialog-title">${title}</h3>${btn(ico("close"), "close-dialog", "icon-only ghost", 'aria-label="关闭弹层"')}</header><div class="dialog-body">${body}</div>`;
  dialog.showModal();
}
dialog.addEventListener("close", () => {
  if (opener?.isConnected) opener.focus({ preventScroll: true });
});
function detail(id) {
  const q = store.questions.find((q) => q.id === id);
  if (!q) {
    notify("该题不在当前题库，列表范围保留。");
    return;
  }
  modal(
    "题目详情",
    `${questionPreview(q)}<div class="row"><div class="grow"><strong>${esc(q.kp)}</strong><p>来源：${esc(q.source)}</p></div>${tag(q.wrong ? "待重练" : "未标为错题", q.wrong ? "warm" : "")}</div><div class="actions">${btn(q.star ? "取消收藏" : "收藏这道题", "toggle-star", "", `data-id="${id}"`)}${btn("编辑题目", "edit-question", "", `data-id="${id}"`)}${btn("只练这道题", "practice-one", "primary", `data-id="${id}"`)}</div><details><summary>学习证据与来源说明</summary><p class="small-copy">本页已登记 ${store.log.filter((r) => r.id === id).length} 条演练记录。未读取的历史不表示从未练习。实际实现由来源块定位回思源，返回保留列表筛选与滚动。</p></details>`,
    true,
  );
}
function replaceDraft(q, editId = null, force = false) {
  if (ui.dirty && !force) {
    pendingDraft = { q, editId };
    modal(
      "保留当前手工草稿？",
      `<p>手工录题中还有未保存内容。带入新题目会替换它。</p><div class="actions">${btn("返回原草稿", "keep-draft")}${btn("放弃旧稿并带入新题", "replace-draft", "primary")}</div>`,
    );
    return;
  }
  ui.draft = structuredClone(q);
  ui.editId = editId;
  ui.draftSaved = false;
  ui.dirty = !editId;
  navigate("manual", true);
}
function begin(mode = ui.defaultMode, qs = null, force = false) {
  if (ui.session && !ui.session.complete && !force) {
    pendingSession = { mode, qs };
    modal(
      "已有一场未完成学习",
      `<p>可以继续原来的本场，或结束旧场并开始新的范围。已登记记录保留，未提交作答不会计为完成。</p><div class="actions">${btn("继续原来的本场", "continue")}${btn("开始新的本场", "replace-session", "primary")}</div>`,
    );
    return;
  }
  const sourceQuestions = qs || (mode === "mock"
    ? mockEligibleQuestions().slice(0, ui.mockCount)
    : store.questions.slice(0, 6));
  const questions = structuredClone(sourceQuestions);
  if (!questions.length) {
    notify("当前范围没有可练题目，请回题库调整筛选。");
    return;
  }
  ui.scroll[routeKey()] = main.scrollTop;
  if (dialog.open) dialog.close();
  ui.returnPage =
    ui.page === "studio" ? ui.studioTab : ["practice", "mock", "result"].includes(ui.page) ? "today" : ui.page;
  ui.confidence = "一般";
  ui.assisted = false;
  ui.session = {
    mode,
    questions,
    index: 0,
    answers: {},
    meta: {},
    results: {},
    flags: new Set(),
    revealed: false,
    strict: ui.mockStrict,
    minutes: ui.mockMinutes,
    complete: false,
  };
  ui.page = mode === "mock" ? "mock" : "practice";
  ui.scene = "ready";
  render(false);
  main.scrollTop = 0;
  main.focus();
  history.replaceState(null, "", `#${mode === "recite" ? "recite" : ui.page}`);
}
function record(q, r) {
  const s = ui.session;
  const result = { id: q.id, q: q.q, mode: s.mode, ...r };
  s.results[q.id] = result;
  const old = store.log.findIndex((x) => x.session === s && x.id === q.id);
  if (old >= 0) store.log[old] = { ...result, session: s };
  else store.log.push({ ...result, session: s });
  const real = store.questions.find((x) => x.id === q.id);
  if (real && r.kind === "objective" && !r.unanswered) real.wrong = !r.correct;
}
function advance() {
  const s = ui.session;
  const q = current();
  if (q?.type === "short" && s.results[q.id] && !s.results[q.id].selfRated) {
    notify("请先完成解答题自评，再进入下一题。");
    return;
  }
  if (s.index < s.questions.length - 1) {
    s.index++;
    s.revealed = false;
    ui.confidence = "一般";
    ui.assisted = false;
    render(false);
    main.scrollTop = 0;
    main.focus();
  } else {
    s.complete = true;
    navigate("result", true);
  }
}
function saveQuestions(qs) {
  const seen = new Set(store.questions.map((q) => importKey(q)));
  const items = [];
  qs.forEach((q) => {
    const key = importKey(q);
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ ...structuredClone(q), id: `new-${Date.now()}-${items.length}`, star: false, wrong: false });
  });
  if (!items.length) {
    notify("没有新增题目：相同题干、题型、选项与答案的题目已在题库中。");
    return [];
  }
  store.questions.push(...items);
  store.created.push(...items.map((q) => q.id));
  render();
  notify(`仅预览：${items.length} 道题已加入本页题库，今日与题库数量已同步。`);
  return items;
}
function setupAI() {
  modal(
    "AI 接入与使用说明",
    `<div class="step-list"><div class="step"><b>1</b><div><h4>选择接入方式</h4><p>思源内置 AI：先在思源设置中配置模型。自定义服务：在插件里填写端点、模型与密钥。</p></div></div><div class="step"><b>2</b><div><h4>检查权限与预算</h4><p>确认账户额度、模型权限与服务商单价；未知费用不显示为免费。</p></div></div><div class="step"><b>3</b><div><h4>每次发送前核对</h4><p>只使用本次材料，显示端点与发送范围；可删减或取消。AI 候选需人工审核。</p></div></div></div><div class="notice warm" style="margin-top:20px">本原型不读取或保存凭据；下面只切换「已配置」场景。</div><div class="actions">${btn("先用手工录题", "setup-manual")}${btn("演练已配置场景", "setup-demo", "primary")}</div>`,
  );
}
function preflight() {
  if (!store.aiConfigured || !ui.aiMaterial.trim()) return;
  modal(
    "核对本次 AI 请求",
    `<div class="notice warm"><strong>生产中，这些材料会发送给服务商。</strong>本原型不请求网络，只演练发送确认与固定候选。</div><div class="row"><div><strong>示例端点 / 模型</strong><p>https://example.invalid/v1/chat/completions · 演示模型</p></div></div><div class="row"><div><strong>实际材料范围</strong><p>${ui.aiMaterial.length} 字 · 不包含整份笔记本 · 费用未知</p></div></div><div class="source-doc">${esc(ui.aiMaterial)}</div><label class="check-line"><input id="ai-consent" type="checkbox">我已核对本次材料、端点和费用说明</label><div class="actions">${btn("保留材料，不生成", "close-dialog")}${btn("确认并生成样例", "generate-ai", "primary", "disabled")}</div>`,
  );
}
function parseImport() {
  const byName = Object.fromEntries(Object.entries(types).map(([k, v]) => [v, k]));
  ui.importRows = ui.importText
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [rawType = "", q = "", options = "", answer = "", ...analysisParts] = line.split("|");
      const inputType = rawType.trim();
      const t = byName[inputType];
      const row = normalizeQuestion({
        type: t || "short",
        q,
        options: t && ["single", "multiple", "judge"].includes(t) ? (options || "").split("/") : undefined,
        rawOptions: options,
        answer,
        analysis: analysisParts.join("|"),
        kp: "导入样例",
        source: "本页文本导入",
      });
      row.inputType = inputType;
      row.typeError = !t;
      row.invalidReason = t
        ? questionValidationReason(row)
        : `未知题型“${inputType || "空"}”，请选择单选题、多选题、判断题、填空题或解答题。`;
      row.valid = !row.invalidReason;
      return row;
    });
  ui.imported = new Set();
  refreshImportRows();
  ui.importStep = 1;
  render();
}
function normalizeQuestion(q) {
  const result = { ...q, q: q.q.trim(), answer: q.answer.trim(), analysis: q.analysis.trim() };
  if (q.options) {
    result.options = q.options.map((o) => o.trim());
    result.answer = [...new Set(result.answer.toUpperCase().replace(/\s/g, ""))].sort().join("");
  }
  if (q.type === "fill" && q.answerSpec?.kind === "multiBlank")
    result.answer = result.answer.split(";;").map((part) => part.trim()).join(";;");
  else if (q.type === "fill")
    result.answer = result.answer
      .split(/[;；]/)
      .map((part) => part.trim())
      .join("；");
  return result;
}
function importKey(q) {
  return JSON.stringify([
    q.type,
    q.q.trim(),
    q.options?.map((option) => option.trim()),
    q.type === "fill"
      ? q.answer
          .split(/[;；]/)
          .map((part) => part.trim())
          .join("；")
      : q.answer.trim(),
  ]);
}
function questionValidationReason(q) {
  if (!q.q.trim()) return "缺少题干";
  if (!q.answer.trim()) return "缺少有效答案";
  if (q.options) {
    if (q.options.length < 2 || q.options.some((option) => !option.trim())) return "选项至少需要两项且不能为空";
    if (new Set(q.options.map((option) => option.trim().toLowerCase())).size !== q.options.length) return "选项内容不能重复";
    const letters = q.answer.toUpperCase();
    if (!/^[A-Z]+$/.test(letters) || [...letters].some((letter) => letter.charCodeAt(0) - 65 >= q.options.length))
      return "答案选项字母超出范围";
    if (q.type !== "multiple" && letters.length !== 1) return "单选题或判断题只能有一个正确选项";
    if (q.type === "multiple" && letters.length < 2) return "多选题至少需要两个正确选项";
  }
  return "";
}
function refreshImportRows() {
  const seen = new Set([...store.importedKeys, ...store.questions.map((question) => importKey(question))]);
  ui.importRows.forEach((row, index) => {
    if (ui.imported.has(index)) return;
    row.skipped = false;
    row.invalidReason = row.typeError
      ? `未知题型“${row.inputType || "空"}”，请选择单选题、多选题、判断题、填空题或解答题。`
      : questionValidationReason(row);
    row.valid = !row.invalidReason;
    if (row.valid) {
      const key = importKey(row);
      if (seen.has(key)) row.skipped = true;
      else seen.add(key);
    }
  });
}
function blankDraft() {
  ui.draft = { type: "single", q: "", options: ["", "", "", ""], answer: "", analysis: "", kp: "", source: "手工录题", answerSpec: undefined };
  ui.draftSpecEdited = false;
  ui.editId = null;
  ui.dirty = false;
  ui.draftSaved = false;
  render();
}
function switchDraftType(type, force = false) {
  if (!force && ui.dirty) {
    pendingDraft = { type };
    modal(
      "切换题型并清理答案？",
      `<p>当前题型的选项或答案会被清理，题干和解析会保留。可以继续编辑，或确认切换。</p><div class="actions">${btn("继续编辑", "close-dialog")}${btn("确认切换题型", "confirm-draft-type", "primary")}</div>`,
    );
    return;
  }
  const options =
    type === "judge" ? ["正确", "错误"] : ["single", "multiple"].includes(type) ? ["", "", "", ""] : undefined;
  ui.draft = { ...ui.draft, type, answer: "", options, answerSpec: undefined };
  ui.draftSpecEdited = false;
  ui.dirty = true;
  ui.draftSaved = false;
  render();
}
function validQuestion(q) {
  return !questionValidationReason(q);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  if (b.id === "width-toggle") {
    const narrow = $("#app").classList.toggle("narrow");
    b.setAttribute("aria-pressed", narrow);
    if (!narrow && ui.navOpen) setNavOpen(false);
    return;
  }
  if (b.id === "theme-toggle") {
    theme(ui.theme === "light" ? "dark" : "light");
    return;
  }
  if (b.id === "reset-demo") {
    location.reload();
    return;
  }
  if (b.dataset.page) {
    navigate(b.dataset.page);
    return;
  }
  const a = b.dataset.action;
  switch (a) {
    case "nav-toggle":
      setNavOpen(!ui.navOpen);
      break;
    case "nav-close":
    case "nav-backdrop":
      setNavOpen(false);
      break;
    case "noop":
      break;
    case "close-dialog":
      dialog.close();
      break;
    case "retry":
    case "reconcile":
      ui.scene = "ready";
      render();
      notify(a === "reconcile" ? "仅预览：核对演练完成，没有重复提交。" : "样例读取已恢复，草稿与作答保留。");
      break;
    case "retry-practice-load":
      retryPreviewLoad("practice");
      break;
    case "retry-mock-load":
      retryPreviewLoad("mock");
      break;
    case "mock-open-bank":
      ui.bankFilter = "all";
      ui.query = "";
      navigate("bank");
      break;
    case "mock-load-sample":
      ui.scene = "ready";
      begin("mock", mockEligibleQuestions().slice(0, 4), true);
      break;
    case "mock-blueprint-adjust":
      ui.scene = "ready";
      render();
      notify("已退出配额不足错误态；当前页面展示基础配卷设置。");
      break;
    case "loading-preview-done":
      break;
    case "report-load":
    case "retry-report-load":
    case "report-load-error":
    case "scope-load":
    case "scope-load-error":
    case "report-no-attempts":
    case "report-no-evidence":
    case "report-no-bank":
      ui.scene = "ready";
      render();
      notify("演练状态已恢复；真实插件会按当前范围重新读取数据。");
      break;
    case "retry-report-scope":
      ui.scene = "ready";
      render();
      notify("题库范围读取成功，展示当前演练数据。");
      break;
    case "report-storage-toggle":
      if (ui.storageStatus === "loading") break;
      if (ui.storageOpen) {
        ui.storageOpen = false;
        render();
      } else loadStoragePreview();
      break;
    case "report-storage-retry":
      loadStoragePreview({ empty: ui.scene === "report-storage-empty" });
      break;
    case "report-audit-run":
      loadAuditPreview({ outcome: "success" });
      break;
    case "report-audit-retry":
      loadAuditPreview({ outcome: "success" });
      break;
    case "open-settings":
      navigate("settings");
      break;
    case "leave-draft":
      navigate(pendingPage, true);
      break;
    case "load-sample":
      ui.scene = "ready";
      if (!store.questions.length) store.questions = structuredClone(initial);
      begin("practice");
      break;
    case "dismiss-onboarding":
      store.onboardingDismissed = true;
      render(false);
      main.focus({ preventScroll: true });
      break;
    case "start":
      begin();
      break;
    case "continue":
      if (dialog.open) dialog.close();
      ui.page = ui.session.mode === "mock" ? "mock" : "practice";
      ui.scene = "ready";
      render(false);
      main.scrollTop = 0;
      main.focus({ preventScroll: true });
      history.replaceState(null, "", `#${routeKey()}`);
      break;
    case "replace-session":
      begin(pendingSession.mode, pendingSession.qs, true);
      break;
    case "keep-draft":
      navigate("manual", true);
      break;
    case "replace-draft":
      replaceDraft(pendingDraft.q, pendingDraft.editId, true);
      break;
    case "confirm-draft-type":
      dialog.close();
      switchDraftType(pendingDraft.type, true);
      break;
    case "recite":
      begin("recite");
      break;
    case "wrong-start":
      {
        const wrong = store.questions.filter((q) => q.wrong);
        if (!wrong.length) {
          notify("当前没有待重练题，请先完成一组练习或调整题库筛选。");
          break;
        }
        begin("practice", wrong);
      }
      break;
    case "open-mock":
      navigate("mocksetup");
      break;
    case "modes": {
      const wrongCount = store.questions.filter((q) => q.wrong).length;
      modal(
        "这次，想怎样学？",
        `<div class="row"><div class="grow"><strong>快速练习</strong><p>按题型作答，提交后核对解析。</p></div>${btn("开始", "start", "small soft")}</div><div class="row"><div class="grow"><strong>错题重练</strong><p>${wrongCount ? "先不使用提示，检查理解。" : "还没有错题；完成一次练习后会出现在这里。"}</p></div>${btn(wrongCount ? "重练" : "暂无错题", "wrong-start", "small", wrongCount ? "" : 'disabled title="当前没有错题可重练"')}</div><div class="row"><div class="grow"><strong>背诵 / 自评</strong><p>先回忆，再揭晓，按四级自评。</p></div>${btn("开始背诵", "recite", "small")}</div><div class="notice">每日、冲刺、收藏与自选范围在正式迁移中保留；本原型可从题库筛选并练习当前范围。</div>`,
      );
      break;
    }
    case "bank-filter":
      ui.bankFilter = b.dataset.value;
      ui.selected.clear();
      render();
      break;
    case "clear-filters":
      ui.bankFilter = "all";
      ui.query = "";
      ui.selected.clear();
      render();
      break;
    case "clear-selected":
      ui.selected.clear();
      render();
      break;
    case "practice-range":
      begin("practice", filtered());
      break;
    case "practice-selected":
      begin(
        "practice",
        store.questions.filter((q) => ui.selected.has(q.id)),
      );
      break;
    case "detail":
      detail(b.dataset.id);
      break;
    case "toggle-star": {
      const q = store.questions.find((q) => q.id === b.dataset.id);
      q.star = !q.star;
      render();
      detail(q.id);
      break;
    }
    case "practice-one":
      begin(
        "practice",
        store.questions.filter((q) => q.id === b.dataset.id),
      );
      break;
    case "edit-question": {
      replaceDraft(
        store.questions.find((q) => q.id === b.dataset.id),
        b.dataset.id,
      );
      break;
    }
    case "studio-tab":
      navigate(b.dataset.value);
      break;
    case "draft-type": {
      const type = b.dataset.value;
      if (type === ui.draft.type) break;
      switchDraftType(type);
      break;
    }
    case "blank-draft":
      if (ui.dirty)
        modal(
          "换一道新题？",
          `<p>当前未保存内容会被清空。可以继续编辑，或确认开始新的空白题。</p><div class="actions">${btn("继续编辑", "close-dialog")}${btn("清空并开始新题", "confirm-blank", "primary")}</div>`,
        );
      else blankDraft();
      break;
    case "confirm-blank":
      dialog.close();
      blankDraft();
      break;
    case "save-draft": {
      if (ui.scene === "unknown") break;
      ui.draft = normalizeQuestion(ui.draft);
      if (!validQuestion(ui.draft)) {
        notify("题干、有效答案与完整选项需要填写；草稿已保留。");
        break;
      }
      if (ui.editId) {
        const q = store.questions.find((q) => q.id === ui.editId);
        Object.assign(q, structuredClone(ui.draft));
        notify("仅预览：题目修改已同步到本页题库，来源保留。");
      } else {
        const saved = saveQuestions([ui.draft]);
        if (!saved.length) break;
        ui.editId = saved[0].id;
      }
      ui.dirty = false;
      ui.draftSaved = true;
      render();
      break;
    }
    case "material-select":
      if (ui.materialSaving || ui.scene === "materials-saving") break;
      ui.material = b.dataset.id;
      render();
      break;
    case "material-clear-search":
      ui.materialQuery = "";
      ui.material = materials[0].id;
      render();
      break;
    case "material-manual": {
      const m = materials.find((m) => m.id === ui.material);
      replaceDraft({
        type: "short",
        q: `请用自己的话解释「${m.title}」中的一个要点。`,
        answer: store.materialNotes[m.id] || m.text,
        analysis: "核对原文中的事实，再检查表达是否清楚。",
        kp: "资料整理",
        source: m.title,
      });
      break;
    }
    case "material-ai": {
      const m = materials.find((m) => m.id === ui.material);
      ui.aiMaterial = m.text + (store.materialNotes[m.id] ? `\n我的笔记：${store.materialNotes[m.id]}` : "");
      navigate("ai");
      notify("所选资料已带入，生成前仍需要配置与确认。");
      break;
    }
    case "save-note":
      if (ui.materialSaving) break;
      ui.materialSaving = true;
      render();
      setTimeout(() => {
        ui.materialSaving = false;
        if (ui.scene === "materials-error") {
          render();
          notify("仍未保存成功，输入保留；可再次重试。");
          return;
        }
        const note = $("#material-note")?.value;
        if (note !== undefined) store.materialNotes[ui.material] = note;
        ui.scene = "ready";
        render();
        notify("仅预览：笔记已保存在当前页面内存，刷新后会重置。");
      }, 900);
      break;
    case "retry-material-save":
      ui.scene = "materials-saving";
      ui.materialSaving = true;
      render();
      setTimeout(() => {
        ui.scene = "ready";
        ui.materialSaving = false;
        render();
        notify("重试成功：笔记已保存在当前页面内存。");
      }, 700);
      break;
    case "material-source": {
      const m = materials.find((m) => m.id === ui.material);
      modal(
        "资料来源预览",
        `<h3>${esc(m.title)}</h3><p class="small-copy">${esc(m.section)}</p><div class="source-doc" style="margin-top:16px">${esc(m.text)}</div><div class="notice" style="margin-top:16px">真实插件会回到对应文件或思源来源块；此处只有合成内容。</div>`,
      );
      break;
    }
    case "ai-setup":
      setupAI();
      break;
    case "setup-manual":
      navigate("manual");
      break;
    case "setup-demo":
      store.aiConfigured = true;
      navigate("ai");
      notify("进入已配置场景；生成仍只使用固定样例。");
      break;
    case "preflight":
      preflight();
      break;
    case "generate-ai": {
      if (!$("#ai-consent")?.checked) return;
      dialog.close();
      ui.aiBusy = true;
      const epoch = ++ui.aiEpoch;
      ui.aiTimer = setTimeout(() => {
        if (epoch !== ui.aiEpoch) return;
        ui.aiBusy = false;
        store.candidates = structuredClone(initial.slice(0, 3)).map((q) => ({
          ...q,
          source: "本次材料 / 固定候选样例",
        }));
        store.accepted.clear();
        ui.candidate = 0;
        render();
        notify("3 道固定候选已生成；请逐题审核后再加入。");
      }, 1000);
      render();
      break;
    }
    case "cancel-ai":
      clearTimeout(ui.aiTimer);
      ui.aiEpoch++;
      ui.aiBusy = false;
      render();
      notify("已取消；材料保留，迟到结果不会覆盖候选。");
      break;
    case "candidate":
      ui.candidate = Number(b.dataset.index);
      render();
      break;
    case "save-candidates": {
      if (ui.scene === "unknown") break;
      if ([...store.accepted].some((i) => !validQuestion(store.candidates[i]))) {
        notify("候选题干或答案不完整，请修正并重新审核。");
        break;
      }
      saveQuestions([...store.accepted].map((i) => store.candidates[i]));
      store.candidates = [];
      store.accepted.clear();
      render();
      break;
    }
    case "parse-import":
      if (ui.importText.trim()) parseImport();
      else notify("请先粘贴题目内容。");
      break;
    case "import-back":
      ui.importStep = 0;
      render();
      break;
    case "fix-import": {
      const i = Number(b.dataset.index),
        r = ui.importRows[i];
      modal(
        `修改第 ${i + 1} 行`,
        `<div class="notice ${r.invalidReason ? "warm" : ""}"><strong>${esc(r.skipped ? "这行与已有或本批题目重复" : r.invalidReason || "请核对这一行")}</strong><p class="small-copy">保存前可以修正题型、题干、选项、答案和解析。</p></div><label class="field">题型<select id="import-type">${Object.entries(
          types,
        )
          .map(
            ([value, label]) =>
              `<option value="${value}" ${r.type === value && !r.typeError ? "selected" : ""}>${label}</option>`,
          )
          .join(
            "",
          )}</select></label><label class="field">题干<textarea id="import-q" rows="3">${esc(r.q)}</textarea></label><label class="field">选项<input id="import-options" value="${esc(r.options?.join("/") || r.rawOptions || "")}" placeholder="选项之间用 / 分隔"><small>单选、多选、判断题使用；填空题和解答题留空。</small></label><label class="field">参考答案<input id="import-answer" value="${esc(r.answer)}"><small>多空填空题使用中文分号“；”分隔。</small></label><label class="field">解析<textarea id="import-analysis" rows="2">${esc(r.analysis)}</textarea></label><div class="actions">${btn("取消", "close-dialog")}${btn("校验这行", "save-import-row", "primary", `data-index="${i}"`)}</div>`,
      );
      break;
    }
    case "save-import-row": {
      const i = Number(b.dataset.index);
      const previous = ui.importRows[i];
      const type = $("#import-type").value;
      const optionsText = $("#import-options").value.trim();
      let r = (ui.importRows[i] = normalizeQuestion({
        ...previous,
        type,
        typeError: false,
        inputType: types[type],
        q: $("#import-q").value,
        options: ["single", "multiple", "judge"].includes(type)
          ? optionsText
            ? optionsText.split("/")
            : []
          : undefined,
        rawOptions: ["single", "multiple", "judge"].includes(type) ? optionsText : "",
        answer: $("#import-answer").value,
        analysis: $("#import-analysis").value,
      }));
      r.invalidReason = questionValidationReason(r);
      r.valid = !r.invalidReason;
      r.skipped = false;
      refreshImportRows();
      if (!r.valid) {
        notify(`这行仍不能加入：${r.invalidReason}`);
        break;
      }
      dialog.close();
      render();
      notify(r.skipped ? "这行已通过校验，但与已有或本批题目重复，提交时会跳过。" : "这行已通过校验，尚未加入题库。");
      break;
    }
    case "commit-import": {
      if (ui.scene === "unknown") break;
      const items = ui.importRows.filter((r, i) => r.valid && !r.skipped && !ui.imported.has(i));
      if (!items.length) break;
      const saved = saveQuestions(items);
      const savedKeys = new Set(saved.map((q) => importKey(q)));
      ui.importRows.forEach((r, i) => {
        if (r.valid && !r.skipped && !ui.imported.has(i) && savedKeys.has(importKey(r))) {
          ui.imported.add(i);
          store.importedKeys.add(importKey(r));
        } else if (r.valid && !ui.imported.has(i) && !savedKeys.has(importKey(r))) {
          r.skipped = true;
        }
      });
      ui.importStep = 2;
      render();
      notify(
        `仅预览：本批已加入 ${items.length} 道；${ui.importRows.filter((r) => r.skipped).length} 道重复跳过；${ui.importRows.filter((r, i) => !r.valid && !ui.imported.has(i)).length} 道待处理。`,
      );
      break;
    }
    case "choose": {
      const q = current(),
        s = ui.session;
      if (!q || s.results[q.id] || ui.scene === "unknown") break;
      const l = b.dataset.value;
      if (q.type === "multiple") {
        let a = answerValue(q);
        s.answers[q.id] = a.includes(l) ? a.filter((v) => v !== l) : [...a, l];
      } else s.answers[q.id] = l;
      render();
      break;
    }
    case "submit": {
      const q = current();
      if (!q || !hasAnswer(q) || ui.scene === "unknown") break;
      const meta = ui.session.meta[q.id] || {};
      record(q, {
        kind: q.type === "short" ? "self" : "objective",
        correct: objective(q, answerValue(q)),
        assisted: !!meta.assisted,
        confidence: meta.confidence || "一般",
        selfRated: false,
      });
      render();
      notify("仅预览：本题作答已登记，参考答案与解析已展开。");
      break;
    }
    case "next":
      advance();
      break;
    case "mock-next":
      advance();
      break;
    case "mock-hint": {
      const q = current();
      if (!q || ui.session.strict || ui.scene === "unknown") break;
      ui.session.meta[q.id] = { ...ui.session.meta[q.id], assisted: true };
      modal(
        "普通模考提示",
        `<p>你正在使用提示，交卷后会在结果中标记为受助证据。</p><div class="notice warm" style="margin-top:16px">提示只帮助回忆考点，不会直接显示答案；严格模式不会提供此入口。</div><div class="actions">${btn("继续作答", "close-dialog", "primary")}</div>`,
      );
      break;
    }
    case "prev":
      if (ui.session.index > 0) {
        ui.session.index--;
        ui.session.revealed = false;
        render(false);
        main.scrollTop = 0;
      }
      break;
    case "reveal":
      ui.session.revealed = true;
      render();
      break;
    case "self-rate": {
      const q = current();
      record(q, {
        kind: "recite",
        grade: ["没想起来", "有些困难", "基本想起", "很熟悉"][Number(b.dataset.rate) - 1],
        assisted: false,
      });
      advance();
      break;
    }
    case "short-grade": {
      const q = current(),
        r = ui.session.results[q.id];
      if (!q || !r || ui.scene === "unknown") break;
      record(q, { ...r, grade: b.dataset.value === "complete" ? "要点基本完整" : "要点不完整", selfRated: true });
      render();
      notify("仅预览：自评已登记，与客观判分分开。");
      break;
    }
    case "hint":
      ui.session.meta[current().id] = { ...ui.session.meta[current().id], assisted: true };
      modal(
        "给一点提示",
        `<p>先辨认题目在问什么，再回到「${esc(current().kp)}」的核心概念。不要急着看答案。</p><div class="notice warm" style="margin-top:16px">本题将标记为受助作答；不会混入独立答对证据。</div><div class="actions">${btn("继续作答", "close-dialog", "primary")}</div>`,
      );
      break;
    case "pause":
      modal(
        "暂停这场练习",
        `<p>当前题目、已作答内容与进度保留在本页内存。未提交的题不算完成。</p><div class="actions">${btn("继续作答", "close-dialog")}${btn("暂停并返回今日", "pause-confirm", "primary")}</div>`,
      );
      break;
    case "pause-confirm":
      navigate("today", true);
      notify("本场已暂停，可从今日继续；刷新页面会重置演练。");
      break;
    case "session-source":
      {
        const q = current();
        const material = materialForQuestion(q);
        modal(
          "题目来源预览",
          `<h3>${esc(q.source)}</h3>${material ? `<div class="source-doc" style="margin-top:16px">${esc(material.text)}</div><div class="notice" style="margin-top:16px">已按题目来源匹配到「${esc(material.title)}」样例资料；真实实现应定位到对应来源块。</div>` : `<div class="notice warm" style="margin-top:16px"><strong>没有找到精确对应的资料片段</strong>已保留来源标记「${esc(q.source)}」，真实实现应提供回到原文或继续查找的入口。</div>`}`,
        );
      }
      break;
    case "start-mock":
      if (ui.scene === "unknown") {
        notify("上一笔结果待核对，请先核对后再开始新的模考。");
        break;
      }
      if (ui.mockCount < 1 || ui.mockCount > mockEligibleQuestions().length || ui.mockMinutes < 1 || ui.mockMinutes > 180 || !Number.isInteger(ui.mockCount) || !Number.isInteger(ui.mockMinutes)) {
        notify("请调整题数与时长；可用题量不足时不能开始。");
        break;
      }
      begin("mock", mockEligibleQuestions().slice(0, ui.mockCount));
      break;
    case "flag": {
      const s = ui.session,
        id = current().id;
      s.flags.has(id) ? s.flags.delete(id) : s.flags.add(id);
      render();
      break;
    }
    case "answer-sheet": {
      const s = ui.session;
      modal(
        "答题卡",
        `<p class="small-copy">浅绿为已答，底部标线为稍后检查；点击题号返回对应题。</p><div class="answer-grid">${s.questions.map((q, i) => btn(i + 1, "jump-question", `${hasAnswer(q) ? "answered" : ""} ${s.flags.has(q.id) ? "flagged" : ""} ${s.index === i ? "current" : ""}`, `data-index="${i}" aria-label="第 ${i + 1} 题${hasAnswer(q) ? "，已答" : "，未答"}"`)).join("")}</div>`,
      );
      break;
    }
    case "jump-question":
      ui.session.index = Number(b.dataset.index);
      dialog.close();
      render(false);
      main.scrollTop = 0;
      break;
    case "finish-mock": {
      if (ui.scene === "unknown") {
        notify("上一笔结果待核对，请先核对再交卷。");
        break;
      }
      const s = ui.session,
        unanswered = s.questions.filter((q) => !hasAnswer(q)).length;
      modal(
        "检查并交卷",
        `<div class="notice ${unanswered ? "warm" : "green"}"><strong>${unanswered ? `还有 ${unanswered} 道未作答。` : "全部题目已有作答。"}</strong>交卷后才揭晓答案。${s.questions.filter((q) => q.type === "short").length} 道解答题单独标记为待核对。</div><p class="small-copy" style="margin-top:16px">题目快照、作答与严格模式条件保留在本场。仅本页演练，不写真实成绩。</p><div class="actions">${btn("继续检查", "close-dialog")}${btn("确认交卷", "confirm-mock", "primary")}</div>`,
      );
      break;
    }
    case "confirm-mock": {
      const s = ui.session;
      if (s.complete || ui.scene === "unknown") break;
      if (ui.scene === "mock-submit-error" && !ui.mockRetryArmed) {
        notify("提交失败；本场答案仍保留，请通过“重试交卷”再次提交。");
        break;
      }
      s.questions.forEach((q) =>
        record(q, {
          kind: q.type === "short" ? "self" : "objective",
          unanswered: !hasAnswer(q),
          correct: hasAnswer(q) && objective(q, answerValue(q)),
          assisted: !!s.meta[q.id]?.assisted,
          selfRated: false,
        }),
      );
      s.complete = true;
      ui.scene = "ready";
      ui.mockRetryArmed = false;
      store.mockHistory.push({ n: s.questions.length, minutes: s.minutes, strict: s.strict });
      navigate("result", true);
      break;
    }
    case "retry-mock-submit":
      if (!ui.session || ui.session.complete) break;
      ui.mockRetryArmed = true;
      modal("重试交卷", `<p>本场答案仍在本页保留。重试将继续提交当前这份试卷。</p><div class="actions">${btn("继续检查", "close-dialog")}${btn("确认重试", "confirm-mock", "primary")}</div>`);
      break;
    case "show-result":
      navigate("result", true);
      break;
    case "result-details":
      modal(
        "本场逐题结果",
        Object.values(ui.session.results)
          .map(
            (r) =>
              `<div class="row"><div class="grow"><strong>${esc(r.q)}</strong><p>${r.unanswered ? "未作答" : r.kind === "objective" ? (r.correct ? "客观题答对" : "客观题答错") : `自评：${esc(r.grade || "待核对")}`}${r.assisted ? " · 受助" : ""}</p></div>${btn("解析", "result-question", "small", `data-id="${r.id}"`)}</div>`,
          )
          .join(""),
        true,
      );
      break;
    case "result-question": {
      const q = ui.session.questions.find((q) => q.id === b.dataset.id);
      modal("答案与解析", questionPreview(q));
      break;
    }
    case "result-report":
      ui.reportTab = "evidence";
      navigate("report", true);
      break;
    case "return-origin":
      navigate(ui.returnPage, true);
      break;
    case "report-tab":
      ui.reportTab = b.dataset.value;
      render();
      break;
    case "knowledge-scope":
      ui.query = b.dataset.value;
      ui.bankFilter = "all";
      navigate("bank");
      break;
    case "save-settings":
      notify("仅预览：本页设置已应用；生产保存需等待真实配置写入回执。");
      break;
    case "search":
      modal(
        "搜索题目与功能",
        `<label class="field">输入关键词<input id="command-query" placeholder="题干、考点；或选择下方功能" autofocus></label><div class="actions"><button data-page="bank">题库</button><button data-page="manual">手工录题</button><button data-page="ai">AI 出题</button><button data-page="report">复盘</button></div><div class="actions">${btn("在题库中搜索", "command-search", "primary")}</div>`,
      );
      break;
    case "command-search":
      ui.query = $("#command-query").value;
      ui.bankFilter = "all";
      navigate("bank");
      break;
    case "maintenance":
      modal(
        "题库维护 · 迁移入口",
        `<div class="step-list"><div><h4>整理与查证</h4><p class="small-copy">章节、考点、健康检查、勘误与判分修订保留；从选中题目进入详情。</p></div><div><h4>导出与打印</h4><p class="small-copy">先显示题库范围、题数与答案包含方式，再沿用现有导出能力。</p></div><div><h4>批量操作</h4><p class="small-copy">明确集合与影响，逐项回执；部分失败仅重试失败项。</p></div></div><div class="notice warm" style="margin-top:18px">本原型演示入口归属，未连接真实维护、打印或导出接口。</div><div class="actions">${btn("返回原任务", "close-dialog", "primary")}</div>`,
      );
      break;
    case "export-selected":
      modal(
        "导出范围预览",
        `<div class="notice"><strong>当前选择 ${ui.selected.size} 道题</strong>正式实现沿用现有导出接口，核对是否包含答案和解析。</div><p class="small-copy" style="margin-top:16px">本原型不生成文件，只预览范围；不会提示导出成功。</p>`,
      );
      break;
    case "mock-history":
      modal(
        "模考记录",
        store.mockHistory.length
          ? store.mockHistory
              .map(
                (h, i) =>
                  `<div class="row"><div><strong>本页模考 ${i + 1}</strong><p>${h.n} 题 · ${h.minutes} 分钟 · ${h.strict ? "严格" : "普通"}模式 · 合成记录</p></div></div>`,
              )
              .join("")
          : `<div class="empty"><h3>还没有本页模考记录</h3><p>完成一次配卷、作答与交卷后，这里会出现记录。未读取的真实历史不表示零场。</p></div>`,
      );
      break;
    case "report-help":
      modal(
        "报告范围与证据",
        `<div class="row"><div><strong>作答统计 · 日期范围</strong><p>按上方选择的日期统计，覆盖全部题库。</p></div></div><div class="row"><div><strong>考点掌握与薄弱项 · 当前题库</strong><p>按当前题库的历史作答累计，不随上方日期范围收窄。</p></div></div><div class="row"><div><strong>热力图、连胜与消灭错题 · 全局</strong><p>展示全部题库的全局状态，不随日期和题库筛选变化。</p></div></div><div class="notice">概览图表为固定合成数据；切换日期只演示摘要变化，不会真实筛选图表。本页练习记录单独展示。</div><div class="row"><div><strong>独立与受助</strong><p>使用提示后，结果需要标为受助，不计作独立掌握。</p></div></div><div class="row"><div><strong>客观与自评</strong><p>选择、判断与填空可按规格核对；解答与背诵按要点自评。</p></div></div><p class="small-copy">查看薄弱题目后，再决定是否开始重练。</p>`,
      );
      break;
    case "write-daily":
      modal(
        "写入今日战报",
        `<div class="report-scope-note"><strong>写入范围</strong><p>当前示例题库今天的作答记录；不会受上方“${ui.reportRange === "day" ? "今天" : "近 7 天"}”筛选影响。</p></div><p class="small-copy">生产实现会写入思源日记。本原型只预览口径，不创建或修改笔记。</p>`,
      );
      break;
    case "material-help":
      modal(
        "资料与来源",
        `<p>现有本地文件、外链、来源位置、笔记、章节与考点信息迁入同一资料工作区。每份资料保留独立编辑现场。</p><div class="notice" style="margin-top:16px">此原型仅用两段合成资料。OCR 尚未接入，等待思源 3.8.7 正式版。</div>`,
      );
      break;
    case "import-help":
      modal(
        "导入校对与重试",
        `<div class="step-list"><div><h4>先预览映射</h4><p class="small-copy">每行格式为：题型 | 题干 | 选项（/ 分隔）| 答案 | 解析。题型必须使用单选题、多选题、判断题、填空题或解答题。</p></div><div><h4>填空多空使用中文分号</h4><p class="small-copy">例如答案写成“北京；上海”。竖线仍是字段分隔符，解析中的竖线会保留。</p></div><div><h4>不把部分成功说成全部成功</h4><p class="small-copy">有效行先加入，错误行保留修改；同批或历史重复项标为“重复，已跳过”，不会再次写入。</p></div><div><h4>保留现有导入能力</h4><p class="small-copy">正式迁移仍支持现有文件解析、试导、重复策略与更新式重导。</p></div></div>`,
      );
      break;
    case "partial-details":
      ui.studioTab = "import";
      ui.page = "studio";
      ui.scene = "ready";
      if (!ui.importRows.length) parseImport();
      else render();
      history.replaceState(null, "", "#import");
      main.focus({ preventScroll: true });
      notify("已进入逐项导入演练，可校对并处理待加入项。");
      break;
    case "session-help":
      modal(
        "本场说明",
        `<p>专注模式收起主导航。各题按自身题型作答，切题保留各自的答案。</p><div class="notice warm" style="margin-top:16px">模考交卷前不展示答案。练习中的提示使用与解答题自评单独记录。全部为本页内存演练。</div>`,
      );
      break;
    default:
      notify("此入口是设计预览，尚未连接生产能力。");
  }
});
function theme(t) {
  ui.theme = t;
  root.dataset.theme = t;
  $("#theme-toggle").textContent = t === "dark" ? "浅色" : "深色";
  $("#theme-toggle").setAttribute("aria-pressed", t === "dark");
  render();
}
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "bank-search") {
    ui.query = el.value;
    ui.selected.clear();
    render();
  }
  if (el.id.startsWith("draft-") || el.dataset.option !== undefined) {
    const key = {
      "draft-q": "q",
      "draft-answer": "answer",
      "draft-analysis": "analysis",
      "draft-kp": "kp",
      "draft-source": "source",
    }[el.id];
    if (key) ui.draft[key] = el.value;
    if (el.dataset.option !== undefined) ui.draft.options[Number(el.dataset.option)] = el.value;
    if (el.id === "draft-answer" && ui.draft.type === "fill" && !ui.draftSpecEdited) {
      const inferred = inferManualAnswerSpec(ui.draft);
      if (inferred) ui.draft.answerSpec = inferred;
      else delete ui.draft.answerSpec;
    }
    if (["draft-spec-unit", "draft-spec-abs", "draft-spec-rel"].includes(el.id)) {
      const unit = el.id === "draft-spec-unit" ? el.value.trim() : ui.draft.answerSpec?.unit || "";
      const absRaw = el.id === "draft-spec-abs" ? el.value : ui.draft.answerSpec?.absTol ?? "";
      const relRaw = el.id === "draft-spec-rel" ? el.value : ui.draft.answerSpec?.relTolerance != null ? String(ui.draft.answerSpec.relTolerance * 100) : "";
      const abs = Number(absRaw);
      const rel = Number(relRaw) / 100;
      if (unit || (Number.isFinite(abs) && abs > 0) || (Number.isFinite(rel) && rel > 0)) {
        ui.draft.answerSpec = { v: 1, kind: "numeric", ...(unit ? { unit } : {}), ...(Number.isFinite(abs) && abs > 0 ? { absTol: abs } : {}), ...(Number.isFinite(rel) && rel > 0 ? { relTolerance: rel } : {}) };
        ui.draftSpecEdited = true;
      } else {
        ui.draftSpecEdited = false;
        const inferred = inferManualAnswerSpec(ui.draft);
        if (inferred) ui.draft.answerSpec = inferred;
        else delete ui.draft.answerSpec;
      }
    }
    ui.dirty = true;
    ui.draftSaved = false;
    $("#draft-preview").innerHTML = questionPreview(ui.draft);
    const save = main.querySelector('[data-action="save-draft"]');
    save.disabled = false;
    save.textContent = "加入本页题库";
    main.querySelector(".section-head .tag").textContent = "未保存草稿";
  }
  if (el.id === "ai-material") {
    ui.aiMaterial = el.value;
    const generate = main.querySelector('[data-action="preflight"]');
    if (generate) generate.disabled = !store.aiConfigured || !el.value.trim();
    const reason = $("#ai-reason");
    if (reason)
      reason.textContent = !store.aiConfigured
        ? "请先查看配置引导；仅演练已配置状态。"
        : !el.value.trim()
          ? "请填写本次材料。"
          : "生成候选不会直接入库，需要你逐题审核。";
  }
  if (el.id === "candidate-q") {
    store.candidates[ui.candidate].q = el.value;
    store.accepted.delete(ui.candidate);
    $("#candidate-preview").innerHTML = questionPreview(store.candidates[ui.candidate]);
    const c = main.querySelector(`[data-accept="${ui.candidate}"]`);
    if (c) c.checked = false;
    const save = main.querySelector('[data-action="save-candidates"]');
    save.disabled = store.accepted.size === 0;
    save.textContent = `加入 ${store.accepted.size} 道已审题`;
  }
  if (el.id === "material-note") store.materialNotes[ui.material] = el.value;
  if (el.id === "material-search") {
    ui.materialQuery = el.value;
    const selected = materials.find((item) => item.id === ui.material && `${item.title} ${item.section} ${item.text}`.toLowerCase().includes(el.value.trim().toLowerCase()));
    if (!selected) {
      const firstMatch = materials.find((item) => `${item.title} ${item.section} ${item.text}`.toLowerCase().includes(el.value.trim().toLowerCase()));
      if (firstMatch) ui.material = firstMatch.id;
      else if (!el.value.trim()) ui.material = materials[0].id;
    }
    render();
  }
  if (el.id === "import-text") ui.importText = el.value;
  if (el.id === "session-answer") {
    ui.session.answers[current().id] = el.value;
    const submit = main.querySelector('[data-action="submit"]');
    if (submit) submit.disabled = !hasAnswer(current()) || ui.scene === "unknown";
  }
  if (el.dataset.answerPart !== undefined) {
    const q = current();
    const index = Number(el.dataset.answerPart);
    if (q?.answerSpec?.kind === "multiBlank" && q.id === el.dataset.answerQuestion && Number.isInteger(index) && index >= 0 && index < q.answerSpec.blanks.length) {
      const parts = splitMultiBlankAnswer(answerValue(q), q.answerSpec.blanks.length);
      parts[index] = el.value;
      ui.session.answers[q.id] = parts.join(";;");
      const submit = main.querySelector('[data-action="submit"]');
      if (submit) submit.disabled = !hasAnswer(q) || ui.scene === "unknown";
    }
  }
  if (["mock-count", "mock-minutes"].includes(el.id)) {
    if (el.id === "mock-count") ui.mockCount = Number(el.value);
    else ui.mockMinutes = Number(el.value);
    const eligible = mockEligibleQuestions().length;
    const valid =
      Number.isInteger(ui.mockCount) &&
      ui.mockCount >= 1 &&
      ui.mockCount <= eligible &&
      Number.isInteger(ui.mockMinutes) &&
      ui.mockMinutes >= 1 &&
      ui.mockMinutes <= 180;
    $("#mock-validation").textContent = valid
      ? `题量足够：${ui.mockCount} 道 · ${ui.mockMinutes} 分钟。`
      : `题数需要为 1–${eligible}，时长需要为 1–180 分钟。`;
    main.querySelector('[data-action="start-mock"]').disabled = !valid;
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "page-picker") {
    navigate(el.value);
    return;
  }
  if (el.id === "state-picker") {
    const target = scenePage[el.value];
    if (target) {
      selectScene(el.value);
      return;
    }
    ui.scene = el.value;
    if (ui.scene === "empty" && ui.page !== "today") {
      ui.page = "today";
      ui.bankFilter = "all";
      ui.query = "";
      history.replaceState(null, "", "#today");
    }
    render();
    return;
  }
  if (el.id === "theme-choice") {
    theme(el.value);
    return;
  }
  if (el.id === "ai-consent") {
    dialog.querySelector('[data-action="generate-ai"]').disabled = !el.checked;
    return;
  }
  if (el.id === "select-all") {
    filtered().forEach((q) => (el.checked ? ui.selected.add(q.id) : ui.selected.delete(q.id)));
    render();
    return;
  }
  if (el.dataset.select) {
    el.checked ? ui.selected.add(el.dataset.select) : ui.selected.delete(el.dataset.select);
    render();
    return;
  }
  if (el.dataset.accept !== undefined) {
    if (el.checked && !validQuestion(store.candidates[Number(el.dataset.accept)])) {
      el.checked = false;
      notify("候选题干与答案必须完整，修正后才可以审核。");
      return;
    }
    el.checked ? store.accepted.add(Number(el.dataset.accept)) : store.accepted.delete(Number(el.dataset.accept));
    render();
    return;
  }
  if (el.dataset.correct) {
    const l = el.dataset.correct;
    if (ui.draft.type === "multiple") {
      const a = new Set(ui.draft.answer);
      el.checked ? a.add(l) : a.delete(l);
      ui.draft.answer = [...a].sort().join("");
    } else ui.draft.answer = l;
    ui.dirty = true;
    ui.draftSaved = false;
    render();
    return;
  }
  if (el.id === "mock-strict") ui.mockStrict = el.checked;
  if (el.id === "confidence") {
    ui.confidence = el.value;
    ui.session.meta[current().id] = { ...ui.session.meta[current().id], confidence: el.value };
  }
  if (el.id === "report-range") {
    ui.reportRange = el.value;
    render();
  }
  if (el.id === "default-mode") {
    ui.defaultMode = el.value;
    notify("默认方式已选择；只影响下一场学习。");
  }
});
document.addEventListener("keydown", (e) => {
  if (ui.navOpen && $("#sidebar").contains(e.target)) {
    if (e.key === "Escape") {
      e.preventDefault();
      setNavOpen(false);
      return;
    }
    if (e.key === "Tab") {
      const focusable = [...$("#sidebar").querySelectorAll('button:not([disabled])')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    main.querySelector('[data-action="search"]')?.click();
    if (!dialog.open) document.querySelector('[data-action="search"]')?.click();
  }
  if (e.key === "Enter" && e.target.id === "command-query") {
    e.preventDefault();
    dialog.querySelector('[data-action="command-search"]').click();
  }
});
window.addEventListener("hashchange", () => {
  const next = location.hash.slice(1);
  if (!pages.some(([id]) => id === next) || next === routeKey()) return;
  navigate(next);
});
const startPage = location.hash.slice(1);
if (pages.some(([id]) => id === startPage)) navigate(startPage, true);
else render(false);
