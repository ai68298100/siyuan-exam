import { describe, it, expect } from "vitest";
import { scoreToMarkdown } from "../src/core/exportScore";
import { MockSession, type Blueprint } from "../src/core/mock";

const bp: Blueprint = {
  id: "bp", name: "行测模拟", durationS: 3600, passLine: 60,
  shuffleOptions: false, sectionTimed: false,
  sections: [{ name: "言语", count: 2, scoreEach: 1, source: "mixed", types: ["single"] }],
};

describe("成绩单导出 Markdown", () => {
  it("含总分/判定/分模块表/行为数据", () => {
    const qs = [
      makeQ("A"), makeQ("A"),
    ];
    const r = { paper: qs, sectionOf: new Map([[qs[0].id, "言语"], [qs[1].id, "言语"]]), scoreOf: new Map([[qs[0].id, 1], [qs[1].id, 1]]), shortages: [] };
    const s = new MockSession(bp, qs, r, 1_700_000_000_000);
    s.setAnswer(qs[0].id, "A", 1_700_001_000);
    s.toggleFlag(qs[0].id);
    s.submit(1_700_003_600_000);
    const score = s.score();
    const md = scoreToMarkdown(bp, score, 1_700_000_000_000);
    expect(md).toContain("# 模考成绩单 · 行测模拟");
    expect(md).toContain("❌ 未通过");
    expect(md).toContain("| 言语 | 1 | 2 | 1/2 |");
    expect(md).toContain("标旗 1");
    expect(md).toContain("最后 20 分钟");
  });
});

import { makeQuestion } from "../src/core/blockTemplate";
function makeQ(answer: string) {
  return makeQuestion({ type: "single", stem: "x", options: ["A文本", "B文本"], answer });
}
