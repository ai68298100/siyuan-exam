import { describe, expect, it } from "vitest";
import { combineBlockSources } from "../src/core/blockSource";

describe("块材料合并", () => {
  it("保留 Markdown 内容并去掉思源块包装和属性", () => {
    const result = combineBlockSources([
      '{{{row\n标题\n- A. 选项\n}}}\n{: custom-exam-answer="A" custom-exam-analysis="内部解析"}',
    ]);
    expect(result).toMatchObject({ text: "标题\n- A. 选项", blocks: 1, truncated: false });
  });

  it("合并多块并在超限时返回明确的截断标记", () => {
    const result = combineBlockSources(["第一块", "第二块"], 6);
    expect(result.text).toBe("第一块\n\n第");
    expect(result.blocks).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it("空块不生成材料", () => {
    expect(combineBlockSources(["", '{: custom-id="x"}'])).toEqual({ text: "", blocks: 0, truncated: false });
  });
});
