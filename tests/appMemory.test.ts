import { describe, it, expect } from "vitest";
import { ExamApp } from "../src/app";
import { MemoryStorage } from "../src/core/attemptLog";
import type { KernelApiClient } from "../src/kernel/client";
import type { Question } from "../src/core/types";
import { makeQuestion } from "../src/core/blockTemplate";

/** stub 内核：riff/SQL/属性写 全记录 */
function stubClient(opts: { decks?: { id: string; name: string }[]; failAttrOn?: Set<string> } = {}) {
  const calls = {
    addRiffCards: [] as { deckId: string; blockIds: string[] }[],
    reviewRiffCard: [] as { cardId: string; deckId: string; rating: number }[],
    setExamAttrs: [] as { blockId: string; attrs: Record<string, string> }[],
    appendBlock: [] as { parentId: string; md: string }[],
    createRiffDeck: [] as string[],
  };
  let decks = opts.decks ?? [];
  const client = {
    sql: async () => [],
    getRiffDecks: async () => decks,
    createRiffDeck: async (name: string) => {
      calls.createRiffDeck.push(name);
      decks = [...decks, { id: "deck-1", name }];
      return "deck-1";
    },
    addRiffCards: async (deckId: string, blockIds: string[]) => {
      calls.addRiffCards.push({ deckId, blockIds });
    },
    getCardIDsByBlockIDs: async (blockIds: string[]) => new Map(blockIds.map((b) => [b, `card-${b}`])),
    reviewRiffCard: async (cardId: string, deckId: string, rating: number) => {
      calls.reviewRiffCard.push({ cardId, deckId, rating });
    },
    setExamAttrs: async (blockId: string, attrs: Record<string, string>) => {
      if (opts.failAttrOn?.has(blockId)) throw new Error("attr write failed");
      calls.setExamAttrs.push({ blockId, attrs });
    },
    appendBlock: async (parentId: string, md: string) => {
      calls.appendBlock.push({ parentId, md });
      return ["id1"];
    },
  } as unknown as KernelApiClient;
  return { client, calls, setDecks: (d: { id: string; name: string }[]) => (decks = d) };
}

const mkApp = (client: KernelApiClient, kernelOnline = true) => {
  const app = new ExamApp({ client, storage: new MemoryStorage(), now: () => 1_800_000_000_000 });
  app.kernelOnline = kernelOnline;
  return app;
};

const qWithBlock = (id: string): Question & { blockId?: string } => ({
  ...makeQuestion({ type: "single", stem: id, options: ["1", "2"], answer: "A" }),
  id,
  blockId: `b-${id}`,
});

describe("应用层记忆/写入路径（应用编排层测试补盲）", () => {
  it("reciteAnswer：自评落流水（客观对错由 selfRating 承载）且已转卡题同步 riff 评级", async () => {
    const { client, calls } = stubClient({ decks: [{ id: "deck-1", name: "小驴考试/公考" }] });
    const app = mkApp(client);
    const q = qWithBlock("q1");
    await app.reciteAnswer("公考", q, 2, "s1"); // 有点难（Hard）
    await app.reciteAnswer("公考", q, 4, "s1"); // 很容易（Easy）
    const events = app.attempts.all();
    expect(events).toHaveLength(2);
    // 39-04：recite 是自评场景，不再把自评伪装成客观对错——verdict 只表示「发生过作答」
    expect(events[0]).toMatchObject({ kind: "recite", verdict: "not_attempted", selfRating: 2 });
    expect(events[1]).toMatchObject({ kind: "recite", verdict: "not_attempted", selfRating: 4 });
    expect(calls.reviewRiffCard).toHaveLength(2);
    // 39-01：对齐上游 riff.Rating（Again=1/Hard=2/Good=3/Easy=4），非旧 0-3 偏移值
    expect(calls.reviewRiffCard[0].rating).toBe(2); // 2模糊 → Hard(2)
    expect(calls.reviewRiffCard[1].rating).toBe(4); // 4熟知 → Easy(4)
  });

  it("39-04：Hard 不清零背诵连击，Again 才清零（费力但成功回忆≠失败）", async () => {
    const { client } = stubClient({ decks: [{ id: "deck-1", name: "小驴考试/公考" }] });
    const app = mkApp(client);
    const q = qWithBlock("q1");
    // Good → 连击 1；Hard → 保持 1（旧实现会清零）；Good → 2；Again → 清零
    await app.reciteAnswer("公考", q, 3, "s1");
    await app.reciteAnswer("公考", q, 2, "s1");
    await app.reciteAnswer("公考", q, 3, "s1");
    expect(app.derived().reciteStreak.get(q.id)).toBe(2);
    await app.reciteAnswer("公考", q, 1, "s1");
    expect(app.derived().reciteStreak.get(q.id)).toBe(0);
  });

  it("convertToCards：只送有块 ID 的题；无块返回 0 不调内核", async () => {
    const { client, calls } = stubClient();
    const app = mkApp(client);
    const n1 = await app.convertToCards("bank1", "公考", [
      qWithBlock("a"),
      qWithBlock("b"),
      { ...makeQuestion({ type: "single", stem: "noblock", options: [], answer: "A" }), id: "c" },
    ]);
    expect(n1).toBe(2);
    expect(calls.addRiffCards[0].blockIds).toEqual(["b-a", "b-b"]);
    const n2 = await app.convertToCards("bank1", "公考", [
      { ...makeQuestion({ type: "single", stem: "x", options: [], answer: "A" }), id: "d" },
    ]);
    expect(n2).toBe(0);
    expect(calls.addRiffCards).toHaveLength(1);
  });

  it("applyBatchEdit：逐题写属性计数回执；失败不中断；离线拒绝", async () => {
    const { client, calls } = stubClient({ failAttrOn: new Set(["b2"]) });
    const app = mkApp(client);
    const r = await app.applyBatchEdit([
      { blockId: "b1", field: "kp", to: "言语" },
      { blockId: "b2", field: "kp", to: "数量" },
      { blockId: "b3", field: "difficulty", to: "3" },
    ]);
    expect(r).toEqual({ ok: 2, failed: 1 });
    const byBlock = new Map(calls.setExamAttrs.map((c) => [c.blockId, c.attrs]));
    expect(byBlock.get("b1")).toEqual({ "exam-kp": "言语" });
    expect(byBlock.get("b3")).toEqual({ "exam-difficulty": "3" });
    expect(byBlock.has("b2")).toBe(false); // 失败项未写入
    const offline = mkApp(client, false);
    await expect(offline.applyBatchEdit([{ blockId: "b1", field: "kp", to: "x" }])).rejects.toThrow("离线");
  });

  it("findQuestionByBlock：跨库定位命中；离线返回 null", async () => {
    const target = { ...qWithBlock("hit"), rootId: "r1" } as Question & { blockId: string; rootId: string };
    const client = {
      sql: async () => [],
      listQuestions: async (nb: string) => (nb === "bank2" ? [target] : []),
      getRiffDecks: async () => [],
    } as unknown as KernelApiClient;
    const app = mkApp(client, true);
    app["banks"] = [
      { id: "bank1", name: "A", createdAt: 1 },
      { id: "bank2", name: "B", createdAt: 2 },
    ] as never;
    const hit = await app.findQuestionByBlock("b-hit");
    expect(hit?.bank.id).toBe("bank2");
    expect(hit?.q.id).toBe("hit");
    expect(await app.findQuestionByBlock("missing")).toBeNull();
    const offline = mkApp(client, false);
    expect(await offline.findQuestionByBlock("b-hit")).toBeNull();
  });

  it("55-07 / 68-01：ExamApp 试卷不可变快照持久化、索引管理、离线导出与删除闭环", async () => {
    const { client } = stubClient();
    const app = mkApp(client);

    const { createPaperSnapshot } = await import("../src/core/paperSnapshot");
    const q = qWithBlock("p1");
    const snapshot = createPaperSnapshot({
      title: "申论真题卷 A",
      blueprint: {
        id: "bp-app",
        name: "申论",
        durationS: 3600,
        passLine: 60,
        shuffleOptions: false,
        sectionTimed: false,
        sections: [{ name: "单选", count: 1, scoreEach: 2.0, source: "mixed", types: ["single"] }],
      },
      paper: [q],
      sectionOf: { p1: "单选" },
      scoreOf: { p1: 2.0 },
    });

    // 1. 保存快照与索引更新
    await app.savePaperSnapshot(snapshot);

    // 2. 索引查询
    const list = await app.listPaperSnapshots();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      paperId: snapshot.paperId,
      title: "申论真题卷 A",
      questionCount: 1,
      totalScore: 2,
    });

    // 3. 读取快照
    const loaded = await app.loadPaperSnapshot(snapshot.paperId);
    expect(loaded?.paperId).toBe(snapshot.paperId);
    expect(loaded?.items[0].stem).toBe("p1");

    // 4. 离线导出
    const { paperMd, answerKeyMd } = await app.exportPaper(snapshot.paperId, { note: "限时作答" });
    expect(paperMd).toContain("申论真题卷 A");
    expect(paperMd).toContain("限时作答");
    expect(paperMd).not.toContain("标准答案"); // 绝不泄露答案
    expect(paperMd).not.toContain("【试题解析】"); // 绝不泄露解析
    expect(answerKeyMd).toContain("- **标准答案**：`A`"); // 答案册包含答案并明确标出标准答案

    // 5. 删除快照
    await app.deletePaperSnapshot(snapshot.paperId);
    expect(await app.loadPaperSnapshot(snapshot.paperId)).toBeNull();
    expect(await app.listPaperSnapshots()).toHaveLength(0);
  });

  it("53-04：ExamApp 考前急救冲刺规格生成与紧急度自适应", async () => {
    const { client } = stubClient();
    const app = mkApp(client);

    const q1 = qWithBlock("cram-1");
    const q2 = qWithBlock("cram-2");

    // 写入真实作答流水产生错题
    await app.attempts.load("d-test-cram");
    app.attempts.append({ qid: "cram-1", kind: "practice", mode: "single", verdict: "wrong", myAnswer: "B", sessionId: "s1" });
    app.attempts.append({ qid: "cram-1", kind: "practice", mode: "single", verdict: "wrong", myAnswer: "B", sessionId: "s1" });
    app.attempts.append({ qid: "cram-1", kind: "practice", mode: "single", verdict: "wrong", myAnswer: "B", sessionId: "s1" });

    const urgency = app.getExamUrgency();
    expect(urgency.level).toBe("none");

    // 模拟考前急救冲刺（距考 3 天）
    const now = new Date("2026-10-20T10:00:00").getTime();
    app.deps.now = () => now;

    const spec = app.emergencyCramDrill([q1, q2], {
      examDate: "2026-10-23",
      targetMinutes: 15,
    });

    expect(spec.mode).toBe("cram");
    expect(spec.queue).toBe("cram");
    expect(spec.urgency.level).toBe("emergency");
    expect(spec.semantics.writesBack).toBe(false);
    expect(spec.questions[0].id).toBe("cram-1"); // 高频顽固题排在第一
  });

  it("51-01：ExamApp.getKpTree 能够为题库建立多级考点大纲树并穿透聚合掌握度", async () => {
    const q1 = { ...qWithBlock("tree-1"), kp: "资料分析/比重/现期" };
    const q2 = { ...qWithBlock("tree-2"), kp: "资料分析/比重/基期" };

    const client = {
      sql: async () => [],
      listQuestions: async () => [q1, q2],
      getRiffDecks: async () => [],
    } as unknown as KernelApiClient;

    const app = mkApp(client);
    app["banks"] = [{ id: "bank-tree", name: "资料分析专库", createdAt: 1 }] as never;

    await app.attempts.load("d-tree");
    app.attempts.append({ qid: "tree-1", kind: "practice", mode: "single", verdict: "correct", myAnswer: "A", sessionId: "s1" });

    const tree = await app.getKpTree("bank-tree");
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("资料分析");
    expect(tree[0].totalQuestions).toBe(2);
    expect(tree[0].totalAttempts).toBe(1);
    expect(tree[0].totalCorrect).toBe(1);
    expect(tree[0].children[0].name).toBe("比重");
    expect(tree[0].children[0].children).toHaveLength(2);
  });

  it("65-03：ExamApp.burySiblings 与 disperseSiblings 防答案泄露接线有效", () => {
    const { client } = stubClient();
    const app = mkApp(client);

    const qOrigin = qWithBlock("q-orig");
    const qVariant = { ...qWithBlock("q-var"), family: { parentId: "q-orig", variantKind: "numeric" as const } };

    // 1. 练习防泄露暂缓
    const res = app.burySiblings([qOrigin, qVariant]);
    expect(res.active).toHaveLength(1);
    expect(res.active[0].id).toBe("q-orig");
    expect(res.buried).toHaveLength(1);
    expect(res.buried[0].question.id).toBe("q-var");

    // 2. 兄弟题打散
    const indep = qWithBlock("q-indep");
    const dispersed = app.disperseSiblings([qOrigin, qVariant, indep], { minSpacing: 1 });
    expect(dispersed).toHaveLength(3);
  });

  it("52-04：ExamApp 结构化四要素自诊断存取、历史时间轴与 Markdown 导出闭环", async () => {
    const { client } = stubClient();
    const app = mkApp(client);

    // 1. 保存四要素自诊断
    const entry1 = await app.saveWrongDiagnosis("q-diag-1", {
      thought: "看漏了'不属于'选项",
      rootCause: "careless",
      rationale: "《宪法》规定",
      checklist: "至少复核两次设问",
    });

    expect(entry1.id.startsWith("diag-")).toBe(true);
    expect(entry1.rootCause).toBe("careless");

    // 2. 再次做错，追加第二次自诊断（形成版本链）
    const entry2 = await app.saveWrongDiagnosis("q-diag-1", {
      thought: "第二次做错：选项 B 和 C 混淆",
      rootCause: "concept",
    });

    // 3. 读取最新一条自诊断
    const latest = await app.getLatestDiagnosis("q-diag-1");
    expect(latest?.id).toBe(entry2.id);
    expect(latest?.rootCause).toBe("concept");

    // 4. 查看完整历史时间轴
    const history = await app.listDiagnosisHistory("q-diag-1");
    expect(history).toHaveLength(2);
    expect(history[0].thought).toContain("看漏了");
    expect(history[1].thought).toContain("第二次做错");

    // 5. 导出 Markdown 复盘卡片
    const md = await app.exportDiagnosisMarkdown("q-diag-1");
    expect(md).toContain("【个人错题自诊断复盘】");
    expect(md).toContain("概念混淆/公式记错");
    expect(md).not.toContain("标准答案"); // 安全红线

    // 6. 兼容性测试：旧版 loadWrongReflection 能读取到 thought 文本
    const legacy = await app.loadWrongReflection("q-diag-1");
    expect(legacy?.text).toBe("第二次做错：选项 B 和 C 混淆");
  });

  it("43-08：ExamApp 全库与单题区分度校准与 CSV 导出闭环", async () => {
    const q1 = { ...qWithBlock("q-disc-1"), difficulty: 3 };
    const q2 = { ...qWithBlock("q-disc-2"), difficulty: 4 };

    const client = {
      sql: async () => [],
      listQuestions: async () => [q1, q2],
      getRiffDecks: async () => [],
    } as unknown as KernelApiClient;

    const app = mkApp(client);
    app["banks"] = [{ id: "bank-disc", name: "区分度测试库", createdAt: 1 }] as never;

    await app.attempts.load("d-disc");
    // q1 作答 2 次：1对 1错
    app.attempts.append({ qid: "q-disc-1", kind: "practice", mode: "single", verdict: "correct", myAnswer: "A", sessionId: "s1" });
    app.attempts.append({ qid: "q-disc-1", kind: "practice", mode: "single", verdict: "wrong", myAnswer: "B", sessionId: "s2" });

    // 1. 单题区分度获取
    const single = await app.getItemDiscrimination("q-disc-1", "bank-disc");
    expect(single?.qid).toBe("q-disc-1");
    expect(single?.validAttempts).toBe(2);
    expect(single?.difficultyP).toBe(0.5);

    // 2. 全库体检与 CSV 导出
    const audit = await app.auditBankDiscrimination("bank-disc");
    expect(audit.totalQuestions).toBe(2);
    expect(audit.analyzedCount).toBe(1);

    const csv = await app.exportBankDiscriminationCsv("bank-disc");
    expect(csv).toContain("q-disc-1");
    expect(csv).toContain("实测通过率P");
  });

  it("54-06：ExamApp 主观题字数测算与 25×N 答题方格纸模型生成闭环", async () => {
    const { client } = stubClient();
    const app = mkApp(client);

    const text = "牢牢把握高质量发展这个首要任务，因地制宜发展新质生产力。";

    // 1. 字数测量
    const { metrics, limitStatus } = await app.measureSubjectiveAnswer(text, { maxWords: 50 });
    expect(metrics.chineseChars).toBe(26);
    expect(metrics.punctuations).toBe(2);
    expect(metrics.examWords).toBe(28);
    expect(limitStatus.state).toBe("fit");

    // 2. 25×N 机考答题纸生成
    const grid = await app.generateSubjectivePaperGrid(text, { columns: 25 });
    expect(grid.columns).toBe(25);
    expect(grid.totalWords).toBe(28);
    expect(grid.rows[0].cells).toHaveLength(25);
    // 第一行有 2 格段首缩进，第 3 格开始为文字
    expect(grid.rows[0].cells[0].isIndent).toBe(true);
    expect(grid.rows[0].cells[2].char).toBe("牢");
  });

  it("65-08：ExamApp.createAdaptiveTargetSession 能够基于考点树薄弱点组装自适应专题", async () => {
    const q1 = { ...qWithBlock("q-adapt-1"), kp: "言语/选词" };
    const q2 = { ...qWithBlock("q-adapt-2"), kp: "言语/选词" };

    const client = {
      sql: async () => [],
      listQuestions: async () => [q1, q2],
      getRiffDecks: async () => [],
    } as unknown as KernelApiClient;

    const app = mkApp(client);
    app["banks"] = [{ id: "bank-adapt", name: "自适应攻坚测试库", createdAt: 1 }] as never;

    // 记录错题，使言语/选词考点掌握度偏低
    await app.attempts.load("d-adapt");
    app.attempts.append({ qid: "q-adapt-1", kind: "practice", mode: "single", verdict: "wrong", myAnswer: "B", sessionId: "s1" });

    const session = await app.createAdaptiveTargetSession("bank-adapt", { sessionSize: 5 });
    expect(session.sessionId.startsWith("s-")).toBe(true);
    expect(session.questions.length).toBeGreaterThan(0);
    expect(session.targetKps[0].name).toBe("选词");
    expect(session.receipt).toContain("自适应攻坚专题已生成");
  });

  it("68-04 / 65-04 / 45-12：ExamApp 双栏打印Pro、可重建练习集与完整性审计闭环", async () => {
    const q1 = { ...qWithBlock("q-pro-1"), kp: "常识" };
    const q2 = { ...qWithBlock("q-pro-2"), kp: "常识" };

    const client = {
      sql: async () => [],
      listQuestions: async () => [q1, q2],
      getRiffDecks: async () => [],
    } as unknown as KernelApiClient;

    const app = mkApp(client);
    app["banks"] = [{ id: "bank-pro", name: "Pro测试库", createdAt: 1 }] as never;

    // 1. 双栏紧凑打印 HTML 生成
    const qSheet = await app.buildCompactQuestionSheet("A4双栏模考卷", "bank-pro", { columns: "double" });
    expect(qSheet).toContain("column-count: 2");
    expect(qSheet).toContain("A4双栏模考卷");
    expect(qSheet).not.toContain("标准答案"); // 安全红线

    const ansSheet = await app.buildCompactAnswerSheet("A4双栏答案册", "bank-pro");
    expect(ansSheet).toContain("A4双栏答案册 · 答案册");
    expect(ansSheet).toContain(q1.answer);

    // 2. 65-04 可重建练习集声明与重建
    const { createPracticeSetSpec } = await import("../src/core/rebuildableSet");
    const spec = createPracticeSetSpec({
      id: "set-app-1",
      name: "常识攻坚集",
      bankId: "bank-pro",
      questions: [q1, q2],
      limit: 2,
    });
    await app.savePracticeSetSpec(spec);

    const list = await app.listPracticeSetSpecs();
    expect(list.some((s) => s.id === "set-app-1")).toBe(true);

    const rebuilt = await app.rebuildPracticeSet("set-app-1");
    expect(rebuilt.questions).toHaveLength(2);
    expect(rebuilt.receipt).toContain("重建完成");

    await app.deletePracticeSetSpec("set-app-1");
    expect(await app.loadPracticeSetSpec("set-app-1")).toBeNull();

    // 3. 45-12 数据完整性自检与导出
    const report = await app.auditIntegrity("bank-pro");
    expect(report.healthy).toBe(true);
    expect(report.receipt).toContain("完整性自检通过");

    const integrityCsv = await app.exportIntegrityCsv("bank-pro");
    expect(integrityCsv.startsWith("\uFEFF")).toBe(true);
    expect(integrityCsv).toContain("问题代码");
  });

  it("51-07：ExamApp.assessSyllabusChange 考纲换版影响评估与 Markdown 报告闭环", async () => {
    const q1 = { ...qWithBlock("q-syl-1"), kp: "法律基础/民法典旧篇/总则" };
    const client = {
      sql: async () => [],
      listQuestions: async () => [q1],
      getRiffDecks: async () => [],
    } as unknown as KernelApiClient;

    const app = mkApp(client);
    app["banks"] = [{ id: "bank-syl", name: "考纲测试库", createdAt: 1 }] as never;

    const { parseSyllabus } = await import("../src/core/syllabus");
    // 旧版包含法律基础/民法典旧篇，新版删除了该分支
    const oldRoots = parseSyllabus("# 法律基础\n## 民法典旧篇");
    const newRoots = parseSyllabus("# 政治理论\n## 马克思主义哲学\n# 法律法规\n## 宪法");

    const impact = await app.assessSyllabusChange(newRoots, "bank-syl", { oldSyllabusDoc: oldRoots });
    expect(impact.affectedQuestions.length).toBeGreaterThanOrEqual(1);
    expect(impact.affectedQuestions[0].qid).toBe("q-syl-1");
    expect(impact.receipt).toContain("考纲换版影响评估完成");

    const md = await app.exportSyllabusDiffMarkdown(newRoots, "bank-syl", { oldSyllabusDoc: oldRoots });
    expect(md).toContain("# 考纲大纲换版影响评估报告");
    expect(md).toContain("q-syl-1");
  });

  it("52-05：ExamApp 干扰项误概念对照与认知诊断闭环", async () => {
    const q1 = qWithBlock("q-misc-1");
    const client = {
      sql: async () => [],
      listQuestions: async () => [q1],
      getRiffDecks: async () => [],
    } as unknown as KernelApiClient;

    const app = mkApp(client);
    app["banks"] = [{ id: "bank-misc", name: "认知诊断库", createdAt: 1 }] as never;

    await app.attempts.load("d-misc");
    // 重复选错 B 选项 2 次
    app.attempts.append({ qid: "q-misc-1", kind: "practice", mode: "single", verdict: "wrong", myAnswer: "B", sessionId: "s1" });
    app.attempts.append({ qid: "q-misc-1", kind: "practice", mode: "single", verdict: "wrong", myAnswer: "B", sessionId: "s2" });

    const misconceptions = [
      {
        letter: "B",
        concept: "概念混淆",
        trapDescription: "反向诱导陷阱",
        counterRule: "核对正向推导",
      },
    ];

    const diag = await app.diagnoseQuestionMisconceptions("q-misc-1", misconceptions, "bank-misc");
    expect(diag?.repeatedErrorFound).toBe(true);
    expect(diag?.items[0].letter).toBe("B");
    expect(diag?.items[0].isRepeatedError).toBe(true);

    const md = await app.exportQuestionMisconceptionMarkdown("q-misc-1", misconceptions, "bank-misc");
    expect(md).toContain("【干扰项易错概念与认知对照】");
    expect(md).toContain("高频重复错因");
    expect(md).toContain("概念混淆");
  });

  it("120-04：ExamApp 原文高亮切片与阅读笔记渐进式制卡出题闭环", async () => {
    const { client } = stubClient();
    const app = mkApp(client);

    // 1. 从原文切片中提取填空卡与判断卡
    const excerptSource = {
      text: "宪法规定：国家维护社会主义法制的统一和尊严。==一国两制==是国家的基本国策。误区：特别行政区享有完全自治权并非没有中央事权。",
      materialId: "mat-app-1",
      materialTitle: "宪法学精讲",
      tags: ["宪法/制度"],
    };

    const resExcerpt = await app.extractCardsFromExcerpt(excerptSource);
    expect(resExcerpt.stats.total).toBeGreaterThanOrEqual(1);
    expect(resExcerpt.questions.some((q) => q.type === "fill")).toBe(true);

    // 2. 从学习笔记持久化提取
    const note = await app.addMaterialNote({
      materialId: "mat-app-1",
      revision: 1,
      text: "我国的根本政治制度是==人民代表大会制度==。法律面前人人平等是指法律适用平等并非立法平等。",
      locator: { type: "page", page: 42 },
      tags: ["政治学/制度"],
    });
    expect(note.id).toBeTruthy();

    const resNotes = await app.extractCardsFromNotes("mat-app-1");
    expect(resNotes.stats.total).toBeGreaterThanOrEqual(1);

    // 3. 导出 Markdown 与 CSV 卡包
    const cardsMd = await app.exportCardsMarkdown(resNotes);
    expect(cardsMd).toContain("# 渐进式笔记制卡");
    expect(cardsMd).toContain("【填空卡】");

    const cardsCsv = await app.exportCardsCsv(resNotes);
    expect(cardsCsv.startsWith("\uFEFF")).toBe(true);
    expect(cardsCsv).toContain("人民代表大会制度");
  });

  it("121-04：ExamApp 备考完备度多维体检与考点盲区雷达闭环", async () => {
    const q1 = { ...qWithBlock("q-ready-1"), kp: "刑法/总则/犯罪构成" };
    const q2 = { ...qWithBlock("q-ready-2"), kp: "民法/物权/所有权" };
    const client = {
      sql: async () => [],
      listQuestions: async () => [q1, q2],
      getRiffDecks: async () => [],
    } as unknown as KernelApiClient;

    const app = mkApp(client);
    app["banks"] = [{ id: "bank-ready", name: "备考完备度测试库", createdAt: 1 }] as never;

    await app.attempts.load("d-ready");
    app.attempts.append({ qid: "q-ready-1", kind: "practice", mode: "single", verdict: "correct", sessionId: "s1" });
    app.attempts.append({ qid: "q-ready-2", kind: "practice", mode: "single", verdict: "wrong", sessionId: "s1" });

    // 生成完备度报告
    const report = await app.generateReadinessReport("bank-ready");
    expect(Object.keys(report.dimensions).length).toBe(5);
    expect(report.overallScore).toBeGreaterThan(0);
    expect(["S", "A", "B", "C", "D"]).toContain(report.grade);
    expect(report.blindspots.length).toBeGreaterThan(0);

    // 导出 Markdown
    const md = await app.exportReadinessReportMarkdown("bank-ready");
    expect(md).toContain("# 🎯 备考完备度体检与考点盲区诊断报告");
    expect(md).toContain("五维体检雷达指标");
    expect(md).toContain("考点盲区扫描清单");

    // 导出 CSV
    const csv = await app.exportReadinessReportCsv("bank-ready");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("考点名称");
    expect(csv).toContain("风险等级");
  });

  it("121-05：ExamApp OCR 试题解析与数学公式清洗呈现闭环", async () => {
    const client = {
      sql: async () => [],
      listQuestions: async () => [],
      assetOcr: async (_path: string) => ({
        text: `1. 设函数 \\( f(x) = x^2 \\)，求 $f(2)$。\nA. 2\nB. 4\n【答案】B\n【解析】$f(2) = 2^2 = 4$。`,
        ocrJSON: null,
      }),
    } as unknown as KernelApiClient;

    const app = mkApp(client);

    // 1. 本地纯文本 OCR 结构化解析
    const q1 = await app.parseOcrTextToQuestion("1. 测试题干\nA. 甲\nB. 乙\n【答案】A");
    expect(q1.stem).toBe("测试题干");
    expect(q1.options).toEqual(["甲", "乙"]);
    expect(q1.answer).toBe("A");

    // 2. 模拟内核 assetOcr 链路调用
    const q2 = await app.ocrAndParseQuestion("assets/photo-q.png");
    expect(q2.stem).toContain("$f(x) = x^2$");
    expect(q2.options).toEqual(["2", "4"]);
    expect(q2.answer).toBe("B");
    expect(q2.analysis).toContain("$f(2) = 2^2 = 4$");

    // 3. 数学公式规范化与渲染
    const norm = await app.normalizeFormula("\\( \\ frac { 1 } { 2 } \\)");
    expect(norm).toBe("$\\frac{1}{2}$");

    const html = await app.renderFormula("计算 $x^2$");
    expect(html).toContain('class="lv-math-expr lv-math-inline"');
  });
});
