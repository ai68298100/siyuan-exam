// ============================================================
// 错题四要素自诊断短模板与反思备忘引擎（52-04 / 44-07）
// 纯函数领域层：
// 1. 结构化四要素自诊断：当时怎么想(thought)、错在哪里(rootCause)、依据(rationale)、下次检查点(checklist)
// 2. 独立版本化历史时间轴：多次答错可记录多条复盘日志，改题不覆盖个人诊断
// 3. 标准错因枚举与智能避坑检查点提示
// 4. 文本等价物与复盘 Markdown 导出
// 规则：严格无外部宿主依赖（禁 import "siyuan"），严禁类型强转。
// ============================================================

import { newDiagnosisId } from "./ids";

export type RootCauseKind =
  | "careless" // 审题粗心/漏看条件
  | "concept" // 概念混淆/公式记错
  | "calculation" // 运算失误/步骤跳跃
  | "time_pressure" // 时间紧迫/仓促选错
  | "trap" // 选项陷阱/逻辑诱导
  | "unknown"; // 知识盲区/完全不会

export const ROOT_CAUSE_LABELS: Record<RootCauseKind, string> = {
  careless: "审题粗心/漏看条件",
  concept: "概念混淆/公式记错",
  calculation: "运算失误/步骤跳跃",
  time_pressure: "时间紧迫/仓促选错",
  trap: "选项陷阱/逻辑诱导",
  unknown: "知识盲区/完全不会",
};

export const DEFAULT_CHECKLIST_HINTS: Record<RootCauseKind, string> = {
  careless: "圈出题干关键限定词（如“不属于”、“仅包括”），至少核对两遍设问方向。",
  concept: "回到教材或考点笔记重新推导核心定义，整理近义混淆概念对比表。",
  calculation: "草稿纸按步骤分行清晰书写，复杂算式采用代入估算法交叉验算。",
  time_pressure: "设定单题耗时硬止损点（如90秒），超时先标记标旗并排除极值选项。",
  trap: "识别出题人故意反向设问与绝对化措辞（如“必然”、“均可”），警惕同义偷换。",
  unknown: "立即建立前置知识清单，将关联题块转入背诵与重点 FSRS 调度池。",
};

/** 错题四要素自诊断条目契约 */
export interface SelfDiagnosisEntry {
  v: 1;
  id: string;
  qid: string;
  at: number;
  /** 当时解题思路与误判点（“当时怎么想”） */
  thought?: string;
  /** 根因分类（“错在哪里”） */
  rootCause: RootCauseKind;
  /** 知识点依据或法规书本依据（“依据”） */
  rationale?: string;
  /** 下次同类题目避坑备忘（“下次检查点”） */
  checklist?: string;
}

export interface SelfDiagnosisHistoryDoc {
  v: 1;
  /** qid -> 诊断历史列表（按时间升序） */
  records: Record<string, SelfDiagnosisEntry[]>;
}

export const EMPTY_DIAGNOSIS_DOC: SelfDiagnosisHistoryDoc = {
  v: 1,
  records: {},
};

/** 创建结构化四要素自诊断条目 */
export function createDiagnosisEntry(
  qid: string,
  input: {
    thought?: string;
    rootCause?: RootCauseKind;
    rationale?: string;
    checklist?: string;
  },
  nowMs: number = Date.now(),
): SelfDiagnosisEntry {
  const cleanQid = qid.trim();
  if (!cleanQid) {
    throw new Error("[lv-exam] 无法创建自诊断：qid 不能为空");
  }

  const rootCause = input.rootCause ?? "unknown";
  const thought = input.thought?.trim() || undefined;
  const rationale = input.rationale?.trim() || undefined;

  // 若未填写 checklist，自动带入该错因的默认避坑检查点建议
  const checklist = input.checklist?.trim() || DEFAULT_CHECKLIST_HINTS[rootCause];

  return {
    v: 1,
    id: newDiagnosisId(),
    qid: cleanQid,
    at: nowMs,
    thought,
    rootCause,
    rationale,
    checklist,
  };
}

/** 将新诊断追加至题目的版本化历史记录中（保留最近 N 条，防止存储膨胀） */
export function appendDiagnosisToDoc(
  doc: SelfDiagnosisHistoryDoc,
  entry: SelfDiagnosisEntry,
  maxHistoryPerQid: number = 10,
): SelfDiagnosisHistoryDoc {
  const nextRecords = { ...doc.records };
  const prevList = nextRecords[entry.qid] ?? [];
  const updatedList = [...prevList, entry].slice(-Math.max(1, maxHistoryPerQid));
  nextRecords[entry.qid] = updatedList;

  return {
    v: 1,
    records: nextRecords,
  };
}

/** 获取某题最新一次有效的自诊断记录（复习时回看上次检查点） */
export function getLatestDiagnosis(
  doc: SelfDiagnosisHistoryDoc,
  qid: string,
): SelfDiagnosisEntry | null {
  const list = doc.records[qid];
  if (!list || !list.length) return null;
  return list[list.length - 1];
}

/** 获取某题的完整诊断历史时间轴 */
export function listDiagnosisHistory(
  doc: SelfDiagnosisHistoryDoc,
  qid: string,
): SelfDiagnosisEntry[] {
  const list = doc.records[qid];
  return list ? [...list] : [];
}

/** 移除某题全部自诊断记录 */
export function removeDiagnosisFromDoc(
  doc: SelfDiagnosisHistoryDoc,
  qid: string,
): SelfDiagnosisHistoryDoc {
  if (!doc.records[qid]) return doc;
  const nextRecords = { ...doc.records };
  delete nextRecords[qid];
  return {
    v: 1,
    records: nextRecords,
  };
}

/** 格式化生成一行紧凑复盘摘要（用于列表行微卡片或 Peek 抽屉标注） */
export function formatDiagnosisShortSummary(entry: SelfDiagnosisEntry): string {
  const causeText = ROOT_CAUSE_LABELS[entry.rootCause] ?? entry.rootCause;
  const parts: string[] = [`错因: ${causeText}`];

  if (entry.thought) {
    parts.push(`误判: ${entry.thought.slice(0, 30)}${entry.thought.length > 30 ? "..." : ""}`);
  }
  if (entry.checklist) {
    parts.push(`检查点: ${entry.checklist.slice(0, 30)}${entry.checklist.length > 30 ? "..." : ""}`);
  }

  return parts.join(" · ");
}

/** 导出单题自诊断复盘卡片 Markdown（与题目官方解析物理隔离） */
export function exportDiagnosisMarkdown(
  entry: SelfDiagnosisEntry,
  options: { dateString?: string } = {},
): string {
  const dateStr = options.dateString ?? new Date(entry.at).toLocaleDateString("zh-CN");
  const causeLabel = ROOT_CAUSE_LABELS[entry.rootCause] ?? entry.rootCause;

  const lines: string[] = [];
  lines.push(`> 📝 **【个人错题自诊断复盘】** · 记录于 ${dateStr}`);
  lines.push(`> - **错因归类**：\`${causeLabel}\``);

  if (entry.thought) {
    lines.push(`> - **当时怎么想**：${entry.thought.split("\n").join("\n>   ")}`);
  }
  if (entry.rationale) {
    lines.push(`> - **依据出处**：${entry.rationale.split("\n").join("\n>   ")}`);
  }
  if (entry.checklist) {
    lines.push(`> - **下次检查点**：👉 *${entry.checklist.split("\n").join("\n>   *")}`);
  }

  return lines.join("\n");
}

/**
 * 历史平滑迁移：将旧版单一自由文本反思平滑转换为四要素自诊断条目
 */
export function fromLegacyReflection(
  qid: string,
  legacy: { text: string; at: number },
): SelfDiagnosisEntry {
  const text = legacy.text.trim();

  // 尝试启发式提取旧格式中可能包含的错因
  let rootCause: RootCauseKind = "unknown";
  if (text.includes("粗心") || text.includes("看漏")) rootCause = "careless";
  else if (text.includes("概念") || text.includes("公式")) rootCause = "concept";
  else if (text.includes("计算") || text.includes("算错")) rootCause = "calculation";
  else if (text.includes("时间") || text.includes("没做完")) rootCause = "time_pressure";
  else if (text.includes("陷阱") || text.includes("诱导")) rootCause = "trap";

  return {
    v: 1,
    id: newDiagnosisId(),
    qid,
    at: legacy.at || Date.now(),
    thought: text,
    rootCause,
    checklist: DEFAULT_CHECKLIST_HINTS[rootCause],
  };
}
