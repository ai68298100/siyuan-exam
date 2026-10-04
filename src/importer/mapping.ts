// ============================================================
// 手动列↔字段映射（TODO 38-02）：自动映射失败/异名列/乱序表时手动指派。
// 与已保存映射、autoMapExcel 共用 ExcelColumnMap 契约；-1=该字段不使用。
// 纯函数无 IO；apply 前必经 assignmentErrors 校验（必填/越界/重复指派）。
// ============================================================
import { autoMapExcel, type ExcelColumnMap } from "./pipeline";

/** 选项槽固定 6 个（A-F），-1=不使用；判断/填空表可全 -1（选择题行由 validate 逐行报错） */
export interface MapAssignment {
  type: number;
  stem: number;
  answer: number;
  analysis: number;
  difficulty: number;
  kp: number;
  score: number;
  source: number;
  options: number[];
}

export const OPTION_SLOTS = 6;
const ALL_NONE: MapAssignment = {
  type: -1, stem: -1, answer: -1, analysis: -1, difficulty: -1, kp: -1, score: -1, source: -1,
  options: Array<number>(OPTION_SLOTS).fill(-1),
};

/** Excel 式列标：0→A、25→Z、26→AA（表头预览与下拉标签用） */
export function columnLabel(idx: number): string {
  let n = idx;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** 自动映射结果 → 手动指派初值（单指派来源：autoMapExcel 找不到的字段=-1） */
export function autoAssignment(header: string[]): MapAssignment {
  const { map } = autoMapExcel(header.map(String));
  return assignmentFromMap(map);
}

/** ExcelColumnMap → 指派（可选字段 undefined→-1；选项槽补齐到 6） */
export function assignmentFromMap(map: ExcelColumnMap): MapAssignment {
  const options = Array<number>(OPTION_SLOTS).fill(-1);
  (map.options ?? []).slice(0, OPTION_SLOTS).forEach((idx, i) => (options[i] = idx));
  return {
    type: map.type, stem: map.stem, answer: map.answer,
    analysis: map.analysis ?? -1, difficulty: map.difficulty ?? -1,
    kp: map.kp ?? -1, score: map.score ?? -1, source: map.source ?? -1,
    options,
  };
}

/** 指派 → ExcelColumnMap：-1 收敛为 undefined / 剔除；required 字段保留原值（校验后调用） */
export function assignmentToMap(a: MapAssignment): ExcelColumnMap {
  const opt = (n: number) => (n >= 0 ? n : undefined);
  return {
    type: a.type,
    stem: a.stem,
    answer: a.answer,
    options: a.options.filter((n) => n >= 0),
    analysis: opt(a.analysis),
    difficulty: opt(a.difficulty),
    kp: opt(a.kp),
    score: opt(a.score),
    source: opt(a.source),
  };
}

/** apply 前校验：返回可行动错误列表（空=可应用）。口径与核心错误一致用中文字段名 */
export function assignmentErrors(a: MapAssignment, width: number): string[] {
  const errs: string[] = [];
  if (a.type < 0) errs.push("缺少必填字段：题型");
  if (a.stem < 0) errs.push("缺少必填字段：题干");
  if (a.answer < 0) errs.push("缺少必填字段：答案");
  const slots: [string, number][] = [
    ["题型", a.type], ["题干", a.stem], ["答案", a.answer], ["解析", a.analysis],
    ["难度", a.difficulty], ["知识点", a.kp], ["分值", a.score], ["来源", a.source],
    ...a.options.map((n, i) => [`选项${String.fromCharCode(65 + i)}`, n] as [string, number]),
  ];
  const seen = new Map<number, string>();
  for (const [name, idx] of slots) {
    if (idx < 0) continue;
    if (idx >= width) { errs.push(`${name}：列 ${columnLabel(idx)} 超出表宽（共 ${width} 列）`); continue; }
    const prev = seen.get(idx);
    if (prev) errs.push(`列 ${columnLabel(idx)} 同时指派给「${prev}」和「${name}」`);
    else seen.set(idx, name);
  }
  return errs;
}

/** 全 -1 的空指派（编辑器初始化兜底用） */
export function emptyAssignment(): MapAssignment {
  return JSON.parse(JSON.stringify(ALL_NONE)) as MapAssignment;
}
