<div align="center">

# 🐴 小驴考试 · Lv Exam

**思源笔记的本地题库学习管理插件** —— 题库导入 · 刷题练习 · 模拟考试 · 错题本 · FSRS 闪卡 · AI 出题讲解

> **粉笔的刷题体验 × Anki 的记忆科学 × 思源的知识库**
> 题目不是存在别人的云上，而是一条条可检索、可双链、可同步的**思源块**，长在你自己的知识库里。

[![Release](https://img.shields.io/github/v/release/ai68298100/siyuan-exam?logo=github)](https://github.com/ai68298100/siyuan-exam/releases)
[![CI](https://github.com/ai68298100/siyuan-exam/actions/workflows/check.yml/badge.svg)](https://github.com/ai68298100/siyuan-exam/actions/workflows/check.yml)
[![Tests](https://img.shields.io/badge/tests-151%20passed-brightgreen)](#-开发)
[![SiYuan](https://img.shields.io/badge/SiYuan-%3E%3D%203.8.0-blue)](https://github.com/siyuan-note/siyuan)
[![License](https://img.shields.io/badge/license-MIT-green)](#-开源许可)

<img src="preview.png" alt="小驴考试预览" width="640"/>

*English | [English](README.en-US.md)*

</div>

---

## ✨ 为什么是小驴考试

| 痛点 | 小驴的答案 |
|---|---|
| 题库锁在刷题 App 的云端，导不出来 | **题库 = 你的思源笔记本**：每道题一个块，属性带答案/考点/错因，全文可搜、双链可连、随思源同步 |
| 错题刷过就忘 | **FSRS 记忆调度**（思源内核原生 riff）：错题一键/批量转卡，按记忆科学安排复习，考前 cram 不污染长期调度 |
| 刷题 App 的 AI 讲解要充值 | **自带 Key 的 AI**：出题、逐选项讲解、苏格拉底追问，走思源内置 AI 或你自己的 OpenAI 兼容端点，数据流向明示 |
| 模考功能残缺 | **CBT 引擎**：蓝图组卷、分段计时、答题卡标旗、不定项部分分、lockout、考后估分与成绩单 |

## 📦 功能全景（v0.5.0 已实现）

| 模块 | 能力 |
|---|---|
| 📥 **导入** | Excel/CSV 列映射 · Aiken · 医考**材料组自动分组** · 官方模板一键生成下载 · 拖拽导入 · CSV 编码探测（GBK/BOM）· 错误行清单导出，绝不整批失败 |
| ✏️ **手工录题** | 全题型表单（单选/多选/判断/填空/简答/材料）· 材料组挂靠 · 选项字母点选 |
| 🖥️ **练习台** | 快刷/错题/收藏/每日一练 · 做题-背题双模式 · **键盘流**（A-J 选择 / Enter 提交 / J-K 翻题 / E 收藏 / Esc 退出）· 材料组上下文卡 · 搜索过滤 · 会话续做 |
| 🧠 **错题本** | 错因三分类（粗心/不会/陷阱，含回显）· 连对 2 次自动消灭 · 手动处置覆盖层 · Dock 行内处置 · Markdown 导出 |
| 📅 **每日计划** | 考试倒计时 · 冲刺姿态 · **顽固错题加权回流**（错次 × 错因权重：不会 2.0 / 陷阱 1.6 / 粗心 1.2）· FSRS 到期卡优先 |
| 🔁 **记忆引擎** | 思源内核 FSRS（riff）· 错题转卡（单题/结算页一键批量）· 四级自评映射 · cram 队列 · 背诵页跳回源笔记 |
| 📝 **模考场** | 蓝图配置器（短缺警告/蓝图持久化）· CBT lockout · 不定项部分分 · 分段计时自动切换 · 答题卡标旗 · 成绩单（雷达/历史/周对比）· 考后估分（题库真题序列+来源过滤）· 挑战码 |
| 📊 **报告中心** | KPI · 周对比 · 53 周热力图 · 考点掌握度（FSRS 留存）· 薄弱 Top5 一键组卷 · 时段分布 |
| 🤖 **AI** | 双通道（思源内置 / 自带 Key）· 出题管线（超量+Haladyna 干扰项规范+质量门槛+**二遍换角色核验**+待审核队列+**拒绝项修复重试**）· 材料源支持粘贴与**当前文档** · 逐选项讲解+苏格拉底+多轮追问 · 成本统计 |
| 🔗 **思源融合** | 题块属性契约（`custom-exam-*`）· 查询圈题（query_embed 圈选即练习）· 错题 Dock · 状态栏进度 · `lv-exam:stats` 公开事件 · 题库包 `.sy.zip` 导入导出 |
| 🔊 **听学** | TTS 读题 · 纯听题模式 · 渐进提示链 · 盖答案四级自评 |

<details>
<summary><b>🚧 尚未实现（v1.x 路线，点开查看）</b></summary>

- Word（图片/公式）、GIFT、TSV、Anki apkg 导入
- 专项分类树浏览、整卷练习视图
- 思源数据库（av）题库管理视图
- AI 生成题的源块引用 citation 深化
- 移动端专项打磨、集市上架（等内测门槛）

</details>

## 🚀 快速开始

**安装**（二选一）：

1. **手动安装**：从 [Releases](https://github.com/ai68298100/siyuan-exam/releases) 下载 `package.zip`，解压到 `<思源工作空间>/data/plugins/siyuan-exam/`，重启思源后在 设置 → 集市/下载 启用。
2. **开发安装**：克隆本仓库后 `pnpm i && pnpm make-link`，思源内重载插件。

**30 秒上手**：新建题库（= 一个笔记本）→ 下载官方 Excel 模板填几道题 → 导入 → 「快速刷题」开练。答错的题自动进错题本，「转为闪卡」后由 FSRS 接管复习节奏。

## 🔒 数据与隐私

- **本地优先**：题目、作答流水、错题本全部存在你自己的思源工作空间，无任何遥测。
- **AI 数据流向明示**：仅在你主动触发生成/讲解时，将所选材料发送到你配置的 AI 端点（思源内置 AI 或你自己的 Key）；不配置则 AI 功能完全静默。
- 撤销删除：题库就是笔记本，思源回收站与同步历史照常生效。

## 🏗️ 工程质量

- **151 项单元测试**（判分器/导入解析/重放器/FSRS 映射/AI 管道/内核响应形状回归锁）
- **六重提交门禁**：TypeScript strict → svelte-check（0 警告）→ i18n 双语对齐+使用覆盖率 → 架构一致性 28 项断言 → 构建+打包白名单 → pre-push 钩子
- **活内核预检**：`pnpm preflight` 对运行中的思源做 17 项 API 行为断言（笔记本生命周期/题块写入与属性索引/FSRS 全链路/.sy.zip 导出），SiYuan 3.8.5 实测 17/17，并据此修复 4 处内核 API 漂移

## 🗺️ 文档地图

| 文档 | 内容 |
|---|---|
| [TODO.md](TODO.md) | 开发总账（36 组 446 项，含逐轮回溯审计） |
| [docs/01 PRD](docs/01-功能全景PRD.md) · [docs/02 数据模型](docs/02-数据模型设计.md) · [docs/03 技术架构](docs/03-技术架构.md) | 产品/数据/架构三层设计，03 含内核 API 实测表 |
| [docs/04 版本路线图](docs/04-版本路线图.md) · [CHANGELOG](CHANGELOG.md) | 版本规划与变更记录 |
| [docs/11 UI 规范](docs/11-UI原型与交互规范.md) · [design/prototype](design/prototype/index.html) | 14 屏高保真原型（浏览器直接打开） |
| [docs/15 模板规范](docs/15-题库模板与导入规范.md) | Excel 导入模板字段说明 |
| [docs/17 真机冒烟清单](docs/17-真机冒烟清单.md) | 26 步验收清单 + 预检脚本说明 |
| [docs/adr](docs/adr) | 8 份架构决策记录 |
| [research](research) | 8 份竞品调研（40+ 产品） |

## 🧑‍💻 开发

```bash
pnpm i                # Node >= 24
pnpm dev              # watch 构建 + 热重载
pnpm make-link        # 软链到 <工作空间>/data/plugins/siyuan-exam/
pnpm check            # 类型 + svelte + i18n + 架构一致性
pnpm guard            # 完整 pre-push 门禁链
pnpm test             # vitest（151）
pnpm preflight        # 活内核 API 预检（17 项；需思源运行中）
pnpm build            # dist/ + package.zip
pnpm make-install     # 构建后安装到本机思源插件目录
git config core.hooksPath .githooks   # 启用本地 pre-push 钩子（克隆后一次性）
```

技术栈：Vite 8 · Svelte 5 · TypeScript strict · 思源内核 API（无自建后端）。领域层（判分/重放/计划/导入）为纯函数，全部可离线单测；内核交互收敛于 `src/kernel/client.ts` 并有响应形状回归锁。

## 🤝 反馈

- 🐛 问题反馈：[Issues](https://github.com/ai68298100/siyuan-exam/issues)
- 💬 使用交流：[Discussions](https://github.com/ai68298100/siyuan-exam/discussions)
- 📋 提问时建议附上 docs/17 冒烟清单的步骤号与现象，定位更快

## 🐴 小驴系列

打卡（习惯量化）· 人脉（关系管理）· 快切（效率切换）· 拾遗（输入整理）· **考试（学习输出与检验）**

## 📄 开源许可

[MIT](LICENSE)
