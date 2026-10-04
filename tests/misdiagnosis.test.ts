import { describe, it, expect } from "vitest";
import { evidenceFacts, buildMisdiagnosisMessages } from "../src/ai/misdiagnosis";
import { helpAllowed } from "../src/ai/task";
import type { Question } from "../src/core/types";

const q: Question = {
  id: "q-t08aaaa",
  type: "single",
  stem: "下列哪项是内核职责？",
  options: ["渲染界面", "托管后端", "同步云端"],
  answer: "B",
  analysis: "内核=Go 后端进程。",
  score: 1,
  origin: "manual",
  hash: "h",
};

describe("116-01 T08 证据整形", () => {
  it("证据齐备：逐项成事实行；置信/用时/受助/自述如实呈现", () => {
    const facts = evidenceFacts(q, {
      myAnswer: "A",
      confidence: "sure",
      timeMs: 42_000,
      helped: true,
      userThought: "我以为是前端",
    });
    const joined = facts.join("\n");
    expect(joined).toContain("正确答案：B");
    expect(joined).toContain("我的作答：A");
    expect(joined).toContain("答前信心：确定");
    expect(joined).toContain("用时：42 秒");
    expect(joined).toContain("受助作答：是");
    expect(joined).toContain("用户自述思路：我以为是前端");
  });

  it("证据缺失显式列「缺证据」，不编造（含无解析题）", () => {
    const noAnalysis = { ...q, analysis: undefined };
    const facts = evidenceFacts(noAnalysis, { myAnswer: null });
    const joined = facts.join("\n");
    expect(joined).toContain("答前信心：缺证据");
    expect(joined).toContain("用时：缺证据");
    expect(joined).toContain("用户自述思路：缺证据");
    expect(joined).toContain("（无参考解析——列缺证据，不编造）");
    expect(joined).toContain("我的作答：（未作答）");
  });

  it("system 携带验收红线：不断言粗心/不会、不做心理诊断、假设需用户确认、受助非独立证据", () => {
    const sys = buildMisdiagnosisMessages(q, { myAnswer: "A" })[0].content;
    expect(sys).toContain("仅答案不一致不能断言");
    expect(sys).toContain("心理/人格诊断");
    expect(sys).toContain("采纳由用户决定");
    expect(sys).toContain("受助作答不得当独立能力证据");
    expect(sys).toContain("【事实】");
    expect(sys).toContain("【验证行动】");
    expect(sys).toContain("一个向用户澄清的问题");
  });

  it("user 只含证据事实，不含结论指令", () => {
    const user = buildMisdiagnosisMessages(q, { myAnswer: "A", confidence: "guess" })[1].content;
    expect(user).toContain("答前信心：蒙");
    expect(user).not.toContain("【错因假设】");
  });

  it("闸门对齐：misdiagnosis 未提交拒绝（与 explain 同走揭示闸门）", () => {
    expect(helpAllowed({ mode: "practice", submitted: false }, "reveal").allowed).toBe(false);
    expect(helpAllowed({ mode: "practice", submitted: true }, "reveal").allowed).toBe(true);
    expect(helpAllowed({ mode: "strictMock", submitted: true }, "reveal").allowed).toBe(false);
  });
});
