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
