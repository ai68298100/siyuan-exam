import { describe, it, expect } from "vitest";
import { delayedRecall, exposureStats } from "../src/core/report";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import type { AttemptEvent } from "../src/core/types";

const DAY = 86_400_000;
const ev = (over: Partial<AttemptEvent>): AttemptEvent =>
  ({
    v: 2, eid: "e", ts: DAY, qid: "q1", kind: "practice", mode: "single",
    verdict: "wrong", myAnswer: "A", sessionId: "s1", queue: "normal", device: "d", seq: 1,
    ...over,
  }) as AttemptEvent;

describe("延迟独立回忆（39-08 lite，三九批）", () => {
  it("隔日首次作答为复测：同日反复刷不计；受助单列；无配对 rate=null", () => {
    const T0 = 10 * DAY;
    const events = [
      ev({ eid: "w", ts: T0, verdict: "wrong" }),
      // 同日反复刷对 ×2 → 不计复测
      ev({ eid: "s1", ts: T0 + 3_600_000, verdict: "correct", myAnswer: "B" }),
      ev({ eid: "s2", ts: T0 + 7_200_000, verdict: "correct", myAnswer: "B" }),
      // 隔日首次：受助答对 → assistedCorrect
      ev({ eid: "d1", ts: T0 + DAY, verdict: "correct", myAnswer: "B", help: "explain" }),
      // 另一题：隔日独立答对
      ev({ eid: "w2", ts: T0, qid: "q2", verdict: "wrong" }),
      ev({ eid: "d2", ts: T0 + 2 * DAY, qid: "q2", verdict: "correct", myAnswer: "C" }),
      // 另一题：隔日仍错
      ev({ eid: "w3", ts: T0, qid: "q3", verdict: "wrong" }),
      ev({ eid: "d3", ts: T0 + DAY + 1, qid: "q3", verdict: "wrong", myAnswer: "X" }),
    ];
    const r = delayedRecall(events);
    expect(r.pairs).toBe(3);
    expect(r.independentRecall).toBe(1);
    expect(r.assistedCorrect).toBe(1);
    expect(r.stillWrong).toBe(1);
    expect(r.rate).toBe(33);
  });

  it("不足隔日（同日内）无复测资格；空流水 rate=null", () => {
    const T0 = 5 * DAY;
    const r1 = delayedRecall([
      ev({ eid: "w", ts: T0, verdict: "wrong" }),
      ev({ eid: "d", ts: T0 + 1000, verdict: "correct" }), // 同日 → 无资格
    ]);
    expect(r1.pairs).toBe(0);
    expect(r1.rate).toBeNull();
    expect(delayedRecall([]).rate).toBeNull();
  });
});

describe("错题自诊断（52-04 lite，三九批）", () => {
  it("保存→读回→覆盖→清空（个人记录与流水解耦）", async () => {
    const app = new ExamApp({
      client: { sql: async () => [] } as unknown as KernelApiClient,
      storage: new MemoryStorage(),
      now: () => 1_800_000_000_000,
    });
    await app.saveWrongReflection("q1", "把 B 看成了 D，下次先圈关键词");
    expect((await app.loadWrongReflection("q1"))?.text).toContain("圈关键词");
    await app.saveWrongReflection("q1", "第二次复盘：审题跳步");
    expect((await app.loadWrongReflection("q1"))?.text).toBe("第二次复盘：审题跳步");
    await app.saveWrongReflection("q1", "");
    expect(await app.loadWrongReflection("q1")).toBeNull(); // 空文本=删除检查点
  });
});

describe("暴露三口径分栏（52-02/114-01 呈现端，五一批）", () => {
  const mk = (over: Partial<AttemptEvent>): AttemptEvent =>
    ({
      v: 1, eid: "e", ts: 1, qid: "q", kind: "practice", mode: "single",
      verdict: "correct", myAnswer: "A", sessionId: "s", queue: "normal", device: "d", seq: 1,
      ...over,
    }) as AttemptEvent;

  it("独立/受助/先回忆互不混算；not_attempted 与 recite/card 不计入", () => {
    const r = exposureStats([
      mk({ eid: "1" }),                                                          // 独立
      mk({ eid: "2", help: "explain" }),                                         // 受助
      mk({ eid: "3", recall: true }),                                            // 先回忆（独立口径外）
      mk({ eid: "4", help: "hint", recall: true }),                              // 受助+先回忆：两维各计一次
      mk({ eid: "5", verdict: "not_attempted" }),                                // 跳过不计
      mk({ eid: "6", kind: "recite", selfRating: 3 }),                           // 背诵不计
    ]);
    expect(r.attempts).toBe(4);
    expect(r.independent).toBe(1);
    expect(r.assisted).toBe(2); // eid 2、4
    expect(r.recallFirst).toBe(2); // eid 3、4
  });

  it("空流水归零", () => {
    expect(exposureStats([])).toEqual({ attempts: 0, independent: 0, assisted: 0, recallFirst: 0 });
  });
});
