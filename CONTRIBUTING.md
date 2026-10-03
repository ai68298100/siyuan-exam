# 贡献指南（CONTRIBUTING）

> 小驴考试是本地优先的思源笔记备考插件。单人维护为主，但任何 issue、冒烟反馈、PR 都欢迎。
> 产品定位与范围约束见 [docs/04](docs/04-版本路线图.md)；架构决策见 [docs/adr](docs/adr)。

## 1. 本地开发

```bash
pnpm install                       # 安装依赖
pnpm make-link                     # 软链到思源工作空间（需按提示选择目录/授权）
pnpm dev                           # 监听构建（思源设置-集市重载插件或重启生效）
pnpm preflight                     # 活内核 API 预检（17 项，需思源运行中）
```

真机手工验证按 [docs/17 真机冒烟清单](docs/17-真机冒烟清单.md) 的 40 步执行（A–E 覆盖 v0.5.x，+F 覆盖 v0.6-dev）。

## 2. 门禁（提交前必跑）

```bash
pnpm guard        # 六检：类型 → svelte(0错0警) → i18n 键对齐 → 架构 37 项 → 全量测试 → （构建另跑）
pnpm build        # 生产构建 + 打包
pnpm verify:package  # package.zip 白名单校验
pnpm smoke        # 真机套件（需思源运行）：preflight 17 项 → 数据生命周期 6 步 → 性能基线
```

约定俗成的硬约束（`scripts/check-arch.mjs` 会拦）：

- `src/core/**` 是纯函数层：**禁止 import "siyuan"、禁止 `as any`**（可 headless 单测的保障）。
- 新增契约模块必须登记进 `check-arch.mjs` 文件清单与 docs/03 实际模块清单（误删即门禁失败）。
- i18n：`public/i18n/zh-CN.json` 与 `en.json` 键集合必须一致；代码里新用的字面量键必须存在；动态拼接键前缀登记在 `scripts/check-i18n.mjs` 的 DYNAMIC_PREFIXES。
- 持久化载荷带版本号（`core/migrations.ts` 管版本链），读回必须兼容旧版。

推送由 `.githooks/pre-push` 再拦一遍（启用：`git config core.hooksPath .githooks`）。

## 3. 测试

- 框架 vitest，测试在 `tests/`，与 `src/` 结构大致对应；核心逻辑（core/ai/importer）要求 headless 可测——UI 只做薄接线。
- 新功能至少覆盖：正常路径 + 离线/失败兜底 + 边界（空/超大/并发）。
- 性能基线（`tests/perf.test.ts`）是软上限，只作数量级回归警报。
- 应用编排层测试用 stub 内核（参考 `tests/commitImport.test.ts`、`tests/rollbackBatch.test.ts` 的 stub 模式：记录调用 + 可注入失败/延迟）。

## 4. 提交规范

- Conventional Commits：`feat|fix|docs|test|chore|refactor(scope): 摘要`，scope 用模块名（memory/mock/importer/ai…）。历史记录见 `git log`。
- 一个批次一个里程碑 commit；部分完成的待办在 [TODO](../TODO.md) 保持未勾、附"开发推进"注记。
- 完成待办请勾选并注明版本与验收证据；真机验收项必须附 docs/17 步骤号。

## 5. 报告问题

优先用 issue 模板（bug/feature）；涉及渲染或丢数据的问题请附 [报告中心 → 导出诊断信息] 的剪贴板 JSON（已脱敏，不含题目内容/key/路径）。行为类反馈直接按 docs/17 的 `步骤号 ✅/❌ + 现象` 格式发回。

## 6. 边界（改代码前先读）

- 不引入遥测/上传；AI 仅在用户主动调用时发送所选内容（见 [FAQ](docs/FAQ.md)）。
- 不把启发式掌握度当正式考分；不自动作答改写 FSRS 评级；客观答对不自动建卡/Easy。
- 评分只能由已声明规则或人工确认产生；AI 产物一律先进待审核队列。
- 用户内容归用户：不捆绑、不抓取、不以 AI 改写规避版权。
