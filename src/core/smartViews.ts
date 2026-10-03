// ============================================================
// 命名智能视图（TODO 43-05 lite）：保存浏览过滤条件 → 命名复用 → 重启稳定
// 纯函数层：applyView 只依赖视图内声明的字段；schema 版本不符/字段缺失时
// 如实降级为"不过滤该项"，不静默改变含义（43-05 验收口径）。
// 边界：不含排序与 schema 迁移链（v1 起步）；跨视图共享同一题库身份校验。
// ============================================================

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
}

export interface ViewFilterInput {
  rootId?: string;
  hpath?: string;
  fav?: boolean;
  id: string;
  stem: string;
  options: string[];
  analysis?: string;
}

/** 应用视图：三项过滤叠加；search 大小写不敏感 */
export function applyView(view: SmartView, questions: ViewFilterInput[]): ViewFilterInput[] {
  let list = questions;
  if (view.v !== 1) return list; // 未知版本：不过滤（宁多勿错杀）
  if (view.favOnly) list = list.filter((q) => q.fav);
  if (view.section?.hpath) {
    const s = view.section;
    list = list.filter((q) => (s.kind === "doc" ? q.rootId === s.id : !!q.hpath && q.hpath.startsWith(s.hpath)));
  }
  const kw = view.search.trim().toLowerCase();
  if (kw) {
    list = list.filter(
      (q) =>
        q.id.toLowerCase().includes(kw) ||
        q.stem.toLowerCase().includes(kw) ||
        q.options.some((o) => o.toLowerCase().includes(kw)) ||
        (q.analysis ?? "").toLowerCase().includes(kw),
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
