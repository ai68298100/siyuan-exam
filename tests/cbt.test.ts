import { describe, it, expect } from "vitest";
import { gradeIndefinite, guardLockout, validateMaterialGroup, newGroupId } from "../src/core/cbt";
import { makeQuestion } from "../src/core/blockTemplate";

const indefinite = makeQuestion({
  type: "multiple", stem: "可能诊断？", options: ["甲", "乙", "丙", "丁"], answer: "ABD",
});

describe("不定项判分（卫生资格倒扣范式）", () => {
  it("全对=满分因子 1", () => {
    expect(gradeIndefinite(indefinite, "DBA")).toMatchObject({ verdict: "correct", factor: 1 });
  });
  it("少选无错选=按比例部分分，但判 wrong（进错题本）", () => {
    const g = gradeIndefinite(indefinite, "AB");
    expect(g.verdict).toBe("wrong");
    expect(g.factor).toBeCloseTo(2 / 3);
  });
  it("含错选=全扣", () => {
    expect(gradeIndefinite(indefinite, "ABC").factor).toBe(0);
    expect(gradeIndefinite(indefinite, "ABC").verdict).toBe("wrong");
  });
  it("空=not_attempted", () => {
    expect(gradeIndefinite(indefinite, "").verdict).toBe("not_attempted");
    expect(gradeIndefinite(indefinite, null).factor).toBe(0);
  });
});

describe("作答流锁", () => {
  const flags = [true, true, false, false, false];
  it("锁定态强制停留于已答边界+1（不可回跳/不可跳过未答）", () => {
    expect(guardLockout(0, flags, 2)).toBe(2);
    expect(guardLockout(1, flags, 2)).toBe(2);
    expect(guardLockout(3, flags, 2)).toBe(2);
    expect(guardLockout(4, flags, 2)).toBe(2);
  });
  it("无已答题时可自由前进", () => {
    expect(guardLockout(4, [false, false, false, false, false], 0)).toBe(4);
  });
});

describe("共用题干", () => {
  it("校验：材料非空、子题 ≥2", () => {
    const subs = [makeQuestion({ type: "single", stem: "子1", options: ["1", "2"], answer: "A" })];
    expect(validateMaterialGroup("材料……", subs)).toContain("至少需要 2 道");
    expect(validateMaterialGroup("", subs)).toContain("材料题干为空");
    const ok = [...subs, makeQuestion({ type: "judge", stem: "子2", answer: "对" })];
    expect(validateMaterialGroup("材料……", ok)).toBeNull();
  });
  it("组 ID 唯一", () => {
    expect(newGroupId()).not.toBe(newGroupId());
    expect(newGroupId()).toMatch(/^g-[0-9a-f]{6}$/);
  });
});
