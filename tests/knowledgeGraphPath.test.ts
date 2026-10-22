import { describe, expect, it } from "vitest";
import type { BlockQuestion } from "../src/core/blockTemplate";
import type { AttemptEvent } from "../src/core/attempt";
import type { KpRelation } from "../src/core/kpRelations";
import {
  buildKnowledgeGraph,
  findRootBlockers,
  planClearancePath,
  exportClearanceGuideMarkdown,
  exportClearancePathCsv,
  renderKnowledgeGraphMermaid,
} from "../src/core/knowledgeGraphPath";

function makeQuestion(id: string, kp: string, stem: string): BlockQuestion {
  return {
    id,
    type: "single",
    stem,
    options: ["选项A", "选项B"],
    answer: "A",
    analysis: `解析：${stem}`,
    kp,
    tags: [],
    updatedAt: 1000,
  };
}

function makeAttempt(
  questionId: string,
  kp: string,
  correct: boolean,
  timestamp: number,
): AttemptEvent {
  return {
    v: 2,
    id: `att-${questionId}-${timestamp}`,
    questionId,
    timestamp,
    durationMs: 15000,
    userAnswer: correct ? "A" : "B",
    correct,
    bankId: "test-bank",
    kp,
    mode: "practice",
  };
}

describe("knowledgeGraphPath (考点拓扑因果与靶向通关规划)", () => {
  it("构建标准前修后继 DAG 并正确计算掌握度与爆炸半径", () => {
    // 关系：线性代数基础(A) -> 矩阵变换(B) -> 线性回归(C)
    //        微积分基础(D) -> 梯度下降(E) -> 线性回归(C)
    const relations: KpRelation[] = [
      { from: "线性代数基础", to: "矩阵变换", kind: "prerequisite" },
      { from: "矩阵变换", to: "线性回归", kind: "prerequisite" },
      { from: "微积分基础", to: "梯度下降", kind: "prerequisite" },
      { from: "梯度下降", to: "线性回归", kind: "prerequisite" },
    ];

    const questions: BlockQuestion[] = [
      makeQuestion("q1", "线性代数基础", "向量点积计算"),
      makeQuestion("q2", "矩阵变换", "矩阵乘法与逆矩阵"),
      makeQuestion("q3", "线性回归", "最小二乘法参数估计"),
      makeQuestion("q4", "微积分基础", "求导法则"),
      makeQuestion("q5", "梯度下降", "学习率与梯度更新"),
    ];

    // 做题记录：
    // 线性代数基础：错 3 次，对 0 次 -> weak
    // 矩阵变换：没做过 -> unpracticed
    // 微积分基础：对 3 次 -> mastered
    // 梯度下降：对 1 次错 1 次 -> learning
    // 线性回归：没做过 -> unpracticed
    const attempts: AttemptEvent[] = [
      makeAttempt("q1", "线性代数基础", false, 1000),
      makeAttempt("q1", "线性代数基础", false, 2000),
      makeAttempt("q1", "线性代数基础", false, 3000),
      makeAttempt("q4", "微积分基础", true, 1000),
      makeAttempt("q4", "微积分基础", true, 2000),
      makeAttempt("q4", "微积分基础", true, 3000),
      makeAttempt("q5", "梯度下降", true, 1000),
      makeAttempt("q5", "梯度下降", false, 2000),
    ];

    const graph = buildKnowledgeGraph({
      relations,
      questions,
      attempts,
    });

    expect(graph.hasCycles).toBe(false);
    expect(graph.cycleNodes).toEqual([]);
    expect(graph.nodes.size).toBe(5);

    // 验证各考点掌握度状态
    const linearBasics = graph.nodes.get("线性代数基础")!;
    expect(linearBasics.mastery).toBe("weak");
    expect(linearBasics.successors).toContain("矩阵变换");
    expect(linearBasics.blastRadius).toBeGreaterThanOrEqual(2); // 阻断了矩阵变换与线性回归
    expect(linearBasics.blockingScore).toBeGreaterThan(0);

    const calculus = graph.nodes.get("微积分基础")!;
    expect(calculus.mastery).toBe("mastered");
    expect(calculus.blockingScore).toBe(0); // 掌握了不阻断后续

    const reg = graph.nodes.get("线性回归")!;
    expect(reg.prerequisites).toEqual(expect.arrayContaining(["矩阵变换", "梯度下降"]));

    // 验证拓扑排序：前置必须出现在后置之前
    const order = graph.topologicalOrder;
    expect(order.indexOf("线性代数基础")).toBeLessThan(order.indexOf("矩阵变换"));
    expect(order.indexOf("矩阵变换")).toBeLessThan(order.indexOf("线性回归"));
    expect(order.indexOf("微积分基础")).toBeLessThan(order.indexOf("梯度下降"));
    expect(order.indexOf("梯度下降")).toBeLessThan(order.indexOf("线性回归"));

    // 统计摘要
    expect(graph.summary.totalKps).toBe(5);
    expect(graph.summary.masteredKps).toBe(1);
    expect(graph.summary.weakKps).toBe(1);
    expect(graph.summary.learningKps).toBe(1);
    expect(graph.summary.unpracticedKps).toBe(2);
  });

  it("能安全检测并自动熔断环路 (A -> B -> C -> A)", () => {
    const relations: KpRelation[] = [
      { from: "考点A", to: "考点B", kind: "prerequisite" },
      { from: "考点B", to: "考点C", kind: "prerequisite" },
      { from: "考点C", to: "考点A", kind: "prerequisite" },
      { from: "考点D", to: "考点A", kind: "prerequisite" },
    ];

    const graph = buildKnowledgeGraph({
      relations,
      questions: [
        makeQuestion("qA", "考点A", "A题"),
        makeQuestion("qB", "考点B", "B题"),
        makeQuestion("qC", "考点C", "C题"),
        makeQuestion("qD", "考点D", "D题"),
      ],
      attempts: [],
    });

    expect(graph.hasCycles).toBe(true);
    expect(graph.cycleNodes.length).toBeGreaterThan(0);
    expect(graph.cycleNodes).toContain("考点A");
    expect(graph.cycleNodes).toContain("考点B");
    expect(graph.cycleNodes).toContain("考点C");

    // 拓扑排序不因死循环崩溃，包含所有节点
    expect(graph.topologicalOrder.length).toBe(4);
    expect(graph.topologicalOrder).toContain("考点A");
    expect(graph.topologicalOrder).toContain("考点D");
  });

  it("识别关键阻断型根因考点 (Root Blockers)", () => {
    const relations: KpRelation[] = [
      { from: "核心底层A", to: "进阶B1", kind: "prerequisite" },
      { from: "核心底层A", to: "进阶B2", kind: "prerequisite" },
      { from: "核心底层A", to: "进阶B3", kind: "prerequisite" },
      { from: "独立考点C", to: "衍生D", kind: "prerequisite" },
    ];

    const questions: BlockQuestion[] = [
      makeQuestion("qA", "核心底层A", "底层原理"),
      makeQuestion("qB1", "进阶B1", "应用1"),
      makeQuestion("qB2", "进阶B2", "应用2"),
      makeQuestion("qB3", "进阶B3", "应用3"),
      makeQuestion("qC", "独立考点C", "独立"),
    ];

    const attempts: AttemptEvent[] = [
      makeAttempt("qA", "核心底层A", false, 1000),
      makeAttempt("qA", "核心底层A", false, 2000),
      makeAttempt("qC", "独立考点C", false, 1000),
    ];

    const graph = buildKnowledgeGraph({ relations, questions, attempts });
    const blockers = findRootBlockers(graph, { minBlastRadius: 1 });

    expect(blockers.length).toBeGreaterThan(0);
    // 核心底层A 阻断了 3 个后续节点，其 blockingScore 应排在最前
    expect(blockers[0].kp).toBe("核心底层A");
    expect(blockers[0].blastRadius).toBe(3);
    expect(blockers[0].blockingScore).toBeGreaterThan(graph.nodes.get("独立考点C")?.blockingScore ?? 0);
  });

  it("规划靶向通关路径并生成逆向分阶段导学案 (Target Clearance Path)", () => {
    // 基础A -> 进阶B -> 终极C
    const relations: KpRelation[] = [
      { from: "基础A", to: "进阶B", kind: "prerequisite" },
      { from: "进阶B", to: "终极C", kind: "prerequisite" },
      { from: "无关D", to: "无关E", kind: "prerequisite" },
    ];

    const questions: BlockQuestion[] = [
      makeQuestion("qA1", "基础A", "基础A题1"),
      makeQuestion("qA2", "基础A", "基础A题2"),
      makeQuestion("qB1", "进阶B", "进阶B题1"),
      makeQuestion("qC1", "终极C", "终极C综合题"),
      makeQuestion("qD1", "无关D", "无关题"),
    ];

    const attempts: AttemptEvent[] = [
      makeAttempt("qA1", "基础A", false, 1000),
    ];

    const graph = buildKnowledgeGraph({ relations, questions, attempts });

    // 针对终极C 进行靶向通关规划
    const plan = planClearancePath(graph, "终极C");

    expect(plan.targetKp).toBe("终极C");
    // 不应包含无关考点 D 和 E
    expect(plan.stages.flatMap((s) => s.kps.map((k) => k.kp))).not.toContain("无关D");
    expect(plan.stages.flatMap((s) => s.kps.map((k) => k.kp))).not.toContain("无关E");

    // 检查分阶段学习顺序：先修在先，目标在最后阶段
    expect(plan.stages.length).toBeGreaterThanOrEqual(2);
    const firstStageKps = plan.stages[0].kps.map((k) => k.kp);
    expect(firstStageKps).toContain("基础A");

    const lastStageKps = plan.stages[plan.stages.length - 1].kps.map((k) => k.kp);
    expect(lastStageKps).toContain("终极C");

    // 预估时长与总题量
    expect(plan.totalQuestions).toBe(4); // qA1, qA2, qB1, qC1
    expect(plan.estimatedMinutes).toBeGreaterThan(0);
    expect(plan.blockerKps).toContain("基础A");

    // Markdown 导出测试
    const markdown = exportClearanceGuideMarkdown(plan);
    expect(markdown).toContain("# 靶向通关导学案：终极C");
    expect(markdown).toContain("基础A");
    expect(markdown).toContain("阶段 1");

    // CSV 导出测试
    const csv = exportClearancePathCsv(plan);
    expect(csv).toContain("Stage,KP,Mastery,QuestionsCount,BlockingScore,IsBlocker");
    expect(csv).toContain("基础A");
    expect(csv).toContain("终极C");
  });

  it("导出高质量 Mermaid 知识网络流程图", () => {
    const relations: KpRelation[] = [
      { from: "高等数学", to: "概率论", kind: "prerequisite" },
      { from: "线性代数", to: "主成分分析", kind: "prerequisite" },
      { from: "概率论", to: "贝叶斯网络", kind: "prerequisite" },
    ];

    const questions: BlockQuestion[] = [
      makeQuestion("q1", "高等数学", "微积分"),
      makeQuestion("q2", "概率论", "条件概率"),
      makeQuestion("q3", "线性代数", "特征值"),
    ];

    const attempts: AttemptEvent[] = [
      makeAttempt("q1", "高等数学", true, 1000),
      makeAttempt("q1", "高等数学", true, 2000),
      makeAttempt("q2", "概率论", false, 1000),
    ];

    const graph = buildKnowledgeGraph({ relations, questions, attempts });
    const mermaid = renderKnowledgeGraphMermaid(graph, { direction: "LR" });

    expect(mermaid).toContain("graph LR");
    expect(mermaid).toContain("高等数学");
    expect(mermaid).toContain("概率论");
    expect(mermaid).toContain("classDef mastered");
    expect(mermaid).toContain("classDef weak");
  });
});
