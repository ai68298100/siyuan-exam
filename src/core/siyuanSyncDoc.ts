/**
 * 题库与组卷同步至思源笔记原生文档引擎 (SiYuan Native Doc Generator)
 * 职责：
 * 1. 将题库、全真模考卷或错题攻坚卷排版格式化为思源笔记标准原生文档内容；
 * 2. 答案与解析采用思源可交互折叠块（<details>）包裹，方便在思源中自测翻看，绝不默认透题；
 * 3. 题目挂载 custom-exam-id、custom-exam-type 块属性，支持卸载后永久阅读，重装后无损读回；
 * 4. 纯函数领域层，支持无头测试。
 */

import type { Question } from "./types";

export interface SiyuanDocExportOptions {
  subtitle?: string;
  isMockPaper?: boolean;
  durationMinutes?: number;
  passLine?: number;
  includeAttrs?: boolean;
}

const TYPE_CN_MAP: Record<string, string> = {
  single: "单项选择题",
  multiple: "多项选择题",
  judge: "判断是非题",
  fill: "填空题",
  short: "简答论述题",
  material: "材料题",
};

/**
 * 将题目列表格式化为思源笔记原生文档 Markdown
 */
export function buildSiyuanExamDocMarkdown(
  title: string,
  questions: readonly Question[],
  options: SiyuanDocExportOptions = {},
): string {
  const lines: string[] = [];
  lines.push(`# 📚 ${title}`);

  const totalScore = questions.reduce((sum, q) => sum + (q.score || 1), 0);
  const durationText = options.durationMinutes ? ` | ⏱️ 建议限时：**${options.durationMinutes} 分钟**` : "";
  const passText = options.passLine ? ` | 及格线：**${options.passLine}%**` : "";

  lines.push(`> 卷面总分：**${totalScore} 分** | 题量：**${questions.length} 题**${durationText}${passText}`);
  lines.push(`> 📝 提示：本试卷已同步至思源笔记文档。答案与解析默认折叠，可直接在思源中展开自测；即使卸载插件，所有试题与笔记依然永久完整保留。\n`);

  let currentType = "";
  let typeSectionIndex = 1;
  const cnNums = ["一", "二", "三", "四", "五", "六", "七", "八"];

  questions.forEach((q, idx) => {
    // 题型分段大标题
    if (q.type !== currentType) {
      currentType = q.type;
      const typeLabel = TYPE_CN_MAP[q.type] || q.type;
      const secNo = cnNums[typeSectionIndex - 1] || `${typeSectionIndex}`;
      typeSectionIndex++;
      lines.push(`\n## ${secNo}、${typeLabel}\n`);
    }

    const no = idx + 1;
    const scoreText = q.score ? `（${q.score} 分）` : "";
    const stars = q.difficulty ? `★${q.difficulty} ` : "";

    // 题干
    lines.push(`### ${no}. ${q.stem.trim()} ${scoreText}`);

    // 选择题选项
    if (q.options && q.options.length > 0) {
      lines.push("");
      q.options.forEach((opt, oi) => {
        lines.push(`- **${String.fromCharCode(65 + oi)}.** ${opt.trim()}`);
      });
      lines.push("");
    }

    // 答案与解析折叠块（思源原生支持点击展开）
    lines.push(`<details>`);
    lines.push(`<summary><b>✔ 参考答案与核心解析点拨（点击展开）</b></summary>\n`);
    lines.push(`- **标准答案**：\`${q.answer}\``);
    if (q.kp) lines.push(`- **核心考点**：\`${q.kp}\``);
    if (q.difficulty) lines.push(`- **难度系数**：${stars}`);
    if (q.analysis) {
      lines.push(`- **试题解析**：${q.analysis.trim()}`);
    }
    if (q.rubric?.criteria?.length) {
      lines.push(`- **主观采分点细则**：`);
      q.rubric.criteria.forEach((c) => {
        lines.push(`  - ${c.label}（${Math.round(c.weight * 100)}%）${c.example ? `：${c.example}` : ""}`);
      });
    }
    lines.push(`\n</details>`);

    // 思源块属性（供重装插件或块查询识别）
    if (options.includeAttrs !== false) {
      lines.push(`{: custom-exam-id="${q.id}" custom-exam-type="${q.type}" custom-exam-kp="${q.kp || ""}"}\n`);
    } else {
      lines.push("");
    }
  });

  return lines.join("\n");
}

/**
 * 将错题本格式化为思源笔记错题攻坚手册文档
 */
export function buildSiyuanWrongbookDocMarkdown(
  bankName: string,
  wrongQuestions: readonly Question[],
): string {
  return buildSiyuanExamDocMarkdown(
    `${bankName} · 错题攻坚复盘手册（共 ${wrongQuestions.length} 题）`,
    wrongQuestions,
    {
      subtitle: "按考点与错题深度排版，可配合思源折叠块反复自测消灭错题",
      includeAttrs: true,
    },
  );
}
