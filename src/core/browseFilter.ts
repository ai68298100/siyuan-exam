// ============================================================
// 浏览过滤谓词（从 PracticeTab.filteredQuestions 内联逻辑抽出）
// 浏览页的 9 类过滤（章节 / 题型 / 生命周期 / 争议 / 定向 id / 来源 / 错题 / 求助 / 近练 / 关键词）
// 此前以匿名箭头函数内联在 8000 行的 PracticeTab 中，无法单测。抽出后纯函数可独立验证，
// 也把「过滤语义」与组件渲染解耦（docs 指认 PracticeTab 为最大结构债）。
// 纯函数无 IO：不读 app / 状态 / DOM；错题与近练集合由调用方以 Set 传入。
// ============================================================
import type { Question, QuestionType } from "./types";
import { questionInSection, type SectionRef } from "./sectionTree";
import { isQuestionDisputed } from "./dispute";
import { getQuestionLifecycle, type QuestionLifecycleStatus } from "./revision";

export interface BrowseFilterInput {
  /** 搜索词（小写化后比较；题干/选项/解析/考点/qid 包含匹配） */
  keyword?: string;
  /** 题型过滤（空 = 不限；未知字符串同样按「不等于任何题型」排除，与 UI 下拉语义一致） */
  type?: QuestionType | "" | (string & {});
  /** 生命周期过滤（空 = 不限；未知字符串按不匹配处理） */
  status?: QuestionLifecycleStatus | "" | (string & {});
  /** 仅未解决争议题 */
  disputedOnly?: boolean;
  /** 仅这些题目 id（定向浏览/错题回跳；null = 不限） */
  targetIds?: ReadonlySet<string> | null;
  /** 来源过滤：null/空 = 不限；"@@none" = 仅无来源题；其余 = 精确匹配该来源 */
  source?: string | null;
  /** 仅错题（wrongCount > 0） */
  wrongOnly?: boolean;
  /** 仅被「求助/AI 讲解」过的题（helped 集合内） */
  helpedOnly?: boolean;
  /** 仅最近练过的题（recent 集合内） */
  recentOnly?: boolean;
  /** 速记标签过滤（如 star, trap, doubt, key；空/null = 不限） */
  userTag?: string | null;
  /** 章节过滤（null = 不限） */
  section?: SectionRef | null;
  /** 错题计数查询（qid → 错次）；未提供时错题过滤视为无错题 */
  wrongCountOf?: (qid: string) => number;
  /** 已求助集合 */
  helped?: ReadonlySet<string> | null;
  /** 近期练习集合 */
  recent?: ReadonlySet<string> | null;
}

/** 章节过滤所需的运行时字段（Question 本身不含 rootId/hpath，由读取层合并进题目对象） */
export type SectionableQuestion = { rootId?: string; hpath?: string };

export type BrowseQuestion = Question & SectionableQuestion;

/** 关键词匹配：对题面可见字段做包含匹配（与浏览框同规则）。 */
export function questionMatchesKeyword(
  q: Pick<Question, "id" | "stem" | "options" | "analysis" | "kp">,
  keyword: string,
): boolean {
  const kw = String(keyword ?? "").trim().toLowerCase();
  if (!kw) return true;
  const opt = Array.isArray(q.options) ? q.options : [];
  return (
    q.id.toLowerCase().includes(kw) ||
    q.stem.toLowerCase().includes(kw) ||
    opt.some((o) => String(o).toLowerCase().includes(kw)) ||
    (q.analysis ?? "").toLowerCase().includes(kw) ||
    (q.kp ?? "").toLowerCase().includes(kw)
  );
}

/**
 * 单题是否通过浏览过滤。任一条件不满足即排除；条件未启用（空/未传）不参与判断。
 * 注意：跨库命名视图的「显式确认」属于 UI 层拦截，不在本谓词内（保持纯函数语义）。
 */
export function matchesBrowseFilter(q: BrowseQuestion, input: BrowseFilterInput = {}): boolean {
  if (input.section && !questionInSection(q, input.section)) return false;
  if (input.type && q.type !== input.type) return false;
  if (input.status && getQuestionLifecycle(q) !== input.status) return false;
  if (input.disputedOnly && !isQuestionDisputed(q)) return false;
  if (input.targetIds instanceof Set && !input.targetIds.has(q.id)) return false;
  if (input.userTag) {
    if (!q.userTags || !q.userTags.includes(input.userTag)) return false;
  }
  if (input.source === "@@none") {
    if ((q.source ?? "").trim()) return false;
  } else if (input.source) {
    if ((q.source ?? "").trim() !== input.source) return false;
  }
  if (input.wrongOnly && (input.wrongCountOf?.(q.id) ?? 0) <= 0) return false;
  if (input.helpedOnly && !(input.helped?.has(q.id))) return false;
  if (input.recentOnly && !(input.recent?.has(q.id))) return false;
  if (!questionMatchesKeyword(q, input.keyword ?? "")) return false;
  return true;
}

/** 批量过滤：保持原顺序，便于与 UI 列表（slice 分页）直接对接。 */
export function filterBrowseQuestions<T extends BrowseQuestion>(questions: readonly T[], input: BrowseFilterInput = {}): T[] {
  return questions.filter((q) => matchesBrowseFilter(q, input));
}
