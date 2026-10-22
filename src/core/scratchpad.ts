// ============================================================
// 52-08 演算草稿纸浮层（Scratchpad Modal & State Machine）
// 1) 供理科计算、数量关系、资料分析或逻辑推导做题时快速演练草稿。
// 2) 严格与正式作答答案（answer / drafts）解耦，绝不将草稿误当答案提交。
// 3) 支持单题独立演算与全卷共享草稿板，切题自动保存草稿，会话结束安全释放。
// ============================================================

export type ScratchpadMode = "per_question" | "shared";

export type ScratchpadStore = Record<string, string>;

export interface ScratchpadSnapshot {
  v: 1;
  store: ScratchpadStore;
  sharedText: string;
  mode: ScratchpadMode;
}

export const EMPTY_SCRATCHPAD_SNAPSHOT: ScratchpadSnapshot = {
  v: 1,
  store: {},
  sharedText: "",
  mode: "per_question",
};

/** 52-08 纯函数：根据题目与当前模式读取草稿内容 */
export function getScratchpadText(
  store: ScratchpadStore,
  qid: string,
  mode: ScratchpadMode = "per_question",
  sharedText = "",
): string {
  if (mode === "shared") {
    return sharedText;
  }
  return store[qid] ?? "";
}

/** 52-08 纯函数：更新当前题目或共享草稿内容 */
export function updateScratchpadText(
  store: ScratchpadStore,
  qid: string,
  text: string,
  mode: ScratchpadMode = "per_question",
  sharedText = "",
): { store: ScratchpadStore; sharedText: string } {
  if (mode === "shared") {
    return { store, sharedText: text };
  }
  const next = { ...store };
  if (!text.trim()) {
    delete next[qid];
  } else {
    next[qid] = text;
  }
  return { store: next, sharedText };
}

/** 52-08 纯函数：清空当前题目的草稿 */
export function clearCurrentScratchpad(
  store: ScratchpadStore,
  qid: string,
  mode: ScratchpadMode = "per_question",
  sharedText = "",
): { store: ScratchpadStore; sharedText: string } {
  if (mode === "shared") {
    return { store, sharedText: "" };
  }
  const next = { ...store };
  delete next[qid];
  return { store: next, sharedText };
}

/** 导出当前会话的全部草稿记录摘要（供复盘参考） */
export function formatScratchpadSummary(
  store: ScratchpadStore,
  questionStems?: Record<string, string>,
): string {
  const entries = Object.entries(store).filter(([, text]) => text.trim().length > 0);
  if (!entries.length) return "暂无演算草稿记录";

  const lines: string[] = ["【会话演算草稿记录】"];
  for (const [qid, text] of entries) {
    const stem = questionStems?.[qid] ? `（${questionStems[qid].slice(0, 30)}）` : "";
    lines.push(`\n--- 题目 ${qid}${stem} ---`);
    lines.push(text);
  }
  return lines.join("\n");
}

export interface FormulaCheatItem {
  name: string;
  latex: string;
  note?: string;
}

export interface FormulaCheatCategory {
  id: string;
  title: string;
  items: FormulaCheatItem[];
}

/** 52-08 内置常用理科与数理公式速查卡 */
export const FORMULA_CHEAT_SHEETS: FormulaCheatCategory[] = [
  {
    id: "derivatives",
    title: "导数与微分基础表",
    items: [
      { name: "幂函数导数", latex: "(x^n)' = n x^{n-1}" },
      { name: "指数函数导数", latex: "(e^x)' = e^x, \\quad (a^x)' = a^x \\ln a" },
      { name: "对数函数导数", latex: "(\\ln x)' = \\frac{1}{x}, \\quad (\\log_a x)' = \\frac{1}{x \\ln a}" },
      { name: "正余弦导数", latex: "(\\sin x)' = \\cos x, \\quad (\\cos x)' = -\\sin x" },
      { name: "乘除法则", latex: "(uv)' = u'v + uv', \\quad \\left(\\frac{u}{v}\\right)' = \\frac{u'v - uv'}{v^2}" },
    ],
  },
  {
    id: "trigonometry",
    title: "三角函数与恒等变换",
    items: [
      { name: "同角平方和", latex: "\\sin^2\\alpha + \\cos^2\\alpha = 1" },
      { name: "正弦二倍角", latex: "\\sin(2\\alpha) = 2\\sin\\alpha\\cos\\alpha" },
      { name: "余弦二倍角", latex: "\\cos(2\\alpha) = \\cos^2\\alpha - \\sin^2\\alpha = 2\\cos^2\\alpha - 1" },
      { name: "正切二倍角", latex: "\\tan(2\\alpha) = \\frac{2\\tan\\alpha}{1 - \\tan^2\\alpha}" },
    ],
  },
  {
    id: "physics_constants",
    title: "常用物理与化学常数",
    items: [
      { name: "真空中光速 c", latex: "c = 3.00 \\times 10^8 \\text{ m/s}" },
      { name: "万有引力常数 G", latex: "G = 6.674 \\times 10^{-11} \\text{ N}\\cdot\\text{m}^2/\\text{kg}^2" },
      { name: "阿伏伽德罗常数 NA", latex: "N_A = 6.022 \\times 10^{23} \\text{ mol}^{-1}" },
      { name: "元电荷 e", latex: "e = 1.602 \\times 10^{-19} \\text{ C}" },
      { name: "普朗克常数 h", latex: "h = 6.626 \\times 10^{-34} \\text{ J}\\cdot\\text{s}" },
    ],
  },
  {
    id: "geometry",
    title: "立体几何常用体积与面积",
    items: [
      { name: "圆面积与周长", latex: "S = \\pi r^2, \\quad C = 2\\pi r" },
      { name: "球体积与表面积", latex: "V = \\frac{4}{3}\\pi r^3, \\quad S = 4\\pi r^2" },
      { name: "圆锥体积", latex: "V = \\frac{1}{3}\\pi r^2 h" },
    ],
  },
];

/** 获取所有速查类别 */
export function listFormulaCheatCategories(): FormulaCheatCategory[] {
  return FORMULA_CHEAT_SHEETS;
}
