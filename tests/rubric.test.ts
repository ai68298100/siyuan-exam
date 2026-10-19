import { describe, it, expect } from "vitest";
import {
  DEFAULT_RUBRIC_LEVELS,
  RUBRIC_MIN_CRITERIA,
  RUBRIC_MAX_CRITERIA,
  RUBRIC_VERSION,
  parseRubricAttr,
  normalizeRubricWeights,
  validateRubric,
  parseRubricFromText,
  formatRubricToText,
  levelRatioOf,
  scoreRubric,
  createRubricAssessmentSnapshot,
  isRubricDrifted,
  exportRubricBreakdownCsv,
  rubricSummaryText,
  type RubricSpec,
  type RubricCriterion,
} from "../src/core/rubric";

describe("55-05 主观采分点与自评（Subjective Rubric）", () => {
  /** 典型三段采分点：40/30/30，满分 10 */
  const makeSpec = (over: Partial<RubricSpec> = {}): RubricSpec => ({
    v: 1,
    kind: "rubric",
    fullScore: 10,
    criteria: normalizeRubricWeights([
      { id: "c1", label: "核心观点", weight: 4 },
      { id: "c2", label: "论证结构", weight: 3 },
      { id: "c3", label: "语言表达", weight: 3 },
    ]),
    ...over,
  });

  describe("normalizeRubricWeights 权重归一", () => {
    it("权重合计归一到 1", () => {
      const out = normalizeRubricWeights([
        { id: "a", label: "A", weight: 4 },
        { id: "b", label: "B", weight: 3 },
        { id: "c", label: "C", weight: 3 },
      ]);
      const total = out.reduce((s, c) => s + c.weight, 0);
      expect(total).toBeCloseTo(1, 6);
      expect(out.map((c) => c.weight)).toEqual([0.4, 0.3, 0.3]);
    });

    it("全零权重时等权分配（不产生 NaN）", () => {
      const out = normalizeRubricWeights([
        { id: "a", label: "A", weight: 0 },
        { id: "b", label: "B", weight: 0 },
      ]);
      expect(out.map((c) => c.weight)).toEqual([0.5, 0.5]);
    });

    it("空数组返回空（不抛异常）", () => {
      expect(normalizeRubricWeights([])).toEqual([]);
    });

    it("负权重与非法权重按 0 处理", () => {
      const out = normalizeRubricWeights([
        { id: "a", label: "A", weight: -3 },
        { id: "b", label: "B", weight: NaN },
        { id: "c", label: "C", weight: 2 },
      ]);
      expect(out.find((c) => c.id === "c")?.weight).toBe(1);
    });
  });

  describe("parseRubricAttr / validateRubric 解析与校验", () => {
    it("解析合法 rubric JSON 并归一权重", () => {
      const raw = JSON.stringify({
        v: 1,
        kind: "rubric",
        fullScore: 10,
        revision: 2,
        criteria: [
          { id: "c1", label: "观点", weight: 6 },
          { id: "c2", label: "结构", weight: 4 },
        ],
      });
      const spec = parseRubricAttr(raw);
      expect(spec?.criteria.length).toBe(2);
      expect(spec?.revision).toBe(2);
      expect(spec?.criteria.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 6);
    });

    it("版本不符/kind 不符/非 JSON/空 criteria 均返回 undefined", () => {
      expect(parseRubricAttr(undefined)).toBeUndefined();
      expect(parseRubricAttr("")).toBeUndefined();
      expect(parseRubricAttr("not json")).toBeUndefined();
      expect(parseRubricAttr(JSON.stringify({ v: 2, kind: "rubric", criteria: [{ label: "x" }] }))).toBeUndefined();
      expect(parseRubricAttr(JSON.stringify({ v: 1, kind: "other", criteria: [{ label: "x" }] }))).toBeUndefined();
      expect(parseRubricAttr(JSON.stringify({ v: 1, kind: "rubric", criteria: [] }))).toBeUndefined();
    });

    it("过滤空白描述采分点，缺失 id 自动补连续 cN（无编号空洞）", () => {
      const spec = parseRubricAttr(
        JSON.stringify({ v: 1, kind: "rubric", fullScore: 5, criteria: [{ label: "  " }, { label: "有效点" }] }),
      );
      expect(spec?.criteria.length).toBe(1);
      expect(spec?.criteria[0].id).toBe("c1");
      expect(spec?.criteria[0].label).toBe("有效点");
    });

    it("validateRubric 拦截数量越界与重复 id", () => {
      expect(RUBRIC_MIN_CRITERIA).toBe(2);
      expect(RUBRIC_MAX_CRITERIA).toBe(5);
      const tooFew = makeSpec({ criteria: [{ id: "c1", label: "仅一个", weight: 1 }] });
      expect(validateRubric(tooFew).some((x) => x.includes("至少"))).toBe(true);

      const six = makeSpec({
        criteria: normalizeRubricWeights(
          Array.from({ length: 6 }, (_, i) => ({ id: `c${i + 1}`, label: `点${i + 1}`, weight: 1 })),
        ),
      });
      expect(validateRubric(six).some((x) => x.includes("最多"))).toBe(true);

      const dup = makeSpec({
        criteria: normalizeRubricWeights([
          { id: "c1", label: "甲", weight: 1 },
          { id: "c1", label: "乙", weight: 1 },
        ]),
      });
      expect(validateRubric(dup).some((x) => x.includes("重复"))).toBe(true);
    });

    it("合法 rubric 无问题；null/版本不符如实报告", () => {
      expect(validateRubric(makeSpec())).toEqual([]);
      expect(validateRubric(null).length).toBe(1);
      expect(validateRubric({ v: 1, kind: "rubric", fullScore: 10, criteria: [] } as RubricSpec).length).toBeGreaterThan(0);
    });
  });

  describe("parseRubricFromText / formatRubricToText 作者录入往返", () => {
    it("解析 描述|权重|参考要点 三列格式，支持注释与空行", () => {
      const text = [
        "# 本题采分点",
        "核心观点 | 4 | 点明三方关系",
        "",
        "论证结构 | 3",
        "语言表达 | 3 | 术语准确",
      ].join("\n");
      const spec = parseRubricFromText(text, 10, 1);
      expect(spec?.criteria.length).toBe(3);
      expect(spec?.criteria[0].label).toBe("核心观点");
      expect(spec?.criteria[0].example).toBe("点明三方关系");
      expect(spec?.criteria.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 6);
      expect(spec?.revision).toBe(1);
    });

    it("省略权重时等权；非法权重返回 null（不静默吞掉）", () => {
      const even = parseRubricFromText("甲\n乙", 10);
      expect(even?.criteria.map((c) => c.weight)).toEqual([0.5, 0.5]);
      expect(parseRubricFromText("甲 | 不是数字", 10)).toBeNull();
    });

    it("空文本/全注释返回 null", () => {
      expect(parseRubricFromText("", 10)).toBeNull();
      expect(parseRubricFromText("# 只有注释\n\n", 10)).toBeNull();
    });

    it("formatRubricToText 输出可被 parseRubricFromText 往返还原", () => {
      const spec = parseRubricFromText("核心观点 | 4 | 要点\n论证结构 | 3\n语言表达 | 3", 10)!;
      const roundTrip = parseRubricFromText(formatRubricToText(spec), 10);
      expect(roundTrip?.criteria.map((c) => c.label)).toEqual(spec.criteria.map((c) => c.label));
      expect(roundTrip?.criteria.map((c) => c.weight)).toEqual(spec.criteria.map((c) => c.weight));
    });
  });

  describe("levelRatioOf 等级占比", () => {
    const c: RubricCriterion = { id: "c1", label: "点", weight: 1 };

    it("默认三档为 1 / 0.5 / 0，unknown 为 null", () => {
      expect(DEFAULT_RUBRIC_LEVELS.map((l) => l.ratio)).toEqual([1, 0.5, 0]);
      expect(levelRatioOf(c, "full")).toBe(1);
      expect(levelRatioOf(c, "partial")).toBe(0.5);
      expect(levelRatioOf(c, "none")).toBe(0);
      expect(levelRatioOf(c, "unknown")).toBeNull();
    });

    it("采分点自定义等级覆盖默认", () => {
      const custom: RubricCriterion = {
        ...c,
        levels: [
          { key: "full", label: "优秀", ratio: 1 },
          { key: "partial", label: "尚可", ratio: 0.7 },
          { key: "none", label: "不足", ratio: 0.1 },
        ],
      };
      expect(levelRatioOf(custom, "partial")).toBe(0.7);
      expect(levelRatioOf(custom, "none")).toBe(0.1);
    });

    it("自定义等级缺失某档时回退默认表（避免作者只定义一档就丢分）", () => {
      const partialTable: RubricCriterion = { ...c, levels: [{ key: "full", label: "优秀", ratio: 1 }] };
      expect(levelRatioOf(partialTable, "none")).toBe(0);
    });

    it("自定义档位比例被夹取到 0-1", () => {
      const over: RubricCriterion = { ...c, levels: [{ key: "full", label: "x", ratio: 3 }] };
      expect(levelRatioOf(over, "full")).toBe(1);
    });
  });

  describe("scoreRubric 自评计分与未评隔离", () => {
    it("全评满分：三段全对得满分，complete 且 finalScore 非空", () => {
      const r = scoreRubric(makeSpec(), [
        { criterionId: "c1", rating: "full" },
        { criterionId: "c2", rating: "full" },
        { criterionId: "c3", rating: "full" },
      ]);
      expect(r.complete).toBe(true);
      expect(r.earned).toBe(10);
      expect(r.finalScore).toBe(10);
      expect(r.unratedCount).toBe(0);
      expect(r.ratedPercent).toBe(100);
    });

    it("部分满足按等级比例与权重计分（4/3/3 → 4+1.5+0=5.5）", () => {
      const r = scoreRubric(makeSpec(), [
        { criterionId: "c1", rating: "full" },
        { criterionId: "c2", rating: "partial" },
        { criterionId: "c3", rating: "none" },
      ]);
      expect(r.earned).toBe(5.5);
      expect(r.finalScore).toBe(5.5);
    });

    it("未评采分点不计入分母、不折成 0：单人未评时 finalScore 为 null", () => {
      const r = scoreRubric(makeSpec(), [
        { criterionId: "c1", rating: "full" },
        { criterionId: "c2", rating: "unknown" },
      ]);
      expect(r.unratedCount).toBe(2); // c2 显式 unknown + c3 未提供
      expect(r.complete).toBe(false);
      expect(r.finalScore).toBeNull();
      expect(r.ratedMax).toBe(4); // 只算已评的 c1
      expect(r.ratedPercent).toBe(100); // 部分视图：已评部分全对
      const c2 = r.breakdown.find((b) => b.criterionId === "c2");
      expect(c2?.earned).toBeNull();
    });

    it("完全未评：unratedCount=全部、ratedPercent=null、earned=0 但 finalScore=null", () => {
      const r = scoreRubric(makeSpec(), []);
      expect(r.unratedCount).toBe(3);
      expect(r.earned).toBe(0);
      expect(r.ratedMax).toBe(0);
      expect(r.ratedPercent).toBeNull();
      expect(r.finalScore).toBeNull();
      expect(r.complete).toBe(false);
    });

    it("每分能回到采分点：breakdown 携带 label/weight/earned/max 与自评依据", () => {
      const r = scoreRubric(makeSpec(), [
        { criterionId: "c1", rating: "full", note: "点明了三段论" },
        { criterionId: "c2", rating: "partial" },
        { criterionId: "c3", rating: "none" },
      ]);
      const c1 = r.breakdown.find((b) => b.criterionId === "c1")!;
      expect(c1.label).toBe("核心观点");
      expect(c1.weight).toBe(0.4);
      expect(c1.earned).toBe(4);
      expect(c1.max).toBe(4);
      expect(c1.note).toBe("点明了三段论");
      expect(r.breakdown.map((b) => b.label)).toEqual(["核心观点", "论证结构", "语言表达"]);
    });

    it("spec.fullScore 为 0 时用题目分值兜底", () => {
      const spec = makeSpec({ fullScore: 0 });
      const r = scoreRubric(spec, [
        { criterionId: "c1", rating: "full" },
        { criterionId: "c2", rating: "full" },
        { criterionId: "c3", rating: "full" },
      ], 20);
      expect(r.fullScore).toBe(20);
      expect(r.finalScore).toBe(20);
    });

    it("未提供的采分点 id（脏数据）视为未评，不误计分", () => {
      const r = scoreRubric(makeSpec(), [
        { criterionId: "c1", rating: "full" },
        { criterionId: "c2", rating: "full" },
        { criterionId: "c3", rating: "full" },
        { criterionId: "ghost", rating: "full" },
      ]);
      expect(r.finalScore).toBe(10);
      expect(r.breakdown.length).toBe(3);
    });

    it("单采分点权重为 0 时该点满分 0、不影响其他点", () => {
      const spec: RubricSpec = {
        v: 1,
        kind: "rubric",
        fullScore: 10,
        criteria: [
          { id: "c1", label: "主点", weight: 1 },
          { id: "c2", label: "辅助", weight: 0 },
        ],
      };
      const r = scoreRubric(spec, [
        { criterionId: "c1", rating: "full" },
        { criterionId: "c2", rating: "none" },
      ]);
      expect(r.breakdown.find((b) => b.criterionId === "c2")?.max).toBe(0);
      expect(r.finalScore).toBe(10);
    });
  });

  describe("历史冻结（55-05）", () => {
    it("快照冻结 rubric 修订号与逐点得分", () => {
      const spec = makeSpec({ revision: 3 });
      const r = scoreRubric(spec, [
        { criterionId: "c1", rating: "full" },
        { criterionId: "c2", rating: "partial" },
        { criterionId: "c3", rating: "none" },
      ]);
      const snap = createRubricAssessmentSnapshot(r, spec);
      expect(snap.v).toBe(1);
      expect(snap.rubricRevision).toBe(3);
      expect(snap.finalScore).toBe(5.5);
      expect(snap.criteria.map((c) => c.criterionId)).toEqual(["c1", "c2", "c3"]);
    });

    it("作者改 rubric 修订号 → 检出漂移（历史自评分不被静默重算）", () => {
      const spec = makeSpec({ revision: 3 });
      const snap = createRubricAssessmentSnapshot(
        scoreRubric(spec, [
          { criterionId: "c1", rating: "full" },
          { criterionId: "c2", rating: "full" },
          { criterionId: "c3", rating: "full" },
        ]),
        spec,
      );
      expect(isRubricDrifted(spec, snap)).toBe(false);
      expect(isRubricDrifted({ ...spec, revision: 4 }, snap)).toBe(true);
    });

    it("采分点标签或权重变化也检出漂移", () => {
      const spec = makeSpec({ revision: 3 });
      const snap = createRubricAssessmentSnapshot(
        scoreRubric(spec, [
          { criterionId: "c1", rating: "full" },
          { criterionId: "c2", rating: "full" },
          { criterionId: "c3", rating: "full" },
        ]),
        spec,
      );
      const renamed = { ...spec, criteria: spec.criteria.map((c) => (c.id === "c1" ? { ...c, label: "改名了" } : c)) };
      expect(isRubricDrifted(renamed, snap)).toBe(true);
    });

    it("缺 spec 或快照时无漂移、不误报", () => {
      expect(isRubricDrifted(null, null)).toBe(false);
      const spec = makeSpec();
      const snap = createRubricAssessmentSnapshot(scoreRubric(spec, []), spec);
      expect(isRubricDrifted(null, snap)).toBe(false);
      expect(isRubricDrifted(spec, null)).toBe(false);
    });
  });

  describe("导出与摘要（45-08 文本等价物）", () => {
    it("CSV 含 BOM、未评显式标注、诚实说明", () => {
      const r = scoreRubric(makeSpec(), [
        { criterionId: "c1", rating: "full", note: "有依据" },
        { criterionId: "c2", rating: "unknown" },
      ]);
      const csv = exportRubricBreakdownCsv(r);
      expect(csv.startsWith("\uFEFF")).toBe(true);
      expect(csv).toContain("最终自评分,未评完");
      expect(csv).toContain("未评");
      expect(csv).toContain("不是官方阅卷结论");
      expect(csv).toContain('"有依据"');
    });

    it("CSV 对全评完给最终分并区分 0 分与未评", () => {
      const r = scoreRubric(makeSpec(), [
        { criterionId: "c1", rating: "none" },
        { criterionId: "c2", rating: "none" },
        { criterionId: "c3", rating: "none" },
      ]);
      const csv = exportRubricBreakdownCsv(r);
      expect(csv).toContain("最终自评分,0");
      expect(csv).not.toContain("未评完");
      expect(r.finalScore).toBe(0);
    });

    it("摘要区分「最终自评分」与「部分自评」，并声明非官方", () => {
      const full = rubricSummaryText(
        scoreRubric(makeSpec(), [
          { criterionId: "c1", rating: "full" },
          { criterionId: "c2", rating: "full" },
          { criterionId: "c3", rating: "full" },
        ]),
      );
      expect(full).toContain("最终自评分：10 / 10");
      expect(full).toContain("不代表官方阅卷");

      const partial = rubricSummaryText(
        scoreRubric(makeSpec(), [{ criterionId: "c1", rating: "full" }]),
      );
      expect(partial).toContain("部分自评");
      expect(partial).toContain("未评");
    });
  });

  describe("常量契约", () => {
    it("RUBRIC_VERSION 为 1（信封版本与 answerSpec v1 对齐）", () => {
      expect(RUBRIC_VERSION).toBe(1);
    });
  });
});
