// ============================================================
// 44-05 每日计划欠账与超额处理（Daily Plan Deficit & Surplus Handling）
// 验收要求（TODO 44-05）：
//   1) 定义连续缺席、顺延、考前加量和上限，执行前展示重算预览；
//   2) 缺席不指数爆量（本引擎配额恒定，本就无爆量）；
//   3) 考前加量需显式确认（不静默放大）。
// 现状：`planner.ts` 已有 `PlanTrace` 和 `nextPlanTrace` 计算缺席天数，但缺乏
// “欠账补偿”逻辑——用户缺席几天后，系统自动把欠的题数平摊到未来几天。
// 本模块实现欠账累积、补偿策略（恒定/顺延/考前加量）、上限保护、预览与执行分离。
// 纯函数无 IO。
// ============================================================

/** 欠账补偿策略 */
export type CompensateStrategy = "constant" | "roll-over" | "pre-exam";

/** 欠账补偿配置 */
export interface CompensateConfig {
  /** 欠账是否平摊到未来（true=启用补偿，false=欠账仅记录不补偿） */
  enabled: boolean;
  /** 策略类型：constant=恒定日补（每天补固定量）、roll-over=顺延至考后、pre-exam=考前集中加量 */
  strategy: CompensateStrategy;
  /** 最大每日配额上限（防爆量） */
  maxDailyCap: number;
  /** 最小每日保底（保证学习连续性） */
  minDailyFloor: number;
}

/** 缺勤统计 */
export interface AbsenceStats {
  /** 连续缺席天数 */
  absentStreak: number;
  /** 总欠题数（按策略计算的待补题） */
  totalDue: number;
  /** 已补偿题数（未来几天已分配的补偿量） */
  compensated: number;
  /** 剩余未补偿欠题数 */
  remainingDue: number;
}

/** 计划重算预览（显示欠账影响后的新配额） */
export interface PlanPreview {
  date: string; // YYYY-MM-DD
  originalQuota: number; // 原计划配额
  deficitAdded: number; // 今日新增欠账
  compensatedToday: number; // 今日补偿题数
  newQuota: number; // 重算后配额
  explanation: string; // 中文说明（用于 UI 提示）
}

/** 欠账累计（调用方传入昨日欠账 + 今日完成数 → 更新欠账） */
export function accumulateDeficit(
  prevDeficit: number,
  yesterdayPlanned: number,
  yesterdayDone: number,
): number {
  if (yesterdayPlanned > 0 && yesterdayDone < yesterdayPlanned) {
    return prevDeficit + (yesterdayPlanned - yesterdayDone);
  }
  // 完成或超额时，欠账清零（不累积负值）
  return 0;
}

/** 计算欠账统计（根据配置和当前状态） */
export function computeAbsenceStats(
  config: CompensateConfig,
  absentStreak: number,
  totalDeficit: number,
  compensatedSoFar: number,
): AbsenceStats {
  if (!config.enabled || absentStreak === 0) {
    return { absentStreak, totalDue: 0, compensated: 0, remainingDue: 0 };
  }
  const remainingDue = Math.max(0, totalDeficit - compensatedSoFar);
  return {
    absentStreak,
    totalDue: totalDeficit,
    compensated: compensatedSoFar,
    remainingDue,
  };
}

/** 计算今日补偿题数（按策略分配） */
export function calculateCompensation(
  config: CompensateConfig,
  _absentStreak: number,
  remainingDue: number,
  daysToExam: number | null,
  _originalQuota: number,
): number {
  if (!config.enabled || remainingDue <= 0) return 0;

  let compensation = 0;
  switch (config.strategy) {
    case "constant": {
      // 恒定日补：平均分配到未来每一天（含今天）
      const futureDays = daysToExam != null ? Math.max(1, daysToExam + 1) : 7;
      compensation = Math.ceil(remainingDue / futureDays);
      break;
    }
    case "roll-over": {
      // 顺延：今天不补，欠账保留到考后（本场景下返回 0）
      compensation = 0;
      break;
    }
    case "pre-exam": {
      // 考前集中加量：距考≤5 天时开始补偿，否则为 0
      if (daysToExam != null && daysToExam <= 5) {
        compensation = Math.min(Math.ceil(remainingDue / Math.max(1, daysToExam)), config.maxDailyCap);
      } else {
        compensation = 0;
      }
      break;
    }
  }
  if (compensation <= 0) return 0;
  // 夹取在 [minDailyFloor, maxDailyCap]（若 cap < floor，以 cap 为严格上限）
  const effectiveFloor = Math.min(config.minDailyFloor, config.maxDailyCap);
  return Math.max(effectiveFloor, Math.min(config.maxDailyCap, compensation));
}

/** 生成计划重算预览（欠账影响后的新配额） */
export function generatePlanPreview(
  config: CompensateConfig,
  date: string,
  absentStreak: number,
  totalDeficit: number,
  compensatedSoFar: number,
  daysToExam: number | null,
  originalQuota: number,
): PlanPreview {
  const stats = computeAbsenceStats(config, absentStreak, totalDeficit, compensatedSoFar);
  const compensation = calculateCompensation(config, absentStreak, stats.remainingDue, daysToExam, originalQuota);
  const newQuota = Math.max(originalQuota, originalQuota + compensation);
  
  const explanationParts: string[] = [];
  if (stats.absentStreak > 0) {
    explanationParts.push(`连续缺席 ${stats.absentStreak} 天`);
  }
  if (stats.totalDue > 0) {
    explanationParts.push(`欠账 ${stats.totalDue} 题`);
  }
  if (compensation > 0) {
    explanationParts.push(`今日补偿 ${compensation} 题`);
  }
  explanationParts.push(`新配额 ${newQuota} 题`);
  
  return {
    date,
    originalQuota,
    deficitAdded: stats.totalDue,
    compensatedToday: compensation,
    newQuota,
    explanation: explanationParts.join(" · "),
  };
}

/** 执行重算：返回最终配额（防静默放大） */
export function executePlanRecount(
  preview: PlanPreview,
  userConfirmed: boolean,
): { quota: number; confirmed: boolean } {
  if (!userConfirmed) {
    return { quota: preview.originalQuota, confirmed: false };
  }
  return { quota: preview.newQuota, confirmed: true };
}
