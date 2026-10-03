# 生态契约总表（TODO 48-01）

> 本文件是「小驴考试」对外暴露的**已实现**集成契约与**拟议**计划的唯一索引。
> 原则（docs/19 §48 组）：已实现/拟议严格区分；CI 只校验已实现事实；README 不把拟议接口写成已支持；
> 卸载后无孤儿 listener/command/widget。契约变更须同步本文件与 CHANGELOG。

## 状态图例

- **已实现**：代码已在 `main` 分支，按本文件描述可用。
- **拟议**：仅有计划/研究结论（research/10、TODO 48 组），不构成可用依赖。

---

## 已实现

### 1. `lv-exam:*` 事件总线（`src/core/bus.ts`，信封 v1）

| 事件 | 载荷 | 发射方 | 消费方 |
| --- | --- | --- | --- |
| `lv-exam:open-question` | `{ qid: string }` | Dock 行点击 | 练习台（单题会话） |
| `lv-exam:open-in-browse` | `{ qid, bank }` | 块菜单「在练习台打开」 | 练习台（浏览聚焦） |
| `lv-exam:edit-question` | `{ qid, bank }` | 块菜单「编辑题目」 | 练习台（浏览编辑） |
| `lv-exam:session-ended` | `{ sessionId, mode, total, correct, wrong }` | 会话结算 | 生态消费者（仅计数，无题干） |
| `lv-exam:wrongbook-changed` | `{ qid, status }` | 错题处置（mastered/removed/active/snoozed） | 生态消费者（按需重读） |
| `lv-exam:stats` | publicStats 脱敏快照 | 数据变更后 | 生态消费者（legacy 裸 detail 与信封 v1 双发） |

- 载体：`window` CustomEvent，`detail = { v: 1, type, eventId, at, payload }`。
- 幂等：每次发射 `eventId` 唯一（`e-<base36 时间>-<序号>`），重放去重以此为锚。
- 版本容错：`v !== 1` 或 `type` 不匹配的信封不投递（前向兼容）。
- 红线：payload 只放 id/上下文，不含题干/答案/key/路径。
- API：`emitExamEvent(type, payload)` / `onExamEvent(type, handler)`（`onExamEvent` 返回退订函数）。

### 2. `lv-exam:stats` 广播（兼容态，47-04 版本化时并入总线）

- 载体：`window` CustomEvent，`detail` = `buildPublicStats()` 脱敏聚合快照
  （作答量/正确率/消灭数/连胜等；**无题目内容、无 key、无路径**）。
- 时机：插件加载完成（`onLayoutReady` 末尾）与数据变更后广播；**启动广播对迟到监听者不可靠**——
  请改用下方 `window.siyuanExam.statsRead()`。

### 3. `window.siyuanExam` 公开 API（47-04/48-06 lite，随插件卸载自动移除）

| 成员 | 形态 | 说明 |
| --- | --- | --- |
| `version` | `string` | 插件版本（manifest） |
| `open()` / `practice()` | `() => void` | 打开练习台（稳定入口；等价命令 `openPractice`） |
| `wrongbook()` | `() => void` | 打开练习台（错题本入口所在） |
| `mock()` / `report()` | `() => void` | 打开模考场 / 报告中心 |
| `stats()` | `() => snapshot \| null` | **同步**返回最近一次广播的脱敏快照（可能滞后；未广播过返回 null） |
| `statsRead()` | `() => Promise<snapshot>` | **异步按需**重算脱敏快照（推荐；迟到消费者用这个） |

- 兄弟插件调用示例：`window.siyuanExam?.statsRead()?.then(s => render(s))`。
- 雷切条目级命令（widget protocol `command` 字段）可用：`"siyuan-exam::openPractice"` 等命令 langKey。

### 4. 小驴雷切 · 组件面板组件（48-05，协议 v2）

- 宿主探测：`app.plugins` 中 `name === "siyuan-speed-switch"`；`onload` 未就绪时**有界重试**
  （250ms→6s 共 5 档，总窗 ~11.5s，到顶放弃并保持安静——未安装雷切是正常形态）。
- 组件：`moduleId = "exam-daily-summary"`（48-05 约定名；若雷切侧未来内建同名桥接，
  本插件注册按协议热替换接管）。
- `read`：返回当日作答数/正确率/错题在册三条（**只用 derived() 缓存重算，不全库扫描**，满足 800ms 契约）。
- `open`：跳转练习台。卸载时 `unregister()` 配对调用（`onunload`）。
- 诊断：注册是否最终成功见 `settled()`（内部句柄）；放弃时控制台留 `[lv-exam]` 日志。

### 5. 小驴打卡 · 单向打卡桥（48-03 lite）

- 契约来源：`小驴打卡/docs/api-v5.md`（稳定版）；探测三步 `window.siyuanCheckin` → `protocol === "siyuan-checkin"` → `whenReady()` → `hasCapability("events.record")`。
- 写入：`recordEvent({ itemId, value: 当日作答数, unit: "题", source: "api", externalRef, note, occurredAt })`。
- 幂等身份：`externalRef = exam:<itemId>:<localDate>`（同日永远同一引用；**`exam:` 前缀尚未在打卡侧 identity-and-merge.md 正式登记**——治理步骤待办）。
- 失败语义：`recordEvent` 返回 `undefined` 一律=未写入 → 事件原引用持久化（`checkin/bridge/pending`），重启/下次结算自动补写，不换新引用。
- 用户配置：设置「打卡桥·项目 ID / 达标题数」；未配置 itemId 时桥完全关闭（不探测不写入）。
- 状态呈现：结算页 chip（已同步 / 幂等命中 / 待重试 / 无写入能力）。

### 6. 打卡→考试只读投影（48-04 lite）

- 桥开启（用户配置了 itemId）时，练习台入口读取该项目的连续天数：`metrics.read` 能力协商 → `getStreaks([itemId])`（**不自算 streak**，连续数由打卡单一实现计算）。
- 失败语义：能力缺失/异常/项目不匹配 → 安静不显示（不影响刷题）。
- 仅显示 `current`（当前连续）；`longest`/里程碑字段未消费。

### 7. 交付物边界（导出/出库）

- CSV 导出：官方模板表头（`core/bankCsv.ts`），不含流水/个人笔记。
- 数据出库 JSON：`lv-exam.export/1` 信封（流水/题库注册表/错题处置/错因/行动），无题干、无密钥。
- 每日战报 Markdown：写入用户日记文档（联动小驴复盘的预留通道）。

---

## 拟议（不可用，勿依赖）

| 计划 | 状态 | 前置 |
| --- | --- | --- |
| 打卡→考试只读投影扩展（48-04：次数/时长维度） | 拟议 | 48-03 真机走查 |
| `lv-exam:stats` 版本化并入总线 + 请求/响应契约（47-04 完整形态） | 部分实现（stats 已双发信封 v1，legacy 兼容） | session:ended/wrongbook:changed 事件与 source 字段定稿 |
| `exam:` externalRef 前缀在打卡侧正式登记 | 待协作 | 打卡 identity-and-merge.md 治理流程 |
| 小驴闪卡共存与迁移助手（48-07） | 拟议（需协议 spike） | 闪卡跨插件事件验证 |
| 小驴拾遗联动（`window.siyuanGlean`） | 拟议（接口本身仍未定稿） | 拾遗协议定稿 |
| 人脉 LvContacts protocol v1 桥 | 拟议 | 需求验证（48 组排期最低） |

---

## 变更记录

- 2026-10-04：初版——登记事件总线 v1、`lv-exam:stats`（兼容态）、`window.siyuanExam`、
  雷切 `exam-daily-summary` 组件（48-05）、交付物边界；拟议表立此存照（48-01）。
- 2026-10-04（同日增补）：小驴打卡单向桥（48-03 lite）转已实现——`exam:` 前缀登记待跨仓库协作，其余契约按 api-v5 稳定版实装。
