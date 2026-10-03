import { describe, it, expect } from "vitest";
import { validateBlueprint, dedupeSectionNames, type Blueprint } from "../src/core/mock";
import { parseExamProfiles, nearestUpcoming } from "../src/core/planner";
import { calibration } from "../src/core/report";
import type { AttemptEvent } from "../src/core/types";

const bp = (sections: Blueprint["sections"]): Blueprint => ({
  id: "bp", name: "测试卷", durationS: 1800, passLine: 60,
  shuffleOptions: false, sectionTimed: false, sections,
});

describe("40-02 蓝图健康检查（四十批）", () => {
  it("重名段/零题段/空段名/分值/时长/及格线逐项检出", () => {
    const issues = validateBlueprint(bp([
      { name: "言语", count: 5, scoreEach: 1, source: "mixed", types: [] },
      { name: "言语", count: 3, scoreEach: 1, source: "mixed", types: [] },
      { name: "", count: 0, scoreEach: 2, source: "mixed", types: [] },
      { name: "数量", count: 2, scoreEach: 0, source: "mixed", types: [] },
    ]));
    const text = issues.join("；");
    expect(text).toContain("重复 2 次");
    expect(text).toContain("题数为 0");
    expect(text).toContain("段名不能为空");
    expect(text).toContain("每题分值 ≤ 0");
    expect(validateBlueprint(bp([{ name: "言语", count: 5, scoreEach: 1, source: "mixed", types: [] }]))).toHaveLength(0);
  });

  it("及格线越界与时长 ≤0 检出", () => {
    const bad = { ...bp([{ name: "A", count: 1, scoreEach: 1, source: "mixed", types: [] }]), passLine: 150, durationS: 0 };
    const text = validateBlueprint(bad).join("；");
    expect(text).toContain("及格线");
    expect(text).toContain("总时长");
  });

  it("dedupeSectionNames：重名加 -2/-3 后缀；原对象不变", () => {
    const original = bp([
      { name: "言语", count: 1, scoreEach: 1, source: "mixed", types: [] },
      { name: "言语", count: 1, scoreEach: 1, source: "mixed", types: [] },
      { name: "言语", count: 1, scoreEach: 1, source: "mixed", types: [] },
    ]);
    const fixed = dedupeSectionNames(original);
    expect(fixed.sections.map((s) => s.name)).toEqual(["言语", "言语-2", "言语-3"]);
    expect(original.sections[1].name).toBe("言语"); // 不可变
  });
});

describe("53-02 多考期解析（四十批）", () => {
  it("逐行解析（全角冒号兼容）、非法行跳过、按剩余天数升序", () => {
    const now = new Date(2026, 9, 4); // 2026-10-04
    const list = parseExamProfiles("行测:2026-11-20\n申论：2026-10-10\n垃圾行\n面试:2026-13-99", now);
    expect(list.map((p) => p.name)).toEqual(["申论", "行测"]);
    expect(list[0].days).toBe(6);
    expect(list[1].days).toBe(47);
  });

  it("nearestUpcoming：已过期不锚定；全过期/空 → null", () => {
    const now = new Date(2026, 9, 4);
    expect(nearestUpcoming(parseExamProfiles("旧:2026-01-01\n新:2026-12-31", now))?.name).toBe("新");
    expect(nearestUpcoming(parseExamProfiles("旧:2026-01-01", now))).toBeNull();
    expect(nearestUpcoming([])).toBeNull();
  });
});

describe("44-02/63-02 校准受助分栏（四十批）", () => {
  it("rows.assisted 统计受助作答（不挤占 attempts 口径）", () => {
    let n = 0;
    const ev = (over: Partial<AttemptEvent>): AttemptEvent =>
      ({
        v: 1, eid: "e" + n++, ts: 1, qid: "q", kind: "practice", mode: "single",
        verdict: "correct", myAnswer: null, sessionId: "s", queue: "normal", device: "d", seq: n,
        ...over,
      }) as AttemptEvent;
    const r = calibration([
      ev({ confidence: "sure", verdict: "correct" }),
      ev({ confidence: "sure", verdict: "correct", help: "explain" }),
      ev({ confidence: "fuzzy", verdict: "wrong" }),
    ]);
    expect(r.rows.find((x) => x.confidence === "sure")!.assisted).toBe(1);
    expect(r.rows.find((x) => x.confidence === "fuzzy")!.assisted).toBe(0);
  });
});
