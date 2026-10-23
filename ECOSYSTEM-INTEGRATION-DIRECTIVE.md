# 【小驴生态中枢统领指令】小驴考试 (siyuan-exam) 全方位升级与跨插件协同执行手册

> **统领下发方**：小驴快门中枢（`siyuan-quickgate`）
> **执行接收方**：小驴考试（`siyuan-exam`）开发 Agent
> **架构基线**：Epoch 6 联邦规范 · 零强依赖优雅降级 · 普鲁士学院蓝+朱砂红印美学 · 历史排雷防线

---

## 一、 核心定位与视觉资产状态
- **生态角色**：**【刻意练习与备考工作台（Practice & Assessment Hub）】**——提供本地题库、刷题模考、错题本消灭与备考报告。
- **专属主题色**：**普鲁士学院藏蓝（`#0284C7` ➔ `#0369A1`）＋ 朱砂红满分通关火漆印（`#E11D48`）**。
- **根目录 `icon.png`**：**已由快门中枢完成 256×256 殿堂级“藏蓝底配满分考卷与朱砂红火漆印”高反差头像替换，请勿覆盖回退！**
- **本地已就绪 SDK**：`src/libs/ecosystem-bridge-kit.ts`（零外部依赖，可直接 `import`）。

---

## 二、 必做任务 1：跨插件联邦联动（Epoch 6 标准）

### 1. 四别名挂载与安全注销 (`src/index.ts` & `src/core/bus.ts`)
- 维护主别名 `window.LvExam`，同步兼容挂载 `window.siyuanExam`、`window.xiaolvExam`、`window.lvExam`（First-Instance-Wins + 卸载时身份核验安全注销）；
- 暴露 `whenReady()`、`hasCapability()`、`statsRead()`、`getOverview()`（严禁向外泄漏题干与答案）。

### 2. 刷题结算联动小驴打卡 & 广播标准事件 (`src/ui/session-done.svelte` & `src/core/bus.ts`)
- 会话结算时，调用 `src/libs/ecosystem-bridge-kit.ts` 的 `logCheckinEventSafely`：
  ```ts
  if (this.settings.checkinItemId && completedQuestions > 0) {
      await logCheckinEventSafely({
          itemId: this.settings.checkinItemId,
          value: completedQuestions,
          unit: "题",
          externalRef: `exam:${this.settings.checkinItemId}:${today}`,
          note: `完成备考刷题 ${completedQuestions} 题（正确率 ${accuracy}%）`,
      });
  }
  ```
- 同时通过 `window.dispatchEvent` 派发标准 `lv-exam:session-ended` 事件（信封 v1，仅含 `sessionId`, `mode`, `total`, `correct`, `wrong` 计数）。

### 3. 错题推送到小驴闪卡——幽灵按钮降级模式
- 错题本工具栏提供“推送到小驴闪卡”按钮：
  - 未安装闪卡（`!window.xiaolvCards`）时，按钮呈 45% 透明度幽灵态并带悬停提示，考试内置错题重练逻辑 100% 独立可用；
  - 已安装闪卡时，调用闪卡桥制卡接口。

---

## 三、 必做任务 2：顶栏与侧栏单色图标升级 (`src/index.ts`)

将 `this.addIcons(...)` 中的 `iconExam` 替换为与新版 Logo 1:1 映射的 32×32 单色矢量图标（摒弃原有的普通三横线折角文档，改用双层题卷卡片 + 满分通关对勾 + 朱砂印记点）：
```xml
<symbol id="iconExam" viewBox="0 0 32 32">
  <path d="M11 5h9c1.7 0 3 1.3 3 3v13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-opacity="0.4"/>
  <rect x="6" y="8" width="16" height="19" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"/>
  <path d="M10 13h5M10 16h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-opacity="0.5"/>
  <path d="m9.5 21 2.5 2.5 5.5-5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="22.5" cy="24" r="3" fill="currentColor"/>
</symbol>
```

---

## 四、 必做任务 3：UI 轻量统一与参考图战报 Bento 美学升级 (`src/index.scss`)

1. **注入专属品牌色与圆角阶梯**：
   ```scss
   --lv-brand: #0284C7; /* 普鲁士学院蓝 */
   --lv-brand-soft: color-mix(in srgb, var(--lv-brand) 12%, transparent);
   --lv-accent-seal: #E11D48; /* 朱砂红满分印 */
   ```
2. **吸收最初参考图第 4 屏“战报与成就胶囊”神韵**（参考快门 `docs/fleet-sync/fleet-bento-prototype.html`）：
   - 刷题结算屏呈现温情鼓励大卡片（如“🎉 今日备考已达标！”）与 `9999px` 成就胶囊矩阵（`🎯 90% 正确率`、`🔥 连续刷题`）；
   - 按钮挂载 `:active:not(:disabled) { transform: translateY(1.5px) scale(0.985); }` 物理微触感；
   - Dialog 弹窗标题栏统一采用 `.lv-dialog-title-wrap`（22×22 蓝底白标 + 标题 + 版本胶囊）。

---

## 五、 必做任务 4：深层工程规范与历史排雷加固

1. **`plugin.json` 关键对齐（必改）**：
   - **补齐品牌关键词**：当前 `keywords` 完全没有“小驴”！必须前置加入 `["小驴", "小驴考试", "xiaolv", "lv", ...]`，确保集市搜“小驴”能搜出考试！
   - **统一预览图格式**：将 `"preview": "preview.jpg"` 统一转为标准 PNG 格式 `"preview": "preview.png"` 并压缩体积至 350KB 以内；
   - 新增 `"settingsWindow": true`（开启独立桌面设置大窗）；
   - `minAppVersion` 统一由 `"3.8.0"` 提升至 `"3.8.4"`。
2. **移动端虚拟键盘避让 & 日志/i18n 规范**：
   - 移动端刷题填空或导入弹窗挂载 `window.visualViewport` 动态抬升底边距，防虚拟键盘遮挡提交按钮；
   - 控制台日志前缀统一由 `[lv-exam]` 规范为 `[LvExam]`；Toast 提示前缀统一为 `[小驴考试]`；
   - 确保构建产出包含下划线格式的 `dist/i18n/zh_CN.json`。

---

## 六、 验收标准
执行完毕后，在根目录运行：
```bash
pnpm check && pnpm test
```
确保全量单测与类型检查 100% 全绿通过！
