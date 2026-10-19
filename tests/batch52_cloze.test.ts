import { describe, it, expect } from "vitest";
import {
  parseSingleClozeSentence,
  parseClozeText,
  clozeItemsToQuestions,
} from "../src/core/cloze";

describe("52-09 思源正文挖空出题引擎（五二批挖空出题）", () => {
  describe("parseSingleClozeSentence 语法识别与替换", () => {
    it("识别思源高亮 ==重点词== 并生成标准单空题干与答案", () => {
      const input = "思源笔记的内核是用 ==Go== 语言编写的。";
      const item = parseSingleClozeSentence(input);

      expect(item).not.toBeNull();
      expect(item?.stem).toBe("思源笔记的内核是用 ____ 语言编写的。");
      expect(item?.answers).toEqual(["Go"]);
      expect(item?.combinedAnswer).toBe("Go");
      expect(item?.blankCount).toBe(1);
      expect(item?.spec).toBeUndefined();
    });

    it("识别经典花括号 {{答案}} 与带序号 {{c1::答案}} 语法", () => {
      const input1 = "光的传播速度约为 {{30万千米每秒}}。";
      const item1 = parseSingleClozeSentence(input1);
      expect(item1?.stem).toBe("光的传播速度约为 ____。");
      expect(item1?.combinedAnswer).toBe("30万千米每秒");

      const input2 = "计算机网络中的七层模型是 {{c1::OSI参考模型}}。";
      const item2 = parseSingleClozeSentence(input2);
      expect(item2?.stem).toBe("计算机网络中的七层模型是 ____。");
      expect(item2?.combinedAnswer).toBe("OSI参考模型");
    });

    it("识别带提示语的双花括号 {{c2::答案::提示语}}", () => {
      const input = "太阳发光发热的核心机制是 {{c2::热核聚变::物理机制}}。";
      const item = parseSingleClozeSentence(input);

      expect(item?.stem).toBe("太阳发光发热的核心机制是 ____（物理机制）。");
      expect(item?.combinedAnswer).toBe("热核聚变");
      expect(item?.answers).toEqual(["热核聚变"]);
    });

    it("同一句包含多个挖空时，生成多空题干并构建 MultiBlankSpec 规格", () => {
      const input = "我国三大平原分别是 ==东北平原==、==华北平原== 和 ==长江中下游平原==。";
      const item = parseSingleClozeSentence(input);

      expect(item?.blankCount).toBe(3);
      expect(item?.stem).toBe("我国三大平原分别是 ____、____ 和 ____。");
      expect(item?.answers).toEqual(["东北平原", "华北平原", "长江中下游平原"]);
      expect(item?.combinedAnswer).toBe("东北平原;;华北平原;;长江中下游平原");

      // 结构化多空规格检验
      expect(item?.spec).toBeDefined();
      expect(item?.spec?.v).toBe(1);
      expect(item?.spec?.kind).toBe("multiBlank");
      expect(item?.spec?.blanks).toHaveLength(3);
      expect(item?.spec?.blanks[0].answers).toEqual(["东北平原"]);
      expect(item?.spec?.blanks[1].answers).toEqual(["华北平原"]);
      expect(item?.spec?.blanks[2].answers).toEqual(["长江中下游平原"]);
    });

    it("支持混合使用高亮和花括号挖空", () => {
      const input = "力学的两大约束是 ==能量守恒== 与 {{动量守恒}}。";
      const item = parseSingleClozeSentence(input);

      expect(item?.blankCount).toBe(2);
      expect(item?.answers).toEqual(["动量守恒", "能量守恒"].sort()); // 均提取
      expect(item?.combinedAnswer).toContain(";;");
    });

    it("无任何挖空语法时返回 null", () => {
      expect(parseSingleClozeSentence("这是一段普通的笔记，没有任何高亮。")).toBeNull();
      expect(parseSingleClozeSentence("")).toBeNull();
      expect(parseSingleClozeSentence("   ")).toBeNull();
    });

    it("当显式开启 bracket 模式时支持识别括号内的答案词", () => {
      const input = "中国最大的淡水湖是（鄱阳湖）。";
      const noBracket = parseSingleClozeSentence(input, { modes: ["highlight"] });
      expect(noBracket).toBeNull();

      const withBracket = parseSingleClozeSentence(input, { modes: ["bracket"] });
      expect(withBracket?.stem).toBe("中国最大的淡水湖是____。");
      expect(withBracket?.combinedAnswer).toBe("鄱阳湖");
    });
  });

  describe("parseClozeText 批量多行文本解析", () => {
    it("正确过滤无挖空句子，提取出所有有效填空题", () => {
      const markdown = `
# 物理笔记复习

光的本质是 ==波粒二象性==。

这是一句普通说明，不含挖空。

电磁感应定律是由 {{法拉第}} 发现的。
`;

      const items = parseClozeText(markdown);
      expect(items).toHaveLength(2);
      expect(items[0].answers).toEqual(["波粒二象性"]);
      expect(items[1].answers).toEqual(["法拉第"]);
    });
  });

  describe("clozeItemsToQuestions 题目转换", () => {
    it("生成符合题库数据契约的 Question 对象", () => {
      const items = parseClozeText("植物光合作用需要吸收 ==二氧化碳== 并释放 ==氧气==。");
      const qs = clozeItemsToQuestions(items, { kp: "生物/光合作用", source: "人教版教材" });

      expect(qs).toHaveLength(1);
      const q = qs[0];
      expect(q.type).toBe("fill");
      expect(q.stem).toBe("植物光合作用需要吸收 ____ 并释放 ____。");
      expect(q.answer).toBe("二氧化碳;;氧气");
      expect(q.kp).toBe("生物/光合作用");
      expect(q.source).toBe("人教版教材");
      expect(q.answerSpec?.kind).toBe("multiBlank");
      expect(q.origin).toBe("manual");
      expect(q.status).toBe("published");
    });
  });
});
