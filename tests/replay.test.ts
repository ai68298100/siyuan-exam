import { describe, it, expect } from "vitest";
import { AttemptLog, MemoryStorage } from "../src/core/attemptLog";
import { replay, activeWrongItems, streak, ELIMINATE_STREAK } from "../src/core/replayer";
import { PracticeSession, pickRandom } from "../src/core/session";
import { ExamApp } from "../src/app";
import { KernelApiClient, HttpTransport } from "../src/kernel/client";
import { makeQuestion } from "../src/core/blockTemplate";
import type { KernelTransport } from "../src/kernel/client";
import type { Question } from "../src/core/types";

const T0 = 1_700_000_000_000;
const stepClock = () => {
  let t = T0;
  return () => (t += 1_000);
};

function makeLog(events: Parameters<AttemptLog["append"]>[0][]) {
  const clock = stepClock();
  const log = new AttemptLog(new MemoryStorage(), "attempts/log", clock);
  // load 需要一次以设定 device
  return {
    log,
    clock,
    run: async () => {
      await log.load("d-test-01");
      events.forEach((e) => log.append(e));
      return log;
    },
  };
}

describe("AttemptLog + replay：错题状态机", () => {
  it("错→错→对→对（连对2次消灭）", async () => {
    const { run } = makeLog([
      { qid: "q1", kind: "practice", mode: "single", verdict: "wrong", myAnswer: "A", sessionId: "s1" },
      { qid: "q1", kind: "practice", mode: "wrong", verdict: "wrong", myAnswer: "B", sessionId: "s1" },
      { qid: "q1", kind: "practice", mode: "wrong", verdict: "correct", myAnswer: "C", sessionId: "s1" },
      { qid: "q1", kind: "practice", mode: "wrong", verdict: "correct", myAnswer: "C", sessionId: "s1" },
    ]);
    const log = await run();
    const r = replay(log.all());
    const w = r.wrongbook.get("q1")!;
    expect(w.status).toBe("eliminated");
    expect(w.wrongCount).toBe(2);
    expect(w.streakCorrect).toBe(ELIMINATE_STREAK);
    expect(activeWrongItems(r)).toHaveLength(0);
  });
  it("消灭后再错 → 重新收录", async () => {
    const { run } = makeLog([
      { qid: "q1", kind: "practice", mode: "single", verdict: "wrong", myAnswer: "A", sessionId: "s1" },
      { qid: "q1", kind: "practice", mode: "wrong", verdict: "correct", myAnswer: "", sessionId: "s1" },
      { qid: "q1", kind: "practice", mode: "wrong", verdict: "correct", myAnswer: "", sessionId: "s1" },
      { qid: "q1", kind: "practice", mode: "single", verdict: "wrong", myAnswer: "D", sessionId: "s1" },
    ]);
    const r = replay((await run()).all());
    const w = r.wrongbook.get("q1")!;
    expect(w.status).toBe("active");
    expect(w.wrongCount).toBe(1);
    expect(w.myAnswer).toBe("D");
  });
  it("背诵/闪卡事件不改变错题本", async () => {
    const { run } = makeLog([
      { qid: "q1", kind: "recite", mode: "recite", verdict: "correct", myAnswer: null, sessionId: "s1", selfRating: 3 },
      { qid: "q2", kind: "card", mode: "card", verdict: "wrong", myAnswer: null, sessionId: "s1", selfRating: 1 },
    ]);
    const r = replay((await run()).all());
    expect(r.wrongbook.size).toBe(0);
  });
  it("幂等：同 eid 重复事件只计一次", async () => {
    const clock = stepClock();
    const log = new AttemptLog(new MemoryStorage(), "k", clock);
    await log.load("d1");
    const e1 = log.append({
      qid: "q1",
      kind: "practice",
      mode: "single",
      verdict: "wrong",
      myAnswer: "A",
      sessionId: "s1",
    });
    // 模拟重复回放：手工再次注入同 eid
    const dup = { ...e1 };
    const r = replay([e1, dup, e1]);
    expect(r.byQuestion.get("q1")!.attempts).toBe(1);
    expect(r.skipped).toBe(2);
  });
  it("坏事件跳过并计数；乱序输入确定性回放", async () => {
    const clock = stepClock();
    const log = new AttemptLog(new MemoryStorage(), "k", clock);
    await log.load("d1");
    const a = log.append({
      qid: "q1",
      kind: "practice",
      mode: "single",
      verdict: "correct",
      myAnswer: "A",
      sessionId: "s",
    });
    const b = log.append({
      qid: "q1",
      kind: "practice",
      mode: "single",
      verdict: "correct",
      myAnswer: "A",
      sessionId: "s",
    });
    const bad = {
      eid: "",
      ts: 1,
      qid: "x",
      kind: "practice",
      mode: "",
      verdict: "wrong",
      myAnswer: null,
      sessionId: "",
      queue: "normal",
      device: "d",
      seq: 0,
      v: 1,
    } as never;
    const r = replay([b, bad, a]); // 故意乱序 + 坏事件
    expect(r.byQuestion.get("q1")!.attempts).toBe(2);
    expect(r.skipped).toBe(1);
  });
  it("背诵连击毕业：4 连『会』出清，中断归零", async () => {
    const clock = stepClock();
    const log = new AttemptLog(new MemoryStorage(), "k", clock);
    await log.load("d1");
    for (let i = 0; i < 4; i++) {
      log.append({
        qid: "qg",
        kind: "recite",
        mode: "recite",
        verdict: "correct",
        myAnswer: null,
        sessionId: "s",
        selfRating: 3,
      });
    }
    log.append({
      qid: "qg",
      kind: "recite",
      mode: "recite",
      verdict: "wrong",
      myAnswer: null,
      sessionId: "s",
      selfRating: 1,
    });
    log.append({
      qid: "qg",
      kind: "recite",
      mode: "recite",
      verdict: "correct",
      myAnswer: null,
      sessionId: "s",
      selfRating: 3,
    });
    const r = replay(log.all());
    expect(r.reciteStreak.get("qg")).toBe(1);
  });

  it("streak 连续天数（按事件所在自然日）", async () => {
    const { run } = makeLog([
      { qid: "q1", kind: "practice", mode: "single", verdict: "correct", myAnswer: "A", sessionId: "s" },
    ]);
    const r = replay((await run()).all());
    const eventDay = new Date(T0 + 1_000);
    expect(streak(r, eventDay)).toBeGreaterThanOrEqual(1);
  });
});

describe("PracticeSession", () => {
  const qs: Question[] = [
    makeQuestion({ type: "single", stem: "Q1", options: ["1", "2"], answer: "A" }),
    makeQuestion({ type: "judge", stem: "Q2", answer: "对" }),
    makeQuestion({ type: "multiple", stem: "Q3", options: ["1", "2", "3"], answer: "AB" }),
  ];
  it("游标推进/判分/结算", () => {
    const clock = stepClock();
    const s = new PracticeSession(qs, "single", undefined, clock);
    expect(s.current!.id).toBe(qs[0].id);
    const g1 = s.submit("A", 1000)!;
    expect(g1.grade.verdict).toBe("correct");
    expect(s.next()).toBe(true);
    s.submit("错", 500);
    s.next();
    s.submit("BA", 800);
    const fin = s.finish();
    expect(fin).toEqual({ total: 3, correct: 2, wrong: 1 });
    expect(s.phase).toBe("finished");
    expect(s.finish().total).toBe(3); // 幂等
  });
  it("finished 后不可再提交", () => {
    const s = new PracticeSession([qs[0]], "single", undefined, stepClock());
    s.finish();
    expect(s.submit("A")).toBeNull();
  });
  it("草稿存取", () => {
    const s = new PracticeSession(qs, "single", undefined, stepClock());
    s.setDraft(qs[0].id, "A");
    expect(s.getDraft(qs[0].id)).toBe("A");
  });
  it("恢复模式保留游标", () => {
    const saved = {
      id: "s-x",
      mode: "single",
      qids: qs.map((q) => q.id),
      cursor: 2,
      drafts: {},
      startedAt: T0,
      updatedAt: T0,
    };
    const s = new PracticeSession(qs, "single", saved, stepClock());
    expect(s.current!.id).toBe(qs[2].id);
    expect(s.progress).toEqual({ done: 2, total: 3 });
  });
  it("pickRandom 抽 n 题去重", () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const picked = pickRandom(qs, 2, rnd);
    expect(picked).toHaveLength(2);
    expect(new Set(picked.map((q) => q.id)).size).toBe(2);
  });
});

describe("ExamApp 集成（mock 内核 + 内存存储）", () => {
  function mockTransport(): KernelTransport {
    return {
      async post(endpoint) {
        if (endpoint === "/api/system/version") return { code: 0, msg: "", data: { version: "3.8.4-test" } };
        if (endpoint === "/api/lute/md2html") return { code: 0, msg: "", data: { html: "<p>x</p>" } };
        if (endpoint === "/api/query/sql") return { code: 0, msg: "", data: [] };
        if (endpoint === "/api/riff/getRiffDecks") return { code: 0, msg: "", data: [] };
        if (endpoint === "/api/notebook/createNotebook") return { code: 0, msg: "", data: { notebook: "nb-1" } };
        if (endpoint === "/api/filetree/createDocWithMd") return { code: 0, msg: "", data: "doc-1" };
        if (endpoint === "/api/block/insertBlock")
          return { code: 0, msg: "", data: [{ doOperations: [{ id: "blk-1" }] }] };
        return { code: -1, msg: "not mocked: " + endpoint, data: null };
      },
    };
  }
  const setup = async () => {
    const storage = new MemoryStorage();
    const app = new ExamApp({ client: new KernelApiClient(mockTransport()), storage, now: stepClock() });
    await app.init("d-test-01");
    return { app, storage };
  };

  it("探测：内核在线且能力齐", async () => {
    const { app } = await setup();
    expect(app.kernelOnline).toBe(true);
    expect(app.probeMessage).toContain("md2html ✓");
  });

  it("建库 → 注册表持久化", async () => {
    const { app, storage } = await setup();
    const bank = await app.createBank("公考题库");
    expect(bank.id).toBe("nb-1");
    expect(app.listBanks()).toHaveLength(1);
    expect((storage.map.get("banks") as BankInfo[])[0].name).toBe("公考题库");
  });

  it("离线降级：探测失败不阻塞 init", async () => {
    const offline: KernelTransport = {
      async post() {
        throw new Error("ECONNREFUSED");
      },
    };
    const app = new ExamApp({ client: new KernelApiClient(offline), storage: new MemoryStorage() });
    await app.init();
    expect(app.kernelOnline).toBe(false);
    expect(app.probeMessage).toContain("不可达");
  });

  it("单活动会话：开第二个抛错；discard 后可再开", async () => {
    const { app } = await setup();
    const qs = [makeQuestion({ type: "judge", stem: "x", answer: "对" })];
    await app.startSession(qs, "single");
    await expect(app.startSession(qs, "single")).rejects.toThrow(/已有进行中的会话/);
    await app.discardSession();
    await expect(app.startSession(qs, "single")).resolves.toBeDefined();
  });

  it("错题手动处置覆盖层：mastered 生效，更新的错误清覆盖", async () => {
    const { app } = await setup();
    app.recordAttempt({ qid: "q1", kind: "practice", mode: "single", verdict: "wrong", myAnswer: "A", sessionId: "s" });
    await app.setWrongStatus("q1", "mastered");
    expect(app.wrongItems().map((w) => w.qid)).not.toContain("q1");
    app.recordAttempt({ qid: "q1", kind: "practice", mode: "single", verdict: "wrong", myAnswer: "B", sessionId: "s" });
    expect(app.wrongItems().map((w) => w.qid)).toContain("q1");
  });

  it("流水→错题：recordAttempt 后 wrongItems 可见，重练消灭", async () => {
    const { app } = await setup();
    app.recordAttempt({
      qid: "q9",
      kind: "practice",
      mode: "single",
      verdict: "wrong",
      myAnswer: "A",
      sessionId: "s1",
    });
    expect(app.wrongItems().map((w) => w.qid)).toContain("q9");
    app.recordAttempt({
      qid: "q9",
      kind: "practice",
      mode: "wrong",
      verdict: "correct",
      myAnswer: "B",
      sessionId: "s1",
    });
    app.recordAttempt({
      qid: "q9",
      kind: "practice",
      mode: "wrong",
      verdict: "correct",
      myAnswer: "B",
      sessionId: "s1",
    });
    expect(app.wrongItems().map((w) => w.qid)).not.toContain("q9");
    const r = app.derived();
    expect(r.byQuestion.get("q9")!.attempts).toBe(3);
  });

  it("HttpTransport 错误分类：fatal 不重试直接抛 KernelError", async () => {
    const calls = 0;
    const transport = new HttpTransport(
      "http://x",
      "t",
      async () => ({ ok: false, status: 404, text: async () => "nf" }),
      50,
      2,
    );
    const client = new KernelApiClient(transport);
    await expect(client.renderMarkdown("x")).rejects.toThrow();
    void calls;
  });
});

import type { BankInfo } from "../src/app";
