# 小驴考试交付说明

> 当前审计：2026-10-18 · 源码版本 `0.10.4`。当前功能、隔离宿主与 GitHub 状态见 [STATUS-2026-10-18](STATUS-2026-10-18.md)，UI / 原型对照见 [UI-AUDIT-2026-10-18](UI-AUDIT-2026-10-18.md)。最新公开 Release 仍为 [v0.10.3](https://github.com/ai68298100/siyuan-exam/releases/tag/v0.10.3)；存在 v0.10.4 tag 不代表已有可下载发行包。本文第 8 节保留原日期的历史测量，不能用作当前版本重跑结果。
>
> `design/prototype-r54/` 是布局、视觉和已演示 UI 状态的设计基线；它使用合成数据，不是生产功能行为的证据。只有第 3 节明确列出的入口和状态映射经过核对，才可称为对应；未覆盖的生产能力与差异必须显式记录。实际功能以 `src/ui/`、`src/core/`、自动化测试和真实思源宿主验证为准，不得把原型演示数据当作真实题库或成绩。

## 1. 从零运行

### 前置条件

- Node.js `>=24.0.0`。
- pnpm `12.9.1`（版本声明在 `package.json.packageManager`）。
- 真实宿主验证需要安装并运行思源笔记 `>=3.8.0`。插件清单还声明支持 desktop、mobile、browser-desktop、browser-mobile 和 desktop-window；每个前端的文件选择、打印、剪贴板、TTS 和软键盘仍需按 [真机冒烟清单](17-真机冒烟清单.md) 单独核对。
- Windows 开发软链需要允许创建符号链接，或使用复制安装脚本。

### 安装、开发和本地构建

```powershell
git clone https://github.com/ai68298100/siyuan-exam.git
Set-Location siyuan-exam
corepack enable
corepack prepare pnpm@12.9.1 --activate
pnpm install --frozen-lockfile
pnpm make-link # 可选：安装到本机思源并启用热重载
pnpm dev
```

`pnpm make-link` 按提示选择思源工作空间；也可以预先设置 `SIYUAN_PLUGIN_DIR` 指向 `data/plugins` 目录。`pnpm dev` 等价于 `pnpm dev:app`：以开发模式 watch 构建到 `dev/`，并启用内联 sourcemap。最后在思源的插件管理中加载或重载 `siyuan-exam`。

没有运行中的思源时，可以只验证代码和 UI harness：

```powershell
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm verify:package
pnpm exec vite build --config scripts/visual-harness/vite.config.ts
pnpm smoke:ui
node scripts/visual-harness/smoke-prototype-states.mjs
```

上述 Vite 命令先生成 `output/harness/`，之后生产 UI 的 smoke 才有可运行产物。R54 静态原型可直接用浏览器打开 `design/prototype-r54/index.html`；原型状态 smoke 独立通过 Playwright 读取该目录，不依赖思源或 harness 构建。Playwright smoke 共用 `scripts/visual-harness/browser.mjs`：优先使用 `PLAYWRIGHT_EXECUTABLE_PATH`，否则先查找本机 Chrome，再回退 Edge 或 Playwright 管理的 Chromium；本工作区 UI 走查和截图使用 Chrome。自动查找失败时，可设置完整路径后重试：

```powershell
$env:PLAYWRIGHT_EXECUTABLE_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
node scripts/visual-harness/smoke-prototype-states.mjs
```

`PLAYWRIGHT_EXECUTABLE_PATH` 只影响本地 Playwright 浏览器启动，不影响生产构建或思源插件运行。生产 UI、原型状态和截图生成脚本统一使用共享启动器，默认优先 Chrome，缺失时才回退 Edge 或 Playwright Chromium。

生产构建输出 `dist/` 和根目录 `package.zip`。本地复制安装使用 `pnpm make-install`；该命令会先构建，再把 `dist/` 复制到选择的思源插件目录。复制安装和软链安装都会改变本机文件，请确认目标工作空间。

### 真实思源冒烟

写型脚本必须使用隔离的测试工作空间。脚本会拒绝存在非临时笔记本的共享内核；只有明确确认风险时才设置 `SIYUAN_E2E_ALLOW_SHARED=1`。宿主 UI 重载冒烟使用 `--settle-ms 750`（连续热重载时等待插件生命周期完成；高压力回归可用 1500），推荐：

```powershell
$env:SIYUAN_BASE_URL = "http://127.0.0.1:6807"
$env:SIYUAN_TOKEN = "<隔离实例 token>"
pnpm smoke
```

只读数据层走查需要显式工作区路径：

```powershell
$env:SIYUAN_WORKSPACE = "D:\path\to\siyuan-workspace"
pnpm e2e
```

`pnpm preflight`、`pnpm smoke` 和 `pnpm e2e` 缺少对应的外部参数时不能标记为通过。`SIYUAN_E2E_AI=1` 才会启用预检中的 AI 请求；这可能真正调用模型并产生费用，默认跳过。

## 2. 项目结构

| 路径                                                                 | 责任                                                                                                           |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                                       | 思源插件生命周期、设置、命令、桌面唯一顶栏/三个 Tab 注册，以及 `openPractice`、`openMock`、`openReport` 入口；当前不注册独立 Dock 或状态栏。 |
| `src/app.ts`                                                         | `ExamApp` 应用组装层；题库、作答流水、会话、模考、报告和保存协调的统一入口。                                   |
| `src/app-runtime.ts`                                                 | 思源 `fetchSyncPost`、超时/取消、在线状态和插件私有存储适配。                                                  |
| `src/kernel/client.ts`                                               | 内核请求客户端与错误分类。                                                                                     |
| `src/core/`                                                          | 题目模型、判分、导入后数据、会话、模考、报告、资料、考纲、行动、保存闸门等领域逻辑。                           |
| `src/importer/`                                                      | CSV/TSV/GIFT/Aiken/Excel/思源题库包导入解析、映射、校验和提交前数据。                                          |
| `src/ai/`                                                            | AI 通道、任务信封、提示、讲解、报告解读和候选生成；必须经过设置和审核，不能把响应直接当作入库事实。            |
| `src/ui/practice/PracticeTab.svelte`                                 | 练习台的入口、题库浏览、导入、手工录题、AI 出题、资料、错题、背诵和作答会话。                                  |
| `src/ui/mock/MockTab.svelte`                                         | 模考配置、冻结试卷作答、计时/恢复、交卷和成绩。                                                                |
| `src/ui/report/ReportTab.svelte`                                     | 报告范围、统计、图表、行动队列、AI 解读、导出和数据维护。                                                      |
| `src/ui/shared/`                                                     | `Rail` 导航抽屉、`Palette` 命令面板、`SaveStatus` 保存回执、`Icon` 图标和图标路径。                            |
| `src/libs/components/`                                               | 可复用的思源设置表单、设置面板、侧栏 Tab 布局和排版容器。                                                      |
| `src/scss/lv-tokens.scss`、`src/scss/lv-base.scss`、`src/index.scss` | R54 主题 token、插件基础控件、响应式布局和宿主入口样式；Rail 在插件容器 760–1119px 使用图标式侧栏、<=759px 显示抽屉和底部任务栏，内容样式还有 960px、820px、760px、720px、600px 和 480px 等断点。 |
| `design/prototype-r54/`                                              | R54 原型（`index.html`、`prototype.css`、`prototype.js`）；仅合成数据和内存状态，不连接思源。                  |
| `scripts/visual-harness/`                                            | 本地 Svelte UI harness、截图和 UI 冒烟脚本。                                                                   |
| `tests/`                                                             | Vitest 领域/适配/回归测试及思源 stub。                                                                         |
| `public/i18n/`                                                       | `zh-CN.json`、`en.json` 平铺国际化字典，构建时复制为 `dist/i18n/`。                                            |

## 3. 原型与生产界面的对应关系

R54 原型的页面导航是“今日、题库、出题、模考、复盘、设置、上手与示例”等任务面；生产侧为了保持既有思源 Tab 契约，仍由三个宿主 Tab 承载。下表是任务入口映射，**不表示原型和生产功能等价**：原型固定合成数据只演练页面与状态，生产侧还包含真实题库读写、内核调用、审核队列和数据维护。

| 原型任务面/状态                                             | 生产承载                                                                                                                             | 事实源                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| 今日、题库、练习、背诵、错题、导入、手工录题、AI 出题、资料 | `PracticeTab` 的 `entry`、`browse`、`session`、`recite`、`wrongbook`、`import`、`manual`、`ai`、`materials`                          | `ExamApp` 题库、作答流水、资料和保存闸门              |
| 模考配卷                                                    | `MockTab` `config`                                                                                                                   | `src/core/mock.ts` 的蓝图校验与组卷                   |
| 模考专注作答                                                | `MockTab` `exam`                                                                                                                     | `MockSession`、运行快照、计时器和答案流水             |
| 本场成绩、历史                                              | `MockTab` `report`                                                                                                                   | 模考成绩与历史读回                                    |
| 复盘概览、考点与错题、记录与证据                            | `ReportTab` 的 `reportSection` 三分区                                                                                                | `src/core/report.ts`、`weekly.ts`、作答事件和报告范围 |
| 命令面板、窄屏导航、保存回执                                | `Palette`、`Rail`、`SaveStatus`                                                                                                      | 当前可见 Tab 的命令、焦点与 `SaveGate`                |
| 今日页近七天节奏                                           | 展示按当前自然日滚动的 7 日图形；正常态固定合成样例，另有显式零记录态。960px 以下周卡堆叠显示。                                       | 展示全题库本地作答流水的近 7 个自然日；示例练习与纸笔回录成功后刷新派生数据，空记录时说明后续如何产生数据。 |
| 首次进入引导                                               | 零作答时展示三步上手卡，提供导入/手工/AI、开始练习、报告入口；可跳过，首条作答后自动消失。                                             | 生产仅在有可练题且尚无作答记录时显示，并持久保存跳过选择；原型以本页合成状态镜像入口和状态。                |
| 原型 `loading` / `error` / `empty` / `partial` / `unknown`  | 生产相关页面分别实现了部分加载骨架、错误提示/重试、无题库守卫、历史降级和保存未知状态；演练状态选择器不进入生产，未覆盖边界见第 8 节 | 真实请求和保存状态，禁止用固定合成数填充              |

上表只说明任务入口和部分指定状态的映射，不代表交互、数据规则、字段语义或响应式断点完全相同。当前已知差异如下，未完成双向核对的部分不得标记为“已镜像”：

| 功能面                   | R54 原型当前表现                                                                                                                                                        | 生产实现与边界                                                                                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 练习/模考答案输入        | 数值样例显示单位和容差；判分镜像生产的宽容数值解析、最长单位后缀、等价单位换算、绝对/相对容差；多空按位置、候选答案和大小写策略判分。多空以 `;;` 保存位置，草稿按题隔离。 | 生产使用 `structuredAnswer` 规则；原型以独立 JavaScript 函数镜像并由浏览器 smoke 覆盖容差边界。生产与原型的判分规则已对齐，超长数值、非法规格等更广边界仍需继续覆盖。 |
| 题库浏览详情（Peek）     | 点击题目从右侧滑出 Peek 抽屉（移动窄屏为底部 Sheet），不打断左侧列表滚动位置与筛选状态；包含完整题面、判分规格、考点来源、学习证据与快速练题/编辑操作。 | 生产已实现 R54 规格 Peek 抽屉（桌面右滑抽屉 + 移动端底部 Sheet），高亮激活行 `.active-peek`；内嵌完整编辑、修订历史、思源打开、反链、资料关联、作答回执下钻、AI 错因假设与闪卡生成，支持 Esc 键与遮罩平滑退出并归还焦点。 |
| 手工录题工作台           | 内容编辑与真实题面并置（Studio Split View），题型选择即时联动；支持数值单位/容差、多空逐空判分提示与自评要点；支持“换一道空白题”草稿重置。 | 生产表单实现左侧字段录入、右侧真实题面所见即所得双栏预览（单选/多选/判断微键帽选中态、数值单位/容差提示、多空逐空输入框模拟、简答自评提示）；支持换题草稿重置并读写本地草稿保护。 |
| 出题工作台与资料闭环     | 出题面（Studio）统一聚合手工录题、资料、批量导入与 AI 出题四个子分面；资料详情支持“带入手工录题”与“带入 AI 材料”，单条笔记支持直接出题。 | 生产已在手工录题、资料、导入、AI 出题四大页面顶部落地统一的 Studio Nav Tabs 分面切换栏；资料详情已打通一键带入录题与一键带入 AI 材料，每条笔记支持直接带入草稿出题。 |
| 模考蓝图与估分           | 有固定的配额不足演练和基础题量/时长表单；蓝图错误态明确提示原型不提供编辑/保存。成绩是本页演示结果，没有生产估分历史语义。                                              | 生产支持蓝图分区/配额编辑、显式保存和恢复，并提供考后估分与历史；这些写入、恢复、算法和历史行为不能由原型状态切换代替验收。                                                                                                         |
| 报告范围                 | 页头与说明弹窗列出日期范围、当前题库和全局指标口径；仍仅切换“今天/近 7 天”摘要，固定示例图表不会真实筛选。                                                          | 生产范围有全部/今天/近 7 天/近 30 天及题库选择；作答统计、题库掌握度、热力图、连胜和消灭错题各有明确过滤口径，周对比固定按本周/上周自然周计算并标注，不是所有指标都按同一范围过滤。 |
| 薄弱考点下钻             | 点击“查看对应题目”后按考点词筛选题库。                                                                                                                                 | 生产点击后通过页签路由进入报告当前题库的浏览页，并预填考点搜索词；在 `smoke-sample-ui.mjs` 中验证搜索值和题目列表，再由用户决定开始练习。                                                                                       |
| 导入、AI、资料和宿主故障 | 固定合成数据与内存状态；错误场景由演练按钮触发，不读取真实文件、不访问 AI 服务，也不执行真实宿主持久化。                                                                | 生产导入涉及文件解析、映射、重复策略、属性读回和部分失败；AI 涉及端点、取消边界、候选审核及保存；资料涉及内核读写；思源对话框、窗口打开、下载等宿主动作也有平台差异。原型的重试和错误文案只验证展示流程，不能证明这些故障流程正确。 |
| 响应式断点               | R54 主画布使用 `1119px`、`960px`、`759px`、`359px` 容器断点；`850px` 是原型评审外框断点。状态 smoke 检查空/错误态溢出；今日周节奏在 960/900/759/390px 保留并改为堆叠。             | 生产 Rail 与原型统一为 760–1119px 图标侧栏、<=759px 抽屉和底部任务栏；内容样式还有 `960px`、`820px`、`760px`、`720px`、`600px`、`480px` 等局部断点。已检查 760/759px、390px 截图和宽窗口窄面板几何；逐档视觉/交互对照仍待补。 |

## 4. UI 状态契约

所有含数据的页面应能够区分以下状态，且反馈必须指向具体操作：

| 状态   | 生产表现要求                                                                     | 现有实现/核对点                                                                                                                               |
| ------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 空闲   | 控件可操作，按钮文案说明动作和目标。                                             | 题库选择、范围选择、开始练习/模考等入口。                                                                                                     |
| 加载中 | 显示状态文本或骨架，锁定会导致重复请求的控件，保留可安全重试的入口。             | `loading`、`scopeLoading`、`reportRefreshing`、`starting`、`submitting`、`materialsBusy`、AI busy 等状态；页面按钮用 `disabled`/`aria-busy`。 |
| 成功   | 给出明确回执并把用户送到下一步或保留当前上下文。                                 | `showMessage`、保存状态回执、完成页、成绩页和读回后的列表刷新。                                                                               |
| 失败   | 区分网络/内核、输入校验、权限/配置和未知结果，保留用户输入，提供重试或修复动作。 | 页面错误区、`SaveStatus` failed/unknown、AI 错误区和导入错误行。                                                                              |
| 空结果 | 说明“没有数据”和“尚未读取”不同，提供创建示例、录题、导入或回到练习的引导。       | 无题库守卫、报告空态、错题空态、资料空态和候选空态。                                                                                          |

破坏性操作（批次回滚、清空数据、删除/覆盖、放弃模考）须经过确认；可撤销操作应在保存回执中保留撤销入口。模考交卷和练习提交必须锁定重复触发，恢复运行快照不能重复交卷。长文本使用 `overflow-wrap:anywhere`/截断规则，题型控件按选择、填空、判断、解答规格渲染，不能让上一题答案泄漏到下一题。

## 5. 脚本索引

### `package.json` scripts

| 命令                                | 用途                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm dev` / `pnpm dev:app`         | 开发 watch 构建到 `dev/`，开发 sourcemap 和 livereload。                             |
| `pnpm check`                        | 顺序执行 `check:types`、`check:svelte`、`check:i18n`、`check:arch`、`check:styles`。 |
| `pnpm check:types`                  | 使用两个 tsconfig 检查浏览器源码和 Node/Vite 配置类型。                              |
| `pnpm check:svelte`                 | 执行 `svelte-check`，校验 Svelte 模板与组件类型。                                    |
| `pnpm check:i18n`                   | 校验中英文翻译键、占位符和源码字面量覆盖。                                           |
| `pnpm check:arch`                   | 校验插件入口、Tab、内核依赖边界、事件命名和版本契约。                                |
| `pnpm check:styles`                 | 检查 SCSS token 和颜色使用约束。                                                     |
| `pnpm metrics:style`                | 输出源码样式快照：裸 px/ms、颜色函数、内联 style 属性和 `lv-*` token 种类。             |
| `pnpm guard`                        | 顺序执行 `check`、`lint` 和 `test`。                                                 |
| `pnpm lint` / `pnpm lint:fix`       | ESLint 检查/自动修复。                                                               |
| `pnpm format` / `pnpm format:check` | Prettier 写入/检查。                                                                 |
| `pnpm test` / `pnpm test:watch`     | Vitest 单次/监听测试。                                                               |
| `pnpm commit:check`                 | 按 Conventional Commits 规则校验当前提交信息。                                       |
| `pnpm build` / `pnpm build:app`     | 清理后生产构建，生成 `dist/` 和 `package.zip`。                                      |
| `pnpm verify:package`               | 检查 `package.zip` 是否只含发行白名单文件。                                          |
| `pnpm release:check`                | 版本/i18n/依赖/CHANGELOG/构建/包/文档本地链接检查。                                  |
| `pnpm smoke:ui`                     | 本地可视化 harness UI 流程冒烟。                                                     |
| `pnpm smoke:recite-responsive`      | 构建 harness 并检查背诵评分在窄屏、窄分栏、暗色和放大文字下的布局、触达尺寸与保存回执。 |
| `pnpm perf:ui`                      | Chrome 单文件 UI harness 性能采样（主界面 shell 可见、Tab 首次挂载/切换、节点数、CLS、长任务及 p50/p95；不等于用户输入可交互性）。 |
| `pnpm build:harness`                | 构建真实 Svelte 组件的本地视觉/性能 harness。                                        |
| `pnpm preflight`                    | 运行中的思源内核 API 预检（写型、隔离工作区）。                                      |
| `pnpm smoke:data`                   | 思源隔离内核中的数据生命周期、属性读回和批量事务冒烟。                               |
| `pnpm smoke:csv`                    | 思源内核中的 CSV/原生题库包导入导出走查。                                            |
| `pnpm perf:bank`                    | 思源隔离内核中的指定题量写入/检索性能测量。                                          |
| `pnpm smoke`                        | 顺序执行 `preflight`、`smoke:data`、`smoke:csv` 和 `perf:bank`。                     |
| `pnpm e2e`                          | 指定思源工作区的只读数据层走查。                                                     |
| `pnpm make-link`                    | 交互选择思源工作区并将 `dev/` 软链到插件目录。                                       |
| `pnpm make-link-win`                | Windows 专用脚本：必要时提权后创建开发软链。                                         |
| `pnpm make-install`                 | 生产构建并复制到思源插件目录。                                                       |
| `pnpm clean`                        | 删除 `dist/` 和 `package.zip`。                                                      |
| `pnpm update-version`               | 交互式同步更新 `package.json` 与 `plugin.json` 版本。                                |

### 独立脚本

| 文件                                                | 用途                                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/smoke-preflight.mjs`                       | 验证内核端点、临时笔记本/文档/卡片生命周期，并在默认情况下跳过真实 AI ping。                                                              |
| `scripts/smoke-data.mjs`                            | 验证导入、异步属性读回、批量改属性和批次回滚。                                                                                            |
| `scripts/smoke-csv.mjs`                             | 验证 CSV 往返、原生题库包导出/导入路径；部分无头宿主能力只作警告。                                                                        |
| `scripts/perf-bank.mjs`                             | 在隔离内核中写入指定题量并测量写入、SQL 检索和渲染基线。                                                                                  |
| `scripts/smoke-e2e.mjs`                             | 读取指定思源工作区的插件部署态、petal 存储和只读数据层，不会猜测固定工作区。                                                              |
| `scripts/check-i18n.mjs`                            | 检查中英文键集合、空值、占位符和源码字面量使用覆盖。                                                                                      |
| `scripts/check-arch.mjs`                            | 检查入口、三 Tab、内核依赖边界、事件前缀、AI 闸门和版本一致性。                                                                           |
| `scripts/check-styles.mjs`                          | 审计 `src` 中颜色裸值，要求产品色集中在 `lv-tokens.scss`。                                                                                |
| `scripts/style-metrics.mjs`                         | 记录 UI token 收敛前后可复核的源码指标。                                                                                                  |
| `scripts/gen-assets.mjs`                            | 使用零依赖 PNG 编码器生成根目录 `icon.png` 与 `preview.png`。                                                                             |
| `scripts/siyuan_live_reload.ts`                     | Vite 开发模式的 livereload 插件；由 `vite.config.ts` 引入，按插件名派生端口。                                                             |
| `scripts/utils.js`                                  | 共享的思源目录发现、目标选择、复制目录和符号链接工具。                                                                                    |
| `scripts/make_dev_link.js`                          | 查找思源插件目录、创建 `dev/` 开发链接。                                                                                                  |
| `scripts/make_install.js`                           | 将生产构建目录复制到选择的思源插件安装位置。                                                                                              |
| `scripts/update_version.js`                         | 交互更新 `package.json` 与 `plugin.json` 的版本。                                                                                         |
| `scripts/clean.js`                                  | 删除生产构建目录与压缩包，供 `pnpm build` 使用。                                                                                          |
| `scripts/verify-package.mjs`                        | 验证发行 zip 的目录结构、文件清单与白名单。                                                                                               |
| `scripts/release-check.mjs`                         | 发版前验证版本、翻译、依赖、构建、归档与 Markdown 本地链接。                                                                              |
| `scripts/lib/smoke-kernel.mjs`                      | 内核冒烟测试共享目标解析、认证、隔离和临时数据清理逻辑。                                                                                  |
| `scripts/elevate.ps1`                               | Windows 下为安装/软链操作请求管理员权限。                                                                                                 |
| `scripts/visual-harness/vite.config.ts`             | 把真实三个 Tab 与 harness stub 构建成 `output/harness`，不进入发行包。                                                                    |
| `scripts/visual-harness/index.html`                 | harness 的宿主页面容器。                                                                                                                  |
| `scripts/visual-harness/main.ts`                    | 挂载真实 Svelte Tab 到 harness 并暴露测试驱动接口。                                                                                       |
| `scripts/visual-harness/siyuan-stub.ts`             | 为 harness 提供思源 API stub 和本地存储环境。                                                                                             |
| `scripts/visual-harness/smoke-ui.mjs`               | 真实 Svelte UI 的作答信心、改答、模考刷新恢复、过期快照和 AI 降级走查。                                                                   |
| `scripts/visual-harness/smoke-report-actions.mjs`    | 报告行动取消确认、写入期间锁定、成功回执和列表刷新失败降级。                                                                             |
| `scripts/visual-harness/smoke-sample-ui.mjs`        | 示例题库、题型控件、逐题草稿、无库入口、报告分区，以及练习/模考配置/报告视图 16 个生产断点边缘溢出检查。                                  |
| `scripts/visual-harness/smoke-shared-ux.mjs`        | 命令面板、键盘导航、导航抽屉、遮罩和焦点恢复回归。                                                                                        |
| `scripts/visual-harness/smoke-workflows-ux.mjs`     | 导入提交/试导、手工录题、资料保存失败重试、AI 候选审核和会话工作流回归。                                                                  |
| `scripts/visual-harness/smoke-prototype-states.mjs` | 原型状态导航、首用引导键盘/矮屏滚动、空/错误/加载反馈、重试、18 个视口边缘溢出和浏览器异常检查。                                      |
| `design/prototype-r54/smoke-report-scope.mjs`      | 报告统计口径、固定示例图表、今日战报预览及 390/320px KPI 布局检查。                                                                       |
| `design/prototype-r54/smoke-structured-answers.mjs` | R54 数值/多空输入、题目答案隔离、空答案锁定、手工录题数值规格预览、切题确认和 360px 窄屏 smoke；需设置与原型状态 smoke 相同的浏览器路径。 |
| `scripts/visual-harness/shoot.mjs`                  | 生成生产 UI 主页面截图。                                                                                                                  |
| `scripts/visual-harness/shoot-views.mjs`            | 生成各视图路由的生产 UI 截图。                                                                                                            |
| `scripts/visual-harness/shoot-panels.mjs`           | 生成抽屉、弹窗和面板状态截图。                                                                                                            |
| `scripts/visual-harness/shoot-full.mjs`             | 生成生产 UI 全页截图。                                                                                                                    |
| `scripts/visual-harness/shoot-prototype.mjs`        | 生成原型页面基线截图，用于视觉对照，不代表生产数据。                                                                                      |
| `scripts/visual-harness/make-icon.mjs`              | 生成插件图标资源。                                                                                                                        |
| `scripts/visual-harness/make-preview.mjs`           | 生成集市预览图。                                                                                                                          |
| `scripts/visual-harness/make-social.mjs`            | 生成社交预览图。                                                                                                                          |

`scripts/visual-harness/` 的 Playwright smoke 与截图生成脚本均使用共享浏览器启动器；缺少浏览器时只影响截图和 UI harness，不影响生产构建。`output/` 被 `.gitignore` 忽略，截图不能作为发行包文件。

## 6. 环境变量与参数

| 变量                         | 用于                                             | 默认/要求                                                  |
| ---------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| `SIYUAN_PLUGIN_DIR`          | `make-link` 自动指定 `data/plugins` 父目录。     | 自动发现失败时必填；不是 API token。                       |
| `SIYUAN_BASE_URL`            | 内核冒烟目标地址。                               | 默认 `http://127.0.0.1:6806`；隔离实例通常使用另一个端口。 |
| `SIYUAN_TOKEN`               | 内核冒烟认证。                                   | 写型/读型脚本需要；不提供默认密钥。                        |
| `SIYUAN_WORKSPACE`           | `smoke-e2e` 的工作区路径。                       | 必须显式提供或作为位置参数传入。                           |
| `SIYUAN_E2E_ALLOW_SHARED=1`  | 豁免共享工作区防呆。                             | 默认不允许；仅在确认写入风险时使用。                       |
| `SIYUAN_E2E_AI=1`            | 启用预检中的真实 AI ping。                       | 默认跳过，可能产生模型费用。                               |
| `PLAYWRIGHT_EXECUTABLE_PATH` | Playwright smoke 使用的浏览器可执行文件路径。     | 可选；未设置时自动查找 Edge、Chrome 或 Playwright Chromium。 |
| `NODE_ENV`                   | Vite 开发/生产判断。                             | `dev` 脚本设为 `development`，构建脚本设为 `production`。  |
| `VITE_SOURCEMAP=inline`      | 开发内联 sourcemap。                             | `pnpm dev` 自动设置；生产构建不启用。                      |
| `VITE_BUILD_TARGET=app`      | 构建目标标记。                                   | 当前支持 app；不要自行切换未实现的 kernel 目标。           |

插件运行时的 AI endpoint、模型、密钥、考试日期等在思源插件设置中配置，不从 `.env` 读取。密钥不应提交到仓库或写进冒烟脚本。

## 7. 构建与部署

### 本地部署

1. `pnpm install --frozen-lockfile`。
2. `pnpm guard`、`pnpm build`、`pnpm verify:package`、`pnpm release:check`。
3. 在目标思源中通过集市/已安装插件或 `pnpm make-install` 安装 `package.zip`/`dist/`。
4. 重载插件，确认三个 Tab、示例/导入、练习提交、模考交卷、报告读取和错误重试。

### GitHub Release

`plugin.json` 与 `package.json` 版本必须一致。提交版本变更和 CHANGELOG 后创建 `v<version>` tag 并推送；`.github/workflows/release.yml` 会安装 Node 24/pnpm、运行 `pnpm guard`、构建、包白名单、发版检查、生成 SHA256，再上传 `package.zip` 和 `SHA256SUMS`。集市 PR 还需要按思源 bazaar 的要求在真实目标版本和平台完成宿主走查；CI 全绿不能代替真机证据。

## 8. 验收记录与未完成事项

### 当前审计（2026-10-18）

当前最终通过 `pnpm check` / `pnpm guard`：117 个测试文件 / 704 项测试（新增 `TabAppRegistry` 4 项回归），Svelte 0 错误 / 0 警告，1278 个 i18n 键及 42 项架构检查，类型、样式和 lint 通过。`pnpm build`（Vite `index.js` 1,253.18 kB / CSS 107.03 kB）、9 个文件包校验和 `release:check` 8/8（367 个链接）通过；最终 `dist` 9 个文件逐一 hash 校验后部署到隔离宿主。资料关联题数响应式刷新、启动命令队列语义及 workflow 回归已纳入本轮。浏览器 harness 与真实内核证据分开记录，详情见本页顶部链接的审计。

当前隔离宿主为 SiYuan 3.8.8-alpha.3（6817）/ Chrome browser-desktop / 插件 v0.10.4。历史布局两轮各 5 次入口点击 + 10 次重载通过；清理旧恢复页签后以 `smoke-host-ui.mjs --reloads 20 --settle-ms 1500` 单会话通过，练习页签 1→1，顶栏 1、状态栏 0、Dock 0、主页面可见、运行时 0.10.4、`pageErrors=[]`、`diagnostics=[]`、`horizontalOverflow=0`；最终 dist 与宿主 index.js/index.css/plugin.json SHA256 一致。最终包资料笔记回归 `before=4`、`after=5`，切换/重载读回、文件仅一条 marker、`errors=[]`；harness 取消删除、失败保留正文、成功 2→1 计数均通过。只读 E2E 最新为 10 pass / 12 wait / 0 fail，当前包含 47 条作答事件（17 条模考事件）、2 份资料、5 条笔记；待数据不计为通过。`report-actions` 通过。此前已完成练习、错题复练、手工 1 题 + CSV 2 题读回及模考恢复交卷，模考进度 7/7，最终得分 4/7（57.1%）。日常主宿主安装态 v0.10.3 不作本轮验收依据。

探索阶段连续立即启动多个宿主 smoke 会话时曾出现 `{code:410,msg:'Plugin lifecycle has ended'}` 和空白，记录为 `output/host-ui-smoke-before-tab-ownership-fix.json`。现已通过按实例管理的 `TabAppRegistry` 修复同 type 页签互相误卸载的确定性缺陷；并将真实宿主主内容 44px 横向溢出修到 0，移除 harness 全局盒模型 reset，避免掩盖生产样式。干净重启隔离内核后两轮证据为 `output/host-ui-smoke-tab-ownership-round1.json`、`output/host-ui-smoke-tab-ownership-round2.json` 及最新重载截图，资料证据为 `output/host-material-notes-final.json` / `.png`。这些结果只证明当前隔离环境及本轮次数内通过，410 仍是需关注的宿主生命周期时序边界，不表示所有平台启动问题已根治。宿主交互回归入口为 `scripts/smoke-host-ui.mjs`，必须显式指定隔离 URL 与 workspace。

当前 Chrome harness 结果：`smoke-ui` 12/12，`sample-ui` 19 项通过（含 16 个断点无横向溢出、无页面错误），`shared-ux` 9 项及 workflow 全部通过；新增 `smoke-recite-responsive` 覆盖背诵评分窄屏/窄分栏、暗色、放大文字和评分保存；资料关联题数新增/改链/解绑回归通过；`shoot-views.mjs` 已改用共享 Chrome 启动器并更新为当前“确认作答”文案，8 张审计截图重新生成。测试使用固定真实形状的种子题，文案断言已跟随当前提交/完成状态修正。

当前桌面只有一个顶栏入口，无独立 Dock/状态栏；移动端通过命令/块菜单兜底和页内导航。真实 AI、Android、打卡桥、TTS 发声、打印、下载、剪贴板、外部阅读器和完整读屏仍需相应设备/服务验收。题目生命周期、完整来源证明、全部历史作答冻结修订和发布守卫尚未接通生产闭环；模考已存在的冻结卷不等于全部题目历史已冻结。

### 历史核验（2026-10-16 · v0.10.1）

以下段落保留当时的源码、安装版本和输出；不代表 v0.10.4 已重跑同一检查。当时的状态栏/Dock 和待办顺序已被当前入口与旅程证据更新。

2026-10-16 v0.10.1 发布核验：`pnpm guard` 已通过，包含 115 个测试文件 / 661 项测试、类型检查、Svelte（0 错误 / 0 警告）、1200 个 i18n 键、42 项架构检查、样式与 lint。本版修复示例题库写入回执缺项时的文档回读确认，修正只读 e2e 实际存储路径与合法空快照审计，并新增 CLI 回归。生产构建、9 文件包白名单、8/8 发版检查和生产依赖审计通过。产物为 `dist/index.js` 1,201,594 bytes、`dist/index.css` 87,373 bytes、仓库根目录 `package.zip` 669,931 bytes；远端 tag、CI 与资产以该版 Release 记录为准。

本轮临时隔离 SiYuan 3.8.7 宿主的安装态为 v0.10.0，不代表 v0.10.1 已完成安装/升级验收。将隔离 workspace 的 `bazaar.trust` 设为 `true` 后，Chrome `browser-desktop` 实际加载顶栏、状态栏、错题本停靠入口和练习台；原创示例 12 题已由文档回读和 SQL 属性计数确认。已走通单选、填空与正确反馈/解析，重载后确认 2 条 v2 作答事件（1 错、1 对）和 `session/active.json`。修正审计脚本后，同一 workspace 的只读 e2e 为 3 通过、19 待数据、0 失败。隔离写型 smoke 通过 preflight 16/16、数据 6/6、CSV 5/5 和 500 题性能；headless 原生导出路径取回 404、无有效 ZIP 时跳过 multipart 导入仍为 WARN。临时实例已停止，桌面主实例未用于写型检查。

本轮此前 Chrome `pnpm smoke:ui` 两次最终均 12/12，`pnpm smoke:report-actions` 通过。首次 smoke 的一次键盘断言在自动重跑和后续独立复跑中均通过，未稳定复现。UI harness 构建通过，Vite 单块超过 500 kB 提示仍存在。基础宿主练习不替代错题复练、模考暂停/恢复/交卷与报告核对、UI 导入及完整恢复、Android 和真实 AI 验收。下一批先完成这些宿主旅程，再做 `PracticeTab` 拆分；Android 有设备时单独验收，条件扩展继续延后。

**历史包体（2026-10-15 · v0.10.0）**：JS 1,201,435 bytes / gzip 376.86 kB、CSS 87,373 bytes / gzip 13.27 kB、根目录 `package.zip` 669,268 bytes。v0.10.0 Release 已含 `package.zip` 和 `SHA256SUMS`。这些数值不代表 v0.10.1 最终产物。

可复现的自动验收入口包括 `pnpm check`、`pnpm guard`、`pnpm build`、`pnpm verify:package`、`pnpm release:check`、`pnpm metrics:style`、`pnpm perf:ui`、生产 UI harness 的 `pnpm smoke:ui` 和 `pnpm smoke:report-actions`，以及 `node scripts/visual-harness/smoke-prototype-states.mjs`、`node scripts/visual-harness/smoke-sample-ui.mjs`、`node scripts/visual-harness/smoke-shared-ux.mjs`、`node scripts/visual-harness/smoke-workflows-ux.mjs` 和 `node design/prototype-r54/smoke-structured-answers.mjs`。以下是 2026-10-14 的历史验收记录，不代表当前构建或测试数字：当日以 Chrome 重跑 `pnpm guard`（114 个测试文件/655 项）；主流程在模考快照失败重试路径下 12/12；`pnpm smoke:ui` 12/12、`pnpm smoke:report-actions`、包白名单校验（9 个文件）和 `pnpm release:check`（8 项）通过。此前示例题库与 16 个生产断点边缘、共享导航/键盘、导入/录题/资料/AI 工作流、原型状态演练（18 个视口边缘）也有通过记录。浏览器无未捕获错误。当日生产构建 `dist/index.js` 为 1,200,898 bytes（Vite 报告 1,200.89 kB，gzip 376.69 kB），`dist/index.css` 为 74,561 bytes（gzip 12.00 kB），`package.zip` 为 666,774 bytes；发行包白名单 9 个文件校验通过。这些自动检查不提供逐像素比较、生产全控件逐一点击、完整断点逐档视觉对照或真实宿主证据。运行结果必须以本次命令输出为准，旧截图不能证明当前宿主行为。

当时仍需真实宿主或后续版本确认的范围（当前已通过和仍待验部分见本节开头及审计快照）：

- 错题复练、模考暂停/恢复/交卷和报告核对；宿主 UI 导入、题块读回、保存失败、完整重载恢复与跨窗口同步；
- Android WebView 的软键盘、触摸、下载、打印、剪贴板、`window.open` 和安全区；
- 真实 AI 端点的取消、迟到响应隔离、费用、发送范围和权限；
- 超过 5000 道题的宿主性能、完整读屏、200% 缩放、forced-colors、第三方主题和卸载资源释放；
- OCR 接入。当前研究记录仍以思源 3.8.7 正式版为前置，原型和生产页面都不应显示“已支持 OCR”；
- R54 任务面并未被拆成多个真实宿主 Tab，生产路由继续遵循既有三个 Tab 契约；
- 原型的合成趋势、固定示例题和演练状态选择器不进入真实成绩、报告或持久化数据。
- 原型与生产尚未完全互为镜像：手工录题的多空作者规格与持久化草稿恢复、模考蓝图编辑与估分历史、报告真实范围口径、导入/AI/资料/思源宿主错误流程，以及生产内容样式的 960/820/760/720/600/480px 局部断点仍有未覆盖或语义差异；答案输入差异见第 3 节。
- 原型和生产 UI 还没有自动化逐控件全集审计，也没有逐像素差异报告；本次新增 smoke 扩展了代表性路径和状态覆盖，但不能证明每个可见按钮、链接、图标按钮、筛选器和弹窗都通过了单独触发测试。
- 内核读请求已在 `KernelApiClient` 收口去重、latest-wins、超时/取消和有限重试；renderer 之外的宿主调用仍不能据此视为全部共享同一请求注册表。
- 本地插件存储写入已统一经过 `SaveGate.runLatest` 和按键串行化，覆盖失败回滚、读失败只读保护与模考/估分/AI/check-in 等读改写；思源写接口仍没有已确认的服务端幂等 key，因此不能把所有宿主写操作描述成具备服务端幂等。
- 插件没有独立登录/权限路由；内核授权由思源宿主提供。token 过期、无权限占位和登录后回跳未在真实宿主环境验证。
- 每一数据操作统一具备 idle/loading/success/failure/empty 五态并未逐项验收；本次修复了审计命中的错误回执，但个别页面动作和真实宿主故障反馈仍需逐项核查。

性能实验命令：在 PowerShell 中先运行 `pnpm build:harness`，再分别执行 `$env:PERF_RUNS = "20"; pnpm perf:ui:measure` 和 `$env:PERF_LAZY_TABS = "1"; pnpm perf:ui:measure`；实验后可运行 `Remove-Item Env:PERF_LAZY_TABS` 清除变量。第二次运行只在 harness 里延迟初始化 Tab，不会生成发行分块，也不代表生产启用了懒加载。

### 历史验收要求复核（2026-10-14）

| 验收面             | 当前证据与结论                                                                                                                                                                                                     | 尚欠的验证或实现                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原型/实现对应      | R54 已加入练习、资料、模考、报告的指定加载/错误/空状态与结构化答案输入样例；状态 smoke 覆盖状态导航、重试和原型断点边缘溢出。数值主/替代单位、容差判分现已镜像并有浏览器回归。                                                       | 不代表原型与实现完全镜像；模考蓝图/估分、报告范围、导入/AI/资料/宿主错误流程以及页面局部响应式断点仍有明确未覆盖或语义不同项。没有逐像素差异基线，也没有全部断点视觉/交互对照。 |
| 按钮和路由可用性   | 2026-10-14 实跑生产 Svelte 测试台：smoke-ui 11/11；smoke-shared-ux、smoke-workflows-ux、smoke-sample-ui、smoke-prototype-states 均通过。覆盖三 Tab 导航、窄屏抽屉、报告下钻、主要练习/模考/导入/资料/AI 路径，浏览器未捕获异常为 0。 | 不是全部可见控件逐个触发。产品使用思源自定义 Tab 和页内视图，没有浏览器 URL/history 路由；浏览器前进/后退不是页内导航契约。宿主公开 API 深链接、刷新后的页内子视图、筛选/滚动位置恢复、多窗口仍待思源桌面验证；当前只恢复最近的自定义 Tab。 |
| 数据异步状态       | 本次补齐模考/估分历史加载、失败重试与空结果；估分写入失败重试；报告存储占用的加载/成功/失败/空结果；数据体检部分失败标不完整并重试；Practice 的修订历史、智能视图、反链及 Glean 操作错误有可见恢复入口。相关 UI smoke 覆盖代表性成功、失败和重试路径。 | 不能据此声称所有数据操作都具备并逐一通过统一五态；真实内核故障注入、慢响应/竞态的全量覆盖尚未跑。 |
| 表单校验与破坏操作 | 本次 smoke 实测估分答案长度错误关联到输入字段、保存失败可重试；模考蓝图恢复/分区删除和放弃模考有确认；另有录题字段聚焦、错题处置失败恢复、导入映射回滚与收藏失败恢复的既有回归。 | 不是所有页面字段都逐项自动化点测。思源 Dialog 的键盘/焦点契约、所有破坏性操作和所有焦点返回仍需宿主逐项核验。 |
| 并发、写入和恢复   | 有局部重复提交锁、模考快照恢复、部分保存回滚和对应测试。                                                                                                                                                           | 无全请求竞态保护/全写操作幂等 key/统一缓存层；权限恢复闭环未实现或未验证。                                                                                                        |
| 响应式与可访问性   | 原型 18 个视口边缘、7 类空/错误状态无横向溢出；生产练习、模考配置、报告概览/证据在 16 个断点边缘无溢出；本轮另有 390px 截图、760/759px 导航断点和窄面板几何 smoke；Rail/Palette 有键盘、焦点恢复 smoke。 | 溢出检查不等于布局形态一致；生产各断点与原型仍无逐档截图/交互对照。完整读屏、200% 缩放、forced-colors 与第三方主题审计待做。                                                        |
| 加载与包体性能     | 2026-10-14 Chrome 1280×900 本地单文件 harness，静态 Tab 20 次隔离页采样：主界面 shell 可见 p50/p95 171/206 ms；首次模考 57/76 ms、报告 62/70 ms、返回练习 42/49 ms；CLS 为 0，DOM 403 节点，最长任务 p50/p95 114/124 ms。该次构建产物快照：JS 1,196,450 bytes / Vite gzip 375.96 kB，CSS 66,943 bytes / gzip 11.15 kB，zip 663,984 bytes（2026-10-15 历史构建体积见本节开头）。 | 同一 harness 的延迟初始化对照 20 次：shell 可见 172/205 ms；首次模考 62/81 ms、报告 65/68 ms、返回练习 45/48 ms；CLS 与 DOM 节点数不变，最长任务 116/129 ms。静态与延迟初始化 harness 资源分别均为 JS 1,263,264 / gzip 401,861 bytes、CSS 66,931 / gzip 10,994 bytes。首屏容器 p50 仅差 1 ms，首模考的 p50/p95 较慢 5 ms，长任务也略高；这组同机测量没有显示稳定收益，因此生产行为保持不变。数据基于 12 道示例题和本地内核桩，不代表思源各宿主。源码没有 <img>、视频/音频或自定义字体资源，不存在图片现代格式/尺寸或字体子集化对象；浏览列表按 200 条分批显示，但没有 1000/5000+ 真实题量宿主数据，也未测出长列表滚动瓶颈，故不引入虚拟滚动。可用本节所列 PowerShell 命令以 `PERF_RUNS=20` 复测；harness 延迟初始化不是生产路由分块。
| 新人交付路径       | 本文给出 clone、Node/pnpm 版本、安装、可选软链、开发、测试、环境变量和部署命令。                                                                                                                                   | `make-link`、真实插件加载和平台部署仍需要目标用户本地思源实例；纯 clone 步骤可用命令验证，宿主路径不能在无实例环境验证。                                                          |

这些限制是有意保留的验收边界，不应在发布说明中写成“已完成”。新功能交付时，应同步更新 `docs/UI-COMPONENTS.md`、本文件的对应状态表、CHANGELOG 和真机证据。
