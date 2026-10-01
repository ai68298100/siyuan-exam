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

import PracticeTab from "@/ui/practice/PracticeTab.svelte";
import MockTab from "@/ui/mock/MockTab.svelte";
import ReportTab from "@/ui/report/ReportTab.svelte";

const TAB_PRACTICE = "exam-practice";
const TAB_MOCK = "exam-mock";
const TAB_REPORT = "exam-report";
const DOCK_WRONGBOOK = "dock-wrongbook";

export default class LvExamPlugin extends Plugin {

    private isMobile: boolean;
    private settingUtils: SettingUtils;
    private tabApps: { [tabType: string]: object } = {};

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

        // 模块开关与核心配置（详见 docs/01-功能全景PRD.md 第三节设计原则）
        this.settingUtils = new SettingUtils({
            plugin: this,
            callback: () => {
                showMessage(this.i18n["settingSaved"], 2600, "info");
            }
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
            title: this.i18n["setting.aiKey.title"],
            description: this.i18n["setting.aiKey.desc"],
            type: "textinput",
            key: "aiKey",
            value: "",
            password: true,
            direction: "row"
        });

        this.registerTabs();
        if (!this.isMobile) {
            this.registerDock();
        }
        this.registerCommands();

        this.eventBus.on("click-blockicon", this.onBlockIconClick);
    }

    async onLayoutReady() {
        await this.settingUtils.load();
    }

    onunload() {
        this.eventBus.off("click-blockicon", this.onBlockIconClick);
        Object.values(this.tabApps).forEach((app) => unmount(app));
        this.tabApps = {};
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
                    const app = mount(component, {
                        target: el,
                        props: { app: this.data.app, plugin: this.data.plugin }
                    });
                    (this.data.plugin as LvExamPlugin).tabApps[type] = app;
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
            data: {
                title: this.i18n["dock.wrongbook"],
                empty: this.i18n["dock.empty"]
            },
            type: DOCK_WRONGBOOK,
            init() {
                this.element.innerHTML = `
<div class="fn__flex-1 fn__flex-column">
    <div class="block__icons">
        <div class="block__logo">
            <svg class="block__logoicon"><use xlink:href="#iconWrongbook"></use></svg>
            ${this.data.title}
        </div>
        <span class="fn__flex-1 fn__space"></span>
    </div>
    <div class="fn__flex-1 lv-exam-wrongbook">
        <div class="b3-card b3-card--wrap">
            <div class="b3-card__body">
                <p class="b3-typography">${this.data.empty}</p>
            </div>
        </div>
    </div>
</div>`;
            },
            destroy() { }
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
    }

    private openTabByType(type: string, icon: string, title: string) {
        openTab({
            app: this.app,
            custom: {
                id: type,
                icon,
                title,
                data: { app: this.app, plugin: this }
            }
        });
    }

    // Use an arrow property so the event bus cannot detach the plugin `this`
    // context. The same function reference is passed to `off` during unload.
    private onBlockIconClick = ({ detail }: any) => {
        // 块菜单：加入练习集 / 转为闪卡 / 标记考点（v0.1 起逐步实现，先占位）
        if (!detail?.menu) { return; }
        detail.menu.addItem({
            iconHTML: "<svg><use xlink:href='#iconExam'></use></svg>",
            label: this.i18n["blockMenu.addToPractice"],
            click: () => {
                showMessage(this.i18n["todo"], 2600, "info");
            }
        });
    }

    openPractice() { this.openTabByType(TAB_PRACTICE, "iconExam", this.i18n["tab.practice"]); }
    openMock() { this.openTabByType(TAB_MOCK, "iconMock", this.i18n["tab.mock"]); }
    openReport() { this.openTabByType(TAB_REPORT, "iconReport", this.i18n["tab.report"]); }
}
