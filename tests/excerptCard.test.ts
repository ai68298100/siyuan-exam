import { describe, it, expect } from "vitest";
import {
  formatExcerptProvenance,
  inferKnowledgePoint,
  generateAutoRubric,
  extractCardsFromExcerpt,
  extractCardsFromMaterialNotes,
  type ExcerptSource,
} from "../src/core/excerptCard";
import type { MaterialNote } from "../src/core/materialNotes";

describe("阅读笔记原文高亮与切片渐进式制卡出题引擎（excerptCard）", () => {
  describe("溯源与考点推导", () => {
    it("formatExcerptProvenance：综合材料标题、物理页码、时间戳与笔记 ID", () => {
      const src1: ExcerptSource = {
        text: "测试文本",
        materialTitle: "操作系统深度剖析",
        locator: { page: 42 },
      };
      expect(formatExcerptProvenance(src1)).toBe("操作系统深度剖析 · P42");

      const src2: ExcerptSource = {
        text: "测试文本",
        materialTitle: "计算机网络",
        locator: { tSec: 125 },
      };
      expect(formatExcerptProvenance(src2)).toBe("计算机网络 · 2:05");

      const src3: ExcerptSource = {
        text: "测试文本",
        noteId: "n-12345678",
      };
      expect(formatExcerptProvenance(src3)).toBe("笔记 n-12345678");

      const src4: ExcerptSource = {
        text: "测试文本",
      };
      expect(formatExcerptProvenance(src4)).toBe("阅读切片摘录");
    });

    it("inferKnowledgePoint：优先使用显式 kp，其次 tags[0]，再次材料标题，最后缺省", () => {
      expect(inferKnowledgePoint({ text: "", kp: "微机原理" })).toBe("微机原理");
      expect(inferKnowledgePoint({ text: "", tags: ["虚拟内存", "操作系统"] })).toBe("虚拟内存");
      expect(inferKnowledgePoint({ text: "", materialTitle: "数据结构" })).toBe("数据结构");
      expect(inferKnowledgePoint({ text: "" }, "自定默认")).toBe("自定默认");
    });

    it("generateAutoRubric：根据答案断句自动生成分点采分点并均匀分配权重", () => {
      const ans = "TCP是面向连接的可靠传输协议；具备滑动窗口流量控制机制；通过拥塞避免算法防范拥塞。";
      const rubric = generateAutoRubric(ans, 6);

      expect(rubric.v).toBe(1);
      expect(rubric.kind).toBe("rubric");
      expect(rubric.fullScore).toBe(6);
      expect(rubric.criteria.length).toBeGreaterThanOrEqual(2);
      expect(rubric.criteria[0].weight).toBe(2);
      expect(rubric.criteria[0].levels).toHaveLength(3);
      expect(rubric.criteria[0].levels[0].ratio).toBe(1.0);
    });
  });

  describe("extractCardsFromExcerpt 核心提取规则", () => {
    it("1. 识别思源高亮 ==重点== 与 Markdown 加粗，生成 fill 填空题并挂载溯源", () => {
      const src: ExcerptSource = {
        text: "HTTP协议的默认端口号是 ==80==，而HTTPS协议的默认端口是 ==443==。",
        materialTitle: "网络协议精讲",
        locator: { page: 15 },
        tags: ["计算机网络"],
      };

      const result = extractCardsFromExcerpt(src);
      expect(result.questions).toHaveLength(1);

      const q = result.questions[0];
      expect(q.type).toBe("fill");
      expect(q.stem).toBe("HTTP协议的默认端口号是 ____，而HTTPS协议的默认端口是 ____。");
      expect(q.answer).toBe("80;;443");
      expect(q.source).toBe("网络协议精讲 · P15");
      expect(q.kp).toBe("计算机网络");
      expect(q.answerSpec?.kind).toBe("multiBlank");
      expect(q.review).toBe("verified");
    });

    it("2. 识别 Markdown 加粗重点词转化为填空题", () => {
      const src: ExcerptSource = {
        text: "在关系型数据库中，保证事务原子性的是 **UndoLog**。",
        materialTitle: "数据库原理",
      };

      const result = extractCardsFromExcerpt(src, { targetTypes: ["fill"] });
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].stem).toBe("在关系型数据库中，保证事务原子性的是 ____。");
      expect(result.questions[0].answer).toBe("UndoLog");
    });

    it("3. 识别 Q: ... A: ... 格式生成 short 简答卡并带自适应 rubric", () => {
      const src: ExcerptSource = {
        text: "问：什么是进程的死锁？\n答：进程死锁是指两个或多个并发进程在运行过程中因争夺资源而造成的一种僵局。",
        materialTitle: "操作系统",
        tags: ["进程管理"],
      };

      const result = extractCardsFromExcerpt(src, { targetTypes: ["short"] });
      expect(result.questions).toHaveLength(1);

      const q = result.questions[0];
      expect(q.type).toBe("short");
      expect(q.stem).toContain("什么是进程的死锁？");
      expect(q.answer).toContain("进程死锁是指两个或多个并发进程");
      expect(q.rubric).toBeDefined();
      expect(q.rubric?.criteria.length).toBeGreaterThan(0);
    });

    it("4. 识别概念定义句式（...是指...）提取 short 简答题并过滤无意义词汇", () => {
      const src: ExcerptSource = {
        text: "虚拟内存是指具有请求调页功能和页面置换功能，能从逻辑上对内存容量加以扩充的高效存储管理技术。",
        materialTitle: "操作系统",
      };

      const result = extractCardsFromExcerpt(src, { targetTypes: ["short"] });
      expect(result.questions.length).toBeGreaterThanOrEqual(1);

      const q = result.questions[0];
      expect(q.type).toBe("short");
      expect(q.stem).toBe("请简述「虚拟内存」的定义与核心特征。");
      expect(q.answer).toContain("具有请求调页功能");
    });

    it("5. 识别列表要素句式提取多选题（multiple）", () => {
      const src: ExcerptSource = {
        text: "面向对象编程主要包括以下核心要素：\n1. 封装\n2. 继承\n3. 多态\n4. 抽象",
        materialTitle: "软件工程导论",
      };

      const result = extractCardsFromExcerpt(src, { targetTypes: ["multiple"] });
      expect(result.questions).toHaveLength(1);

      const q = result.questions[0];
      expect(q.type).toBe("multiple");
      expect(q.stem).toContain("面向对象编程");
      expect(q.options).toEqual(["封装", "继承", "多态", "抽象"]);
      expect(q.answer).toBe("ABCD");
    });

    it("6. 识别易错与辨析句式提取正误判断题（judge）", () => {
      const src: ExcerptSource = {
        text: "注意：TCP协议并非无连接协议，而是提供可靠全双工通信的面向连接传输协议。",
        materialTitle: "网络技术",
      };

      const result = extractCardsFromExcerpt(src, { targetTypes: ["judge"] });
      expect(result.questions).toHaveLength(1);

      const q = result.questions[0];
      expect(q.type).toBe("judge");
      expect(q.stem).toContain("【辨析判断】");
      expect(q.answer).toBe("对");
      expect(q.analysis).toContain("TCP协议并非无连接协议");
    });

    it("7. targetTypes 白名单限制有效，未选中的题型不生成", () => {
      const src: ExcerptSource = {
        text: "TCP是指传输控制协议。HTTP默认端口为 ==80==。",
      };

      const result = extractCardsFromExcerpt(src, { targetTypes: ["fill"] });
      expect(result.questions.every((q) => q.type === "fill")).toBe(true);
      expect(result.stats.byType.short).toBe(0);
      expect(result.stats.byType.fill).toBe(1);
    });

    it("8. 具备同一切片内指纹自动去重保护", () => {
      const src: ExcerptSource = {
        text: "==高可用== 是系统设计的重要指标。\n==高可用== 是系统设计的重要指标。",
      };

      const result = extractCardsFromExcerpt(src);
      expect(result.questions).toHaveLength(1);
      expect(result.skipped.some((s) => s.reason.includes("重复"))).toBe(true);
    });

    it("9. 空文本或无特征文本安全降级与 skipped 说明", () => {
      const emptyResult = extractCardsFromExcerpt({ text: "   " });
      expect(emptyResult.questions).toHaveLength(0);
      expect(emptyResult.skipped[0].reason).toContain("为空");

      const plainResult = extractCardsFromExcerpt({ text: "今天天气真不错适合出去散步" });
      expect(plainResult.questions).toHaveLength(0);
      expect(plainResult.skipped[0].reason).toContain("未检测到符合规范");
    });

    it("10. 识别带圆圈序号 ①②③ 的列表要素提取", () => {
      const src: ExcerptSource = {
        text: "数据库事务的ACID特性包括以下内容：\n① 原子性（Atomicity）\n② 一致性（Consistency）\n③ 隔离性（Isolation）\n④ 持久性（Durability）",
        materialTitle: "数据库原理",
      };

      const result = extractCardsFromExcerpt(src, { targetTypes: ["multiple"] });
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].options).toHaveLength(4);
      expect(result.questions[0].options[0]).toBe("原子性（Atomicity）");
    });

    it("11. 置信度低于阈值时，卡片 review 状态标记为 pending", () => {
      const src: ExcerptSource = {
        text: "注意：不可在主线程执行耗时IO操作。",
        materialTitle: "并发编程",
      };

      // 辨析判断卡默认置信度为 0.82，若门槛设为 0.90 则标记为 pending
      const result = extractCardsFromExcerpt(src, {
        targetTypes: ["judge"],
        confidenceThreshold: 0.9,
      });
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].review).toBe("pending");
    });
  });

  describe("extractCardsFromMaterialNotes 批量从笔记制卡", () => {
    it("综合处理多条 MaterialNote，正确继承 materialMeta 与 locator", () => {
      const notes: MaterialNote[] = [
        {
          id: "n-note1",
          materialId: "m-math",
          revision: 1,
          locator: { page: 12, quote: "微积分基本定理" },
          text: "问：微积分基本定理的核心思想是什么？\n答：建立了微分与积分之间的互逆内在联系。",
          tags: ["高等数学"],
          createdAt: 1000,
          updatedAt: 1000,
        },
        {
          id: "n-note2",
          materialId: "m-math",
          revision: 1,
          locator: { page: 20 },
          text: "极限存在的充分必要条件是 ==左极限等于右极限==。",
          tags: ["极限与连续"],
          createdAt: 2000,
          updatedAt: 2000,
        },
      ];

      const materialMeta = {
        id: "m-math",
        title: "高等数学第七版",
        revision: 1,
      };

      const result = extractCardsFromMaterialNotes(notes, materialMeta);
      expect(result.questions.length).toBe(2);

      const qaCard = result.questions.find((q) => q.type === "short");
      expect(qaCard).toBeDefined();
      expect(qaCard?.source).toContain("高等数学第七版 · P12 · 「微积分基本定理」");
      expect(qaCard?.kp).toBe("高等数学");

      const fillCard = result.questions.find((q) => q.type === "fill");
      expect(fillCard).toBeDefined();
      expect(fillCard?.source).toContain("高等数学第七版 · P20");
      expect(fillCard?.answer).toBe("左极限等于右极限");
      expect(fillCard?.kp).toBe("极限与连续");
    });
  });

  describe("ExamApp 集成：extractCardsFromNotes / 导出", () => {
    it("extractCardsFromNotes：关联材料元数据并统一导出", async () => {
      const { ExamApp } = await import("../src/app");
      const { MemoryStorage } = await import("../src/core/attemptLog");
      const client = {} as any;
      const app = new ExamApp({ client, storage: new MemoryStorage(), now: () => 1_700_000_000_000 });

      // 注册一个链接材料
      const reg = await app.registerMaterialFromLink("https://example.com/linear-algebra.pdf", {
        title: "线性代数",
        subject: "数学",
        chapter: "矩阵求逆",
      });
      const matId = reg.material.id;

      // 添加两条笔记
      await app.addMaterialNote({
        materialId: matId,
        revision: reg.material.revision,
        locator: { page: 15 },
        text: "问答：伴随矩阵的定义是什么？\n答：各元素代数余子式按转置排列构成的矩阵。",
        tags: ["代数", "矩阵"],
      });
      await app.addMaterialNote({
        materialId: matId,
        revision: reg.material.revision,
        locator: { page: 25 },
        text: "挖空：初等行变换不改变矩阵的{{秩}}。",
        tags: ["矩阵秩"],
      });

      // 执行提取
      const result = await app.extractCardsFromNotes(matId, { defaultScore: 3 });
      expect(result.questions.length).toBe(2);
      expect(result.questions[0].score).toBe(3);
      expect(result.questions[0].source).toContain("线性代数 · P15");
      expect(result.questions[0].kp).toBe("代数");

      expect(result.questions[1].score).toBe(3);
      expect(result.questions[1].source).toContain("线性代数 · P25");
      expect(result.questions[1].answer).toBe("秩");
      expect(result.questions[1].kp).toBe("矩阵秩");

      // 导出 Markdown
      const md = await app.exportCardsMarkdown(result.questions);
      expect(md).toContain("# 线性代数 摘抄闪卡集");
      expect(md).toContain("## 1. [简答题] 【问答】伴随矩阵的定义是什么？");
      expect(md).toContain("**答案**：各元素代数余子式按转置排列构成的矩阵。");
      expect(md).toContain("## 2. [填空题] 初等行变换不改变矩阵的____。");
      expect(md).toContain("**答案**：秩");

      // 导出 CSV
      const csv = await app.exportCardsCsv(result.questions);
      expect(csv).toContain('"short","【问答】伴随矩阵的定义是什么？","各元素代数余子式按转置排列构成的矩阵。"');
      expect(csv).toContain('"fill","初等行变换不改变矩阵的____。","秩"');

      // 材料不存在时报错防呆
      await expect(app.extractCardsFromNotes("non-existent-id")).rejects.toThrow(/未找到指定材料/);
    });
  });
});

