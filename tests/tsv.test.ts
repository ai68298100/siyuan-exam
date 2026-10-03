import { describe, it, expect } from "vitest";
import { parseTsv } from "../src/importer/tsv";
import { parseText } from "../src/importer/pipeline";

describe("TSV / Anki 导出解析（TODO 2.3 / 42-04，廿五批）", () => {
  it("表头模式：识别表头行走 Excel 列映射，校验/去重同一漏斗", () => {
    const text = [
      "#separator:tab",
      "题型\t题干\t选项A\t选项B\t答案",
      "单选\t1+1=?\t2\t3\tA",
      "单选\t天空颜色\t红\t蓝\tB",
    ].join("\n");
    const r = parseTsv(text);
    expect(r.errors).toHaveLength(0);
    expect(r.ok).toHaveLength(2);
    expect(r.ok[0]).toMatchObject({ type: "single", stem: "1+1=?", answer: "A" });
    expect(r.ok[0].options).toEqual(["2", "3"]);
  });

  it("Anki 两列问答：front/back → 填空题；#html:true 剥标签", () => {
    const text = [
      "#separator:tab",
      "#html:true",
      "期<br>望保留率参数是？\t<b>保留</b>",
      " FSRS 默认保留率\t0.9 ",
    ].join("\n");
    const r = parseTsv(text);
    expect(r.errors).toHaveLength(0);
    expect(r.ok).toHaveLength(2);
    expect(r.ok[0]).toMatchObject({ type: "fill", answer: "保留" });
    expect(r.ok[0].stem).toBe("期\n望保留率参数是？");
  });

  it("非表头非两列：报错并给可行动提示，不猜测列序", () => {
    const text = "单选\t题干只有这行\tA";
    const r = parseTsv(text);
    expect(r.ok).toHaveLength(0);
    expect(r.errors[0].reason).toContain("TSV 格式未识别");
  });

  it("表头缺必要列：报错列名", () => {
    const text = "#separator:tab\n题干\t解析\n甲\t乙";
    const r = parseTsv(text);
    expect(r.ok).toHaveLength(0);
    expect(r.errors[0].reason).toContain("缺少必要列");
  });

  it("空内容（仅 # 注释）：空报告 + 明确错误", () => {
    const r = parseTsv("#separator:tab\n#html:false\n");
    expect(r.ok).toHaveLength(0);
    expect(r.errors[0].reason).toContain("内容为空");
  });

  it("逗号分隔的 Anki 导出（#separator:comma）可解析", () => {
    const text = [
      "#separator:Comma",
      "front,back",
      "什么是 FSRS,一种调度算法",
    ].join("\n");
    const r = parseTsv(text);
    expect(r.errors).toHaveLength(0);
    expect(r.ok[0]).toMatchObject({ type: "fill", stem: "什么是 FSRS", answer: "一种调度算法" });
  });
});

describe("parseText 内容分流（廿五批）", () => {
  it("GIFT 特征（::题:: 或 {=…}）分流到 GIFT 解析器", async () => {
    const gift = "::考点:: 1+1=？{=2/~3}";
    const r = await parseText(gift);
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0].answer).toBe("A");
  });

  it("Anki 头或制表符特征分流到 TSV；Aiken 默认路径不受影响", async () => {
    const tsv = await parseText("#separator:tab\nfront\tback\n甲\t乙");
    expect(tsv.ok[0].type).toBe("fill");
    expect(tsv.ok[0].stem).toBe("甲");
    const aiken = await parseText("2+2=?\nA. 3\nB. 4\nANSWER: B");
    expect(aiken.ok).toHaveLength(1);
    expect(aiken.ok[0].answer).toBe("B");
  });
});
