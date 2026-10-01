# ADR 0006 — 题库包 = 思源原生 .sy.zip + exam-id diff

日期：2026-10-02 ｜ 状态：已接受 ｜ 关联：docs/02 §2.3、TODO 7.0、research/03（Anki guid）

## 背景
题库包分享有两种路线：自定义打包格式（manifest+JSON，需自研导入器与媒体管理）vs 思源原生 `.sy.zip`（内核导出/导入端点已实测可用）。

## 决策
1. **包格式 = 思源原生 `.sy.zip`**（内核 `exportNotebookSY` 导出、`importSY` 桌面端导入）——零自研打包、天然携带块结构/属性/媒体。
2. **版本化按 `exam-id` diff**：`diffBank` 四分类（新增/更新/移除/未变）供导入前后对比；`hash` 判内容变更。
3. **冲突策略**：同 exam-id 且内容有修订 → 保留用户版本（含其作答流水关联），导入版可选覆盖。
4. manifest/changelog 以笔记本文档形式随包携带（首页文档），不引入自定义二进制段。

## 后果
- 学生侧"导入即得"，作答流水按 exam-id 与原题重连。
- 代价：diff 预览需导入后才能精确执行（zip 内块解析需 jszip 决策，TODO 已列）；跨版本幂等依赖导入者不改动 exam-id。
