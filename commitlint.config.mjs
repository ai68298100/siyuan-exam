// commitlint（TODO 0 组）：Conventional Commits 校验
// 依赖：pnpm add -D @commitlint/cli @commitlint/config-conventional（联网后执行一次）
// 接入：.githooks/commit-msg 已就绪（core.hooksPath 启用后生效）；依赖未装时钩子静默跳过
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // 仓库历史使用 feat(memory)/fix(mock)/docs(adr)/test/chore 等模块 scope，不强制枚举
    "scope-case": [2, "always", "lower-case"],
    "subject-max-length": [2, "always", 100],
    "subject-empty": [2, "never"],
    "type-enum": [2, "always", ["feat", "fix", "docs", "test", "refactor", "chore", "perf", "style", "build", "ci", "revert"]],
  },
};
