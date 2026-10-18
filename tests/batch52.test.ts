import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isStubbornWrong,
  getStubbornRemediation,
  filterStubbornWrongs,
  DEFAULT_STUBBORN_MIN_WRONGS,
  DEFAULT_EXTREME_TIME_MS,
  REMEDIATION_LABELS,
} from "../src/core/stubborn";
import type { WrongItem } from "../src/core/types";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import { onExamEvent } from "../src/core/bus";

/** node 测试环境无 window：用 EventTarget 桩 */
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget() as unknown as Window & typeof globalThis);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const mockWrong = (over: Partial<WrongItem> = {}): WrongItem => ({
  qid: "q-" + Math.random().toString(36).slice(2),
  firstWrongAt: 1_700_000_000_000,
  lastWrongAt: 1_700_000_050_000,
  wrongCount: 1,
  streakCorrect: 0,
  myAnswer: "B",
  status: "active",
  ...over,
});

function createMockApp() {
  const client = {
    sql: async () => [],
    listQuestions: async () => [],
  } as unknown as KernelApiClient;

  const storage = new MemoryStorage();
  const app = new ExamApp({ client, storage, now: () => 1_800_000_000_000 });
  app.kernelOnline = true;

  return { app, client, storage };
}

describe("52-06 顽固题处理而非无限回流（五二批）", () => {
  describe("isStubbornWrong 判定纯函数", () => {
    it("错次不足门槛且无极端耗时 → 不是顽固题", () => {
      const w1 = mockWrong({ wrongCount: 1, streakCorrect: 0 });
      const w2 = mockWrong({ wrongCount: 2, streakCorrect: 0 });
      expect(isStubbornWrong(w1)).toBe(false);
      expect(isStubbornWrong(w2)).toBe(false);
    });

    it("错次达到门槛（>= 3）且连续答对为 0 → 判定为顽固题", () => {
      const w = mockWrong({ wrongCount: DEFAULT_STUBBORN_MIN_WRONGS, streakCorrect: 0 });
      expect(isStubbornWrong(w)).toBe(true);
    });

    it("虽错次达标但已有连续答对（处于消灭爬坡期）→ 暂不判为顽固题", () => {
      const w = mockWrong({ wrongCount: 4, streakCorrect: 1 });
      expect(isStubbornWrong(w)).toBe(false);
    });

    it("平均耗时极端超标（>= 120s）且错次 >= 2 → 判定为顽固题", () => {
      const w = mockWrong({ wrongCount: 2, streakCorrect: 0 });
      expect(isStubbornWrong(w, { avgTimeMs: DEFAULT_EXTREME_TIME_MS })).toBe(true);
      expect(isStubbornWrong(w, { avgTimeMs: 60_000 })).toBe(false);
    });

    it("支持自定义门槛配置", () => {
      const w = mockWrong({ wrongCount: 2, streakCorrect: 0 });
      expect(isStubbornWrong(w, { threshold: { minWrongCount: 2 } })).toBe(true);
    });
  });

  describe("getStubbornRemediation 处置建议生成", () => {
    it("非顽固题返回空建议列表", () => {
      const w = mockWrong({ wrongCount: 1, streakCorrect: 0 });
      const rem = getStubbornRemediation(w);
      expect(rem.isStubborn).toBe(false);
      expect(rem.suggestedActions).toHaveLength(0);
    });

    it("刚达标错题主要建议为 snooze 暂缓冷却", () => {
      const w = mockWrong({ wrongCount: 3, streakCorrect: 0 });
      const rem = getStubbornRemediation(w);
      expect(rem.isStubborn).toBe(true);
      expect(rem.primaryAction).toBe("snooze");
      expect(rem.reasonText).toContain("建议暂缓 7 天冷却或封存归档");
      expect(REMEDIATION_LABELS.snooze).toBe("暂缓复习");
    });

    it("反复严重做错（>= 5 次）主要建议为 archive 封存归档", () => {
      const w = mockWrong({ wrongCount: 5, streakCorrect: 0 });
      const rem = getStubbornRemediation(w);
      expect(rem.isStubborn).toBe(true);
      expect(rem.primaryAction).toBe("archive");
      expect(rem.reasonText).toContain("建议直接归档或排查争议");
    });

    it("极端耗时主要建议为 prerequisite 补前置考点", () => {
      const w = mockWrong({ wrongCount: 2, streakCorrect: 0 });
      const rem = getStubbornRemediation(w, { avgTimeMs: 150_000 });
      expect(rem.isStubborn).toBe(true);
      expect(rem.primaryAction).toBe("prerequisite");
      expect(rem.reasonText).toContain("建议补充前置知识点或拆分子题");
    });
  });

  describe("filterStubbornWrongs 批量过滤", () => {
    it("正确从错题清单中挑选出顽固题", () => {
      const w1 = mockWrong({ qid: "q1", wrongCount: 1 });
      const w2 = mockWrong({ qid: "q2", wrongCount: 3, streakCorrect: 0 });
      const w3 = mockWrong({ qid: "q3", wrongCount: 4, streakCorrect: 1 });
      const w4 = mockWrong({ qid: "q4", wrongCount: 2, streakCorrect: 0 });

      const times = new Map([["q4", 130_000]]);
      const stubborns = filterStubbornWrongs([w1, w2, w3, w4], times);

      expect(stubborns.map((w) => w.qid)).toEqual(["q2", "q4"]);
    });
  });

  describe("ExamApp 顽固题封存归档与解除状态机", () => {
    it("archiveWrong 归档后从 active 列表中剔除，并在 listArchivedWrongs 中可见", async () => {
      const { app } = createMockApp();
      const qid = "q-stubborn-1";

      // 1. 造 3 次做错事件形成活跃错题
      for (let i = 0; i < 3; i++) {
        app.recordAttempt({
          qid,
          kind: "practice",
          mode: "quick",
          verdict: "wrong",
          myAnswer: "B",
          sessionId: "s1",
          queue: "normal",
        });
      }

      expect(app.wrongItems().some((w) => w.qid === qid)).toBe(true);
      expect(app.isWrongArchived(qid)).toBe(false);

      // 2. 执行归档并监听总线事件
      let eventPayload: { qid: string; status: string } | null = null;
      const off = onExamEvent<{ qid: string; status: string }>("wrongbook-changed", (env) => {
        eventPayload = env.payload;
      });

      await app.archiveWrong(qid);
      expect(eventPayload).toEqual({ qid, status: "archived" });
      off();

      // 3. 校验状态：在册错题中排除，归档错题中包含
      expect(app.isWrongArchived(qid)).toBe(true);
      expect(app.wrongItems().some((w) => w.qid === qid)).toBe(false);

      const archived = app.listArchivedWrongs();
      expect(archived.some((w) => w.qid === qid)).toBe(true);
      expect(archived[0].wrongCount).toBe(3);

      // 4. 解除归档 unarchiveWrong，错题顺利恢复回在册队列
      await app.unarchiveWrong(qid);
      expect(app.isWrongArchived(qid)).toBe(false);
      expect(app.wrongItems().some((w) => w.qid === qid)).toBe(true);
    });

    it("归档后若该题再次做错（wrongCount 增长），归档覆盖层自动失效回册", async () => {
      const { app } = createMockApp();
      const qid = "q-stubborn-2";

      // 1. 产生 3 次答错
      for (let i = 0; i < 3; i++) {
        app.recordAttempt({
          qid,
          kind: "practice",
          mode: "quick",
          verdict: "wrong",
          myAnswer: "B",
          sessionId: "s1",
          queue: "normal",
        });
      }
      await app.archiveWrong(qid);
      expect(app.wrongItems().some((w) => w.qid === qid)).toBe(false);

      // 2. 模拟后续再次答错（第 4 次答错）
      app.recordAttempt({
        qid,
        kind: "practice",
        mode: "quick",
        verdict: "wrong",
        myAnswer: "C",
        sessionId: "s2",
        queue: "normal",
      });

      // 3. 错次从 3 变为 4，覆盖层失效，题目自动重回在册队列
      expect(app.isWrongArchived(qid)).toBe(false);
      expect(app.wrongItems().some((w) => w.qid === qid)).toBe(true);
      expect(app.wrongItems().find((w) => w.qid === qid)?.wrongCount).toBe(4);
    });
  });
});
