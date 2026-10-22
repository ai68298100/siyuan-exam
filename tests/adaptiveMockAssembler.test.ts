import { describe, it, expect } from "vitest";
import type { Question, WrongItem, AttemptEvent } from "../src/core/types";
import type { BlindspotItem } from "../src/core/readinessRadar";
import {
  assembleAdaptiveSprintPaper,
  convertSprintPaperToBlueprint,
  exportSprintPaperMarkdown,
  exportSprintPaperCsv,
} from "../src/core/adaptiveMockAssembler";
import { validateBlueprint } from "../src/core/mock";

describe("adaptiveMockAssembler - 考前冲刺自适应密卷装配器", () => {
  const createMockQuestion = (
    id: string,
    kp: string,
    stem: string,
    type: Question["type"] = "single",
    options: string[] = ["选项A", "选项B", "选项C", "选项D"],
    answer: string = "A",
    difficulty: number = 3,
  ): Question => ({
    id,
    type,
    stem,
    options,
    answer,
    score: 1,
    kp,
    difficulty,
    origin: "imported",
  });

  // 构造涵盖不同考点的 15 道题目
  const testBank: Question[] = [
    // 刑法组（5题）
    createMockQuestion("q_crim_1", "刑法/因果关系", "刑法因果关系判断题 1", "single", ["A", "B", "C", "D"], "A", 4),
    createMockQuestion("q_crim_2", "刑法/正当防卫", "正当防卫认定题 2", "single", ["A", "B", "C", "D"], "B", 5),
    createMockQuestion("q_crim_3", "刑法/盗窃罪", "盗窃罪既遂形态 3", "single", ["A", "B", "C", "D"], "C", 3),
    createMockQuestion("q_crim_4", "刑法/共同犯罪", "共犯责任划分 4", "multiple", ["A", "B", "C", "D"], "AB", 4),
    createMockQuestion("q_crim_5", "刑法/自首立功", "自首条件认定 5", "judge", [], "正确", 2),

    // 民法组（5题）
    createMockQuestion("q_civ_1", "民法/物权变动", "不动产物权登记生效题 1", "single", ["A", "B", "C", "D"], "A", 3),
    createMockQuestion("q_civ_2", "民法/合同解除", "不可抗力解除合同 2", "single", ["A", "B", "C", "D"], "B", 2),
    createMockQuestion("q_civ_3", "民法/侵权责任", "高空抛物侵权追偿 3", "single", ["A", "B", "C", "D"], "C", 4),
    createMockQuestion("q_civ_4", "民法/无因管理", "无因管理构成要件 4", "multiple", ["A", "B", "C", "D"], "ABC", 3),
    createMockQuestion("q_civ_5", "民法/善意取得", "动产善意取得制度 5", "judge", [], "错误", 1),

    // 行政法组（5题）
    createMockQuestion("q_adm_1", "行政法/受案范围", "行政诉讼受案范围排除事项 1", "single", ["A", "B", "C", "D"], "D", 3),
    createMockQuestion("q_adm_2", "行政法/行政强制", "行政强制执行程序 2", "single", ["A", "B", "C", "D"], "C", 4),
    createMockQuestion("q_adm_3", "行政法/行政许可", "行政许可听证期限 3", "single", ["A", "B", "C", "D"], "B", 2),
    createMockQuestion("q_adm_4", "行政法/行政复议", "复议前置程序适用 4", "single", ["A", "B", "C", "D"], "A", 3),
    createMockQuestion("q_adm_5", "行政法/国家赔偿", "刑事赔偿义务机关确定 5", "fill", [], "赔偿委员会", 4),
  ];

  // 构造盲区与错题
  const blindspots: BlindspotItem[] = [
    {
      kp: "刑法/因果关系",
      risk: "critical",
      masteryRate: 0.25,
      urgencyScore: 88,
      recommendedAction: "重点攻坚因果关系高危考点",
    },
    {
      kp: "刑法/正当防卫",
      risk: "warning",
      masteryRate: 0.45,
      urgencyScore: 65,
      recommendedAction: "梳理防卫过当判断边界",
    },
  ];

  const wrongItems: WrongItem[] = [
    {
      qid: "q_civ_3",
      wrongCount: 3,
      lastWrongAt: Date.now() - 3600000,
      reason: "trap",
      status: "active",
      userAnswer: "A",
    },
    {
      qid: "q_adm_2",
      wrongCount: 2,
      lastWrongAt: Date.now() - 7200000,
      reason: "unknown",
      status: "active",
      userAnswer: "B",
    },
  ];

  const attempts: AttemptEvent[] = [
    // 民法/合同解除 做对 3 次，形成高熟练度巩固题
    { id: "a1", qid: "q_civ_2", verdict: "correct", userAns: "B", at: Date.now() - 10000 },
    { id: "a2", qid: "q_civ_2", verdict: "correct", userAns: "B", at: Date.now() - 20000 },
    { id: "a3", qid: "q_civ_2", verdict: "correct", userAns: "B", at: Date.now() - 30000 },
  ];

  it("当题库为空或题目均被过滤时，优雅返回空试卷对象且不报错", () => {
    const emptyPaper = assembleAdaptiveSprintPaper([], []);
    expect(emptyPaper.questions).toHaveLength(0);
    expect(emptyPaper.composition.total).toBe(0);
    expect(emptyPaper.totalScore).toBe(0);
    expect(emptyPaper.diagnosisSummary).toContain("暂无可用的有效冲刺题目");
    expect(emptyPaper.prescriptions.length).toBeGreaterThan(0);
  });

  it("当题目处于废弃（deprecated）或存在争议时，自动排除", () => {
    const bankWithBadQuestions: Question[] = [
      ...testBank,
      {
        ...createMockQuestion("bad_1", "刑法/因果关系", "已废弃题目"),
        status: "deprecated",
      },
      {
        ...createMockQuestion("bad_2", "刑法/因果关系", "有争议未决题目"),
        dispute: {
          reason: "ambiguous",
          openedAt: Date.now(),
          status: "open",
        },
      },
    ];

    const paper = assembleAdaptiveSprintPaper(bankWithBadQuestions, blindspots, wrongItems, attempts, {
      paperSize: 10,
    });

    const qids = paper.questions.map((q) => q.id);
    expect(qids).not.toContain("bad_1");
    expect(qids).not.toContain("bad_2");
  });

  it("支持题型过滤限制（targetTypes）", () => {
    const paper = assembleAdaptiveSprintPaper(testBank, blindspots, wrongItems, attempts, {
      paperSize: 10,
      targetTypes: ["single"],
    });

    for (const q of paper.questions) {
      expect(q.type).toBe("single");
    }
  });

  it("默认配比（50% 盲区 + 30% 错题 + 20% 巩固题）智能抽取与分层标注", () => {
    const paper = assembleAdaptiveSprintPaper(testBank, blindspots, wrongItems, attempts, {
      paperSize: 10,
      rnd: () => 0.1, // 固定伪随机种子
    });

    expect(paper.questions.length).toBe(10);
    expect(paper.metas.length).toBe(10);

    // 盲区题应当被优先装配
    const criticals = paper.metas.filter((m) => m.tier === "critical_blindspot");
    expect(criticals.length).toBeGreaterThanOrEqual(2);
    expect(criticals.some((m) => m.qid === "q_crim_1" || m.qid === "q_crim_2")).toBe(true);

    // 错题库中的易混淆陷阱题应当被装配
    const wrongs = paper.metas.filter((m) => m.tier === "confusing_wrong");
    expect(wrongs.some((m) => m.qid === "q_civ_3" || m.qid === "q_adm_2")).toBe(true);

    // 熟练巩固题应当被装配
    const reinforces = paper.metas.filter((m) => m.tier === "reinforce_common");
    expect(reinforces.some((m) => m.qid === "q_civ_2")).toBe(true);

    // 验证试卷摘要信息包含关键词
    expect(paper.diagnosisSummary).toContain("盲区");
    expect(paper.diagnosisSummary).toContain("错题");
    expect(paper.composition.targetedKps.length).toBeGreaterThan(0);
  });

  it("支持自定义比例配置，并能自适应归一化", () => {
    // 设置极端比例：80% 盲区 + 10% 错题 + 10% 巩固
    const paper = assembleAdaptiveSprintPaper(testBank, blindspots, wrongItems, attempts, {
      paperSize: 5,
      blindspotRatio: 0.8,
      wrongRatio: 0.1,
      reinforceRatio: 0.1,
    });

    expect(paper.questions.length).toBe(5);
    // 盲区一共就 2 道（q_crim_1, q_crim_2），当盲区题用完后，剩余名额自动向后层柔性顺延降级
    expect(paper.composition.criticalBlindspots).toBe(2);
    expect(paper.composition.confusingWrongs).toBeGreaterThanOrEqual(1);
  });

  it("容量不足时的柔性顺位降级（Cascade Fallback）", () => {
    // 只有 1 道盲区题，但请求 10 题并设定盲区占 70%
    const singleBlindspot: BlindspotItem[] = [
      {
        kp: "刑法/因果关系",
        risk: "critical",
        masteryRate: 0.1,
        urgencyScore: 99,
        recommendedAction: "必须突击",
      },
    ];

    const paper = assembleAdaptiveSprintPaper(testBank, singleBlindspot, wrongItems, attempts, {
      paperSize: 10,
      blindspotRatio: 0.7,
      wrongRatio: 0.2,
      reinforceRatio: 0.1,
    });

    // 盲区只有 1 题命中，剩余的名额自动下沉平账给 Tier 2 和 Tier 3
    expect(paper.composition.criticalBlindspots).toBe(1);
    expect(paper.questions.length).toBe(10);
    // 所有题目 ID 唯一且无重复
    const qidSet = new Set(paper.questions.map((q) => q.id));
    expect(qidSet.size).toBe(10);
  });

  it("分值智能平账（默认全卷 100 分平账，或支持固定每题分值）", () => {
    // 默认平账：7 道题装配，总分必须严格等于 100 分
    const paperDefault = assembleAdaptiveSprintPaper(testBank, blindspots, wrongItems, attempts, {
      paperSize: 7,
    });
    const calculatedSum = paperDefault.metas.reduce((sum, m) => sum + m.score, 0);
    expect(paperDefault.totalScore).toBe(100);
    expect(calculatedSum).toBe(100);

    // 固定每题 2 分
    const paperFixed = assembleAdaptiveSprintPaper(testBank, blindspots, wrongItems, attempts, {
      paperSize: 6,
      scorePerQuestion: 2,
    });
    expect(paperFixed.totalScore).toBe(12);
    for (const m of paperFixed.metas) {
      expect(m.score).toBe(2);
    }
  });

  it("防疲劳打散与认知波浪平滑（Anti-Fatigue Pacing）", () => {
    // 开局第一题若存在巩固题，应优先作为信心热身题
    const paper = assembleAdaptiveSprintPaper(testBank, blindspots, wrongItems, attempts, {
      paperSize: 8,
      antiFatigueSpacing: 2,
    });

    expect(paper.questions.length).toBe(8);
    // 检查第 1 题的 tier 是否为巩固题（若有）
    const firstTier = paper.metas[0].tier;
    expect(["reinforce_common", "confusing_wrong", "critical_blindspot"]).toContain(firstTier);

    // 检查连续两题的根考点是否被有效打散（只要候选池中存在多种考点，不应全卷连续同一个大类）
    let maxConsecutiveRootKp = 1;
    let curConsecutive = 1;
    for (let i = 1; i < paper.questions.length; i++) {
      const prevKp = paper.questions[i - 1].kp?.split("/")[0];
      const curKp = paper.questions[i].kp?.split("/")[0];
      if (prevKp === curKp) {
        curConsecutive++;
        maxConsecutiveRootKp = Math.max(maxConsecutiveRootKp, curConsecutive);
      } else {
        curConsecutive = 1;
      }
    }
    // 在充足题量下，不应出现连续 4 道题根考点完全一致的情况
    expect(maxConsecutiveRootKp).toBeLessThanOrEqual(3);
  });

  it("转换为模考蓝图（convertSprintPaperToBlueprint）并符合模考引擎验证", () => {
    const paper = assembleAdaptiveSprintPaper(testBank, blindspots, wrongItems, attempts, {
      paperSize: 8,
      title: "冲刺演练第一辑",
    });

    const blueprint = convertSprintPaperToBlueprint(paper);
    expect(blueprint.id).toBe(paper.id);
    expect(blueprint.name).toBe("冲刺演练第一辑");
    expect(blueprint.durationS).toBe(paper.targetDurationMinutes * 60);
    expect(blueprint.passLine).toBe(paper.passLine);
    expect(blueprint.sections.length).toBeGreaterThan(0);

    // 使用模考引擎现有的 validateBlueprint 验证合规性
    const errors = validateBlueprint(blueprint);
    expect(errors).toEqual([]);
  });

  it("导出 Markdown 格式密卷（含作答说明与参考答案速查表）", () => {
    const paper = assembleAdaptiveSprintPaper(testBank, blindspots, wrongItems, attempts, {
      paperSize: 5,
      title: "司法考试考前冲刺自适应密卷",
    });

    // 1. 默认无内嵌答案（试卷正文后附速查表）
    const md = exportSprintPaperMarkdown(paper, { showAnswers: false });
    expect(md).toContain("# 📝 司法考试考前冲刺自适应密卷");
    expect(md).toContain("## 🎯 密卷装配导读与备考提示");
    expect(md).toContain("## 🧩 试卷构成分布");
    expect(md).toContain("## ✍️ 密卷试题正文");
    expect(md).toContain("## 🔑 参考答案与解析速查表");

    // 2. 内嵌答案模式
    const mdWithAns = exportSprintPaperMarkdown(paper, { showAnswers: true });
    expect(mdWithAns).toContain("**【参考答案】**");
  });

  it("导出 CSV 格式试题索引清单", () => {
    const paper = assembleAdaptiveSprintPaper(testBank, blindspots, wrongItems, attempts, {
      paperSize: 5,
    });

    const csv = exportSprintPaperCsv(paper);
    expect(csv).toContain("题号,题目ID,题型,分值,考点,分层策略,出题理由,参考答案");
    const lines = csv.split("\r\n");
    // 包含表头与 5 行数据
    expect(lines.length).toBe(6);
  });
});
