import { describe, it, expect } from "vitest";
import { buildExplainMessages, continueExplainMessages } from "../src/ai/explain";
import { findHintLeaks } from "../src/ai/hint";
import { helpAllowed, helpKindOf, type ExplainTemplateId } from "../src/ai/task";
import type { Question } from "../src/core/types";

function q(partial: Partial<Question>): Question {
  return {
    id: "q-tpl01aa",
    type: "single",
    stem: "下列哪项是内核职责？",
    options: ["渲染界面", "托管后端", "同步云端", "绘制主题"],
    answer: "B",
    analysis: "内核=Go 后端进程。",
    score: 1,
    origin: "manual",
    hash: "h",
    ...partial,
  };
}

describe("114-04 T07 提交后依据讲解分层", () => {
  it("system 三段结构与红线（争议不背书/无掌握性断言/解析与补充分标）", () => {
    const sys = buildExplainMessages(q({}), "A", "explain")[0].content;
    expect(sys).toContain("【答案核验】");
    expect(sys).toContain("【关键步骤】");
    expect(sys).toContain("【下次检查点】");
    expect(sys).toContain("争议答案不背书");
    expect(sys).toContain("不使用掌握性断言");
    expect(sys).toContain("『解析』『补充』");
  });

  it("解析缺失：user 事实行显式「缺证据」，system 要求如实标注不编造", () => {
    const msgs = buildExplainMessages(q({ analysis: undefined }), "A", "explain");
    expect(msgs[1].content).toContain("参考解析：（缺证据——如实标注，不编造）");
    expect(msgs[0].content).toContain("「解析缺证据」");
  });
});

describe("114-03 T06 苏格拉底单问题", () => {
  it("一次只问一个 + 不复述已问范围 + 卡住给选择 + 不陈述答案", () => {
    const sys = buildExplainMessages(q({}), "A", "socratic")[0].content;
    expect(sys).toContain("一次只向我提出一个问题");
    expect(sys).toContain("绝不一次给多个");
    expect(sys).toContain("不要重复或换皮重问");
    expect(sys).toContain("换个角度");
    expect(sys).toContain("不陈述正确答案");
  });

  it("多轮史保持：追加用户消息后历史完整（已问范围随史可见）", () => {
    const base = buildExplainMessages(q({}), "A", "socratic");
    const cont = continueExplainMessages(base, "我选 A 是因为界面也算后端？");
    expect(cont).toHaveLength(3);
    expect(cont[2].content).toContain("界面也算后端");
  });
});

describe("114-02 严格模考跨入口 AI 禁用（枚举锁）", () => {
  it("全部模板（含未来新增）在 strictMock 下一律拒绝，无论提交状态", () => {
    const ids: ExplainTemplateId[] = [
      "practice.hint",
      "practice.socratic",
      "practice.explain",
      "practice.misdiagnosis",
      "report.explain",
    ];
    for (const id of ids) {
      expect(helpAllowed({ mode: "strictMock", submitted: false }, helpKindOf(id)).allowed, id).toBe(false);
      expect(helpAllowed({ mode: "strictMock", submitted: true }, helpKindOf(id)).allowed, id).toBe(false);
    }
    // 非 strictMock 的提交后解读可用（对照，防锁死）
    expect(helpAllowed({ mode: "practice", submitted: true }, helpKindOf("practice.explain")).allowed).toBe(true);
  });
});

describe("119-02 泄露守卫扩样（提示路径）", () => {
  it("全角字母/宽空格变体不漏检", () => {
    const question = q({});
    expect(findHintLeaks("答案是Ｂ哦。", question).map((l) => l.kind)).toContain("answer-letter");
    expect(findHintLeaks("正确答案是:  B", question).map((l) => l.kind)).toContain("answer-letter");
    expect(findHintLeaks("排除Ａ、Ｂ、Ｃ后就清楚了。", question).map((l) => l.kind)).toContain("eliminate-unique");
  });

  it("正常引导句不误报（含『选择题』『排除法』等词）", () => {
    const question = q({});
    expect(findHintLeaks("这是一道选择题，先看四个选项的学科归属。", question)).toEqual([]);
    expect(findHintLeaks("用排除法把明显不合题意的先划掉，再比较剩下的。", question)).toEqual([]);
  });
});
