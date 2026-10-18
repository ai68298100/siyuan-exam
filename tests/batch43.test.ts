import { describe, it, expect } from "vitest";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import { ialOf, makeQuestion, questionFromBlock, questionToMarkdown } from "../src/core/blockTemplate";
import type { Question } from "../src/core/types";
import { createQuestionVersionSnapshot, getQuestionLifecycle, isAttemptVersionDrifted } from "../src/core/revision";

function createMockApp() {
  const blockAttrs = new Map<string, Record<string, string>>();
  const blockKramdowns = new Map<string, string>();
  const appendedQuestions: Question[] = [];

  const client = {
    sql: async () => [],
    createDocWithMd: async () => "doc-1",
    appendQuestions: async (_docId: string, qs: Question[]) => {
      appendedQuestions.push(...qs);
      for (const q of qs) {
        blockKramdowns.set("b-" + q.id, questionToMarkdown(q));
      }
      return qs.map((q) => ({ qid: q.id, blockId: "b-" + q.id }));
    },
    setExamAttrs: async (blockId: string, attrs: Record<string, string>) => {
      const existing = blockAttrs.get(blockId) ?? {};
      blockAttrs.set(blockId, { ...existing, ...attrs });
    },
    updateBlock: async (blockId: string, md: string) => {
      blockKramdowns.set(blockId, md);
    },
    getBlockKramdown: async (blockId: string) => {
      return blockKramdowns.get(blockId) ?? "";
    },
  } as unknown as KernelApiClient;

  const storage = new MemoryStorage();
  const app = new ExamApp({ client, storage, now: () => 1_800_000_000_000 });
  app.kernelOnline = true;

  return { app, client, blockAttrs, blockKramdowns, appendedQuestions, storage };
}

describe("43-01 题目作者生命周期与发布守卫（四三批）", () => {
  describe("题块 IAL 模板与反序列化", () => {
    it("ialOf 包含 custom-exam-status 并在 questionFromBlock 中完整读回", () => {
      const q = makeQuestion({
        type: "single",
        stem: "测试题干",
        options: ["选项A", "选项B"],
        answer: "A",
        status: "draft",
      });
      const ial = ialOf(q);
      expect(ial).toContain('custom-exam-status="draft"');

      const restored = questionFromBlock({
        attrs: {
          "custom-exam-id": q.id,
          "custom-exam-type": "single",
          "custom-exam-answer": "A",
          "custom-exam-status": "draft",
        },
        text: "测试题干\n- A. 选项A\n- B. 选项B",
      });
      expect(restored).not.toBeNull();
      expect(restored?.status).toBe("draft");
      expect(getQuestionLifecycle(restored)).toBe("draft");
    });

    it("makeQuestion 默认 status 为 published", () => {
      const q = makeQuestion({
        type: "judge",
        stem: "对错判断",
        options: [],
        answer: "对",
      });
      expect(q.status).toBe("published");
      expect(getQuestionLifecycle(q)).toBe("published");
    });
  });

  describe("writeManualQuestion 发布守卫与草稿写入", () => {
    it("以 published 发布保存未通过守卫的题目时被阻断", async () => {
      const { app } = createMockApp();
      const brokenQuestion = makeQuestion({
        type: "single",
        stem: "题干有效",
        options: ["选项A"], // 少于2个选项
        answer: "A",
        status: "published",
      });

      await expect(app.writeManualQuestion("nb-1", brokenQuestion)).rejects.toThrow("发布守卫阻断");
    });

    it("以 draft 草稿保存时允许不完整题目入库，并写入 exam-status=draft", async () => {
      const { app, blockAttrs } = createMockApp();
      const draftQuestion = makeQuestion({
        type: "single",
        stem: "草稿未写完的题目",
        options: ["待定A"],
        answer: "",
        status: "draft",
      });

      await app.writeManualQuestion("nb-1", draftQuestion);
      const attrs = blockAttrs.get("b-" + draftQuestion.id);
      expect(attrs?.["exam-status"]).toBe("draft");
    });
  });

  describe("updateQuestionLifecycle & updateQuestionContent", () => {
    it("updateQuestionLifecycle 顺利流转草稿至 review", async () => {
      const { app, blockAttrs } = createMockApp();
      const q = makeQuestion({
        type: "single",
        stem: "标准题目",
        options: ["选项A", "选项B"],
        answer: "A",
        status: "draft",
      }) as Question & { blockId: string };
      q.blockId = "b-" + q.id;

      const next = await app.updateQuestionLifecycle(q, "review");
      expect(next.status).toBe("review");
      expect(blockAttrs.get(q.blockId)?.["exam-status"]).toBe("review");

      const revs = await app.questionRevisions(q.id);
      expect(revs).toHaveLength(1);
      expect(revs[0].status).toBe("review");
      expect(revs[0].summary).toContain("状态: 草稿 → 待审");
    });

    it("已发布题目不能直接跳级转为草稿（需经 review 或 deprecated）", async () => {
      const { app } = createMockApp();
      const q = makeQuestion({
        type: "single",
        stem: "线上题目",
        options: ["选项A", "选项B"],
        answer: "A",
        status: "published",
      }) as Question & { blockId: string };
      q.blockId = "b-" + q.id;

      await expect(app.updateQuestionLifecycle(q, "draft")).rejects.toThrow("不允许从【已发布】转换为【草稿】");
    });

    it("从 review 转为 published 时若存在发布守卫违规项则阻断", async () => {
      const { app } = createMockApp();
      const brokenQ = makeQuestion({
        type: "single",
        stem: "待审题目",
        options: ["选项A", "选项B"],
        answer: "C", // 答案越界
        status: "review",
      }) as Question & { blockId: string };
      brokenQ.blockId = "b-" + brokenQ.id;

      await expect(app.updateQuestionLifecycle(brokenQ, "published")).rejects.toThrow("发布守卫阻断");
    });
  });

  describe("publishedQuestions 过滤规则", () => {
    it("仅保留 published 状态题目，过滤草稿与已废弃题", () => {
      const { app } = createMockApp();
      const q1 = makeQuestion({ type: "judge", stem: "题1", answer: "对", status: "published" });
      const q2 = makeQuestion({ type: "judge", stem: "题2", answer: "错", status: "draft" });
      const q3 = makeQuestion({ type: "judge", stem: "题3", answer: "对", status: "review" });
      const q4 = makeQuestion({ type: "judge", stem: "题4", answer: "错", status: "deprecated" });
      const q5 = { ...makeQuestion({ type: "judge", stem: "题5", answer: "对" }), status: undefined }; // 旧数据缺省

      const published = app.publishedQuestions([q1, q2, q3, q4, q5]);
      expect(published.map((q) => q.stem)).toEqual(["题1", "题5"]);
    });
  });

  describe("题版不可变绑定与修订漂移检出（43-01 / 55-07）", () => {
    it("createQuestionVersionSnapshot 提取不可变快照对象", () => {
      const q = makeQuestion({
        type: "fill",
        stem: "重力加速度约为多少？",
        options: [],
        answer: "9.8",
        answerSpec: { v: 1, kind: "numeric", absTol: 0.1 },
      });

      const snap = createQuestionVersionSnapshot(q, 1_700_000_000_000);
      expect(snap.hash).toBe(q.hash);
      expect(snap.answer).toBe("9.8");
      expect(snap.specKind).toBe("numeric");
      expect(snap.revTs).toBe(1_700_000_000_000);
    });

    it("isAttemptVersionDrifted 正确识别题干/选项/答案变动引发的题版漂移", () => {
      const originalQ = makeQuestion({
        type: "single",
        stem: "光的波长单位是什么？",
        options: ["米", "秒"],
        answer: "A",
      });
      const snap = createQuestionVersionSnapshot(originalQ);

      // 1. 无快照历史作答（旧数据向后兼容）：不报错且不标记漂移
      expect(isAttemptVersionDrifted({}, originalQ)).toBe(false);
      expect(isAttemptVersionDrifted(null, originalQ)).toBe(false);

      // 2. 题面未变动：无漂移
      expect(isAttemptVersionDrifted({ qVersion: snap }, originalQ)).toBe(false);

      // 3. 题干或选项修改（hash 改变）：检出漂移
      const modifiedStemQ = { ...originalQ, hash: "new-hash-stem-changed" };
      expect(isAttemptVersionDrifted({ qVersion: snap }, modifiedStemQ)).toBe(true);

      // 4. 答案修改（answer 改变）：检出漂移
      const modifiedAnsQ = { ...originalQ, answer: "B" };
      expect(isAttemptVersionDrifted({ qVersion: snap }, modifiedAnsQ)).toBe(true);
    });

    it("作答事件写入与题版锁定集成：题目现场编辑修改后，历史作答原版快照不被篡改", () => {
      const { app } = createMockApp();
      const q = makeQuestion({
        type: "single",
        stem: "历史原版题目",
        options: ["选项A", "选项B"],
        answer: "A",
      });

      // 1. 模拟在做题台提交作答，绑定当时不可变快照
      const event = app.recordAttempt({
        qid: q.id,
        kind: "practice",
        mode: "single",
        verdict: "correct",
        myAnswer: "A",
        sessionId: "s-1",
        queue: "normal",
        qVersion: createQuestionVersionSnapshot(q),
      });

      expect(event.qVersion).toBeDefined();
      expect(event.qVersion?.answer).toBe("A");
      expect(event.qVersion?.hash).toBe(q.hash);

      // 2. 模拟作者后续勘误改题：把答案改为 B，并修改题干
      const revisedQ = {
        ...q,
        stem: "历史修订后题目",
        answer: "B",
        hash: "hash-revised-2",
      };

      // 3. 再次查询历史作答记录，事件内保存的 qVersion 依旧完全不受影响
      const allEvents = app.attempts.all();
      const storedEvent = allEvents.find((e) => e.qid === q.id);
      expect(storedEvent?.qVersion?.answer).toBe("A");
      expect(storedEvent?.qVersion?.hash).toBe(q.hash);

      // 4. 漂移检测函数成功检出该作答与现场题目已发生漂移
      expect(isAttemptVersionDrifted(storedEvent, revisedQ)).toBe(true);
    });
  });
});
