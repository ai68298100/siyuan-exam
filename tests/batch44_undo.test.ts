import { describe, it, expect } from "vitest";
import { makeQuestion } from "../src/core/blockTemplate";
import { PracticeSession } from "../src/core/session";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";

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

describe("44-09 快速撤销作答（四四批撤销回滚）", () => {
  describe("PracticeSession.undoLastSubmit 会话状态回滚", () => {
    it("无作答记录时撤销返回 null", () => {
      const q = makeQuestion({ type: "single", stem: "题1", options: ["A", "B"], answer: "A" });
      const session = new PracticeSession([q], "quick");
      expect(session.undoLastSubmit()).toBeNull();
    });

    it("提交答对后撤销：从 answered 弹出，恢复草稿与游标", () => {
      const q1 = makeQuestion({ type: "single", stem: "题1", options: ["A", "B"], answer: "A" });
      const q2 = makeQuestion({ type: "single", stem: "题2", options: ["A", "B"], answer: "B" });
      const session = new PracticeSession([q1, q2], "quick");

      session.submit("A", 1500);
      expect(session.answered).toHaveLength(1);
      expect(session.state.answered).toHaveLength(1);

      // 撤销作答
      const undone = session.undoLastSubmit();
      expect(undone).toEqual({ qid: q1.id, restoredAnswer: "A" });
      expect(session.answered).toHaveLength(0);
      expect(session.state.answered).toHaveLength(0);
      expect(session.state.cursor).toBe(0);
      expect(session.getDraft(q1.id)).toBe("A");
    });

    it("答错导致重排进队尾后撤销：安全从队尾移除重排题，清除 requeued 记录", () => {
      const q1 = makeQuestion({ type: "single", stem: "题1", options: ["A", "B"], answer: "A" });
      const q2 = makeQuestion({ type: "single", stem: "题2", options: ["A", "B"], answer: "B" });
      const session = new PracticeSession([q1, q2], "quick");

      // 第一题答错 -> 自动追加到队尾
      session.submit("B", 2000);
      expect(session.state.qids).toEqual([q1.id, q2.id, q1.id]);
      expect(session.state.requeued).toEqual([q1.id]);

      // 撤销这次提交
      const undone = session.undoLastSubmit();
      expect(undone).toEqual({ qid: q1.id, restoredAnswer: "B" });
      expect(session.state.qids).toEqual([q1.id, q2.id]); // 队尾错题已剔除
      expect(session.state.requeued).toHaveLength(0);
      expect(session.state.cursor).toBe(0);
      expect(session.getDraft(q1.id)).toBe("B");
    });
  });

  describe("AttemptLog.popLatest 流水回滚", () => {
    it("空流水调用 popLatest 返回 null", () => {
      const { app } = createMockApp();
      expect(app.attempts.popLatest()).toBeNull();
    });

    it("成功弹出最后一条事件，并在 seen 集合与 events 列表中清除", () => {
      const { app } = createMockApp();
      const e1 = app.recordAttempt({
        qid: "q1", kind: "practice", mode: "quick", verdict: "correct",
        myAnswer: "A", sessionId: "s1", queue: "normal",
      });
      const e2 = app.recordAttempt({
        qid: "q2", kind: "practice", mode: "quick", verdict: "wrong",
        myAnswer: "B", sessionId: "s1", queue: "normal",
      });

      expect(app.attempts.size).toBe(2);

      // 弹出最近一条 e2
      const popped = app.attempts.popLatest("s1", "q2");
      expect(popped?.eid).toBe(e2.eid);
      expect(app.attempts.size).toBe(1);
      expect(app.attempts.all()[0].eid).toBe(e1.eid);

      // 校验 sessionId 或 qid 不匹配时拒绝弹出
      expect(app.attempts.popLatest("s2")).toBeNull();
      expect(app.attempts.popLatest("s1", "wrong-qid")).toBeNull();
      expect(app.attempts.size).toBe(1);
    });
  });

  describe("ExamApp.undoLastAttempt 派生状态联动", () => {
    it("撤销答错事件后，派生视图中的错题物化记录立即被消除", () => {
      const { app } = createMockApp();
      const qid = "q-wrong-pop";

      // 答错记录流水 -> 错题本出现该错题
      app.recordAttempt({
        qid, kind: "practice", mode: "quick", verdict: "wrong",
        myAnswer: "B", sessionId: "s1", queue: "normal",
      });
      expect(app.wrongItems().some((w) => w.qid === qid)).toBe(true);

      // 撤销作答流水
      const undone = app.undoLastAttempt("s1", qid);
      expect(undone).not.toBeNull();
      expect(undone?.qid).toBe(qid);

      // 派生视图失效并重算，错题本中不再包含该错题
      expect(app.wrongItems().some((w) => w.qid === qid)).toBe(false);
    });
  });
});
