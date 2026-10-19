// ============================================================
// 39-04 自评语义与客观判分分离（Self-rating Semantics vs Objective Grading）
// 验收要求（TODO 39-04）：
//   1) 区分「费力但成功回忆」（Hard）与「未回忆成功」，不得把 Hard 未经说明地等同客观答错；
//   2) 客观判分与自评**分别保留**（两套事实，互不覆盖）；
//   3) Again/Hard/Good/Easy 标签在流水、组结算与报告中一致；
//   4) 二元模式（记住/忘了）的四档映射必须明确。
//
// 现状问题：`reciteAnswer` 以 `selfRating >= 3` 推导 `verdict: "correct" | "wrong"`，
// 于是 Hard(2) 与 Again(1) 在「背诵连击」上被同等清零，且自评事实被塞进面向客观判分
// 的 verdict 字段 —— 两者语义混用，无法区分「费力但成功」与「完全没想起来」。
// 本模块把「四档自评」定义为独立事实，并给出它与客观判分、连击、毕业之间的明确规则。
// 纯函数无 IO。
// ============================================================

/** 四档自评（墨墨式；与 riff.Rating 同序同值，见 39-01） */
export type SelfRating = 1 | 2 | 3 | 4;

export interface SelfRatingMeta {
  rating: SelfRating;
  /** FSRS 标签（与内核 riff.Rating 一致） */
  fsrsLabel: "Again" | "Hard" | "Good" | "Easy";
  /** 中文自评档位名（UI 与报告共用，保证一致） */
  label: string;
  /** 是否「成功回忆」（Hard 属成功但费力，Again 属未成功——这是本模块的核心区分） */
  recalled: boolean;
  /** 是否费力（Hard 的全部意义所在） */
  effortful: boolean;
}

const META: Record<SelfRating, SelfRatingMeta> = {
  1: { rating: 1, fsrsLabel: "Again", label: "完全不会", recalled: false, effortful: false },
  2: { rating: 2, fsrsLabel: "Hard", label: "有点难", recalled: true, effortful: true },
  3: { rating: 3, fsrsLabel: "Good", label: "一般", recalled: true, effortful: false },
  4: { rating: 4, fsrsLabel: "Easy", label: "很容易", recalled: true, effortful: false },
};

/** 取自评元数据；非法值返回 null（不猜测档位）。 */
export function selfRatingMeta(rating: number): SelfRatingMeta | null {
  if (rating === 1 || rating === 2 || rating === 3 || rating === 4) return META[rating];
  return null;
}

/**
 * 自评是否算「回忆成功」。
 * 关键：Hard(2) = 费力但**成功**回忆 → recalled=true（此前实现把它当失败）。
 * 只有 Again(1) 才是未回忆成功。
 */
export function isRecalled(rating: number): boolean {
  return selfRatingMeta(rating)?.recalled ?? false;
}

/** 是否「费力」（Hard）：用于报告区分「顺利回忆」与「勉强回忆」。 */
export function isEffortful(rating: number): boolean {
  return selfRatingMeta(rating)?.effortful ?? false;
}

/**
 * 客观判分事实与自评事实**分别保留**，互不覆盖。
 * objective 仅对 practice/mock 等有标准答案的作答有意义；自评（recite/card）没有客观判分，
 * 其 objective 恒为 null——不伪造「答对/答错」。
 */
export interface AnswerFacts {
  /** 客观判分（有标准答案时才有；自评场景为 null） */
  objective: "correct" | "wrong" | "not_attempted" | null;
  /** 用户自评档位（1-4；无自评为 null） */
  selfRating: SelfRating | null;
  /** 自评推导的「回忆成功」（无自评时为 null） */
  recalled: boolean | null;
  /** 自评是否费力（Hard） */
  effortful: boolean;
}

/** 由作答事件的两类原始事实构造分离后的语义视图。 */
export function answerFacts(input: {
  kind?: string;
  verdict?: string;
  selfRating?: number | null;
}): AnswerFacts {
  const isSelfRated = input.kind === "recite" || input.kind === "card";
  const meta = input.selfRating != null ? selfRatingMeta(input.selfRating) : null;
  // 自评场景不保留客观判分（没有标准答案可比），避免把自评伪装成客观对错
  const objective = isSelfRated
    ? null
    : input.verdict === "correct" || input.verdict === "wrong" || input.verdict === "not_attempted"
      ? input.verdict
      : null;
  return {
    objective,
    selfRating: meta?.rating ?? null,
    recalled: meta?.recalled ?? null,
    effortful: meta?.effortful ?? false,
  };
}

/**
 * 背诵连击语义（39-04 核心修正）：
 *   - 毕业口径：连续「顺利回忆」才递增（Hard 虽成功但费力，不计入毕业连击——
 *     否则「每次都很勉强」也会被判为已掌握）；
 *   - 未回忆成功（Again）→ 清零；
 *   - Hard → **保持不清零**（费力但确实想起来了，不应被当作失败抹掉既有进度）。
 * 返回值为该事件对连击的增量。
 */
export type ReciteStreakEffect = { action: "increment" | "reset" | "hold"; reason: string };

export function reciteStreakEffect(rating: number): ReciteStreakEffect {
  if (rating === 1) return { action: "reset", reason: "未回忆成功（Again）→ 连击清零" };
  if (rating === 2) return { action: "hold", reason: "费力但成功回忆（Hard）→ 保持连击，不当作失败清零" };
  if (rating === 3 || rating === 4) return { action: "increment", reason: "顺利回忆 → 连击递增" };
  return { action: "hold", reason: "非法自评值 → 不改动连击" };
}

/**
 * 二元模式（记住/忘了）→ 四档自评的明确映射。
 * 记住 = Good(3)（顺利回忆，非 Easy：没有证据说明它「很容易」）；
 * 忘了 = Again(1)（未回忆成功）。
 * 不使用 Hard/Easy，因为二元模式没有采集「费力程度」的信息。
 */
export function binaryToSelfRating(remembered: boolean): SelfRating {
  return remembered ? 3 : 1;
}

/** 四档→二元的反投影（用于二元模式的报告口径；Hard 归「记住了」，因为它是成功回忆） */
export function selfRatingToBinary(rating: number): boolean | null {
  const meta = selfRatingMeta(rating);
  return meta ? meta.recalled : null;
}

/** 组结算/报告口径：区分顺利回忆与费力回忆，避免把 Hard 混入「答错」 */
export interface ReciteBreakdown {
  total: number;
  /** 顺利回忆（Good/Easy） */
  smooth: number;
  /** 费力但成功回忆（Hard）——单列，不与失败混淆 */
  effortful: number;
  /** 未回忆成功（Again） */
  missed: number;
  /** 无效自评 */
  invalid: number;
}

export function reciteBreakdown(ratings: readonly number[]): ReciteBreakdown {
  const out: ReciteBreakdown = { total: ratings.length, smooth: 0, effortful: 0, missed: 0, invalid: 0 };
  for (const r of ratings) {
    const meta = selfRatingMeta(r);
    if (!meta) out.invalid++;
    else if (meta.effortful) out.effortful++;
    else if (meta.recalled) out.smooth++;
    else out.missed++;
  }
  return out;
}

/** 结算一行回执：明确 Hard 是「费力但成功」，不与答错同列（39-04 验收口径一致） */
export function reciteBreakdownText(b: ReciteBreakdown): string {
  const parts = [`顺利回忆 ${b.smooth}`];
  if (b.effortful) parts.push(`费力但成功 ${b.effortful}`);
  if (b.missed) parts.push(`未回忆成功 ${b.missed}`);
  if (b.invalid) parts.push(`无效自评 ${b.invalid}`);
  return `${parts.join(" · ")}（共 ${b.total} 题）`;
}
