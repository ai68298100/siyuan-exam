import { describe, it, expect } from "vitest";
import type { Question, WrongItem } from "../src/core/types";
import type { KpTreeNode } from "../src/core/kpTree";
import {
  findWeakKnowledgePoints,
  assembleAdaptiveTargetSession,
} from "../src/core/adaptiveTarget";

function mkQuestion(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    type: "single",
    stem: `题目 ${id}`,
    options: ["A", "B", "C", "D"],
    answer: "A",
    score: 1,
    origin: "manual",
    hash: `hash-${id}`,
    kp: "常识/宪法",
    ...overrides,
  };
}

function mkKpNode(path: string, masteryScore: number, overrides: Partial<KpTreeNode> = {}): KpTreeNode {
  const parts = path.split("/");
  return {
    id: path,
    name: parts[parts.length - 1],
    path,
    level: parts.length,
    children: [],
    selfQuestions: 5,
    totalQuestions: 5,
    totalAttempts: 10,
    totalCorrect: 4,
    uniqueQids: 3,
    independentCorrect: 2,
    coverage: 0.6,
    accuracy: 0.4,
    masteryScore,
    confident: true,
    ...overrides,
  };
}

describe("AdaptiveTarget 靶向弱项自适应攻坚专题引擎 (65-08 / 51-01 / 65-03)", () => {
  describe("findWeakKnowledgePoints (薄弱考点自动甄别)", () => {
    it("自动筛选低于 60 分的考点，并按薄弱严重程度降序排列", () => {
      const n1 = mkKpNode("数学/几何/立体几何", 45); // 较薄弱
      const n2 = mkKpNode("数学/函数/导数", 20); // 极度薄弱
      const n3 = mkKpNode("语文/文言文", 85); // 熟练良好
      const n4 = mkKpNode("常识/历史", 55); // 薄弱

      const weak = findWeakKnowledgePoints([n1, n2, n3, n4], { maxMasteryScore: 60, topCount: 3 });

      // 应筛除文言文(85分)，只保留导数(20分)、立体几何(45分)、历史(55分)
      expect(weak).toHaveLength(3);
      expect(weak[0].name).toBe("导数");
      expect(weak[0].masteryScore).toBe(20);
      expect(weak[1].name).toBe("立体几何");
      expect(weak[2].name).toBe("历史");
    });

    it("题目数为 0 的空节点不进入薄弱备选", () => {
      const emptyNode = mkKpNode("空节点", 0, { totalQuestions: 0 });
      const weak = findWeakKnowledgePoints([emptyNode]);
      expect(weak).toHaveLength(0);
    });
  });

  describe("assembleAdaptiveTargetSession (靶向自适应攻坚组卷)", () => {
    it("空考点树或全考点良好时给出安全友好回执", () => {
      const goodNode = mkKpNode("高分考点", 90);
      const session = assembleAdaptiveTargetSession({
        allQuestions: [mkQuestion("q1")],
        kpRoots: [goodNode],
        wrongItems: [],
      });

      expect(session.questions).toHaveLength(0);
      expect(session.receipt).toContain("暂未发现低于警戒线的薄弱知识点");
    });

    it("安全排除争议题与封存归档题", () => {
      const weakNode = mkKpNode("薄弱考点", 30);
      const qArchived = mkQuestion("q-arch", { kp: "薄弱考点" });
      const qDisputed = mkQuestion("q-disp", {
        kp: "薄弱考点",
        dispute: { status: "pending", reason: "wrong_answer", reportedAt: 1 },
      });
      const qNormal = mkQuestion("q-norm", { kp: "薄弱考点" });

      const session = assembleAdaptiveTargetSession({
        allQuestions: [qArchived, qDisputed, qNormal],
        kpRoots: [weakNode],
        wrongItems: [],
        archivedQids: new Set(["q-arch"]),
        options: { sessionSize: 5 },
      });

      const qids = session.questions.map((q) => q.id);
      expect(qids).toContain("q-norm");
      expect(qids).not.toContain("q-arch");
      expect(qids).not.toContain("q-disp");
    });

    it("分层混合抽取：错题、题族变式与未练新题，并打散防泄露", () => {
      const weakNode = mkKpNode("资料分析/比重", 35);

      // 构造题库：包含错题、同族变式题、未练新题
      const qWrong1 = mkQuestion("w1", { kp: "资料分析/比重" });
      const qWrong2 = mkQuestion("w2", { kp: "资料分析/比重" });

      // 同族变式题（来自同一 parentId）
      const qVar1 = mkQuestion("v1", { kp: "资料分析/比重", family: { parentId: "fam-origin", variantKind: "numeric" } });
      const qVar2 = mkQuestion("v2", { kp: "资料分析/比重", family: { parentId: "fam-origin", variantKind: "reverse" } });

      const qFresh1 = mkQuestion("f1", { kp: "资料分析/比重" });
      const qFresh2 = mkQuestion("f2", { kp: "资料分析/比重" });

      const all = [qWrong1, qWrong2, qVar1, qVar2, qFresh1, qFresh2];
      const wrongItems: WrongItem[] = [
        { qid: "w1", firstWrongAt: 1, lastWrongAt: 2, wrongCount: 3, streakCorrect: 0, myAnswer: "B" },
        { qid: "w2", firstWrongAt: 1, lastWrongAt: 2, wrongCount: 2, streakCorrect: 0, myAnswer: "C" },
      ];

      const session = assembleAdaptiveTargetSession({
        allQuestions: all,
        kpRoots: [weakNode],
        wrongItems,
        options: { sessionSize: 6, minSpacing: 1 },
      });

      expect(session.questions).toHaveLength(6);
      expect(session.composition.wrongs).toBeGreaterThanOrEqual(1);
      expect(session.composition.variants).toBeGreaterThanOrEqual(1);
      expect(session.title).toContain("资料分析/比重");
      expect(session.receipt).toContain("自适应攻坚专题已生成");

      // 联动防泄露打散：同族的 v1 和 v2 不紧贴在一起
      const idxV1 = session.questions.findIndex((q) => q.id === "v1");
      const idxV2 = session.questions.findIndex((q) => q.id === "v2");
      expect(Math.abs(idxV1 - idxV2)).toBeGreaterThan(1);
    });
  });
});
