import { describe, it, expect } from "vitest";
import { encodeChallenge, decodeChallenge, stripForTaker, compareAnswers } from "../src/core/challenge";
import type { ChallengePaper } from "../src/core/challenge";

const paper: ChallengePaper = {
  v: 1,
  title: "友谊赛",
  durationS: 600,
  questions: [
    { stem: "1+1？", options: ["1", "2"], answer: "B", type: "single", kp: "算术" },
    { stem: "对吗？", options: [], answer: "对", type: "judge", kp: "" },
  ],
};

describe("挑战码", () => {
  it("编码→解码往返无损", () => {
    const code = encodeChallenge(paper);
    expect(code).not.toContain("友谊赛"); // base64 编码
    const back = decodeChallenge(code)!;
    expect(back.title).toBe("友谊赛");
    expect(back.questions[0].answer).toBe(""); // 受卷方版本无答案
    expect(back.questions[0].stem).toBe("1+1？");
  });
  it("stripForTaker 剥答案", () => {
    const stripped = stripForTaker(paper);
    expect(stripped.questions.every((q) => q.answer === "")).toBe(true);
  });
  it("坏码 → null", () => {
    expect(decodeChallenge("!!!not-base64!!!")).toBeNull();
    expect(decodeChallenge("")).toBeNull();
  });
});

describe("compareAnswers（挑战码判分）", () => {
  it("含空位与大小写", () => {
    const r = compareAnswers("BADCA", "b.d?a");
    expect(r.correct).toBe(3); // B✓ .空 D✓ ?空 A✓
    expect(r.blank).toBe(2);
    expect(r.percent).toBe(60);
  });
});
