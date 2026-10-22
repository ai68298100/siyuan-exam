/**
 * 备考里程碑与荣誉勋章成长引擎 (Milestones & Achievement System)
 * 职责：
 * 1. 严格基于本地真实作答流水与题库资产计算学习成就勋章；
 * 2. 覆盖作答题量、错题消灭、连续自律、模考实战、教研制题五大维度；
 * 3. 生成直观的进度比、解锁态与 Markdown 个人荣誉成长手账。
 */

import type { AttemptEvent, Question, WrongItem } from "./types";

export type BadgeTier = "bronze" | "silver" | "gold" | "diamond";

export interface MilestoneBadge {
  id: string;
  title: string;
  icon: string;
  description: string;
  category: "volume" | "perseverance" | "mastery" | "mock" | "author";
  tier: BadgeTier;
  progress: number;
  maxProgress: number;
  unlocked: boolean;
  unlockedAt?: number;
}

export interface MilestoneOverview {
  unlockedCount: number;
  totalBadges: number;
  overallScore: number; // 荣誉成长值 (0 - 1000)
  levelTitle: string; // 称号（如 "备考探索者"、"学霸大师"）
  badges: MilestoneBadge[];
}

export interface MilestoneStatsInput {
  events: readonly AttemptEvent[];
  questions: readonly Question[];
  wrongItems: readonly WrongItem[];
  eliminatedCount: number;
  streakDays: number;
  mockRunCount?: number;
  readinessGrade?: string; // S / A / B / C / D
}

/** 勋章定义清单 */
const BADGE_DEFINITIONS: Array<{
  id: string;
  title: string;
  icon: string;
  description: string;
  category: MilestoneBadge["category"];
  tier: BadgeTier;
  maxProgress: number;
  evaluator: (input: MilestoneStatsInput) => { progress: number; unlocked: boolean; unlockedAt?: number };
}> = [
  {
    id: "first_step",
    title: "初心破冰",
    icon: "🌱",
    description: "完成备考路上的第 1 道题目作答",
    category: "volume",
    tier: "bronze",
    maxProgress: 1,
    evaluator: (input) => {
      const valid = input.events.filter((e) => e.verdict !== "not_attempted");
      return {
        progress: Math.min(1, valid.length),
        unlocked: valid.length >= 1,
        unlockedAt: valid[0]?.ts,
      };
    },
  },
  {
    id: "century_drill",
    title: "百题斩",
    icon: "🎯",
    description: "累计完成 100 道题目独立作答",
    category: "volume",
    tier: "silver",
    maxProgress: 100,
    evaluator: (input) => {
      const valid = input.events.filter((e) => e.verdict !== "not_attempted");
      return {
        progress: Math.min(100, valid.length),
        unlocked: valid.length >= 100,
        unlockedAt: valid[99]?.ts,
      };
    },
  },
  {
    id: "thousand_master",
    title: "千锤百炼",
    icon: "💎",
    description: "累计完成 1000 道题目独立作答",
    category: "volume",
    tier: "diamond",
    maxProgress: 1000,
    evaluator: (input) => {
      const valid = input.events.filter((e) => e.verdict !== "not_attempted");
      return {
        progress: Math.min(1000, valid.length),
        unlocked: valid.length >= 1000,
        unlockedAt: valid[999]?.ts,
      };
    },
  },
  {
    id: "wrong_hunter",
    title: "错题消灭者",
    icon: "⚔️",
    description: "在错题本中累计攻坚消灭 10 道错题",
    category: "perseverance",
    tier: "silver",
    maxProgress: 10,
    evaluator: (input) => {
      return {
        progress: Math.min(10, input.eliminatedCount),
        unlocked: input.eliminatedCount >= 10,
      };
    },
  },
  {
    id: "stubborn_breaker",
    title: "顽疾破壁者",
    icon: "🛡️",
    description: "成功攻坚并消灭累计答错 ≥3 次的顽固错题",
    category: "perseverance",
    tier: "gold",
    maxProgress: 1,
    evaluator: (input) => {
      const hasEliminatedStubborn = input.wrongItems.some((w) => w.status === "eliminated" && w.wrongCount >= 3);
      return {
        progress: hasEliminatedStubborn ? 1 : 0,
        unlocked: hasEliminatedStubborn,
      };
    },
  },
  {
    id: "streak_seven",
    title: "自律成钢",
    icon: "🔥",
    description: "连续坚持学习打卡达到 7 天",
    category: "perseverance",
    tier: "silver",
    maxProgress: 7,
    evaluator: (input) => {
      return {
        progress: Math.min(7, input.streakDays),
        unlocked: input.streakDays >= 7,
      };
    },
  },
  {
    id: "cbt_veteran",
    title: "全真老兵",
    icon: "🏆",
    description: "完成至少 3 次全真模拟考场测评",
    category: "mock",
    tier: "silver",
    maxProgress: 3,
    evaluator: (input) => {
      const count = input.mockRunCount ?? 0;
      return {
        progress: Math.min(3, count),
        unlocked: count >= 3,
      };
    },
  },
  {
    id: "radar_ace",
    title: "雷达王牌",
    icon: "🌟",
    description: "在五维备考完备度体检中获得 S 级或 A 级优秀评级",
    category: "mastery",
    tier: "gold",
    maxProgress: 1,
    evaluator: (input) => {
      const isAce = input.readinessGrade === "S" || input.readinessGrade === "A";
      return {
        progress: isAce ? 1 : 0,
        unlocked: isAce,
      };
    },
  },
  {
    id: "curator_author",
    title: "题库教研工匠",
    icon: "✍️",
    description: "自建或录入的高质量试题累计达到 50 题",
    category: "author",
    tier: "silver",
    maxProgress: 50,
    evaluator: (input) => {
      return {
        progress: Math.min(50, input.questions.length),
        unlocked: input.questions.length >= 50,
      };
    },
  },
];

/**
 * 计算用户的里程碑勋章概览
 */
export function calculateMilestones(input: MilestoneStatsInput): MilestoneOverview {
  const badges: MilestoneBadge[] = [];
  let unlockedCount = 0;
  let scoreSum = 0;

  const tierScore: Record<BadgeTier, number> = {
    bronze: 50,
    silver: 100,
    gold: 200,
    diamond: 300,
  };

  for (const def of BADGE_DEFINITIONS) {
    const res = def.evaluator(input);
    if (res.unlocked) {
      unlockedCount++;
      scoreSum += tierScore[def.tier];
    }

    badges.push({
      id: def.id,
      title: def.title,
      icon: def.icon,
      description: def.description,
      category: def.category,
      tier: def.tier,
      progress: res.progress,
      maxProgress: def.maxProgress,
      unlocked: res.unlocked,
      unlockedAt: res.unlockedAt,
    });
  }

  // 综合称号体系
  let levelTitle = "备考潜行者";
  if (scoreSum >= 700) levelTitle = "登峰造极 · 状元学者";
  else if (scoreSum >= 450) levelTitle = "渐入佳境 · 刷题宗师";
  else if (scoreSum >= 200) levelTitle = "笃行不怠 · 备考精英";
  else if (scoreSum >= 50) levelTitle = "初露锋芒 · 进取新秀";

  return {
    unlockedCount,
    totalBadges: badges.length,
    overallScore: scoreSum,
    levelTitle,
    badges,
  };
}

/**
 * 导出个人学习里程碑成长墙 Markdown
 */
export function exportMilestoneBadgeWallMarkdown(overview: MilestoneOverview): string {
  const lines: string[] = [];
  lines.push(`# 🎖️ 个人备考荣誉勋章墙与成长里程碑`);
  lines.push(`> 荣誉总积分：**${overview.overallScore} 分** | 当前段位：**${overview.levelTitle}** | 已解锁勋章：**${overview.unlockedCount} / ${overview.totalBadges}**\n`);

  lines.push(`## 🏆 荣誉勋章展示`);
  lines.push(`| 勋章 | 类别 | 等级 | 达成条件 | 当前状态 |`);
  lines.push(`|---|---|---|---|---|`);

  const tierName: Record<BadgeTier, string> = {
    bronze: "青铜",
    silver: "白银",
    gold: "黄金",
    diamond: "钻石",
  };

  for (const b of overview.badges) {
    const statusText = b.unlocked ? `✅ 已解锁${b.unlockedAt ? ` (${new Date(b.unlockedAt).toLocaleDateString()})` : ""}` : `🔒 进行中 (${b.progress}/${b.maxProgress})`;
    lines.push(`| ${b.icon} **${b.title}** | ${b.category} | ${tierName[b.tier]} | ${b.description} | ${statusText} |`);
  }

  return lines.join("\n");
}
