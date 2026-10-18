import { describe, it, expect } from "vitest";
import { makeQuestion } from "../src/core/blockTemplate";
import {
  buildMaterialGroupContext,
  formatMaterialGroupHeader,
} from "../src/core/materialContext";
import { PracticeSession } from "../src/core/session";

describe("43-03 材料组上下文模式与兄弟题导航（四三批材料纵深）", () => {
  describe("buildMaterialGroupContext 纯函数", () => {
    it("无 group 属性题目返回 null", () => {
      const q = makeQuestion({ type: "single", stem: "无材料题", options: ["A", "B"], answer: "A" });
      const ctx = buildMaterialGroupContext({ currentQ: q, bankQuestions: [q] });
      expect(ctx).toBeNull();
    });

    it("正确聚合材料母块正文并按序号排列子题兄弟项", () => {
      const mat = makeQuestion({
        type: "material",
        stem: "【大段共用背景材料】：2025年某市高新技术产值分析...",
        options: [],
        answer: "",
        group: "grp-tech-1",
      });
      const sub1 = makeQuestion({
        type: "single",
        stem: "1. 2025年产值同比增幅是多少？",
        options: ["10%", "20%"],
        answer: "A",
        group: "grp-tech-1",
      });
      const sub2 = makeQuestion({
        type: "single",
        stem: "2. 占比最高的是哪个产业？",
        options: ["电子信息", "生物医药"],
        answer: "B",
        group: "grp-tech-1",
      });
      const sub3 = makeQuestion({
        type: "fill",
        stem: "3. 研发投入总计为____亿元。",
        options: [],
        answer: "50",
        group: "grp-tech-1",
      });

      const bank = [mat, sub1, sub2, sub3];

      // 处于第 2 道子题时
      const ctx = buildMaterialGroupContext({
        currentQ: sub2,
        bankQuestions: bank,
        sessionQids: [sub1.id, sub2.id, sub3.id],
        sessionAnswered: [
          { qid: sub1.id, pos: 0, verdict: "correct" },
        ],
        currentSessionCursor: 1,
      });

      expect(ctx).not.toBeNull();
      expect(ctx?.group).toBe("grp-tech-1");
      expect(ctx?.hasMaterial).toBe(true);
      expect(ctx?.materialStem).toBe("【大段共用背景材料】：2025年某市高新技术产值分析...");
      expect(ctx?.materialQid).toBe(mat.id);
      expect(ctx?.totalSubs).toBe(3);
      expect(ctx?.currentSubIndex).toBe(2);

      // 兄弟题状态
      expect(ctx?.siblings).toHaveLength(3);

      // 子题 1：已答对，在卷内
      const sib1 = ctx!.siblings[0];
      expect(sib1.subIndex).toBe(1);
      expect(sib1.isCurrent).toBe(false);
      expect(sib1.inSession).toBe(true);
      expect(sib1.sessionCursor).toBe(0);
      expect(sib1.answered).toBe(true);
      expect(sib1.verdict).toBe("correct");

      // 子题 2：当前题，未答
      const sib2 = ctx!.siblings[1];
      expect(sib2.subIndex).toBe(2);
      expect(sib2.isCurrent).toBe(true);
      expect(sib2.inSession).toBe(true);
      expect(sib2.sessionCursor).toBe(1);
      expect(sib2.answered).toBe(false);

      // 子题 3：未答
      const sib3 = ctx!.siblings[2];
      expect(sib3.subIndex).toBe(3);
      expect(sib3.isCurrent).toBe(false);
      expect(sib3.inSession).toBe(true);
      expect(sib3.sessionCursor).toBe(2);
      expect(sib3.answered).toBe(false);
    });

    it("部分子题未排入当前会话时，正确标记 inSession=false", () => {
      const mat = makeQuestion({ type: "material", stem: "材料", options: [], answer: "", group: "grp-2" });
      const sub1 = makeQuestion({ type: "single", stem: "子题1", options: ["A", "B"], answer: "A", group: "grp-2" });
      const sub2 = makeQuestion({ type: "single", stem: "子题2", options: ["A", "B"], answer: "B", group: "grp-2" });

      const ctx = buildMaterialGroupContext({
        currentQ: sub1,
        bankQuestions: [mat, sub1, sub2],
        sessionQids: [sub1.id], // 只有 sub1 在卷内
      });

      expect(ctx?.siblings[0].inSession).toBe(true);
      expect(ctx?.siblings[1].inSession).toBe(false);
      expect(ctx?.siblings[1].sessionCursor).toBeUndefined();
    });
  });

  describe("formatMaterialGroupHeader 说明格式化", () => {
    it("正确格式化题组标题与序号", () => {
      expect(formatMaterialGroupHeader({
        group: "grp-1",
        materialStem: "材料",
        hasMaterial: true,
        totalSubs: 3,
        currentSubIndex: 2,
        siblings: [],
      })).toBe("材料题组（第 2/3 题）");

      expect(formatMaterialGroupHeader({
        group: "grp-1",
        materialStem: "材料",
        hasMaterial: true,
        totalSubs: 1,
        currentSubIndex: 1,
        siblings: [],
      })).toBe("共用材料题");
    });
  });

  describe("PracticeSession 兄弟题一键跳转（jumpTo / jumpToQid）", () => {
    it("jumpTo 支持在会话卷面题目间自由跳转并更新游标", () => {
      const q1 = makeQuestion({ type: "single", stem: "题1", options: ["A", "B"], answer: "A" });
      const q2 = makeQuestion({ type: "single", stem: "题2", options: ["A", "B"], answer: "B" });
      const q3 = makeQuestion({ type: "single", stem: "题3", options: ["A", "B"], answer: "A" });

      const session = new PracticeSession([q1, q2, q3], "quick");
      expect(session.state.cursor).toBe(0);

      // 1. 跳转到题 3 (index 2)
      expect(session.jumpTo(2)).toBe(true);
      expect(session.state.cursor).toBe(2);
      expect(session.current?.id).toBe(q3.id);

      // 2. 跳转到当前位置返回 false
      expect(session.jumpTo(2)).toBe(false);

      // 3. 越界跳转返回 false
      expect(session.jumpTo(-1)).toBe(false);
      expect(session.jumpTo(99)).toBe(false);
      expect(session.state.cursor).toBe(2);
    });

    it("jumpToQid 根据题目 ID 精准跳转，优先跳转至未答位置", () => {
      const q1 = makeQuestion({ type: "single", stem: "题1", options: ["A", "B"], answer: "A" });
      const q2 = makeQuestion({ type: "single", stem: "题2", options: ["A", "B"], answer: "B" });
      const q3 = makeQuestion({ type: "single", stem: "题3", options: ["A", "B"], answer: "A" });

      const session = new PracticeSession([q1, q2, q3], "quick");

      // 1. 通过 qid 跳转到 q2
      expect(session.jumpToQid(q2.id)).toBe(true);
      expect(session.state.cursor).toBe(1);
      expect(session.current?.id).toBe(q2.id);

      // 2. 查找不存在的 qid 返回 false
      expect(session.jumpToQid("non-existent")).toBe(false);
    });
  });
});
