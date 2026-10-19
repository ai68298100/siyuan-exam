// 43-01 全量：题目修订时间线与生命周期发布守卫纯函数测试
import { describe, expect, it } from "vitest";
import {
  appendRevision,
  specChanged,
  diffQuestion,
  formatDiffSummary,
  canTransitionLifecycle,
  questionDraftFromRevision,
  checkPublishGuard,
  validateLifecycleTransition,
  getQuestionLifecycle,
  LIFECYCLE_LABELS,
  MAX_REVISIONS,
  type RevisionStore,
} from "../src/core/revision";

describe("appendRevision（43-01 修订时间线）", () => {
  it("追加并保留最近 10 条（FIFO）", () => {
    let store: RevisionStore = {};
    for (let i = 0; i < MAX_REVISIONS + 3; i++) {
      store = appendRevision(store, "q1", { ts: 1000 + i, answer: `答案${i}` });
    }
    expect(store.q1).toHaveLength(MAX_REVISIONS);
    expect(store.q1[0].answer).toBe("答案3"); // 最早 3 条被挤出
    expect(store.q1[MAX_REVISIONS - 1].answer).toBe("答案12");
  });

  it("答案与考点均未变 → 不重复记录", () => {
    let store: RevisionStore = {};
    store = appendRevision(store, "q1", { ts: 1, answer: "A", kp: "K" });
    store = appendRevision(store, "q1", { ts: 2, answer: "A", kp: "K" });
    expect(store.q1).toHaveLength(1);
  });

  it("答案未变但考点变了 → 记录（考点也是修订面）", () => {
    let store: RevisionStore = {};
    store = appendRevision(store, "q1", { ts: 1, answer: "A", kp: "旧" });
    store = appendRevision(store, "q1", { ts: 2, answer: "A", kp: "新" });
    expect(store.q1).toHaveLength(2);
    expect(store.q1[1].kp).toBe("新");
  });

  it("答案与考点未变但判分规格变了 → 仍记录", () => {
    let store: RevisionStore = {};
    store = appendRevision(store, "q1", { ts: 1, answer: "A", kp: "K" });
    store = appendRevision(store, "q1", { ts: 2, answer: "A", kp: "K", specChanged: true });
    expect(store.q1).toHaveLength(2);
  });

  it("答案未变但题干变了 → 记录全量修订快照", () => {
    let store: RevisionStore = {};
    store = appendRevision(store, "q1", { ts: 1, answer: "A", stem: "题干原版", kp: "K" });
    store = appendRevision(store, "q1", { ts: 2, answer: "A", stem: "题干修订版", kp: "K" });
    expect(store.q1).toHaveLength(2);
    expect(store.q1[1].stem).toBe("题干修订版");
  });

  it("答案未变但解析或选项变了 → 记录全量修订快照", () => {
    let store: RevisionStore = {};
    store = appendRevision(store, "q1", { ts: 1, answer: "A", options: ["选项1", "选项2"], analysis: "旧解析" });
    store = appendRevision(store, "q1", { ts: 2, answer: "A", options: ["选项1", "选项2修改"], analysis: "新解析" });
    expect(store.q1).toHaveLength(2);
    expect(store.q1[1].analysis).toBe("新解析");
  });

  it("所有字段均未变 → 不重复记录", () => {
    let store: RevisionStore = {};
    store = appendRevision(store, "q1", { ts: 1, answer: "A", stem: "题干", options: ["A", "B"], analysis: "解析", kp: "K", difficulty: 3 });
    store = appendRevision(store, "q1", { ts: 2, answer: "A", stem: "题干", options: ["A", "B"], analysis: "解析", kp: "K", difficulty: 3 });
    expect(store.q1).toHaveLength(1);
  });

  it("仅判分规格连续变化时不会被去重", () => {
    let store: RevisionStore = {};
    store = appendRevision(store, "q1", {
      ts: 1, answer: "3.14", answerSpec: { v: 1, kind: "numeric", absTol: 0.01 },
    });
    store = appendRevision(store, "q1", {
      ts: 2, answer: "3.14", answerSpec: { v: 1, kind: "numeric", absTol: 0.05 },
    });
    expect(store.q1).toHaveLength(2);
  });

  it("新快照明确清空的字段与旧快照未记录的字段不视为相同", () => {
    const legacy = appendRevision({}, "q1", { ts: 1, answer: "A" });
    const store = appendRevision(legacy, "q1", {
      ts: 2, answer: "A", analysis: "", kp: "", difficulty: null, answerSpec: null,
    });
    expect(store.q1).toHaveLength(2);
  });

  it("不同题互不干扰", () => {
    let store: RevisionStore = {};
    store = appendRevision(store, "q1", { ts: 1, answer: "A" });
    store = appendRevision(store, "q2", { ts: 2, answer: "B" });
    expect(store.q1).toHaveLength(1);
    expect(store.q2).toHaveLength(1);
  });
});

describe("questionDraftFromRevision（完整回滚快照）", () => {
  const current = {
    id: "q1", type: "fill", stem: "题干当前", options: [], answer: "3.14", analysis: "后来解析",
    kp: "后来考点", difficulty: 4, score: 1, origin: "manual", hash: "h",
    answerSpec: { v: 1, kind: "numeric", absTol: 0.05 },
  } as never;

  it("明确记录的空值会清空字段，并恢复完整 answerSpec", () => {
    const draft = questionDraftFromRevision(current, {
      ts: 1,
      answer: "3.14",
      stem: "题干历史",
      options: [],
      analysis: "",
      kp: "",
      difficulty: null,
      answerSpec: { v: 1, kind: "numeric", absTol: 0.01 },
    });
    expect(draft.analysis).toBe("");
    expect(draft.kp).toBe("");
    expect(draft.difficulty).toBeUndefined();
    expect(draft.answerSpec).toEqual({ v: 1, kind: "numeric", absTol: 0.01 });
  });

  it("旧快照缺少新字段时保留当前字段，兼容历史数据", () => {
    const draft = questionDraftFromRevision(current, { ts: 1, answer: "3.14" });
    expect(draft.analysis).toBe("后来解析");
    expect(draft.kp).toBe("后来考点");
    expect(draft.difficulty).toBe(4);
    expect(draft.answerSpec).toBeUndefined();
  });
});

describe("specChanged（54 联动标记）", () => {
  it("双向缺失视为未变；键序无关的等价对象视为未变；内容不同视为变更", () => {
    expect(specChanged(undefined, undefined)).toBe(false);
    expect(specChanged({ v: 1, kind: "numeric" }, { kind: "numeric", v: 1 })).toBe(false); // 键序无关
    expect(specChanged({ v: 1, kind: "numeric" }, undefined)).toBe(true);
    expect(specChanged({ v: 1, kind: "numeric", unit: "m" }, { v: 1, kind: "numeric" })).toBe(true);
  });

  it("递归比较多空题嵌套字段，字段顺序不影响结果", () => {
    const a = {
      v: 1,
      kind: "multiBlank",
      blanks: [{ answers: ["甲", "乙"], caseSensitive: false }],
    };
    const same = {
      blanks: [{ caseSensitive: false, answers: ["甲", "乙"] }],
      kind: "multiBlank",
      v: 1,
    };
    const changed = {
      blanks: [{ caseSensitive: false, answers: ["甲", "丙"] }],
      kind: "multiBlank",
      v: 1,
    };
    expect(specChanged(a, same)).toBe(false);
    expect(specChanged(a, changed)).toBe(true);
  });
});

describe("diffQuestion & formatDiffSummary（43-01 全量修订 Diff）", () => {
  it("无任何变动时返回空数组，摘要显示无内容变更", () => {
    const q = {
      stem: "1 + 1 等于几？",
      options: ["1", "2", "3", "4"],
      answer: "B",
      analysis: "基础算术",
      kp: "数学/加法",
      difficulty: 1,
    };
    const diffs = diffQuestion(q, q);
    expect(diffs).toEqual([]);
    expect(formatDiffSummary(diffs)).toBe("无内容变更");
  });

  it("支持多字段变动检测，并格式化为人类可读摘要", () => {
    const before = {
      stem: "旧题干",
      options: ["A", "B"],
      answer: "A",
      analysis: "旧解析",
      kp: "旧考点",
      difficulty: 2,
    };
    const after = {
      stem: "新题干",
      options: ["A", "B", "C"],
      answer: "B",
      analysis: "新解析",
      kp: "新考点",
      difficulty: 3,
    };
    const diffs = diffQuestion(before, after);
    expect(diffs.map((d) => d.field)).toEqual(["stem", "options", "answer", "analysis", "kp", "difficulty"]);

    const summary = formatDiffSummary(diffs);
    expect(summary).toContain("题干已修改");
    expect(summary).toContain("选项已修改");
    expect(summary).toContain("答案: A → B");
    expect(summary).toContain("解析已修改");
    expect(summary).toContain("考点: 旧考点 → 新考点");
    expect(summary).toContain("难度: 2 → 3");
  });

  it("判分规格变更时亦能正确捕获 spec diff", () => {
    const before = {
      stem: "计算结果",
      options: [],
      answer: "3.14",
      answerSpec: { kind: "numeric", absTol: 0.01 },
    };
    const after = {
      stem: "计算结果",
      options: [],
      answer: "3.14",
      answerSpec: { kind: "numeric", absTol: 0.05 },
    };
    const diffs = diffQuestion(before, after);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe("spec");
  });

  it("生命周期状态变更时生成 status diff 与可读摘要", () => {
    const before = {
      stem: "题目",
      options: ["A", "B"],
      answer: "A",
      status: "draft" as const,
    };
    const after = {
      stem: "题目",
      options: ["A", "B"],
      answer: "A",
      status: "published" as const,
    };
    const diffs = diffQuestion(before, after);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe("status");
    expect(diffs[0].from).toBe("草稿");
    expect(diffs[0].to).toBe("已发布");

    const summary = formatDiffSummary(diffs);
    expect(summary).toBe("状态: 草稿 → 已发布");
  });
});

describe("canTransitionLifecycle（43-01 题目作者生命周期校验）", () => {
  it("draft 可转入 review、published、deprecated", () => {
    expect(canTransitionLifecycle("draft", "review")).toBe(true);
    expect(canTransitionLifecycle("draft", "published")).toBe(true);
    expect(canTransitionLifecycle("draft", "deprecated")).toBe(true);
    expect(canTransitionLifecycle("draft", "draft")).toBe(true);
  });

  it("published 不能直接跳跃到 draft，需经 review", () => {
    expect(canTransitionLifecycle("published", "draft")).toBe(false);
    expect(canTransitionLifecycle("published", "review")).toBe(true);
    expect(canTransitionLifecycle("published", "deprecated")).toBe(true);
  });

  it("未指定初始状态时允许自由过渡", () => {
    expect(canTransitionLifecycle(undefined, "draft")).toBe(true);
    expect(canTransitionLifecycle(undefined, "published")).toBe(true);
  });
});

describe("checkPublishGuard（43-01 发布守卫）", () => {
  it("题干为空阻断发布", () => {
    const res = checkPublishGuard({ stem: "   ", type: "single", options: ["A", "B"], answer: "A" });
    expect(res.valid).toBe(false);
    expect(res.errors).toContain("题干不可为空");
  });

  it("未指定有效题型阻断发布", () => {
    const res = checkPublishGuard({ stem: "题干", type: "invalid" as any });
    expect(res.valid).toBe(false);
    expect(res.errors).toContain("未指定有效的题型");
  });

  it("单选题选项少于 2 项或含空选项阻断发布", () => {
    const res1 = checkPublishGuard({ stem: "题干", type: "single", options: ["A"], answer: "A" });
    expect(res1.valid).toBe(false);
    expect(res1.errors.some((e) => e.includes("至少需要 2 个有效选项"))).toBe(true);

    const res2 = checkPublishGuard({ stem: "题干", type: "single", options: ["A", "  "], answer: "A" });
    expect(res2.valid).toBe(false);
    expect(res2.errors.some((e) => e.includes("存在空选项"))).toBe(true);
  });

  it("单选题答案越界阻断发布", () => {
    const res = checkPublishGuard({ stem: "题干", type: "single", options: ["选项1", "选项2"], answer: "C" });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("超出选项范围"))).toBe(true);
  });

  it("多选题答案少于 2 选项或含越界选项阻断发布", () => {
    const res1 = checkPublishGuard({ stem: "题干", type: "multiple", options: ["A", "B", "C"], answer: "A" });
    expect(res1.valid).toBe(false);
    expect(res1.errors.some((e) => e.includes("至少需要 2 个选项"))).toBe(true);

    const res2 = checkPublishGuard({ stem: "题干", type: "multiple", options: ["A", "B"], answer: "ABC" });
    expect(res2.valid).toBe(false);
    expect(res2.errors.some((e) => e.includes("越界选项 C"))).toBe(true);
  });

  it("判断题答案非 对/错 阻断发布", () => {
    const res = checkPublishGuard({ stem: "题干", type: "judge", options: [], answer: "正确" });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("判断题答案必须为 对 或 错"))).toBe(true);
  });

  it("填空题无答案或多空规格空答案阻断发布", () => {
    const res1 = checkPublishGuard({ stem: "题干", type: "fill", options: [], answer: "" });
    expect(res1.valid).toBe(false);
    expect(res1.errors.some((e) => e.includes("填空题未设置答案"))).toBe(true);

    const res2 = checkPublishGuard({
      stem: "题干",
      type: "fill",
      options: [],
      answer: "甲;;乙",
      answerSpec: {
        v: 1,
        kind: "multiBlank",
        blanks: [{ answers: ["甲"] }, { answers: ["   "] }],
      },
    });
    expect(res2.valid).toBe(false);
    expect(res2.errors.some((e) => e.includes("第 2 空未设置有效答案"))).toBe(true);
  });

  it("简答题参考答案为空阻断发布", () => {
    const res = checkPublishGuard({ stem: "题干", type: "short", options: [], answer: "" });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("简答题参考答案不可为空"))).toBe(true);
  });

  it("孤儿共用题干材料组阻断发布", () => {
    const res = checkPublishGuard(
      { stem: "子题题干", type: "single", options: ["A", "B"], answer: "A", group: "grp-orphan" },
      { knownGroupIds: new Set(["grp-exists-1", "grp-exists-2"]) },
    );
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("孤儿题目"))).toBe(true);
  });

  it("合法题目完整通过发布守卫", () => {
    const single = checkPublishGuard({ stem: "标准题干", type: "single", options: ["A选项", "B选项"], answer: "A" });
    expect(single.valid).toBe(true);
    expect(single.errors).toEqual([]);

    const material = checkPublishGuard({ stem: "阅读材料大段内容", type: "material", options: [], answer: "" });
    expect(material.valid).toBe(true);
    expect(material.errors).toEqual([]);
  });
});

describe("validateLifecycleTransition（43-01 生命周期流转与守卫串联）", () => {
  it("draft 转换到 published 时若题目不合格则被发布守卫阻断", () => {
    const brokenQuestion = { stem: "草稿题", type: "single" as const, options: ["A"], answer: "" };
    const res = validateLifecycleTransition("draft", "published", brokenQuestion);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("发布守卫阻断");
    expect(res.guardErrors?.length).toBeGreaterThan(0);
  });

  it("draft 转换到 published 时若题目合格则顺利通过", () => {
    const goodQuestion = { stem: "草稿题", type: "single" as const, options: ["A", "B"], answer: "B" };
    const res = validateLifecycleTransition("draft", "published", goodQuestion);
    expect(res.ok).toBe(true);
    expect(res.guardErrors).toBeUndefined();
  });

  it("published 无法直接转回 draft（需经 review）", () => {
    const q = { stem: "已发布题", type: "single" as const, options: ["A", "B"], answer: "A" };
    const res = validateLifecycleTransition("published", "draft", q);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("不允许从【已发布】转换为【草稿】");
  });

  it("getQuestionLifecycle 缺省默认为 published", () => {
    expect(LIFECYCLE_LABELS.published).toBe("已发布");
    expect(LIFECYCLE_LABELS.draft).toBe("草稿");
    expect(LIFECYCLE_LABELS.review).toBe("待审");
    expect(LIFECYCLE_LABELS.deprecated).toBe("已废弃");
    expect(getQuestionLifecycle(undefined)).toBe("published");
    expect(getQuestionLifecycle(null)).toBe("published");
    expect(getQuestionLifecycle({})).toBe("published");
    expect(getQuestionLifecycle({ status: "draft" })).toBe("draft");
    expect(getQuestionLifecycle({ status: "deprecated" })).toBe("deprecated");
  });
});
