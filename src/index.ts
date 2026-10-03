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

const TAB_PRACTICE = "exam-practice";
const TAB_MOCK = "exam-mock";
const TAB_REPORT = "exam-report";
const DOCK_WRONGBOOK = "dock-wrongbook";

export default class LvExamPlugin extends Plugin {
  private isMobile: boolean;
  private settingUtils: SettingUtils;
  private tabApps: { [tabType: string]: object } = {};
  /** 应用组装层（与基类 Plugin.app: App 无关，刻意改名避免遮蔽） */
  private examApp: ExamApp | null = null;
  private boundBlockIcon = this.onBlockIconClick.bind(this);

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
      this.registerDock();
      this.registerStatusBar();
    }
    this.registerCommands();

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

  /** 对外只读数据接口（TODO 21/24 组）：lv-exam:stats 广播（脱敏聚合，无题目内容） */
  private dispatchPublicStats() {
    if (!this.examApp) return;
    try {
      import("@/core/publicStats").then((m) => {
        const d = this.examApp!.derived();
        window.dispatchEvent(
          new CustomEvent("lv-exam:stats", {
            detail: m.buildPublicStats(d, this.examApp!.attempts.all(), streak(d)),
          }),
        );
      });
    } catch {
      /* 统计失败不影响主流程 */
    }
  }

  async onunload() {
    this.eventBus.off("click-blockicon", this.boundBlockIcon);
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

  /** 状态栏迷你进度（TODO 18 组）：今日完成/连胜，点击打开练习台 */
  private registerStatusBar() {
    this.addStatusBar({
      element: (() => {
        const el = document.createElement("div");
        el.classList.add("lv-statusbar", "fn__flex-center");
        el.style.cursor = "pointer";
        el.addEventListener("click", () => this.openPractice());
        return el;
      })(),
    });
  }

  refreshStatusBar() {
    if (this.isMobile || !this.examApp) return;
    const el = document.querySelector(".lv-statusbar");
    if (!el) return;
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
          const instance = mount(component, {
            target: el,
            props: { plugin: this.data.plugin, examApp: this.data.examApp },
          });
          this.data.plugin.tabApps[type] = instance;
          this.element.appendChild(el);
        },
        destroy() {
          const owner = this.data.plugin as LvExamPlugin;
          if (owner.tabApps[type]) {
            unmount(owner.tabApps[type]);
            delete owner.tabApps[type];
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
      data: {},
      type: DOCK_WRONGBOOK,
      init() {
        this.element.innerHTML = `<div class="fn__flex-1 lv-dock-body"></div>`;
      },
      destroy() {},
    });
  }

  /** 错题 Dock 实数据渲染（作答后由 Tab 调用） */
  refreshDock() {
    if (this.isMobile || !this.examApp) return;
    const dockEl = document.querySelector<HTMLElement>(".lv-dock-body");
    if (!dockEl) return;
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
    // 事件委托：手动处置（覆盖层由 examApp.setWrongStatus 持久化）
    dockEl.querySelectorAll<HTMLButtonElement>(".lv-dock-act").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const qid = btn.dataset.qid!;
        await this.examApp?.setWrongStatus(qid, btn.dataset.act as "mastered" | "removed");
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
        window.dispatchEvent(new CustomEvent("lv-exam:open-question", { detail: { qid } }));
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
      // 桌面端 Dock 由思源侧边栏开关管理；此命令在移动端/快捷键场景打开练习台
      callback: () => this.openPractice(),
    });
  }

  private openTabByType(type: string, icon: string, title: string) {
    // 单例聚焦（26.2）：同类型 Tab 已开则切换过去，避免 tabApps 覆盖引用
    const existing = (this.getOpenedTab()[type] ?? [])[0] as any;
    if (existing) {
      const tab = existing.parent;
      if (tab?.switchTab) tab.switchTab(existing.headElement);
      else existing.headElement?.click?.();
      return;
    }
    openTab({
      app: this.app as any,
      custom: {
        id: type,
        icon,
        title,
        data: { plugin: this, examApp: this.examApp },
      },
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
            const kp = (await inputDialogSync({
              title: this.i18n["blockMenu.markKp"],
              placeholder: this.i18n["blockMenu.markKpPlaceholder"],
              defaultText: hit.q.kp ?? "",
            }))?.trim();
            if (kp == null) return; // 用户取消
            await exam.markQuestionKp(hit.q, kp);
            showMessage(kp ? `${this.i18n["blockMenu.markKpDone"]} ${kp}` : this.i18n["blockMenu.markKpCleared"], 2800, "info");
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
            showMessage(this.examApp!.kernelOnline ? this.i18n["query.empty"] : this.i18n["state.offlineHint"], 3600, "info");
            return;
          }
          (this as any).pendingEditQid = hit.q.id;
          (this as any).pendingEditBank = hit.bank.id;
          window.dispatchEvent(new CustomEvent("lv-exam:edit-question", { detail: { qid: hit.q.id, bank: hit.bank.id } }));
          this.openPractice();
        },
      });
      detail.menu.addItem({
        iconHTML: "<svg><use xlink:href='#iconExam'></use></svg>",
        label: this.i18n["blockMenu.openInBrowse"],
        click: async () => {
          const hit = await exam.findQuestionByBlock(blockId).catch(() => null);
          if (!hit) {
            showMessage(this.examApp!.kernelOnline ? this.i18n["query.empty"] : this.i18n["state.offlineHint"], 3600, "info");
            return;
          }
          (this as any).pendingBrowseQid = hit.q.id;
          (this as any).pendingBrowseBank = hit.bank.id;
          window.dispatchEvent(new CustomEvent("lv-exam:open-in-browse", { detail: { qid: hit.q.id, bank: hit.bank.id } }));
          this.openPractice();
        },
      });
      return;
    }
    detail.menu.addItem({
      iconHTML: "<svg><use xlink:href='#iconExam'></use></svg>",
      label: this.i18n["blockMenu.addToPractice"],
      click: () => {
        showMessage(this.i18n["blockMenu.practiceHint"], 3600, "info");
      },
    });
  }

  openPractice() {
    this.openTabByType(TAB_PRACTICE, "iconExam", this.i18n["tab.practice"]);
  }
  openMock() {
    this.openTabByType(TAB_MOCK, "iconMock", this.i18n["tab.mock"]);
  }
  openReport() {
    this.openTabByType(TAB_REPORT, "iconReport", this.i18n["tab.report"]);
  }
}
