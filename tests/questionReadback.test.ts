import { describe, expect, it } from "vitest";
import { KernelApiClient, type KernelTransport } from "../src/kernel/client";
import { ialOf, makeQuestion, parseIal, questionFromBlock, questionToMarkdown } from "../src/core/blockTemplate";
import { sampleQuestions } from "../src/core/sampleBank";
import { grade } from "../src/core/answer";
import { answerChoices, toggleChoice } from "../src/core/answerChoices";

describe("真实题块结构读取", () => {
  const q = makeQuestion({ type: "single", stem: "题干", options: ["甲", "乙"], answer: "A", analysis: "解析不能提前出现在题干" });
  const attrs = parseIal(ialOf(q));
  const md = questionToMarkdown(q).replace("题干\n", '题干\n{: id="stem-block"}\n')
    .replace("- A. 甲\n", '- A. 甲\n  {: id="option-a"}\n')
    .replace("- B. 乙\n", '- B. 乙\n  {: id="option-b"}\n');

  it("子块 IAL 不截断后续选项，解析与题干分离", () => {
    const back = questionFromBlock({ attrs, text: md });
    expect(back?.stem).toBe("题干");
    expect(back?.options).toEqual(["甲", "乙"]);
    expect(back?.analysis).toBe(q.analysis);
  });

  it("历史多行 IAL 不泄露属性续行，也不吞掉后续选项", () => {
    const historical = md.replace('{: id="stem-block"}', '{: id="stem-block" custom-note="第一行含 } 和 \\"引号\\"\n第二行"}');
    const back = questionFromBlock({ attrs, text: historical });
    expect(back?.stem).toBe("题干");
    expect(back?.options).toEqual(["甲", "乙"]);
    expect(back?.analysis).toBe(q.analysis);
  });

  const kernel = (markdown: string | undefined, kramdown: string) => {
    const calls: string[] = [];
    const transport: KernelTransport = {
      async post(endpoint) {
        calls.push(endpoint);
        const rows = Object.entries(attrs).map(([attrName, attrValue]) => ({
          blockId: "question-block", rootId: "doc", hpath: "/示例题", attrName, attrValue,
          content: "题干 A. 甲 B. 乙 解析不能提前出现在题干", markdown,
        }));
        return { code: 0, msg: "", data: endpoint === "/api/query/sql" ? rows : { kramdown } };
      },
    };
    return { client: new KernelApiClient(transport), calls };
  };

  it("使用 SQL 完整 markdown，还原选择题而非用压平摘要作答", async () => {
    const { client, calls } = kernel(md, "");
    const [back] = await client.listQuestions("nb");
    expect(back.stem).toBe("题干");
    expect(back.options).toEqual(["甲", "乙"]);
    expect(calls).toEqual(["/api/query/sql"]);
  });

  it("旧索引只有摘要时读取完整 kramdown；读不到时明确失败", async () => {
    const { client, calls } = kernel(undefined, md);
    expect((await client.listQuestions("nb"))[0].options).toEqual(["甲", "乙"]);
    expect(calls).toContain("/api/block/getBlockKramdown");
    await expect(kernel(undefined, "").client.listQuestions("nb")).rejects.toThrow("未读取到完整题目内容");
  });

  it("示例题完整往返后数值/多空规则与可接受答案不丢失", () => {
    for (const seed of sampleQuestions()) {
      const back = questionFromBlock({ attrs: parseIal(ialOf(seed)), text: questionToMarkdown(seed) })!;
      expect(back.stem).toBe(seed.stem);
      expect(back.options).toEqual(seed.options);
      expect(back.answerSpec).toEqual(seed.answerSpec);
      expect(grade(back, seed.answer).verdict).toBe(seed.type === "short" ? "not_attempted" : "correct");
    }
  });

  it("判断按钮和快捷键提交对/错，点击与多选键盘切换共享判分答案", () => {
    const judge = makeQuestion({ type: "judge", stem: "判断", answer: "对" });
    const choices = answerChoices(judge);
    expect(choices.map((c) => c.letter)).toEqual(["A", "B"]);
    expect(grade(judge, choices[0].value).verdict).toBe("correct");
    expect(grade(judge, choices[1].value).verdict).toBe("wrong");
    expect(toggleChoice("multiple", "A", "B")).toBe("AB");
    expect(toggleChoice("multiple", "AB", "A")).toBe("B");
    expect(toggleChoice("single", "A", "B")).toBe("B");
  });
});
