// ============================================================
// 领域契约（docs/02 数据模型；docs/14 §P0-2）
// schemaVersion: 1 —— 所有持久化结构携带版本，迁移器按版本链升级
// ============================================================

export const SCHEMA_VERSION = 1;

export type QuestionType =
  | "single"    // 单选
  | "multiple"  // 多选
  | "judge"     // 判断
  | "fill"      // 填空
  | "short";    // 简答（展示/背诵，不做机器判分）

/** 题目（题源层的内存表示；持久化为思源块 + exam-* 属性） */
export interface Question {
  id: string;                 // 稳定 exam-id（q-xxxxxx）
  type: QuestionType;
  stem: string;               // 题干（markdown）
  options: string[];          // 选项文本数组（下标=0 对应 A）；judge/fill/short 为空
  answer: string;             // 规范化答案（见 answer.ts）
  analysis?: string;          // 解析（markdown）
  difficulty?: number;        // 1-5
  score: number;              // 分值，默认 1
  source?: string;            // 出处（"2023 国考 115 题"）
  sourceKind?: "real" | "mock";
  year?: string;
  kp?: string;                // 考点（"资料分析/比重计算"，/ 分层）
  origin: "imported" | "ai" | "manual";
  batch?: string;             // 导入批次
  review?: "pending" | "verified" | "edited" | "rejected";
  alt?: string[];             // fill/short 可接受答案别名
  hash: string;               // 去重指纹（stem+options）
}

/** 作答事件（append-only 流水；重算唯一输入） */
export interface AttemptEvent {
  v: number;                  // schema 版本
  eid: string;                // 事件唯一 ID（幂等回放键）
  ts: number;                 // UTC ms
  qid: string;                // exam-id
  kind: "practice" | "recite" | "mock" | "card";
  mode: string;               // single|special|paper|wrong|fav|cram|daily
  verdict: "correct" | "wrong" | "not_attempted";
  myAnswer: string | null;    // 作答快照
  selfRating?: number;        // 背诵/闪卡 1-4
  timeMs?: number;
  sessionId: string;
  examId?: string | null;     // 模考卷 id
  queue: "normal" | "wrong" | "cram";
  device: string;             // 设备 ID（分片合并键）
  seq: number;                // 设备内单调序号（乱序回放排序键）
  changes?: number;           // 改答次数
  confidence?: "sure" | "fuzzy" | "guess"; // 置信度自评
}

/** 错题派生条目（可随时从流水重建的物化视图） */
export interface WrongItem {
  qid: string;
  firstWrongAt: number;
  wrongCount: number;
  streakCorrect: number;
  reason?: "careless" | "unknown" | "trap";
  myAnswer: string | null;
  status: "active" | "eliminated" | "mastered";
}

/** 练习会话（单活动；可暂停续做） */
export interface SessionState {
  id: string;
  mode: string;
  qids: string[];
  cursor: number;
  drafts: Record<string, string>;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
}

export interface DayStats {
  date: string;               // YYYY-MM-DD（本地时区）
  attempts: number;
  correct: number;
}

export interface ReplayResult {
  wrongbook: Map<string, WrongItem>;
  byQuestion: Map<string, { attempts: number; correct: number; lastAt: number }>;
  days: Map<string, DayStats>;
  skipped: number;            // 坏行/重复事件数（幂等去重）
  clockAnomalies: number;     // 时钟回拨检出数
}
