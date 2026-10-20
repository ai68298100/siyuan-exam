import { describe, it, expect } from "vitest";
import type { AttemptEvent, Question } from "../src/core/types";
import {
  normalizeKpPath,
  buildKpTree,
  findKpSubtree,
  flattenKpTree,
  pruneKpTree,
} from "../src/core/kpTree";

function mockQuestion(id: string, kp?: string): Question {
  return {
    id,
    type: "single",
    stem: `Stem ${id}`,
    options: ["A", "B"],
    answer: "A",
    score: 1,
    origin: "manual",
    hash: `hash-${id}`,
    kp,
  };
}

function mockAttempt(qid: string, verdict: "correct" | "wrong", ts: number): AttemptEvent {
  return {
    v: 1,
    eid: `e-${qid}-${ts}`,
    ts,
    qid,
    kind: "practice",
    mode: "single",
    verdict,
    myAnswer: verdict === "correct" ? "A" : "B",
    queue: "normal",
    device: "d1",
    seq: ts,
    sessionId: "s1",
  };
}

describe("KpTree 考点层级大纲树与掌握度多级穿透聚合引擎 (51-01 / 39-07)", () => {
  describe("normalizeKpPath 路径规范化", () => {
    it("正确清理首尾空格、重复斜杠与无效空段", () => {
      expect(normalizeKpPath("")).toBe("");
      expect(normalizeKpPath(null)).toBe("");
      expect(normalizeKpPath(undefined)).toBe("");
      expect(normalizeKpPath("  资料分析 / 比重计算  / 现期比重  ")).toBe("资料分析/比重计算/现期比重");
      expect(normalizeKpPath("言语理解///逻辑填空/")).toBe("言语理解/逻辑填空");
    });
  });

  describe("buildKpTree 多级树形大纲构建与自底向上穿透聚合", () => {
    it("空题目集合返回空树", () => {
      expect(buildKpTree([])).toEqual([]);
    });

    it("跳过未设置 kp 的题目，仅组织有效考点树", () => {
      const qs = [mockQuestion("q1", ""), mockQuestion("q2", undefined), mockQuestion("q3", "常识")];
      const roots = buildKpTree(qs);
      expect(roots).toHaveLength(1);
      expect(roots[0].name).toBe("常识");
      expect(roots[0].totalQuestions).toBe(1);
    });

    it("正确组织 3 级多叉树并穿透聚合题量、做题次数、独立题与掌握度得分", () => {
      // 构造两门主要学科的考点结构：
      // 1. 资料分析
      //    └── 比重计算
      //        ├── 现期比重 (q1, q2)
      //        └── 基期比重 (q3)
      // 2. 言语理解
      //    └── 逻辑填空 (q4)
      const q1 = mockQuestion("q1", "资料分析/比重计算/现期比重");
      const q2 = mockQuestion("q2", "资料分析/比重计算/现期比重");
      const q3 = mockQuestion("q3", "资料分析/比重计算/基期比重");
      const q4 = mockQuestion("q4", "言语理解/逻辑填空");

      // 构造作答流水：
      // q1 练了 2 次：错(ts: 100) -> 对(ts: 200) -> 最终掌握
      // q2 练了 1 次：错(ts: 150) -> 最终未掌握
      // q3 练了 1 次：对(ts: 180) -> 最终掌握
      // q4 练了 3 次：对(ts: 100) -> 对(ts: 120) -> 对(ts: 140) -> 最终掌握
      const events: AttemptEvent[] = [
        mockAttempt("q1", "wrong", 100),
        mockAttempt("q4", "correct", 100),
        mockAttempt("q4", "correct", 120),
        mockAttempt("q4", "correct", 140),
        mockAttempt("q2", "wrong", 150),
        mockAttempt("q3", "correct", 180),
        mockAttempt("q1", "correct", 200),
      ];

      const roots = buildKpTree([q1, q2, q3, q4], events);

      // 应该有两个顶级根节点：资料分析 (3题)、言语理解 (1题)
      expect(roots).toHaveLength(2);

      const dataAnalysis = roots.find((r) => r.name === "资料分析");
      expect(dataAnalysis).toBeDefined();
      expect(dataAnalysis?.level).toBe(1);
      expect(dataAnalysis?.totalQuestions).toBe(3); // q1 + q2 + q3
      expect(dataAnalysis?.selfQuestions).toBe(0); // 顶层没有直接挂题
      expect(dataAnalysis?.totalAttempts).toBe(4); // q1(2) + q2(1) + q3(1) = 4次
      expect(dataAnalysis?.totalCorrect).toBe(2); // q1(1) + q3(1) = 2次正确
      expect(dataAnalysis?.uniqueQids).toBe(3); // 练过 q1, q2, q3
      expect(dataAnalysis?.independentCorrect).toBe(2); // 最终做对 q1, q3
      expect(dataAnalysis?.coverage).toBe(1.0); // 3 / 3 = 100%
      expect(dataAnalysis?.accuracy).toBe(0.5); // 2 / 4 = 50%
      expect(dataAnalysis?.confident).toBe(true); // 独立题 3 道 >= 3

      // 验证二级节点：比重计算
      expect(dataAnalysis?.children).toHaveLength(1);
      const ratioNode = dataAnalysis!.children[0];
      expect(ratioNode.name).toBe("比重计算");
      expect(ratioNode.path).toBe("资料分析/比重计算");
      expect(ratioNode.parentPath).toBe("资料分析");
      expect(ratioNode.level).toBe(2);
      expect(ratioNode.totalQuestions).toBe(3);

      // 验证三级叶子节点：现期比重
      expect(ratioNode.children).toHaveLength(2);
      const currentRatio = ratioNode.children.find((c) => c.name === "现期比重");
      expect(currentRatio).toBeDefined();
      expect(currentRatio?.level).toBe(3);
      expect(currentRatio?.selfQuestions).toBe(2);
      expect(currentRatio?.totalQuestions).toBe(2);
      expect(currentRatio?.totalAttempts).toBe(3); // q1(2次) + q2(1次)
      expect(currentRatio?.totalCorrect).toBe(1); // q1 对了一次
      expect(currentRatio?.uniqueQids).toBe(2); // 练了 q1, q2
      expect(currentRatio?.independentCorrect).toBe(1); // 最终对 q1
      expect(currentRatio?.coverage).toBe(1.0); // 2/2 = 100%
      expect(currentRatio?.accuracy).toBe(0.333); // 1/3 ≈ 0.333

      // 验证言语理解节点
      const verbal = roots.find((r) => r.name === "言语理解");
      expect(verbal?.totalQuestions).toBe(1);
      expect(verbal?.totalAttempts).toBe(3);
      expect(verbal?.totalCorrect).toBe(3);
      expect(verbal?.accuracy).toBe(1.0);
      expect(verbal?.independentCorrect).toBe(1);
      expect(verbal?.confident).toBe(false); // 仅 1 道独立题，样本不足
    });

    it("支持 weakFirst 选项，掌握度薄弱的节点排在前面", () => {
      const q1 = mockQuestion("q1", "考点A"); // 正确率 100%
      const q2 = mockQuestion("q2", "考点B"); // 正确率 0%
      const events = [
        mockAttempt("q1", "correct", 100),
        mockAttempt("q2", "wrong", 100),
      ];

      const roots = buildKpTree([q1, q2], events, { weakFirst: true });
      expect(roots[0].name).toBe("考点B");
      expect(roots[1].name).toBe("考点A");
      expect(roots[0].masteryScore).toBeLessThan(roots[1].masteryScore);
    });
  });

  describe("findKpSubtree 考点子树检索", () => {
    it("能准确定位顶层或深层考点子树", () => {
      const qs = [
        mockQuestion("q1", "哲学/辩证法/矛盾论"),
        mockQuestion("q2", "哲学/认识论/实践论"),
      ];
      const roots = buildKpTree(qs);

      // 1. 查找根节点
      const sub1 = findKpSubtree(roots, "哲学");
      expect(sub1?.name).toBe("哲学");
      expect(sub1?.children).toHaveLength(2);

      // 2. 查找二级节点
      const sub2 = findKpSubtree(roots, "哲学/辩证法");
      expect(sub2?.name).toBe("辩证法");
      expect(sub2?.children).toHaveLength(1);
      expect(sub2?.children[0].name).toBe("矛盾论");

      // 3. 查找叶子节点
      const sub3 = findKpSubtree(roots, "哲学/辩证法/矛盾论");
      expect(sub3?.name).toBe("矛盾论");
      expect(sub3?.children).toHaveLength(0);

      // 4. 不存在的节点返回 null
      expect(findKpSubtree(roots, "数学/高等数学")).toBeNull();
    });
  });

  describe("flattenKpTree 深度优先扁平化", () => {
    it("按前序遍历将树形结构展开为一维列表", () => {
      const qs = [
        mockQuestion("q1", "政治/马哲/辩证法"),
        mockQuestion("q2", "政治/马哲/认识论"),
        mockQuestion("q3", "政治/毛概"),
      ];
      const roots = buildKpTree(qs);
      const list = flattenKpTree(roots);

      const paths = list.map((n) => n.path);
      expect(paths).toContain("政治");
      expect(paths).toContain("政治/马哲");
      expect(paths).toContain("政治/马哲/辩证法");
      expect(paths).toContain("政治/马哲/认识论");
      expect(paths).toContain("政治/毛概");
    });

    it("支持 maxDepth 与 includeLeafOnly 选项", () => {
      const qs = [mockQuestion("q1", "A/B/C")];
      const roots = buildKpTree(qs);

      // maxDepth = 2: 仅输出 A, A/B
      const depth2 = flattenKpTree(roots, { maxDepth: 2 });
      expect(depth2.map((n) => n.path)).toEqual(["A", "A/B"]);

      // includeLeafOnly = true: 仅输出叶子节点 A/B/C
      const leaves = flattenKpTree(roots, { includeLeafOnly: true });
      expect(leaves.map((n) => n.path)).toEqual(["A/B/C"]);
    });
  });

  describe("pruneKpTree 条件剪枝", () => {
    it("可按掌握度或题量进行智能树形剪枝，并保留满足条件的祖先路径", () => {
      const q1 = mockQuestion("q1", "数学/代数/微积分");
      const q2 = mockQuestion("q2", "数学/几何/立体几何");
      const events = [
        mockAttempt("q1", "wrong", 100), // 微积分掌握度低
        mockAttempt("q2", "correct", 100), // 立体几何掌握度高
      ];

      const roots = buildKpTree([q1, q2], events);

      // 剪枝目标：仅保留含有掌握度 ≤ 50 分的节点
      const pruned = pruneKpTree(roots, (n) => n.uniqueQids > 0 && n.masteryScore <= 50);

      // 数学根节点保留，但子分支中几何被剪除，仅保留代数分支
      expect(pruned).toHaveLength(1);
      expect(pruned[0].name).toBe("数学");
      expect(pruned[0].children).toHaveLength(1);
      expect(pruned[0].children[0].name).toBe("代数");
      expect(pruned[0].children[0].children[0].name).toBe("微积分");
    });
  });
});
