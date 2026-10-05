// @ts-nocheck
// siyuan 宿主 API 桩：可视化测试台专用（构建时把 "siyuan" 别名到这里）。
// 只需覆盖三个 Tab 渲染路径会触发的宿主面；交互深入时按需补充。
class Dialog {
  constructor(opts = {}) {
    this.element = document.createElement("div");
    this.element.className = "b3-dialog";
    this.element.innerHTML = `<div class="b3-dialog__content">${opts.content ?? ""}</div>
      <div class="b3-dialog__action"><button class="b3-button b3-button--cancel">取消</button>
      <button class="b3-button b3-button--text">确定</button></div>`;
    document.body.appendChild(this.element);
  }
  destroy() { this.element.remove(); }
  hide() { this.element.remove(); }
}

class Setting {
  constructor(opts = {}) {
    this.element = document.createElement("div");
    this.items = [];
  }
  addItem(item) { this.items.push(item); }
  open() {}
  close() {}
}

export class Plugin {
  constructor() {
    this.i18n = {};
    this.eventBus = { on() {}, off() {} };
    this.data = {};
  }
  addTab() {}
  addDock() {}
  addTopBar() {}
  addStatusBar() {}
  addCommand() {}
  addIcons() {}
  loadData() { return Promise.resolve(undefined); }
  saveData() { return Promise.resolve(); }
}

export class SettingUtils {
  constructor(opts = {}) {
    this.plugin = opts.plugin;
    this.settings = new Map();
  }
  addItem(item) { this.settings.set(item.key, item); }
  get(key) { return this.settings.get(key)?.value; }
  set(key, value) { const it = this.settings.get(key); if (it) it.value = value; }
  load() { return Promise.resolve(); }
  save() { return Promise.resolve(); }
}

export const showMessage = (msg) => console.log("[showMessage]", msg);
export const getFrontend = () => "desktop";
export const adaptHotkey = (k) => k;
export const openTab = () => {};
export const fetchSyncPost = async () => ({ code: -1, msg: "harness offline", data: null });
export { Dialog, Setting };
export default { Plugin, Dialog, Setting, SettingUtils, showMessage, getFrontend, adaptHotkey, openTab, fetchSyncPost };
