# 【小驴生态中枢统领指令】小驴考试 (siyuan-exam) 专项排查与全方位升级执行手册

> **统领下发方**：小驴快门中枢（`siyuan-quickgate`）
> **执行接收方**：小驴考试（`siyuan-exam`）开发 Agent
> **当前状态**：底座测试全绿 (1309项) · 规范评分 80% ➔ 目标 100%
> **核心原则**：零强依赖 · 普鲁士学院蓝+朱砂红印 Bento 美学 · 严禁私有存储穿透

---

## 一、 核心资产状态确认
1. **根目录 `icon.png`**：**已由中枢完成 256×256 殿堂级“藏蓝底配满分对勾考卷与朱砂印”高清头像替换，请严格保留勿覆盖！**
2. **本地就绪 SDK**：`src/libs/ecosystem-bridge-kit.ts`（零外部依赖，直接 import 使用）。

---

## 二、 当前排查出的本插件专项缺陷与必修任务清单

### 【P0 级：集市获客与设置窗口升级】
1. **`plugin.json` 补齐品牌关键词（严重影响集市获客！）**：
   - 当前 `keywords` 完全没有“小驴”中文词，集市搜“小驴”搜不出考试！
   - **必修修改**：前置强制补齐 `["小驴", "小驴考试", "xiaolv", "lv", ...]`。
2. **开启独立桌面设置大窗（`settingsWindow: true`）**：
   - 在 `plugin.json` 根级增加 `"settingsWindow": true`，彻底打通思源 3.8.8+ 独立大窗口设置体验。
3. **统一预览图为 PNG 格式**：
   - 将 `plugin.json` 中的 `"preview": "preview.jpg"`（626KB 超大文件）统一转换为标准的 `preview.png` 并压缩至 350KB 以内。

---

### 【P1 级：顶栏图标升级与事件规范化】
4. **顶栏单色矢量图标升级 (`src/index.ts`)**：
   - 将 `this.addIcons(...)` 中的 `iconExam` 替换为带满分对勾特征的标准 32×32 SVG：
   ```xml
   <symbol id="iconExam" viewBox="0 0 32 32">
     <path d="M11 5h9c1.7 0 3 1.3 3 3v13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-opacity="0.4"/>
     <rect x="6" y="8" width="16" height="19" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"/>
     <path d="M10 13h5M10 16h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-opacity="0.5"/>
     <path d="m9.5 21 2.5 2.5 5.5-5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
     <circle cx="22.5" cy="24" r="3" fill="currentColor"/>
   </symbol>
   ```
5. **广播标准事件 `lv-exam:session-ended`**：
   - 结算时派发信封只含 `sessionId`, `mode`, `total`, `correct`, `wrong` 计数，严禁题干正文泄漏。

---

### 【P2 级：错题转闪卡幽灵按钮 & 移动端键盘防遮挡】
6. **错题推闪卡幽灵按钮降级模式**：
   - 错题本增加“推送到闪卡复习”：未安装闪卡时呈 45% 透明度幽灵按钮并悬停提示，考试自身错题本消灭模式 100% 独立可用；已安装闪卡时调用制卡接口。
7. **移动端键盘防遮挡 (`visualViewport`)**：
   - 移动端刷题填空或导入弹窗挂载 `window.visualViewport` 动态抬升底边距，防软键盘遮挡提交按钮。

---

## 三、 验收指令
修改完成后，在根目录执行：
```bash
pnpm check && pnpm test
```
确保全量 1309+ 项单测与门禁 100% 全绿通过！
