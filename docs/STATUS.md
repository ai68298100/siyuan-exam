# 小驴考试当前状态

> 更新日期：2026-10-15 · 版本：v0.10.0 · 分支：main（待推送）

这份文档记录当前源码和自动化检查的事实。它区分“已有实现”和“真实思源/移动端已验证”，避免把设计、截图或离线测试误写成宿主支持。发布摘要与版本边界以 [CHANGELOG](../CHANGELOG.md) 为准。

## 当前验证批次（2026-10-15，v0.10.0 工作区）

在本地隔离 UI harness 和纯逻辑测试中完成全量视觉微质感与现代高级感重塑验证；本轮注入复合弥散阴影、微内高光、微色调边框，修复核心视图 scoped `.lv-card` 覆盖缺陷，升级 20px 纸感题干、选项微键帽与悬浮淡紫浸润、CBT 正方答题卡矩阵、四象限温润微卡片、53 周热力图悬停放大、动态保存呼吸灯与全局次表面/空态沉淀。未配置思源实例，因此没有宣称新的真实思源宿主验证。

## 此前已记录的隔离靶场修复（2026-10-09，v0.9.1 后）

以下是历史验证，不代表本轮重新运行：

- **P0**：`openTab` custom.id 需 `plugin.name + type` 前缀（否则三主页签空白）；`questionToMarkdown` IAL 缺右花括号导致**所有写入题目在 attributes 表不可见**（v0.1 起即坏）；3.8.6 `/api/query/sql` 默认 64 行截断（请求级 limit 无效，须 SQL 文本 LIMIT）。
- **P1**：插件存储 `loadData` 空串归一化（错题处置 TypeError）；browser/mobile 前端需单文件构建（当前 Vite 使用 `codeSplitting: false`，旧版字段为 `inlineDynamicImports`）；错题本/驾驶舱响应性（总线驱动 dataRev）；内核断连在线标记翻转（`kernel-connection` 事件）；每日战报写回撞索引滞后；多库切换入口与记忆；重载后页签自动恢复。
- **其他**：双语 i18n 漏网 26 键、按钮防折行、placeholder 降调、收藏按钮语义 aria-label。

**当前验证证据**：113 个测试文件、652 项测试通过；`pnpm guard`、生产构建、UI harness 构建、`pnpm smoke:ui`（12/12）、报告行动 smoke、包白名单校验和 `pnpm release:check`（8 项）通过。此前原型状态 smoke 覆盖所列页面状态及 390px 横向溢出，但不等同于所有中间断点的视觉验收。未配置思源实例，因此不把内核写入、真实权限、移动 WebView 或真实 AI 端点列为已验证。

**性能证据边界**：当前发行包 `dist/index.js` 为 1,196,450 bytes（Vite gzip 375.96 kB），`dist/index.css` 为 66,943 bytes（gzip 11.15 kB），`package.zip` 为 663,984 bytes。Chrome 单文件 harness 的静态/延迟初始化对照各 20 次，主界面 shell 可见 p50/p95 为 171/206 与 172/205 ms；首模考为 57/76 与 62/81 ms，报告为 62/70 与 65/68 ms；两版资源体积、CLS（0）和 DOM（403）相同，当前没有足够证据说明生产懒加载能稳定改善体验，因此生产继续同步挂载 Tab。完整方法、分位数和局限见 `docs/DELIVERY.md`。源码无图片、视频/音频或自定义字体资源；真实宿主长列表数据也不足以支撑图片/字体处理或虚拟滚动改造。

**已核实的非缺陷**：考点合并“已应用”与内核瞬时分布不一致＝属性索引收敛窗口误读；报告写入按钮/`toggleFav` 两起“崩溃”均为测试传参或视口外坐标。

**仍待验证**（桌面/宿主能力）：剪贴板写入（挑战码复制）、系统打印对话框、TTS 音频输出、Android WebView、多窗口同步；已知行为：SiYuan 布局恢复不含插件自定义页签（已用 localStorage 记忆恢复规避）。

## 已实现

- 题库创建、手工录题、题目浏览/编辑、批量编辑和健康检查。
- XLSX/XLS、CSV、TSV、GIFT、Aiken、原生 `.sy.zip` 导入入口，包含映射、去重、试导、错误行、取消、读回确认。
- 练习会话、暂停/恢复、键盘作答、多选、数值容差、多空题、提示、解析、作答流水和错题本。
- FSRS/riff 连接、到期筛选、自评和闪卡候选。
- 模考蓝图、计时、恢复、答题卡、交卷审计、成绩单和导出。
- 报告趋势、热力、错因分布、信心校准、行动队列和数据导出。
- 学习资料登记、定位、笔记、题目关联、考纲覆盖、缺口清单和勘误回导。
- AI 提示、追问、讲解、错因假设、报告解读、下一行动、闪卡候选，以及生成/复核/修复管线。
- R54 UI：共享 Rail、窄屏抽屉、⌘K 命令面板、今日入口、独立错题本、报告和模考图表；R54 原型作为当前 UI 设计与状态规格，旧 v6 原型保留作历史资料。
- 外链安全：资料入口使用 origin 判定，题面/材料/导入抽查富文本外链经统一确认闸门，危险协议阻断并使用 `noopener,noreferrer` 打开。

## 当前验证证据

| 检查 | 结果 | 范围 |
|---|---:|---|
| `pnpm test` | 114 文件 / 655 项通过 | 纯逻辑、数据、内核客户端、URL policy、示例题库、报告和回归测试 |
| `pnpm run check:svelte` | 通过 | Svelte 类型与模板检查，0 errors / 0 warnings |
| `pnpm run check:styles` | 通过 | token 与样式审计 |
| `pnpm run build:app` | 通过 | 生产构建并生成 `dist/package.zip` |
| `pnpm exec vite build --config scripts/visual-harness/vite.config.ts` | 通过 | 真实 Svelte UI 的隔离 harness 构建 |
| `node scripts/visual-harness/smoke-prototype-states.mjs` | 通过 | R54 页面状态、失败恢复、加载锁和 390px 横向溢出 |
| `node scripts/visual-harness/smoke-workflows-ux.mjs` | 通过 | 导入、录题、资料草稿、AI、拖拽与快捷键 |
| `node scripts/visual-harness/smoke-sample-ui.mjs` | 通过 | 示例题库、练习、模考、报告导航与移动宽度 |
| `node scripts/visual-harness/smoke-shared-ux.mjs` | 通过 | 命令面板、抽屉、焦点恢复、异常收集 |
| `pnpm run lint` | 通过 | R54 原型已按浏览器脚本配置 globals，原型脚本无 ESLint 错误 |
| `pnpm smoke:ui` | 7/7 通过 | 生产 UI 核心流程与错误恢复 |
| `pnpm verify:package` | 通过 | 当前发行包白名单 9 个文件 |
| `pnpm release:check` | 8/8 通过 | 版本、翻译、依赖、构建、链接和包检查 |

2026-10-07 批次（v0.8.1–0.8.3）修复了原生包导入的 multipart transport、请求取消信号、练习键盘返回、UI smoke 题型假设、命令面板焦点、Tab ARIA 关系、图表语义、窄屏触控尺寸、长文本换行和确认对话框净化。

v0.9.1 批次（2026-10-08）统一插件名称为「小驴考试（内测版）」并补充 README 系列插件索引；明细见 [CHANGELOG](../CHANGELOG.md)。此前 v0.9.0 批次对齐设计规范 v6 的动效/焦点/主色语言，收敛浏览工具行（「更多」菜单）与首页模式层级，修复趋势图全宽、掌握度栅格、错因条失真、暗色热力图分层与人机对话模式的左箭头陷阱，补齐 ⌘K 模式命令与自评语义键帽，并重制品牌预览图。

## 尚未验证

- 真实思源内核的导入、题块写入/读回、保存失败、重载恢复和跨窗口行为。
- Android SiYuan WebView 的软键盘、下载、打印、剪贴板、`window.open`、触摸和安全区。
- 真实 AI 端点的取消、迟到响应隔离、费用和发送范围确认。
- 超过 5000 题题库的真实宿主性能。
- 完整读屏、200% 缩放、第三方主题、forced-colors 和插件卸载资源释放。
- 富文本外链在真实思源桌面/Android WebView 中的 `window.open`、剪贴板和敏感查询参数行为。
- R54 原型与实现的逐项视觉差异、真实思源权限/登录、远端请求取消与移动 WebView 仍需宿主条件具备后验证。
- 原型与生产 UI 目前通过任务面/状态映射和浏览器 smoke 核对；没有逐像素视觉差异报告，不能宣称所有组件已达到像素级镜像。

`pnpm preflight`、`pnpm smoke` 和 `pnpm e2e` 需要外部思源实例的 `SIYUAN_TOKEN`、`SIYUAN_BASE_URL` 或 `SIYUAN_WORKSPACE`；当前环境未提供这些参数，因此不能把它们记为通过。

## 下一批建议

1. 使用隔离的 SiYuan 3.8.6 工作区完成 [真机冒烟清单](17-真机冒烟清单.md) 中的导入、练习、模考恢复、AI 记录和保存回执。
2. 在 Android SiYuan WebView 完成窄屏抽屉、文件选择、下载、打印、剪贴板和软键盘走查。
3. 拆分 `PracticeTab.svelte` 的入口、会话、导入、浏览、资料、错题和 AI 状态，保持业务逻辑行为不变。
4. 统一 AI 任务数量、宿主支持矩阵和 README/CHANGELOG/docs 的版本事实。
5. 在真实用户反馈前暂缓 QTI/apkg、OCR、本地模型、复杂主观题和更多考试类型。

历史设计和路线文档仍保留原日期，当前事实以本文件、源码和最新命令输出为准。
