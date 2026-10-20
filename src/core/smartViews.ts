// ============================================================
// 命名智能视图（43-05 / 65-01 / 65-07）：保存浏览过滤条件 → 命名复用 → 跨工作区导入导出
// 纯函数层：applyView 只依赖视图内声明的字段；schema 版本不符/字段缺失时
// 如实降级为"不过滤该项"，不静默改变含义（43-05 验收口径）。
// 边界：跨视图共享同一题库身份校验；导出/导入严格类型校验。
// 规则：严格无外部宿主依赖（禁 import "siyuan"），严禁类型强转。
// ============================================================

import type { QuestionLifecycleStatus, QuestionType } from "./types";

export interface SmartView {
  name: string;
  /** schema 版本：未来字段演进按版本容错 */
  v: 1;
  /** 题库身份：视图绑定创建时所在库，跨库应用需用户显式确认（UI 层拦截） */
  bankId: string;
  /** 搜索词（题干/选项/解析/qid 包含匹配，与浏览框同规则） */
  search: string;
  favOnly: boolean;
  /** 章节过滤（hpath 前缀语义；结构变化时按 hpath 如实匹配，不再命中就为空列表而非回退全部） */
  section?: { kind: "doc" | "heading"; id: string; hpath: string } | null;
  createdAt: number;
  /** 43-05 强化：题型过滤 */
  types?: QuestionType[];
  /** 考点前缀过滤（如“资料分析/比重”） */
  kpPrefix?: string;
  /** 试题出处性质（real 真题 / mock 模拟） */
  sourceKind?: "real" | "mock";
  /** 仅错题过滤 */
  onlyWrong?: boolean;
  /** 仅争议题过滤 */
  onlyDisputed?: boolean;
  /** 题目作者生命周期过滤 (draft/review/published/deprecated) */
  lifecycle?: QuestionLifecycleStatus;
}

export interface ViewFilterInput {
  rootId?: string;
  hpath?: string;
  fav?: boolean;
  id: string;
  stem: string;
  options: string[];
  analysis?: string;
  type?: QuestionType;
  kp?: string;
  sourceKind?: "real" | "mock";
  status?: QuestionLifecycleStatus;
  dispute?: { status?: string };
}

/** 应用视图：多项过滤叠加；search 大小写不敏感 */
export function applyView(
  view: SmartView,
  questions: ViewFilterInput[],
  options?: { wrongQids?: ReadonlySet<string> },
): ViewFilterInput[] {
  let list = questions;
  if (view.v !== 1) return list; // 未知版本：不过滤（宁多勿错杀）

  // 1. 收藏过滤
  if (view.favOnly) list = list.filter((q) => q.fav);

  // 2. 章节过滤
  if (view.section?.hpath) {
    const s = view.section;
    list = list.filter((q) => (s.kind === "doc" ? q.rootId === s.id : !!q.hpath && q.hpath.startsWith(s.hpath)));
  }

  // 3. 题型过滤
  if (view.types?.length) {
    const allowed = new Set(view.types);
    list = list.filter((q) => q.type && allowed.has(q.type));
  }

  // 4. 考点前缀过滤
  if (view.kpPrefix && view.kpPrefix.trim()) {
    const prefix = view.kpPrefix.trim();
    list = list.filter((q) => q.kp === prefix || (q.kp?.startsWith(prefix + "/") ?? false));
  }

  // 5. 试题来源过滤
  if (view.sourceKind) {
    list = list.filter((q) => (q.sourceKind ?? "mock") === view.sourceKind);
  }

  // 6. 仅错题过滤
  if (view.onlyWrong) {
    const wrongSet = options?.wrongQids;
    if (wrongSet) {
      list = list.filter((q) => wrongSet.has(q.id));
    }
  }

  // 7. 仅争议题过滤
  if (view.onlyDisputed) {
    list = list.filter((q) => q.dispute && q.dispute.status !== "resolved");
  }

  // 8. 生命周期过滤
  if (view.lifecycle) {
    list = list.filter((q) => (q.status ?? "published") === view.lifecycle);
  }

  // 9. 全局关键词搜索
  const kw = view.search.trim().toLowerCase();
  if (kw) {
    list = list.filter(
      (q) =>
        q.id.toLowerCase().includes(kw) ||
        q.stem.toLowerCase().includes(kw) ||
        q.options.some((o) => o.toLowerCase().includes(kw)) ||
        (q.analysis ?? "").toLowerCase().includes(kw) ||
        (q.kp ?? "").toLowerCase().includes(kw),
    );
  }

  return list;
}

/** 视图清单合并保存：同名覆盖、按创建时间倒序、上限 30（配额护栏） */
export function upsertView(list: SmartView[], view: SmartView, limit = 30): SmartView[] {
  const next = [...list.filter((v) => v.name !== view.name), view];
  next.sort((a, b) => b.createdAt - a.createdAt);
  return next.slice(0, limit);
}

/** 视图与当前题库身份不符 → UI 层应提示而非静默套用 */
export function viewBankMismatch(view: SmartView, bankId: string): boolean {
  return !!view.bankId && view.bankId !== bankId;
}

/** 导出智能视图为格式化 JSON 字符串（65-07 导出迁移契约） */
export function exportSmartViewsJson(views: readonly SmartView[]): string {
  return JSON.stringify({ v: 1, exportedAt: Date.now(), views }, null, 2);
}

/** 导入外部智能视图 JSON 并校验格式 */
export function importSmartViewsJson(
  rawJson: string,
  targetBankId?: string,
): { imported: SmartView[]; skipped: number } {
  try {
    const parsed = JSON.parse(rawJson) as { v?: number; views?: unknown[] };
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.views)) {
      return { imported: [], skipped: 0 };
    }

    const imported: SmartView[] = [];
    let skipped = 0;

    for (const v of parsed.views) {
      if (typeof v === "object" && v !== null && "name" in v && typeof (v as { name: unknown }).name === "string") {
        const item = v as SmartView;
        const validItem: SmartView = {
          name: item.name.trim(),
          v: 1,
          bankId: targetBankId || item.bankId || "",
          search: item.search || "",
          favOnly: Boolean(item.favOnly),
          createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
        };

        if (item.section) validItem.section = item.section;
        if (Array.isArray(item.types)) validItem.types = item.types;
        if (item.kpPrefix) validItem.kpPrefix = item.kpPrefix;
        if (item.sourceKind) validItem.sourceKind = item.sourceKind;
        if (item.onlyWrong) validItem.onlyWrong = Boolean(item.onlyWrong);
        if (item.onlyDisputed) validItem.onlyDisputed = Boolean(item.onlyDisputed);
        if (item.lifecycle) validItem.lifecycle = item.lifecycle;

        imported.push(validItem);
      } else {
        skipped++;
      }
    }

    return { imported, skipped };
  } catch {
    return { imported: [], skipped: 0 };
  }
}
