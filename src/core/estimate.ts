// ============================================================
// 估分工具（v0.5）：考后"我的答案串 vs 标准答案串"对答案估分
// 约定：两串等长、每字符一题（A-J/对错映射略——按字符直接比对）；
// 我的答案串中用 "." 或 "？" 表示未作答（不计正误但计入空题）
// ============================================================
import { foldText } from "./answer";

/** 估分按题序对照：全半角折叠、去空白、统一大写后再比较。 */
export function normalizeEstimateInput(value: string): string {
  return foldText(value).replace(/\s/g, "").toUpperCase();
}

export interface EstimateResult {
  total: number;
  answered: number;
  correct: number;
  wrong: number;
  blank: number;
  score: number; // scoreEach × correct
  full: number; // scoreEach × total
  percent: number; // 0-100
  pass: boolean;
  /** 每题对错序列（"✓"/"✕"/"–"），供逐题渲染 */
  marks: ("✓" | "✕" | "–")[];
}

export function estimateScore(
  myAnswers: string,
  key: string,
  opts: { scoreEach?: number; passLine?: number } = {},
): EstimateResult | null {
  const scoreEach = opts.scoreEach ?? 1;
  const passLine = opts.passLine ?? 60;
  const mine = normalizeEstimateInput(myAnswers).split("");
  const std = normalizeEstimateInput(key).split("");
  if (!mine.length || !std.length || mine.length !== std.length) return null;
  const total = mine.length;
  let correct = 0,
    wrong = 0,
    blank = 0;
  const marks: EstimateResult["marks"] = [];
  for (let i = 0; i < total; i++) {
    const m = mine[i],
      k = std[i];
    if (m === "." || m === "?" || m === "？") {
      blank++;
      marks.push("–");
      continue;
    }
    if (m === k) {
      correct++;
      marks.push("✓");
    } else {
      wrong++;
      marks.push("✕");
    }
  }
  const score = Math.round(correct * scoreEach * 10) / 10;
  const full = Math.round(total * scoreEach * 10) / 10;
  const percent = total ? Math.round((correct / total) * 1000) / 10 : 0;
  return {
    total,
    answered: correct + wrong,
    correct,
    wrong,
    blank,
    score,
    full,
    percent,
    pass: percent >= passLine,
    marks,
  };
}
