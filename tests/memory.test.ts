import { describe, it, expect } from "vitest";
import {
  selfRatingToRiffRating,
  binaryToRiffRating,
  pickSameKp,
  cramQueue,
  dailySet,
  deckNameForBank,
  questionToFlashCardMarkdown,
} from "../src/core/memory";
import { makeQuestion } from "../src/core/blockTemplate";

const qs = [
  makeQuestion({ type: "single", stem: "S1", options: ["1", "2"], answer: "A", kp: "资料/增长率" }),
  makeQuestion({ type: "single", stem: "S2", options: ["1", "2"], answer: "B", kp: "资料/比重" }),
  makeQuestion({ type: "single", stem: "S3", options: ["1", "2"], answer: "A", kp: "言语/逻辑" }),
  makeQuestion({ type: "judge", stem: "J1", answer: "对", kp: "资料/增长率" }),
];

describe("39-01 评级映射（对齐上游 riff.Rating 契约：Again=1/Hard=2/Good=3/Easy=4）", () => {
  it("四级自评 → 1/2/3/4（与 github.com/siyuan-note/riff 的 iota+1 常量同值，非 0-3 偏移）", () => {
    expect(selfRatingToRiffRating(1)).toBe(1); // Again
    expect(selfRatingToRiffRating(2)).toBe(2); // Hard
    expect(selfRatingToRiffRating(3)).toBe(3); // Good
    expect(selfRatingToRiffRating(4)).toBe(4); // Easy
  });
  it("非法自评值不映射（返回 null，由调用方跳过发送；不再静默回退成 0）", () => {
    expect(selfRatingToRiffRating(0)).toBeNull();
    expect(selfRatingToRiffRating(5)).toBeNull();
    expect(selfRatingToRiffRating(99)).toBeNull();
    expect(selfRatingToRiffRating(NaN)).toBeNull();
    expect(selfRatingToRiffRating(-1)).toBeNull();
  });
  it("映射结果恒落在 riff 合法域 1-4（0 不是合法评级）", () => {
    for (const r of [1, 2, 3, 4]) {
      const v = selfRatingToRiffRating(r);
      expect(v).not.toBeNull();
      expect(v!).toBeGreaterThanOrEqual(1);
      expect(v!).toBeLessThanOrEqual(4);
    }
  });
  it("二元自评：记住=Good(3)、忘了=Again(1)", () => {
    expect(binaryToRiffRating(true)).toBe(3);
    expect(binaryToRiffRating(false)).toBe(1);
  });
  it("卡包命名空间", () => {
    expect(deckNameForBank("公考题库")).toBe("小驴考试/公考题库");
  });
});

describe("举一反三", () => {
  it("完整考点优先，其次同章节，排除种子题", () => {
    const picked = pickSameKp(qs, qs[0], 2);
    expect(picked[0].kp).toBe("资料/增长率"); // 完整考点：J1
    expect(picked[1].kp?.split("/")[0]).toBe("资料"); // 退到同章节：资料/比重
    expect(picked.every((q) => q.id !== qs[0].id)).toBe(true);
  });
  it("完整考点被排除后回退同章节", () => {
    const picked = pickSameKp(qs, qs[0], 1, new Set([qs[3].id]));
    expect(picked[0].kp).toBe("资料/比重");
  });
});

describe("cram 队列", () => {
  it("错 ≥2 才入队，按错次降序，limit 生效", () => {
    const counts = new Map([
      [qs[0].id, 5],
      [qs[1].id, 2],
      [qs[2].id, 1],
    ]);
    const q = cramQueue(qs, counts, 2, 50);
    expect(q.map((x) => x.id)).toEqual([qs[0].id, qs[1].id]);
    expect(cramQueue(qs, counts, 2, 1)).toHaveLength(1);
  });
});

describe("每日一练", () => {
  it("到期优先 → 错次次序 → 随机补足，去重且不超 n", () => {
    const counts = new Map([[qs[2].id, 3]]);
    const due = [qs[3]];
    const set = dailySet(qs, due, counts, 3);
    expect(set).toHaveLength(3);
    expect(set[0].id).toBe(qs[3].id);
    expect(set[1].id).toBe(qs[2].id);
    expect(new Set(set.map((q) => q.id)).size).toBe(3);
  });
});

describe("题型转闪卡 Markdown 引擎 (questionToFlashCardMarkdown)", () => {
  it("单选题生成父项题干选项、子项正确答案与解析考点", () => {
    const q = makeQuestion({
      type: "single",
      stem: "下列哪种天体围绕太阳运行？",
      options: ["月球", "地球", "国际空间站"],
      answer: "B",
      analysis: "地球是太阳系行星，月球是地球的卫星。",
      kp: "天文/天体运动",
      source: "高中地理第一册",
    });
    const md = questionToFlashCardMarkdown(q);
    expect(md).toContain("- **【单选题】** 下列哪种天体围绕太阳运行？");
    expect(md).toContain("A. 月球");
    expect(md).toContain("B. 地球");
    expect(md).toContain("C. 国际空间站");
    expect(md).toContain("- **✔ 正确答案**：**B** (地球)");
    expect(md).toContain("💡 **核心解析**：地球是太阳系行星");
    expect(md).toContain("🏷️ **考点归纳**：天文/天体运动");
    expect(md).toContain("custom-exam-card-qid=");
  });

  it("多选题生成多选项明细与多选提示", () => {
    const q = makeQuestion({
      type: "multiple",
      stem: "下列属于可再生能源的有？",
      options: ["太阳能", "天然气", "风能", "煤炭"],
      answer: "AC",
      analysis: "风能和太阳能自然补给，天然气和煤炭是化石能源。",
      kp: "地理/能源分类",
    });
    const md = questionToFlashCardMarkdown(q);
    expect(md).toContain("- **【多选题】** 下列属于可再生能源的有？ *（多选/少选均不得分）*");
    expect(md).toContain("- **✔ 正确答案**：**A, C**");
    expect(md).toContain("A. 太阳能");
    expect(md).toContain("C. 风能");
  });

  it("判断题生成正确与错误判断", () => {
    const q1 = makeQuestion({ type: "judge", stem: "光年是时间单位。", answer: "错", analysis: "光年是长度单位。" });
    const md1 = questionToFlashCardMarkdown(q1);
    expect(md1).toContain("- **【判断题】** 光年是时间单位。");
    expect(md1).toContain("- **✔ 正确判断**：**错误 ✕**");
    expect(md1).toContain("💡 **核心解析**：光年是长度单位。");

    const q2 = makeQuestion({ type: "judge", stem: "真空中光速约为 30 万千米每秒。", answer: "对" });
    const md2 = questionToFlashCardMarkdown(q2);
    expect(md2).toContain("- **✔ 正确判断**：**正确 ✔**");
  });

  it("填空题（普通、多空、数值计算）分别呈现正确格式", () => {
    // 1. 普通填空（文本类型答案）
    const qNormal = makeQuestion({ type: "fill", stem: "在标准大气压下水沸腾时会转化为 ____。", answer: "水蒸气" });
    const mdNormal = questionToFlashCardMarkdown(qNormal);
    expect(mdNormal).toContain("- **【填空题】** 在标准大气压下水沸腾时会转化为 ____。");
    expect(mdNormal).toContain("- **✔ 参考答案**：**水蒸气**");

    // 2. 数值题
    const qNum = makeQuestion({
      type: "fill",
      stem: "计算该物体的运动速度 ____。",
      answer: "25.4",
      answerSpec: { v: 1, kind: "numeric", unit: "m/s", absTol: 0.2 },
    });
    const mdNum = questionToFlashCardMarkdown(qNum);
    expect(mdNum).toContain("- **【数值计算题】** 计算该物体的运动速度 ____。 *(作答单位：m/s)*");
    expect(mdNum).toContain("- **✔ 正确数值**：**25.4** m/s *(允许误差 ±0.2)*");

    // 3. 多空题
    const qMulti = makeQuestion({
      type: "fill",
      stem: "中华人民共和国成立于 ____ 年，首都位于 ____。",
      answer: "1949;;北京",
    });
    const mdMulti = questionToFlashCardMarkdown(qMulti);
    expect(mdMulti).toContain("- **【多空填空题】**");
    expect(mdMulti).toContain("空 1：**1949**");
    expect(mdMulti).toContain("空 2：**北京**");
  });

  it("简答题问答题生成清晰得分要点", () => {
    const q = makeQuestion({
      type: "short",
      stem: "简述有效复习的三个步骤。",
      answer: "主动回忆、间隔复测、归因纠错。",
      analysis: "围绕三个核心步骤展开即可得分。",
    });
    const md = questionToFlashCardMarkdown(q);
    expect(md).toContain("- **【问答/解答题】** 简述有效复习的三个步骤。");
    expect(md).toContain("- **✔ 参考得分要点**：");
    expect(md).toContain("主动回忆、间隔复测、归因纠错。");
  });
});
