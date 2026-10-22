// ============================================================
// 试卷固化与离线导出引擎（55-07 / 68-01）
// 纯函数领域层：组卷结果不可变快照固化、卷面完整性校验、
// 题面漂移检出、纯享打印题卷与配套详解答案册 Markdown 生成。
// 规则：严格无外部宿主依赖（禁 import "siyuan"），严禁 any 强转。
// ============================================================

import type { Question, QuestionType } from "./types";
import { SCHEMA_VERSION } from "./types";
import { questionHash, sha1like } from "./answer";
import type { Blueprint } from "./mock";
import type { ScoringPolicy } from "./scoringPolicy";
import { newPaperId } from "./ids";

/** 固化试卷题目条目：记录开考/组卷瞬间该题的全部题面与判分元数据 */
export interface PaperQuestionItem {
  qid: string;
  section: string;
  score: number;
  type: QuestionType;
  stem: string;
  options: string[];
  answer: string;
  analysis?: string;
  kp?: string;
  difficulty?: number;
  source?: string;
  sourceKind?: "real" | "mock";
  year?: string;
  group?: string;
  hash: string;
  rubric?: Question["rubric"];
  answerSpec?: Question["answerSpec"];
}

/** 55-07 固化试卷不可变快照模型 */
export interface PaperSnapshot {
  v: number;
  paperId: string;
  title: string;
  createdAt: number;
  blueprint: Blueprint;
  scoringPolicy?: ScoringPolicy;
  totalScore: number;
  questionCount: number;
  items: PaperQuestionItem[];
  /** 试卷全局不可变指纹：由全部题目的 qid、hash、section、score 与 answer 拼接哈希生成 */
  contentFingerprint: string;
}

export interface PaperIntegrityResult {
  valid: boolean;
  errors: string[];
}

export interface PaperDriftResult {
  total: number;
  matchingCount: number;
  driftedQids: string[];
  missingQids: string[];
}

export interface ExportPaperOptions {
  showScores?: boolean;
  dateString?: string;
  note?: string;
}

export interface ExportAnswerKeyOptions {
  dateString?: string;
  note?: string;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  single: "单选题",
  multiple: "多选题",
  judge: "判断题",
  fill: "填空题",
  short: "简答题",
  material: "材料题",
};

/** 计算试卷条目数组的不可变全局内容指纹 */
export function computePaperFingerprint(items: readonly PaperQuestionItem[]): string {
  const line = items
    .map((it) => `${it.qid}:${it.hash}:${it.section}:${it.score}:${it.answer}`)
    .join("|");
  return sha1like(line);
}

/** 创建试卷不可变快照（55-07） */
export function createPaperSnapshot(options: {
  paperId?: string;
  title: string;
  blueprint: Blueprint;
  paper: readonly Question[];
  sectionOf: Map<string, string> | Record<string, string>;
  scoreOf: Map<string, number> | Record<string, number>;
  scoringPolicy?: ScoringPolicy;
  createdAt?: number;
}): PaperSnapshot {
  const { title, blueprint, paper, scoringPolicy } = options;
  if (!paper.length) {
    throw new Error("[lv-exam] 无法创建空试卷快照：题目列表为空");
  }

  const paperId = options.paperId ?? newPaperId();
  const createdAt = options.createdAt ?? Date.now();

  const getSection = (qid: string): string => {
    if (options.sectionOf instanceof Map) {
      return options.sectionOf.get(qid) ?? "默认分段";
    }
    return options.sectionOf[qid] ?? "默认分段";
  };

  const getScore = (qid: string): number => {
    if (options.scoreOf instanceof Map) {
      return options.scoreOf.get(qid) ?? 1;
    }
    return options.scoreOf[qid] ?? 1;
  };

  const items: PaperQuestionItem[] = paper.map((q) => {
    const section = getSection(q.id);
    const score = getScore(q.id);
    const computedHash = q.hash || questionHash(q.stem, q.options);

    const item: PaperQuestionItem = {
      qid: q.id,
      section,
      score,
      type: q.type,
      stem: q.stem,
      options: [...q.options],
      answer: q.answer,
      hash: computedHash,
    };

    if (q.analysis !== undefined) item.analysis = q.analysis;
    if (q.kp !== undefined) item.kp = q.kp;
    if (q.difficulty !== undefined) item.difficulty = q.difficulty;
    if (q.source !== undefined) item.source = q.source;
    if (q.sourceKind !== undefined) item.sourceKind = q.sourceKind;
    if (q.year !== undefined) item.year = q.year;
    if (q.group !== undefined) item.group = q.group;
    if (q.rubric !== undefined) item.rubric = JSON.parse(JSON.stringify(q.rubric)) as Question["rubric"];
    if (q.answerSpec !== undefined) item.answerSpec = JSON.parse(JSON.stringify(q.answerSpec)) as Question["answerSpec"];

    return item;
  });

  const totalScore = Math.round(items.reduce((sum, it) => sum + it.score, 0) * 100) / 100;
  const contentFingerprint = computePaperFingerprint(items);

  return {
    v: SCHEMA_VERSION,
    paperId,
    title,
    createdAt,
    blueprint: JSON.parse(JSON.stringify(blueprint)) as Blueprint,
    scoringPolicy: scoringPolicy ? (JSON.parse(JSON.stringify(scoringPolicy)) as ScoringPolicy) : blueprint.scoringPolicy,
    totalScore,
    questionCount: items.length,
    items,
    contentFingerprint,
  };
}

/** 校验固化试卷内部完整性与自洽性 */
export function verifyPaperIntegrity(snapshot: PaperSnapshot): PaperIntegrityResult {
  const errors: string[] = [];

  if (!snapshot.paperId || !snapshot.paperId.trim()) {
    errors.push("试卷缺失 paperId 唯一标识");
  }
  if (!snapshot.title || !snapshot.title.trim()) {
    errors.push("试卷标题不能为空");
  }
  if (!Array.isArray(snapshot.items) || snapshot.items.length === 0) {
    errors.push("试卷未包含任何题目条目");
    return { valid: false, errors };
  }
  if (snapshot.items.length !== snapshot.questionCount) {
    errors.push(`题目总数不一致：宣称 ${snapshot.questionCount} 题，实际包含 ${snapshot.items.length} 题`);
  }

  const calculatedTotal = Math.round(snapshot.items.reduce((acc, it) => acc + (it.score || 0), 0) * 100) / 100;
  if (Math.abs(calculatedTotal - snapshot.totalScore) > 0.001) {
    errors.push(`试卷总分不匹配：记录总分 ${snapshot.totalScore} 分，条目累计 ${calculatedTotal} 分`);
  }

  for (let i = 0; i < snapshot.items.length; i++) {
    const item = snapshot.items[i];
    const expectedHash = questionHash(item.stem, item.options);
    if (item.hash !== expectedHash) {
      errors.push(`第 ${i + 1} 题 (ID: ${item.qid}) 题目指纹不匹配，题面可能在快照外部被篡改`);
    }
  }

  const expectedFingerprint = computePaperFingerprint(snapshot.items);
  if (snapshot.contentFingerprint !== expectedFingerprint) {
    errors.push("试卷全局内容指纹失效，试卷完整性受损");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/** 比较活动题库与固化试卷，检测题目是否已在题库中被修改或删除（55-07 / 57-06） */
export function detectPaperDrift(
  snapshot: PaperSnapshot,
  liveQuestions: readonly Question[],
): PaperDriftResult {
  const byId = new Map(liveQuestions.map((q) => [q.id, q]));
  const missingQids: string[] = [];
  const driftedQids: string[] = [];
  let matchingCount = 0;

  for (const item of snapshot.items) {
    const live = byId.get(item.qid);
    if (!live) {
      missingQids.push(item.qid);
    } else {
      const liveHash = live.hash || questionHash(live.stem, live.options);
      if (liveHash !== item.hash || live.answer !== item.answer) {
        driftedQids.push(item.qid);
      } else {
        matchingCount++;
      }
    }
  }

  return {
    total: snapshot.items.length,
    matchingCount,
    driftedQids,
    missingQids,
  };
}

/** 导出纯净打印版/学生作答真题卷 Markdown（红线约束：绝不泄露答案与解析） */
export function exportPaperMarkdown(
  snapshot: PaperSnapshot,
  options: ExportPaperOptions = {},
): string {
  const showScores = options.showScores !== false;
  const dateStr = options.dateString ?? new Date(snapshot.createdAt).toLocaleDateString("zh-CN");
  const durationMin = Math.round(snapshot.blueprint.durationS / 60);

  const lines: string[] = [];

  // 1. 卷头
  lines.push(`# ${snapshot.title}`);
  lines.push("");
  lines.push(`> 📋 **全真模考卷** · 考试时长: ${durationMin} 分钟 · 满分: ${snapshot.totalScore} 分 · 及格线: ${snapshot.blueprint.passLine} 分 · 共 ${snapshot.questionCount} 题`);
  if (options.note) {
    lines.push(`> 📝 备考要求: ${options.note}`);
  }
  lines.push(`> 📅 生成日期: ${dateStr} · 试卷编号: \`${snapshot.paperId}\``);
  lines.push("");
  lines.push("---");
  lines.push("");

  // 2. 按分段组织
  const sectionMap = new Map<string, PaperQuestionItem[]>();
  for (const item of snapshot.items) {
    const secList = sectionMap.get(item.section) ?? [];
    secList.push(item);
    sectionMap.set(item.section, secList);
  }

  const romanNumerals = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  let secIndex = 0;
  let questionNumber = 1;
  const printedGroups = new Set<string>();

  for (const [secName, secItems] of sectionMap) {
    const secScore = Math.round(secItems.reduce((acc, it) => acc + it.score, 0) * 100) / 100;
    const numeral = romanNumerals[secIndex] ?? String(secIndex + 1);
    secIndex++;

    lines.push(`## ${numeral}、${secName}（共 ${secItems.length} 题${showScores ? `，满分 ${secScore} 分` : ""}）`);
    lines.push("");

    for (const item of secItems) {
      // 共用材料组展示（同组首道题打印材料卡片，后续子题不重复打印材料）
      if (item.group && !printedGroups.has(item.group)) {
        // 查找组内是否有专门的材料题（material）或者用当前题的说明
        const carrier = secItems.find((it) => it.group === item.group && it.type === "material" && it.stem);
        const materialText = carrier?.stem ?? "";
        if (materialText) {
          lines.push(`> 📜 **【资料材料】**`);
          lines.push(`> ${materialText.split("\n").join("\n> ")}`);
          lines.push("");
        }
        printedGroups.add(item.group);
      }

      // 材料题本身无需作为独立题目作答时跳过
      if (item.type === "material") {
        continue;
      }

      const typeLabel = TYPE_LABELS[item.type] ?? item.type;
      const scoreTag = showScores ? `（${item.score}分）` : "";
      lines.push(`### ${questionNumber}. 【${typeLabel}】${scoreTag}`);
      lines.push("");
      lines.push(item.stem);
      lines.push("");

      // 选项展示
      if (item.options.length > 0) {
        for (let oi = 0; oi < item.options.length; oi++) {
          const letter = String.fromCharCode(65 + oi);
          lines.push(`- **${letter}.** ${item.options[oi]}`);
        }
        lines.push("");
      }

      // 答题预留区（填空题 / 简答题）
      if (item.type === "fill") {
        if (item.answerSpec?.kind === "multiBlank") {
          const blanks = item.answerSpec.blanks.map((_, bi) => `（${bi + 1}）________________`).join("  ");
          lines.push(`**作答填写**：${blanks}`);
        } else {
          lines.push(`**作答填写**：____________________________________`);
        }
        lines.push("");
      } else if (item.type === "short") {
        lines.push(`> ✍️ **【答题区域】**`);
        lines.push(`> `);
        lines.push(`> `);
        lines.push("");
      }

      questionNumber++;
    }
  }

  return lines.join("\n");
}

/** 导出配套详解版答案册与评分细则 Markdown（包含标准答案、解析、采分点与容差规则） */
export function exportAnswerKeyMarkdown(
  snapshot: PaperSnapshot,
  options: ExportAnswerKeyOptions = {},
): string {
  const dateStr = options.dateString ?? new Date(snapshot.createdAt).toLocaleDateString("zh-CN");
  const lines: string[] = [];

  // 1. 卷头
  lines.push(`# ${snapshot.title} · 标准答案与评分细则`);
  lines.push("");
  lines.push(`> 📖 **配套解析手册** · 对应试卷编号: \`${snapshot.paperId}\` · 满分: ${snapshot.totalScore} 分 · 共 ${snapshot.questionCount} 题`);
  if (options.note) {
    lines.push(`> 💡 评分说明: ${options.note}`);
  }
  lines.push(`> 📅 核定日期: ${dateStr}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  let questionNumber = 1;

  for (let i = 0; i < snapshot.items.length; i++) {
    const item = snapshot.items[i];
    if (item.type === "material") continue;

    const typeLabel = TYPE_LABELS[item.type] ?? item.type;
    lines.push(`### ${questionNumber}. 【${typeLabel}】${item.section}（${item.score} 分）`);
    lines.push("");
    lines.push(`- **标准答案**：\`${item.answer}\``);
    if (item.kp) {
      lines.push(`- **考核考点**：\`${item.kp}\``);
    }
    if (item.source) {
      lines.push(`- **试题出处**：${item.source}`);
    }

    // 结构化答案规则（数值容差、单位换算、多空）
    if (item.answerSpec) {
      if (item.answerSpec.kind === "numeric") {
        const spec = item.answerSpec;
        const tolInfo: string[] = [];
        if (spec.unit) tolInfo.push(`单位: \`${spec.unit}\``);
        if (spec.absTol !== undefined) tolInfo.push(`绝对容差: ±${spec.absTol}`);
        if (spec.relTolerance !== undefined) tolInfo.push(`相对容差: ±${Math.round(spec.relTolerance * 100)}%`);
        if (spec.altUnits?.length) {
          tolInfo.push(`等价单位: ${spec.altUnits.map((u) => `${u.unit}(×${u.factor})`).join("、")}`);
        }
        lines.push(`- **数值容差规则**：${tolInfo.join(" · ")}`);
      } else if (item.answerSpec.kind === "multiBlank") {
        const blankRules = item.answerSpec.blanks
          .map((b, bi) => `空${bi + 1}: [${b.answers.join(" / ")}]`)
          .join("；");
        lines.push(`- **多空答案规则**：${blankRules}`);
      }
    }

    // 题目完整解析
    if (item.analysis && item.analysis.trim()) {
      lines.push("");
      lines.push(`> 💡 **【试题解析】**`);
      lines.push(`> ${item.analysis.split("\n").join("\n> ")}`);
    }

    // 55-05 主观采分点（rubric）表格
    if (item.rubric && item.rubric.criteria.length > 0) {
      lines.push("");
      lines.push(`> 🎯 **【采分点自评细则】**（满分 ${item.rubric.fullScore} 分）`);
      lines.push(`> `);
      lines.push(`> | 采分要点 | 权重 | 判定参考 | 评分等级 |`);
      lines.push(`> | :--- | :--- | :--- | :--- |`);
      for (const cr of item.rubric.criteria) {
        const example = cr.example ? cr.example.replace(/\|/g, "\\|") : "—";
        const levels = cr.levels?.map((l) => `${l.label}(${Math.round(l.ratio * 100)}%)`).join("/") ?? "满分/零分";
        lines.push(`> | ${cr.label} | ${cr.weight} | ${example} | ${levels} |`);
      }
    }

    lines.push("");
    lines.push("---");
    lines.push("");
    questionNumber++;
  }

  return lines.join("\n");
}

/** 将固化试卷还原为完整的领域 Question 数组（供断网离线、题目被删等场景重现开考） */
export function paperSnapshotToQuestions(snapshot: PaperSnapshot): Question[] {
  return snapshot.items.map((item) => {
    const q: Question = {
      id: item.qid,
      type: item.type,
      stem: item.stem,
      options: [...item.options],
      answer: item.answer,
      score: item.score,
      hash: item.hash,
      origin: "manual",
    };

    if (item.analysis !== undefined) q.analysis = item.analysis;
    if (item.kp !== undefined) q.kp = item.kp;
    if (item.difficulty !== undefined) q.difficulty = item.difficulty;
    if (item.source !== undefined) q.source = item.source;
    if (item.sourceKind !== undefined) q.sourceKind = item.sourceKind;
    if (item.year !== undefined) q.year = item.year;
    if (item.group !== undefined) q.group = item.group;
    if (item.rubric !== undefined) q.rubric = JSON.parse(JSON.stringify(item.rubric)) as Question["rubric"];
    if (item.answerSpec !== undefined) q.answerSpec = JSON.parse(JSON.stringify(item.answerSpec)) as Question["answerSpec"];

    return q;
  });
}

export interface ABExamPaperResult {
  paperA: Question[];
  paperB: Question[];
  answerKeyA: Record<string, string>;
  answerKeyB: Record<string, string>;
  diffSummary: string;
}

/**
 * 考场防抄袭：同一套试题一键分化为全真 A 卷与 B 卷
 * A 卷：原始题序与标准选项
 * B 卷：单选题/多选题选项洗牌打乱，并自动重写对应正确答案字母
 */
export function generateABExamPapers(
  questions: readonly Question[],
  options: { rnd?: () => number } = {},
): ABExamPaperResult {
  const rnd = options.rnd ?? Math.random;

  const paperA: Question[] = JSON.parse(JSON.stringify(questions)) as Question[];
  const paperB: Question[] = [];
  const answerKeyA: Record<string, string> = {};
  const answerKeyB: Record<string, string> = {};

  let shuffledCount = 0;

  for (const q of paperA) {
    answerKeyA[q.id] = q.answer;

    if ((q.type === "single" || q.type === "multiple") && q.options.length >= 2) {
      const indexed = q.options.map((text, idx) => ({
        letter: String.fromCharCode(65 + idx),
        text,
      }));

      // Fisher-Yates 洗牌
      const shuffled = [...indexed];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      const newOptions = shuffled.map((it) => it.text);
      const oldAnsLetters = (q.answer ?? "").toUpperCase().split("");
      const newAnsLetters: string[] = [];

      for (let newIdx = 0; newIdx < shuffled.length; newIdx++) {
        const origLetter = shuffled[newIdx].letter;
        if (oldAnsLetters.includes(origLetter)) {
          newAnsLetters.push(String.fromCharCode(65 + newIdx));
        }
      }

      const newAnswer = newAnsLetters.sort().join("");
      answerKeyB[q.id] = newAnswer;

      paperB.push({
        ...JSON.parse(JSON.stringify(q)),
        options: newOptions,
        answer: newAnswer,
      });
      shuffledCount++;
    } else {
      answerKeyB[q.id] = q.answer;
      paperB.push(JSON.parse(JSON.stringify(q)));
    }
  }

  const diffSummary = `成功生成考场 A/B 卷：全卷共 ${questions.length} 题，其中 ${shuffledCount} 道客观选择题已完成选项乱序洗牌与答案重映射。`;

  return {
    paperA,
    paperB,
    answerKeyA,
    answerKeyB,
    diffSummary,
  };
}
