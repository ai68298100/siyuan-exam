import { describe, it, expect } from "vitest";
import {
  isMarkdownExamText,
  splitMarkdownExamBlocks,
  parseMarkdownExam,
} from "../src/importer/markdownExam";
import { parseText } from "../src/importer/pipeline";

describe("Markdown 试卷与文档批量试题解析导入器 (markdownExam)", () => {
  const sampleExamMd = `
# 2026年综合能力模拟试卷

## 一、单项选择题
1. 下列关于宪法效力的说法正确的是（ ）
A. 宪法在全国范围内具有最高法律效力
B. 宪法效力仅及于公民，不及于国家机关
C. 宪法修改不属于全国人大职权
D. 普通法律冲突时优先于宪法适用
【答案】A
【解析】宪法具有最高法律地位和最高法律效力。
【考点】宪法学 / 宪法效力

2. 设函数 $f(x) = x^2 + 1$，则 $f'(2)$ 等于（ ）
A. 2    B. 4    C. 5    D. 8
参考答案：B
【考点】高等数学 / 导数计算

## 二、多项选择题
3. 【多选题】下列属于行政强制措施的有（ ）
A. 限制人身自由
B. 查封场所、设施或者财物
C. 扣押财物
D. 罚款
【答案】ABC
【解析】罚款属于行政处罚，不是行政强制措施。

## 三、判断题
4. 民法典规定，自然人从出生时起到死亡时止，具有民事权利能力。
答案：对
【解析】民法典第十三条明确规定。
`;

  it("isMarkdownExamText 能够正确探测 Markdown 试卷特征", () => {
    expect(isMarkdownExamText(sampleExamMd)).toBe(true);
    expect(isMarkdownExamText("纯文本闲聊没有任何题目")).toBe(false);
  });

  it("splitMarkdownExamBlocks 正确按题号与章节分割题块", () => {
    const blocks = splitMarkdownExamBlocks(sampleExamMd);
    expect(blocks.length).toBe(4);
    expect(blocks[0].sectionKp).toBe("单项选择题");
    expect(blocks[0].blockText).toContain("宪法效力");
    expect(blocks[1].blockText).toContain("f(x) = x^2 + 1");
    expect(blocks[2].sectionKp).toBe("多项选择题");
    expect(blocks[3].blockText).toContain("民法典规定");
  });

  it("parseMarkdownExam 成功解析全部题型并返回标准 ImportReport", () => {
    const report = parseMarkdownExam(sampleExamMd);
    expect(report.errors).toHaveLength(0);
    expect(report.ok).toHaveLength(4);

    // 第1题：单选题
    const q1 = report.ok[0];
    expect(q1.type).toBe("single");
    expect(q1.stem).toContain("下列关于宪法效力的说法正确的是（ ）");
    expect(q1.options).toHaveLength(4);
    expect(q1.answer).toBe("A");
    expect(q1.analysis).toContain("宪法具有最高法律地位");
    expect(q1.kp).toBe("宪法学 / 宪法效力");

    // 第2题：带 LaTeX 公式的数学单选题（同一行选项）
    const q2 = report.ok[1];
    expect(q2.type).toBe("single");
    expect(q2.stem).toContain("$f(x) = x^2 + 1$");
    expect(q2.options).toHaveLength(4);
    expect(q2.options[1]).toBe("4");
    expect(q2.answer).toBe("B");

    // 第3题：多选题
    const q3 = report.ok[2];
    expect(q3.type).toBe("multiple");
    expect(q3.answer).toBe("ABC");
    expect(q3.options).toHaveLength(4);

    // 第4题：判断题
    const q4 = report.ok[3];
    expect(q4.type).toBe("judge");
    expect(q4.answer).toBe("对");
  });

  it("parseText 能够自动将中文 Markdown 试卷分流到 markdownExam 处理", async () => {
    const report = await parseText(sampleExamMd);
    expect(report.errors).toHaveLength(0);
    expect(report.ok).toHaveLength(4);
  });

  it("splitMarkdownExamBlocks 保护题干内代码块，不被代码块中的注释或编号误切断", () => {
    const codeExamMd = `
1. 阅读以下 Python 代码并选出运行结果：
\`\`\`python
# 1. 初始化数组
# ## 二、测试标题
def solve():
    return 42
\`\`\`
A. 42
B. None
【答案】A
    `;

    const blocks = splitMarkdownExamBlocks(codeExamMd);
    expect(blocks.length).toBe(1);
    expect(blocks[0].blockText).toContain("def solve():");
    expect(blocks[0].blockText).toContain("# 1. 初始化数组");
    expect(blocks[0].blockText).toContain("【答案】A");
  });
});
