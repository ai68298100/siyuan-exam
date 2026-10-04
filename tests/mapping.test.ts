import { describe, it, expect } from "vitest";
import {
  columnLabel,
  autoAssignment,
  assignmentFromMap,
  assignmentToMap,
  assignmentErrors,
  emptyAssignment,
} from "../src/importer/mapping";
import { autoMapExcel, parseExcelRows } from "../src/importer/pipeline";

const OFFICIAL = ["题号", "题型", "题干", "选项A", "选项B", "答案", "解析", "知识点"];
// 自制乱表：表头完全非规范（自动映射失败场景），列序也乱
const MESSY = ["Q", "Correct", "Kind", "Wrong1", "Wrong2"];

describe("38-02 列标与自动指派", () => {
  it("columnLabel：Excel 式 A..Z、AA", () => {
    expect(columnLabel(0)).toBe("A");
    expect(columnLabel(25)).toBe("Z");
    expect(columnLabel(26)).toBe("AA");
    expect(columnLabel(27)).toBe("AB");
  });

  it("autoAssignment：官方表头 → 正确指派；陌生表头 → 必填=-1", () => {
    const a = autoAssignment(OFFICIAL);
    expect(a.type).toBe(1);
    expect(a.stem).toBe(2);
    expect(a.answer).toBe(5);
    expect(a.options).toEqual([3, 4, -1, -1, -1, -1]);
    expect(a.kp).toBe(7);
    const b = autoAssignment(MESSY);
    expect([b.type, b.stem, b.answer]).toEqual([-1, -1, -1]);
  });

  it("assignmentFromMap/ToMap 往返一致", () => {
    const { map } = autoMapExcel(OFFICIAL);
    const a = assignmentFromMap(map);
    const back = assignmentToMap(a);
    expect(back.type).toBe(map.type);
    expect(back.stem).toBe(map.stem);
    expect(back.answer).toBe(map.answer);
    expect(back.options).toEqual(map.options);
    expect(back.kp).toBe(map.kp);
    expect(back.analysis).toBe(6); // OFFICIAL 的解析列
    expect(assignmentFromMap(back)).toEqual(a);
  });

  it("assignmentToMap：-1 收敛为 undefined、选项剔除 -1", () => {
    const a = emptyAssignment();
    a.type = 1; a.stem = 0; a.answer = 2; a.analysis = -1; a.source = 3;
    a.options = [4, -1, -1, -1, -1, 5];
    const m = assignmentToMap(a);
    expect(m.analysis).toBeUndefined();
    expect(m.source).toBe(3);
    expect(m.options).toEqual([4, 5]);
  });

  it("emptyAssignment 深拷贝：改一处不影响后续调用", () => {
    const a = emptyAssignment();
    a.options[0] = 9;
    expect(emptyAssignment().options[0]).toBe(-1);
  });
});

describe("38-02 指派校验", () => {
  it("缺必填字段逐一报错", () => {
    const errs = assignmentErrors(emptyAssignment(), 5);
    expect(errs).toHaveLength(3);
    expect(errs.join("；")).toContain("题型");
    expect(errs.join("；")).toContain("题干");
    expect(errs.join("；")).toContain("答案");
  });

  it("越界与重复指派报错；合法指派零错误", () => {
    const a = emptyAssignment();
    a.type = 1; a.stem = 0; a.answer = 9; // 9 超出 5 列表宽
    expect(assignmentErrors(a, 5).some((e) => e.includes("超出表宽"))).toBe(true);
    const b = emptyAssignment();
    b.type = 2; b.stem = 0; b.answer = 1; b.analysis = 2; // 列 C 重复
    expect(assignmentErrors(b, 6).some((e) => e.includes("C") && e.includes("题型") && e.includes("解析"))).toBe(true);
    const c = autoAssignment(OFFICIAL);
    expect(assignmentErrors(c, OFFICIAL.length)).toEqual([]);
  });
});

describe("38-02 乱表端到端：自动失败 → 手动指派 → 解析成功", () => {
  it("非规范表头按手动指派解析出题目", () => {
    expect(autoMapExcel(MESSY).missing).toContain("题型"); // 自动映射确实失败
    const rows = [
      MESSY,
      ["水的化学式是什么？", "A", "单选", "H2O", "CO2"],
      ["思源是本地优先的笔记软件？", "对", "判断", "", ""],
    ];
    const a = emptyAssignment();
    a.stem = 0; a.answer = 1; a.type = 2; a.options = [-1, -1, 3, 4, -1, -1];
    expect(assignmentErrors(a, MESSY.length)).toEqual([]);
    const report = parseExcelRows(rows.slice(1), assignmentToMap(a));
    expect(report.errors).toEqual([]);
    expect(report.ok).toHaveLength(2);
    expect(report.ok[0].type).toBe("single");
    expect(report.ok[0].options).toEqual(["H2O", "CO2"]);
    expect(report.ok[1].type).toBe("judge");
    expect(report.ok[1].options).toEqual([]);
  });
});
