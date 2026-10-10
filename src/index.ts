import { Plugin, openTab, showMessage, getFrontend, adaptHotkey } from "siyuan";
import "./index.scss";

import { SettingUtils } from "./libs/setting-utils";
import { escapeHtml } from "./libs/sanitize";
import { mount, unmount } from "svelte";
import manifest from "../plugin.json";

import PracticeTab from "@/ui/practice/PracticeTab.svelte";
import MockTab from "@/ui/mock/MockTab.svelte";
import ReportTab from "@/ui/report/ReportTab.svelte";
import { createExamApp } from "./app-runtime";
import type { ExamApp } from "./app";
import { streak } from "./core/replayer";
import { emitExamEvent } from "./core/bus";
import { createExamTabDescriptor } from "./core/pluginTab";
import { registerExamDailySummary } from "./ecosystem/speedSwitch";

const TAB_PRACTICE = "exam-practice";
const TAB_MOCK = "exam-mock";
const TAB_REPORT = "exam-report";
const DOCK_WRONGBOOK = "dock-wrongbook";

/** 上次打开的页签（SiYuan 重启/刷新后布局恢复不带回插件自定义页签——真机走查两次复现，
 *  用 localStorage 记忆并在 onLayoutReady 时恢复，行为对标编辑器恢复标签页） */
const OPEN_TABS_KEY = "lv-exam/lastOpenTab";
const OPEN_TAB_TYPES = [TAB_PRACTICE, TAB_MOCK, TAB_REPORT];
function rememberOpenTab(type: string) {
  if (!OPEN_TAB_TYPES.includes(type)) return;
  try {
    localStorage.setItem(OPEN_TABS_KEY, type);
  } catch {
    /* 隐私模式静默 */
  }
}

export default class LvExamPlugin extends Plugin {
  /** siyuan 1.2.9 将基类 i18n 宽化为 Record<string, JSONValue>；本项目 i18n 文件为平铺
   *  string→string（scripts/check-i18n.mjs 强制非空字符串），此处收窄回字符串字典 */
  declare i18n: Record<string, string>;
  private isMobile: boolean;
  private settingUtils: SettingUtils;
  private tabApps: { [tabType: string]: object } = {};
  /** 应用组装层（与基类 Plugin.app: App 无关，刻意改名避免遮蔽） */
  private examApp: ExamApp | null = null;
  private boundBlockIcon = this.onBlockIconClick.bind(this);
  /** 47-05 lite：设置默认值快照（注册完成时；恢复默认用） */
  private settingDefaults: Map<string, unknown> = new Map();

  async onload() {
    this.isMobile = getFrontend() === "mobile" || getFrontend() === "browser-mobile";

    this.addIcons(`
<symbol id="iconExam" viewBox="0 0 32 32">
<path d="M22 3h-12a2 2 0 0 0-2 2v22a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-18l-6-6zM12 14h8v2h-8v-2zM12 18h8v2h-8v-2zM12 22h5v2h-5v-2zM19 5.5l3.5 3.5h-3.5v-3.5z"></path>
</symbol>
<symbol id="iconMock" viewBox="0 0 32 32">
<path d="M16 3a13 13 0 1 0 13 13 13 13 0 0 0-13-13zM16 26a10 10 0 1 1 10-10 10 10 0 0 1-10 10zM17 9h-2v8l6 3.6 1-1.6-5-3z"></path>
</symbol>
<symbol id="iconReport" viewBox="0 0 32 32">
<path d="M5 27h22v2h-24v-26h2v24zM11 21h3v-8h-3v8zM17 21h3v-14h-3v14zM23 21h3v-5h-3v5z"></path>
</symbol>
<symbol id="iconWrongbook" viewBox="0 0 32 32">
<path d="M16 3a13 13 0 1 0 13 13 13 13 0 0 0-13-13zM16 26a10 10 0 1 1 10-10 10 10 0 0 1-10 10zM21 12.4l-1.4-1.4-3.6 3.6-3.6-3.6-1.4 1.4 3.6 3.6-3.6 3.6 1.4 1.4 3.6-3.6 3.6 3.6 1.4-1.4-3.6-3.6z"></path>
</symbol>`);

    this.settingUtils = new SettingUtils({
      plugin: this,
      callback: () => {
        showMessage(this.i18n["settingSaved"], 2600, "info");
      },
    });
    this.settingUtils.addItem({
      title: this.i18n["setting.examDate.title"],
      description: this.i18n["setting.examDate.desc"],
      type: "textinput",
      key: "examDate",
      value: "",
      direction: "row",
    });
    this.settingUtils.addItem({
      title: this.i18n["setting.sprintDays.title"],
      description: this.i18n["setting.sprintDays.desc"],
      type: "number",
      key: "sprintDays",
      value: 14,
      direction: "row",
    });
    this.settingUtils.addItem({
      title: this.i18n["setting.dailyGoal.title"],
      description: this.i18n["setting.dailyGoal.desc"],
      type: "number",
      key: "dailyGoal",
      value: 10,
      direction: "row",
    });
    this.settingUtils.addItem({
      title: this.i18n["setting.reciteGroup.title"],
      description: this.i18n["setting.reciteGroup.desc"],
      type: "number",
      key: "reciteGroupSize",
      value: 15,
      direction: "row",
    });
    this.settingUtils.addItem({
      title: this.i18n["setting.perQuestionTimeout.title"],
      description: this.i18n["setting.perQuestionTimeout.desc"],
      type: "number",
      key: "perQuestionTimeoutS",
      value: 0,
      direction: "row",
    });
    this.settingUtils.addItem({
      title: this.i18n["setting.feedbackTiming.title"],
      description: this.i18n["setting.feedbackTiming.desc"],
      type: "checkbox",
      key: "feedbackEndReview",
      value: false,
      direction: "row",
    });
    this.settingUtils.addItem({
      title: this.i18n["setting.materialInterleave.title"],
      description: this.i18n["setting.materialInterleave.desc"],
      type: "checkbox",
      key: "materialInterleave",
      value: false,
      direction: "row",
    });
    this.settingUtils.addItem({
      title: this.i18n["setting.examProfiles.title"],
      description: this.i18n["setting.examProfiles.desc"],
      type: "textarea",
      key: "examProfiles",
      value: "",
      direction: "column",
    });
    this.settingUtils.addItem({
      // 65-06 lite：快速刷题去重窗口（天；0=关闭去重）
      title: this.i18n["setting.quickAvoidDays.title"],
      description: this.i18n["setting.quickAvoidDays.desc"],
      type: "number",
      key: "quickAvoidDays",
      value: 3,
      direction: "row",
    });
    this.settingUtils.addItem({
      title: this.i18n["setting.checkinItemId.title"],
      description: this.i18n["setting.checkinItemId.desc"],
      type: "textinput",
      key: "checkinItemId",
      value: "",
      direction: "row",
    });
    this.settingUtils.addItem({
      title: this.i18n["setting.checkinThreshold.title"],
      description: this.i18n["setting.checkinThreshold.desc"],
      type: "number",
      key: "checkinThreshold",
      value: 0,
      direction: "row",
    });
    this.settingUtils.addItem({
      title: this.i18n["setting.retention.title"],
      description: this.i18n["setting.retention.desc"],
      type: "slider",
      key: "desiredRetention",
      value: 0.9,
      direction: "row",
      slider: { min: 0.85, max: 0.97, step: 0.01 },
    });
    this.settingUtils.addItem({
      title: this.i18n["setting.aiEndpoint.title"],
      description: this.i18n["setting.aiEndpoint.desc"],
      type: "textinput",
      key: "aiEndpoint",
      value: "",
      direction: "row",
    });
    this.settingUtils.addItem({
      title: this.i18n["setting.aiModel.title"],
      description: this.i18n["setting.aiModel.desc"],
      type: "textinput",
      key: "aiModel",
      value: "gpt-4o-mini",
      direction: "row",
    });
    this.settingUtils.addItem({
      title: this.i18n["setting.aiCustomHint.title"],
      description: this.i18n["setting.aiCustomHint.desc"],
      type: "textarea",
      key: "aiCustomHint",
      value: "",
      direction: "row",
    });
    this.settingUtils.addItem({
      title: this.i18n["setting.aiKey.title"],
      description: this.i18n["setting.aiKey.desc"],
      type: "textinput",
      key: "aiKey",
      value: "",
      direction: "row",
      password: true,
    });

    this.registerTabs();
    if (!this.isMobile) {
      this.registerTopBar();
      this.registerDock();
      this.registerStatusBar();
    }
    this.registerCommands();
    // 47-05 lite：注册完成后的值即默认值（load() 在 onLayoutReady 才覆盖）——快照供「恢复默认」
    this.settingDefaults = new Map([...this.settingUtils.settings].map(([k, item]) => [k, item.value]));

    this.eventBus.on("click-blockicon", this.boundBlockIcon);
  }

  async onLayoutReady() {
    await this.settingUtils.load();
    try {
      this.examApp = await createExamApp(this);
    } catch (e) {
      console.error("[lv-exam] app init failed", e);
    }
    this.refreshDock();
    this.refreshStatusBar();
    this.restoreLastTabs();
    // 48-05：雷切组件面板接入（有界重试；未安装安静降级）
    if (this.examApp) {
      this.speedSwitchHandle = registerExamDailySummary({
        app: this.examApp,
        t: (k, fb) => this.i18n[k] ?? fb ?? k,
        open: () => this.openPractice(),
        findPlugin: (name) => (this.app as any)?.plugins?.find?.((p: { name: string }) => p.name === name),
      });
    }
    // 47-04/48-06 lite：window.siyuanExam 公开 API（稳定命令入口 + 按需脱敏统计快照）
    this.exposePublicApi();
    // 版本更新引导 lite（TODO 23）：版本变化时提示查看 CHANGELOG
    const K = "lv-exam-last-version";
    const last = localStorage.getItem(K);
    const ver = manifest.version;
    if (last && last !== ver) {
      showMessage(`${this.i18n["update.title"]} v${ver} · ${this.i18n["update.seeChangelog"]}`, 6000, "info");
    }
    localStorage.setItem(K, ver);
    this.dispatchPublicStats();
  }

  /** 47-04/48-06 lite：window.siyuanExam——open/practice/wrongbook 稳定入口 + stats.read 按需快照。
   *  脱敏红线与 lv-exam:stats 相同（无题干/答案/key/路径）；stats 按需重算，迟到消费者不再依赖启动广播 */
  private exposePublicApi() {
    (window as any).siyuanExam = {
      version: manifest.version,
      open: () => this.openPractice(),
      practice: () => this.openPractice(),
      wrongbook: () => this.openWrongbook(),
      mock: () => this.openMock(),
      report: () => this.openReport(),
      stats: () => {
        if (!this.examApp) return null;
        // 动态加载 publicStats（与广播同一脱敏构建器，单一定义源）
        // 同步约束：构建器为纯函数，走 pending import 后回调返回不现实 → 缓存最近一次广播快照
        return (this as any).lastPublicStats ?? null;
      },
      /** stats.read 异步形态（推荐）：Promise 脱敏快照 */
      statsRead: async (): Promise<unknown> => {
        if (!this.examApp) return null;
        const m = await import("@/core/publicStats");
        const d = this.examApp.derived();
        return m.buildPublicStats(d, this.examApp.attempts.all(), streak(d));
      },
    };
  }

  private speedSwitchHandle: { dispose: () => void } | null = null;

  /** 对外只读数据接口（TODO 21/24 组）：lv-exam:stats 广播（脱敏聚合，无题目内容） */
  private dispatchPublicStats() {
    if (!this.examApp) return;
    try {
      import("@/core/publicStats").then((m) => {
        const d = this.examApp!.derived();
        const snapshot = m.buildPublicStats(d, this.examApp!.attempts.all(), streak(d)) as unknown as Record<
          string,
          unknown
        >;
        (this as any).lastPublicStats = snapshot; // window.siyuanExam.stats() 的同步缓存
        // 48-02 lite：总线形态（信封 v1，新消费者推荐）；legacy 裸 detail 同时保留（旧消费者兼容）
        emitExamEvent("stats", snapshot);
        window.dispatchEvent(
          new CustomEvent("lv-exam:stats", {
            detail: snapshot,
          }),
        );
      });
    } catch {
      /* 统计失败不影响主流程 */
    }
  }

  async onunload() {
    this.eventBus.off("click-blockicon", this.boundBlockIcon);
    // 48-05：雷切组件注销（注册/注销配对；重试定时器一并清理）
    this.speedSwitchHandle?.dispose();
    this.speedSwitchHandle = null;
    delete (window as any).siyuanExam; // 47-04/48-06：公开 API 随插件卸载（无孤儿全局）
    // 37-02 卸载顺序：先最终落盘（此时 dirty 仍在），再 dispose 清定时器——
    // 反过来 dispose 先清 dirty 会让随后的 flush 变成空操作，未落盘事件全部丢失
    try {
      await this.examApp?.flush();
    } catch {
      /* 尽力而为：失败时 dirty 由 dispose 收尾，不阻塞卸载 */
    }
    try {
      this.examApp?.attempts.dispose();
    } catch {
      /* 卸载栅栏：防卸载后仍触发 saveData */
    }
    Object.values(this.tabApps).forEach((instance) => unmount(instance));
    this.tabApps = {};
  }

  /** 顶栏主入口（25-P1 首用可发现性）：此前插件仅有 Dock/状态栏/命令面板等隐蔽入口，
   *  新装用户找不到进入方式；顶栏按钮是最醒目的一级入口。移动端无顶栏，维持块菜单+命令。 */
  private registerTopBar() {
    this.addTopBar({
      icon: "iconExam",
      title: this.i18n["tab.practice"],
      callback: () => this.openPractice(),
    });
  }

  /** 状态栏迷你进度（TODO 18 组）：今日完成/连胜，点击打开练习台 */
  private registerStatusBar() {
    this.addStatusBar({
      element: (() => {
        const el = document.createElement("div");
        el.classList.add("lv-statusbar", "fn__flex-center");
        el.style.cursor = "pointer";
        // 25-P1：应用就绪前也保持可见占位（此前初始为空文本，元素不可见）
        el.textContent = "📝 …";
        el.title = this.i18n["tab.practice"];
        el.addEventListener("click", () => this.openPractice());
        return el;
      })(),
    });
  }

  refreshStatusBar() {
    if (this.isMobile) return;
    const el = document.querySelector(".lv-statusbar");
    if (!el) return;
    if (!this.examApp) {
      el.textContent = "📝 …"; // 初始化失败：保持占位不空白（25-P1）
      return;
    }
    const d = this.examApp.derived();
    const todayKey = (() => {
      const t = new Date();
      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    })();
    const today = d.days.get(todayKey)?.attempts ?? 0;
    const wrong = this.examApp.wrongItems().length;
    el.textContent = `📝 ${today} · ❌ ${wrong} · 🔥 ${streak(d)}`;
  }

  private registerTabs() {
    // 页签工厂闭包持有运行时实例；custom.data 会被思源保存布局并 JSON 序列化，
    // 因此不能把 Plugin / ExamApp 放进其中（Plugin.app.plugins 会形成循环引用）。
    const getPlugin = () => this;
    const tabs: Array<[string, any]> = [
      [TAB_PRACTICE, PracticeTab],
      [TAB_MOCK, MockTab],
      [TAB_REPORT, ReportTab],
    ];
    for (const [type, component] of tabs) {
      this.addTab({
        type,
        init() {
          const el = document.createElement("div");
          el.classList.add("fn__flex-1", "lv-exam-tab");
          const plugin = getPlugin();
          const instance = mount(component, {
            target: el,
            props: { plugin, examApp: plugin.examApp },
          });
          plugin.tabApps[type] = instance;
          this.element.appendChild(el);
        },
        destroy() {
          const plugin = getPlugin();
          if (plugin.tabApps[type]) {
            unmount(plugin.tabApps[type]);
            delete plugin.tabApps[type];
          }
        },
      });
    }
  }

  private registerDock() {
    this.addDock({
      config: {
        position: "RightBottom",
        size: { width: 260, height: 0 },
        icon: "iconWrongbook",
        title: this.i18n["dock.wrongbook"],
        hotkey: "⌥⌘E",
      },
      data: { plugin: this },
      type: DOCK_WRONGBOOK,
      init() {
        this.element.innerHTML = `<div class="fn__flex-1 lv-dock-body"></div>`;
        // Dock 面板懒创建：onload 时的 refreshDock 查不到 .lv-dock-body 直接 return，
        // 首次打开会渲染成空白面板（真机走查实测）——创建后主动渲染一次
        const plugin = (this.data as { plugin?: LvExamPlugin }).plugin;
        queueMicrotask(() => plugin?.refreshDock());
      },
      update() {
        (this.data as { plugin?: LvExamPlugin }).plugin?.refreshDock();
      },
      destroy() {},
    });
  }

  /** 错题 Dock 实数据渲染（作答后由 Tab 调用） */
  refreshDock() {
    if (this.isMobile) return;
    const dockEl = document.querySelector<HTMLElement>(".lv-dock-body");
    if (!dockEl) return;
    // 25-P1：应用未就绪（初始化失败）时给出可见原因，不再渲染空白面板
    if (!this.examApp) {
      dockEl.innerHTML = `<div class="lv-dock-empty">${escapeHtml(this.i18n["state.appNotReady"])}</div>`;
      return;
    }
    const items = this.examApp.wrongItems();
    // sanitize 政策（26.2 P0）：innerHTML 插值的动态文本一律 escapeHtml（qid 来自本地流水，纵深防御）
    const rows = items
      .slice(0, 30)
      .map(
        (w) =>
          `<div class="lv-dock-row" data-qid="${escapeHtml(w.qid)}">
                <span class="num">${escapeHtml(w.qid)}</span>
                <span>${this.i18n["dock.wrongTag"]} ${w.wrongCount}</span>
                <button class="lv-dock-act" data-act="mastered" data-qid="${escapeHtml(w.qid)}" title="${escapeHtml(this.i18n["dock.actMastered"])}">✓</button>
                <button class="lv-dock-act" data-act="removed" data-qid="${escapeHtml(w.qid)}" title="${escapeHtml(this.i18n["dock.actRemoved"])}">✕</button>
                <button class="lv-dock-act" data-act="snooze" data-qid="${escapeHtml(w.qid)}" title="${escapeHtml(this.i18n["dock.actSnooze"])}">⏸</button>
            </div>`,
      )
      .join("");
    dockEl.innerHTML = `
<div class="block__icons" style="padding:4px 8px">
    <div class="block__logo">${this.i18n["dock.wrongbook"]}</div>
    <span class="fn__flex-1"></span>
    <span class="lv-chip lv-chip--red num">${items.length}</span>
</div>
<div class="lv-dock-list">
${items.length ? rows + `<div class="lv-dock-hint">${this.i18n["dock.eliminatedHint"]}</div>` : `<div class="lv-dock-empty">${this.i18n["dock.empty"]}<br/><button class="lv-btn sm lv-dock-go" style="margin-top:8px">${this.i18n["dock.goPractice"]}</button></div>`}
</div>`;
    // 空态按钮：打开练习台
    dockEl.querySelector<HTMLButtonElement>(".lv-dock-go")?.addEventListener("click", () => this.openPractice());
    // 事件委托：手动处置（覆盖层由 examApp.setWrongStatus 持久化）；snooze=暂缓 7 天（52-06）
    dockEl.querySelectorAll<HTMLButtonElement>(".lv-dock-act").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const qid = btn.dataset.qid!;
        if (btn.dataset.act === "snooze") await this.examApp?.snoozeWrong(qid, 7);
        else await this.examApp?.setWrongStatus(qid, btn.dataset.act as "mastered" | "removed");
        this.refreshDock();
        this.refreshStatusBar();
      });
    });
    // 行点击 → 直达该题练习（经 pendingPractice 通道移交练习台）
    dockEl.querySelectorAll<HTMLDivElement>(".lv-dock-row").forEach((row) => {
      row.addEventListener("click", () => {
        const qid = row.dataset.qid!;
        (this as any).pendingQuestionId = qid;
        (this as any).pendingPracticeSignal = true;
        emitExamEvent("open-question", { qid });
        this.openPractice();
      });
    });
  }

  private registerCommands() {
    this.addCommand({
      langKey: "command.openPractice",
      hotkey: adaptHotkey("⌥⌘P"),
      callback: () => this.openPractice(),
    });
    this.addCommand({
      langKey: "command.openMock",
      hotkey: adaptHotkey("⌥⌘M"),
      callback: () => this.openMock(),
    });
    this.addCommand({
      langKey: "command.openReport",
      hotkey: adaptHotkey("⌥⌘R"),
      callback: () => this.openReport(),
    });
    this.addCommand({
      langKey: "command.openWrongbook",
      hotkey: adaptHotkey("⌥⌘E"),
      // 桌面端 Dock 由思源侧边栏开关管理；此命令在移动端/快捷键场景直达错题本
      callback: () => this.openWrongbook(),
    });
    this.addCommand({
      langKey: "command.resetSettings",
      // 47-05 lite：恢复默认设置（逐项写回注册时快照的默认值并持久化）
      callback: async () => {
        for (const [key, def] of this.settingDefaults) {
          if (key === "aiKey") continue; // AI Key 兜底副本不在恢复范围（防误清密钥；密钥库主副本本就不在此）
          this.settingUtils.set(key, def);
        }
        await this.settingUtils.save();
        showMessage(this.i18n["setting.resetDone"], 4000, "info");
      },
    });
    this.addCommand({
      langKey: "command.resetOnboarding",
      // 25-P1：首用引导可跳过、可重置（清 47-02 的 localStorage 标记，重开练习台即再见）
      callback: () => {
        try {
          localStorage.removeItem("lv-exam-onboarded");
        } catch {
          /* 忽略 */
        }
        showMessage(this.i18n["onboard.resetDone"], 3200, "info");
      },
    });
  }

  /** 恢复上次打开的页签（onLayoutReady：宿主布局恢复不包含插件自定义页签） */
  private restoreLastTabs() {
    if (this.isMobile) return;
    try {
      const type = localStorage.getItem(OPEN_TABS_KEY) ?? "";
      if (type === TAB_PRACTICE) this.openPractice();
      else if (type === TAB_MOCK) this.openMock();
      else if (type === TAB_REPORT) this.openReport();
    } catch {
      /* localStorage 不可用（隐私模式）：跳过恢复 */
    }
  }

  private openTabByType(type: string, icon: string, title: string) {
    // 单例聚焦（26.2）：同类型 Tab 已开则切换过去，避免 tabApps 覆盖引用
    const existing = (this.getOpenedTab()[type] ?? [])[0] as any;
    if (existing) {
      const tab = existing.parent;
      if (tab?.switchTab) tab.switchTab(existing.headElement);
      else existing.headElement?.click?.();
      rememberOpenTab(type);
      return;
    }
    rememberOpenTab(type);
    openTab({
      app: this.app as any,
      // 宿主以 plugin.name + type 为键查找页签工厂；descriptor 只含可持久化字段。
      custom: createExamTabDescriptor(this.name, type, icon, title),
    });
  }

  private onBlockIconClick({ detail }: any) {
    if (!detail?.menu) {
      return;
    }
    // 查询圈题（v0.2）：查询嵌入块 → 用此查询开始练习
    const el = detail.blockElements?.[0];
    if (el?.getAttribute?.("data-type") === "query_embed" && this.examApp) {
      // 3.8.5 实测：query_embed 的 content 为空、无 data-query 属性，SQL 只在 kramdown 的 {{...}} 内
      let stmt = el.getAttribute("data-query") || (el.textContent ?? "").trim();
      detail.menu.addItem({
        iconHTML: "<svg><use xlink:href='#iconExam'></use></svg>",
        label: this.i18n["blockMenu.queryPractice"],
        click: async () => {
          try {
            const bank = this.examApp!.listBanks()[0];
            if (!bank) {
              showMessage(this.i18n["guard.needBankFirst"], 3600, "error");
              return;
            }
            if (!stmt) {
              const blockId = el.getAttribute("data-node-id") || el.dataset?.nodeId || "";
              if (blockId) {
                const kd = await this.examApp!.deps.client.getBlockKramdown(blockId);
                stmt = (kd.match(/\{\{([\s\S]*?)\}\}/)?.[1] ?? "").trim();
              }
            }
            if (!stmt) {
              showMessage(this.i18n["query.empty"], 3600, "info");
              return;
            }
            const qs = await this.examApp!.queryQuestions(bank.id, stmt);
            if (!qs.length) {
              showMessage(this.i18n["query.empty"], 3600, "info");
              return;
            }
            (this as any).pendingPractice = qs;
            (this as any).pendingPracticeBankId = bank.id;
            emitExamEvent("open-practice-questions", { qids: qs.map((q) => q.id), bank: bank.id });
            this.openPractice();
          } catch (e) {
            showMessage(String(e instanceof Error ? e.message : e), 4800, "error");
          }
        },
      });
      return;
    }
    // 块菜单直通（TODO 2.2 真实化）：题目块 → 加入练习集 / 转卡 / 标记考点 / 编辑 / 在练习台打开
    const blockId = el?.getAttribute?.("data-node-id") || el?.dataset?.nodeId || "";
    if (blockId && this.examApp) {
      const exam = this.examApp;
      detail.menu.addItem({
        iconHTML: "<svg><use xlink:href='#iconExam'></use></svg>",
        label: this.i18n["blockMenu.addToPractice"],
        click: async () => {
          try {
            const hit = await exam.findQuestionByBlock(blockId);
            if (!hit) {
              showMessage(
                this.examApp!.kernelOnline ? this.i18n["query.empty"] : this.i18n["state.offlineHint"],
                3600,
                "info",
              );
              return;
            }
            (this as any).pendingPractice = [hit.q];
            (this as any).pendingPracticeBankId = hit.bank.id;
            emitExamEvent("open-practice-questions", { qids: [hit.q.id], bank: hit.bank.id });
            this.openPractice();
          } catch (e) {
            showMessage(String(e instanceof Error ? e.message : e), 4800, "error");
          }
        },
      });
      detail.menu.addItem({
        iconHTML: "<svg><use xlink:href='#iconExam'></use></svg>",
        label: this.i18n["blockMenu.toCard"],
        click: async () => {
          try {
            const hit = await exam.findQuestionByBlock(blockId);
            if (!hit) {
              showMessage(
                this.examApp!.kernelOnline ? this.i18n["memory.toCardMissing"] : this.i18n["state.offlineHint"],
                3600,
                "info",
              );
              return;
            }
            const n = await exam.convertToCards(hit.bank.id, hit.bank.name, [hit.q]);
            showMessage(
              n ? `${this.i18n["memory.toCardDone"]} ${n}` : this.i18n["memory.toCardMissing"],
              3200,
              n ? "info" : "error",
            );
          } catch (e) {
            showMessage(String(e instanceof Error ? e.message : e), 4800, "error");
          }
        },
      });
      // 标记考点（2.2）：输入框直通 setExamAttrs（SaveGate 过闸），空值=清除
      detail.menu.addItem({
        iconHTML: "<svg><use xlink:href='#iconExam'></use></svg>",
        label: this.i18n["blockMenu.markKp"],
        click: async () => {
          try {
            const hit = await exam.findQuestionByBlock(blockId);
            if (!hit) {
              showMessage(
                this.examApp!.kernelOnline ? this.i18n["query.empty"] : this.i18n["state.offlineHint"],
                3600,
                "info",
              );
              return;
            }
            const { inputDialogSync } = await import("./libs/dialog");
            const kp = (
              await inputDialogSync({
                title: this.i18n["blockMenu.markKp"],
                placeholder: this.i18n["blockMenu.markKpPlaceholder"],
                defaultText: hit.q.kp ?? "",
              })
            )?.trim();
            if (kp == null) return; // 用户取消
            await exam.markQuestionKp(hit.q, kp);
            showMessage(
              kp ? `${this.i18n["blockMenu.markKpDone"]} ${kp}` : this.i18n["blockMenu.markKpCleared"],
              2800,
              "info",
            );
          } catch (e) {
            showMessage(String(e instanceof Error ? e.message : e), 4800, "error");
          }
        },
      });
      // 编辑 / 在练习台打开（2.2）：移交练习台浏览视图聚焦（qid+bankId；已开 Tab 经窗口事件补齐）
      detail.menu.addItem({
        iconHTML: "<svg><use xlink:href='#iconExam'></use></svg>",
        label: this.i18n["blockMenu.edit"],
        click: async () => {
          const hit = await exam.findQuestionByBlock(blockId).catch(() => null);
          if (!hit) {
            showMessage(
              this.examApp!.kernelOnline ? this.i18n["query.empty"] : this.i18n["state.offlineHint"],
              3600,
              "info",
            );
            return;
          }
          (this as any).pendingEditQid = hit.q.id;
          (this as any).pendingEditBank = hit.bank.id;
          emitExamEvent("edit-question", { qid: hit.q.id, bank: hit.bank.id });
          this.openPractice();
        },
      });
      detail.menu.addItem({
        iconHTML: "<svg><use xlink:href='#iconExam'></use></svg>",
        label: this.i18n["blockMenu.openInBrowse"],
        click: async () => {
          const hit = await exam.findQuestionByBlock(blockId).catch(() => null);
          if (!hit) {
            showMessage(
              this.examApp!.kernelOnline ? this.i18n["query.empty"] : this.i18n["state.offlineHint"],
              3600,
              "info",
            );
            return;
          }
          (this as any).pendingBrowseQid = hit.q.id;
          (this as any).pendingBrowseBank = hit.bank.id;
          emitExamEvent("open-in-browse", { qid: hit.q.id, bank: hit.bank.id });
          this.openPractice();
        },
      });
      return;
    }
    // 兜底项（25-P1 移动端入口）：移动端无顶栏/Dock/状态栏，块菜单是唯一稳定入口——
    // 点击直接打开练习台（应用未就绪时练习台会显示 appNotReady 原因，不再死胡同）
    detail.menu.addItem({
      iconHTML: "<svg><use xlink:href='#iconExam'></use></svg>",
      label: this.i18n["blockMenu.addToPractice"],
      click: () => {
        this.openPractice();
      },
    });
  }

  openPractice() {
    this.openTabByType(TAB_PRACTICE, "iconExam", this.i18n["tab.practice"]);
  }
  private openWrongbook() {
    // 总线处理已打开的练习台；待处理视图补足首次打开时尚无订阅者的情况。
    (this as any).pendingInitialView = "wrongbook";
    emitExamEvent("open-view", { view: "wrongbook" });
    this.openPractice();
  }
  openMock() {
    this.openTabByType(TAB_MOCK, "iconMock", this.i18n["tab.mock"]);
  }
  openReport() {
    this.openTabByType(TAB_REPORT, "iconReport", this.i18n["tab.report"]);
  }
}
