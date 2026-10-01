import {
    Plugin,
    openTab,
    showMessage,
    getFrontend,
    adaptHotkey
} from "siyuan";
import "./index.scss";

import { SettingUtils } from "./libs/setting-utils";
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
            }
        });
        this.settingUtils.addItem({
            title: this.i18n["setting.examDate.title"],
            description: this.i18n["setting.examDate.desc"],
            type: "textinput",
            key: "examDate",
            value: "",
            direction: "row"
        });
        this.settingUtils.addItem({
            title: this.i18n["setting.sprintDays.title"],
            description: this.i18n["setting.sprintDays.desc"],
            type: "number",
            key: "sprintDays",
            value: 14,
            direction: "row"
        });
        this.settingUtils.addItem({
            title: this.i18n["setting.dailyGoal.title"],
            description: this.i18n["setting.dailyGoal.desc"],
            type: "number",
            key: "dailyGoal",
            value: 10,
            direction: "row"
        });
        this.settingUtils.addItem({
            title: this.i18n["setting.retention.title"],
            description: this.i18n["setting.retention.desc"],
            type: "slider",
            key: "desiredRetention",
            value: 0.9,
            direction: "row",
            slider: { min: 0.85, max: 0.97, step: 0.01 }
        });
        this.settingUtils.addItem({
            title: this.i18n["setting.aiEndpoint.title"],
            description: this.i18n["setting.aiEndpoint.desc"],
            type: "textinput",
            key: "aiEndpoint",
            value: "",
            direction: "row"
        });
        this.settingUtils.addItem({
            title: this.i18n["setting.aiModel.title"],
            description: this.i18n["setting.aiModel.desc"],
            type: "textinput",
            key: "aiModel",
            value: "gpt-4o-mini",
            direction: "row"
        });
        this.settingUtils.addItem({
            title: this.i18n["setting.aiCustomHint.title"],
            description: this.i18n["setting.aiCustomHint.desc"],
            type: "textarea",
            key: "aiCustomHint",
            value: "",
            direction: "row"
        });
        this.settingUtils.addItem({
            title: this.i18n["setting.aiKey.title"],
            description: this.i18n["setting.aiKey.desc"],
            type: "textinput",
            key: "aiKey",
            value: "",
            direction: "row",
            password: true
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
                window.dispatchEvent(new CustomEvent("lv-exam:stats", {
                    detail: m.buildPublicStats(d, this.examApp!.attempts.all(), streak(d)),
                }));
            });
        } catch { /* 统计失败不影响主流程 */ }
    }

    async onunload() {
        this.eventBus.off("click-blockicon", this.boundBlockIcon);
        try { this.examApp?.attempts.dispose(); } catch { /* 卸载栅栏 */ }
        try { await this.examApp?.flush(); } catch { /* 尽力而为 */ }
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
        const todayKey = (() => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; })();
        const today = d.days.get(todayKey)?.attempts ?? 0;
        const wrong = this.examApp.wrongItems().length;
        el.textContent = `📝 ${today} · ❌ ${wrong} · 🔥 ${streak(d)}`;
    }

    private registerTabs() {
        const tabs: Array<[string, any]> = [
            [TAB_PRACTICE, PracticeTab],
            [TAB_MOCK, MockTab],
            [TAB_REPORT, ReportTab]
        ];
        for (const [type, component] of tabs) {
            this.addTab({
                type,
                init() {
                    const el = document.createElement("div");
                    el.classList.add("fn__flex-1", "lv-exam-tab");
                    const instance = mount(component, {
                        target: el,
                        props: { plugin: this.data.plugin, examApp: this.data.examApp }
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
                }
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
                hotkey: "⌥⌘E"
            },
            data: {},
            type: DOCK_WRONGBOOK,
            init() {
                this.element.innerHTML = `<div class="fn__flex-1 lv-dock-body"></div>`;
            },
            destroy() { }
        });
    }

    /** 错题 Dock 实数据渲染（作答后由 Tab 调用） */
    refreshDock() {
        if (this.isMobile || !this.examApp) return;
        const dockEl = document.querySelector<HTMLElement>(".lv-dock-body");
        if (!dockEl) return;
        const items = this.examApp.wrongItems();
        const rows = items.slice(0, 30).map((w) =>
            `<div class="lv-dock-row" data-qid="${w.qid}">
                <span class="num">${w.qid}</span>
                <span>错 ${w.wrongCount}</span>
                <button class="lv-dock-act" data-act="mastered" data-qid="${w.qid}" title="已掌握">✓</button>
                <button class="lv-dock-act" data-act="removed" data-qid="${w.qid}" title="永久移除">✕</button>
            </div>`
        ).join("");
        dockEl.innerHTML = `
<div class="block__icons" style="padding:4px 8px">
    <div class="block__logo">${this.i18n["dock.wrongbook"]}</div>
    <span class="fn__flex-1"></span>
    <span class="lv-chip lv-chip--red num">${items.length}</span>
</div>
<div class="lv-dock-list">
${items.length ? rows : `<div class="lv-dock-empty">${this.i18n["dock.empty"]}</div>`}
</div>`;
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
    }

    private registerCommands() {
        this.addCommand({
            langKey: "command.openPractice",
            hotkey: adaptHotkey("⌥⌘P"),
            callback: () => this.openPractice()
        });
        this.addCommand({
            langKey: "command.openMock",
            hotkey: adaptHotkey("⌥⌘M"),
            callback: () => this.openMock()
        });
        this.addCommand({
            langKey: "command.openReport",
            hotkey: adaptHotkey("⌥⌘R"),
            callback: () => this.openReport()
        });
        this.addCommand({
            langKey: "command.openWrongbook",
            hotkey: adaptHotkey("⌥⌘E"),
            // 桌面端 Dock 由思源侧边栏开关管理；此命令在移动端/快捷键场景打开练习台
            callback: () => this.openPractice()
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
                data: { plugin: this, examApp: this.examApp }
            }
        });
    }

    private onBlockIconClick({ detail }: any) {
        if (!detail?.menu) { return; }
        // 查询圈题（v0.2）：查询嵌入块 → 用此查询开始练习
        const el = detail.blockElements?.[0];
        if (el?.getAttribute?.("data-type") === "query_embed" && this.examApp) {
            const stmt = el.getAttribute("data-query") || (el.textContent ?? "").trim();
            detail.menu.addItem({
                iconHTML: "<svg><use xlink:href='#iconExam'></use></svg>",
                label: this.i18n["blockMenu.queryPractice"],
                click: async () => {
                    try {
                        const bank = this.examApp!.listBanks()[0];
                        if (!bank) { showMessage(this.i18n["guard.needBankFirst"], 3600, "error"); return; }
                        const qs = await this.examApp!.queryQuestions(bank.id, stmt);
                        if (!qs.length) { showMessage(this.i18n["query.empty"], 3600, "info"); return; }
                        (this as any).pendingPractice = qs;
                        this.openPractice();
                    } catch (e) {
                        showMessage(String(e instanceof Error ? e.message : e), 4800, "error");
                    }
                }
            });
            return;
        }
        detail.menu.addItem({
            iconHTML: "<svg><use xlink:href='#iconExam'></use></svg>",
            label: this.i18n["blockMenu.addToPractice"],
            click: () => {
                showMessage(this.i18n["blockMenu.practiceHint"], 3600, "info");
            }
        });
    }

    openPractice() { this.openTabByType(TAB_PRACTICE, "iconExam", this.i18n["tab.practice"]); }
    openMock() { this.openTabByType(TAB_MOCK, "iconMock", this.i18n["tab.mock"]); }
    openReport() { this.openTabByType(TAB_REPORT, "iconReport", this.i18n["tab.report"]); }
}
