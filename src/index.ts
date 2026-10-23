import { Plugin, openTab, showMessage, getFrontend, adaptHotkey, type Menu } from "siyuan";
import "./index.scss";

import { SettingUtils } from "./libs/setting-utils";
import { mount, unmount, type Component } from "svelte";
import manifest from "../plugin.json";
import PracticeTab from "@/ui/practice/PracticeTab.svelte";
import MockTab from "@/ui/mock/MockTab.svelte";
import ReportTab from "@/ui/report/ReportTab.svelte";
import { createExamApp } from "./app-runtime";
import type { ExamApp } from "./app";
import { streak } from "./core/replayer";
import { emitExamEvent } from "./core/bus";
import { createExamTabDescriptor, findExamTabHeader, findOpenedExamTab, focusExamTab, observeTabOpen, openPracticeView, type ExamPluginLike, type PracticeViewRequest } from "./core/pluginTab";
import { combineBlockSources } from "./core/blockSource";
import { registerExamDailySummary } from "./ecosystem/speedSwitch";
import { TabAppRegistry } from "./core/tabAppRegistry";
import { mountLvExamBridge } from "./core/examBridge";
import type { Question } from "./core/types";

const TAB_PRACTICE = "exam-practice";
const TAB_MOCK = "exam-mock";
const TAB_REPORT = "exam-report";

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

export default class LvExamPlugin extends Plugin implements ExamPluginLike {
  /** siyuan 1.2.9 将基类 i18n 宽化为 Record<string, JSONValue>；本项目 i18n 文件为平铺
   *  string→string（scripts/check-i18n.mjs 强制非空字符串），此处收窄回字符串字典 */
  declare i18n: Record<string, string>;
  lastPublicStats: Record<string, unknown> | null = null;
  pendingPractice?: Question[];
  pendingPracticeBankId?: string;
  pendingEditQid?: string;
  pendingEditBank?: string;
  pendingBrowseQid?: string;
  pendingBrowseBank?: string;
  pendingInitialView?: string;
  pendingQuestionId?: string;
  pendingPracticeView?: PracticeViewRequest;
  practiceViewRequestId?: string;
  private isMobile: boolean;
  settingUtils: SettingUtils;
  isUnloaded = false;
  /** 每个宿主 Custom 模型独立持有实例；同 type 不是唯一页签身份。 */
  private tabApps = new TabAppRegistry();
  /** 应用组装层（与基类 Plugin.app: App 无关，刻意改名避免遮蔽） */
  examApp: ExamApp | null = null;
  private appInitializing = true;
  private queuedTab: { type: string; icon: string; title: string } | null = null;
  private openingTabs = new Set<string>();
  private boundBlockIcon = this.onBlockIconClick.bind(this);
  private boundImageMenu = this.onImageMenu.bind(this);
  private boundFlashcardAction = this.onFlashcardAction.bind(this);
  /** 47-05 lite：设置默认值快照（注册完成时；恢复默认用） */
  private settingDefaults: Map<string, unknown> = new Map();
  /** Epoch 6：服务桥注销句柄 */
  private disposeLvExamBridge?: () => void;
  /** Epoch 6：闪卡事件监听器 */
  private cardsReviewedHandler?: () => void;

  async onload() {
    this.isMobile = getFrontend() === "mobile" || getFrontend() === "browser-mobile";

    this.addIcons(`
<symbol id="iconExam" viewBox="0 0 32 32">
  <path d="M11 5h9c1.7 0 3 1.3 3 3v13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-opacity="0.4"/>
  <rect x="6" y="8" width="16" height="19" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"/>
  <path d="M10 13h5M10 16h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-opacity="0.5"/>
  <path d="m9.5 21 2.5 2.5 5.5-5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="22.5" cy="24" r="3" fill="currentColor"/>
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
      onSaveError: (error) => {
        showMessage((this.i18n["setting.saveFailed"] ?? "设置保存失败；输入已保留，重新打开插件设置后可再次保存。") + " " + String(error instanceof Error ? error.message : error), 6000, "error");
      },
    });
    this.settingUtils.addItem({
      title: this.i18n["setting.examDate.title"],
      description: this.i18n["setting.examDate.desc"],
      type: "textinput",
      key: "examDate",
      value: "",
      placeholder: "YYYY-MM-DD",
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
      type: "select",
      key: "feedbackTiming",
      value: "immediate",
      options: {
        immediate: this.i18n["setting.feedbackTiming.immediate"],
        group: this.i18n["setting.feedbackTiming.group"],
        end: this.i18n["setting.feedbackTiming.end"],
      },
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
    }
    this.registerCommands();
    // 47-05 lite：注册完成后的值即默认值（load() 在 onLayoutReady 才覆盖）——快照供「恢复默认」
    this.settingDefaults = new Map([...this.settingUtils.settings].map(([k, item]) => [k, item.value]));

    this.eventBus.on("click-blockicon", this.boundBlockIcon);
    this.eventBus.on("open-menu-image", this.boundImageMenu);
    this.eventBus.on("click-flashcard-action", this.boundFlashcardAction);
  }

  /**
   * 官方 Petal Lifecycle 核心契约：
   * 收到数据变更（sync 跨端同步 / overwrite 其他实例写入）时触发。
   * 覆盖此方法以防止思源官方采取默认策略暴力重载整个插件（导致正在进行的考试/刷题中断）。
   */
  async onDataChanged(_reason?: import("siyuan").TPluginDataChangeReason): Promise<void> {
    try {
      this.examApp?.invalidate();
      emitExamEvent("bank-changed", { bank: this.pendingPracticeBankId || "" });
      this.dispatchPublicStats();
    } catch (e) {
      console.warn("[LvExam] onDataChanged handling warning:", e);
    }
  }

  async onLayoutReady() {
    try {
      await this.settingUtils.load();
    } catch (e) {
      // A corrupt/blocked settings file must not prevent the exam app from
      // starting with shipped defaults. SettingUtils keeps invalid fields at
      // their defaults; this catch covers host I/O failures.
      console.error("[LvExam] settings load failed; using defaults", e);
      showMessage(this.i18n["setting.loadFailed"] ?? "设置读取失败，已使用默认值；请检查存储权限后重试。", 5200, "error");
    }
    try {
      this.examApp = await createExamApp(this);
      emitExamEvent("app-ready", { ready: true });
    } catch (e) {
      console.error("[LvExam] app init failed", e);
      showMessage(String(e instanceof Error ? e.message : e), 5200, "error");
    }
    this.appInitializing = false;
    const queued = this.queuedTab;
    this.queuedTab = null;
    if (queued) {
      // Honor a command or deep link that arrived while the app was starting.
      // The topbar still queues practice, while mock/report commands must not
      // be immediately overridden by the default workbench fallback.
      this.openTabByType(queued.type, queued.icon, queued.title);
    } else {
      // The sole visible plugin entry always opens the exam workbench. Internal
      // Mock/Report views remain reachable from the workbench Rail and commands.
      this.openPractice();
    }
    // 48-05：雷切组件面板接入（有界重试；未安装安静降级）
    if (this.examApp) {
      this.speedSwitchHandle = registerExamDailySummary({
        app: this.examApp,
        t: (k, fb) => this.i18n[k] ?? fb ?? k,
        open: () => this.openPractice(),
        dailyGoal: () => Math.max(1, Number(this.settingUtils?.get?.("dailyGoal") ?? 10) || 10),
        findPlugin: (name) => (this.app as unknown as { plugins?: Array<{ name: string }> })?.plugins?.find?.((p) => p.name === name),
      });
    }
    // 47-04/48-06/Epoch 6：挂载考试服务桥公开 API（多别名 + 稳定命令入口 + 按需脱敏统计快照 + 概览）
    this.disposeLvExamBridge = mountLvExamBridge({
      version: manifest.version,
      openPractice: () => this.openPractice(),
      openWrongbook: () => this.openWrongbook(),
      openMock: () => this.openMock(),
      openReport: () => this.openReport(),
      getStats: () => {
        if (!this.examApp) return null;
        return this.lastPublicStats ?? null;
      },
      statsRead: async (): Promise<unknown> => {
        if (!this.examApp) return null;
        const m = await import("@/core/publicStats");
        const d = this.examApp.derived();
        return m.buildPublicStats(d, this.examApp.attempts.all(), streak(d));
      },
      onBridgeDisposed: () => {
        this.disposeLvExamBridge = undefined;
      },
    });

    // Epoch 6：监听闪卡学习完成事件（刷新跨插件学习统计）
    this.cardsReviewedHandler = () => {
      this.dispatchPublicStats();
    };
    window.addEventListener("lv-cards:reviewed", this.cardsReviewedHandler);

    // 版本更新引导 lite（TODO 23）：版本变化时提示查看 CHANGELOG
    const K = "lv-exam-last-version";
    try {
      const last = localStorage.getItem(K);
      const ver = manifest.version;
      if (last && last !== ver) {
        showMessage(`${this.i18n["update.title"]} v${ver} · ${this.i18n["update.seeChangelog"]}`, 6000, "info");
      }
      localStorage.setItem(K, ver);
    } catch {
      // 本地记忆不可用时仍完成插件就绪与统计广播。
    }
    this.dispatchPublicStats();
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
        this.lastPublicStats = snapshot; // window.siyuanExam.stats() 的同步缓存
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
    this.isUnloaded = true;
    this.eventBus.off("click-blockicon", this.boundBlockIcon);
    this.eventBus.off("open-menu-image", this.boundImageMenu);
    this.eventBus.off("click-flashcard-action", this.boundFlashcardAction);
    // 48-05：雷切组件注销（注册/注销配对；重试定时器一并清理）
    this.speedSwitchHandle?.dispose();
    this.speedSwitchHandle = null;
    if (this.cardsReviewedHandler) {
      window.removeEventListener("lv-cards:reviewed", this.cardsReviewedHandler);
      this.cardsReviewedHandler = undefined;
    }
    // 47-04/48-06/Epoch 6：公开 API 随插件卸载（多别名安全移除，无孤儿全局）
    if (this.disposeLvExamBridge) {
      this.disposeLvExamBridge();
      this.disposeLvExamBridge = undefined;
    } else {
      const w = window as unknown as Record<string, unknown>;
      delete w.LvExam;
      delete w.siyuanExam;
      delete w.xiaolvExam;
      delete w.lvExam;
    }
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
    try {
      await this.tabApps.clear((instance) => unmount(instance));
    } catch (error) {
      console.error("[LvExam] failed to unmount tabs during unload", error);
    }
  }

  /** 唯一顶栏入口：点击后直接进入小驴考试主页面。 */
  private registerTopBar() {
    this.addTopBar({
      icon: "iconExam",
      title: manifest.displayName["zh-CN"] ?? "小驴考试（内测版）",
      callback: () => this.openPractice(),
    });
  }

  private registerTabs() {
    // 页签工厂闭包持有运行时实例；custom.data 会被思源保存布局并 JSON 序列化，
    // 因此不能把 Plugin / ExamApp 放进其中（Plugin.app.plugins 会形成循环引用）。
    const getPlugin = () => this;
    type ExamTabProps = { plugin: LvExamPlugin; examApp: ExamApp | null };
    type ExamTabComponent = Component<ExamTabProps>;
    const tabs: Array<[string, ExamTabComponent]> = [
      [TAB_PRACTICE, PracticeTab],
      [TAB_MOCK, MockTab],
      [TAB_REPORT, ReportTab],
    ];
    for (const [type, component] of tabs) {
      this.addTab({
        type,
        init() {
          const plugin = getPlugin();
          if (plugin.tabApps.has(this)) return;
          if (this.element instanceof HTMLElement) {
            this.element.style.height = "100%";
            this.element.style.display = "flex";
            this.element.style.flexDirection = "column";
          }
          const el = document.createElement("div");
          el.classList.add("fn__flex-1", "lv-exam-tab");
          el.style.height = "100%";
          this.element.appendChild(el);
          const instance = mount(component, {
            target: el,
            props: { plugin, examApp: plugin.examApp },
          });
          plugin.tabApps.set(this, instance);
        },
        destroy() {
          const plugin = getPlugin();
          void plugin.tabApps.destroy(this, (instance) => unmount(instance)).catch((error) => {
            console.error(`[LvExam] failed to unmount tab: ${type}`, error);
          });
        },
      });
    }
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
      // 快捷键与移动端命令面板直达错题本
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
        try {
          await this.settingUtils.save();
          showMessage(this.i18n["setting.resetDone"], 4000, "info");
        } catch (e) {
          showMessage((this.i18n["setting.saveFailed"] ?? "设置保存失败；输入已保留，重新打开插件设置后可再次保存。") + " " + String(e instanceof Error ? e.message : e), 6000, "error");
        }
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

  private openTabByType(type: string, icon: string, title: string): boolean {
    // 早于应用就绪的点击延后执行，避免把 null app 固定传入永久报错的页签。
    if (this.appInitializing) {
      this.queuedTab = { type, icon, title };
      showMessage(this.i18n["state.initializing"] ?? "正在初始化小驴考试，完成后自动打开…", 2400, "info");
      return false;
    }
    // 单例聚焦（26.2）：同类型 Tab 已开则切换过去，避免 tabApps 覆盖引用
    // Layout restoration may expose getOpenedTab under either the short tab
    // type or the persisted custom id. Search both forms before opening a new
    // tab; otherwise every plugin restart can append another practice tab.
    const existing = findOpenedExamTab(this.getOpenedTab(), this.name, type);
    if (existing && focusExamTab(existing)) {
      rememberOpenTab(type);
      return true;
    }
    // During startup the restored Custom model can lag behind its DOM header.
    // Focus that header when present instead of appending a duplicate tab.
    const restoredHeader = findExamTabHeader(this.name, type);
    if (restoredHeader) {
      restoredHeader.click();
      rememberOpenTab(type);
      return true;
    }
    if (this.openingTabs.has(type)) {
      showMessage(this.i18n["state.openTabOpening"] ?? "练习台正在打开，请稍候…", 1800, "info");
      return false;
    }
    this.openingTabs.add(type);
    observeTabOpen(
      () => openTab({
        app: this.app,
        // 宿主以 plugin.name + type 为键查找页签工厂；descriptor 只含可持久化字段。
        custom: createExamTabDescriptor(this.name, type, icon, title),
      }),
      () => {
        this.openingTabs.delete(type);
        rememberOpenTab(type);
      },
      (error) => {
        console.error(`[LvExam] failed to open tab: ${type}`, error);
        this.openingTabs.delete(type);
        const reason = String(error instanceof Error ? error.message : error);
        showMessage(
          (this.i18n["state.openTabFailed"] ?? "无法打开插件页签，请重试。") + ` ${reason}`,
          6000,
          "error",
        );
      },
    );
    return false;
  }

  private onBlockIconClick({ detail }: { detail?: { menu?: Menu; blockElements?: HTMLElement[] } }) {
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
            this.pendingPractice = qs;
            this.pendingPracticeBankId = bank.id;
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
      const blockTitle = (el?.getAttribute?.("aria-label") || el?.getAttribute?.("data-type") || "当前块").trim();
      // RecallGen-inspired entry: use the selected ordinary block as AI material.
      // Only keep the stable ID in this callback; DOM/plugin objects must never
      // cross the tab request or be persisted by the host.
      detail.menu.addItem({
        iconHTML: "<svg><use xlink:href='#iconExam'></use></svg>",
        label: this.i18n["blockMenu.generateFromBlock"],
        click: async () => {
          if (!exam.kernelOnline) {
            showMessage(this.i18n["state.offlineHint"], 3600, "error");
            return;
          }
          const bank = exam.listBanks()[0];
          if (!bank) {
            showMessage(this.i18n["guard.needBankFirst"], 3600, "error");
            return;
          }
          try {
            const kramdown = await exam.deps.client.getBlockKramdown(blockId);
            const source = combineBlockSources([kramdown]);
            if (!source.text) {
              showMessage(this.i18n["blockMenu.blockSourceEmpty"], 3600, "info");
              return;
            }
            openPracticeView(this, "ai", {
              bankId: bank.id,
              sourceText: source.text,
              sourceTitle: blockTitle,
              sourceKind: "block",
              sourceTruncated: source.truncated,
            });
            if (source.truncated) {
              showMessage(this.i18n["blockMenu.blockSourceTruncated"].replace("{n}", String(source.text.length)), 4200, "info");
            }
          } catch (e) {
            const message = String(e instanceof Error ? e.message : e);
            showMessage(this.i18n["blockMenu.blockSourceFailed"].replace("{message}", message), 4800, "error");
          }
        },
      });
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
            this.pendingPractice = [hit.q];
            this.pendingPracticeBankId = hit.bank.id;
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
          this.pendingEditQid = hit.q.id;
          this.pendingEditBank = hit.bank.id;
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
          this.pendingBrowseQid = hit.q.id;
          this.pendingBrowseBank = hit.bank.id;
          emitExamEvent("open-in-browse", { qid: hit.q.id, bank: hit.bank.id });
          this.openPractice();
        },
      });
      return;
    }
    // 兜底项（25-P1 移动端入口）：移动端没有插件顶栏按钮，块菜单是稳定入口——
    // 点击直接打开练习台（应用未就绪时练习台会显示 appNotReady 原因，不再死胡同）
    detail.menu.addItem({
      iconHTML: "<svg><use xlink:href='#iconExam'></use></svg>",
      label: this.i18n["blockMenu.addToPractice"],
      click: () => {
        this.openPractice();
      },
    });
  }

  private onImageMenu({ detail }: { detail?: { menu?: Menu; element?: HTMLElement } }) {
    if (!detail?.menu || !detail?.element) return;
    const img = detail.element;
    const src = img.getAttribute("data-src") || img.getAttribute("src") || "";
    if (!src) return;

    detail.menu.addItem({
      iconHTML: "<svg><use xlink:href='#iconExam'></use></svg>",
      label: this.i18n["menu.ocrQuestion"] ?? "用小驴考试识别试题入库",
      click: async () => {
        try {
          if (!this.examApp) {
            showMessage(this.i18n["state.loading"] ?? "小驴考试正在启动，请稍候…", 2500, "info");
            return;
          }
          const cleanPath = src.startsWith("assets/") ? src : src.includes("/assets/") ? `assets/${src.split("/assets/").pop()}` : src;
          const q = await this.examApp.ocrAndParseQuestion(cleanPath);
          this.pendingEditQid = q.id;
          this.openPractice();
          showMessage("已识别并提取试题内容，正在打开编辑表单…", 3000, "info");
        } catch (e) {
          showMessage(`识题失败：${String(e instanceof Error ? e.message : e)}`, 4000, "error");
        }
      },
    });
  }

  private onFlashcardAction({ detail }: { detail?: { card?: { blockID?: string }; type?: string } }) {
    if (!detail?.card?.blockID || !detail.type || !this.examApp) return;
    const blockId = detail.card.blockID;
    const typeNum = Number(detail.type);
    if (![1, 2, 3, 4].includes(typeNum)) return;

    void (async () => {
      try {
        const hit = await this.examApp!.findQuestionByBlock(blockId);
        if (hit?.q) {
          const verdict = typeNum >= 3 ? "correct" : "wrong";
          this.examApp!.recordAttempt({
            qid: hit.q.id,
            kind: "practice",
            mode: "flashcard_sync",
            verdict,
            myAnswer: verdict === "correct" ? hit.q.answer : null,
            sessionId: "siyuan-riff",
          });
          void this.examApp!.saveSession().catch(() => undefined);
        }
      } catch {
        /* 容错静默 */
      }
    })();
  }

  openPractice(): boolean {
    return this.openTabByType(TAB_PRACTICE, "iconExam", this.i18n["tab.practice"]);
  }
  openWrongbook(): void {
    openPracticeView(this, "wrongbook");
  }
  openMock() {
    this.openTabByType(TAB_MOCK, "iconMock", this.i18n["tab.mock"]);
  }
  openReport() {
    this.openTabByType(TAB_REPORT, "iconReport", this.i18n["tab.report"]);
  }
}

