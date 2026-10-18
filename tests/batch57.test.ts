import { describe, it, expect } from "vitest";
import {
  createDisputeRecord,
  resolveDisputeRecord,
  isQuestionDisputed,
  filterEligibleQuestions,
  DISPUTE_REASON_LABELS,
} from "../src/core/dispute";
import { ialOf, makeQuestion, questionFromBlock } from "../src/core/blockTemplate";
import { assemble, type Blueprint } from "../src/core/mock";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import type { Question } from "../src/core/types";

function createMockApp() {
  const blockAttrs = new Map<string, Record<string, string>>();

  const client = {
    sql: async () => [],
    setExamAttrs: async (blockId: string, attrs: Record<string, string>) => {
      const existing = blockAttrs.get(blockId) ?? {};
      blockAttrs.set(blockId, { ...existing, ...attrs });
    },
    listQuestions: async () => [],
  } as unknown as KernelApiClient;

  const storage = new MemoryStorage();
  const app = new ExamApp({ client, storage, now: () => 1_800_000_000_000 });
  app.kernelOnline = true;

  return { app, client, blockAttrs, storage };
}

describe("57-04 争议题状态与处置单（五七批）", () => {
  describe("dispute 纯函数与状态判定", () => {
    it("createDisputeRecord 正确构建争议记录对象", () => {
      const record = createDisputeRecord("wrong_answer", "官方最新勘误将原答案A修正为B", 1_700_000_000_000);
      expect(record.v).toBe(1);
      expect(record.reason).toBe("wrong_answer");
      expect(record.note).toBe("官方最新勘误将原答案A修正为B");
      expect(record.at).toBe(1_700_000_000_000);
      expect(record.resolved).toBe(false);
      expect(DISPUTE_REASON_LABELS.wrong_answer).toBe("标准答案有误/存疑");
    });

    it("resolveDisputeRecord 正确记录处置决议与解决时间戳", () => {
      const record = createDisputeRecord("expired_data", "原题涉及法条已于2025年废止", 1_700_000_000_000);
      const resolved = resolveDisputeRecord(record, "已更正题干并采用新法条解析", 1_700_000_000_500);

      expect(resolved.resolved).toBe(true);
      expect(resolved.resolvedAt).toBe(1_700_000_000_500);
      expect(resolved.resolution).toBe("已更正题干并采用新法条解析");
      expect(resolved.reason).toBe("expired_data");
      expect(resolved.note).toBe("原题涉及法条已于2025年废止");
    });

    it("isQuestionDisputed 与 filterEligibleQuestions 准确识别并排除未决争议题", () => {
      const normalQ = makeQuestion({ type: "single", stem: "正常题", options: ["A", "B"], answer: "A" });
      const disputedQ = {
        ...makeQuestion({ type: "single", stem: "争议题", options: ["A", "B"], answer: "A" }),
        dispute: createDisputeRecord("multi_answer", "选项A和B均符合题意"),
      };
      const resolvedQ = {
        ...makeQuestion({ type: "single", stem: "已解决题", options: ["A", "B"], answer: "A" }),
        dispute: resolveDisputeRecord(createDisputeRecord("missing_condition", "缺条件"), "已补充前提条件"),
      };

      expect(isQuestionDisputed(normalQ)).toBe(false);
      expect(isQuestionDisputed(disputedQ)).toBe(true);
      expect(isQuestionDisputed(resolvedQ)).toBe(false);

      const eligible = filterEligibleQuestions([normalQ, disputedQ, resolvedQ]);
      expect(eligible.map((q) => q.stem)).toEqual(["正常题", "已解决题"]);
    });
  });

  describe("题块 IAL 序列化与反序列化", () => {
    it("ialOf 包含 custom-exam-dispute 且 questionFromBlock 完整读回", () => {
      const dispute = createDisputeRecord("multi_answer", "题意模糊产生多解", 1_700_000_000_000);
      const q = {
        ...makeQuestion({ type: "single", stem: "多选题干", options: ["A", "B"], answer: "A" }),
        dispute,
      };

      const ial = ialOf(q);
      expect(ial).toContain("custom-exam-dispute=");

      const restored = questionFromBlock({
        attrs: {
          "custom-exam-id": q.id,
          "custom-exam-type": "single",
          "custom-exam-answer": "A",
          "custom-exam-dispute": JSON.stringify(dispute),
        },
        text: "多选题干\n- A. 选项A\n- B. 选项B",
      });

      expect(restored).not.toBeNull();
      expect(restored?.dispute).toEqual(dispute);
      expect(isQuestionDisputed(restored)).toBe(true);
    });
  });

  describe("模考组卷自动排除争议题（assemble 57-04 验收）", () => {
    it("模考组卷选池时默认排除未解决的争议题", () => {
      const bp: Blueprint = {
        id: "bp-1",
        name: "测试模考",
        durationS: 3600,
        sections: [
          { name: "单选区", count: 2, scoreEach: 1, source: "mixed", types: ["single"] },
        ],
      };

      const normalQ1 = makeQuestion({ type: "single", stem: "合法单选1", options: ["A", "B"], answer: "A" });
      const normalQ2 = makeQuestion({ type: "single", stem: "合法单选2", options: ["A", "B"], answer: "B" });
      const disputedQ = {
        ...makeQuestion({ type: "single", stem: "有争议单选", options: ["A", "B"], answer: "A" }),
        dispute: createDisputeRecord("wrong_answer", "答案有明显事实错误"),
      };

      const bank = [normalQ1, disputedQ, normalQ2];
      const result = assemble(bp, bank);

      expect(result.paper).toHaveLength(2);
      expect(result.paper.map((q) => q.stem).sort()).toEqual(["合法单选1", "合法单选2"]);
      expect(result.paper.some((q) => q.id === disputedQ.id)).toBe(false);
    });
  });

  describe("ExamApp 应用层标记与处置流转", () => {
    it("flagQuestionDispute 写入块属性并追加修订记录", async () => {
      const { app, blockAttrs } = createMockApp();
      const q = makeQuestion({ type: "single", stem: "题目", options: ["A", "B"], answer: "A" }) as Question & { blockId: string };
      q.blockId = "b-" + q.id;

      await app.flagQuestionDispute(q, "wrong_answer", "参考答案与官方解析矛盾");
      expect(isQuestionDisputed(q)).toBe(true);

      const savedAttr = blockAttrs.get(q.blockId)?.["exam-dispute"];
      expect(savedAttr).toBeDefined();
      const parsed = JSON.parse(savedAttr!);
      expect(parsed.reason).toBe("wrong_answer");
      expect(parsed.note).toBe("参考答案与官方解析矛盾");

      const revs = await app.questionRevisions(q.id);
      expect(revs).toHaveLength(1);
      expect(revs[0].summary).toContain("标记争议: 标准答案有误/存疑");
    });

    it("resolveQuestionDispute 更新处置说明并解除未决状态", async () => {
      const { app, blockAttrs } = createMockApp();
      const q = makeQuestion({ type: "single", stem: "题目", options: ["A", "B"], answer: "A" }) as Question & { blockId: string };
      q.blockId = "b-" + q.id;

      await app.flagQuestionDispute(q, "expired_data", "数据年份陈旧");
      expect(isQuestionDisputed(q)).toBe(true);

      await app.resolveQuestionDispute(q, "已更新最新2026年宏观经济指标与解析");
      expect(isQuestionDisputed(q)).toBe(false);
      expect(q.dispute?.resolved).toBe(true);
      expect(q.dispute?.resolution).toBe("已更新最新2026年宏观经济指标与解析");

      const savedAttr = blockAttrs.get(q.blockId)?.["exam-dispute"];
      const parsed = JSON.parse(savedAttr!);
      expect(parsed.resolved).toBe(true);
    });

    it("clearQuestionDispute 清除块属性与题目争议记录", async () => {
      const { app, blockAttrs } = createMockApp();
      const q = makeQuestion({ type: "single", stem: "题目", options: ["A", "B"], answer: "A" }) as Question & { blockId: string };
      q.blockId = "b-" + q.id;

      await app.flagQuestionDispute(q, "other", "题干字号异常");
      expect(q.dispute).toBeDefined();

      await app.clearQuestionDispute(q);
      expect(q.dispute).toBeUndefined();
      expect(blockAttrs.get(q.blockId)?.["exam-dispute"]).toBe("");
    });

    it("quickDrill 与 recitePool 自动排除未决争议题", () => {
      const { app } = createMockApp();
      const normalQ = makeQuestion({ type: "single", stem: "正常题", options: ["A", "B"], answer: "A" });
      const disputedQ = {
        ...makeQuestion({ type: "single", stem: "争议题", options: ["A", "B"], answer: "A" }),
        dispute: createDisputeRecord("multi_answer", "多解"),
      };

      const drill = app.quickDrill([normalQ, disputedQ], 5);
      expect(drill).toHaveLength(1);
      expect(drill[0].id).toBe(normalQ.id);

      const recite = app.recitePool([normalQ, disputedQ]);
      expect(recite).toHaveLength(1);
      expect(recite[0].id).toBe(normalQ.id);
    });
  });
});
