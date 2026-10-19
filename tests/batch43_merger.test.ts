import { describe, it, expect } from "vitest";
import { planQuestionMerge } from "../src/core/duplicateMerger";
import { makeQuestion } from "../src/core/blockTemplate";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";

function createMockApp() {
  const deletedBlocks: string[] = [];
  const updatedBlocks = new Map<string, string>();
  const blockAttrs = new Map<string, Record<string, string>>();

  const client = {
    sql: async () => [],
    deleteBlock: async (id: string) => {
      deletedBlocks.push(id);
    },
    removeBlock: async (id: string) => {
      deletedBlocks.push(id);
    },
    updateBlock: async (id: string, md: string) => {
      updatedBlocks.set(id, md);
    },
    getBlockKramdown: async (id: string) => {
      return updatedBlocks.get(id) ?? `{: custom-exam-id="q-keep"}`;
    },
    setExamAttrs: async (id: string, attrs: Record<string, string>) => {
      blockAttrs.set(id, { ...(blockAttrs.get(id) ?? {}), ...attrs });
    },
    listQuestions: async () => [],
  } as unknown as KernelApiClient;

  const storage = new MemoryStorage();
  const app = new ExamApp({ client, storage, now: () => 1_800_000_000_000 });
  app.kernelOnline = true;

  return { app, client, deletedBlocks, updatedBlocks, blockAttrs, storage };
}

describe("43-07 题库全文快速去重合并助手（四三批去重合并）", () => {
  describe("planQuestionMerge 纯函数", () => {
    it("智能合入重复题中更丰富的内容（解析、考点、出处、年份、难度与收藏）", () => {
      const targetQ = makeQuestion({
        type: "single",
        stem: "光的三原色是哪三种？",
        options: ["红绿蓝", "红黄蓝"],
        answer: "A",
        // targetQ 缺少解析、考点、出处、年份、难度，且未收藏
      });

      const sourceQ = makeQuestion({
        type: "single",
        stem: "光的三原色是哪三种？",
        options: ["红绿蓝", "红黄蓝"],
        answer: "A",
        analysis: "光学加色法基础三原色为红、绿、蓝",
        kp: "物理/光学",
        source: "2024 省考真题",
        year: "2024",
        difficulty: 2,
      });
      sourceQ.fav = true;

      const plan = planQuestionMerge(targetQ, sourceQ);

      expect(plan.targetId).toBe(targetQ.id);
      expect(plan.sourceId).toBe(sourceQ.id);
      expect(plan.enrichedFields).toEqual(["analysis", "kp", "source", "year", "difficulty", "fav"]);
      expect(plan.enrichedQuestion.analysis).toBe("光学加色法基础三原色为红、绿、蓝");
      expect(plan.enrichedQuestion.kp).toBe("物理/光学");
      expect(plan.enrichedQuestion.source).toBe("2024 省考真题");
      expect(plan.enrichedQuestion.year).toBe("2024");
      expect(plan.enrichedQuestion.difficulty).toBe(2);
      expect(plan.enrichedQuestion.fav).toBe(true);
    });

    it("目标题已有的非空字段优先保留，不被重复题覆盖", () => {
      const targetQ = makeQuestion({
        type: "single",
        stem: "题干",
        options: ["A", "B"],
        answer: "A",
        analysis: "目标题已有的优质官方解析",
        kp: "已有考点",
      });

      const sourceQ = makeQuestion({
        type: "single",
        stem: "题干",
        options: ["A", "B"],
        answer: "A",
        analysis: "重复题简略解析",
        kp: "重复题考点",
      });

      const plan = planQuestionMerge(targetQ, sourceQ);
      expect(plan.enrichedFields).toHaveLength(0);
      expect(plan.enrichedQuestion.analysis).toBe("目标题已有的优质官方解析");
      expect(plan.enrichedQuestion.kp).toBe("已有考点");
    });
  });

  describe("AttemptLog.remapQuestionId 流水迁移", () => {
    it("将指定来源题目的所有事件迁移到保留目标题目", () => {
      const { app } = createMockApp();
      const e1 = app.recordAttempt({ qid: "q-target", kind: "practice", mode: "quick", verdict: "correct", myAnswer: "A", sessionId: "s1", queue: "normal" });
      const e2 = app.recordAttempt({ qid: "q-source", kind: "practice", mode: "quick", verdict: "wrong", myAnswer: "B", sessionId: "s1", queue: "normal" });
      const e3 = app.recordAttempt({ qid: "q-source", kind: "practice", mode: "quick", verdict: "correct", myAnswer: "A", sessionId: "s2", queue: "normal" });

      const remappedCount = app.attempts.remapQuestionId("q-source", "q-target");
      expect(remappedCount).toBe(2);

      const all = app.attempts.all();
      expect(all.every((e) => e.qid === "q-target")).toBe(true);
      expect(all[0].eid).toBe(e1.eid);
      expect(all[1].eid).toBe(e2.eid);
      expect(all[2].eid).toBe(e3.eid);

      // 同 ID 迁移安全返回 0
      expect(app.attempts.remapQuestionId("q-target", "q-target")).toBe(0);
    });
  });

  describe("ExamApp.mergeDuplicateQuestions 端到端合并集成", () => {
    it("合并时丰富目标题字段、迁移历史作答并删除重复题块", async () => {
      const { app, deletedBlocks } = createMockApp();

      const targetQ = {
        ...makeQuestion({ type: "single", stem: "我国首艘国产航母名称是？", options: ["辽宁舰", "山东舰"], answer: "B" }),
        blockId: "b-target-1",
      };

      const sourceQ = {
        ...makeQuestion({
          type: "single",
          stem: "我国首艘国产航母名称是？",
          options: ["辽宁舰", "山东舰"],
          answer: "B",
          analysis: "我国首艘国产航母为山东舰，舷号17",
          kp: "常识/国防",
        }),
        blockId: "b-source-2",
      };

      // 制造重复题的历史作答记录
      app.recordAttempt({
        qid: sourceQ.id,
        kind: "practice",
        mode: "quick",
        verdict: "wrong",
        myAnswer: "A",
        sessionId: "s1",
        queue: "normal",
      });

      // 执行合并
      const res = await app.mergeDuplicateQuestions(targetQ, sourceQ);

      expect(res.mergedEventsCount).toBe(1);
      expect(res.enrichedFields).toEqual(["analysis", "kp"]);
      expect(targetQ.analysis).toBe("我国首艘国产航母为山东舰，舷号17");
      expect(targetQ.kp).toBe("常识/国防");

      // 重复题块已被删除
      expect(deletedBlocks).toContain(sourceQ.blockId);

      // 验证作答流水已被全部迁移到 targetQ.id
      const targetAttempts = app.attempts.all().filter((e) => e.qid === targetQ.id);
      expect(targetAttempts).toHaveLength(1);
      expect(targetAttempts[0].myAnswer).toBe("A");

      // 验证派生错题本中由 targetQ 继承
      expect(app.wrongItems().some((w) => w.qid === targetQ.id)).toBe(true);
      expect(app.wrongItems().some((w) => w.qid === sourceQ.id)).toBe(false);
    });

    it("相同题目合并抛错防护", async () => {
      const { app } = createMockApp();
      const q = { ...makeQuestion({ type: "judge", stem: "题", answer: "对" }), blockId: "b-1" };
      await expect(app.mergeDuplicateQuestions(q, q)).rejects.toThrow("不能合并同一道题目");
    });
  });
});
