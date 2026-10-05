// ============================================================
// 结构化答案 schema（TODO 54-01）+ 数值题判分（TODO 54-02）：
// Question.answerSpec（可选，v1 信封）承载结构化作答规则；无 spec 的旧字符串
// 答案完全按原口径判分（54-01 验收：旧答案可读，schema 扩展不等于全题型开发）。
// 数值判分：绝对/相对容差、等价单位换算、小数分隔宽容——不以浮点直接相等判定。
// 纯函数无 IO；规则随题目修订冻结（spec 属于题面，questionFingerprint 需含之——
// 当前指纹为 stem+options，spec 变化按改题处理的接线在 55-07 扩展，本批如实标注）。
// ============================================================
import type { Question } from "./types";

export const ANSWER_SPEC_VERSION = 1;

/** v1 spec：数值题（54-02）与多空题（54-03）。unit=答案主单位；altUnits=等价单位换算（值×factor→主单位）；
 *  absTol/relTolerance 二选一或并用（并用时取更宽者）。 */
export interface NumericAnswerSpec {
  v: 1;
  kind: "numeric";
  unit?: string;
  absTol?: number;
  relTolerance?: number;
  altUnits?: { unit: string; factor: number }[];
}

/** 多空题（54-03）：逐空独立身份=数组下标；answers=候选（首项主答案）；大小写策略逐空可配。
 *  作答分段符 ";;"（按位置对应空位）；顺序政策（可交换空位）待 v2，本版按位置对应。 */
export interface MultiBlankSpec {
  v: 1;
  kind: "multiBlank";
  blanks: { answers: string[]; caseSensitive?: boolean }[];
}

export type AnswerSpec = NumericAnswerSpec | MultiBlankSpec;

/** 从题目取 spec（未带/版本不符/未知 kind → null = 按旧字符串口径） */
export function specOf(
  q: Question,
): NumericAnswerSpec | MultiBlankSpec | null {
  const spec = (q as { answerSpec?: { v?: number; kind?: string } }).answerSpec;
  if (!spec || spec.v !== ANSWER_SPEC_VERSION) return null;
  if (spec.kind !== "numeric" && spec.kind !== "multiBlank") return null;
  return spec as unknown as NumericAnswerSpec | MultiBlankSpec;
}

/** 宽容数值解析：全角小数点/句号、千分位逗号、负号变体、科学计数法（1e-3 / ×10^）；失败 null */
export function parseNumeric(raw: string): number | null {
  const s = String(raw ?? "")
    .trim()
    .replace(/．/g, ".")
    .replace(/－/g, "-")
    .replace(/[，\s]/g, "")
    .replace(/,/g, "")
    .replace(/[×xX]\s*10\s*\^?/i, "e");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface NumericVerdict {
  correct: boolean;
  /** 判分解释（54-02 验收：得分可解释——命中了哪条规则） */
  reason: "exact" | "abs-tolerance" | "relative-tolerance" | "unit-converted" | "no-spec" | "unparseable";
  /** 参与比较的数值（换算到主单位后；无法解析为空） */
  value: number | null;
}

/** 数值判分：given=用户作答文本；expected=题库答案数值文本。
 *  规则：1) 两者解析失败 → wrong/unparseable（不做字符串巧合相等的伪装）；
 *  2) 单位换算：given 按后缀单位匹配 altUnits 换算到主单位（无后缀视为主单位）；
 *  3) 命中顺序 exact → absTol → relTolerance（取更宽者已由并用语义保证）。 */
export function gradeNumeric(
  spec: NumericAnswerSpec,
  expectedRaw: string,
  givenRaw: string,
): NumericVerdict {
  const expected = parseNumeric(expectedRaw);
  // given 可能带单位后缀（如 "1.5 km"）：剥末尾单位词再解析数值
  let givenText = String(givenRaw ?? "").trim();
  let givenUnit = spec.unit ?? "";
  if (spec.altUnits?.length) {
    for (const au of spec.altUnits) {
      if (givenText.toLowerCase().endsWith(au.unit.toLowerCase())) {
        givenUnit = au.unit;
        givenText = givenText.slice(0, givenText.length - au.unit.length).trim();
        break;
      }
    }
  } else if (spec.unit && givenText.toLowerCase().endsWith(spec.unit.toLowerCase())) {
    givenText = givenText.slice(0, givenText.length - spec.unit.length).trim();
  }
  const given = parseNumeric(givenText);
  if (given == null || expected == null) {
    return { correct: false, reason: "unparseable", value: given };
  }
  // 单位换算（乘在数值上：alt 值 × factor = 主单位值）
  const alt = spec.altUnits?.find((au) => au.unit.toLowerCase() === givenUnit.toLowerCase());
  const converted = alt ? given * alt.factor : given;
  // 浮点 epsilon：容差比较不以浮点直接相等判定（54-02 边界）
  const EPS = 1e-9;
  const detail = (reason: NumericVerdict["reason"]): NumericVerdict => ({ correct: true, reason, value: converted });

  if (Math.abs(converted - expected) <= EPS) return detail(alt ? "unit-converted" : "exact");
  const diff = Math.abs(converted - expected);
  if (spec.absTol != null && diff <= spec.absTol + EPS) return detail(alt ? "unit-converted" : "abs-tolerance");
  if (spec.relTolerance != null && expected !== 0 && diff <= Math.abs(expected) * (spec.relTolerance / 100) + EPS) {
    return detail(alt ? "unit-converted" : "relative-tolerance");
  }
  return { correct: false, reason: "no-spec", value: converted };
}

/** grade() 接线：带 spec 的题走结构化判分（在 answer.grade 开头调用） */
export function gradeWithSpec(
  q: Question,
  myAnswer: string,
): { verdict: "correct" | "wrong"; reason: string } | null {
  const spec = specOf(q);
  if (!spec) return null;
  if (spec.kind === "numeric") {
    const v = gradeNumeric(spec, q.answer, myAnswer);
    return { verdict: v.correct ? "correct" : "wrong", reason: v.reason };
  }
  const mb = gradeMultiBlank(spec, myAnswer);
  return { verdict: mb.allCorrect ? "correct" : "wrong", reason: `multi-blank ${mb.correctCount}/${mb.blanks.length}` };
}

// ---------- 多空题（54-03） ----------

export const MULTI_BLANK_SEP = ";;";

export interface BlankResult {
  index: number;
  given: string;
  correct: boolean;
  /** 空白/缺答（未提供该空作答） */
  empty: boolean;
}

export interface MultiBlankVerdict {
  blanks: BlankResult[];
  correctCount: number;
  filledCount: number;
  allCorrect: boolean;
}

/** 逐空判分：作答按 ";;" 分段、按位置对应空位；缺段=空白（incorrect+empty，部分作答可逐空解释） */
export function gradeMultiBlank(spec: MultiBlankSpec, given: string): MultiBlankVerdict {
  const parts = given.split(MULTI_BLANK_SEP).map((s) => s.trim());
  const blanks: BlankResult[] = spec.blanks.map((b, i) => {
    const g = parts[i] ?? "";
    const empty = g === "";
    const correct = !empty && b.answers.some((a) => (b.caseSensitive ? a === g : a.toLowerCase() === g.toLowerCase()));
    return { index: i, given: g, correct, empty };
  });
  const correctCount = blanks.filter((b) => b.correct).length;
  return {
    blanks,
    correctCount,
    filledCount: blanks.filter((b) => !b.empty).length,
    allCorrect: blanks.length > 0 && correctCount === blanks.length,
  };
}
