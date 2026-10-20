import { describe, it, expect } from "vitest";
import type { Question } from "../src/core/types";
import {
  createPaperSnapshot,
  verifyPaperIntegrity,
  detectPaperDrift,
  exportPaperMarkdown,
  exportAnswerKeyMarkdown,
  paperSnapshotToQuestions,
  computePaperFingerprint,
} from "../src/core/paperSnapshot";
import { assemble, type Blueprint } from "../src/core/mock";
import { questionHash } from "../src/core/answer";

const mockBlueprint: Blueprint = {
  id: "bp-test-1",
  name: "2026年行政职业能力测验模拟卷",
  durationS: 7200, // 120 分钟
  passLine: 60,
  shuffleOptions: false,
  sectionTimed: false,
  sections: [
    {
      name: "常识判断",
      count: 2,
      scoreEach: 0.5,
      source: "mixed",
      types: ["single"],
      kp: "常识",
    },
    {
      name: "言语理解",
      count: 1,
      scoreEach: 1.0,
      source: "mixed",
      types: ["fill"],
    },
    {
      name: "申论主观",
      count: 1,
      scoreEach: 10.0,
      source: "mixed",
      types: ["short"],
    },
  ],
};

function createSampleQuestions(): Question[] {
  const q1: Question = {
    id: "q-101",
    type: "single",
    stem: "我国最高的权力机关是？",
    options: ["国务院", "全国人民代表大会", "最高人民法院", "国家监察委员会"],
    answer: "B",
    score: 0.5,
    analysis: "全国人民代表大会是我国最高国家权力机关。",
    kp: "常识/宪法",
    source: "2024真题",
    origin: "manual",
    hash: questionHash("我国最高的权力机关是？", ["国务院", "全国人民代表大会", "最高人民法院", "国家监察委员会"]),
  };

  const q2: Question = {
    id: "q-102",
    type: "single",
    stem: "太阳系中离太阳最近的行星是？",
    options: ["水星", "金星", "火星", "木星"],
    answer: "A",
    score: 0.5,
    analysis: "水星是太阳系八大行星中离太阳最近的行星。",
    kp: "常识/地理",
    origin: "manual",
    hash: questionHash("太阳系中离太阳最近的行星是？", ["水星", "金星", "火星", "木星"]),
  };

  const q3: Question = {
    id: "q-103",
    type: "fill",
    stem: "光合作用的产物主要是有机物和____。",
    options: [],
    answer: "氧气",
    score: 1.0,
    analysis: "光合作用吸收二氧化碳和水，在光照下释放氧气并生成有机物。",
    kp: "生物/植物生理",
    origin: "manual",
    hash: questionHash("光合作用的产物主要是有机物和____。", []),
    answerSpec: {
      v: 1,
      kind: "numeric",
      unit: "mol",
      absTol: 0.05,
    },
  };

  const q4: Question = {
    id: "q-104",
    type: "short",
    stem: "请简要阐述生态文明建设的重大意义。",
    options: [],
    answer: "促进人与自然和谐共生，推动经济社会全面绿色转型。",
    score: 10.0,
    analysis: "需要从生态安全、经济可持续发展、民生福祉等角度综合论述。",
    kp: "申论/生态文明",
    origin: "manual",
    hash: questionHash("请简要阐述生态文明建设的重大意义。", []),
    rubric: {
      v: 1,
      kind: "rubric",
      fullScore: 10,
      criteria: [
        {
          id: "cr-1",
          label: "人与自然和谐共生理念",
          weight: 4,
          example: "准确表达人与自然生命共同体",
          levels: [
            { key: "full", label: "满分", ratio: 1.0 },
            { key: "partial", label: "部分阐述", ratio: 0.5 },
            { key: "none", label: "未提及", ratio: 0 },
          ],
        },
        {
          id: "cr-2",
          label: "绿色发展转型路径",
          weight: 6,
          example: "论述产业生态化与生态产业化",
        },
      ],
    },
  };

  return [q1, q2, q3, q4];
}

describe("PaperSnapshot 试卷固化与离线导出引擎 (55-07 / 68-01)", () => {
  it("空题目数组拒绝创建快照并抛出明确错误", () => {
    expect(() =>
      createPaperSnapshot({
        title: "空卷",
        blueprint: mockBlueprint,
        paper: [],
        sectionOf: {},
        scoreOf: {},
      }),
    ).toThrow("无法创建空试卷快照");
  });

  it("正确创建不可变试卷快照并自洽绑定题目属性与全局指纹", () => {
    const questions = createSampleQuestions();
    const sectionOf = new Map<string, string>([
      ["q-101", "常识判断"],
      ["q-102", "常识判断"],
      ["q-103", "言语理解"],
      ["q-104", "申论主观"],
    ]);
    const scoreOf = new Map<string, number>([
      ["q-101", 0.5],
      ["q-102", 0.5],
      ["q-103", 1.0],
      ["q-104", 10.0],
    ]);

    const snapshot = createPaperSnapshot({
      title: "2026年全真模考 A 卷",
      blueprint: mockBlueprint,
      paper: questions,
      sectionOf,
      scoreOf,
    });

    expect(snapshot.title).toBe("2026年全真模考 A 卷");
    expect(snapshot.paperId.startsWith("paper-")).toBe(true);
    expect(snapshot.questionCount).toBe(4);
    expect(snapshot.totalScore).toBe(12);
    expect(snapshot.items.length).toBe(4);
    expect(snapshot.contentFingerprint).toBeDefined();
    expect(snapshot.contentFingerprint).toBe(computePaperFingerprint(snapshot.items));

    // 采分点深拷贝独立性断言
    const item4 = snapshot.items.find((it) => it.qid === "q-104");
    expect(item4?.rubric?.criteria.length).toBe(2);
    expect(item4?.rubric).not.toBe(questions[3].rubric); // 确保深拷贝

    // 自洽性校验通过
    const integrity = verifyPaperIntegrity(snapshot);
    expect(integrity.valid).toBe(true);
    expect(integrity.errors).toEqual([]);
  });

  it("当试卷条目被篡改时，verifyPaperIntegrity 准确检出错误", () => {
    const questions = createSampleQuestions();
    const snapshot = createPaperSnapshot({
      title: "原版试卷",
      blueprint: mockBlueprint,
      paper: questions,
      sectionOf: {
        "q-101": "常识判断",
        "q-102": "常识判断",
        "q-103": "言语理解",
        "q-104": "申论主观",
      },
      scoreOf: {
        "q-101": 0.5,
        "q-102": 0.5,
        "q-103": 1.0,
        "q-104": 10.0,
      },
    });

    // 篡改 1：标题清空
    const corrupted1 = { ...snapshot, title: "" };
    expect(verifyPaperIntegrity(corrupted1).valid).toBe(false);

    // 篡改 2：修改总分
    const corrupted2 = { ...snapshot, totalScore: 99.0 };
    const res2 = verifyPaperIntegrity(corrupted2);
    expect(res2.valid).toBe(false);
    expect(res2.errors.some((e) => e.includes("试卷总分不匹配"))).toBe(true);

    // 篡改 3：修改第一题题干而未更新题目 hash
    const corruptedItems = snapshot.items.map((it, idx) =>
      idx === 0 ? { ...it, stem: "被篡改的题干内容" } : { ...it },
    );
    const corrupted3 = { ...snapshot, items: corruptedItems };
    const res3 = verifyPaperIntegrity(corrupted3);
    expect(res3.valid).toBe(false);
    expect(res3.errors.some((e) => e.includes("题目指纹不匹配"))).toBe(true);

    // 篡改 4：题目篡改后即使更新了单题 hash，但未重算 contentFingerprint
    const updatedHashItems = snapshot.items.map((it, idx) =>
      idx === 0
        ? {
            ...it,
            stem: "被篡改的题干内容",
            hash: questionHash("被篡改的题干内容", it.options),
          }
        : { ...it },
    );
    const corrupted4 = { ...snapshot, items: updatedHashItems };
    const res4 = verifyPaperIntegrity(corrupted4);
    expect(res4.valid).toBe(false);
    expect(res4.errors.some((e) => e.includes("试卷全局内容指纹失效"))).toBe(true);
  });

  it("detectPaperDrift 能准确识别活动题库中被删除和被修改的题目 (55-07 / 57-06)", () => {
    const questions = createSampleQuestions();
    const snapshot = createPaperSnapshot({
      title: "待比对试卷",
      blueprint: mockBlueprint,
      paper: questions,
      sectionOf: {
        "q-101": "常识判断",
        "q-102": "常识判断",
        "q-103": "言语理解",
        "q-104": "申论主观",
      },
      scoreOf: {
        "q-101": 0.5,
        "q-102": 0.5,
        "q-103": 1.0,
        "q-104": 10.0,
      },
    });

    // 1. 完全一致
    const drift1 = detectPaperDrift(snapshot, questions);
    expect(drift1.matchingCount).toBe(4);
    expect(drift1.missingQids).toEqual([]);
    expect(drift1.driftedQids).toEqual([]);

    // 2. 题库中删除了 q-102，修改了 q-101 的答案（B -> A）
    const modifiedQuestions: Question[] = [
      { ...questions[0], answer: "A" }, // 改答案
      // q-102 被删除
      questions[2],
      questions[3],
    ];

    const drift2 = detectPaperDrift(snapshot, modifiedQuestions);
    expect(drift2.total).toBe(4);
    expect(drift2.matchingCount).toBe(2);
    expect(drift2.missingQids).toEqual(["q-102"]);
    expect(drift2.driftedQids).toEqual(["q-101"]);
  });

  describe("exportPaperMarkdown (纯享学生作答卷)", () => {
    it("导出规范排版的作答真题卷，且绝对不泄露隐藏答案与解析 (安全红线测试)", () => {
      const questions = createSampleQuestions();
      const snapshot = createPaperSnapshot({
        title: "2026年行政职业能力测验",
        blueprint: mockBlueprint,
        paper: questions,
        sectionOf: {
          "q-101": "常识判断",
          "q-102": "常识判断",
          "q-103": "言语理解",
          "q-104": "申论主观",
        },
        scoreOf: {
          "q-101": 0.5,
          "q-102": 0.5,
          "q-103": 1.0,
          "q-104": 10.0,
        },
      });

      const md = exportPaperMarkdown(snapshot, {
        note: "闭卷独立完成，禁止查阅资料",
        dateString: "2026-10-20",
      });

      // 卷头与元数据检查
      expect(md).toContain("# 2026年行政职业能力测验");
      expect(md).toContain("考试时长: 120 分钟");
      expect(md).toContain("满分: 12 分");
      expect(md).toContain("及格线: 60 分");
      expect(md).toContain("闭卷独立完成，禁止查阅资料");

      // 分段与题型标题
      expect(md).toContain("## 一、常识判断（共 2 题，满分 1 分）");
      expect(md).toContain("### 1. 【单选题】（0.5分）");
      expect(md).toContain("我国最高的权力机关是？");
      expect(md).toContain("- **A.** 国务院");
      expect(md).toContain("- **B.** 全国人民代表大会");

      // 填空题与简答题答题区预留
      expect(md).toContain("光合作用的产物主要是有机物和____。");
      expect(md).toContain("**作答填写**：____________________________________");
      expect(md).toContain("【答题区域】");

      // ====== 核心安全红线断言 ======
      // 绝不包含题目答案与解析
      expect(md).not.toContain("全国人民代表大会是我国最高国家权力机关");
      expect(md).not.toContain("水星是太阳系八大行星中离太阳最近的行星");
      expect(md).not.toContain("标准答案");
      expect(md).not.toContain("正确答案");
      expect(md).not.toContain("【试题解析】");
      expect(md).not.toContain("采分点");
    });

    it("支持共用材料题组，同组首道题打印材料卡片且不重复打印", () => {
      const qMat: Question = {
        id: "q-mat",
        type: "material",
        stem: "根据以下资料回答问题：2025年全国规模以上工业企业利润增长8.5%...",
        options: [],
        answer: "",
        score: 0,
        origin: "manual",
        group: "grp-eco",
        hash: questionHash("根据以下资料回答问题：2025年全国规模以上工业企业利润增长8.5%...", []),
      };
      const qSub1: Question = {
        id: "q-s1",
        type: "single",
        stem: "2025年工业企业利润总额同比：",
        options: ["增长8.5%", "下降8.5%", "持平", "不确定"],
        answer: "A",
        score: 1.0,
        origin: "manual",
        group: "grp-eco",
        hash: questionHash("2025年工业企业利润总额同比：", ["增长8.5%", "下降8.5%", "持平", "不确定"]),
      };
      const qSub2: Question = {
        id: "q-s2",
        type: "single",
        stem: "以下说法符合材料的是：",
        options: ["增长为负", "稳步提升", "未统计", "数据缺失"],
        answer: "B",
        score: 1.0,
        origin: "manual",
        group: "grp-eco",
        hash: questionHash("以下说法符合材料的是：", ["增长为负", "稳步提升", "未统计", "数据缺失"]),
      };

      const bp: Blueprint = {
        ...mockBlueprint,
        sections: [{ name: "资料分析", count: 2, scoreEach: 1.0, source: "mixed", types: ["single"] }],
      };

      const snapshot = createPaperSnapshot({
        title: "资料分析专卷",
        blueprint: bp,
        paper: [qMat, qSub1, qSub2],
        sectionOf: {
          "q-mat": "资料分析",
          "q-s1": "资料分析",
          "q-s2": "资料分析",
        },
        scoreOf: {
          "q-mat": 0,
          "q-s1": 1.0,
          "q-s2": 1.0,
        },
      });

      const md = exportPaperMarkdown(snapshot);
      // 材料卡片存在
      expect(md).toContain("【资料材料】");
      expect(md).toContain("2025年全国规模以上工业企业利润增长8.5%");
      // 材料卡片在整篇文档中只出现一次（不重复打印）
      const count = (md.match(/【资料材料】/g) || []).length;
      expect(count).toBe(1);
    });
  });

  describe("exportAnswerKeyMarkdown (详解版答案册)", () => {
    it("导出包含标准答案、解析、考点、数值容差和采分点表格的答案手册", () => {
      const questions = createSampleQuestions();
      const snapshot = createPaperSnapshot({
        title: "2026年行政职业能力测验",
        blueprint: mockBlueprint,
        paper: questions,
        sectionOf: {
          "q-101": "常识判断",
          "q-102": "常识判断",
          "q-103": "言语理解",
          "q-104": "申论主观",
        },
        scoreOf: {
          "q-101": 0.5,
          "q-102": 0.5,
          "q-103": 1.0,
          "q-104": 10.0,
        },
      });

      const md = exportAnswerKeyMarkdown(snapshot, {
        note: "主观题按采分要点分步计分，逻辑自洽可得满分",
      });

      // 卷头
      expect(md).toContain("# 2026年行政职业能力测验 · 标准答案与评分细则");
      expect(md).toContain("对应试卷编号: `" + snapshot.paperId + "`");
      expect(md).toContain("主观题按采分要点分步计分，逻辑自洽可得满分");

      // 客观题解析与答案
      expect(md).toContain("- **标准答案**：`B`");
      expect(md).toContain("- **考核考点**：`常识/宪法`");
      expect(md).toContain("- **试题出处**：2024真题");
      expect(md).toContain("全国人民代表大会是我国最高国家权力机关。");

      // 数值题容差规则
      expect(md).toContain("数值容差规则");
      expect(md).toContain("单位: `mol`");
      expect(md).toContain("绝对容差: ±0.05");

      // 主观题采分点表格
      expect(md).toContain("【采分点自评细则】");
      expect(md).toContain("满分 10 分");
      expect(md).toContain("| 采分要点 | 权重 | 判定参考 | 评分等级 |");
      expect(md).toContain("人与自然和谐共生理念 | 4 | 准确表达人与自然生命共同体 | 满分(100%)/部分阐述(50%)/未提及(0%) |");
      expect(md).toContain("绿色发展转型路径 | 6 | 论述产业生态化与生态产业化 | 满分/零分 |");
    });
  });

  describe("paperSnapshotToQuestions (还原题目数组)", () => {
    it("从快照中完整无损地还原 Question 实体，可供离线直接开卷", () => {
      const original = createSampleQuestions();
      const snapshot = createPaperSnapshot({
        title: "还原测试卷",
        blueprint: mockBlueprint,
        paper: original,
        sectionOf: {
          "q-101": "常识判断",
          "q-102": "常识判断",
          "q-103": "言语理解",
          "q-104": "申论主观",
        },
        scoreOf: {
          "q-101": 0.5,
          "q-102": 0.5,
          "q-103": 1.0,
          "q-104": 10.0,
        },
      });

      const restored = paperSnapshotToQuestions(snapshot);
      expect(restored.length).toBe(original.length);

      for (let i = 0; i < restored.length; i++) {
        expect(restored[i].id).toBe(original[i].id);
        expect(restored[i].stem).toBe(original[i].stem);
        expect(restored[i].answer).toBe(original[i].answer);
        expect(restored[i].score).toBe(original[i].score);
        expect(restored[i].hash).toBe(original[i].hash);
      }

      // 验证还原后的题目能够直接送入 assemble 组卷引擎
      const assembled = assemble(mockBlueprint, restored, () => 0);
      expect(assembled.paper.length).toBeGreaterThan(0);
    });
  });
});
