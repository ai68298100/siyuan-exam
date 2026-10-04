// ============================================================
// AI 任务信封服务（docs/19 Q5 / docs/18 §2 最小切片）
// 纯逻辑层，无 IO：通道由调用方注入，便于 headless 单测。
// 落三条跨模块约束（docs/19 §6）：
// - G1 作答/上下文身份：contextHash 绑定 qid+题面指纹+作答快照+模式；
//   改答/切题后旧响应 isStale，不能当当前反馈
// - G2 迟到结果隔离：applyResult 只在身份一致时应用；不一致保留草稿不占结果
// - G6 提示与正式揭示：strictMock 拒绝题目级帮助；未提交拒绝"揭示型"任务
// ============================================================
import type { Question } from "../core/types";
import type { AiChannel, AiMessage } from "./client";

export type AiTaskStatus = "ok" | "needsEvidence" | "needsReview" | "unsupported" | "failed";

/** docs/18 模板目录的最小子集（已实际接入的讲解类任务） */
export type ExplainTemplateId =
  | "practice.hint"
  | "practice.socratic"
  | "practice.explain"
  | "practice.misdiagnosis"
  | "report.explain";

/** 任务上下文（G1 身份字段；任一变化 → contextHash 变化） */
export interface AiTaskContext {
  templateId: ExplainTemplateId;
  templateVersion: number; // 提示词模板版本（docs/18 模板修订）
  qid: string;
  questionRevision: string; // 题面指纹（stem+options；改题后旧讲解失效）
  learnerAnswer: string | null; // 本次作答快照（null=未作答）
  submitted: boolean; // 提交状态（未提交=独立作答中）
  mode: string; // practice|recite|paper|strictMock…
  sessionId: string;
}

/** 结果信封（docs/18 §2 建议协议的字面子集） */
export interface AiTaskEnvelope {
  v: number;
  taskId: string;
  templateId: ExplainTemplateId;
  templateVersion: number;
  status: AiTaskStatus;
  summary: string; // 面向用户的一句说明
  data: { text?: string }; // 讲解类任务产物为文本；结构化任务后续扩展
  contextHash: string; // G1：生成时的上下文指纹
  createdAt: number;
  durationMs: number;
  tokens: number; // 粗估（chars/4，与 CountingChannel 同口径）
  error?: string;
}

// ---------- 指纹与哈希（稳定序列化，跨端一致） ----------

/** FNV-1a 32bit → 8 位 hex（无 crypto 依赖，纯校验用途） */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 题面指纹：stem+options 任一修订即变化（answer/analysis 变化不影响已作答事实） */
export function questionFingerprint(q: Pick<Question, "stem" | "options">): string {
  return hashText(q.stem + "\u0000" + q.options.join("\u0001"));
}

/** G1 上下文指纹 */
export function taskContextHash(ctx: AiTaskContext): string {
  return hashText(
    [
      ctx.templateId,
      ctx.templateVersion,
      ctx.qid,
      ctx.questionRevision,
      ctx.learnerAnswer ?? "\u0002",
      ctx.submitted ? "1" : "0",
      ctx.mode,
      ctx.sessionId,
    ].join("\u0000"),
  );
}

// ---------- 帮助闸门（G6 最小实现） ----------

export type HelpKind = "hint" | "socratic" | "reveal";

export interface HelpVerdict {
  allowed: boolean;
  reason?: string;
}

/** 题目级帮助条件：strictMock 全拒；未提交只允许 hint/socratic（揭示型必须已提交） */
export function helpAllowed(ctx: Pick<AiTaskContext, "mode" | "submitted">, kind: HelpKind): HelpVerdict {
  if (ctx.mode === "strictMock") return { allowed: false, reason: "strictMock：考试中不提供题目级帮助" };
  if (kind === "reveal" && !ctx.submitted) return { allowed: false, reason: "未提交：先独立作答，再获取依据讲解" };
  return { allowed: true };
}

// ---------- 任务执行器 ----------

let taskCounter = 0;
const newTaskId = () => `t-${Date.now().toString(36)}-${(taskCounter++).toString(36)}`;

export interface TaskRunnerOpts {
  now?: () => number;
  maxCalls?: number; // 预算闸门（119-04 lite）：超限直接拒绝，不发请求
}

export class AiTaskRunner {
  calls = 0;

  constructor(
    private readonly channel: AiChannel,
    private readonly opts: TaskRunnerOpts = {},
  ) {}

  /** 执行一次讲解类任务：闸门 → 预算 → 通道 → 信封（任何失败都返回 failed 信封，不抛出） */
  async run(ctx: AiTaskContext, messages: AiMessage[]): Promise<AiTaskEnvelope> {
    const started = this.opts.now?.() ?? Date.now();
    const base: AiTaskEnvelope = {
      v: 1,
      taskId: newTaskId(),
      templateId: ctx.templateId,
      templateVersion: ctx.templateVersion,
      status: "failed",
      summary: "",
      data: {},
      contextHash: taskContextHash(ctx),
      createdAt: started,
      durationMs: 0,
      tokens: 0,
    };
    const gate = helpAllowed(ctx, helpKindOf(ctx.templateId));
    if (!gate.allowed) {
      return { ...base, status: "unsupported", summary: gate.reason ?? "当前条件不允许该任务" };
    }
    if (this.opts.maxCalls != null && this.calls >= this.opts.maxCalls) {
      return { ...base, status: "unsupported", summary: `已达本会话调用预算（${this.opts.maxCalls} 次）` };
    }
    this.calls++;
    try {
      const text = await this.channel.chat(messages);
      const chars = messages.reduce((n, m) => n + m.content.length, 0) + text.length;
      return {
        ...base,
        status: "ok",
        summary: `${templateLabel(ctx.templateId)}完成`,
        data: { text },
        tokens: Math.round(chars / 4),
        durationMs: (this.opts.now?.() ?? Date.now()) - started,
      };
    } catch (e) {
      return {
        ...base,
        status: "failed",
        summary: "任务执行失败",
        error: e instanceof Error ? e.message : String(e),
        durationMs: (this.opts.now?.() ?? Date.now()) - started,
      };
    }
  }
}

/** G2 迟到结果隔离：信封身份与当前上下文一致才允许应用；不一致保留为草稿 */
export function applyResult(
  envelope: AiTaskEnvelope,
  currentCtx: AiTaskContext,
): { applied: boolean; reason?: "stale" | "not-ok" | "unknown-status" } {
  if (envelope.status !== "ok") return { applied: false, reason: "not-ok" };
  if (envelope.contextHash !== taskContextHash(currentCtx)) return { applied: false, reason: "stale" };
  return { applied: true };
}

// ---------- 内部 ----------

function helpKindOf(templateId: ExplainTemplateId): HelpKind {
  // misdiagnosis/report.explain 都是"已提交后"的证据/统计解读：与 explain 同走揭示闸门
  if (templateId === "practice.explain" || templateId === "practice.misdiagnosis" || templateId === "report.explain") {
    return "reveal";
  }
  if (templateId === "practice.hint") return "hint";
  return "socratic";
}

function templateLabel(templateId: ExplainTemplateId): string {
  if (templateId === "practice.explain") return "依据讲解";
  if (templateId === "practice.hint") return "递进提示";
  if (templateId === "practice.misdiagnosis") return "错因假设";
  if (templateId === "report.explain") return "报告解读";
  return "苏格拉底追问";
}
