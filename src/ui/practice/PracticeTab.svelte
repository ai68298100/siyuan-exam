<script lang="ts">
    // 练习台：入口(S1) / 会话(S2) / 浏览(S3) / 导入(S9) 四视图
    // 状态设计（docs/11）：loading/empty(守卫)/error/normal 四态可达
    import { onMount, tick } from "svelte";
import { showMessage } from "siyuan";
    import { planToday, parseExamProfiles, nearestUpcoming, nextPlanTrace } from "@/core/planner";
import { ttsSpeak } from "@/core/tts";
    import type { ExamApp } from "../../app";
    import type { Question } from "../../core/types";
    import { parseText, parseExcelRows, autoMapExcel, errorsToCsv, extractTextRowAt, type ImportReport } from "../../importer/pipeline";
    import { columnLabel, autoAssignment, assignmentFromMap, assignmentToMap, assignmentErrors, emptyAssignment, type MapAssignment } from "../../importer/mapping";
    import { formatSecToTime, parseTimeToSec, locatorLabel, locatedUrl, needsRelocate, revisionStale } from "@/core/materialNotes";
    import { groupAdjacent } from "../../core/session";
    import { makeQuestion } from "../../core/blockTemplate";
    import { normalizeAnswer, questionHash } from "../../core/answer";
    import { specOf, splitBlanks, joinBlanks } from "../../core/structuredAnswer";
    import { startTrail, recordEdit, trailValue, trailChanged, withLastEditReason, type AnswerTrail } from "../../core/answerTrail";
    import { helpFromExposure } from "../../core/exposure";
    import { abandonedExposureInputs } from "../../core/exposure";
    import { randomSeedId } from "../../core/random";
    import { ELIMINATE_STREAK, localDate, streak, wrongReasonMix } from "../../core/replayer";
    import { recentlySeen } from "../../core/exposure";
    import { validate } from "../../importer/pipeline";
    import { bankHealthReport, coverageStats, answerDistribution, unreviewedStats, type BankHealthReport } from "../../core/bankHealth";
    import { planBatchEdit, invertPlan, describeChange } from "../../core/batchEdit";
    import { buildSectionTree, questionInSection } from "../../core/sectionTree";
    import { upsertView, viewBankMismatch } from "@/core/smartViews";
    import { avgMsByType, estimatePlanMinutes } from "@/core/timeBudget";
    import { kpAudit, planKpMerge, planEmptyKpFill } from "@/core/kpGovernance";
    import { coverageTree, subtreeCount, subtreeLearned, subtreeNoSource, gapsToCsv } from "@/core/syllabus";
    import { parseErrataCsv, planErrata, errataTemplateCsv } from "@/core/errata";
    import { buildQuestionSheet, buildAnswerSheet, buildAnswerCardSheet } from "@/core/printSheet";
    import { parsePaperAnswers, gradePaper } from "@/core/paperRecall";
    import { probeCheckinApi, syncCheckin, localDateKeyOf, bridgeEnabled, fetchStreak } from "@/core/checkinBridge";
    import { probeGlean, listLaterClips, formatClipsForSource, markClipDone, type GleanClip } from "@/core/gleanBridge";
    import { resolveLink } from "@/core/externalLinks";
    import { redactUrlForDisplay } from "@/core/urlRedaction";
    import { onExamEvent, emitExamEvent } from "@/core/bus";
    import Icon from "../shared/Icon.svelte";
    import Palette from "../shared/Palette.svelte";
    import type { PaletteCommand } from "../shared/Palette.svelte";
    import { SvelteMap, SvelteSet } from "svelte/reactivity";
    import Rail from "../shared/Rail.svelte";
    import { escapeHtml, renderInlineText } from "../../libs/sanitize";
    import { questionFingerprint } from "@/ai/task";
    import { summarizeLoad } from "@/ai/flashCandidates";
    import { resolveAiKey } from "@/ai/secrets";
    import SaveStatus from "../shared/SaveStatus.svelte";
    import { SAMPLE_BANK_NAME, SAMPLE_QUESTION_COUNT } from "@/core/sampleBank";
    import { answerChoices, isChoiceQuestion, removeChoiceOption, toggleChoice } from "@/core/answerChoices";
    import { consumePendingPracticeView, isCurrentPracticeViewRequest } from "@/core/pluginTab";
    import { dailyTrend } from "@/core/weekly";
    import { playSuccessChime, playCelebrationChord } from "@/libs/sound";

    let { plugin, examApp }: { plugin: any; examApp?: ExamApp | null } = $props();
    let appOverride = $state<ExamApp | null>(null);
    const app = $derived<ExamApp | null>(appOverride ?? examApp ?? plugin?.examApp ?? null);
    const i18n = $derived(plugin?.i18n ?? {});
    const t = (k: string, fb = "") => i18n[k] ?? fb;

    // localStorage is optional in private/embedded modes. Keep preferences
    // best-effort so a blocked browser store cannot break the practice tab.
    const readLocal = (key: string): string | null => {
      try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
    };
    const writeLocal = (key: string, value: string): boolean => {
      try { globalThis.localStorage?.setItem(key, value); return true; } catch { return false; }
    };
    const removeLocal = (key: string): void => {
      try { globalThis.localStorage?.removeItem(key); } catch { /* optional */ }
    };

    type View = "entry" | "session" | "browse" | "import" | "recite" | "manual" | "ai" | "materials" | "wrongbook";
    let view: View = $state("entry");
    let soundEnabled = $state(readLocal("lv-exam/sound") !== "0");
    let hotkeysHelpOpen = $state(false);
    let loading = $state(true);
    let appliedPracticeViewRequestId = "";
    let tabRoot = $state<HTMLDivElement | null>(null);
    let errorMsg = $state("");
    let banks = $state<any[]>([]);
    let activeBankId = $state("");
    /** 上次使用题库的记忆键（localStorage；多库切换与重载恢复） */
    const BANK_PREF_KEY = "lv-exam/activeBank";
    let questions = $state<(Question & { blockId: string; rootId: string })[]>([]);
    let questionsError = $state("");
    let questionsLoaded = $state(false);
    let questionLoadSeq = 0;

    // 背诵态（S4 lite）：盖答案 → 四级自评
    let reciteQueue = $state<Question[]>([]);
    let reciteCursor = $state(0);
    let reciteRevealed = $state(false);
    let reciteSessionId = $state("");
    let reciteDone = $state(false);
    let reciteHint = $state(0);
    let reciteSaving = $state(false);
    let reciteError = $state("");
    let reciteRatings = $state<number[]>([]);

    // 会话态
    let session = $state<any>(null);
    let feedback = $state<null | { verdict: string; myAnswer: string | null }>(null);
    let selected = $state<string>("");
    let answerStart = $state(0);
    /** 草稿的响应式镜像：session 类实例非响应式（$state 不代理类实例），提交键的禁用态
     *  需要跟随草稿变化——三个作答框（数值/多空/文本）oninput 时同步此镜像 */
    let draftLive = $state("");
    let resumeError = $state("");
    let exitBusy = $state(false);

    /** 43-01 lite：题目修订时间线（app.appendRevision 在编辑成功后落快照；此处只读+恢复） */
    let revOpenFor = $state("");
    let revLoaded = $state<Record<string, import("../../core/revision").QuestionRevision[]>>({});
    let revLoadingFor = $state("");
    let revLoadError = $state<Record<string, string>>({});
    let revLoadSeq = 0;
    let revRestoreKey = $state("");
    let revRestoreError = $state<Record<string, string>>({});
    let revRestoreFailedKey = $state("");
    const revList = (qid: string) => revLoaded[qid] ?? [];
    async function toggleRevisions(qid: string) {
      if (revOpenFor === qid) {
        revOpenFor = "";
        if (revLoadingFor === qid) { revLoadSeq++; revLoadingFor = ""; }
        return;
      }
      revLoadError = { ...revLoadError, [qid]: "" };
      revRestoreError = { ...revRestoreError, [qid]: "" };
      revRestoreFailedKey = "";
      revOpenFor = qid;
      if (qid in revLoaded) return;
      await loadRevisions(qid);
    }
    async function loadRevisions(qid: string) {
      const request = ++revLoadSeq;
      revLoadingFor = qid;
      revLoadError = { ...revLoadError, [qid]: "" };
      try {
        const revisions = await app.questionRevisions(qid);
        if (request === revLoadSeq) revLoaded = { ...revLoaded, [qid]: revisions };
      } catch (e) {
        if (request === revLoadSeq) {
          revLoadError = { ...revLoadError, [qid]: String(e instanceof Error ? e.message : e) };
        }
      } finally {
        if (request === revLoadSeq) revLoadingFor = "";
      }
    }
    async function restoreRevision(q: Question & { blockId: string }, rev: import("../../core/revision").QuestionRevision) {
      const key = `${q.id}#${rev.ts}`;
      if (revRestoreKey) return;
      revRestoreKey = key;
      revRestoreError = { ...revRestoreError, [q.id]: "" };
      revRestoreFailedKey = "";
      try {
        const { confirmDialogSync } = await import("../../libs/dialog");
        if (!(await confirmDialogSync({ title: t("rev.restoreTitle"), content: t("rev.restoreConfirm").replace("{a}", escapeHtml(rev.answer)) }))) return;
        const next = await app.updateQuestionContent(q, {
          stem: q.stem, options: q.options, answer: rev.answer, analysis: q.analysis ?? "", kp: rev.kp ?? q.kp ?? "", difficulty: q.difficulty,
        });
        questions = questions.map((x) => (x.id === q.id ? { ...x, ...next } : x));
        showMessage(t("rev.restored"), 2400, "info");
        try {
          revLoaded = { ...revLoaded, [q.id]: await app.questionRevisions(q.id) };
          revLoadError = { ...revLoadError, [q.id]: "" };
        } catch (e) {
          // The write succeeded; keep its success receipt separate from a later history-read failure.
          revLoadError = { ...revLoadError, [q.id]: String(e instanceof Error ? e.message : e) };
        }
      } catch (e) {
        revRestoreError = { ...revRestoreError, [q.id]: String(e instanceof Error ? e.message : e) };
        revRestoreFailedKey = key;
      } finally { revRestoreKey = ""; }
    }

    /** 63-03 改答轨迹：qid → {首答, 每次修改}。非响应式存储（仅提交时读取）；
     *  原因弹层可见性是 UI 态单独管理。上限截断/取消不记等语义在 answerTrail.ts */
    const trails = new SvelteMap<string, AnswerTrail>();
    let reasonPromptQid = $state("");
    function trailInput(qid: string, value: string) {
      const v = String(value ?? "");
      if (!v) return;
      const existing = trails.get(qid);
      if (!existing) {
        trails.set(qid, startTrail(v));
        return;
      }
      const before = trailValue(existing);
      if (v === before) return; // 取消/重复：不产生轨迹事件（63-03 边界）
      const next = recordEdit(existing, v);
      if (next !== existing) {
        trails.set(qid, next);
        if (next.edits.length > existing.edits.length) reasonPromptQid = qid; // 真实修改 → 询问原因
      }
    }
    function setEditReason(qid: string, reason: "unsure" | "evidence" | "misclick") {
      const t = trails.get(qid);
      if (t) trails.set(qid, withLastEditReason(t, reason));
      reasonPromptQid = "";
    }
    let sessionDone = $state<null | { total: number; correct: number; wrong: number; totalTimeS?: number; avgTimeS?: number }>(null);
    /** 已存错因回显（app.loadWrongReason；答错时载入，选择后即时高亮） */
    let savedReason = $state<string | undefined>(undefined);
    $effect(() => {
      const q = session?.current;
      if (feedback?.verdict === "wrong" && q) {
        void (app as any).loadWrongReason(q.id).then((r: string | undefined) => { savedReason = r; });
      } else {
        savedReason = undefined;
      }
    });

    // 守卫态
    let newBankName = $state("");
    let creating = $state(false);
    let creatingSample = $state(false);
    let bankCreateError = $state("");
    let sampleNotice = $state("");

    // 导入态
    let importText = $state("");
    let importReport = $state<ImportReport | null>(null);
    let importError = $state("");
    let committing = $state(false);
    let importParsing = $state(false);
    let importPreviewBankId = $state("");
    let trialBusy = $state(false);
    const importBusy = $derived(committing || trialBusy || importParsing);
    /** 重复合并策略（2.3/38-03）：skip=跳过（默认）/ coexist=并存（重复行照常入库）/ update=更新已有题答案解析 */
    let dupeStrategy = $state<import("../../importer/pipeline").DuplicateStrategy>("skip");
    let importResult = $state<null | { written: number; confirmed: number; missing: number; verified: boolean; cancelled?: boolean; unprocessed?: number }>(null);

    /** 答前置信自评（U12 最小）：随本次 attempt 落流水；提交后不可改写最初记录 */
    let confidenceSel = $state<"sure" | "fuzzy" | "guess" | "">("");

    // 题库健康（TODO 2.2）：重复聚类 + 缺字段清单（纯函数，浏览视图按需展开）
    let healthOpen = $state(false);
    const health = $derived<BankHealthReport | null>(healthOpen && questions.length ? bankHealthReport(questions) : null);
    // 67-03 lite：答案分布异常 + 未审校比例（题库健康面板质量卡）
    const answerDist = $derived(healthOpen && questions.length ? answerDistribution(questions) : null);
    const unreviewed = $derived(healthOpen && questions.length ? unreviewedStats(questions) : null);
    /** 43-04 lite：生产者覆盖概览（与健康面板同开）；51-03 lite：注入作答集算已学考点覆盖 */
    const coverage = $derived.by(() => {
      if (!healthOpen || !questions.length) return null;
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived 内累加集（重算即弃，非跨状态）
      const attempted = new Set<string>();
      for (const e of app.attempts.all()) {
        if (e.verdict !== "not_attempted") attempted.add(e.qid);
      }
      return coverageStats(questions, attempted);
    });

    // 每题用时显示 + 超时提示（TODO 13 组 lite）：会话作答期 1s tick；超时阈值取设置（0=关）
    let qTick = $state(0);
    $effect(() => {
      if (view !== "session" || feedback) return;
      const t = setInterval(() => { qTick++; }, 1000);
      return () => clearInterval(t);
    });
    const qElapsedS = $derived.by(() => { void qTick; return answerStart <= 0 ? 0 : Math.max(0, Math.floor((Date.now() - answerStart) / 1000)); });
    /** 会话推进版本号：PracticeSession 是类实例（$state 不代理类实例），其内部变更（next/submit）
     *  不触发模板更新——会话读数（当前题/进度）的响应式来源是本计数器。
     *  bump 点：提交后、切题后；session 变量赋值点（start/resume/discard）本身即响应式。 */
    let sessionRev = $state(0);
    /** 会话恢复/回退后从 PracticeSession 读出的草稿；不能只依赖输入框 oninput 镜像。 */
    const currentDraft = $derived.by(() => {
      void sessionRev;
      const q = session?.current;
      return q && !isChoiceQuestion(q) ? session.getDraft(q.id) : "";
    });
    const curQ = $derived.by(() => { void sessionRev; return session?.current ?? null; });
    const canSubmitAnswer = $derived(curQ && (isChoiceQuestion(curQ)
      ? !!answerChoices(curQ).length && !!selected.trim()
      : specOf(curQ)?.kind === "multiBlank"
        ? draftLive.split(";;").some((part) => !!part.trim())
        : !!draftLive.trim()));
    const curProgress = $derived.by(() => { void sessionRev; return session ? session.progress : { done: 0, total: 0 }; });
    /** 当前题的历史统计（作答次数/正确率），驱动会话侧栏"本题统计"chip */
    const curQStats = $derived.by(() => {
      void sessionRev;
      const q = curQ;
      if (!q) return null;
      return app.derived().byQuestion.get(q.id) ?? null;
    });
    /** 结算页知识点分布：按 kp 聚合本次会话的对错，帮助即时识别薄弱考点 */
    const kpBreakdown = $derived.by(() => {
      void sessionRev;
      if (!sessionDone || !session) return [];
      // 仅用于本次结算的临时聚合器，不作为组件响应式状态。
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const map = new Map<string, { kp: string; correct: number; total: number; wrong: number }>();
      for (const a of session.answered) {
        const q = questions.find((x) => x.id === a.qid);
        const key = q?.kp ?? "";
        if (!key) continue;
        const e = map.get(key) ?? { kp: key, correct: 0, total: 0, wrong: 0 };
        e.total++;
        if (a.grade.verdict === "correct") e.correct++;
        if (a.grade.verdict === "wrong") e.wrong++;
        map.set(key, e);
      }
      return [...map.values()].sort((a, b) => a.correct / a.total - b.correct / b.total);
    });
    /** 54 第三刀：数值/多空作答框——curSpec 取当前题的结构化作答规则；多空草稿按 ";;" 切分为逐空输入 */
    const curSpec = $derived.by(() => {
      void sessionRev;
      return view === "session" && session?.current ? specOf(session.current) : null;
    });
    let blankParts = $state<string[]>([]);
    let blankPartsFor = $state("");
    $effect(() => {
      const q = curQ;
      const spec = curSpec;
      if (view !== "session" || !q || spec?.kind !== "multiBlank") return;
      const position = `${session.id}:${curProgress.done}`;
      if (blankPartsFor !== position) {
        blankParts = splitBlanks(feedback?.myAnswer ?? session.getDraft(q.id) ?? "", spec.blanks.length);
        blankPartsFor = position;
      }
    });
    function setBlank(i: number, v: string) {
      const q = session?.current;
      if (!q) return;
      blankParts[i] = v;
      draftLive = joinBlanks(blankParts);
      session.setDraft(q.id, draftLive);
    }
    const qTimeoutS = $derived(Math.max(0, Number(plugin.settingUtils?.get?.("perQuestionTimeoutS") ?? 0) || 0));
    /** 44-01：反馈时机策略（默认逐题即时；勾选=会话末复盘。作答事件两种模式完全一致） */
    const feedbackMode = $derived(
      plugin.settingUtils?.get?.("feedbackEndReview") === true || plugin.settingUtils?.get?.("feedbackEndReview") === "true"
        ? "end"
        : "immediate",
    );

    // 导入批次回滚（TODO 12 组）：按 custom-exam-batch 定位块逐块删除；只动题块不动流水
    const batchList = $derived(healthOpen && questions.length ? app.listBatches(questions) : []);
    let rollbackBusy = $state("");

    async function undoBatch(batch: string) {
      const n = questions.filter((q) => q.batch === batch).length;
      // 45-04 lite：原生 confirm → 可访问确认对话框（键盘/Esc 可取消）
      const { confirmDialogSync } = await import("../../libs/dialog");
      if (!(await confirmDialogSync({
        title: t("import.rollback"),
        content: t("import.rollbackConfirm").replace("{n}", String(n)).replace("{b}", escapeHtml(batch.slice(0, 16))),
      }))) return;
      rollbackBusy = batch;
      try {
        const r = await app.rollbackBatch(activeBankId, batch);
        showMessage(t("import.rollbackDone").replace("{d}", String(r.deleted)).replace("{f}", String(r.failed)), 4600, r.failed ? "error" : "info");
        await loadQuestions();
      } catch (e) {
        showMessage(offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e), 4600, "error");
      } finally { rollbackBusy = ""; }
    }

    /** 题库 CSV 导出（TODO 8 组 lite）：官方模板表头，Excel 可直接编辑后重导入 */
    async function exportBankCsv() {
      if (!questions.length) { showMessage(t("state.emptyBank"), 2800, "info"); return; }
      const { questionsToCsv } = await import("@/core/bankCsv");
      const blob = new Blob([questionsToCsv(questions)], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `题库导出 ${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    // 批量编辑（43-06 lite）：多选 → dry-run 计划预览 → 应用 → 可撤销（逆向计划）
    let batchMode = $state(false);
    let selectedIds = $state<Record<string, boolean>>({});
    let batchField = $state<import("@/core/batchEdit").BatchField>("kp");
    let batchValue = $state("");
    let batchPreview = $state<import("@/core/batchEdit").BatchPlan | null>(null);
    let appliedChanges = $state<import("@/core/batchEdit").BatchChange[]>([]);
    let batchBusy = $state(false);
    let batchNote = $state("");
    const selectedCount = $derived(Object.keys(selectedIds).length);

    function selectAllCurrentPage() {
      const next: Record<string, boolean> = {};
      for (const q of shownQuestions) next[q.id] = true;
      selectedIds = next;
    }
    function clearSelection() {
      selectedIds = {};
    }
    let batchCardBusy = $state(false);
    async function batchConvertToCards() {
      if (!selectedCount || batchCardBusy || !activeBankId) return;
      const ids = new Set(Object.keys(selectedIds));
      const targetQuestions = questions.filter((q) => ids.has(q.id));
      if (!targetQuestions.length) return;
      batchCardBusy = true;
      try {
        const n = await app?.convertToCards(activeBankId, bankName, targetQuestions);
        showMessage(`${t("memory.toCardDone")} (${n})`, 3200, "info");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      } finally {
        batchCardBusy = false;
      }
    }

    function previewBatch() {
      batchNote = "";
      const picked = questions.filter((q) => selectedIds[q.id]);
      if (!picked.length) return;
      if (!batchValue) { batchNote = t("batch.needValue"); return; }
      batchPreview = planBatchEdit(picked, batchField, batchValue);
    }

    async function applyBatch(undo = false) {
      if (batchBusy || !app.kernelOnline) { batchNote = t("state.offlineHint"); return; }
      // 撤销基线（43-06）：优先本次会话已应用的计划；无则回退持久化的最近一次（重载后仍可撤销）
      let changes = undo ? invertPlan(appliedChanges) : batchPreview?.changes ?? [];
      if (undo && !changes.length && batchUndo && batchUndo.bankId === activeBankId) {
        changes = invertPlan(batchUndo.changes);
      }
      if (!changes.length) return;
      batchBusy = true; batchNote = "";
      try {
        const r = await app.applyBatchEdit(changes);
        batchNote = undo
          ? t("batch.undone").replace("{n}", String(r.ok)).replace("{f}", String(r.failed))
          : t("batch.applied").replace("{n}", String(r.ok)).replace("{f}", String(r.failed));
        if (undo) {
          appliedChanges = [];      // 撤销后基线清空（重置为存储基线）
          batchUndo = null;
          await saveBatchUndo();
        } else {
          appliedChanges = changes;      // 撤销基线 = 最近一次成功应用的计划
          batchUndo = { changes, bankId: activeBankId, at: Date.now() };
          await saveBatchUndo();
        }
        await loadQuestions();
      } catch (e) {
        batchNote = String(e instanceof Error ? e.message : e);
      } finally { batchBusy = false; }
    }

    /** 最近一次批量编辑的持久化（43-06 剩余）：重载后仍可逆向撤销；换库不误撤 */
    let batchUndo = $state<null | { changes: import("@/core/batchEdit").BatchChange[]; bankId: string; at: number }>(null);
    const batchUndoHere = $derived(!!batchUndo && batchUndo.bankId === activeBankId);
    async function loadBatchUndo() {
      try {
        const v = await app.loadAux<typeof batchUndo>("batchedit/last");
        batchUndo = v && Array.isArray(v.changes) ? v : null;
      } catch { batchUndo = null; }
    }
    async function saveBatchUndo() {
      try { await app.saveAux("batchedit/last", batchUndo); } catch { /* 撤销基线失败不阻断当前批量操作 */ }
    }

    // ---------- 考点治理（51-02 lite）：kp 概览/同义名合并/空考点填充（复用批量编辑 dry-run+撤销） ----------
    let kpOpen = $state(false);
    let kpMergeFrom = $state("");
    let kpMergeTo = $state("");
    let kpMergePlan = $state<import("@/core/batchEdit").BatchPlan | null>(null);
    let kpFillKp = $state("");
    let kpFillPlan = $state<import("@/core/batchEdit").BatchPlan | null>(null);
    let kpBusy = $state(false);
    let kpNote = $state("");
    const kpData = $derived(kpOpen && questions.length ? kpAudit(questions) : null);

    // ---------- 考纲对照（51-01/03 lite）：粘贴大纲 → 树 → kp 前缀覆盖、零题缺口导出 ----------
    let sylText = $state("");
    let sylPublisher = $state("");
    let sylYear = $state("");
    let sylSource = $state("");
    let sylPreviewRoots = $state<import("@/core/syllabus").SyllabusNode[] | null>(null);
    let sylError = $state("");
    let sylNote = $state("");
    const sylDoc = $derived(app ? app.syllabusDoc() : null);
    // 51-03 后半：kp → { 题数, 已独立掌握, 缺来源 }（独立=存在无受助的答对记录；练一题≠掌握节点，只报覆盖）
    const sylKpStats = $derived.by(() => {
      if (!app) return {};
      const independentCorrect = new Set(
        app.attempts.all().filter((e) => e.verdict === "correct" && !e.help).map((e) => e.qid),
      );
      const stats: Record<string, { total: number; learned: number; noSource: number }> = {};
      for (const q of questions) {
        const k = (q.kp || "").trim();
        if (!k) continue;
        const s = (stats[k] ??= { total: 0, learned: 0, noSource: 0 });
        s.total++;
        if (independentCorrect.has(q.id)) s.learned++;
        if (!q.source) s.noSource++;
      }
      return stats;
    });

    function countSyllabusNodes(nodes: import("@/core/syllabus").SyllabusNode[]): number {
      return nodes.reduce((s, n) => s + 1 + countSyllabusNodes(n.children), 0);
    }

    function previewSyllabus() {
      sylError = "";
      try {
        const roots = app.previewSyllabus(sylText);
        if (!roots.length) { sylError = t("syl.empty"); sylPreviewRoots = null; return; }
        sylPreviewRoots = roots;
      } catch (e) {
        sylError = String(e instanceof Error ? e.message : e);
      }
    }

    async function importSyllabus() {
      if (!sylPreviewRoots?.length) return;
      try {
        await app.setSyllabusDoc(
          { publisher: sylPublisher.trim() || undefined, year: sylYear.trim() || undefined, source: sylSource.trim() || undefined },
          sylPreviewRoots,
        );
        sylNote = t("syl.imported").replace("{n}", String(countSyllabusNodes(sylPreviewRoots)));
        sylPreviewRoots = null;
        sylText = "";
      } catch (e) {
        sylError = String(e instanceof Error ? e.message : e);
      }
    }

    function downloadSyllabusGaps() {
      if (!sylDoc.roots.length) return;
      const csv = "\uFEFF" + gapsToCsv(sylDoc.roots, sylKpStats);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `考纲缺口清单 ${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    // ---------- 勘误回导（57 lite）：导出模板（qid+当前值）→ 线下修订 → 回导 dry-run → 批量应用（撤销基线共用） ----------
    let errataOpen = $state(false);
    let errataPlan = $state<import("@/core/errata").ErrataPlan | null>(null);
    let errataErrors = $state<{ row: number; reason: string }[]>([]);
    let errataBusy = $state(false);
    let errataNote = $state("");

    function exportErrataTemplate() {
      const csv = "\uFEFF" + errataTemplateCsv(questions);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `勘误模板 ${bankName || "题库"} ${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    async function onErrataFile(e: Event) {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      errataBusy = true; errataNote = "";
      try {
        const text = await file.text();
        const { rows, errors } = parseErrataCsv(text);
        errataErrors = errors;
        errataPlan = rows.length ? planErrata(rows, questions as (Question & { blockId?: string })[]) : null;
      } catch (err) {
        errataErrors = [{ row: 0, reason: String(err instanceof Error ? err.message : err) }];
      } finally { errataBusy = false; }
    }

    async function applyErrata() {
      const plan = errataPlan;
      if (!plan?.changes.length || errataBusy) return;
      errataBusy = true;
      try {
        const r = await app.applyBatchEdit(plan.changes);
        // 撤销基线与批量编辑共用（43-06）：保存逆向计划，重载后可撤
        batchUndo = { changes: invertPlan(plan.changes), bankId: activeBankId, at: Date.now() };
        await saveBatchUndo();
        errataNote = t("errata.applied").replace("{ok}", String(r.ok)).replace("{f}", String(r.failed));
        errataPlan = null;
        void loadQuestions();
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      } finally { errataBusy = false; }
    }

    // ---------- 打印视图（68-01 lite）：题册/答案册分离，作用于当前筛选全集 ----------
    // 注：闭合标签经 \u003c 转义构造——Svelte 解析器对脚本内裸 "</" 敏感
    const LT = "\u003c";
    const PRINT_HOOK = `${LT}script>window.onload = function () { window.print(); }${LT}/script>`;
    const BODY_CLOSE = `${LT}/body>`;
    function printSheet(html: string) {
      const w = window.open("", "_blank");
      if (!w) { showMessage(t("print.popupBlocked"), 3600, "error"); return; }
      w.document.open();
      w.document.write(html.replace(/<\/body>/, PRINT_HOOK + BODY_CLOSE));
      w.document.close();
    }
    function printQuestionSheet() {
      if (!filteredQuestions.length) { showMessage(t("print.empty"), 2200, "info"); return; }
      printSheet(buildQuestionSheet(`${bankName} · ${t("print.sheetTitle")}`, filteredQuestions));
    }
    function printAnswerSheet() {
      if (!filteredQuestions.length) { showMessage(t("print.empty"), 2200, "info"); return; }
      printSheet(buildAnswerSheet(`${bankName} · ${t("print.sheetTitle")}`, filteredQuestions));
    }
    function printAnswerCard() {
      if (!filteredQuestions.length) { showMessage(t("print.empty"), 2200, "info"); return; }
      printSheet(buildAnswerCardSheet(`${bankName} · ${t("print.sheetTitle")}`, filteredQuestions));
    }

    // ---------- 纸笔回录（68-02 lite）：题号=作答 → 判分预览 → append 流水（mode=paper，不覆盖任何线上数据） ----------
    let paperOpen = $state(false);
    let paperText = $state("");
    let paperBusy = $state(false);
    let paperNote = $state("");
    const paperPreview = $derived.by(() => {
      if (!paperOpen || !paperText.trim()) return null;
      const { rows, errors } = parsePaperAnswers(paperText);
      const { items, outOfRange } = gradePaper(filteredQuestions, rows);
      return { errors, items, outOfRange };
    });
    async function applyPaperRecall() {
      const pv = paperPreview;
      if (!pv || paperBusy) return;
      const graded = pv.items.filter((i) => i.verdict !== "not_attempted");
      if (!graded.length) { paperNote = t("paper.none"); return; }
      paperBusy = true;
      try {
        const sessionId = `s-paper-${Date.now().toString(36)}`;
        for (const it of graded) {
          app.recordAttempt({
            qid: it.q.id, kind: "practice", mode: "paper", verdict: it.verdict,
            myAnswer: it.given, sessionId, queue: "normal",
          });
        }
        dataRev++;
        plugin.refreshDock?.();
        paperText = "";
        paperNote = t("paper.applied").replace("{n}", String(graded.length));
      } finally { paperBusy = false; }
    }

    function previewKpMerge() {
      kpNote = "";
      const from = kpMergeFrom.trim();
      const to = kpMergeTo.trim();
      if (!from || !to) { kpNote = t("kp.needBoth"); return; }
      if (from === to) { kpNote = t("kp.sameValue"); return; }
      kpMergePlan = planKpMerge(questions, from, to).plan;
    }
    function previewKpFill() {
      kpNote = "";
      if (!kpFillKp.trim()) { kpNote = t("kp.needBoth"); return; }
      kpFillPlan = planEmptyKpFill(questions, kpFillKp.trim()).plan;
    }
    /** 应用治理变更：与批量编辑共用 SaveGate 闸与撤销基线（撤销走同一 batchedit/last） */
    async function applyKpPlan(plan: import("@/core/batchEdit").BatchPlan) {
      if (kpBusy || !app.kernelOnline) { kpNote = t("state.offlineHint"); return; }
      if (!plan.changes.length) return;
      kpBusy = true; kpNote = "";
      try {
        const r = await app.applyBatchEdit(plan.changes);
        kpNote = t("batch.applied").replace("{n}", String(r.ok)).replace("{f}", String(r.failed));
        batchUndo = { changes: plan.changes, bankId: activeBankId, at: Date.now() };
        await saveBatchUndo();
        kpMergePlan = null; kpFillPlan = null;
        await loadQuestions();
      } catch (e) {
        kpNote = String(e instanceof Error ? e.message : e);
      } finally { kpBusy = false; }
    }

    const bankName = $derived(banks.find((b) => b.id === activeBankId)?.name ?? "");
    const hasBank = $derived(banks.length > 0);
    const offline = $derived(!app?.kernelOnline);
    /** onMount 注册的窗口事件监听清理（Svelte onMount 返回值与内部 async 冲突时用变量中转） */
    let onMountCleanup: (() => void) | null = null;
    onMount(() => () => {
      onMountCleanup?.(); onMountCleanup = null;
      clearReciteSubmitTimer();
      clearMoreFocusTimer();
    });

    // ---------- 题目编辑（43-01 lite：块菜单「编辑」→ 浏览视图内联表单） ----------
    let editingId = $state("");
    let editBusy = $state(false);
    let editError = $state("");
    let editDraft = $state<{ stem: string; options: string[]; answer: string; analysis: string; kp: string; difficulty: string; answerSpec?: import("../../core/structuredAnswer").NumericAnswerSpec } | null>(null);
    let editSpecOpen = $state(false);
    let editSpecUnit = $state("");
    let editSpecAbsTol = $state("");
    let editSpecRelPct = $state("");
    let editSpecAltUnits = $state("");
    /** 规格字段 ↔ spec 对象（编辑表单用；作者留空且原无 spec → undefined 保持自动识别） */
    function specFromEditFields(): import("../../core/structuredAnswer").NumericAnswerSpec | undefined {
      const abs = parseFloat(editSpecAbsTol);
      const rel = parseFloat(editSpecRelPct) / 100;
      const unit = editSpecUnit.trim();
      const alts = editSpecAltUnits.split(/[，,;；]/).map((x) => x.trim()).filter(Boolean);
      if (!Number.isFinite(abs) && !Number.isFinite(rel) && !unit && !alts.length) return undefined;
      const spec: import("../../core/structuredAnswer").NumericAnswerSpec = { v: 1, kind: "numeric" };
      if (Number.isFinite(abs) && abs > 0) spec.absTol = abs;
      if (Number.isFinite(rel) && rel > 0) spec.relTolerance = rel;
      if (unit) spec.unit = unit;
      if (alts.length) spec.altUnits = alts.map((u) => ({ unit: u, factor: 1 }));
      return spec;
    }
    function loadSpecFields(spec: import("../../core/structuredAnswer").AnswerSpec | undefined) {
      editSpecUnit = spec?.kind === "numeric" ? (spec.unit ?? "") : "";
      editSpecAbsTol = spec?.kind === "numeric" && spec.absTol != null ? String(spec.absTol) : "";
      editSpecRelPct = spec?.kind === "numeric" && spec.relTolerance != null ? String(Math.round(spec.relTolerance * 10000) / 100) : "";
      editSpecAltUnits = spec?.kind === "numeric" ? (spec.altUnits?.map((a) => a.unit).join(", ") ?? "") : "";
    }

    function openEditForm(q: Question) {
      editError = "";
      editingId = q.id;
      editDraft = {
        stem: q.stem,
        options: [...q.options],
        answer: q.answer,
        analysis: q.analysis ?? "",
        kp: q.kp ?? "",
        difficulty: q.difficulty != null ? String(q.difficulty) : "",
        // 编辑表单只编辑数值规格；多空规格原样保留（specFromEditFields 不产出 multiBlank）
        answerSpec: q.answerSpec?.kind === "numeric" ? q.answerSpec : undefined,
      };
      loadSpecFields(q.answerSpec);
      editSpecOpen = !!q.answerSpec;
    }
    function closeEditForm() {
      editingId = ""; editDraft = null; editError = "";
    }
    async function saveEdit(q: Question & { blockId: string }) {
      if (!editDraft || editBusy) return;
      if (!editDraft.stem.trim()) { editError = t("edit.needStem"); return; }
      if (q.type !== "material" && !editDraft.answer.trim()) { editError = t("edit.needAnswer"); return; }
      editBusy = true; editError = "";
      try {
        const next = await app.updateQuestionContent(q, {
          stem: editDraft.stem.trim(),
          options: editDraft.options,
          answer: editDraft.answer.trim(),
          analysis: editDraft.analysis.trim(),
          kp: editDraft.kp.trim(),
          difficulty: editDraft.difficulty ? parseInt(editDraft.difficulty, 10) || undefined : undefined,
          // 54-02：编辑表单的作者规格（打开时自现有 spec 读入；留空字段=清除回自动识别）
          answerSpec: specFromEditFields(),
        });
        questions = questions.map((x) => (x.id === q.id ? { ...x, ...next } : x));
        closeEditForm();
        showMessage(t("edit.saved"), 2800, "info");
      } catch (e) {
        editError = offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e);
      } finally { editBusy = false; }
    }

    // ---------- 章节树过滤（TODO 2.2：notebook→doc→heading） ----------
    let sectionOpen = $state(false);
    let sectionTree = $state<import("@/core/sectionTree").DocNode[]>([]);
    let sectionSel = $state<import("@/core/sectionTree").SectionRef | null>(null);
    let sectionBusy = $state(false);
    const sectionLabel = $derived.by(() => {
      if (!sectionSel) return "";
      if (sectionSel.kind === "doc") return sectionTree.find((d) => d.id === sectionSel!.id)?.title ?? sectionSel.hpath;
      const walk = (ns: import("@/core/sectionTree").HeadingNode[]): string | null => {
        for (const n of ns) {
          if (n.hpath === sectionSel!.hpath) return n.text;
          const hit = walk(n.children);
          if (hit) return hit;
        }
        return null;
      };
      for (const d of sectionTree) {
        const hit = walk(d.children);
        if (hit) return hit;
      }
      return sectionSel.hpath;
    });

    async function toggleSectionTree() {
      sectionOpen = !sectionOpen;
      if (sectionOpen && !sectionTree.length && activeBankId) {
        sectionBusy = true;
        try {
          const tr = await app.docTree(activeBankId);
          sectionTree = buildSectionTree(tr.docs, tr.headings);
        } catch { sectionTree = []; }
        finally { sectionBusy = false; }
      }
    }

    onMount(() => {
      let appInitStarted = false;
      const initAppData = () => {
        if (!app || appInitStarted) return;
        appInitStarted = true;
        errorMsg = "";
        void (async () => {
          try { explainHistory = (await app.loadAux<Record<string, import("@/ai/client").AiMessage[]>>("ai/explain-history")) ?? {}; } catch { /* 忽略 */ }
          await restoreAiQueue();
          await loadMappings();
          await loadSmartViews();
          await loadBatchUndo();
          await loadAiTaskLog();
          void retryCheckinPending().catch((e: unknown) => showMessage(String(e instanceof Error ? e.message : e), 3600, "error")); // 48-03：上次未写入的打卡事件原引用补写
          void loadCheckinStreak(); // 48-04 lite：桥开启时读连续天数（只读投影）
          // 45-06：恢复未提交的录题草稿（切视图/重载不丢输入）
          try {
            const d = await app.loadAux<
              | { type: string; stem: string; options: string[]; answer: string; analysis: string; kp: string; source: string; group: string; specOpen?: boolean; specUnit?: string; specAbsTol?: string; specRelPct?: string; specAltUnits?: string }
              | undefined>("draft/manual");
            if (d?.stem?.trim()) {
              mType = (d.type as typeof mType) ?? "single";
              mStem = d.stem; mOptions = d.options?.length ? d.options : ["", ""];
              mAnswer = d.answer ?? ""; mAnalysis = d.analysis ?? "";
              mKp = d.kp ?? ""; mSource = d.source ?? ""; mGroup = d.group ?? "";
              mSpecOpen = d.specOpen ?? false; mSpecUnit = d.specUnit ?? ""; mSpecAbsTol = d.specAbsTol ?? ""; mSpecRelPct = d.specRelPct ?? ""; mSpecAltUnits = d.specAltUnits ?? "";
              draftRestored = true;
            }
          } catch { /* 草稿读取失败静默 */ }
        })();
        banks = app.listBanks();
        // 记忆上次使用的题库：重载后回落 banks[0] 会静默切换库（真机走查发现）
        const rememberedBank = readLocal(BANK_PREF_KEY);
        const pendingPracticeView = (plugin as any).pendingPracticeView as import("@/core/pluginTab").PracticeViewRequest | undefined;
        const pendingPracticeViewIsCurrent = pendingPracticeView?.id === (plugin as any).practiceViewRequestId;
        const pendingViewBankId = pendingPracticeViewIsCurrent ? pendingPracticeView?.bankId : undefined;
        const pendingPracticeBankId = (plugin as any).pendingPracticeBankId as string | undefined;
        if (pendingViewBankId && banks.some((b) => b.id === pendingViewBankId)) activeBankId = pendingViewBankId;
        else if (pendingPracticeBankId && banks.some((b) => b.id === pendingPracticeBankId)) activeBankId = pendingPracticeBankId;
        else if (rememberedBank && banks.some((b) => b.id === rememberedBank)) activeBankId = rememberedBank;
        else if (banks.length) activeBankId = banks[0].id;
        // 首次打开已有题库也要先读回题目，避免首页把可练入口误显示为禁用。
        if (activeBankId) void refreshQuestionsAfterWrite(0);
        if (activeBankId) rememberBank(activeBankId);

        // 恢复未完成会话（37-05：校验题库归属，缺题剔除后提示）
        app.resumeSession(async (qids) => {
          const all = await loadQuestions();
          return qids.map((id) => all.find((q) => q.id === id)).filter(Boolean) as Question[];
        }, activeBankId).then((s) => {
          if (s) {
            s.advancePastAnswered();                       // 37-05：恢复跳过已答位置防双计
            if (s.allAnswered()) sessionDone = s.finish();
            session = s; view = "session";
            sessionRev++;
            restoreQuestionControls();
            if (app.lastResumeMissing.length) showMessage(t("resume.missing").replace("{n}", String(app.lastResumeMissing.length)), 4200, "info");
          }
          rebuildPlan();
          loading = false;
        }).catch(() => { loading = false; });
      };

      if (app) {
        initAppData();
      } else {
        loading = true;
      }
      /** Dock/块菜单 → 单题会话（qid 定位；首次挂载 questions 未加载，先按库拉取） */
      async function startSingleById(pid: string) {
        if (!pid) return false;
        const all = questions.length ? questions : await loadQuestions();
        const q = all.find((x) => x.id === pid);
        if (!q) { showMessage(t("query.empty"), 3200, "info"); return true; }
        if (!(await negotiateStart([q], "wrong"))) return true;
        feedback = null; selected = ""; confidenceSel = ""; sessionDone = null; view = "session";
        return true;
      }
      /** 块菜单「在练习台打开/编辑」→ 浏览视图按 qid 聚焦（题目在其它库时自动切库） */
      async function focusInBrowse(pid: string, edit: boolean, bankId?: string) {
        if (!pid) return;
        if (bankId && bankId !== activeBankId && banks.some((b) => b.id === bankId)) activeBankId = bankId;
        const all = await loadQuestions();
        sectionSel = null;
        setSearch(pid);
        view = "browse";
        loading = false;
        const q = all.find((x) => x.id === pid);
        if (!q) { showMessage(t("query.empty"), 3200, "info"); return; }
        expandedId = q.id;
        if (edit) openEditForm(q);
      }
      // 40-05：已开 Tab 时 pending* 字段无人消费 → 经 lv-exam:* 总线补齐移交（信封 v1，未知版本不投递）
      const onOpenQ = (env: import("@/core/bus").BusEvent<{ qid: string }>) => void startSingleById(env.payload.qid);
      const onBrowseQ = (env: import("@/core/bus").BusEvent<{ qid: string; bank?: string }>) =>
        void focusInBrowse(env.payload.qid, false, env.payload.bank);
      const onEditQ = (env: import("@/core/bus").BusEvent<{ qid: string; bank?: string }>) =>
        void focusInBrowse(env.payload.qid, true, env.payload.bank);
      const onOpenPracticeQuestions = (env: import("@/core/bus").BusEvent<{ qids: string[]; bank: string }>) => {
        const pending = (plugin as any).pendingPractice as Question[] | undefined;
        const samePending = pending?.length === env.payload.qids.length && pending.every((q, i) => q.id === env.payload.qids[i]);
        if (samePending && (plugin as any).pendingPracticeBankId === env.payload.bank) {
          (plugin as any).pendingPractice = undefined;
          (plugin as any).pendingPracticeBankId = undefined;
        }
        void startExternalPractice(env.payload.qids, env.payload.bank);
      };
      // 稳定入口深链（window.siyuanExam.wrongbook → 错题本视图；新开与已开 Tab 同路径）
      function applyMaterialRequest(request: import("@/core/pluginTab").PracticeViewRequest | undefined) {
        if (!request?.sourceText || request.view !== "ai") return;
        aiSource = request.sourceText;
        const sourceLabel = request.sourceKind === "document" ? t("ai.sourceFromDocument") : t("ai.sourceFromBlock");
        aiSourceOrigin = request.sourceTitle
          ? `${sourceLabel.replace("{title}", request.sourceTitle)}${request.sourceTruncated ? ` · ${t("ai.sourceTruncated").replace("{n}", String(request.sourceText.length))}` : ""}`
          : "";
        if (!aiKp.trim() && request.sourceTitle) aiKp = request.sourceTitle;
      }
      const onOpenView = (env: import("@/core/bus").BusEvent<{ view: string; requestId?: string }>) => {
        if (!tabRoot?.isConnected) return;
        const next = env.payload.view;
        if (!["wrongbook", "entry", "browse", "manual", "import", "ai", "materials", "recite"].includes(next)) return;
        let request: import("@/core/pluginTab").PracticeViewRequest | undefined;
        const requestId = env.payload.requestId;
        if (requestId) {
          if (!isCurrentPracticeViewRequest(plugin, requestId) || requestId === appliedPracticeViewRequestId) return;
          appliedPracticeViewRequestId = requestId;
          request = consumePendingPracticeView(plugin);
        }
        applyMaterialRequest(request);
        loading = false;
        dataRev++;
        switchView(next as View);
        const requestedBankId = request?.bankId;
        if (requestedBankId && banks.some((b) => b.id === requestedBankId) && requestedBankId !== activeBankId) {
          activeBankId = requestedBankId;
          rememberBank(activeBankId);
          questions = [];
          questionsLoaded = false;
          sectionSel = null;
        }
        if (typeof request?.search === "string") {
          clearBrowseFilters();
          setSearch(request.search);
        }
        if (["wrongbook", "entry", "browse"].includes(next)) void loadQuestions();
      };
      // 应用层派生缓存失效：会话结算 / 错题处置后刷新驾驶舱 widgets 与错题本列表（见 dataRev 注）
      const onDataChanged = () => { dataRev++; };
      const onAppReady = () => {
        appOverride = plugin?.examApp ?? null;
        if (appOverride) initAppData();
      };
      const offs = [
        onExamEvent("app-ready", onAppReady),
        onExamEvent("open-question", onOpenQ),
        onExamEvent("open-practice-questions", onOpenPracticeQuestions),
        onExamEvent("open-in-browse", onBrowseQ),
        onExamEvent("edit-question", onEditQ),
        onExamEvent("open-view", onOpenView),
        onExamEvent("session-ended", onDataChanged),
        onExamEvent("wrongbook-changed", onDataChanged),
      ];
      onMountCleanup = () => offs.forEach((off) => off());
      const pendingView = consumePendingPracticeView(plugin);
      const initialView = pendingView?.view ?? (plugin as any).pendingInitialView as string | undefined;
      if (["wrongbook", "entry", "browse", "manual", "import", "ai", "materials", "recite"].includes(initialView ?? "")) {
        (plugin as any).pendingInitialView = undefined;
        if (pendingView) appliedPracticeViewRequestId = pendingView.id;
        applyMaterialRequest(pendingView);
        loading = false;
        switchView(initialView as View);
        if (typeof pendingView?.search === "string") {
          clearBrowseFilters();
          setSearch(pendingView.search);
        }
        return;
      }
      // Dock 信号优先：按 qid 直达单题
      const pid = (plugin as any).pendingQuestionId as string | undefined;
      if (pid) {
        (plugin as any).pendingQuestionId = undefined;
        loading = false;
        void startSingleById(pid);
        return;
      }

    // 查询圈题待处理集（块菜单发起，优先于恢复）
      const pending = (plugin as any).pendingPractice as Question[] | undefined;
      if (pending?.length) {
        (plugin as any).pendingPractice = undefined;
        const pendingBankId = (plugin as any).pendingPracticeBankId as string | undefined;
        (plugin as any).pendingPracticeBankId = undefined;
        void startExternalPractice(pending.map((q) => q.id), pendingBankId);
        return;
      }
      // 块菜单「在练习台打开 / 编辑」→ 浏览视图聚焦（优先于会话恢复）
      const pBrowse = (plugin as any).pendingBrowseQid as string | undefined;
      const pEdit = (plugin as any).pendingEditQid as string | undefined;
      if (pBrowse || pEdit) {
        (plugin as any).pendingBrowseQid = undefined;
        (plugin as any).pendingEditQid = undefined;
        const bank = ((plugin as any).pendingBrowseBank ?? (plugin as any).pendingEditBank) as string | undefined;
        (plugin as any).pendingBrowseBank = undefined;
        (plugin as any).pendingEditBank = undefined;
        void focusInBrowse((pBrowse ?? pEdit)!, pEdit != null, bank);
        return;
      }
    });

    async function loadQuestions(): Promise<Question[]> {
      if (!activeBankId) { questionsLoaded = true; return []; }
      const requestId = ++questionLoadSeq;
      const bankId = activeBankId;
      questionsError = "";
      try {
        const loaded = await app.listQuestions(bankId);
        // 快速连续切库时，只允许最后一次读取更新页面，防止旧库结果覆盖新库。
        if (requestId !== questionLoadSeq || bankId !== activeBankId) return [];
        questions = loaded;
        rebuildQrefView();
        return questions;
      } catch (e) {
        if (requestId !== questionLoadSeq || bankId !== activeBankId) return [];
        // 不保留上一题库的快照，否则读取失败时模式按钮仍会显示为可用并启动旧题。
        questions = [];
        questionsError = String(e instanceof Error ? e.message : e);
        return [];
      } finally {
        if (requestId === questionLoadSeq && bankId === activeBankId) questionsLoaded = true;
      }
    }

    async function retryEntryLoad() {
      loading = true;
      await loadQuestions();
      rebuildPlan();
      loading = false;
    }

    async function refreshQuestionsAfterWrite(minCount: number) {
      const bankId = activeBankId;
      for (let attempt = 0; attempt < 6; attempt++) {
        if (bankId !== activeBankId) break;
        await loadQuestions();
        if (bankId !== activeBankId) break;
        if (questionsError || questions.length >= minCount) break;
        if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 700));
      }
      rebuildPlan();
    }

    // ---------- 题目↔资料关联（120-05 lite）：题目回 PDF 页/视频时间点；快照式视图保响应 ----------
    let qrefView = $state<Record<string, { title: string; label: string; stale: boolean } | null>>({});
    let qrefFormFor = $state("");
    let qrefMatId = $state("");
    let qrefPage = $state("");
    let qrefTime = $state("");
    let qrefError = $state("");
    let qrefBusyFor = $state("");
    let qrefActionError = $state<Record<string, string>>({});

    function qrefSnapshot(qid: string) {
      const ref = app.questionMaterialRef(qid);
      if (!ref) return null;
      const m = app.listMaterials().find((x) => x.id === ref.materialId);
      return {
        title: m?.title ?? "?",
        label: locatorLabel(ref.locator),
        stale: revisionStale(ref.revision, m?.revision ?? ref.revision),
      };
    }
    function rebuildQrefView() {
      const next: Record<string, { title: string; label: string; stale: boolean } | null> = {};
      for (const q of questions) next[q.id] = qrefSnapshot(q.id);
      qrefView = next;
    }
    function refreshQref(qid: string) {
      qrefView = { ...qrefView, [qid]: qrefSnapshot(qid) };
    }
    function startQrefForm(qid: string) {
      qrefFormFor = qid; qrefError = "";
      const ref = app.questionMaterialRef(qid);
      qrefMatId = ref?.materialId ?? "";
      qrefPage = ref?.locator?.page != null ? String(ref.locator.page) : "";
      qrefTime = ref?.locator?.tSec != null ? formatSecToTime(ref.locator.tSec) : "";
    }
    async function saveQref(qid: string) {
      if (!qrefMatId || qrefBusyFor) return;
      qrefError = "";
      qrefBusyFor = qid;
      try {
        const page = qrefPage.trim() ? Number(qrefPage) : undefined;
        if (qrefPage.trim() && (!Number.isInteger(page) || page! < 1)) throw new Error(t("materials.badPage"));
        const tSec = qrefTime.trim() ? parseTimeToSec(qrefTime) : undefined;
        const locator = page == null && tSec == null ? null : { page, tSec };
        const r = await app.linkQuestionMaterial(qid, qrefMatId, locator);
        qrefFormFor = ""; refreshQref(qid);
        showMessage(r.replaced ? t("qref.relinked") : t("qref.linked"), 2000, "info");
      } catch (e) {
        qrefError = String(e instanceof Error ? e.message : e);
      } finally { qrefBusyFor = ""; }
    }
    async function removeQref(qid: string) {
      if (qrefBusyFor) return;
      qrefBusyFor = qid;
      qrefActionError = { ...qrefActionError, [qid]: "" };
      try {
        const { confirmDialogSync } = await import("../../libs/dialog");
        if (!(await confirmDialogSync({ title: t("qref.unlinkTitle"), content: t("qref.unlinkConfirm") }))) return;
        await app.unlinkQuestionMaterial(qid);
        refreshQref(qid);
        showMessage(t("qref.unlinked"), 2200, "info");
      } catch (e) {
        qrefActionError = { ...qrefActionError, [qid]: String(e instanceof Error ? e.message : e) };
      } finally { qrefBusyFor = ""; }
    }
    function openQref(qid: string) {
      const ref = app.questionMaterialRef(qid);
      const m = ref ? app.listMaterials().find((x) => x.id === ref.materialId) : null;
      const url = locatedUrl(m ? app.resolveMaterialUrlOf(m, window.location.origin) : null, ref?.locator ?? null);
      if (!url) { showMessage(t("materials.cannotOpen"), 2400, "error"); return; }
      if (m) { void gatedOpen(url, m); return; } // 73-02：link 类经隐私闸
      window.open(url, "_blank", "noopener");
    }

    // ---------- 作答回执下钻（U14 lite：当时作答/判定/信心/受助/先回忆/用时；错题回执可接 AI 错因假设） ----------
    let receiptOpenFor = $state("");
    let receiptCache = $state<import("../../core/types").AttemptEvent[]>([]);
    let receiptBusy = $state("");
    let receiptMisdiagnosis = $state<Record<string, string>>({});
    let receiptStored = $state<{ text: string; at: number; adoptedAt?: number } | null>(null);

    function toggleReceipts(qid: string) {
      receiptOpenFor = receiptOpenFor === qid ? "" : qid;
      if (receiptOpenFor) {
        receiptCache = app.attempts.all().filter((e) => e.qid === qid).slice(-10).reverse();
        // U14：上次 AI 假设（独立存储）回显——与用户复盘分层展示
        const rec = app.latestMisdiagnosis(qid);
        receiptStored = rec ? { text: rec.text, at: rec.at, adoptedAt: rec.adoptedAt } : null;
      }
    }

    /** 按选定回执（而非当前会话）做错因假设：证据取自该次作答事件本身（U14 口径） */
    async function runReceiptMisdiagnosis(q: Question, e: import("../../core/types").AttemptEvent) {      const key = `${e.qid}#${e.seq}`;
      if (receiptBusy || !app.kernelOnline) return;
      receiptBusy = key;
      try {
        const { SiyuanAiChannel, OpenAiChannel } = await import("@/ai/client");
        const { buildMisdiagnosisMessages } = await import("@/ai/misdiagnosis");
        const { AiTaskRunner, questionFingerprint } = await import("@/ai/task");
        const endpoint = String(plugin.settingUtils?.get?.("aiEndpoint") ?? "");
        const key2 = resolveAiKey(plugin);
        const model = String(plugin.settingUtils?.get?.("aiModel") ?? "gpt-4o-mini");
        const ch = endpoint && key2
          ? new OpenAiChannel({ endpoint, apiKey: key2, model }, (u, i) => fetch(u, i))
          : new SiyuanAiChannel((app as any).deps.client);
        const messages = buildMisdiagnosisMessages(q, {
          myAnswer: e.myAnswer ?? null,
          confidence: e.confidence,
          timeMs: e.timeMs,
          helped: !!e.help,
          userThought: reflections[e.qid]?.text,
        });
        const reqCtx: import("@/ai/task").AiTaskContext = {
          templateId: "practice.misdiagnosis",
          templateVersion: 1,
          qid: e.qid,
          questionRevision: questionFingerprint(q),
          learnerAnswer: e.myAnswer ?? null,
          submitted: true,
          mode: "practice",
          sessionId: e.sessionId,
        };
        const env = await new AiTaskRunner(ch).run(reqCtx, messages);
        void logAiTask({ templateId: env.templateId, qid: e.qid, status: env.status, tokens: env.tokens, messages });
        if (env.status === "ok" && env.data.text) {
          receiptMisdiagnosis = { ...receiptMisdiagnosis, [key]: env.data.text };
          void app.recordAiUsage(ch.id, env.tokens, 1).catch(() => undefined);
          // U14：按该次回执的证据独立落库
          void app.saveMisdiagnosis({
            qid: e.qid,
            text: env.data.text,
            at: Date.now(),
            sessionId: e.sessionId,
            templateVersion: 1,
            evidence: { myAnswer: e.myAnswer ?? null, confidence: e.confidence, timeMs: e.timeMs, helped: !!e.help },
          }).catch(() => { /* 持久化失败不阻断展示 */ });
        } else {
          showMessage(envStatusLine(env), 3600, "error");
        }
      } catch (err) {
        showMessage(String(err instanceof Error ? err.message : err), 3600, "error");
      } finally { receiptBusy = ""; }
    }

    // ---------- AI 闪卡候选（116-03 T10：最小卡/拆卡理由；先展示卡数/负荷/来源，确认后才建卡） ----------
    let flashBusy = $state("");
    let flashCandidates = $state<Record<string, import("@/ai/flashCandidates").FlashCandidateResult>>({});
    let flashError = $state<Record<string, string>>({});

    async function makeFlashCandidates(q: Question) {
      if (flashBusy || !app.kernelOnline) {
        if (!app.kernelOnline) showMessage(t("state.offlineHint"), 2400, "info");
        return;
      }
      flashBusy = q.id;
      try {
        const { SiyuanAiChannel, OpenAiChannel } = await import("@/ai/client");
        const { buildFlashCandidateMessages, parseFlashCandidates, findCardLeaks } = await import("@/ai/flashCandidates");
        const { AiTaskRunner, questionFingerprint } = await import("@/ai/task");
        const endpoint = String(plugin.settingUtils?.get?.("aiEndpoint") ?? "");
        const key = resolveAiKey(plugin);
        const model = String(plugin.settingUtils?.get?.("aiModel") ?? "gpt-4o-mini");
        const ch = endpoint && key
          ? new OpenAiChannel({ endpoint, apiKey: key, model }, (u, i) => fetch(u, i))
          : new SiyuanAiChannel((app as any).deps.client);
        const reflection = (await app.loadWrongReflection(q.id))?.text;
        const messages = buildFlashCandidateMessages(q, { reflection });
        const reqCtx: import("@/ai/task").AiTaskContext = {
          templateId: "practice.flash",
          templateVersion: 1,
          qid: q.id,
          questionRevision: questionFingerprint(q),
          learnerAnswer: null,
          submitted: true, // 闪卡候选基于已提交知识的解析/反思（揭示闸门）
          mode: "practice",
          sessionId: "",
        };
        const env = await new AiTaskRunner(ch).run(reqCtx, messages);
        void logAiTask({ templateId: env.templateId, qid: q.id, status: env.status, tokens: env.tokens, messages });
        if (env.status === "ok" && env.data.text) {
          void app.recordAiUsage(ch.id, env.tokens, 1).catch(() => undefined);
          const parsed = parseFlashCandidates(env.data.text);
          const leaks = findCardLeaks(parsed.cards);
          if (leaks.length) {
            flashError = { ...flashError, [q.id]: t("flash.leak").replace("{r}", leaks.join("、")) };
            return;
          }
          flashCandidates = { ...flashCandidates, [q.id]: parsed };
        } else {
          flashError = { ...flashError, [q.id]: envStatusLine(env) };
        }
      } catch (e) {
        flashError = { ...flashError, [q.id]: String(e instanceof Error ? e.message : e) };
      } finally { flashBusy = ""; }
    }

    async function confirmFlashCards(q: Question) {
      const result = flashCandidates[q.id];
      if (!result || flashBusy) return;
      const bank = app.listBanks().find((b) => b.id === activeBankId);
      if (!bank) { showMessage(t("guard.needBankFirst"), 2400, "error"); return; }
      const { confirmDialogSync } = await import("../../libs/dialog");
      const ok = await confirmDialogSync({
        title: t("flash.confirmTitle").replace("{n}", String(result.cards.length)),
        content: result.cards.map((c) => `・${escapeHtml(c.front)}`).join("<br>"),
      });
      if (!ok) return;
      flashBusy = q.id;
      try {
        const { blockIds } = await app.createFlashCards(bank.id, bank.name, result.cards);
        flashCandidates = { ...flashCandidates, [q.id]: { ...result, cards: [] } };
        showMessage(t("flash.done").replace("{n}", String(blockIds.length)), 3200, "info");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      } finally { flashBusy = ""; }
    }

    async function createBank() {
      if (!newBankName.trim() || creating) return false;
      creating = true; errorMsg = ""; bankCreateError = ""; sampleNotice = "";
      try {
        const b = await app.createBank(newBankName);
        banks = app.listBanks();
        activeBankId = b.id;
        rememberBank(b.id);
        newBankName = "";
        await refreshQuestionsAfterWrite(3);
        emitExamEvent("bank-changed", { bank: b.id });
        // 25-P1 首用：建库自带示例题（app.createBank），留在入口视图由 47-02 首用引导接管——
        // 最快首题路径是直接练示例题；导入/手工录题在下方动作区一步可达
        return true;
      } catch (e) {
        bankCreateError = offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e);
        return false;
      } finally { creating = false; }
    }

    async function createSampleBank() {
      if (creating) return;
      creating = true; creatingSample = true;
      errorMsg = ""; bankCreateError = ""; sampleNotice = "";
      try {
        const b = await app.createSampleBank();
        banks = app.listBanks();
        activeBankId = b.id;
        rememberBank(b.id);
        questions = []; questionsLoaded = false; sectionSel = null; plan = null;
        view = "entry";
        await refreshQuestionsAfterWrite(SAMPLE_QUESTION_COUNT);
        emitExamEvent("bank-changed", { bank: b.id });
        sampleNotice = questions.length >= SAMPLE_QUESTION_COUNT && !questionsError
          ? t("guard.sampleReady").replace("{n}", String(SAMPLE_QUESTION_COUNT))
          : t("guard.samplePending").replace("{n}", String(questions.length)).replace("{total}", String(SAMPLE_QUESTION_COUNT));
      } catch (e) {
        bankCreateError = offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e);
        banks = app.listBanks();
        // 写入失败后保留并选中已创建的题库，重试继续使用同一个笔记本。
        const retained = banks.find((b) => b.name === SAMPLE_BANK_NAME && b.sampleState);
        if (retained) {
          activeBankId = retained.id;
          rememberBank(retained.id);
          questions = []; questionsLoaded = false; sectionSel = null; plan = null;
          view = "entry";
          await loadQuestions();
          rebuildPlan();
        }
      } finally { creating = false; creatingSample = false; }
    }

    /** 记忆当前题库（多库切换/建库/移出后统一走这里） */
    function rememberBank(id: string) {
      if (id) writeLocal(BANK_PREF_KEY, id);
      else removeLocal(BANK_PREF_KEY);
    }

    /** 多库切换（真机走查补齐）：切库后题目/计划随 activeBankId 重载 */
    async function onBankSwitch() {
      if (importPreviewBankId && importPreviewBankId !== activeBankId && !importBusy) {
        importReport = null; trialConfirmed = []; trialNote = "";
        importPreviewBankId = "";
        importError = t("import.bankChanged");
      }
      rememberBank(activeBankId);
      questions = [];
      questionsLoaded = false;
      sectionSel = null;
      questionsError = "";
      plan = null;
      await loadQuestions();
      rebuildPlan();
      emitExamEvent("bank-changed", { bank: activeBankId });
    }

    /** 移出题库管理（app.removeBank）：仅移出注册表，笔记本本体保留可手动删 */
    async function removeActiveBank() {
      if (!activeBankId || importBusy || mSaving || aiMutationBusy) return;
      const { confirmDialogSync } = await import("../../libs/dialog");
      if (!(await confirmDialogSync({ title: t("bank.removeTitle"), content: t("bank.removeConfirm").replace("{name}", escapeHtml(bankName)) }))) return;
      if (importBusy || mSaving || aiMutationBusy) return;
      try {
        await app.removeBank(activeBankId);
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4600, "error");
        return;
      }
      banks = app.listBanks();
      activeBankId = banks[0]?.id ?? "";
      rememberBank(activeBankId);
      emitExamEvent("bank-changed", { bank: activeBankId });
      showMessage(t("bank.removed"), 2800, "info");
    }

    /** 44-03 lite：材料组排序策略（设置项）——false=分块连排（默认）/ true=交错打散 */
    const materialInterleave = $derived(
      plugin.settingUtils?.get?.("materialInterleave") === true || plugin.settingUtils?.get?.("materialInterleave") === "true",
    );

    /** rail 上下文导航项（全局三项在 Rail 组件内） */
    const at = (v: View) => view === v;
    let sessionSeed = $state(""); // 65-05 lite：本次会话种子（结算页展示，可复现标识）
    // 应用层派生缓存（app.derived()/wrongItems()）是普通对象，Svelte 无法追踪其变化；
    // 用总线事件（session-ended / wrongbook-changed）驱动修订号显式失效下方相关 $derived，
    // 否则组件挂载后数据变化不重算（真机走查实测：练完进错题本恒显空，重开页签才恢复）。
    let dataRev = $state(0);
    let railOpen = $state(false);
    let menuBtn: HTMLButtonElement | null = null;
    function closeRail() { railOpen = false; menuBtn?.focus(); }


    // ---------- 驾驶舱 widgets（规范 v6 §5.3）：目标环 / 连胜 / 待消灭错题 ----------
    const todayDone = $derived.by(() => {
      void dataRev;
      try {
        return app ? (app.derived().days.get(localDate(Date.now()))?.attempts ?? 0) : 0;
      } catch { return 0; }
    });
    const weekTrend = $derived.by(() => {
      void dataRev;
      try { return app ? dailyTrend(app.derived().days, new Date(), 7) : []; } catch { return []; }
    });
    const weekAttemptTotal = $derived(weekTrend.reduce((total, day) => total + day.attempts, 0));
    const weekAttemptMax = $derived(Math.max(1, ...weekTrend.map((day) => day.attempts)));
    function weekDayLabel(dateKey: string) {
      const [year, month, day] = dateKey.split("-").map(Number);
      return ["日", "一", "二", "三", "四", "五", "六"][new Date(year, month - 1, day, 12).getDay()];
    }
    const dailyGoalN = $derived(Math.max(1, Number(plugin.settingUtils?.get?.("dailyGoal") ?? 10) || 10));
    const goalPct = $derived(Math.min(100, Math.round((todayDone / dailyGoalN) * 100)));
    const streakDays = $derived.by(() => {
      void dataRev;
      try { return app ? streak(app.derived()) : 0; } catch { return 0; }
    });
    const wrongList = $derived.by(() => {
      void dataRev;
      if (!app) return [];
      // 错题本按当前题库口径：全局流水里的错题若不属于当前库，
      // 重练/冲刺按钮（按当前库取题）会静默落空——列表与操作必须同库
      const ids = new Set(questions.map((q) => q.id));
      return app.wrongItems().filter((w) => ids.has(w.qid));
    });
    const practiceQuestions = $derived(questions.filter((q) => q.type !== "material"));
    const cramCount = $derived(app ? app.cramDrill(practiceQuestions).length : 0);
    function todayQueueFor(available: Question[], planned: Question[] = plan?.queue ?? []) {
      return groupAdjacent((planned.length ? planned : available.slice(0, 10)).filter((q) => q.type !== "material"));
    }
    const todayQueue = $derived(todayQueueFor(practiceQuestions));
    const favoriteCount = $derived(practiceQuestions.filter((q) => q.fav).length);
    /** 错因计数：口径在 core/wrongReasonMix（reasons map 优先 → 遗留字段 → 未标注桶） */
    const reasonMap = $derived.by(() => {
      void dataRev;
      try { return app?.wrongReasonMap?.() ?? new Map(); } catch { return new Map(); }
    });
    const reasonCounts = $derived(wrongReasonMix(wrongList, reasonMap));
    const reasonOf = (qid: string) => reasonMap.get(qid) ?? wrongList.find((w) => w.qid === qid)?.reason;
    /** 消灭口径：eliminated/(eliminated+在册)；处置覆盖层不影响分母方向 */
    const eliminatedCount = $derived.by(() => {
      void dataRev;
      if (!app) return 0;
      const ids = new Set(questions.map((q) => q.id));
      try { return [...app.derived().wrongbook.values()].filter((w) => ids.has(w.qid) && w.status === "eliminated").length; } catch { return 0; }
    });
    const clearPct = $derived(
      eliminatedCount + wrongList.length ? Math.round((eliminatedCount / (eliminatedCount + wrongList.length)) * 100) : 0,
    );
    /** 错题队列：错次降序 → 最近错误降序（紧迫度序） */
    let wbReasonFilter = $state<"all" | "careless" | "unknown" | "trap">("all");
    const wrongQueue = $derived(
      [...wrongList].sort((a, b) => b.wrongCount - a.wrongCount || b.lastWrongAt - a.lastWrongAt),
    );
    const filteredWrongQueue = $derived(
      wbReasonFilter === "all" ? wrongQueue : wrongQueue.filter((w) => reasonOf(w.qid) === wbReasonFilter),
    );

    function switchView(next: View) { errorMsg = ""; view = next; }
    const railItems = $derived([
      { icon: "table", name: t("mode.browse"), on: at("browse"), onclick: () => { switchView("browse"); void loadQuestions(); } },
      { icon: "xcircle", name: t("wrongbook.title"), on: at("wrongbook"), badge: wrongList.length ? String(wrongList.length) : undefined, onclick: () => { dataRev++; switchView("wrongbook"); void loadQuestions(); } },
      { icon: "import", name: t("import.title"), on: at("import"), onclick: () => switchView("import") },
      { icon: "pencil", name: t("entry.manual"), on: at("manual"), onclick: () => switchView("manual") },
      { icon: "sparkles", name: t("ai.title"), on: at("ai"), onclick: () => switchView("ai") },
      { icon: "book", name: t("materials.title"), on: at("materials"), onclick: () => { switchView("materials"); loadMaterials(); } },
    ]);

    let paletteOpen = $state(false);
    const paletteCommands: PaletteCommand[] = [
      { group: t("palette.views"), icon: "home", label: t("tab.practice"), keywords: "home entry today", run: () => { switchView("entry"); } },
      { group: t("palette.views"), icon: "xcircle", label: t("wrongbook.title"), keywords: "wrongbook wrong", run: () => { switchView("wrongbook"); void loadQuestions(); } },
      { group: t("palette.views"), icon: "table", label: t("mode.browse"), keywords: "browse bank list", run: () => { switchView("browse"); void loadQuestions(); } },
      { group: t("palette.views"), icon: "import", label: t("import.title"), keywords: "import excel csv aiken gift", run: () => { switchView("import"); } },
      { group: t("palette.views"), icon: "pencil", label: t("entry.manual"), keywords: "manual add", run: () => { switchView("manual"); } },
      { group: t("palette.views"), icon: "sparkles", label: t("ai.title"), keywords: "ai generate", run: () => { switchView("ai"); } },
      { group: t("palette.views"), icon: "book", label: t("materials.title"), keywords: "materials pdf", run: () => { switchView("materials"); loadMaterials(); } },
      { group: t("palette.actions"), icon: "zap", label: t("mode.quick"), keywords: "quick drill practice", run: () => void startDrill("quick") },
      { group: t("palette.actions"), icon: "calendar", label: t("mode.daily"), keywords: "daily", run: () => void startDrill("daily") },
      { group: t("palette.actions"), icon: "rotate", label: t("mode.recite"), keywords: "recite cover tts", run: () => void startRecite() },
      { group: t("palette.actions"), icon: "xcircle", label: t("mode.wrong"), keywords: "wrong redo drill", run: () => void startDrill("wrong") },
      { group: t("palette.actions"), icon: "flame", label: t("mode.cram"), keywords: "cram cram", run: () => void startDrill("cram") },
      { group: t("palette.actions"), icon: "star", label: t("mode.fav"), keywords: "fav starred", run: () => void startDrill("fav") },
      { group: t("palette.actions"), icon: "save", label: t("sync.docsBtn"), keywords: "sync archive local docs", run: () => void syncBankDocs() },
      { group: t("palette.actions"), icon: "copy", label: t("entry.copyReport"), keywords: "copy today study report diary", run: () => void copyTodayReportMarkdown() },
      { group: t("palette.tabs"), icon: "clock", label: t("tab.mock"), keywords: "mock exam", run: () => plugin.openMock?.() },
      { group: t("palette.tabs"), icon: "chart", label: t("tab.report"), keywords: "report stats", run: () => plugin.openReport?.() },
    ];

    function onTaskNav(target: "today" | "bank" | "create" | "mock" | "report") {
      if (target === "mock") return plugin.openMock?.();
      if (target === "report") return plugin.openReport?.();
      const next: View = target === "today" ? "entry" : target === "bank" ? "browse" : "manual";
      switchView(next);
      if (next === "entry" || next === "browse") void loadQuestions();
    }

    /** 47-02 lite：首用引导（有题库 + 零作答记录 + 未跳过时显示；产生首个作答后自动消失） */
    let onboardingDismissed = $state(readLocal("lv-exam-onboarded") === "1");
    const onboarding = $derived(
      hasBank && questionsLoaded && questions.some((q) => q.type !== "material") && !onboardingDismissed && view === "entry" && !!app && app.attempts.all().length === 0,
    );

    /** 会话启动失败可见化（47-06 lite）：单活动冲突/离线等不再静默吞掉。
     *  40-05 活动会话协商：冲突时提供「放弃当前并新开」（旧会话有 checkpoint，可恢复） */
    async function negotiateStart(qs: Question[], mode: string, bankId = activeBankId): Promise<boolean> {
      try {
        sessionSeed = sessionSeed || randomSeedId(); // 65-05：调用方可预置（快速刷题抽题与卷序同种子）
        session = await app.startSession(qs, mode, bankId, { interleave: materialInterleave, seed: sessionSeed });
        trails.clear();
        answerStart = Date.now(); // 首题计时基线
        return true;
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        if (!msg.includes("已有进行中的会话")) {
          errorMsg = offline ? t("state.offlineHint") : msg;
          showMessage(errorMsg, 4200, "error");
          return false;
        }
        const { confirmDialogSync } = await import("../../libs/dialog");
        if (!(await confirmDialogSync({ title: t("session.conflictTitle"), content: t("session.conflictBody") }))) return false;
        await app.discardSession();
        try {
          session = await app.startSession(qs, mode, bankId, { interleave: materialInterleave });
          return true;
        } catch (e2) {
          errorMsg = offline ? t("state.offlineHint") : String(e2 instanceof Error ? e2.message : e2);
          showMessage(errorMsg, 4200, "error");
          return false;
        }
      }
    }

    async function safeStart(qs: Question[], mode: string, follow: () => void): Promise<boolean> {
      if (!(await negotiateStart(qs, mode))) return false;
      follow();
      restoreQuestionControls();
      return true;
    }

    /** 其他板块移交的题目集：题目 ID 与题库 ID 必须成对校验，防止会话写入错误题库。 */
    let externalStartBusy = $state(false);
    async function startExternalPractice(qids: string[], targetBankId?: string) {
      if (externalStartBusy) return;
      const bankId = String(targetBankId ?? "");
      if (!bankId || !banks.some((b) => b.id === bankId)) {
        errorMsg = t("query.bankMissing");
        loading = false;
        showMessage(errorMsg, 4200, "error");
        return;
      }
      externalStartBusy = true;
      try {
        // 先在局部读取目标库；只有用户确认并成功启动后才切换 UI 当前库。
        // 这样冲突对话框取消时不会让现有会话与顶部题库选择器错位。
        const all = (bankId === activeBankId ? await loadQuestions() : await app.listQuestions(bankId)) as typeof questions;
        if (bankId === activeBankId && questionsError) throw new Error(questionsError);
        const byId = new Map(all.map((q) => [q.id, q]));
        const picked = qids.flatMap((id) => {
          const q = byId.get(id);
          return q && q.type !== "material" ? [q] : [];
        });
        if (picked.length < qids.length) {
          showMessage(t("query.missing").replace("{n}", String(qids.length - picked.length)), 3600, "info");
        }
        if (!picked.length) {
          showMessage(t("query.empty"), 3200, "info");
          loading = false;
          return;
        }
        // 其他板块可能先创建了会话再发事件（例如模考复盘/报告行动重练）。
        // 复用同一活动会话，让已挂载的练习台接管它，而不是再次弹出冲突对话框。
        const existing = app.currentSession();
        const pickedIds = new Set(picked.map((q) => q.id));
        const existingIds = existing?.phase === "running" ? new Set(existing.state.qids) : null;
        if (existing && existing.phase === "running" && existing.state.bankId === bankId && existingIds && existingIds.size === pickedIds.size && [...pickedIds].every((id) => existingIds.has(id))) {
          session = existing;
          answerStart = Date.now();
        } else if (!(await negotiateStart(groupAdjacent(picked), "query", bankId))) return;
        activeBankId = bankId;
        rememberBank(bankId);
        questions = all;
        questionsLoaded = true;
        questionsError = "";
        sectionSel = null;
        sectionTree = [];
        rebuildQrefView();
        rebuildPlan();
        feedback = null; selected = ""; draftLive = ""; confidenceSel = ""; sessionDone = null;
        view = "session";
        restoreQuestionControls();
      } catch (e) {
        errorMsg = offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e);
        showMessage(errorMsg, 4200, "error");
      } finally {
        externalStartBusy = false;
        loading = false;
      }
    }

    async function startDrill(mode: string) {
      errorMsg = "";
      sessionSeed = randomSeedId(); // 65-05：抽题与卷序共用同一种子
      const qs = (await loadQuestions()).filter((q) => q.type !== "material");
      if (questionsError) {
        errorMsg = questionsError;
        showMessage(t("entry.loadError"), 2800, "error");
        return;
      }
      if (!qs.length) { showMessage(t("state.emptyBank"), 2800, "info"); return; }
      let picked: Question[];
      if (mode === "wrong") {
        picked = app.wrongDrill(qs);
        if (!picked.length) { showMessage(t("state.noWrong"), 2800, "info"); return; }
      } else if (mode === "cram") {
        picked = app.cramDrill(qs);
        if (!picked.length) { showMessage(t("state.noCram"), 2800, "info"); return; }
      } else if (mode === "fav") {
        picked = app.favDrill(qs);
        if (!picked.length) { showMessage(t("state.noFav"), 2800, "info"); return; }
      } else if (mode === "daily") {
        const goal = Number(plugin.settingUtils?.get?.("dailyGoal") ?? 10);
        picked = app.dailyDrill(qs, [], Number.isFinite(goal) && goal > 0 ? goal : 10);
        if (!picked.length) { errorMsg = t("state.emptyBank"); return; }
      } else {
        // 65-06 lite：去重窗口走设置（默认 3 天，0=关闭）；跨模式；池不足回退全量
        const avoidDays = Number(plugin.settingUtils?.get?.("quickAvoidDays") ?? 3);
        const seen = avoidDays > 0 ? recentlySeen(app.attempts.all(), avoidDays * 86_400_000, Date.now()) : undefined;
        picked = seen ? app.quickDrill(qs, 20, sessionSeed, { avoid: seen }) : app.quickDrill(qs, 20, sessionSeed);
      }
      await safeStart(groupAdjacent(picked), mode, () => {
        feedback = null; selected = ""; confidenceSel = ""; sessionDone = null;
        view = "session";
        restoreQuestionControls();
      });
    }

    /** 错题本行级重练：单题会话（与 open-question 总线同路径，mode=wrong） */
    async function startWrongFor(qid: string) {
      errorMsg = "";
      const all = questions.length ? questions : await loadQuestions();
      const q = all.find((x) => x.id === qid);
      if (!q) { showMessage(t("query.empty"), 3200, "info"); return; }
      await safeStart(groupAdjacent([q]), "wrong", () => {
        feedback = null; selected = ""; confidenceSel = ""; sessionDone = null;
        view = "session";
      });
    }

    /** 举一反三（中公杀招，PRD §4）：按考点推荐同考点变式题练习 */
    async function startSameKpFor(qid: string) {
      errorMsg = "";
      const all = questions.length ? questions : await loadQuestions();
      const q = all.find((x) => x.id === qid);
      if (!q?.kp) { showMessage(t("state.noSameKp"), 2800, "info"); return; }
      const related = all.filter((x) => x.id !== qid && x.kp === q.kp);
      if (!related.length) { showMessage(t("state.noSameKp"), 2800, "info"); return; }
      await safeStart(groupAdjacent(related), "same-kp", () => {
        feedback = null; selected = ""; confidenceSel = ""; sessionDone = null;
        view = "session";
      });
    }

    async function startFilteredWrongDrill() {
      if (!filteredWrongQueue.length) { showMessage(t("wrongbook.noFiltered"), 2600, "info"); return; }
      const qids = filteredWrongQueue.map((w) => w.qid);
      const all = await loadQuestions();
      const qs = qids.map((id) => all.find((x) => x.id === id)).filter(Boolean) as Question[];
      if (!qs.length) return;
      await safeStart(qs, "wrong", () => {
        feedback = null; selected = ""; confidenceSel = ""; sessionDone = null; view = "session";
      });
    }

    let wrongBusyId = $state("");
    /** 错题手动处置（已掌握）：确认后写入；失败时保留队列项并允许重试 */
    async function masterWrong(qid: string) {
      if (wrongBusyId) return;
      wrongBusyId = qid;
      try {
        const question = questions.find((q) => q.id === qid);
        const { confirmDialogSync } = await import("../../libs/dialog");
        if (!(await confirmDialogSync({
          title: t("wrongbook.masterOneTitle"),
          content: t("wrongbook.masterOneConfirm").replace("{question}", escapeHtml(question?.stem.slice(0, 100) ?? qid)),
        }))) return;
        await app.setWrongStatus(qid, "mastered");
        dataRev++;
        if (soundEnabled) playCelebrationChord();
        showMessage(t("wrongbook.masteredDone"), 2400, "info");
      } catch (e) {
        showMessage(t("wrongbook.masterFailed").replace("{message}", offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e)), 4600, "error");
      } finally { wrongBusyId = ""; }
    }

    let bulkMasterBusy = $state(false);
    /** 全部标为已掌握（批量处置）：逐题调用同 API，带确认 */
    async function masterAllWrong() {
      if (bulkMasterBusy || !wrongList.length) return;
      const { confirmDialogSync } = await import("../../libs/dialog");
      if (!(await confirmDialogSync({ title: t("wrongbook.masterAllTitle"), content: t("wrongbook.masterAllConfirm").replace("{n}", String(wrongList.length)) }))) return;
      bulkMasterBusy = true;
      let ok = 0;
      let failed = 0;
      try {
        for (const w of wrongList) {
          try { await app.setWrongStatus(w.qid, "mastered"); ok++; } catch { failed++; }
        }
        dataRev++;
        const message = failed
          ? t("wrongbook.masterAllPartial").replace("{ok}", String(ok)).replace("{failed}", String(failed))
          : t("wrongbook.masterAllDone").replace("{n}", String(ok));
        showMessage(message, 4200, failed ? "error" : "info");
      } finally { bulkMasterBusy = false; }
    }

    // ---------- 收藏（exam-fav；E 键 + 星标 + 过滤） ----------
    let favBusy = $state(false);
    async function toggleFavCurrent() {
      const q = session?.current as (Question & { blockId?: string; fav?: boolean }) | undefined;
      if (!q || favBusy) return;
      favBusy = true;
      try {
        await app.toggleFav(q);
        dataRev++;
      } catch (e) {
        showMessage(t("session.favFailed").replace("{message}", offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e)), 4200, "error");
      } finally { favBusy = false; }
    }

    /** 共用题干：材料组母卡（同组材料的题干作为上下文渲染） */
    const materialContext = $derived.by(() => {
      const q = view === "session" ? session?.current : null;
      if (!q?.group) return "";
      const mat = questions.find((x) => x.type === "material" && x.group === q.group);
      return mat?.stem ?? "";
    });

    /** 长材料折叠（TODO 12 组）：>500 字默认折叠，切题重置；展开后完整可读 */
    const MATERIAL_FOLD_AT = 500;
    let materialExpanded = $state(false);
    const materialLong = $derived(materialContext.length > MATERIAL_FOLD_AT);
    const materialShown = $derived(!materialLong || materialExpanded ? materialContext : materialContext.slice(0, 200) + "…");

    /** 共用题干：材料组母卡（背诵视图） */    const reciteMaterial = $derived.by(() => {
      const q = reciteQueue[reciteCursor];
      if (!q?.group) return "";
      const mat = questions.find((x) => x.type === "material" && x.group === q.group);
      return mat?.stem ?? "";
    });

    /** 备考计划（v0.5）：读取设置考日 → planToday 聚合（冲刺 cram 优先/常规到期优先） */
    // 可练习题过滤在 loadQuestions 后各入口处执行（材料母块只作上下文）

    let plan = $state<ReturnType<typeof import("@/core/planner").planToday> | null>(null);
    /** 今日卡片说明：按 planner 结构化口径本地化渲染（plan.reason 为 zh 审计口径，不直接上界面） */
    function planReasonText(p: NonNullable<typeof plan>): string {
      const d = p.reasonData ?? { days: 0, cram: 0, stubborn: 0, due: 0 };
      if (p.reasonKind === "sprint") return t("plan.sprint").replace("{d}", String(d.days)).replace("{n}", String(d.cram)).replace("{m}", String(d.stubborn));
      if (p.reasonKind === "due") return t("plan.due").replace("{n}", String(d.due));
      return t("plan.reflow").replace("{m}", String(d.stubborn));
    }
    /** 53-01 lite：今日计划分钟预算（与 plan 同步重算） */
    let planTime = $state<import("@/core/timeBudget").TimeEstimate | null>(null);
    /** 53-02 lite：多考期清单（按剩余天数升序；入口页展示全部未来考期 chips） */
    let examProfileList = $state<import("@/core/planner").ExamProfile[]>([]);
    /** 44-05 lite：昨日计划轨迹（缺席连续计数；入口页 chip） */
    let planTrace = $state<import("@/core/planner").PlanTrace | null>(null);

    function rebuildPlan(dueFirst?: Question[]) {
      if (!app) { plan = null; return; }
      const examDate = String(plugin.settingUtils?.get?.("examDate") ?? "").trim();
      const sprintDays = Number(plugin.settingUtils?.get?.("sprintDays") ?? 14);
      const goal = Number(plugin.settingUtils?.get?.("dailyGoal") ?? 10);
      // 53-02 lite：多考期（设置 textarea「名称:日期」逐行）——计划锚定最近未来考期，无则回退单考期设置
      examProfileList = parseExamProfiles(String(plugin.settingUtils?.get?.("examProfiles") ?? ""));
      const nearest = nearestUpcoming(examProfileList);
      const effectiveExamDate = nearest?.date ?? (examDate || undefined);
      // rebuildPlan 函数内累加器（非组件状态），不转 SvelteMap/SvelteSet
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const wrongCounts = new Map<string, number>();
      for (const w of app.derived().wrongbook.values()) wrongCounts.set(w.qid, w.wrongCount);
      const activeWrongIds = new Set(app.wrongItems().map((w) => w.qid));
      plan = planToday({
        examDate: effectiveExamDate,
        sprintDays: Number.isFinite(sprintDays) && sprintDays > 0 ? sprintDays : 14,
        dailyGoal: Number.isFinite(goal) && goal > 0 ? goal : 10,
        all: questions, wrongCounts, activeWrongIds,
        wrongReasons: (app as any).wrongReasonMap?.() ?? undefined,
        dueFirst: dueFirst ?? [],
      });
      // 53-01 lite：今日计划分钟预算（按题型历史用时中位；缺历史题型如实标注默认值）
      const typeOf = new Map(questions.map((q) => [q.id, q.type] as const));
      planTime = estimatePlanMinutes(plan.queue, avgMsByType(app.attempts.all(), (qid) => typeOf.get(qid)));
      // 44-05 lite：昨日计划回看轨迹（缺席连续计数持久化；入口页 chip 提示）
      void (async () => {
        const prev = ((await app.loadAux<import("@/core/planner").PlanTrace | null>("plan/trace")) ?? null);
        const yesterday = new Date(Date.now() - 86_400_000);
        const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
        const doneY = app.attempts
          .all()
          .filter((e) => e.verdict !== "not_attempted" && localDateKeyOf(e.ts) === yKey).length;
        const trace = nextPlanTrace(prev, localDateKeyOf(Date.now()), plan!.queue.length, doneY);
        planTrace = trace;
        void app.saveAux("plan/trace", trace).catch((e: unknown) => { showMessage(String(e instanceof Error ? e.message : e), 3600, "error"); });
      })();
    }

    /** 每日任务直接使用计划队列（零决策入口） */
    async function startToday() {
      errorMsg = "";
      const qs = (await loadQuestions()).filter((q) => q.type !== "material");
      if (!qs.length) { errorMsg = t("state.emptyBank"); showMessage(t("state.emptyBank"), 2800, "info"); return; }
      // FSRS 到期优先（docs/11 S8：dueFirst 供给；离线/无卡自然为空）
      let due: Question[];
      try { due = await (app as any).dueQuestions(bankName, qs); } catch { due = []; }
      rebuildPlan(due);
      const queue = todayQueueFor(qs);
      await safeStart(queue, plan?.mode === "sprint" ? "cram" : "daily", () => {
        feedback = null; selected = ""; confidenceSel = ""; sessionDone = null;
        view = "session";
      });
    }

    // ---------- 背诵（S4 lite） ----------
    /** 跳回源笔记精确位置（iDoRecall 范式 lite：doc zoomIn 到题目块） */
    function jumpToSource() {
      const q = reciteQueue[reciteCursor] as Question & { blockId?: string; rootId?: string };
      if (!q?.blockId || !q?.rootId) return;
      void import("siyuan").then(({ openTab }) => {
        openTab({ app: (plugin as any).app ?? plugin, doc: { id: q.rootId, zoomIn: q.blockId } } as any);
      });
    }
    async function startRecite() { void 0; // 背诵朗读按钮在视图内直接调用 ttsSpeak
      // 首次进入时 questions 可能尚未加载（模式卡直达）——与 startDrill 同路径先拉取
      const all = (questions.length ? questions : await loadQuestions()).filter((q) => q.type !== "material");
      if (questionsError) {
        errorMsg = questionsError;
        showMessage(t("entry.loadError"), 2800, "error");
        return;
      }
      const qs = app.wrongDrill(all);
      const pool = qs.length ? qs : all;
      if (!pool.length) { errorMsg = t("state.emptyBank"); return; }
      // 背诵组大小可配（TODO 13 组）：设置 reciteGroupSize，夹在 5–50
      const size = Math.max(5, Math.min(50, Number(plugin.settingUtils?.get?.("reciteGroupSize") ?? 15) || 15));
      reciteQueue = app.quickDrill(pool, size);
      reciteCursor = 0; reciteRevealed = false; reciteDone = false; reciteHint = 0; reciteRatings = [];
      reciteSessionId = `s-recite-${Date.now().toString(36)}`;
      view = "recite";
    }

    async function rateSelf(rating: 1 | 2 | 3 | 4) {
      if (reciteSaving) return;
      const q = reciteQueue[reciteCursor];
      if (!q) return;
      reciteSaving = true;
      reciteError = "";
      try {
        await app.reciteAnswer(bankName, q as Question & { blockId?: string }, rating, reciteSessionId, 0);
        reciteRatings.push(rating);
        plugin.refreshDock?.();
        reciteHint = 0;
        if (reciteCursor < reciteQueue.length - 1) {
          reciteCursor++; reciteRevealed = false;
        } else {
          reciteDone = true;
        }
      } catch (e) {
        reciteError = String(e instanceof Error ? e.message : e);
      } finally {
        reciteSaving = false;
      }
    }

    function exitRecite() {
      view = "entry"; reciteQueue = []; reciteRevealed = false; reciteDone = false; reciteHint = 0; reciteRatings = [];
    }

    /** 错题册导出：Markdown 文档写入题库"导出"区（支持考点/错因/时间过滤） */
    let expKp = $state("");
    let expReason = $state("");
    let expDays = $state(0);
    const expKpRoots = $derived([...new Set(questions.map((q) => q.kp?.split("/")[0]).filter(Boolean))]);

    // ---------- 挑战码（友谊赛复制/导入：含答案，双方本地判分） ----------
    function buildChallengePaper() {
      const pool = questions.filter((q) => q.type !== "material").slice(0, 50);
      return {
        v: 1 as const, title: `${bankName} 挑战`, durationS: 600,
        questions: pool.map((q) => ({ stem: q.stem, options: q.options, answer: q.answer, type: q.type, kp: q.kp })),
      };
    }

    async function copyChallengeCode() {
      const paper = buildChallengePaper();
      if (!paper.questions.length) { showMessage(t("state.emptyBank"), 2800, "info"); return; }
      try {
        const { encodeChallengeCopy } = await import("@/core/challenge");
        await navigator.clipboard.writeText(encodeChallengeCopy(paper));
        showMessage(t("challenge.copied"), 3600, "info");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      }
    }

    async function importChallengeCode() {
      const { inputDialogSync } = await import("../../libs/dialog");
      const code = await inputDialogSync({ title: t("challenge.importTitle"), placeholder: t("challenge.importPlaceholder") });
      if (!code?.trim()) return;
      try {
        const { decodeChallenge } = await import("@/core/challenge");
        const paper = decodeChallenge(code.trim());
        if (!paper) throw new Error(t("challenge.badCode"));
        const qs: Question[] = paper.questions.map((q) => makeQuestion({ type: q.type, stem: q.stem, options: q.options, answer: q.answer, kp: q.kp }));
        session = await app.startSession(qs, "challenge", activeBankId);
        feedback = null; selected = ""; confidenceSel = ""; sessionDone = null;
        view = "session";
      } catch (e) {
        errorMsg = String(e instanceof Error ? e.message : e);
      }
    }

    async function exportWrong() {
      if (!activeBankId) { errorMsg = t("state.emptyBank"); return; }
      try {
        const docId = await app.exportWrongbook(activeBankId, bankName, {
          kpRoot: expKp || undefined,
          reason: (expReason || undefined) as any,
          sinceDays: expDays || undefined,
        });
        void docId;
        showMessage(t("export.done"), 3600, "info");
      } catch (e) {
        showMessage(offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e), 4200, "error");
      }
    }

    let syncDocsBusy = $state(false);
    function retryForgotRecite() {
      const forgotIndices = reciteRatings.map((r, i) => (r === 1 ? i : -1)).filter((i) => i >= 0);
      const forgotQueue = forgotIndices.map((i) => reciteQueue[i]).filter(Boolean);
      if (!forgotQueue.length) return;
      reciteQueue = forgotQueue;
      reciteCursor = 0;
      reciteRevealed = false;
      reciteDone = false;
      reciteHint = 0;
      reciteRatings = [];
    }

    async function copyTodayReportMarkdown() {
      const todayStr = localDate(Date.now());
      const lines = [
        `### 📅 小驴考试 · 今日备考打卡`,
        `- **学习日期**：${todayStr}`,
        `- **当前题库**：${bankName || "默认题库"}`,
        `- **今日作答**：**${todayDone} 题**（今日目标：${dailyGoalN} 题 · 达成率 ${goalPct}%）`,
        `- **连续学习**：🔥 **${streakDays} 天连胜**`,
        `- **错题动态**：当前在册错题 ${wrongList.length} 道 · 累计消灭 ${eliminatedCount} 道（消灭率 ${clearPct}%）`,
      ];
      if (plan) {
        lines.push(`- **备考建议**：${planReasonText(plan)}`);
      }
      lines.push(`\n> 坚持就是胜利，每天进步一点点！💪`);
      try {
        await navigator.clipboard.writeText(lines.join("\n"));
        showMessage(t("entry.reportCopied"), 3200, "info");
      } catch {
        showMessage(t("mock.summaryCopyFailed"), 3200, "error");
      }
    }

    async function syncBankDocs() {
      if (!activeBankId || syncDocsBusy) return;
      syncDocsBusy = true;
      try {
        const r = await app?.syncBankToLocalDocs(activeBankId, bankName);
        void r;
        showMessage(t("sync.docsDone"), 3600, "info");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      } finally {
        syncDocsBusy = false;
      }
    }

    async function pasteClipboardToImport() {
      if (importBusy) return;
      try {
        const text = await navigator.clipboard.readText();
        if (!text?.trim()) {
          showMessage(t("import.clipboardEmpty"), 2800, "info");
          return;
        }
        importText = text;
        showMessage(t("import.clipboardPasted"), 2800, "info");
      } catch (e) {
        showMessage(t("import.clipboardFailed"), 3200, "info");
      }
    }

    /** 官方 Excel 模板下载（运行时生成，docs/15 规范） */
    async function downloadTemplate() {
      const { buildTemplateWorkbook } = await import("@/importer/template");
      const { buffer, filename } = buildTemplateWorkbook();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    /** 错误清单导出 CSV（Excel 友好，BOM 头） */
    function downloadErrorsCsv() {
      if (!importReport?.errors.length) return;
      const csv = errorsToCsv(importReport.errors);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `导入错误清单 ${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    // ---------- 题库包分享（.sy.zip 原生格式） ----------
    async function exportBank() {
      if (!activeBankId) return;
      try {
        const { zipPath, filename } = await app.exportBankSyZip(activeBankId);
        const a = document.createElement("a");
        a.href = `${window.location.origin}${zipPath}`;
        a.download = filename;
        a.click();
        showMessage(t("share.exportDone") + filename, 4000, "info");
      } catch (e) {
        showMessage(offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e), 4200, "error");
      }
    }

    /** 拖拽导入（TODO 18 组）：xlsx/csv → Excel 流程；sy.zip → 题库包导入 */
    function onDrop(e: DragEvent) {
      if (!tabRoot?.getClientRects().length || !tabRoot.contains(e.target as Node) || importBusy || creating) return;
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!hasBank && !/\.zip$/i.test(file.name)) { errorMsg = t("guard.needBankFirst"); return; }
      if (/\.xlsx$|\.xls$|\.csv$/i.test(file.name)) {
        view = "import";
        void onExcelFile(inputLike(file) as unknown as Event);
      } else if (/\.zip$/i.test(file.name)) {
        errorMsg = ""; importError = ""; importResult = null;
        void importBank(inputLike(file) as unknown as Event);
      } else {
        errorMsg = t("import.unsupportedDrop");
      }
    }

    /** 构造伪 input 对象（复用 onExcelFile/importBank 的取文件逻辑） */
    function inputLike(file: File): { target: HTMLInputElement } {
      return { target: { files: [file], value: "" } as unknown as HTMLInputElement };
    }

    async function importBank(e: Event) {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      try {
        // 38-05：multipart 上传，浏览器/桌面同路径（不再依赖 Electron File.path）
        const { registered } = await app.importBankSyZip(file, file.name);
        banks = app.listBanks();
        showMessage(registered.length ? t("share.importRegistered").replace("{names}", registered.join("、")) : t("share.importDone"), 4600, "info");
        void loadQuestions();
      } catch (err) {
        showMessage(String(err instanceof Error ? err.message : err), 4200, "error");
      } finally { input.value = ""; }
    }

    // ---------- AI 讲解（v0.4：错题逐选项解释；多轮追问；可存为笔记子块） ----------
    let explainText = $state("");
    let explainBusy = $state(false);
    let explainQid = $state("");
    let explainHistory = $state<Record<string, import("@/ai/client").AiMessage[]>>({});
    /** 多轮历史持久化（27 P3）：保存到插件存储，重载后可继续追问；仅保留最近 10 题 */
    async function persistExplainHistory() {
      const entries = Object.entries(explainHistory).slice(-10);
      await app.saveAux("ai/explain-history", Object.fromEntries(entries));
    }

    /** AI 发送记录（U23/41-01 lite）：本地留存实际 payload（信封+消息），供"我发送了什么"审计 */
    async function logAiTask(entry: { templateId: string; qid: string; status: string; tokens: number; messages: import("@/ai/client").AiMessage[] }) {
      try {
        const log = (await app.loadAux<(typeof entry & { at: number })[]>("ai/task-log")) ?? [];
        log.push({ ...entry, at: Date.now() });
        await app.saveAux("ai/task-log", log.slice(-20));
      } catch { /* 审计日志失败不影响任务本身 */ }
    }

    interface AiTaskLogEntry { at: number; templateId: string; qid: string; status: string; tokens: number; messages: import("@/ai/client").AiMessage[] }
    let aiTaskLog = $state<AiTaskLogEntry[]>([]);
    async function loadAiTaskLog() {
      try { aiTaskLog = (await app.loadAux<AiTaskLogEntry[]>("ai/task-log")) ?? []; } catch { aiTaskLog = []; }
    }
    let explainFollowUp = $state("");
    let explainSaveBusy = $state(false);
    let explainSavedQid = $state("");
    let explainSaveError = $state("");
    let explainSaveErrorQid = $state("");

    async function explainCurrent(mode: "explain" | "hint" | "socratic" = "explain") {
      const q = session?.current;
      if (!q || explainBusy || !feedback) return;
      explainSavedQid = ""; explainSaveError = ""; explainSaveErrorQid = "";
      if (!app.kernelOnline) { explainText = t("state.offlineHint"); return; }   // 离线早退（兜底）
      explainBusy = true; explainText = ""; explainQid = q.id;
      // G1 任务身份：模板+题面指纹+作答快照+提交状态（ai/task.ts 信封契约）
      const reqCtx: import("@/ai/task").AiTaskContext = {
        templateId: mode === "explain" ? "practice.explain" : mode === "hint" ? "practice.hint" : "practice.socratic",
        templateVersion: 2, // 五八批模板修订（T07 分层/T06 单问题）
        qid: q.id,
        questionRevision: questionFingerprint(q),
        learnerAnswer: feedback.myAnswer,
        submitted: true,
        mode: "practice",
        sessionId: session?.id ?? "",
      };
      try {
        const { SiyuanAiChannel, OpenAiChannel } = await import("@/ai/client");
        const { buildExplainMessages } = await import("@/ai/explain");
        const { AiTaskRunner } = await import("@/ai/task");
        const endpoint = String(plugin.settingUtils?.get?.("aiEndpoint") ?? "");
        const key = resolveAiKey(plugin);
        const model = String(plugin.settingUtils?.get?.("aiModel") ?? "gpt-4o-mini");
        const ch = endpoint && key
          ? new OpenAiChannel({ endpoint, apiKey: key, model }, (u, i) => fetch(u, i))
          : new SiyuanAiChannel((app as any).deps.client);
        const messages = buildExplainMessages(q, feedback.myAnswer, mode);
        const env = await new AiTaskRunner(ch).run(reqCtx, messages);
        void logAiTask({ templateId: env.templateId, qid: reqCtx.qid, status: env.status, tokens: env.tokens, messages });
        if (env.status === "ok" && env.data.text) {
          explainText = env.data.text;
          explainHistory[q.id] = [...messages, { role: "assistant", content: env.data.text }];
          void persistExplainHistory().catch((e: unknown) => { explainSaveError = String(e instanceof Error ? e.message : e); });
          void app.recordAiUsage(ch.id, env.tokens, 1).catch(() => undefined);
          helpShown.set(q.id, mode); // 114-01：受助标记——同题再答（重排队）时随 attempt 落 help 字段
        } else {
          // 有类型失败（G6 闸门/预算/通道错误）：显示信封摘要，不裸抛异常栈
          explainText = envStatusLine(env);
        }
        // G2：响应期间切题时，explainQid 门控使旧讲解不占当前题展示；历史已按 q.id 留草稿
      } catch (e) {
        explainText = String(e instanceof Error ? e.message : e);
      } finally { explainBusy = false; }
    }

    /** 信封 summary 是 zh 审计口径；展示层按状态本地化，错误详情原样附后 */
    function envStatusLine(env: { status: string; summary: string; error?: string }): string {
      const line =
        env.status === "ok" ? t("ai.emptyResponse") : env.status === "unsupported" ? t("ai.taskUnsupported") : t("ai.taskFailed");
      return line + (env.error ? ": " + env.error : "");
    }

    /** 提示按钮文案：随已展示层级推进（114-01 一次一层） */
    function hintButtonLabel(q: { id: string; options: string[] }): string {
      const step = nextHintStepSync(hintLevels.get(q.id) ?? 0, q.options.length);
      if (step.kind === "reveal") return t("explain.hintTop");
      if (step.level === 1) return t("explain.hint");
      return t("explain.hintNext").replace("{n}", String(step.level));
    }
    /** 同步版推进判定（UI 文案用；请求路径用 ai/hint 的异步同名逻辑） */
    function nextHintStepSync(shown: 0 | 1 | 2 | 3, optionCount: number): { kind: "hint"; level: 1 | 2 | 3 } | { kind: "reveal" } {
      if (shown === 0) return { kind: "hint", level: 1 };
      if (shown === 1) return { kind: "hint", level: 2 };
      if (shown === 2 && optionCount <= 2) return { kind: "reveal" };
      if (shown === 2) return { kind: "hint", level: 3 };
      return { kind: "reveal" };
    }

    /** 114-01 一次一层提示：提交前后均可逐层申请；≤2 选项题型 L2 后转正式揭示；泄露守卫拦截疑似泄题层 */
    async function requestHint() {
      const q = session?.current;
      if (!q || explainBusy) return;
      explainSavedQid = ""; explainSaveError = ""; explainSaveErrorQid = "";
      explainQid = q.id; leakPending = null;
      if (!app.kernelOnline) { explainText = t("state.offlineHint"); return; }
      const shown = hintLevels.get(q.id) ?? 0;
      const step = nextHintStepSync(shown, q.options.length);
      if (step.kind === "reveal") {
        // G6 正式揭示：不冒充提示——提交作答由判定揭示答案，帮助事件随 attempt 如实落
        explainText = t("explain.hintReveal");
        return;
      }
      explainBusy = true; explainText = "";
      const submitted = !!feedback;
      // G1 任务身份：提交前提示携当前草稿（有草稿如实带出，无草稿=未作答）
      const reqCtx: import("@/ai/task").AiTaskContext = {
        templateId: "practice.hint",
        templateVersion: 2, // 一次一层模板修订（docs/18 T05）
        qid: q.id,
        questionRevision: questionFingerprint(q),
        learnerAnswer: feedback?.myAnswer ?? session?.getDraft(q.id) ?? null,
        submitted,
        mode: "practice",
        sessionId: session?.id ?? "",
      };
      try {
        const { SiyuanAiChannel, OpenAiChannel } = await import("@/ai/client");
        const { buildHintMessages, findHintLeaks } = await import("@/ai/hint");
        const { AiTaskRunner } = await import("@/ai/task");
        const endpoint = String(plugin.settingUtils?.get?.("aiEndpoint") ?? "");
        const key = resolveAiKey(plugin);
        const model = String(plugin.settingUtils?.get?.("aiModel") ?? "gpt-4o-mini");
        const ch = endpoint && key
          ? new OpenAiChannel({ endpoint, apiKey: key, model }, (u, i) => fetch(u, i))
          : new SiyuanAiChannel((app as any).deps.client);
        const shownTexts = hintTexts.get(q.id) ?? [];
        const messages = buildHintMessages(q, reqCtx.learnerAnswer, step.level, shownTexts);
        const env = await new AiTaskRunner(ch).run(reqCtx, messages);
        void logAiTask({ templateId: env.templateId, qid: reqCtx.qid, status: env.status, tokens: env.tokens, messages });
        if (env.status === "ok" && env.data.text) {
          if (!submitted) {
            // 揭示前（答案未上屏）：确定性泄露守卫——命中即隐藏，用户明确揭示才展示
            const leaks = findHintLeaks(env.data.text, q);
            if (leaks.length) {
              leakPending = { level: step.level, text: env.data.text, reasons: leaks.map((l) => l.detail).join("、") };
              return;
            }
          }
          hintLevels.set(q.id, step.level);
          hintTexts.set(q.id, [...shownTexts, env.data.text]);
          explainText = hintTexts
            .get(q.id)!
            .map((s, i) => `${t("explain.hintLayer").replace("{n}", String(i + 1))}：${s}`)
            .join("\n");
          helpShown.set(q.id, "hint"); // 受助标记：本题后续作答（含本次提交）随 attempt 落 help
          void app.recordAiUsage(ch.id, env.tokens, 1).catch(() => undefined);
        } else {
          explainText = envStatusLine(env);
        }
      } catch (e) {
        explainText = String(e instanceof Error ? e.message : e);
      } finally { explainBusy = false; }
    }

    /** 泄露守卫：用户明确选择查看 → 记为受助-揭示（help=reveal），层级照常推进 */
    function viewLeakedHint() {
      const q = session?.current;
      if (!q || !leakPending) return;
      hintLevels.set(q.id, leakPending.level);
      hintTexts.set(q.id, [...(hintTexts.get(q.id) ?? []), leakPending.text]);
      explainText = hintTexts
        .get(q.id)!
        .map((s, i) => `${t("explain.hintLayer").replace("{n}", String(i + 1))}：${s}`)
        .join("\n");
      helpShown.set(q.id, "reveal");
      leakPending = null;
    }

    async function sendFollowUp() {
      const q = session?.current;
      if (q) addExposure(q.id, "followup");
      const history = explainHistory[q?.id ?? ""];
      if (!q || !history?.length || explainBusy || !explainFollowUp.trim()) return;
      explainSavedQid = ""; explainSaveError = ""; explainSaveErrorQid = "";
      explainBusy = true;
      // 追问沿用苏格拉底模板身份；揭示状态随当前题提交事实
      const reqCtx: import("@/ai/task").AiTaskContext = {
        templateId: "practice.socratic",
        templateVersion: 2, // 五八批模板修订（T06 单问题）
        qid: q.id,
        questionRevision: questionFingerprint(q),
        learnerAnswer: feedback?.myAnswer ?? null,
        submitted: !!feedback,
        mode: "practice",
        sessionId: session?.id ?? "",
      };
      try {
        const { SiyuanAiChannel, OpenAiChannel } = await import("@/ai/client");
        const { continueExplainMessages } = await import("@/ai/explain");
        const { AiTaskRunner } = await import("@/ai/task");
        const endpoint = String(plugin.settingUtils?.get?.("aiEndpoint") ?? "");
        const key = resolveAiKey(plugin);
        const model = String(plugin.settingUtils?.get?.("aiModel") ?? "gpt-4o-mini");
        const ch = endpoint && key
          ? new OpenAiChannel({ endpoint, apiKey: key, model }, (u, i) => fetch(u, i))
          : new SiyuanAiChannel((app as any).deps.client);
        const messages = continueExplainMessages(history, explainFollowUp.trim());
        const env = await new AiTaskRunner(ch).run(reqCtx, messages);
        void logAiTask({ templateId: env.templateId, qid: reqCtx.qid, status: env.status, tokens: env.tokens, messages });
        if (env.status === "ok" && env.data.text) {
          const reply = env.data.text;
          explainHistory[q.id] = [...messages, { role: "assistant", content: reply }];
          void persistExplainHistory().catch((e: unknown) => { explainSaveError = String(e instanceof Error ? e.message : e); });
          explainText = (explainText.endsWith(reply) ? explainText : explainText + "\n\n") + t("ai.followupTag") + explainFollowUp.trim() + "\n" + reply;
          explainFollowUp = "";
          void app.recordAiUsage(ch.id, env.tokens, 1).catch(() => undefined);
        } else {
          explainText = (explainText ? explainText + "\n\n" : "") + envStatusLine(env);
        }
      } catch (e) {
        explainText = String(e instanceof Error ? e.message : e);
      } finally { explainBusy = false; }
    }

    // ---------- 纯听题 lite（TTS + 遮罩） ----------
    let pureListen = $state(false);
    /** 背题模式（华图杀招，PRD §3）：开着时每题自动展示答案与解析，跳过提交判分，适合考前突击。localStorage 持久化 */
    let reciteToggle = $state(readLocal("lv-exam/reciteMode") === "1");
    let reciteSubmitTimer: ReturnType<typeof setTimeout> | null = null;
    function clearReciteSubmitTimer() {
      if (reciteSubmitTimer) clearTimeout(reciteSubmitTimer);
      reciteSubmitTimer = null;
    }
    function scheduleReciteSubmit() {
      clearReciteSubmitTimer();
      const targetSession = session;
      const targetQuestionId = targetSession?.current?.id;
      const targetCursor = targetSession?.state?.cursor;
      if (!targetSession || view !== "session" || !reciteToggle || feedback || exitBusy) return;
      reciteSubmitTimer = setTimeout(() => {
        reciteSubmitTimer = null;
        if (view !== "session" || session !== targetSession || session?.current?.id !== targetQuestionId || session?.state?.cursor !== targetCursor || !reciteToggle || feedback || exitBusy) return;
        submitAnswer();
      }, 50);
    }
    $effect(() => {
      if (view !== "session") clearReciteSubmitTimer();
    });
    function toggleRecite() {
      reciteToggle = !reciteToggle;
      writeLocal("lv-exam/reciteMode", reciteToggle ? "1" : "0");
      if (reciteToggle && !feedback) scheduleReciteSubmit();
      else clearReciteSubmitTimer();
    }
    function togglePureListen() {
      const q = session?.current;
      if (!q) return;
      pureListen = !pureListen;
      void import("@/core/tts").then((m) => {
        if (pureListen) m.ttsSpeak([q.stem, ...q.options].join(" "));
        else m.ttsStop?.();
      });
    }
    /** 纯听题完整态：切题时自动朗读新题 */
    $effect(() => {
      const q = view === "session" ? session?.current : null;
      if (!q || !pureListen) return;
      void import("@/core/tts").then((m) => m.ttsSpeak([q.stem, ...q.options].join(" ")));
    });

    async function saveExplain() {
      const q = session?.current;
      const body = explainText;
      const qid = explainQid;
      if (!q || q.id !== qid || !body.trim() || explainSaveBusy || explainSavedQid === qid) return;
      explainSaveBusy = true;
      explainSaveError = ""; explainSaveErrorQid = qid;
      try {
        await (app as any).appendQuestionNote(q.id, q.blockId, body, "ai-explain");
        explainSavedQid = qid;
        explainSaveErrorQid = "";
        showMessage(t("explain.saved"), 2400, "info");
      } catch (e) {
        explainSaveError = String(e instanceof Error ? e.message : e);
      } finally { explainSaveBusy = false; }
    }

    // ---------- 转卡 ----------
    let cardResult = $state("");
    async function toCard() {
      if (!session?.current) return;
      cardResult = "…";
      try {
        const n = await app.convertToCards(activeBankId, bankName, [session.current as Question & { blockId?: string }]);
        cardResult = n ? t("memory.toCardDone") : t("memory.toCardMissing");
      } catch (e) {
        cardResult = offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e);
      }
    }

    // ---------- 举一反三 ----------
    async function sameKpSession() {
      const wrongs = session?.answered?.filter((a: any) => a.grade.verdict === "wrong") ?? [];
      const all = await loadQuestions();
      const exclude = new Set<string>(session?.state?.qids ?? []);
      const seed = all.find((q) => q.id === wrongs[0]?.qid) ?? session?.current ?? all[0];
      const picked = app.sameKpDrill(all, seed, 10, exclude);
      if (!picked.length) { errorMsg = t("state.noSameKp"); return; }
      await safeStart(picked, "special", () => {
        feedback = null; selected = ""; confidenceSel = ""; sessionDone = null;
        view = "session";
      });
    }

    let resumeBusy = $state(false);
    async function resume() {
      if (resumeBusy) return;
      resumeBusy = true;
      resumeError = "";
      try {
        const s = await app.resumeSession(async (qids) => {
          const all = await loadQuestions();
          return qids.map((id) => all.find((q) => q.id === id)).filter(Boolean) as Question[];
        }, activeBankId);
        if (s) {
          // 37-05 恢复推进：跳过已答位置，防重复作答双计事件；全答完直接进结算
          s.advancePastAnswered();
          if (s.allAnswered()) sessionDone = s.finish();
          session = s; feedback = null; selected = ""; draftLive = ""; confidenceSel = ""; view = "session";
          sessionRev++;
          restoreQuestionControls();
          answerStart = Date.now(); // 首题计时基线（否则 qElapsedS 从 0 基线算出纪元秒）
          if (app.lastResumeMissing.length) showMessage(t("resume.missing").replace("{n}", String(app.lastResumeMissing.length)), 4200, "info");
        }
      } catch (e) {
        resumeError = offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e);
        showMessage(resumeError, 4200, "error");
      } finally {
        resumeBusy = false;
      }
    }

    // ---------- 打卡桥（48-03 lite）：结算自动同步 + 待重试持久化 + 重载补写 ----------
    let checkinStatus = $state<import("@/core/checkinBridge").CheckinSyncStatus | null>(null);
    let checkinNote = $state("");
    const CHECKIN_PENDING_KEY = "checkin/bridge/pending";
    function checkinCfg() {
      return {
        itemId: String(plugin.settingUtils?.get?.("checkinItemId") ?? "").trim(),
        threshold: Number(plugin.settingUtils?.get?.("checkinThreshold") ?? 0) || 0,
      };
    }
    async function runCheckinBridge() {
      const cfg = checkinCfg();
      const api = probeCheckinApi(window);
      const today = localDateKeyOf(Date.now());
      const attempts = app.attempts.all().filter(
        (e) => localDateKeyOf(e.ts) === today && e.verdict !== "not_attempted",
      ).length;
      const goal = Number(plugin.settingUtils?.get?.("dailyGoal") ?? 10) || 10;
      const st = await syncCheckin(api, cfg, attempts, Date.now(), goal);
      await app.saveAux(CHECKIN_PENDING_KEY, st.event ?? null);
      checkinStatus = st.status;
      if (st.status === "pending") checkinNote = String(st.event?.externalRef ?? "");
    }
    /** 重载补写：上次未写入的打卡事件以原 externalRef 重试（写入成功才清除） */
    async function retryCheckinPending() {
      const pending = await app.loadAux<import("@/core/checkinBridge").CheckinEventInput | null>(CHECKIN_PENDING_KEY);
      if (!pending) return;
      const api = probeCheckinApi(window);
      if (!api) return; // 打卡未装：保留待重试
      try {
        await api.whenReady?.();
        if (api.hasCapability && !api.hasCapability("events.record")) return;
        const result = api.recordEvent?.(pending);
        if (result !== undefined) await app.saveAux(CHECKIN_PENDING_KEY, null);
      } catch { /* 保留待重试；下次重载继续 */ }
    }
    /** 48-04 lite：打卡→考试只读投影——桥开启时读取连续天数（只读、失败安静、不自算 streak） */
    let checkinStreak = $state<number | null>(null);
    async function loadCheckinStreak() {
      const cfg = checkinCfg();
      if (!bridgeEnabled(cfg)) return;
      const s = await fetchStreak(probeCheckinApi(window), cfg.itemId);
      checkinStreak = s?.current ?? null;
    }

    /** 44-01：结算页错题回看展开态 */
    let reviewOpen = $state(false);
    /** 52-02 lite：先回忆模式（按题开关，切题重置）；recallDraft 与作答草稿分离、不入正式答案 */
    let hideOptions = $state(false);
    let recallDraft = $state("");
    /** 52-02 收口：先回忆使用集（qid → 揭示可追溯；随 attempt 落 recall 字段） */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- 函数内累加 Set（非组件遍历状态）
    const recallUsed = new Set<string>();
    /** 52-04 lite：自诊断复盘缓存（qid → {text, at}；结算页回看与编辑） */
    let reflections = $state<Record<string, { text: string; at: number }>>({});
    async function editReflection(qid: string) {
      const cur = await app.loadWrongReflection(qid);
      const { inputDialogSync } = await import("../../libs/dialog");
      const text = await inputDialogSync({
        title: t("reflection.title"),
        placeholder: t("reflection.placeholder"),
        defaultText: cur?.text ?? "",
      });
      if (text == null) return; // 取消不改现有复盘
      await app.saveWrongReflection(qid, text);
      if (text.trim()) reflections = { ...reflections, [qid]: { text: text.trim(), at: Date.now() } };
      else {
        const next = { ...reflections };
        delete next[qid];
        reflections = next;
      }
      showMessage(t("reflection.saved"), 2400, "info");
    }
    /** 打开回看时批量载入上次检查点（52-04：复习能回看） */
    async function loadReflections() {
      const next: Record<string, { text: string; at: number }> = {};
      for (const a of session?.answered ?? []) {
        // 114-05 lite：受助答对（讲解/提示后）也纳入回看——自我解释的载体与错题复盘同层
        if (a.grade.verdict === "correct" && !helpShown.get(a.qid)) continue;
        const r = await app.loadWrongReflection(a.qid);
        if (r) next[a.qid] = r;
      }
      reflections = next;
    }

    // ---------- AI 错因假设（116-01 T08：事实→假设→验证行动；假设与用户复盘独立，采纳由用户操作） ----------
    let misdiagnosisBusy = $state("");
    let misdiagnosisText = $state<Record<string, string>>({});

    /** 本次会话该题最近一次作答的 confidence/help（流水口径；无记录=缺证据，模板如实标注） */
    function attemptMeta(qid: string): { confidence?: "sure" | "fuzzy" | "guess"; helped?: boolean } {
      const events = app.attempts.all().filter((e) => e.qid === qid && e.sessionId === session?.id);
      const last = events[events.length - 1];
      return { confidence: last?.confidence, helped: !!last?.help };
    }

    async function runMisdiagnosis(a: { qid: string; grade: { myAnswer: string | null }; timeMs: number }) {
      const q = questions.find((x) => x.id === a.qid);
      if (!q || misdiagnosisBusy || !session) return;
      if (!app.kernelOnline) { showMessage(t("state.offlineHint"), 2400, "info"); return; }
      misdiagnosisBusy = a.qid;
      try {
        const { SiyuanAiChannel, OpenAiChannel } = await import("@/ai/client");
        const { buildMisdiagnosisMessages } = await import("@/ai/misdiagnosis");
        const { AiTaskRunner, questionFingerprint } = await import("@/ai/task");
        const endpoint = String(plugin.settingUtils?.get?.("aiEndpoint") ?? "");
        const key = resolveAiKey(plugin);
        const model = String(plugin.settingUtils?.get?.("aiModel") ?? "gpt-4o-mini");
        const ch = endpoint && key
          ? new OpenAiChannel({ endpoint, apiKey: key, model }, (u, i) => fetch(u, i))
          : new SiyuanAiChannel((app as any).deps.client);
        const meta = attemptMeta(a.qid);
        const messages = buildMisdiagnosisMessages(q, {
          myAnswer: a.grade.myAnswer ?? null,
          confidence: meta.confidence,
          timeMs: a.timeMs,
          helped: meta.helped,
          userThought: reflections[a.qid]?.text,
        });
        const reqCtx: import("@/ai/task").AiTaskContext = {
          templateId: "practice.misdiagnosis",
          templateVersion: 1,
          qid: q.id,
          questionRevision: questionFingerprint(q),
          learnerAnswer: a.grade.myAnswer ?? null,
          submitted: true, // 结算回看=已提交（揭示闸门天然满足）
          mode: "practice",
          sessionId: session.id,
        };
        const env = await new AiTaskRunner(ch).run(reqCtx, messages);
        void logAiTask({ templateId: env.templateId, qid: reqCtx.qid, status: env.status, tokens: env.tokens, messages });
        if (env.status === "ok" && env.data.text) {
          misdiagnosisText = { ...misdiagnosisText, [a.qid]: env.data.text };
          void app.recordAiUsage(ch.id, env.tokens, 1).catch(() => undefined);
          // U14：假设独立持久化（与用户复盘分层；离线落内存态，重载后可回看）
          void app.saveMisdiagnosis({
            qid: a.qid,
            text: env.data.text,
            at: Date.now(),
            sessionId: session.id,
            templateVersion: 1,
            evidence: { myAnswer: a.grade.myAnswer ?? null, confidence: meta.confidence, timeMs: a.timeMs, helped: meta.helped },
          }).catch(() => { /* 持久化失败不阻断展示 */ });
        } else {
          showMessage(envStatusLine(env), 3600, "error");
        }
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 3600, "error");
      } finally { misdiagnosisBusy = ""; }
    }

    /** 采纳：把假设并入用户复盘，显式标注「AI 参考（未确认）」——用户标签与 AI 假设独立 */
    async function adoptMisdiagnosis(qid: string) {
      const hypothesis = misdiagnosisText[qid];
      if (!hypothesis) return;
      const cur = await app.loadWrongReflection(qid);
      const merged = (cur?.text ? cur.text + "\n\n" : "") + t("ai.misdiagnosisTag") + "\n" + hypothesis;
      await app.saveWrongReflection(qid, merged);
      reflections = { ...reflections, [qid]: { text: merged, at: Date.now() } };
      void app.markMisdiagnosisAdopted(qid).catch(() => { /* 打点失败不影响并入 */ });
      showMessage(t("reflection.saved"), 2000, "info");
    }
    /** 114-01：本会话受助标记（qid → 讲解模式；reveal=查看被拦泄露提示）；同题再答时随 attempt 落 help 字段 */
    // 63-02：暴露集合（同题多暴露保全；help 字段由 helpFromExposure 派生，向后兼容）
    const exposures = new SvelteMap<string, SvelteSet<string>>();
    function addExposure(qid: string, node: string) {
      let set = exposures.get(qid);
      if (!set) { set = new SvelteSet(); exposures.set(qid, set); }
      set.add(node);
    }
    /** 114-01 兼容读法：本题是否有受助暴露（提示/讲解/揭示任一） */
    const helpShown = {
      set(qid: string, mode: "explain" | "hint" | "socratic" | "reveal") { addExposure(qid, mode); },
      get(qid: string) {
        const set = exposures.get(qid);
        return set && (set.has("explain") || set.has("socratic") || set.has("hint") || set.has("reveal")) ? (helpFromExposure(set) ?? "hint") : undefined;
      },
    }
    /** 114-01：一次一层提示——qid → 已展示层级（0=未申请）；已展示层文本供后续层去重 */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- 函数内累加 Map（非组件遍历状态）
    const hintLevels = new Map<string, 0 | 1 | 2 | 3>();
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- 函数内累加 Map（非组件遍历状态）
    const hintTexts = new Map<string, string[]>();
    /** 114-01 泄露守卫拦截的待决提示（提交前）：用户明确揭示才展示（G6） */
    let leakPending = $state<{ level: 1 | 2 | 3; text: string; reasons: string } | null>(null);
    function pickPracticeChoice(value: string) {
      const q = session?.current;
      if (!q || feedback) return;
      selected = toggleChoice(q.type, selected, value);
      session.setDraft(q.id, selected);
      trailInput(q.id, selected);
    }

    function restoreQuestionControls() {
      const q = session?.current;
      const saved = session?.state.answered?.find((a) => a.pos === session.state.cursor);
      feedback = saved ? { verdict: saved.verdict, myAnswer: saved.myAnswer } : null;
      selected = q && isChoiceQuestion(q) ? (saved?.myAnswer ?? session.getDraft(q.id)) : "";
      draftLive = q && !isChoiceQuestion(q) ? (saved?.myAnswer ?? session.getDraft(q.id)) : "";
      confidenceSel = ""; materialExpanded = false; answerStart = Date.now();
      hideOptions = false; recallDraft = ""; leakPending = null;
    }
    function submitAnswer() {
      clearReciteSubmitTimer();
      if (!session || feedback) return;
      const q = session.current;
      if (!q) return;
      const timeMs = Date.now() - answerStart;
      // 选择题/判断用 selected；填空/简答用 draft
      const ans = isChoiceQuestion(q) ? selected : session.getDraft(q.id);
      if (hideOptions) recallUsed.add(q.id); // 未揭示就提交也算先回忆作答（52-02 可追溯）
      const r = session.submit(ans || null, timeMs);
      if (!r) {
        // 已答位置守卫（session.submit 拒绝重计）：K 回退误入已答位 → 静默前进，不重复写流水
        nextQuestion();
        return;
      }
      const g = r.grade;
      if (q.analysis) addExposure(q.id, "analysis"); // 63-02：反馈态必然展示解析（布尔事实）
      app.recordAttempt({
        qid: q.id, kind: "practice", mode: session.state.mode,
        verdict: g.verdict, myAnswer: g.myAnswer, sessionId: session.id,
        queue: session.state.mode === "wrong" ? "wrong" : "normal", timeMs,
        confidence: confidenceSel || undefined,   // U12：答前快照随 attempt；未选=如实缺省
        help: helpShown.get(q.id),               // 114-01：本题曾被讲解/提示 → 受助作答如实标记
        recall: recallUsed.has(q.id) || undefined, // 52-02：先回忆模式揭示可追溯
        exposure: (() => { const set = exposures.get(q.id); return set && set.size ? [...set] : undefined; })(), // 63-02：布尔事实
        ...((): Pick<import("../../core/types").AttemptEvent, "firstAnswer" | "edits"> => {
          const t = trails.get(q.id);
          if (!t || !trailChanged(t)) return {}; // 63-03：终答==首答（含取消回退）→ 不带轨迹，报告口径「未改答」
          return { firstAnswer: t.first, edits: t.edits };
        })(),
      });
      plugin.refreshDock?.();
      void app.saveSession().catch(() => undefined);   // 37-05 checkpoint：作答即存（SaveGate 同键合并，重载不重复作答）
      if (feedbackMode === "end") {
        // 44-01：会话末复盘——作答事件完全一致，仅对错不在逐题显示，结算页统一回看
        showMessage(t("session.recordedSilent"), 1500, "info");
        nextQuestion();
        return;
      }
      feedback = { verdict: g.verdict, myAnswer: g.myAnswer };
      if (g.verdict === "correct" && soundEnabled) playSuccessChime();
      sessionRev++; // 类实例非响应式：提交后推进读数
    }

    function nextQuestion() {
      clearReciteSubmitTimer();
      feedback = null; selected = ""; draftLive = ""; confidenceSel = ""; materialExpanded = false; answerStart = Date.now();
      hideOptions = false; recallDraft = ""; leakPending = null; // 52-02：切题重置先回忆态（揭示/草稿不沿用上一题，U02 口径）；114-01 泄露待决随之作废
      if (!session.next()) { void finishSession(); return; }
      restoreQuestionControls();
      sessionRev++; // 类实例非响应式：切题后刷新题面
      void app.saveSession().catch(() => undefined);   // 游标推进随答随存
      if (reciteToggle) scheduleReciteSubmit(); // 背题模式：切题后自动揭示答案
    }

    /** 键盘 K 回到上一题：PracticeSession 是类实例，游标变化后必须推进响应式镜像。 */
    function previousQuestion() {
      clearReciteSubmitTimer();
      if (!session?.prev()) return;
      restoreQuestionControls();
      sessionRev++;
      if (reciteToggle && !feedback) scheduleReciteSubmit(); // 背题模式：切题后自动揭示答案
    }

    async function finishSession() {
      clearReciteSubmitTimer();
      sessionDone = session.finish();
      // 用时统计（考试 prep 时间管理关键指标）
      const times = session.answered.map((a) => a.timeMs).filter((t) => t > 0);
      sessionDone.totalTimeS = Math.round(times.reduce((s, t) => s + t, 0) / 1000);
      sessionDone.avgTimeS = times.length ? Math.round(times.reduce((s, t) => s + t, 0) / 1000 / times.length) : 0;
      // 48-02 lite：会话结束事件（仅计数，无题干；生态消费者按需重读明细）
      emitExamEvent("session-ended", {
        sessionId: session.id,
        mode: session.state.mode,
        total: sessionDone.total,
        correct: sessionDone.correct,
        wrong: sessionDone.wrong,
      });
      await app.saveSession();
      await app.flush();
      plugin.refreshDock?.();
      rebuildPlan();
      void runCheckinBridge().catch((e: unknown) => showMessage(String(e instanceof Error ? e.message : e), 4200, "error")); // 48-03 lite：结算自动同步打卡（幂等 externalRef，失败进待重试）
    }

    /** 结算页错题批量转卡（LeetFlash 零成本化）：一次点击入 FSRS 队列（按块幂等，重复转卡自动跳过） */
    async function wrongsToCard() {
      if (!session || !activeBankId) return;
      const wrongQs = session.answered
        .filter((a) => a.grade.verdict === "wrong")
        .map((a) => questions.find((q) => q.id === a.qid))
        .filter((q): q is Question & { blockId?: string } => !!q);
      if (!wrongQs.length) { showMessage(t("session.noCardable"), 2800, "info"); return; }
      try {
        const n = await app.convertToCards(activeBankId, bankName, wrongQs);
        showMessage(n ? `${t("memory.toCardDone")} (${n})` : t("memory.toCardMissing"), 3200, n ? "info" : "error");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      }
    }

    // ---------- 下一行动（U15 lite）：结算页错题加入持久化行动（去重） ----------
    let actionBusy = $state(false);
    let actionNote = $state("");

    async function wrongsToActions() {
      if (!session || actionBusy) return;
      actionBusy = true; actionNote = "";
      try {
        const wrongQs = session.answered.filter((a) => a.grade.verdict === "wrong");
        const r = await app.addActions(wrongQs.map((a) => {
          const q = questions.find((x) => x.id === a.qid);
          return {
            kind: "redo" as const,
            qid: a.qid,
            sessionId: session.id,
            detail: `${t("action.kind.redo")}：${(q?.kp ?? q?.stem ?? a.qid).slice(0, 40)}`,
          };
        }));
        actionNote = t("action.added").replace("{n}", String(r.added)).replace("{d}", String(r.skipped));
      } catch (e) {
        actionNote = String(e instanceof Error ? e.message : e);
      } finally { actionBusy = false; }
    }

    async function exitSession() {
      clearReciteSubmitTimer();
      if (exitBusy) return;
      if (!session) { view = "entry"; return; }
      if (!sessionDone && session.answered.length) {
        const { confirmDialogSync } = await import("../../libs/dialog");
        if (!(await confirmDialogSync({ title: t("session.exit"), content: t("session.exitConfirm") }))) return;
      }
      exitBusy = true;
      try {
        // 63-02 边界前推：看过提示/材料但未提交就退出——曝光是真实事实，落 exposure-only 事件
        //（verdict=not_attempted 与跳过同形；不伪造已完成作答；已提交的题不重复）
        for (const input of abandonedExposureInputs(
          session.answered.map((a) => a.qid), exposures,
          { kind: "practice", mode: session.state.mode, sessionId: session.id },
        )) {
          try { app.recordAttempt(input); } catch { /* 尽力而为：放弃会话不因曝光落库失败而中断 */ }
        }
        await app.saveSession();
        await app.flush();
        session = null; feedback = null; selected = ""; draftLive = ""; confidenceSel = ""; sessionDone = null;
        plugin.refreshDock?.();
        view = "entry";
      } catch (e) {
        showMessage(offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e), 4200, "error");
      } finally {
        exitBusy = false;
      }
    }

    // ---------- 手工录题（S10 表单） ----------
    let mType = $state<"single" | "multiple" | "judge" | "fill" | "short">("single");
    let mStem = $state("");
    let mOptions = $state<string[]>(["", ""]);
    let mAnswer = $state("");        // single/multiple: 字母；judge: 对/错；fill/short: 文本
    let mAnalysis = $state("");
    let mKp = $state("");
    let mSource = $state("");
    let mGroup = $state("");
    /** 54-02 作者设置：数值判分规格（填空题型显示；留空=自动识别/exact 口径） */
    let mSpecOpen = $state(false);
    let mSpecUnit = $state("");
    let mSpecAbsTol = $state("");
    let mSpecRelPct = $state("");
    let mSpecAltUnits = $state("");
    let mSaving = $state(false);
    let mSaved = $state("");
    let manualErrorMsg = $state("");
    let manualErrorField = $state("");

    function clearManualValidation() {
      manualErrorMsg = "";
      manualErrorField = "";
    }

    function manualFieldForError(q: Question, message: string): string {
      if (message.includes("题干")) return "stem";
      if (message.includes("空选项")) return `option-${mOptions.findIndex((option) => !option.trim())}`;
      if (message.includes("选项内容重复")) {
        const duplicateIndex = mOptions.findIndex((option, index) => mOptions.findIndex((other) => other.trim() === option.trim()) !== index);
        return `option-${Math.max(0, duplicateIndex)}`;
      }
      if (message.includes("答案") || message.includes("越界")) return "answer";
      if (message.includes("选项")) return "option-0";
      if (q.type === "single" || q.type === "multiple") return "answer";
      return "stem";
    }

    function setCorrectOption(i: number) {
      const L = String.fromCharCode(65 + i);
      mAnswer = mType === "multiple"
        ? (mAnswer.includes(L) ? mAnswer.replace(L, "") : (mAnswer + L).split("").sort().join(""))
        : L;
    }

    async function switchManualType(nextType: typeof mType) {
      if (nextType === mType) return;
      if (mStem.trim() || mAnswer.trim() || mAnalysis.trim() || mOptions.some((option) => option.trim())) {
        const { confirmDialogSync } = await import("../../libs/dialog");
        if (!(await confirmDialogSync({ title: t("manual.switchTypeTitle"), content: t("manual.switchTypeConfirm") }))) return;
      }
      mType = nextType;
      mAnswer = "";
      if (nextType === "single" || nextType === "multiple") mOptions = ["", ""];
      if (nextType !== "fill") {
        mSpecOpen = false;
        mSpecUnit = "";
        mSpecAbsTol = "";
        mSpecRelPct = "";
        mSpecAltUnits = "";
      }
      clearManualValidation();
    }

    // ---------- 录题草稿保护（45-06 lite）：输入防抖自动保存 → 重载/切视图恢复 → 提交成功清理 ----------
    const MANUAL_DRAFT_KEY = "draft/manual";
    let draftRestored = $state(false);
    let draftTimer: ReturnType<typeof setTimeout> | null = null;
    $effect(() => {
      // 读取全部草稿字段建立依赖；防抖 800ms 落盘（切视图/崩溃后可恢复）
      const snap = {
        type: mType, stem: mStem, options: [...mOptions], answer: mAnswer,
        analysis: mAnalysis, kp: mKp, source: mSource, group: mGroup, savedAt: Date.now(),
        specOpen: mSpecOpen, specUnit: mSpecUnit, specAbsTol: mSpecAbsTol, specRelPct: mSpecRelPct, specAltUnits: mSpecAltUnits,
      };
      if (draftTimer) clearTimeout(draftTimer);
      if (!snap.stem.trim() && !snap.answer.trim() && !snap.analysis.trim()) return; // 空草稿不写
      draftTimer = setTimeout(() => {
        void app.saveAux(MANUAL_DRAFT_KEY, snap).catch(() => undefined);
      }, 800);
      return () => { if (draftTimer) clearTimeout(draftTimer); };
    });

    /** 54-02 作者设置：表单字段 → 判分规格（abs 与 rel 可并用取更宽；无任何容差=exact 口径） */
    function buildAuthorSpec(): import("../../core/structuredAnswer").NumericAnswerSpec | undefined {
      const abs = parseFloat(mSpecAbsTol);
      const rel = parseFloat(mSpecRelPct) / 100;
      const unit = mSpecUnit.trim();
      const alts = mSpecAltUnits.split(/[，,;；]/).map((x) => x.trim()).filter(Boolean);
      if (!Number.isFinite(abs) && !Number.isFinite(rel) && !unit && !alts.length) return undefined; // 全空=自动识别
      const spec: import("../../core/structuredAnswer").NumericAnswerSpec = { v: 1, kind: "numeric" };
      if (Number.isFinite(abs) && abs > 0) spec.absTol = abs;
      if (Number.isFinite(rel) && rel > 0) spec.relTolerance = rel;
      if (unit) spec.unit = unit;
      if (alts.length) {
        const factor = 1; // 作者换算表 lite：等价单位同值换算（倍率编辑待完整面），按同值处理
        spec.altUnits = alts.map((u) => ({ unit: u, factor }));
      }
      return spec;
    }

    async function saveManual() {
      if (mSaving || !mStem.trim()) return;
      const targetBankId = activeBankId;
      const draftSignature = () => JSON.stringify([mType, mStem, mOptions, mAnswer, mAnalysis, mKp, mSource, mGroup, mSpecOpen, mSpecUnit, mSpecAbsTol, mSpecRelPct, mSpecAltUnits]);
      const signature = draftSignature();
      mSaving = true; mSaved = ""; errorMsg = ""; clearManualValidation();
      try {
        const q = makeQuestion({
          type: mType, stem: mStem,
          options: mType === "single" || mType === "multiple" ? mOptions.map((o) => o.trim()) : [],
          answer: mAnswer, analysis: mAnalysis, kp: mKp, source: mSource,
          group: mGroup.trim() || undefined,
          ...(mType === "fill" && mSpecOpen ? { answerSpec: buildAuthorSpec() } : {}),
        });
        const invalid = validate(q);
        if (invalid) {
          manualErrorMsg = invalid;
          manualErrorField = manualFieldForError(q, invalid);
          await tick();
          document.querySelector<HTMLElement>(`[data-manual-field="${manualErrorField}"]`)?.focus();
          return;
        }
        await app.writeManualQuestion(targetBankId, q);
        mSaved = q.id;
        if (signature === draftSignature()) {
        mStem = ""; mOptions = ["", ""]; mAnswer = ""; mAnalysis = "";
        mSpecOpen = false; mSpecUnit = ""; mSpecAbsTol = ""; mSpecRelPct = ""; mSpecAltUnits = "";
        draftRestored = false;
        void app.saveAux(MANUAL_DRAFT_KEY, null).catch(() => undefined); // 45-06：提交成功清理草稿
        }
        await refreshQuestionsAfterWrite(questions.length + 1);
      } catch (e) {
        errorMsg = offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e);
      } finally { mSaving = false; }
    }

    function blankManualDraft() {
      mStem = ""; mOptions = ["", ""]; mAnswer = ""; mAnalysis = "";
      mSpecOpen = false; mSpecUnit = ""; mSpecAbsTol = ""; mSpecRelPct = ""; mSpecAltUnits = "";
      draftRestored = false;
      clearManualValidation();
      void app.saveAux(MANUAL_DRAFT_KEY, null).catch(() => undefined);
    }

    // ---------- AI 出题（v0.4：双通道 + 待审核队列，Inbox 式永不直接入库） ----------
    let aiSource = $state("");
    let aiSourceOrigin = $state("");
    /** 60-01 lite：拾遗桥可用性（apiVersion===1 才显示入口） */
    const gleanAvailable = $derived(!!probeGlean(window));
    let gleanBusy = $state(false);
    let gleanError = $state("");
    let gleanErrorAction = $state<"load" | "mark">("load");
    /** 60-01 写方向：本次出题所用素材（生成成功后可一键标记已读） */
    let gleanPendingDone = $state<GleanClip[]>([]);
    let gleanDoneBusy = $state(false);
    let gleanDoneNote = $state("");
    async function importGleanClips() {
      if (gleanBusy) return;
      gleanBusy = true;
      gleanError = "";
      try {
        const g = probeGlean(window);
        if (!g) { gleanError = t("ai.gleanUnavailable"); return; }
        const clips = await listLaterClips(g, 10);
        if (!clips.length) { showMessage(t("ai.gleanEmpty"), 3200, "info"); return; }
        const block = formatClipsForSource(clips);
        aiSource = aiSource.trim() ? `${aiSource.trim()}\n\n${block}` : block;
        aiSourceOrigin = "";
        gleanPendingDone = clips; // 记录本次所用素材（生成成功后可标记已读）
        showMessage(t("ai.gleanImported").replace("{n}", String(clips.length)), 3200, "info");
      } catch (e) {
        gleanErrorAction = "load";
        gleanError = t("ai.gleanLoadFailed").replace("{message}", String(e instanceof Error ? e.message : e));
      } finally { gleanBusy = false; }
    }
    /** 60-01 写方向：逐篇 setClipStatus(done)；拾遗侧写开关未开/失败如实计数，不伪造成功 */
    async function markGleanDone() {
      if (gleanDoneBusy || !gleanPendingDone.length) return;
      const g = probeGlean(window);
      if (!g) {
        gleanErrorAction = "mark";
        gleanError = t("ai.gleanUnavailable");
        return;
      }
      gleanDoneBusy = true;
      gleanError = "";
      try {
        let ok = 0;
        for (const c of gleanPendingDone) {
          if (await markClipDone(g, c.id)) ok++;
        }
        gleanDoneNote = ok === gleanPendingDone.length
          ? t("ai.gleanDoneAll").replace("{n}", String(ok))
          : t("ai.gleanDonePartial").replace("{ok}", String(ok)).replace("{n}", String(gleanPendingDone.length));
        showMessage(gleanDoneNote, 4600, ok ? "info" : "error");
        if (ok === gleanPendingDone.length) gleanPendingDone = [];
      } catch (e) {
        gleanErrorAction = "mark";
        gleanError = t("ai.gleanMarkFailed").replace("{message}", String(e instanceof Error ? e.message : e));
      } finally { gleanDoneBusy = false; }
    }
    let aiCount = $state(5);
    let aiDifficulty = $state<"easy" | "medium" | "hard" | "mixed">("mixed");
    let aiKp = $state("");
    const aiCustomEndpointSet = $derived(!!String(plugin.settingUtils?.get?.("aiEndpoint") ?? "").trim() && !!resolveAiKey(plugin));
    let aiBusy = $state(false);
    let aiCancel = $state({ aborted: false });
    let aiQuality = $state<"standard" | "economy">("standard");
    let aiCost = $state("");
    let aiCustomHint = $state("");
    let aiError = $state("");
    let aiPreparing = $state(false);
    let aiBatchBusy = $state(false);
    let aiQueueOptions = $state<import("@/ai/gen").GenOptions | null>(null);
    function snapshotAiOptions(): import("@/ai/gen").GenOptions {
      const customHint = [String(plugin.settingUtils?.get?.("aiCustomHint") ?? "").trim(), aiCustomHint.trim()].filter(Boolean).join("\n");
      return { types: ["single", "multiple", "judge"], count: aiCount, difficulty: aiDifficulty,
        kp: aiKp, sourceTitle: t("ai.pastedMaterial"), preset: aiPreset, quality: aiQuality,
        customHint: customHint || undefined };
    }
    let aiPreset = $state<keyof typeof import("@/ai/gen").PROMPT_PRESETS>("default");
    let aiQueue = $state<Question[]>([]);
    let aiRejected = $state<{ index: number; reason: string }[]>([]);
    let aiDuplicates = $state(0);
    let aiSaved = $state(0);
    /** 累计 AI 用量（app.aiUsage；本地统计，生成后刷新） */
    let aiUsageTotal = $state<{ totalTokens: number; totalCalls: number } | null>(null);
    $effect(() => { void (app as any).aiUsage().then((u: { totalTokens: number; totalCalls: number }) => (aiUsageTotal = u)); });
    /** 待审核队列持久化（TODO 27 组）：切视图/重载不丢生成结果 */
    async function persistAiQueue() {
      try { await app.saveAux("ai/review-queue", { queue: aiQueue, rejected: aiRejected, duplicates: aiDuplicates, bankId: aiQueueBankId, material: aiQueueMaterial, options: aiQueueOptions }); }
      catch { aiError = t("ai.queueSaveFailed"); }
    }
    async function saveGenerationUsage(counting: { id: string; approxTokens: number; calls: number }) {
      try {
        await app.recordAiUsage(counting.id, counting.approxTokens, counting.calls);
        aiUsageTotal = await app.aiUsage();
      } catch { showMessage(t("ai.usageSaveFailed"), 4600, "error"); }
    }
    async function restoreAiQueue() {
      try {
        const v = await app.loadAux<{ queue: Question[]; rejected: typeof aiRejected; duplicates: number; material?: string; options?: import("@/ai/gen").GenOptions }>("ai/review-queue");
        if (v?.queue?.length || v?.rejected?.length) { aiQueue = v.queue ?? []; aiRejected = v.rejected ?? []; aiDuplicates = v.duplicates ?? 0; aiQueueBankId = (v as any).bankId ?? ""; aiQueueMaterial = v.material ?? ""; aiQueueOptions = v.options ?? null; }
      } catch { /* 忽略 */ }
    }

    async function runAiGenerate() {
      if (aiMutationBusy || !aiSource.trim() || !activeBankId) return;
      const requestBankId = activeBankId;
      const requestMaterial = aiSource;
      const requestOptions = snapshotAiOptions();
      const requestGleanClips = [...gleanPendingDone];
      aiPreparing = true;
      try {
      // 未审旧队列守卫（41-04）：重新生成会替换队列，旧候选需用户显式确认放弃
      const { confirmDialogSync } = await import("../../libs/dialog");
      if (aiQueue.length && !(await confirmDialogSync({
        title: t("ai.regenerate"),
        content: t("ai.regenerateConfirm").replace("{n}", String(aiQueue.length)),
      }))) return;
      // 首次调用数据流确认（26.2 P0）：端点/范围/取消入口。
      // 41-06：确认绑定端点——端点改变（含自定义↔内置切换）时重新确认，不沿用旧同意
      const currentEndpoint = String(plugin.settingUtils?.get?.("aiEndpoint") ?? "").trim() || "(内置)";
      const consentKey = "lv-exam-ai-consent";
      let consented = readLocal(consentKey);
      try {
        const parsed = JSON.parse(consented ?? "") as { endpoint?: string } | null; // 旧版 "1" 解析失败 → 视为未同意
        if (parsed?.endpoint) consented = parsed.endpoint;
        else consented = null;
      } catch {
        if (consented !== null && consented !== "1") consented = null;
        else if (consented === "1") consented = "(legacy)"; // 旧版布尔同意：不绑定端点，保留行为
      }
      if (consented !== currentEndpoint) {
        const ep = String(plugin.settingUtils?.get?.("aiEndpoint") ?? "").trim();
        const msg = ep
          ? `${t("ai.consentTitle")}<br>${t("ai.consentCustom")} ${escapeHtml(redactUrlForDisplay(ep))}`
          : `${t("ai.consentTitle")}<br>${t("ai.consentSiyuan")}`;
        if (!(await confirmDialogSync({ title: t("ai.consentTitle"), content: `${msg}<br><br>${t("ai.consentScope")}` }))) return;
        writeLocal(consentKey, JSON.stringify({ endpoint: currentEndpoint }));
      }
      aiCancel = { aborted: false };
      aiBusy = true; aiError = ""; aiQueue = []; aiRejected = []; aiDuplicates = 0; aiSaved = 0;
      aiQueueBankId = requestBankId; aiQueueMaterial = requestMaterial; aiQueueOptions = requestOptions;
      void persistAiQueue();
      try {
        const { generate } = await import("@/ai/gen");
        const { CountingChannel } = await import("@/ai/counting");
        const counting = new CountingChannel(await makeAiChannel());
        const r = await generate(counting, requestMaterial, { ...requestOptions, signal: aiCancel });
        aiCost = `≈${counting.approxTokens} tok · ${counting.calls} ${t("ai.usageCalls")}`;
        await saveGenerationUsage(counting);
        aiQueue = r.pending; aiRejected = r.rejected; aiDuplicates = r.duplicates;
        gleanPendingDone = requestGleanClips;
        void persistAiQueue();
        // 60-01 写方向：出题成功且素材来自拾遗 → 提供「标记已读」闭环入口
        if (r.pending.length && gleanPendingDone.length) {
          const g = probeGlean(window);
          gleanDoneNote = g ? "" : t("ai.gleanUnavailable");
        }
        if (!r.pending.length && !r.rejected.length) aiError = t("ai.empty");
      } catch (e) {
        aiError = String(e instanceof Error ? e.message : e);
      } finally {
        aiCancel.aborted = false;
        aiBusy = false;
      }
      } finally { aiPreparing = false; }
    }

    function cancelAiGenerate() {
      aiCancel.aborted = true;
      showMessage(t("ai.cancelRequested"), 3000, "info");
    }

    /** 材料源扩展（v1.x）：从当前打开的文档载入（research/28 citation 载体；块引用随 v1.x 深化） */
    async function aiSourceFromCurrentDoc() {
      try {
        const sApp = (plugin as any).app ?? plugin;
        // 社区约定：app.ui.currentEditor（官方类型未导出，as any + 多级兜底）
        const ed = sApp?.ui?.currentEditor ?? sApp?.ui?.lastEditor ?? null;
        const rootId: string | undefined = ed?.protyle?.block?.rootID;
        if (!rootId) { showMessage(t("ai.noCurrentDoc"), 3600, "error"); return; }
        const { title, content } = await (app as any).deps.client.exportDocMarkdown(rootId);
        if (!content) { showMessage(t("ai.noCurrentDoc"), 3600, "error"); return; }
        aiSource = content;
        aiSourceOrigin = `${t("ai.sourceFromDocument").replace("{title}", title || rootId.slice(0, 8))}`;
        if (!aiKp.trim() && title) aiKp = title;
        showMessage(`${t("ai.sourceLoaded")} ${title || rootId.slice(0, 8)}`, 2600, "info");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      }
    }

    /** 通道构造（生成/修复共用）：端点+Key 配置走 OpenAI 兼容，否则思源内置 */
    async function makeAiChannel() {
      const { SiyuanAiChannel, OpenAiChannel } = await import("@/ai/client");
      const endpoint = String(plugin.settingUtils?.get?.("aiEndpoint") ?? "");
      const key = resolveAiKey(plugin);
      const model = String(plugin.settingUtils?.get?.("aiModel") ?? "gpt-4o-mini");
      return endpoint && key
        ? new OpenAiChannel({ endpoint, apiKey: key, model }, (u, i) => fetch(u, i))
        : new SiyuanAiChannel((app as any).deps.client);
    }

    /** 拒绝项重试（AI Inbox 范式"重试"腿）：带否决原因让 AI 修复 → 复检 → 合入待审核 */
    async function retryRejected() {
      if (aiMutationBusy || !aiRejected.length || queueBankMismatch()) return;
      const source = aiQueueMaterial.trim();
      if (!source) { aiError = t("ai.regenNoSource"); return; }
      const rejected = [...aiRejected];
      const requestOptions = { ...(aiQueueOptions ?? snapshotAiOptions()), count: rejected.length };
      aiCancel = { aborted: false };
      aiBusy = true; aiError = "";
      try {
        const { repairIssues } = await import("@/ai/gen");
        const { CountingChannel } = await import("@/ai/counting");
        const counting = new CountingChannel(await makeAiChannel());
        const r = await repairIssues(counting, rejected as import("@/ai/gen").GenIssue[], source, { ...requestOptions, signal: aiCancel });
        aiCost = `≈${counting.approxTokens} tok · ${counting.calls} ${t("ai.usageCalls")}`;
        await saveGenerationUsage(counting);
        aiQueue = [...aiQueue, ...r.pending];
        aiRejected = r.rejected;
        aiDuplicates += r.duplicates;
        void persistAiQueue();
        if (r.pending.length) showMessage(t("ai.repaired").replace("{n}", String(r.pending.length)), 2600, "info");
      } catch (e) {
        aiError = String(e instanceof Error ? e.message : e);
      } finally {
        aiCancel.aborted = false;
        aiBusy = false;
      }
    }

    // 审批防重入（41-04）：写入在途时同一题不再触发；失败退回队列不丢候选
    const approving = new SvelteSet<string>();
    /** 队列归属题库（41-04 切库不误写）：生成时记录；旧持久化队列无 bankId 则跳过校验 */
    let aiQueueBankId = $state("");

    function queueBankMismatch(): boolean {
      if (aiQueueBankId && activeBankId !== aiQueueBankId) {
        showMessage(t("ai.queueWrongBank"), 4600, "error");
        return true;
      }
      return false;
    }

    async function approveAi(q: Question, silent = false) {
      if (aiBusy || aiPreparing || aiRegenBusy || approving.has(q.id) || queueBankMismatch() || !activeBankId) return;
      const targetBankId = aiQueueBankId || activeBankId;
      approving.add(q.id);
      // 乐观出队：按钮即消失，不依赖写入往返；计数只加一次
      aiQueue = aiQueue.filter((x) => x.id !== q.id);
      try {
        await app.writeManualQuestion(targetBankId, q);
        aiSaved++;
        await refreshQuestionsAfterWrite(questions.length + 1);
        void persistAiQueue();
      } catch (e) {
        aiQueue = [...aiQueue, q];                           // 写入失败：退回队列（保住候选与计数一致）
        if (!silent) showMessage(offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e), 4200, "error");
      } finally {
        approving.delete(q.id);
      }
    }

    function dropAi(q: Question) {
      if (aiMutationBusy) return;
      aiQueue = aiQueue.filter((x) => x.id !== q.id);
      void persistAiQueue();
    }

    async function approveAllAi() {
      if (aiMutationBusy || queueBankMismatch()) return;
      aiBatchBusy = true;
      try {
      const total = aiQueue.length;
      for (const q of [...aiQueue]) await approveAi(q, true); // 批量时抑制逐题 toast（41-04：统一汇总）
      void persistAiQueue();
      // 41-04 批量部分失败汇总：仍在队列的 = 写入失败退回的候选
      const failed = aiQueue.length;
      if (total > 0) {
        showMessage(
          failed ? t("ai.batchPartial").replace("{f}", String(failed)).replace("{t}", String(total)) : t("ai.batchAllOk").replace("{n}", String(total)),
          4600,
          failed ? "error" : "info",
        );
      }
      } finally { aiBatchBusy = false; }
    }

    // ---------- 候选编辑 + 单题重生成（41-04 剩余收口） ----------
    let aiQueueMaterial = $state("");      // 生成时材料快照：单题重生成的输入（随队列持久化）
    let editingAiId = $state("");
    let aiEditDraft = $state<{ stem: string; options: string[]; answer: string; analysis: string } | null>(null);
    let aiEditError = $state("");
    let aiRegenBusy = $state("");
    const aiMutationBusy = $derived(aiBusy || aiPreparing || !!aiRegenBusy || approving.size > 0 || aiBatchBusy);

    function startEditAi(q: Question) {
      if (aiMutationBusy) return;
      editingAiId = q.id;
      aiEditError = "";
      aiEditDraft = { stem: q.stem, options: [...q.options], answer: q.answer, analysis: q.analysis ?? "" };
    }

    function cancelEditAi() {
      editingAiId = ""; aiEditDraft = null; aiEditError = "";
    }

    function saveEditAi(q: Question) {
      if (!aiEditDraft) return;
      const stem = aiEditDraft.stem.trim();
      const options = aiEditDraft.options.map((o) => o.trim());
      const answer = normalizeAnswer(q.type, aiEditDraft.answer) ?? "";
      const edited: Question = { ...q, stem, options, answer, analysis: aiEditDraft.analysis.trim(), hash: questionHash(stem, options) };
      const bad = validate(edited);
      if (bad) { aiEditError = bad; return; }
      aiQueue = aiQueue.map((x) => (x.id === q.id ? edited : x));
      cancelEditAi();
      void persistAiQueue();
    }

    /** 单题重生成：用生成时的材料快照按同题型/考点重出 1 题，替换原候选（41-04） */
    async function regenOneAi(q: Question) {
      if (aiMutationBusy || queueBankMismatch()) return;
      if (!aiQueueMaterial.trim()) { showMessage(t("ai.regenNoSource"), 3600, "info"); return; }
      const requestMaterial = aiQueueMaterial;
      const requestOptions = { ...(aiQueueOptions ?? snapshotAiOptions()), types: [q.type], count: 1, kp: q.kp };
      aiCancel = { aborted: false };
      aiRegenBusy = q.id; aiError = "";
      try {
        const { generate } = await import("@/ai/gen");
        const { CountingChannel } = await import("@/ai/counting");
        const counting = new CountingChannel(await makeAiChannel());
        const r = await generate(counting, requestMaterial, { ...requestOptions, signal: aiCancel });
        aiCost = `≈${counting.approxTokens} tok · ${counting.calls} ${t("ai.usageCalls")}`;
        await saveGenerationUsage(counting);
        if (r.pending[0]) {
          aiQueue = aiQueue.map((x) => (x.id === q.id ? r.pending[0] : x));
          void persistAiQueue();
          showMessage(t("ai.regenDone"), 2800, "info");
        } else {
          aiError = r.rejected[0]?.reason ?? t("ai.empty");
        }
      } catch (e) {
        aiError = String(e instanceof Error ? e.message : e);
      } finally { aiRegenBusy = ""; }
    }

    // ---------- 导入 ----------
    function onImportStrategyChange() {
      if (importBusy) return;
      if (sheetRowsCache.get(activeSheet)?.length) parseActiveSheet();
      else { importReport = null; importPreviewBankId = ""; importError = t("import.repreview"); }
    }
    async function doParseText() {
      if (importBusy) return;
      importError = ""; importResult = null; retryPool = []; trialConfirmed = []; trialNote = "";
      if (!importText.trim()) { importError = t("import.noInput"); return; }
      const targetBankId = activeBankId;
      importParsing = true; importReport = null; updateResult = null;
      try {
        // parseText 按内容特征分流（廿五批）：GIFT / TSV(Anki) / Aiken；
        // 并存模式（2.3 重复合并策略 lite）：不回灌已有题 hash → 与题库重复的行照常入库（批内去重仍生效）
        importReport = await parseText(importText, {
          existingHashes: dupeStrategy === "coexist" ? new Set<string>() : new Set(questions.map((q) => q.hash)),
          duplicateStrategy: dupeStrategy,
        });
        importPreviewBankId = targetBankId;
      } catch (e) { importError = String(e); }
      finally { importParsing = false; }
    }

    async function onExcelFile(e: Event) {
      if (importBusy) return;
      importError = ""; importResult = null; importReport = null; retryPool = []; trialConfirmed = []; trialNote = "";
      // 清理上次导入残留（TODO 27 组：多 Sheet 残留状态 bug 预防）
      sheetNames = []; sheetRowsCache = new Map();
      manualMap = null; mapEditorOpen = false; mapErrors = []; // 38-02：手动映射随文件更换重置
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      importParsing = true; updateResult = null;
      try {
        // 38-01：xlsx/xls 走二进制读取，仅 CSV 做编码/分隔符探测
        //（此前 xlsx 也过 decodeCsv 文本路径，真 XLSX 报 Bad compressed size）
        const XLSX = await import("xlsx");
        const { parseWorkbookFile } = await import("@/importer/workbookFile");
        const buf = await file.arrayBuffer();
        const parsed = await parseWorkbookFile(XLSX, buf, file.name);
        if (parsed.garbled) showMessage(t("import.garbledWarning"), 5200, "info");
        sheetNames = parsed.sheetNames;
        sheetRowsCache = parsed.sheets;
        activeSheet = sheetNames[0];
        parseActiveSheet();
      } catch (e) { importError = String(e instanceof Error ? e.message : e); }
      finally { importParsing = false; input.value = ""; }
    }

    /** 多 Sheet 支持（TODO 12 组）：读文件时缓存各行，选择工作表重解析 */
    let sheetNames = $state<string[]>([]);
    let activeSheet = $state("");
    let sheetRowsCache = $state(new Map<string, string[][]>());

    function parseActiveSheet() {
      if (committing || trialBusy) return;
      importError = "";
      importReport = null; importResult = null; updateResult = null;
      importPreviewBankId = activeBankId;
      // U07：重解析（切映射/切 Sheet）产生全新 qid → 旧试导确认/重试池全部失效；
      // 不清会导致 commitImport 的排除过滤永远不命中 → 已试导确认的行被整批重导（双导入）
      trialConfirmed = []; trialNote = ""; retryPool = [];
      const rows = sheetRowsCache.get(activeSheet);
      if (!rows?.length) { importError = t("import.emptyFile"); return; }
      // 回灌去重（2.3）：与题库已有题比对；并存模式（重合并策略 lite）置空 → 重复行照常入库
      const existing = dupeStrategy === "coexist" ? new Set<string>() : new Set(questions.map((q) => q.hash));
      // 手动映射（38-02）优先；列越界（换文件/切 Sheet 后）→ 提示并回退自动映射
      if (manualMap) {
        const width = rows[0].length;
        const idxs = [manualMap.type, manualMap.stem, manualMap.answer, manualMap.analysis, manualMap.difficulty, manualMap.kp, manualMap.score, manualMap.source, ...(manualMap.options ?? [])];
        if (idxs.some((i) => i != null && i >= width)) {
          importError = t("import.mappingMismatch");
          manualMap = null;
          return;
        }
        lastMap = manualMap;
        importReport = parseExcelRows(rows.slice(1), manualMap, { existingHashes: existing, duplicateStrategy: dupeStrategy });
        return;
      }
      // 映射复用（2.3/38-02）：已保存映射优先；列越界守卫 → 提示并回退自动映射
      const saved = savedMappings.find((m) => m.name === selectedMapping);
      if (saved) {
        const width = rows[0].length;
        const idxs = [saved.map.type, saved.map.stem, saved.map.answer, saved.map.analysis, saved.map.difficulty, saved.map.kp, saved.map.score, saved.map.source, ...(saved.map.options ?? [])];
        if (idxs.some((i) => i != null && i >= width)) {
          importError = t("import.mappingMismatch");
          selectedMapping = "";
          return;
        }
        lastMap = saved.map;
        importReport = parseExcelRows(rows.slice(1), saved.map, { existingHashes: existing, duplicateStrategy: dupeStrategy });
        return;
      }
      const { map, missing } = autoMapExcel(rows[0].map(String));
      if (missing.length) {
        importError = t("import.missingColumns") + missing.join("、");
        // 38-02：自动映射失败 → 直接展开手动映射编辑器（预填最优猜测，异名列/乱序表可手动指派）
        mapAssign = autoAssignment(rows[0].map(String));
        mapErrors = [];
        mapEditorOpen = true;
        return;
      }
      lastMap = map;
      importReport = parseExcelRows(rows.slice(1), map, { existingHashes: existing, duplicateStrategy: dupeStrategy });
    }

    // ---------- 手动列映射（38-02）：自动失败/异名列/乱序表可手动指派列↔字段 ----------
    let mapEditorOpen = $state(false);
    let manualMap = $state<import("../../importer/pipeline").ExcelColumnMap | null>(null);
    let mapAssign = $state<MapAssignment>(emptyAssignment());
    let mapErrors = $state<string[]>([]);
    /** 编辑器字段行（options 槽单独渲染） */
    const MAP_FIELDS: { key: "type" | "stem" | "answer" | "analysis" | "difficulty" | "kp" | "score" | "source"; i18n: string }[] = [
      { key: "type", i18n: "import.f.type" },
      { key: "stem", i18n: "import.f.stem" },
      { key: "answer", i18n: "import.f.answer" },
      { key: "analysis", i18n: "import.f.analysis" },
      { key: "difficulty", i18n: "import.f.difficulty" },
      { key: "kp", i18n: "import.f.kp" },
      { key: "score", i18n: "import.f.score" },
      { key: "source", i18n: "import.f.source" },
    ];

    function toggleMapEditor() {
      if (importBusy) return;
      mapEditorOpen = !mapEditorOpen;
      if (!mapEditorOpen) return;
      mapErrors = [];
      const rows = sheetRowsCache.get(activeSheet);
      if (!rows?.length) return;
      // 预填优先级：当前手动映射 > 已保存映射 > 自动映射最优猜测
      const base = manualMap ?? savedMappings.find((m) => m.name === selectedMapping)?.map ?? null;
      mapAssign = base ? assignmentFromMap(base) : autoAssignment(rows[0].map(String));
    }

    function applyManualMap() {
      if (importBusy) return;
      const rows = sheetRowsCache.get(activeSheet);
      if (!rows?.length) return;
      const errs = assignmentErrors(mapAssign, rows[0].length);
      if (errs.length) { mapErrors = errs; return; }
      manualMap = assignmentToMap(mapAssign);
      selectedMapping = ""; // 手动映射与已保存映射互斥
      mapEditorOpen = false;
      parseActiveSheet(); // U07：重解析清 trialConfirmed/retryPool
    }

    // ---------- 学习资料（120-01/02/06 lite）：登记 / 列表 / 最低查看 ----------
    let materialsList = $state<import("../../core/materials").MaterialDoc[]>([]);
    let materialsBusy = $state(false);
    let materialsNote = $state("");
    let matSubject = $state("");
    let matChapter = $state("");
    let matLink = $state("");
    let matLinkTitle = $state("");
    /** 六七批：资料搜索（标题/科目/章节/位置，大小写不敏感） */
    let materialsSearch = $state("");
    let selectedMaterialId = $state("");
    const materialsFiltered = $derived.by(() => {
      const kw = materialsSearch.trim().toLowerCase();
      if (!kw) return materialsList;
      return materialsList.filter((m) =>
        [m.title, m.subject, m.chapter, ...m.locations.map((l) => l.path)]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(kw)),
      );
    });
    const selectedMaterial = $derived(materialsFiltered.find((m) => m.id === selectedMaterialId) ?? materialsFiltered[0] ?? null);

    function loadMaterials() {
      materialsList = app.listMaterials();
      if (selectedMaterialId && !materialsList.some((m) => m.id === selectedMaterialId)) selectedMaterialId = "";
    }

    function matIconName(kind: string): string {
      if (kind === "pdf") return "table";
      if (kind === "video") return "play";
      if (kind === "audio") return "volume";
      if (kind === "image") return "file";
      if (kind === "doc") return "file";
      return "folder";
    }

    async function onMaterialFile(e: Event) {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = "";
      if (!file || materialsBusy) return;
      materialsBusy = true; materialsNote = "";
      try {
        const { material, deduped } = await app.registerMaterialFromFile(file, { subject: matSubject, chapter: matChapter });
        loadMaterials();
        materialsNote = deduped ? t("materials.deduped") : `✓ ${t("materials.registered")} ${material.title}`;
      } catch (err) {
        materialsNote = String(err instanceof Error ? err.message : err);
      } finally { materialsBusy = false; }
    }

    async function registerMaterialLink() {
      if (!matLink.trim() || materialsBusy) return;
      materialsBusy = true; materialsNote = "";
      try {
        const { material, deduped } = await app.registerMaterialFromLink(matLink, {
          title: matLinkTitle, subject: matSubject, chapter: matChapter,
        });
        loadMaterials();
        matLink = ""; matLinkTitle = "";
        materialsNote = deduped ? t("materials.deduped") : `✓ ${t("materials.registered")} ${material.title}`;
      } catch (err) {
        materialsNote = String(err instanceof Error ? err.message : err);
      } finally { materialsBusy = false; }
    }

    /** 120-06 最低查看：assets → 内核静态 URL（浏览器原生看 PDF/播媒体）；link → 经隐私闸打开 */
    /** 73-02 lite：外链隐私闸——link 类素材打开前显示完整目的地，默认不自动请求；
     *  资产类（本地内核静态文件）不受闸。取消时复制链接，可到外部浏览器打开。 */
    async function gatedOpen(url: string, _m?: import("../../core/materials").MaterialDoc): Promise<void> {
      const link = resolveLink(url, window.location.href);
      if (link.disposition === "blocked") return;
      if (link.disposition === "internal") {
        window.open(link.href, "_blank", "noopener,noreferrer");
        return;
      }
      const { confirmDialogSync } = await import("../../libs/dialog");
      const ok = await confirmDialogSync({
        title: t("gate.linkTitle"),
        content:
          "<div style='word-break:break-all;font-size:var(--lv-font-size-meta)'>" +
          escapeHtml(redactUrlForDisplay(link.href)) +
          "</div><p class='lv-hint' style='text-align:left'>" + t("gate.linkDesc") + "</p>",
      });
      if (ok) { window.open(link.href, "_blank", "noopener,noreferrer"); return; }
      try { await navigator.clipboard.writeText(link.href); showMessage(t("gate.linkCopied"), 2400, "info"); } catch { /* 剪贴板不可用则静默 */ }
    }

    /** 73-02：题面富文本链接只能经外链闸打开，避免 {@html} 中的 href 直达网络。 */
    function onRichTextClick(e: MouseEvent): void {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (!tabRoot?.contains(target)) return;
      const anchor = target.closest("a[href]");
      if (!anchor || !target.closest(".lv-rich")) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      const link = resolveLink(href, window.location.href);
      if (link.disposition === "internal") return;
      e.preventDefault();
      if (link.disposition === "external") void gatedOpen(link.href);
    }

    function openMaterial(m: import("../../core/materials").MaterialDoc) {
      selectedMaterialId = m.id;
      const url = app.resolveMaterialUrlOf(m, window.location.origin);
      if (!url) { materialsNote = t("materials.cannotOpen"); return; }
      void gatedOpen(url, m);
    }

    /** R54 原型高级交互：把资料/笔记一键带入手工出题 */
    function bridgeMaterialToManual(m: import("../../core/materials").MaterialDoc, noteText = "") {
      mSource = [m.subject, m.chapter, m.title].filter(Boolean).join(" / ");
      if (noteText) {
        mStem = noteText;
      }
      view = "manual";
    }

    /** R54 原型高级交互：把资料/笔记一键带入 AI 材料 */
    function bridgeMaterialToAi(m: import("../../core/materials").MaterialDoc, noteText = "") {
      const notes = app.listMaterialNotes(m.id).map((n) => n.text).join("\n\n");
      const content = [
        `【资料出处】${[m.subject, m.chapter, m.title].filter(Boolean).join(" / ")}`,
        noteText ? `【重点笔记】\n${noteText}` : notes ? `【资料笔记】\n${notes}` : "",
      ].filter(Boolean).join("\n\n");
      aiSource = content;
      view = "ai";
    }

    async function removeMaterialEntry(m: import("../../core/materials").MaterialDoc) {
      const { confirmDialogSync } = await import("../../libs/dialog");
      const ok = await confirmDialogSync({
        title: t("materials.removeTitle"),
        content: `${escapeHtml(m.title)}<br><span style="font-size:var(--lv-font-size-sm);color:var(--b3-theme-on-surface-light, #888)">${t("materials.removeNote")}</span>`,
      });
      if (!ok) return;
      materialsBusy = true; materialsNote = "";
      try {
        await app.removeMaterialById(m.id);
        loadMaterials();
        if (notesOpenId === m.id) { notesOpenId = ""; notesCache = []; }
        materialsNote = t("materials.removed");
      } catch (err) {
        materialsNote = String(err instanceof Error ? err.message : err);
      } finally { materialsBusy = false; }
    }

    // ---------- 资料定位与个人笔记（121-02/03 + 122-02/03 lite） ----------
    let notesOpenId = $state("");
    let notesCache = $state<import("../../core/materialNotes").MaterialNote[]>([]);
    let noteEditingId = $state("");
    let noteText = $state("");
    let notePage = $state("");
    let noteTime = $state("");
    let noteQuote = $state("");
    let noteTags = $state("");
    let noteFormError = $state("");
    let noteBaseline = $state("");
    const noteDrafts = new SvelteMap<string, { editingId: string; text: string; page: string; time: string; quote: string; tags: string; baseline: string }>();
    function noteSignature() { return JSON.stringify([noteEditingId, noteText, notePage, noteTime, noteQuote, noteTags]); }
    const noteDirty = $derived(noteSignature() !== noteBaseline && !!(noteText || notePage || noteTime || noteQuote || noteTags));

    function toggleNotes(m: import("../../core/materials").MaterialDoc) {
      if (materialsBusy) return;
      if (notesOpenId) noteDrafts.set(notesOpenId, { editingId: noteEditingId, text: noteText, page: notePage, time: noteTime, quote: noteQuote, tags: noteTags, baseline: noteBaseline });
      notesOpenId = notesOpenId === m.id ? "" : m.id;
      if (notesOpenId) {
        refreshNotes(m); resetNoteForm();
        const draft = noteDrafts.get(m.id);
        if (draft) { noteEditingId = draft.editingId; noteText = draft.text; notePage = draft.page; noteTime = draft.time; noteQuote = draft.quote; noteTags = draft.tags; noteBaseline = draft.baseline; }
      }
    }
    function refreshNotes(m: import("../../core/materials").MaterialDoc) {
      notesCache = app.listMaterialNotes(m.id);
    }
    function resetNoteForm() {
      noteEditingId = ""; noteText = ""; notePage = ""; noteTime = ""; noteQuote = ""; noteTags = ""; noteFormError = "";
      noteBaseline = noteSignature();
    }
    async function startEditNote(n: import("../../core/materialNotes").MaterialNote) {
      if (materialsBusy || noteEditingId === n.id) return;
      if (noteDirty) {
        const { confirmDialogSync } = await import("../../libs/dialog");
        if (!(await confirmDialogSync({ title: t("materials.replaceDraftTitle"), content: t("materials.replaceDraftConfirm") }))) return;
      }
      if (materialsBusy) return;
      noteEditingId = n.id;
      noteText = n.text;
      notePage = n.locator?.page != null ? String(n.locator.page) : "";
      noteTime = n.locator?.tSec != null ? formatSecToTime(n.locator.tSec) : "";
      noteQuote = n.locator?.quote ?? "";
      noteTags = (n.tags ?? []).join("，");
      noteFormError = "";
      noteBaseline = noteSignature();
    }
    async function saveNote(m: import("../../core/materials").MaterialDoc) {
      if (!noteText.trim() || materialsBusy) return;
      const signature = noteSignature();
      const editingId = noteEditingId;
      noteFormError = ""; materialsBusy = true;
      try {
        const page = notePage.trim() ? Number(notePage) : undefined;
        if (notePage.trim() && (!Number.isInteger(page) || page! < 1)) throw new Error(t("materials.badPage"));
        const tSec = noteTime.trim() ? parseTimeToSec(noteTime) : undefined;
        const quote = noteQuote.trim() || undefined;
        const locator: import("../../core/materialNotes").NoteLocator | null =
          page == null && tSec == null && !quote ? null : { page, tSec, quote };
        const tags = noteTags.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        if (editingId) await app.updateMaterialNote(editingId, { locator, text: noteText, tags });
        else await app.addMaterialNote({ materialId: m.id, revision: m.revision, locator, text: noteText, tags });
        if (notesOpenId === m.id) {
          refreshNotes(m);
          if (signature === noteSignature()) { resetNoteForm(); noteDrafts.delete(m.id); }
        }
        materialsNote = t("materials.noteSaved");
      } catch (err) {
        noteFormError = String(err instanceof Error ? err.message : err);
      } finally { materialsBusy = false; }
    }
    async function removeNoteEntry(m: import("../../core/materials").MaterialDoc, n: import("../../core/materialNotes").MaterialNote) {
      if (materialsBusy) return;
      const { confirmDialogSync } = await import("../../libs/dialog");
      if (!(await confirmDialogSync({ title: t("materials.noteDelTitle"), content: escapeHtml(n.text.slice(0, 80)) }))) return;
      if (materialsBusy) return;
      materialsBusy = true;
      try {
        await app.deleteMaterialNote(n.id);
        refreshNotes(m);
        if (noteEditingId === n.id) noteEditingId = "";
      } catch (err) {
        materialsNote = String(err instanceof Error ? err.message : err);
      } finally { materialsBusy = false; }
    }
    /** 定位打开：PDF → #page、媒体 → #t（浏览器原生 seek）；无定位=普通打开 */
    function openMaterialAt(m: import("../../core/materials").MaterialDoc, n: import("../../core/materialNotes").MaterialNote) {
      const base = app.resolveMaterialUrlOf(m, window.location.origin);
      const url = locatedUrl(base, n.locator);
      if (!url) { materialsNote = t("materials.cannotOpen"); return; }
      void gatedOpen(url, m);
    }

    // ---------- 映射保存/复用（2.3/38-02） ----------
    let savedMappings = $state<{ name: string; map: import("../../importer/pipeline").ExcelColumnMap }[]>([]);
    let selectedMapping = $state("");
    let lastMap = $state<import("../../importer/pipeline").ExcelColumnMap | null>(null);
    let mappingBusy = $state(false);

    async function loadMappings() {
      try {
        const v = await app.loadAux<{ name: string; map: import("../../importer/pipeline").ExcelColumnMap }[]>("import/mappings");
        savedMappings = Array.isArray(v) ? v : [];
      } catch { savedMappings = []; }
    }

    async function saveMapping() {
      if (!lastMap || mappingBusy) return;
      const { inputDialogSync } = await import("../../libs/dialog");
      const name = (await inputDialogSync({ title: t("import.mappingName"), placeholder: t("import.mappingNameHint") }))?.trim();
      if (!name) return;
      const previous = savedMappings;
      const next = [...previous.filter((m) => m.name !== name), { name, map: JSON.parse(JSON.stringify(lastMap)) }].slice(-20);
      mappingBusy = true;
      savedMappings = next;
      try {
        await app.saveAux("import/mappings", next);
        showMessage(t("settingSaved"), 2400, "info");
      } catch (e) {
        savedMappings = previous;
        showMessage(t("import.mappingSaveFailed").replace("{message}", String(e instanceof Error ? e.message : e)), 4200, "error");
      } finally { mappingBusy = false; }
    }

    let favOnly = $state(false);
    // 浏览工具「更多」菜单：开启中任一维护面板时按钮出点标；Esc 关闭（ARIA menu 惯例）
    let moreOpen = $state(false);
    let moreRoot = $state<HTMLDivElement | null>(null);
    let morePop = $state<HTMLDivElement | null>(null);
    let moreFocusTimer: ReturnType<typeof setTimeout> | null = null;
    function clearMoreFocusTimer() {
      if (moreFocusTimer) clearTimeout(moreFocusTimer);
      moreFocusTimer = null;
    }
    function onWindowClick(e: MouseEvent) {
      if (moreOpen && moreRoot && !moreRoot.contains(e.target as Node)) moreOpen = false;
    }
    function toggleMore() {
      clearMoreFocusTimer();
      moreOpen = !moreOpen;
      if (moreOpen) {
        const expectedRoot = moreRoot;
        moreFocusTimer = setTimeout(() => {
          moreFocusTimer = null;
          if (moreOpen && expectedRoot?.isConnected && moreRoot === expectedRoot) morePop?.focus();
        }, 0); // 焦点入菜单，Esc/Tab 语义成立
      }
    }
    let browseLimit = $state(200);
    let searchText = $state("");
    /** 搜索防抖（体验/perf）：大题库逐键全量过滤掉帧；180ms 尾随，编程赋值走 setSearch 即时生效 */
    let searchDebounced = $state("");
    function setSearch(v: string) {
      searchText = v;
      searchDebounced = v;
    }
    $effect(() => {
      const v = searchText;
      const t = setTimeout(() => { searchDebounced = v; }, 180);
      return () => clearTimeout(t);
    });
    /** 65-01 lite：结构化筛选——题型/来源/仅错题（与搜索词叠加；命中数在工具栏实时可见） */
    let filterType = $state("");
    let filterSource = $state("");
    let filterWrong = $state(false);
    /** 三七批补全：仅受助（本题作答前被讲解/提示过）/ 近 N 天有作答（0=不限） */
    let filterHelp = $state(false);
    let filterDays = $state(0);
    const sourceOptions = $derived(
      [...new Set(questions.map((q) => (q.source ?? "").trim()).filter(Boolean))].sort().slice(0, 30),
    );
    const filteredQuestions = $derived.by(() => {
      void dataRev; // 错题/受助/近 N 天过滤依赖应用层流水缓存，随总线事件失效（同 wrongList 注）
      let list = favOnly ? questions.filter((q) => q.fav) : questions;
      if (sectionSel) list = list.filter((q) => questionInSection(q, sectionSel!));
      if (filterType) list = list.filter((q) => q.type === filterType);
      if (filterSource === "@@none") list = list.filter((q) => !(q.source ?? "").trim()); // 43-04：缺来源
      else if (filterSource) list = list.filter((q) => (q.source ?? "").trim() === filterSource);
      if (filterWrong || filterHelp || filterDays) {
        const events = app.attempts.all();
        const cutoff = filterDays > 0 ? Date.now() - filterDays * 86_400_000 : 0;
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- 函数内累加集（非组件状态），与 backlinkCache 惯用法一致
        const helped = new Set<string>();
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- 同上
        const recent = new Set<string>();
        for (const e of events) {
          if (e.help) helped.add(e.qid);
          if (!cutoff || e.ts >= cutoff) recent.add(e.qid);
        }
        if (filterWrong) {
          const wb = app.derived().wrongbook;
          list = list.filter((q) => (wb.get(q.id)?.wrongCount ?? 0) > 0);
        }
        if (filterHelp) list = list.filter((q) => helped.has(q.id));
        if (filterDays) list = list.filter((q) => recent.has(q.id));
      }
      const kw = searchDebounced.trim().toLowerCase();
      if (kw) {
        list = list.filter((q) =>
          q.id.toLowerCase().includes(kw) ||
          q.stem.toLowerCase().includes(kw) ||
          q.options.some((o) => o.toLowerCase().includes(kw)) ||
          (q.analysis ?? "").toLowerCase().includes(kw) ||
          (q.kp ?? "").toLowerCase().includes(kw)); // 51-02：考点可检索（治理面板点击直达）
      }
      return list;
    });
    const shownQuestions = $derived(filteredQuestions.slice(0, browseLimit));
    const hasMore = $derived(filteredQuestions.length > browseLimit);

    // ---------- 命名智能视图（43-05 lite）：浏览过滤保存/复用/删除 ----------
    let smartViews = $state<import("@/core/smartViews").SmartView[]>([]);
    let selectedView = $state("");
    let smartViewBusy = $state(false);
    let smartViewError = $state("");
    let smartViewLoadBusy = $state(false);
    let smartViewLoadFailed = $state(false);
    async function loadSmartViews() {
      if (smartViewLoadBusy) return;
      smartViewLoadBusy = true;
      try {
        const v = await app.loadAux<import("@/core/smartViews").SmartView[]>("browse/smartViews");
        smartViews = Array.isArray(v) ? v : [];
        smartViewLoadFailed = false;
        smartViewError = "";
      } catch (e) {
        smartViews = [];
        smartViewLoadFailed = true;
        smartViewError = t("view.loadFailed").replace("{message}", String(e instanceof Error ? e.message : e));
      } finally { smartViewLoadBusy = false; }
    }
    async function saveSmartViews(next: import("@/core/smartViews").SmartView[]) {
      try {
        await app.saveAux("browse/smartViews", next);
        return true;
      } catch (e) {
        smartViewError = t("view.saveFailed").replace("{message}", String(e instanceof Error ? e.message : e));
        return false;
      }
    }
    /** 当前过滤态 → 视图快照（43-05：过滤条件+题库身份+schema 版本一起存） */
    async function saveCurrentView() {
      if (!activeBankId || smartViewBusy || smartViewLoadBusy || smartViewLoadFailed) return;
      smartViewBusy = true; smartViewError = "";
      try {
        const { inputDialogSync } = await import("../../libs/dialog");
        const name = (await inputDialogSync({ title: t("view.saveTitle"), placeholder: t("view.namePlaceholder") }))?.trim();
        if (!name) return;
        const next = upsertView(smartViews, {
          name,
          v: 1,
          bankId: activeBankId,
          search: searchText,
          favOnly,
          section: sectionSel ? JSON.parse(JSON.stringify(sectionSel)) : null,
          createdAt: Date.now(),
        });
        if (!(await saveSmartViews(next))) return;
        smartViews = next;
        selectedView = name;
        showMessage(t("view.saved"), 2400, "info");
      } finally { smartViewBusy = false; }
    }
    /** 应用视图：跨库视图显式确认（不静默改变含义）；应用后过滤三件套整体切换 */
    async function applyNamedView(name: string) {
      selectedView = name;
      const v = smartViews.find((x) => x.name === name);
      if (!v) return;
      if (viewBankMismatch(v, activeBankId)) {
        const { confirmDialogSync } = await import("../../libs/dialog");
        if (!(await confirmDialogSync({ title: t("view.pick"), content: t("view.bankMismatch").replace("{name}", escapeHtml(v.name)) }))) {
          selectedView = "";
          return;
        }
      }
      setSearch(v.search ?? "");
      favOnly = !!v.favOnly;
      sectionSel = v.section ? { ...v.section } : null;
    }
    /** 一键放宽：清空全部浏览筛选（搜索/题型/来源/仅错题/仅受助/时间/收藏/章节/命名视图） */
    function clearBrowseFilters() {
      setSearch("");
      favOnly = false;
      filterType = "";
      filterSource = "";
      filterWrong = false;
      filterHelp = false;
      filterDays = 0;
      sectionSel = null;
      selectedView = "";
    }
    async function deleteNamedView() {
      if (!selectedView || smartViewBusy || smartViewLoadBusy || smartViewLoadFailed) return;
      smartViewBusy = true; smartViewError = "";
      try {
        const name = selectedView;
        const { confirmDialogSync } = await import("../../libs/dialog");
        if (!(await confirmDialogSync({ title: t("view.deleteTitle"), content: t("view.deleteConfirm").replace("{name}", escapeHtml(name)) }))) return;
        const next = smartViews.filter((v) => v.name !== name);
        if (!(await saveSmartViews(next))) return;
        smartViews = next;
        selectedView = "";
        showMessage(t("view.deleted"), 2200, "info");
      } finally { smartViewBusy = false; }
    }

    /** Dock/块菜单/浏览详情 → 单题会话（qid 定位；首次挂载 questions 未加载，先按库拉取） */
    async function startSingleById(pid: string) {
      if (!pid) return false;
      const all = questions.length ? questions : await loadQuestions();
      const q = all.find((x) => x.id === pid);
      if (!q) { showMessage(t("query.empty"), 3200, "info"); return true; }
      if (!(await negotiateStart([q], "wrong"))) return true;
      feedback = null; selected = ""; confidenceSel = ""; sessionDone = null; view = "session";
      return true;
    }

    // ---------- 浏览详情：展开/文档跳转/反链 ----------
    let expandedId = $state("");
    let peekHideAnswer = $state(true);
    const activePeekQuestion = $derived(questions.find((x) => x.id === expandedId) ?? null);
    const currentPeekIndex = $derived(
      activePeekQuestion ? shownQuestions.findIndex((q) => q.id === activePeekQuestion.id) : -1,
    );
    const hasPrevPeek = $derived(currentPeekIndex > 0);
    const hasNextPeek = $derived(currentPeekIndex >= 0 && currentPeekIndex < shownQuestions.length - 1);

    function prevPeekQuestion() {
      if (!hasPrevPeek) return;
      expandedId = shownQuestions[currentPeekIndex - 1].id;
    }

    function nextPeekQuestion() {
      if (!hasNextPeek) return;
      expandedId = shownQuestions[currentPeekIndex + 1].id;
    }

    async function drillSingleQuestion(q: Question) {
      closePeekDrawer();
      await safeStart([q], "special", () => {
        feedback = null; selected = ""; confidenceSel = ""; sessionDone = null; view = "session";
      });
    }
    let peekDrawerEl = $state<HTMLDivElement | null>(null);
    let peekReturnFocus: HTMLElement | null = null;
    let peekWasOpen = false;
    let backlinkCache = $state(new Map<string, { docId: string; title: string; content: string }[]>());
    let backlinkBusyFor = $state("");
    let backlinkError = $state<Record<string, string>>({});

    // Peek is a modal drawer: move focus into it, keep background controls out
    // of the accessibility tree, and return focus to the row that opened it.
    $effect(() => {
      const open = !!activePeekQuestion;
      const drawer = peekDrawerEl;
      if (!open || !drawer) {
        if (!open && peekWasOpen) {
          peekWasOpen = false;
          const target = peekReturnFocus;
          peekReturnFocus = null;
          void tick().then(() => {
            if (target?.isConnected && target.getClientRects().length) target.focus();
          });
        }
        return;
      }
      if (!peekWasOpen && document.activeElement instanceof HTMLElement) peekReturnFocus = document.activeElement;
      peekWasOpen = true;
      void tick().then(() => { if (activePeekQuestion && peekDrawerEl) peekDrawerEl.focus(); });
    });

    // Mark every sibling along the drawer's ancestor chain inert. This keeps
    // the fixed sheet modal even though it is rendered inside the page panel.
    $effect(() => {
      const drawer = peekDrawerEl;
      if (!activePeekQuestion || !drawer || !tabRoot) return;
      const marked: { node: HTMLElement; hadInert: boolean; ariaHidden: string | null }[] = [];
      const mark = (node: HTMLElement) => {
        if (node === drawer || node.classList.contains("lv-peek-backdrop") || marked.some((x) => x.node === node)) return;
        marked.push({ node, hadInert: node.hasAttribute("inert"), ariaHidden: node.getAttribute("aria-hidden") });
        node.setAttribute("inert", "");
        node.setAttribute("aria-hidden", "true");
      };
      let current: HTMLElement | null = drawer;
      while (current && current !== tabRoot) {
        const parent = current.parentElement;
        if (!parent) break;
        for (const child of [...parent.children]) {
          if (child instanceof HTMLElement && child !== current && !child.contains(drawer)) mark(child);
        }
        current = parent;
      }
      return () => {
        for (const { node, hadInert, ariaHidden } of marked) {
          if (hadInert) node.setAttribute("inert", "");
          else node.removeAttribute("inert");
          if (ariaHidden === null) node.removeAttribute("aria-hidden");
          else node.setAttribute("aria-hidden", ariaHidden);
        }
      };
    });

    function closePeekDrawer() {
      expandedId = "";
    }

    function onPeekDrawerKeydown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        if (e.key === "Escape") {
          e.stopPropagation();
          closePeekDrawer();
        }
        return;
      }
      if (e.key === "Escape") {
        e.stopPropagation();
        closePeekDrawer();
      } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "ArrowLeft") {
        e.preventDefault();
        prevPeekQuestion();
      } else if (e.key === "ArrowDown" || e.key === "j" || e.key === "ArrowRight") {
        e.preventDefault();
        nextPeekQuestion();
      }
    }

    function toggleBrowseQuestion(qid: string) {
      if (batchMode) {
        const next = { ...selectedIds };
        if (next[qid]) delete next[qid];
        else next[qid] = true;
        selectedIds = next;
        return;
      }
      expandedId = expandedId === qid ? "" : qid;
    }

    async function loadBacklinks(blockId: string) {
      if (backlinkBusyFor) return;
      if (!app.kernelOnline) {
        backlinkError = { ...backlinkError, [blockId]: t("state.offlineHint") };
        return;
      }
      backlinkBusyFor = blockId;
      backlinkError = { ...backlinkError, [blockId]: "" };
      try {
        const links = await (app as any).deps.client.backlinks(blockId);
        // 写时复制更新 $state Map（惯用法），不转 SvelteMap
        // eslint-disable-next-line svelte/prefer-svelte-reactivity
        const next = new Map(backlinkCache);
        next.set(blockId, links);
        backlinkCache = next;
      } catch (e) {
        backlinkError = { ...backlinkError, [blockId]: t("browse.backlinksFailed").replace("{message}", String(e instanceof Error ? e.message : e)) };
      } finally { backlinkBusyFor = ""; }
    }

    function openInSiYuan(rootId: string) {
      if (!rootId) { showMessage(t("browse.docUnavailable"), 2600, "error"); return; }
      void import("siyuan").then(({ openTab }) => {
        openTab({ app: (plugin as any).app ?? (plugin as any), doc: { id: rootId } } as any);
      }).catch((e) => showMessage(String(e instanceof Error ? e.message : e), 4200, "error"));
    }

    // ---------- 题面富文本（md2html；离线回退纯文本） ----------
    let stemHtml = $state("");
    let stemHtmlFor = $state("");
    let materialHtml = $state("");
    let materialHtmlFor = $state("");
    $effect(() => {
      void sessionRev; // 类实例非响应式：以推进版本号驱动题面重渲染
      const q = view === "session" ? session?.current : view === "recite" ? reciteQueue[reciteCursor] : null;
      if (!q) { stemHtml = ""; stemHtmlFor = ""; materialHtml = ""; materialHtmlFor = ""; return; }
      // 竞态防护（27 组）：异步返回时校验仍是当前题才应用
      stemHtml = ""; stemHtmlFor = q.id;
      void app.renderStem(q).then((html) => {
        if (html && stemHtmlFor === q.id) stemHtml = html;
      });
      // 共用材料同样走 md2html 缓存管线（长材料/公式的可读性）
      const mat = q.group ? questions.find((x) => x.type === "material" && x.group === q.group) : undefined;
      if (!mat) { materialHtml = ""; materialHtmlFor = ""; return; }
      materialHtml = ""; materialHtmlFor = mat.id;
      void app.renderStem(mat).then((html) => {
        if (html && materialHtmlFor === mat.id) materialHtml = html;
      });
    });

    /** 键盘流（docs/11 映射表）：会话 A-F/⏎/J；背诵 空格翻开、1-4 自评；composition（中文输入法）期间不响应 */
    function onKeydown(e: KeyboardEvent) {
      const peekOpen = !!activePeekQuestion && !!peekDrawerEl;
      if (peekOpen) {
        // A host confirmation/input dialog takes precedence over the page peek.
        const externalDialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some((el) => el !== peekDrawerEl);
        if (externalDialog) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closePeekDrawer();
          return;
        }
        if (e.key === "Tab" && peekDrawerEl) {
          const focusables = [...peekDrawerEl.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
            .filter((el) => el.getClientRects().length);
          const first = focusables[0] ?? peekDrawerEl;
          const last = focusables[focusables.length - 1] ?? peekDrawerEl;
          const idx = focusables.indexOf(document.activeElement as HTMLElement);
          if ((e.shiftKey && (idx <= 0 || document.activeElement === peekDrawerEl)) || (!e.shiftKey && (idx === focusables.length - 1 || document.activeElement === peekDrawerEl))) {
            e.preventDefault();
            (e.shiftKey ? last : first).focus();
          }
          return;
        }
        // Do not let page-level shortcuts act while focus is in the drawer.
        if (!(e.target instanceof Node) || !peekDrawerEl.contains(e.target)) return;
        return;
      }
      if (!tabRoot?.getClientRects().length || e.defaultPrevented || paletteOpen || railOpen || document.querySelector('[role="dialog"]')) return;
      if (e.key === "?" && !peekOpen) {
        e.preventDefault();
        hotkeysHelpOpen = !hotkeysHelpOpen;
        return;
      }
      if (e.isComposing || e.keyCode === 229 || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target && target !== document.body && !tabRoot.contains(target)) return;
      if (target?.closest('input, textarea, select, [contenteditable="true"]') || target?.isContentEditable) return;
      if (target?.closest('button, a') && (e.key === "Enter" || e.key === " ")) return;
      if (view === "session") {
        if (!session || sessionDone) return;
        const q = session.current;
        if (!q) return;
        if (e.key === "Escape") { e.preventDefault(); exitSession(); return; }
        if (feedback) {
          if (e.key === "Enter" || e.key.toLowerCase() === "j") { e.preventDefault(); nextQuestion(); }
          else if (e.key.toLowerCase() === "k") { e.preventDefault(); previousQuestion(); }
          else if (feedback.verdict === "wrong" && /^[1-3]$/.test(e.key)) {
            // 错因快捷键（docs/11：1-4 错因；1-3 对应三分类）
            const reasons = ["careless", "unknown", "trap"] as const;
            void app?.saveWrongReason(q.id, reasons[Number(e.key) - 1]).catch(() => undefined);
            savedReason = reasons[Number(e.key) - 1];
            e.preventDefault();
          }
          return;
        }
        const key = e.key.toUpperCase();
        if (isChoiceQuestion(q) && /^[A-J]$/.test(key)) {
          const idx = key.charCodeAt(0) - 65;
          const choice = answerChoices(q)[idx];
          if (choice) { e.preventDefault(); pickPracticeChoice(choice.value); }
        } else if (/^[1-3]$/.test(e.key)) {
          // 答前置信快捷键（U12）：1=确定 2=模糊 3=蒙（提交前选择，随 attempt 落流水）
          e.preventDefault();
          confidenceSel = (["sure", "fuzzy", "guess"] as const)[Number(e.key) - 1];
        } else if (e.key.toLowerCase() === "e") {
          e.preventDefault();
          void toggleFavCurrent();
        } else if (e.key === "Enter") {
          if (!canSubmitAnswer) return;
          e.preventDefault();
          submitAnswer();
        } else if (e.key.toLowerCase() === "k" && session.progress.done > 0) {
          e.preventDefault();
          previousQuestion();
        }
      } else if (view === "recite") {
        if (reciteDone || !reciteQueue.length) return;
        if (e.key.toLowerCase() === "v" && reciteQueue[reciteCursor]) {
          e.preventDefault();
          ttsSpeak(reciteQueue[reciteCursor].stem);
          return;
        }
        if (!reciteRevealed && e.key === " ") { e.preventDefault(); reciteRevealed = true; return; }
        if (!reciteRevealed && reciteHint === 1 && e.key.toLowerCase() === "h" && reciteQueue[reciteCursor]?.analysis) { e.preventDefault(); reciteHint = 2; return; }
        if (reciteRevealed && /^[1-4]$/.test(e.key)) { e.preventDefault(); void rateSelf(Number(e.key) as 1 | 2 | 3 | 4); }
      }
    }

    async function commitImport() {
      if (!importReport || importBusy) return;
      if (importPreviewBankId !== activeBankId) { importError = t("import.bankChanged"); return; }
      // 先导 5 行（2.3）：已试导确认的题从完整入库中排除，不重导
      const remaining = trialConfirmed.length ? importReport.ok.filter((q) => !trialConfirmed.includes(q.id)) : importReport.ok;
      if (!remaining.length && !importReport.updates?.length) {
        importResult = { written: trialConfirmed.length, confirmed: trialConfirmed.length, missing: 0, verified: true };
        retryPool = []; importReport = null; importText = ""; trialConfirmed = []; trialNote = "";
        return;
      }
      if (await runCommit({ ...importReport, ok: remaining })) { trialConfirmed = []; trialNote = ""; }
    }

    // 先导 5 行试导入（TODO 2.3）：试导前 5 题并读回确认；完整入库时排除已确认行
    let trialConfirmed = $state<string[]>([]);
    let trialNote = $state("");
    const remainingImportQuestions = $derived(importReport?.ok.filter((q) => !trialConfirmed.includes(q.id)) ?? []);

    async function trialImport5() {
      if (!importReport || importBusy || !remainingImportQuestions.length) return;
      if (importPreviewBankId !== activeBankId) { importError = t("import.bankChanged"); return; }
      const targetBankId = activeBankId;
      trialBusy = true; importError = ""; trialNote = "";
      try {
        const trial: ImportReport = { ok: remainingImportQuestions.slice(0, 5), errors: [], duplicates: 0, batch: importReport.batch + "-t5" };
        const r = await app.commitImport(targetBankId, trial);
        trialConfirmed = [...new Set([...trialConfirmed, ...r.readback.confirmed])];
        trialNote = r.readback.verified
          ? t("import.trialDone").replace("{c}", String(r.readback.confirmed.length)).replace("{m}", String(r.readback.missing.length))
          : t("import.readbackUnknown");
        await refreshQuestionsAfterWrite(0);
      } catch (e) {
        importError = offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e);
      } finally { trialBusy = false; }
    }

    // 重试池（U08/38-04）：上次提交中未读回的题；重试只补这些，不重导已确认行
    let retryPool = $state<Question[]>([]);
    let retryBatch = $state("");
    let retryBankId = $state("");

    /** 46-03：入库进度与取消（取消在文档间生效；已写文档保留，可用批次撤销整批回退） */
    let commitProgress = $state<{ done: number; total: number } | null>(null);
    let commitCancelRequested = false;
    /** 38-03 更新式重导回执 */
    let updateResult = $state<null | { ok: number; failed: number; missing: number; unprocessed?: number }>(null);

    async function runCommit(report: ImportReport): Promise<boolean> {
      if (importBusy) return false;
      const targetBankId = activeBankId;
      const targetQuestions = [...questions];
      committing = true; importError = ""; updateResult = null;
      commitCancelRequested = false;
      commitProgress = { done: 0, total: report.ok.length };
      try {
        const r = await app.commitImport(targetBankId, report, {
          onProgress: (done, total) => { commitProgress = { done, total }; },
          isCancelled: () => commitCancelRequested,
        });
        importResult = {
          written: r.written + trialConfirmed.length,
          confirmed: r.readback.confirmed.length + trialConfirmed.length,
          missing: r.readback.missing.length,
          verified: r.readback.verified || !report.ok.length,
          cancelled: r.cancelled === true,
          unprocessed: r.unprocessed?.length ?? 0,
        };
        retryPool = report.ok.filter((q) => r.readback.missing.includes(q.id));
        retryBatch = report.batch;
        retryBankId = targetBankId;
        if (r.cancelled || commitCancelRequested) {
          importResult.cancelled = true;
          importReport = { ...report, ok: retryPool };
          await refreshQuestionsAfterWrite(0);
          return false;
        }
        // 38-03 更新式重导：报告.updates 按 hash 定位库内题，只覆盖答案/解析/别名
        if (report.updates?.length) {
          // 同批内重复题可能指向本轮刚新增的题；读取固定目标库，不使用切库后的全局列表。
          const updatedQuestions = await app.listQuestions(targetBankId);
          const r2 = await app.applyAnswerUpdates(report.updates, [...targetQuestions, ...updatedQuestions], {
            isCancelled: () => commitCancelRequested,
            onProgress: (done, total) => { commitProgress = { done, total }; },
          });
          updateResult = r2;
          showMessage(
            t("import.updatesDone").replace("{ok}", String(r2.ok)).replace("{f}", String(r2.failed)).replace("{m}", String(r2.missing)),
            5600,
            r2.failed || r2.missing || r2.unprocessed ? "error" : "info",
          );
          if (r2.failed || r2.missing || r2.unprocessed) {
            if (r2.unprocessed) importResult.cancelled = true;
            // 答案更新是幂等操作；保留候选可重新核对/提交，已新增题不重复写入。
            importReport = { ...report, ok: retryPool, updates: report.updates };
            await refreshQuestionsAfterWrite(0);
            return false;
          }
        }
        importReport = null; importText = "";
        // commitImport 内部已等待索引并按 qid 读回；导入可能更新重复题，不能用题目总数推断成功。
        await refreshQuestionsAfterWrite(0);
        return true;
      } catch (e) {
        importError = offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e);
        return false;
      } finally {
        committing = false;
        commitProgress = null;
      }
    }

    /** 渲染式抽查（2.3/U07 前半）：随机抽 3 题按真实渲染管线出预览，计数与汇总之外的"眼见为实" */
    let spotIds = $state<string[]>([]);
    let spotHtml = $state<Record<string, string>>({});
    let spotBusy = $state(false);
    async function spotCheckRender() {
      if (!importReport?.ok.length || spotBusy) return;
      spotBusy = true;
      try {
        const pool = [...importReport.ok];
        const picks: Question[] = [];
        while (pool.length && picks.length < 3) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        spotIds = picks.map((q) => q.id);
        const html: Record<string, string> = {};
        for (const q of picks) {
          try { html[q.id] = await app.renderStem(q); } catch { html[q.id] = ""; }
        }
        spotHtml = html;
      } finally { spotBusy = false; }
    }

    // ---------- 错误单行修复（2.3/U07 后半）：Excel=单元格编辑；文本路径=Aiken 块编辑 ----------
    let fixRow = $state<number | null>(null); // err.row（1-based 数据行号，含表头偏移）
    let fixCells = $state<string[]>([]);
    let fixText = $state(""); // 文本路径：Aiken 块原文
    let fixNote = $state("");
    function startRowFix(row: number) {
      if (importBusy) return;
      const report = importReport;
      const sheet = sheetRowsCache.get(activeSheet);
      // parseExcelRows 行号 = 绝对行号（首行表头=1）：err.row-1 即缓存数组下标
      const abs = row - 1;
      if (sheet?.[abs]) {
        fixNote = "";
        fixRow = row;
        fixCells = [...sheet[abs]];
        fixText = "";
        return;
      }
      // 文本路径（粘贴）：err.raw 是 120 字截断预览不可编辑 → 按产生错误的解析器口径提取原文
      fixRow = row;
      fixCells = [];
      fixText = "";
      void (async () => {
        const blk = await extractTextRowAt(importText, row);
        if (fixRow !== row || importReport !== report) return;
        if (!blk) {
          fixNote = t("import.fixUnavailable");
          fixRow = null;
          return;
        }
        fixText = blk;
      })();
    }
    function cancelRowFix() {
      fixRow = null; fixCells = []; fixText = ""; fixNote = "";
    }
    async function applyRowFix(errRow: number) {
      if (!importReport || fixRow == null || importBusy) return;
      const sheet = sheetRowsCache.get(activeSheet);
      const abs = errRow - 1;
      let single: ImportReport;
      if (fixCells.length && sheet?.[abs]) {
        // Excel：修好的行写回缓存并单行重验（Alt+Enter 净化沿用 parseExcelRows 内部规则）
        sheet[abs] = [...fixCells];
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- 写时复制惯用法，与 backlinkCache 一致
        const nextSheetCache = new Map(sheetRowsCache);
        nextSheetCache.set(activeSheet, sheet);
        sheetRowsCache = nextSheetCache;
        single = parseExcelRows([sheet[abs]], lastMap!, {
          existingHashes: dupeStrategy === "coexist" ? new Set<string>() : new Set(questions.map((q) => q.hash)),
          duplicateStrategy: dupeStrategy,
        });
      } else {
        // 文本路径：整块重验（GIFT/TSV 特征同样走 parseText 分流）
        single = await parseText(fixText, {
          existingHashes: dupeStrategy === "coexist" ? new Set<string>() : new Set(questions.map((q) => q.hash)),
          duplicateStrategy: dupeStrategy,
        });
      }
      if (single.ok.length === 1) {
        importReport = {
          ...importReport,
          ok: [...importReport.ok, single.ok[0]],
          errors: importReport.errors.filter((e) => e.row !== errRow),
        };
        cancelRowFix();
        showMessage(t("import.rowFixed"), 2600, "info");
      } else if (single.errors.length === 1) {
        fixNote = single.errors[0].reason;
        importReport = {
          ...importReport,
          errors: importReport.errors.map((e) => (e.row === errRow ? { ...e, reason: single.errors[0].reason } : e)),
        };
      } else {
        // 修复后与题库/批内重复 → 不进 ok，也不算错误行，如实提示
        fixNote = t("import.rowDuped");
      }
    }

    /** 重试缺失部分（38-04）：同一 batch 重新提交未读回的题；换库后拒绝（41-04 切库不误写目标库） */
    async function retryMissing() {
      if (committing || !retryPool.length) return;
      if (activeBankId !== retryBankId) { importError = t("import.retryWrongBank"); return; }
      await runCommit({ ok: retryPool, errors: [], duplicates: 0, batch: retryBatch, updates: importReport?.updates });
    }
</script>

<svelte:window onkeydown={onKeydown} onclick={(e) => { onRichTextClick(e); onWindowClick(e); }} onauxclick={onRichTextClick} ondragover={(e) => { if (tabRoot?.contains(e.target as Node)) e.preventDefault(); }} ondrop={onDrop} />

<div class="fn__flex-1 lv-exam-tab" bind:this={tabRoot} role="region" aria-label={t("tab.practice")}>
  {#snippet studioNav()}
    <div class="lv-studio-nav" role="tablist" aria-label="出题工作台">
      <button class="lv-studio-tab" class:active={view === "manual"} onclick={() => (view = "manual")} role="tab" aria-selected={view === "manual"}>
        <Icon name="pencil" size={13} /> {t("tab.manual", "手工录题")}
      </button>
      <button class="lv-studio-tab" class:active={view === "materials"} onclick={() => (view = "materials")} role="tab" aria-selected={view === "materials"}>
        <Icon name="book" size={13} /> {t("tab.materials", "学习资料")}
      </button>
      <button class="lv-studio-tab" class:active={view === "import"} onclick={() => (view = "import")} role="tab" aria-selected={view === "import"}>
        <Icon name="import" size={13} /> {t("tab.import", "批量导入")}
      </button>
      <button class="lv-studio-tab" class:active={view === "ai"} onclick={() => (view = "ai")} role="tab" aria-selected={view === "ai"}>
        <Icon name="sparkles" size={13} /> {t("tab.ai", "AI 出题")}
      </button>
    </div>
  {/snippet}
  <div class="block__icons" class:lv-focus-toolbar={view === "session" && !sessionDone}>
    <button class="lv-menu-btn" aria-label={t("menu.open")} aria-expanded={railOpen} bind:this={menuBtn} onclick={() => railOpen = true}><Icon name="menu" size={16} /></button>
    <!-- 原型 .breadcrumbs：题库 / 当前页（muted/当前 双色导航语境） -->
    {#if view === "session" && !sessionDone}<div class="lv-focus-brand"><Icon name="book" size={15} /><strong>{t("session.focusTitle", "专注练习")}</strong></div>{/if}
    <div class="lv-crumbs" class:lv-focus-context={view === "session" && !sessionDone}>
      <span class="lv-crumb">{bankName || t("guard.title")}</span>
      <span class="lv-crumb-sep" aria-hidden="true">/</span>
      <span class="lv-crumb-current">{t("tab.practice")}</span>
    </div>
    {#if app?.saves}<SaveStatus gate={app.saves} {t} />{/if}
    <span class="fn__flex-1"></span>
    <button class="lv-btn lv-btn--ghost sm lv-palette-btn" onclick={() => paletteOpen = true} title="Ctrl / ⌘ K">
      <Icon name="search" size={13} /> <span class="lv-palette-label">{t("palette.open")}</span> <span class="lv-kbd">⌘K</span>
    </button>
    {#if app && (offline || app.lastKernelError?.category === "auth" || app.lastKernelError?.category === "permission" || app.lastKernelError?.category === "validation" || app.lastKernelError?.category === "not-found")}
      <span class="lv-chip lv-chip--amb" title={app.kernelRecoveryHint()} aria-label={app.kernelRecoveryHint()}>
        {app.lastKernelError?.category === "auth" ? "未授权" : app.lastKernelError?.category === "permission" ? "无权限" : app.lastKernelError?.category === "validation" ? "输入有误" : app.lastKernelError?.category === "not-found" ? "接口不存在" : t("state.offline")}
      </span>
    {/if}
    {#if plan}
      <span class="lv-focus-context lv-plan-context">
      {#if plan.mode === "sprint"}<span class="lv-chip lv-chip--red num"><Icon name="flame" size={12} /> {t("entry.sprint")} D-{plan.daysToExam}</span>
      {:else if plan.daysToExam != null}<span class="lv-chip amb num"><Icon name="clock" size={12} /> {t("entry.examIn")} {plan.daysToExam} {t("entry.days")}</span>{/if}
      {#if examProfileList.filter((p) => p.days != null && p.days >= 0).length > 1}
        <!-- 53-02 lite：多考期并存展示（计划锚定最近，其余一目了然） -->
        {#each examProfileList.filter((p) => p.days != null && p.days >= 0) as p, _pi (_pi)}
          <span class="lv-chip num" title={t("entry.profileTip")}><Icon name="pin" size={12} /> {p.name} D-{p.days}</span>
        {/each}
      {/if}
      {#if planTrace && planTrace.absentStreak >= 2}
        <!-- 44-05 lite：连续缺席提醒（配额恒定不爆量，仅可见性） -->
        <span class="lv-chip lv-chip--amb num" title={t("entry.absentTip")}>⚠ {t("entry.absent").replace("{n}", String(planTrace.absentStreak))}</span>
      {:else if planTrace && planTrace.planned > 0 && planTrace.done >= 0}
        <span class="lv-chip num" title={t("entry.yesterdayTip")}><Icon name="calendar" size={12} /> {t("entry.yesterday").replace("{p}", String(planTrace.planned)).replace("{d}", String(planTrace.done))}</span>
      {/if}
      {#if planTime && view !== "entry"}
        <!-- 53-01 lite：分钟预算 chip（入口页已在 hero 卡内展示，避免重复） -->
        <span class="lv-chip num" title={planTime.sourced ? t("entry.timeSourced") : t("entry.timeDefault")}>
          <Icon name="hourglass" size={12} /> ~{planTime.minutes} {t("entry.minutes")}（{planTime.low}-{planTime.high}）
        </span>
      {/if}
      </span>
    {/if}
      {#if checkinStreak != null && checkinStreak > 0}
        <!-- 48-04 lite：打卡→考试只读投影（连续数由打卡单一实现计算，考试侧不自算） -->
        <span class="lv-chip num lv-focus-context" title={t("entry.checkinStreakTip")}><Icon name="flame" size={12} /> {t("entry.checkinStreak").replace("{n}", String(checkinStreak))}</span>
      {/if}
      {#if banks.length > 1}
        <!-- 多库切换（真机走查补齐）：此前多库时无任何切换入口，重载还会静默回落第一库 -->
        <select class="lv-select lv-focus-context" style="max-width:170px" bind:value={activeBankId} onchange={onBankSwitch} disabled={importBusy || mSaving || aiMutationBusy || (view === "session" && !!session && !sessionDone) || (view === "recite" && !reciteDone && !!reciteQueue.length)} title={(view === "session" && !!session && !sessionDone) || (view === "recite" && !reciteDone && !!reciteQueue.length) ? t("bank.sessionHint") : importBusy || mSaving || aiMutationBusy ? t("bank.busyHint") : t("bank.label")}>
          {#each banks as b, _i (_i)}<option value={b.id}>{b.name}</option>{/each}
        </select>
      {:else if hasBank}
        <span class="lv-chip lv-focus-context">{t("bank.label")} {bankName}</span>
      {/if}
      {#if hasBank}<button class="lv-chip lv-focus-context" title={t("bank.removeTitle")} aria-label={t("bank.removeTitle")} onclick={removeActiveBank} disabled={importBusy || mSaving || aiMutationBusy}>✕</button>{/if}
  </div>
  <div class="lv-shell" class:lv-shell-focus={view === "session" && !sessionDone} class:lv-shell-tasknav-hidden={(view === "session" && !sessionDone) || (view === "recite" && !reciteDone)}>
    <Rail active="practice" taskactive={view === "browse" || view === "wrongbook" ? "bank" : view === "manual" || view === "import" || view === "ai" || view === "materials" ? "create" : "today"} tasknavhidden={view === "session" && !sessionDone || view === "recite" && !reciteDone} ontasknavigate={onTaskNav} {plugin} items={railItems} open={railOpen} onclose={closeRail}
      project={{ name: bankName || t("guard.title"), kicker: t("rail.projectKicker") }} onproject={() => (view = "entry")}
      onquickcreate={() => { view = "manual"; }} />
    <div class="lv-main">
  {#if errorMsg && errorMsg !== t("state.emptyBank") && view !== "session"}
    <div class="lv-pad" style="padding-bottom:0"><div class="lv-error" role="alert">{errorMsg}</div></div>
  {/if}
  {#if app?.lastKernelError && view !== "session"}
    <div class="lv-pad" style="padding-top:0;padding-bottom:0">
      <div class="lv-muted" role="status" style="overflow-wrap:anywhere">{app.kernelRecoveryHint()}</div>
    </div>
  {/if}
  {#if app?.storageReadonly && view !== "session"}
    <div class="lv-pad" style="padding-top:0;padding-bottom:0">
      <div class="lv-error" role="alert" style="overflow-wrap:anywhere">
        数据读取失败，已暂停写入以保护原有内容（{[...app.storageReadErrors.keys()].slice(0, 3).join("、")}）。请重载思源后重试。
      </div>
    </div>
  {/if}
  {#if loading || !app}
    <div class="lv-pad" role="status" aria-live="polite" aria-busy="true">
      <p class="lv-muted">{!app ? (t("state.initializing") || "正在初始化小驴考试，请稍候…") : t("entry.loadingQuestions", "正在读取题目，请稍候…")}</p>
      <div class="lv-skeleton" aria-hidden="true"></div>
    </div>
  {:else if errorMsg === t("state.emptyBank") && view !== "session"}
    <!-- 空题库走居中空态（原型 .empty），其余错误保留语义横幅 -->
    <div class="lv-pad">
      {#if errorMsg === t("state.emptyBank")}
        <div class="lv-empty">
          <div class="lv-empty-icon"><Icon name="file" size={30} /></div>
          <b>{t("state.emptyBank")}</b>
          <div class="lv-row" style="justify-content:center;margin-top:18px">
            <button class="lv-btn lv-btn--primary" onclick={() => { errorMsg = ""; view = "import"; }}><Icon name="import" size={15} /> {t("import.title")}</button>
            <button class="lv-btn" onclick={() => { errorMsg = ""; view = "manual"; }}><Icon name="pencil" size={15} /> {t("entry.manual")}</button>
            <button class="lv-btn lv-btn--ghost" onclick={() => { errorMsg = ""; view = "ai"; }}><Icon name="sparkles" size={15} /> {t("ai.title")}</button>
          </div>
        </div>
      {:else}
        <div class="lv-error">{errorMsg}</div>
      {/if}
    </div>
  {:else if view === "entry"}
    <!-- ===== S1 入口 / 守卫 ===== -->
    {#if !hasBank}
      <div class="lv-pad lv-center">
        <div class="lv-card lv-guard lv-guard--welcome">
          <div class="lv-guard-kicker"><Icon name="compass" size={15} /> {t("onboard.title")}</div>
          <div class="lv-guard-title">{t("guard.welcomeTitle")}</div>
          <p class="lv-muted">{t("guard.welcomeDesc")}</p>
          <div class="lv-guard-steps">
            <div class="lv-guard-step"><span class="lv-onboard-no num">01</span><span class="lv-tile-icon"><Icon name="book" size={16} /></span><b>{t("guard.step1")}</b><span>{t("guard.step1Desc")}</span></div>
            <div class="lv-guard-step"><span class="lv-onboard-no num">02</span><span class="lv-tile-icon"><Icon name="import" size={16} /></span><b>{t("guard.step2")}</b><span>{t("guard.step2Desc")}</span></div>
            <div class="lv-guard-step"><span class="lv-onboard-no num">03</span><span class="lv-tile-icon"><Icon name="play" size={16} /></span><b>{t("guard.step3")}</b><span>{t("guard.step3Desc")}</span></div>
          </div>
          <div class="lv-row" style="margin-top:20px">
            <button class="lv-btn lv-btn--primary" onclick={createSampleBank} disabled={creating || offline} aria-busy={creatingSample} title={offline ? t("state.offlineHint") : ""}>
              <Icon name="book" size={16} /> {creatingSample ? t("guard.sampleCreating") : t("guard.createSample").replace("{n}", String(SAMPLE_QUESTION_COUNT))}
            </button>
          </div>
          <p class="lv-hint">{t("guard.demoDesc")}</p>
          {#if bankCreateError}<div class="lv-error" role="alert">{bankCreateError}</div>{/if}
          <div class="lv-guard-title" style="margin-top:20px">{t("guard.title")}</div>
          <p class="lv-muted">{t("guard.desc")}</p>
          <div class="lv-row">
            <input class="lv-input" placeholder={t("guard.namePlaceholder")} bind:value={newBankName} disabled={creating}
              onkeydown={(e) => !e.isComposing && e.keyCode !== 229 && e.key === "Enter" && createBank()} />
            <button class="lv-btn lv-btn--primary" onclick={createBank} disabled={creating || !newBankName.trim()}>
              {creating && !creatingSample ? "…" : t("guard.create")}
            </button>
          </div>
          <!-- 25-P1 首用三路入口：示例题建库即练 / 模板先行 / 直接导入 -->
          <p class="lv-hint"><Icon name="compass" size={13} /> {t("guard.sampleHint")}</p>
          <p class="lv-hint lv-guard-sample-detail">{t("guard.sampleDetail")}</p>
          <div class="lv-row lv-center-text"><span class="lv-muted">{t("guard.or")}</span></div>
          <div class="lv-row">
            <button class="lv-btn" style="flex:1" onclick={downloadTemplate}><Icon name="import" size={15} /> {t("import.template")}</button>
            <button class="lv-btn" style="flex:1" disabled={creating || !newBankName.trim()} onclick={async () => { if (await createBank()) view = "import"; }}><Icon name="import" size={15} /> {t("guard.createAndImport")}</button>
          </div>
          <p class="lv-hint">{t("guard.needBankFirst")}</p>
        </div>
      </div>
    {:else}
      {#if session && session.phase === "running"}
        <div class="lv-pad">
          <div class="lv-card lv-resume">
            <div>
              <b>{t("resume.title")}</b>
              <div class="lv-muted">{t("resume.progress")}: {session.progress.done}/{session.progress.total}</div>
            </div>
            <button class="lv-btn lv-btn--primary" onclick={resume} disabled={resumeBusy || exitBusy}>{resumeBusy ? "…" : t("resume.continue")}</button>
            <button class="lv-btn lv-btn--ghost" disabled={resumeBusy || exitBusy} onclick={async () => {
          if (session) {
            for (const input of abandonedExposureInputs(
              session.answered.map((a) => a.qid), exposures,
              { kind: "practice", mode: session.state.mode, sessionId: session.id },
            )) {
              try { app.recordAttempt(input); } catch { /* 尽力而为 */ }
            }
          }
          await app.discardSession();
          session = null;
          resumeError = "";
        }}>{t("resume.discard")}</button>
          </div>
          {#if resumeError}<div class="lv-error" role="alert" style="margin-top:8px">{resumeError}</div>{/if}
        </div>
      {/if}
      {#if onboarding}
        <!-- 47-02 lite：首次五分钟任务引导（无作答记录时显示；可跳过，有作答自动消失） -->
        <div class="lv-pad">
          <div class="lv-card lv-resume lv-onboard">
            <div>
              <b class="lv-onboard-title"><Icon name="compass" size={16} /> {t("onboard.title")}</b>
              <div class="lv-muted">{t("onboard.desc")}</div>
              <ol class="lv-onboard-steps" aria-label={t("onboard.title")}>
                <li class="lv-onboard-step"><span class="lv-onboard-no num">01</span><span class="lv-tile-icon"><Icon name="import" size={17} /></span><b>{t("onboard.step1Title")}</b>
                  <div class="lv-muted lv-onboard-step-desc">{t("onboard.step1Desc")}</div>
                  <div class="lv-row" style="gap:var(--lv-space-compact);margin:8px 0 0">
                    <button class="lv-btn sm" onclick={() => { view = "import"; }}>{t("onboard.step1")}</button>
                    <button class="lv-btn sm" onclick={() => { view = "manual"; }}>{t("onboard.step1b")}</button>
                    <button class="lv-btn sm" onclick={() => { view = "ai"; }}>{t("onboard.step1c")}</button>
                  </div>
                </li>
                <li class="lv-onboard-step"><span class="lv-onboard-no num">02</span><span class="lv-tile-icon"><Icon name="zap" size={17} /></span><b>{t("onboard.step2")}</b>
                  <div class="lv-muted lv-onboard-step-desc">{t("onboard.step2Desc")}</div>
                  <div class="lv-row" style="gap:var(--lv-space-compact);margin:8px 0 0">
                    <button class="lv-btn sm lv-btn--primary" onclick={() => void startDrill("quick")} disabled={!practiceQuestions.length || !!questionsError} title={!practiceQuestions.length ? t("state.emptyBank") : questionsError ? t("entry.loadError") : ""}>{t("onboard.step2")}</button>
                  </div>
                </li>
                <li class="lv-onboard-step"><span class="lv-onboard-no num">03</span><span class="lv-tile-icon"><Icon name="chart" size={17} /></span><b>{t("onboard.step3")}</b>
                  <div class="lv-muted lv-onboard-step-desc">{t("onboard.step3Desc")}</div>
                  <div class="lv-row" style="gap:var(--lv-space-compact);margin:8px 0 0">
                    <button class="lv-btn sm" onclick={() => plugin.openReport?.()}>{t("onboard.step3")}</button>
                  </div>
                </li>
              </ol>
            </div>
            <div class="lv-row" style="margin:6px 0 0">
              <span class="fn__flex-1"></span>
              <button class="lv-btn sm lv-btn--ghost" onclick={() => { onboardingDismissed = true; writeLocal("lv-exam-onboarded", "1"); }}>{t("onboard.skip")}</button>
            </div>
          </div>
        </div>
      {/if}
      <div class="lv-pad">
        <div class="lv-screen-head">
          <span class="lv-eyebrow">{t("head.entry.eyebrow")}</span>
          <h1 class="lv-h1">{t("head.entry.title")}</h1>
          <p>{t("head.entry.desc")}</p>
        </div>
        {#if bankCreateError}<div class="lv-error" role="alert" style="margin-bottom:14px">{bankCreateError}</div>{/if}
        {#if sampleNotice}
          <div class="lv-card" style="padding:16px 20px;margin-bottom:14px" role="status">
            <b>{sampleNotice}</b>
            <p class="lv-muted">{t("guard.demoGuide")}</p>
            <div class="lv-row">
              <button class="lv-btn lv-btn--primary sm" onclick={() => void startDrill("quick")} disabled={!practiceQuestions.length || !!questionsError}><Icon name="play" size={15} /> {t("mode.quick")}</button>
              <button class="lv-btn sm" onclick={() => void retryEntryLoad()} disabled={loading || creating}><Icon name="rotate" size={15} /> {t("entry.loadRetry")}</button>
            </div>
          </div>
        {/if}
        {#if questionsError}
          <div class="lv-card lv-empty lv-entry-empty" role="alert">
            <div class="lv-empty-icon"><Icon name="xcircle" size={28} /></div>
            <b>{t("entry.loadError")}</b>
            <p class="lv-muted">{questionsError}</p>
            <div class="lv-row" style="justify-content:center;margin-top:14px">
              <button class="lv-btn lv-btn--primary" onclick={() => void retryEntryLoad()} disabled={loading}><Icon name="rotate" size={15} /> {t("entry.loadRetry")}</button>
              <button class="lv-btn" onclick={() => { view = "import"; }}><Icon name="import" size={15} /> {t("import.title")}</button>
            </div>
          </div>
        {:else if questionsLoaded && !practiceQuestions.length}
          <div class="lv-card lv-empty lv-entry-empty">
            <div class="lv-empty-icon"><Icon name="file" size={28} /></div>
            <b>{t("entry.emptyTitle")}</b>
            <p class="lv-muted">{t("entry.emptyDesc")}</p>
            <div class="lv-row" style="justify-content:center;margin-top:14px">
              <button class="lv-btn" onclick={createSampleBank} disabled={creating || offline} title={offline ? t("state.offlineHint") : t("guard.demoDesc")}><Icon name="book" size={15} /> {creatingSample ? t("guard.sampleCreating") : t("guard.sampleOpen")}</button>
              <button class="lv-btn lv-btn--primary" onclick={() => { view = "import"; }}><Icon name="import" size={15} /> {t("import.title")}</button>
              <button class="lv-btn" onclick={() => { view = "manual"; }}><Icon name="pencil" size={15} /> {t("entry.manual")}</button>
            </div>
          </div>
        {/if}
        {#if plan}
          <div class="lv-entry-overview">
          <div class="lv-card lv-hero lv-entry-hero">
            <div class="lv-entry-main">
              <span class="lv-focus-label">{t("entry.today")}</span>
              <div class="lv-entry-reason">{planReasonText(plan)}</div>
              {#if planTime}
                <span class="lv-chip num" title={planTime.sourced ? t("entry.timeSourced") : t("entry.timeDefault")}>
                  <Icon name="hourglass" size={13} /> ~{planTime.minutes} {t("entry.minutes")}（{planTime.low}-{planTime.high}）
                </span>
              {/if}
              <!-- 原型：主操作在 hero 卡内部，与上下文成组；空队列禁用防无效点击 -->
              <div class="lv-hero-actions">
                <button class="lv-btn lv-btn--primary" onclick={startToday} disabled={!todayQueue.length} title={todayQueue.length ? "" : t("state.emptyBank")}><Icon name="play" size={16} /> {t("entry.startToday")}</button>
                <button class="lv-btn lv-btn--ghost" onclick={copyTodayReportMarkdown} title={t("entry.copyReportTip")}><Icon name="copy" size={15} /> {t("entry.copyReport")}</button>
                {#if !plan.queue.length && todayQueue.length}<span class="lv-muted" role="status">{t("entry.queueFallback")}</span>{/if}
              </div>
            </div>
            <div class="lv-entry-num">
              <div class="lv-entry-countwrap">
                <span class="num lv-entry-count">{todayQueue.length}</span>
                <span class="lv-entry-unit">{t("browse.count")}</span>
              </div>
              <div class="lv-entry-label">{t("entry.queueLabel")}</div>
            </div>
          </div>
          <section class="lv-card lv-entry-week" aria-label={t("entry.weekTitle")}>
            <div class="lv-entry-week-head"><b>{t("entry.weekTitle")}</b><span class="lv-chip num">{t("entry.weekCount").replace("{n}", String(weekAttemptTotal))}</span></div>
            <div class="lv-week-strip" role="img" aria-label={t("entry.weekAria").replace("{days}", weekTrend.map((day) => `${weekDayLabel(day.date)} ${day.attempts} ${t("browse.count")}`).join("，"))}>
              {#each weekTrend as day (day.date)}
                {@const isToday = day.date === localDate(Date.now())}
                <div class="lv-week-day" class:is-today={isToday} title={`${day.date}${isToday ? "（今天）" : ""} · ${day.attempts} 题`}>
                  <span class="lv-week-count" class:has-attempts={day.attempts > 0} style="--lv-week-fill:{Math.round((day.attempts / weekAttemptMax) * 100)}%">{day.attempts || "·"}</span>
                  <span class:today-text={isToday}>{isToday ? "今" : weekDayLabel(day.date)}</span>
                </div>
              {/each}
            </div>
            <p class="lv-muted">{weekAttemptTotal ? t("entry.weekScope") : t("entry.weekEmpty")}</p>
          </section>
          </div>
        {/if}
        <!-- 驾驶舱 widgets（规范 v6 §5.3）：目标环 / 连胜 / 待消灭；数据全部来自本地流水 -->
        <div class="lv-widgets">
          <div class="lv-card lv-widget">
            <span class="lv-goal-wrap" role="img" aria-label={t("widget.goal.aria").replace("{p}", String(goalPct))}>
              <span class="lv-goal-ring" class:data-tone={goalPct >= 100 ? "good" : undefined} style="--pct:{goalPct}"></span>
              <span class="lv-goal-center num">{goalPct}%</span>
            </span>
            <div class="lv-widget-body">
              <div class="lv-widget-title">{goalPct >= 100 ? t("widget.goal.achieved") : t("widget.goal")}</div>
              <strong class="num">{todayDone} / {dailyGoalN} {t("browse.count")}</strong>
              <span class="lv-muted">{goalPct >= 100 ? t("widget.goal.done") : t("widget.goal.left").replace("{n}", String(Math.max(0, dailyGoalN - todayDone)))}</span>
            </div>
          </div>
          <div class="lv-card lv-widget">
            <span class="lv-streak-flame"><Icon name="flame" size={22} /></span>
            <div class="lv-widget-body">
              <div class="lv-widget-title">{t("widget.streak")}</div>
              <strong class="num">{streakDays} {t("entry.days")}</strong>
              <span class="lv-muted">{t("widget.streak.note")}</span>
            </div>
          </div>
          <button class="lv-card lv-widget lv-widget--click" style="text-align:left;font:inherit;color:inherit" onclick={() => { view = "wrongbook"; void loadQuestions(); }}>
            <span class="lv-streak-flame lv-streak-flame--wrong"><Icon name="xcircle" size={22} /></span>
            <div class="lv-widget-body">
              <div class="lv-widget-title">{t("widget.wrong")}</div>
              <strong class="num">{wrongList.length} {t("mode.wrong.unit")}</strong>
              <span class="lv-muted">{t("widget.wrong.note")}</span>
            </div>
          </button>
        </div>
        <div class="lv-section-title"><span>{t("entry.modes")}</span></div>
        <!-- 层级：队列驱动三模式（快速/每日/错题）为一级 accent 键帽；低频三模式降噪为中性键帽 -->
        <div class="lv-modes">
          <button class="lv-mode" disabled={!practiceQuestions.length} title={!practiceQuestions.length ? t("state.emptyBank") : ""} onclick={() => startDrill("quick")}>
            <span class="lv-mode-icon lv-mode-icon--quick"><Icon name="zap" /></span><span class="lv-mode-body"><b>{t("mode.quick")}</b><span class="lv-muted">{t("mode.quick.desc")}</span></span>
          </button>
          <button class="lv-mode" disabled={!practiceQuestions.length} title={!practiceQuestions.length ? t("state.emptyBank") : ""} onclick={() => startDrill("daily")}>
            <span class="lv-mode-icon lv-mode-icon--daily"><Icon name="calendar" /></span><span class="lv-mode-body"><b>{t("mode.daily")}</b><span class="lv-muted">{t("mode.daily.desc")}</span></span>
          </button>
          <button class="lv-mode" disabled={!wrongList.length} title={!wrongList.length ? t("state.noWrong") : ""} onclick={() => startDrill("wrong")}>
            <span class="lv-mode-icon lv-mode-icon--wrong"><Icon name="xcircle" /></span><span class="lv-mode-body"><b>{t("mode.wrong")}</b><span class="lv-muted num">{wrongList.length} {t("mode.wrong.unit")}</span></span>
          </button>
          <button class="lv-mode lv-mode--minor" disabled={!practiceQuestions.length} title={!practiceQuestions.length ? t("state.emptyBank") : ""} onclick={() => startRecite()}>
            <span class="lv-mode-icon lv-mode-icon--recite"><Icon name="rotate" /></span><span class="lv-mode-body"><b>{t("mode.recite")}</b><span class="lv-muted">{t("mode.recite.desc")}</span></span>
          </button>
          <button class="lv-mode lv-mode--minor" disabled={!cramCount} title={!cramCount ? t("state.noCram") : ""} onclick={() => startDrill("cram")}>
            <span class="lv-mode-icon lv-mode-icon--cram"><Icon name="flame" /></span><span class="lv-mode-body"><b>{t("mode.cram")}</b><span class="lv-muted">{t("mode.cram.desc")}</span></span>
          </button>
          <button class="lv-mode lv-mode--minor" disabled={!favoriteCount} title={!favoriteCount ? t("state.noFav") : ""} onclick={() => startDrill("fav")}>
            <span class="lv-mode-icon lv-mode-icon--fav"><Icon name="star" /></span><span class="lv-mode-body"><b>{t("mode.fav")}</b><span class="lv-muted">{t("mode.fav.desc")}（<span class="num">{favoriteCount}</span> {t("mode.wrong.unit")}）</span></span>
          </button>
        </div>
        <div class="lv-section-title" style="margin-top:22px"><span>{t("entry.tools")}</span></div>
        <div class="lv-row" style="margin-top:0">
          <button class="lv-btn lv-btn--ghost" onclick={createSampleBank} disabled={creating || offline} title={offline ? t("state.offlineHint") : t("guard.demoDesc")}><Icon name="book" size={16} /> {creatingSample ? t("guard.sampleCreating") : t("guard.sampleOpen")}</button>
          <button class="lv-btn lv-btn--ghost" onclick={() => view = "import"}><Icon name="import" size={16} /> {t("import.title")}</button>
          <button class="lv-btn lv-btn--ghost" onclick={() => view = "ai"}><Icon name="sparkles" size={16} /> {t("ai.title")}</button>
          <button class="lv-btn lv-btn--ghost" onclick={() => view = "manual"}><Icon name="pencil" size={16} /> {t("entry.manual")}</button>
          <button class="lv-btn lv-btn--ghost" onclick={() => { view = "materials"; loadMaterials(); }}><Icon name="book" size={16} /> {t("materials.title")}</button>
          <button class="lv-btn" onclick={copyChallengeCode}><Icon name="target" size={16} /> {t("challenge.copy")}</button>
          <button class="lv-btn" onclick={importChallengeCode}><Icon name="import" size={16} /> {t("challenge.import")}</button>
          <button class="lv-btn" onclick={syncBankDocs} disabled={syncDocsBusy || offline || !hasBank} title={t("sync.docsTip")}><Icon name="save" size={16} /> {syncDocsBusy ? "…" : t("sync.docsBtn")}</button>
          <details class="lv-export-fold">
            <summary class="lv-btn"><Icon name="export" size={16} /> {t("export.wrongbook")}</summary>
            <div class="lv-card" style="padding: var(--lv-space-relaxed) var(--lv-space-3);margin-top:6px">
              <div class="lv-row" style="margin:4px 0">
                <span class="lv-chip">{t("manual.kp")}</span>
                <select class="lv-select" bind:value={expKp}>
                  <option value="">{t("filter.all")}</option>
                  {#each expKpRoots as k, _i (_i)}<option value={k}>{k}</option>{/each}
                </select>
                <span class="lv-chip">{t("session.reason")}</span>
                <select class="lv-select" bind:value={expReason}>
                  <option value="">{t("filter.all")}</option>
                  <option value="careless">{t("reason.careless")}</option>
                  <option value="unknown">{t("reason.unknown")}</option>
                  <option value="trap">{t("reason.trap")}</option>
                </select>
                <span class="lv-chip">{t("export.range")}</span>
                <select class="lv-select" bind:value={expDays}>
                  <option value={0}>{t("export.allTime")}</option>
                  <option value={7}>7{t("entry.days")}</option>
                  <option value={30}>30{t("entry.days")}</option>
                </select>
              </div>
              <button class="lv-btn sm lv-btn--primary" onclick={exportWrong}><Icon name="export" size={14} /> {t("export.run")}</button>
              <div class="lv-row" style="margin:6px 0 0">
                <button class="lv-btn sm" disabled={offline} onclick={exportBank}><Icon name="export" size={14} /> {t("share.export")}</button>
                <label class="lv-btn sm" class:disabled={offline} style={offline ? "opacity:.5;pointer-events:none" : ""}><Icon name="import" size={14} /> {t("share.import")}<input type="file" accept=".sy.zip,.zip" style="display:none" onchange={importBank} /></label>
                <span class="lv-muted">{t("share.desktopOnly")}</span>
              </div>
            </div>
          </details>
        </div>
      </div>
    {/if}
  {:else if view === "session" && session}
    <!-- ===== S2 会话 ===== -->
    {#if sessionDone}
      <div class="lv-pad lv-center">
        <div class="lv-card lv-guard">
          <div class="lv-guard-title"><Icon name="trophy" size={18} /> {t("session.done")}</div>
          <div class="lv-done-stats num">
            <div><strong>{sessionDone.total}</strong><span>{t("session.total")}</span></div>
            <div class="good"><strong>{sessionDone.correct}</strong><span>{t("session.correct")}</span></div>
            <div class="bad"><strong>{sessionDone.wrong}</strong><span>{t("session.wrong")}</span></div>
          </div>
          {#if sessionDone.totalTimeS}
            <div class="lv-row" style="justify-content:center;gap:var(--lv-space-3);margin:6px 0 2px" role="status">
              <span class="lv-chip num"><Icon name="clock" size={12} /> {t("session.totalTime")} {sessionDone.totalTimeS >= 60 ? `${Math.floor(sessionDone.totalTimeS / 60)}m${sessionDone.totalTimeS % 60 ? ` ${sessionDone.totalTimeS % 60}s` : ""}` : `${sessionDone.totalTimeS}s`}</span>
              <span class="lv-chip num">{t("session.avgTime")} {sessionDone.avgTimeS}s</span>
            </div>
          {/if}
          {#if kpBreakdown.length > 1}
            <!-- 知识点分布：本次会话按考点聚合对错，帮助即时识别薄弱考点 -->
            <div class="lv-row" style="flex-wrap:wrap;justify-content:center;gap:var(--lv-space-1);margin:8px 0 2px">
              {#each kpBreakdown as kp (kp.kp)}
                <span class="lv-chip {kp.wrong > 0 ? 'lv-chip--red' : 'lv-chip--grn'} num" title="{kp.kp}: {kp.correct}/{kp.total}">
                  {kp.kp} {kp.correct}/{kp.total}
                </span>
              {/each}
            </div>
          {/if}
          {#if checkinStatus && checkinStatus !== "disabled" && checkinStatus !== "below-threshold" && checkinStatus !== "no-api"}
            <!-- 48-03 lite：打卡桥状态（未配置/未达标/打卡未装时安静不显） -->
            <p class="lv-muted" style="margin:2px 0" role="status">
              <Icon name="calendar" size={12} /> {t("checkin.status." + checkinStatus)}{#if checkinStatus === "pending" && checkinNote}<span class="num">（{checkinNote}）</span>{/if}
            </p>
          {/if}
          {#if session.state.order}
            <!-- 44-03：结算显示本次排序策略（同队列可重放，不能以单次正确率下学习结论） -->
            <p class="lv-muted" style="margin:2px 0">{t("session.orderLabel")}：{session.state.order === "interleaved" ? t("session.orderInter") : t("session.orderAdj")}</p>
          {/if}
          {#if session.state.seed}
            <!-- 65-05 lite：可复现标识（同 seed+同候选池=同卷序；题库版本变化/缺题如实反映为队列差异） -->
            <p class="lv-muted" style="margin:2px 0" role="status">
              <Icon name="hourglass" size={12} /> {t("session.seedLabel")}：<span class="num">{session.state.seed}</span>
            </p>
          {/if}
          {#if session.answered.length}
            <div class="lv-row" style="flex-wrap:wrap;gap:var(--lv-space-1);margin:8px 0">
              {#each session.answered as a, ai (ai)}
                {@const aq = questions.find((x) => x.id === a.qid)}
                <span class="lv-chip num" class:lv-chip--grn={a.grade.verdict === "correct"} class:lv-chip--red={a.grade.verdict === "wrong"} title={aq?.stem.slice(0, 60) ?? a.qid}>{ai + 1} {a.grade.verdict === "correct" ? "✓" : a.grade.verdict === "wrong" ? "✕" : "–"} {(a.timeMs / 1000).toFixed(0)}s</span>
              {/each}
            </div>
          {/if}
          {#if sessionDone.wrong > 0}
            <button class="lv-btn" style="width:100%" onclick={sameKpSession}><Icon name="rotate" size={16} /> {t("memory.sameKp")}</button>
            <button class="lv-btn" style="width:100%;margin-top:6px" onclick={wrongsToCard}><Icon name="layers" size={16} /> {t("session.wrongsToCard")}</button>
            <button class="lv-btn" style="width:100%;margin-top:6px" disabled={actionBusy} onclick={wrongsToActions}>
              <Icon name="pin" size={16} /> {actionBusy ? "…" : t("action.addWrong")}
            </button>
            {#if actionNote}<p class="lv-muted num" style="margin:6px 0 0">{actionNote}</p>{/if}
            <!-- 44-01 end 模式/回看：错题逐题展开（题干+我的答案+正确答案+解析）；quiet 边框给出可点可供养 -->
            <button class="lv-btn" style="width:100%;margin-top:6px" onclick={() => { reviewOpen = !reviewOpen; if (reviewOpen) void loadReflections(); }}>
              {reviewOpen ? "▾" : "▸"} {t("session.reviewWrongs")}
            </button>
            {#if reviewOpen}
              <div class="lv-detail" style="text-align:left;max-height:260px;overflow:auto">
                {#each session.answered.filter((a) => a.grade.verdict !== "correct") as a, _ri (_ri)}
                  {@const aq = questions.find((x) => x.id === a.qid)}
                  <div class="lv-error-row" style="white-space:normal">
                    <b class="num">✕</b> {aq?.stem.slice(0, 80) ?? a.qid}
                    <div class="lv-muted num">{t("browse.answer")}: {aq?.answer ?? "—"}{#if a.grade.myAnswer} · {t("session.myAnswer")}: {a.grade.myAnswer}{/if}{#if aq?.analysis} · {aq.analysis}{/if}</div>
                    {#if reflections[a.qid]}
                      <!-- 52-04：上次检查点回显 -->
                      <div class="lv-muted" style="font-size:var(--lv-font-size-caption)"><Icon name="pencil" size={12} /> {t("reflection.last").replace("{d}", new Date(reflections[a.qid].at).toLocaleDateString())}：{reflections[a.qid].text}</div>
                    {/if}
                    <div class="lv-row" style="margin:4px 0 0;gap:var(--lv-space-1)">
                      <button class="lv-btn sm lv-btn--ghost" onclick={() => void editReflection(a.qid)}>
                        <Icon name="pencil" size={13} /> {reflections[a.qid] ? t("reflection.edit") : t("reflection.add")}
                      </button>
                      <!-- 116-01 T08：AI 错因假设（事实→假设→验证行动；采纳由用户操作） -->
                      <button class="lv-btn sm lv-btn--ghost" disabled={misdiagnosisBusy === a.qid}
                        onclick={() => void runMisdiagnosis(a)}>
                        <Icon name="flask" size={13} /> {misdiagnosisBusy === a.qid ? "…" : t("misdiagnosis.ask")}
                      </button>
                    </div>
                    {#if misdiagnosisText[a.qid]}
                      <div class="lv-detail" style="margin:4px 0 0;font-size:var(--lv-font-size-sm);white-space:pre-wrap;overflow-wrap:anywhere">{misdiagnosisText[a.qid]}</div>
                      <div class="lv-muted" style="font-size:var(--lv-font-size-compact)">{t("misdiagnosis.disclaimer")}</div>
                      <button class="lv-btn sm lv-btn--ghost" onclick={() => void adoptMisdiagnosis(a.qid)}>＋ {t("misdiagnosis.adopt")}</button>
                    {/if}
                  </div>
                {/each}
                {#if session.answered.some((a) => a.grade.verdict === "correct" && helpShown.get(a.qid))}
                  <!-- 114-05 lite：受助答对 → 自我解释（用自己的话说明依据；可跳过；与错题复盘同层存储） -->
                  <div class="lv-muted" style="margin:8px 0 2px;font-size:var(--lv-font-size-caption)"><Icon name="bulb" size={12} /> {t("selfexplain.header")}</div>
                  {#each session.answered.filter((a) => a.grade.verdict === "correct" && helpShown.get(a.qid)) as a, _si2 (_si2)}
                    {@const aq = questions.find((x) => x.id === a.qid)}
                    <div class="lv-error-row" style="white-space:normal">
                      <b class="num">✓</b> {aq?.stem.slice(0, 80) ?? a.qid}
                      {#if reflections[a.qid]}
                        <div class="lv-muted" style="font-size:var(--lv-font-size-caption)">{reflections[a.qid].text}</div>
                      {/if}
                      <button class="lv-btn sm lv-btn--ghost" onclick={() => void editReflection(a.qid)}>
                        <Icon name="message" size={13} /> {reflections[a.qid] ? t("selfexplain.edit") : t("selfexplain.add")}
                      </button>
                    </div>
                  {/each}
                {/if}
              </div>
            {/if}
          {/if}
          <button class="lv-btn lv-btn--primary" style="width:100%;margin-top:8px" onclick={exitSession} disabled={exitBusy}>{exitBusy ? "…" : t("session.back")}</button>
        </div>
      </div>
    {:else}
      {@const q = curQ}
      {#if q}
        <div class="lv-pad lv-session-grid">
          <div class="lv-row lv-session-head">
            <button class="lv-btn lv-btn--ghost" onclick={exitSession} disabled={exitBusy}>← {exitBusy ? "…" : t("session.exit")}</button>
            <div class="lv-row" style="flex:1;min-width:120px;gap:var(--lv-space-2)">
              <div class="lv-progress" style="flex:1" role="progressbar" aria-label={t("session.progress")} aria-valuemin="0" aria-valuemax={curProgress.total} aria-valuenow={curProgress.done}><i style="width:{curProgress.total ? Math.round((curProgress.done / curProgress.total) * 100) : 0}%"></i></div>
              <span class="num lv-muted">{curProgress.done}/{curProgress.total}</span>
            </div>
            <span class="lv-chip lv-chip--acc">{t("qtype." + q.type)}</span>
            {#if q.group}
              {@const sibs = questions.filter((x) => x.group === q.group)}
              {@const pos = sibs.findIndex((x) => x.id === q.id) + 1}
              <span class="lv-chip num"><Icon name="link" size={12} /> {t("session.groupPos")} {pos}/{sibs.length}</span>
            {/if}
            <button class="lv-chip" title={t("tts.read")} aria-label={t("tts.read")} onclick={() => ttsSpeak([q.stem, ...q.options].join(" "))}><Icon name="volume" size={13} /></button>
            <button class="lv-chip" class:acc={reciteToggle} title={t("session.reciteMode")} aria-pressed={reciteToggle} onclick={toggleRecite}><Icon name="eye" size={13} /> {t("session.reciteMode")}</button>
            <button class="lv-chip" class:acc={soundEnabled} title={soundEnabled ? t("sound.disable") : t("sound.enable")} onclick={() => { soundEnabled = !soundEnabled; writeLocal("lv-exam/sound", soundEnabled ? "1" : "0"); }}><Icon name={soundEnabled ? "volume" : "volume-x"} size={13} /></button>
            <button class="lv-chip" class:acc={hotkeysHelpOpen} title={t("hotkeys.tip")} onclick={() => hotkeysHelpOpen = !hotkeysHelpOpen}><Icon name="activity" size={13} /> ?</button>
            <button class="lv-chip" class:acc={pureListen} title={t("tts.pureListen")} aria-label={t("tts.pureListen")} aria-pressed={pureListen} onclick={togglePureListen}><Icon name="eyeoff" size={13} /></button>
              <button class="lv-chip" class:acc={!!q.fav} title="E" aria-label={t("session.kbdFav")} aria-pressed={!!q.fav} aria-busy={favBusy} disabled={favBusy} onclick={() => toggleFavCurrent()}><Icon name="star" size={13} /></button>
          </div>
          <div class="lv-session-main">
          <div class="lv-card lv-question" class:lv-pure={pureListen}>
            {#if materialContext}
              <div class="lv-analysis lv-rich b3-typography" style="margin-bottom:12px">
                <b class="lv-mat-chip"><Icon name="paperclip" size={14} /> {t("material.shared")}</b>{@html materialLong && !materialExpanded ? escapeHtml(materialShown) : (materialHtml || escapeHtml(materialShown))}
                {#if materialLong}
                  <button class="lv-chip num" style="margin-left:6px" onclick={() => { materialExpanded = !materialExpanded; if (materialExpanded && !feedback) addExposure(q.id, "material"); }}>
                    {materialExpanded ? t("material.fold") : t("material.expand")}
                  </button>
                {/if}
              </div>
            {/if}
            {#if stemHtml}<div class="lv-stem lv-rich b3-typography">{@html stemHtml}</div>{:else}<div class="lv-stem">{q.stem}</div>{/if}
            <p class="lv-muted" style="margin:8px 0 14px" role="note">{t("session.guide." + q.type)}</p>
            {#key session.id + ":" + curProgress.done}
            {#if isChoiceQuestion(q)}
              {@const choices = answerChoices(q)}
              {#if !choices.length}
                <div class="lv-error" role="alert">{t("session.missingOptions")}</div>
              {:else}
              <!-- 52-02 lite：先回忆后显示选项——藏选项 + 独立回忆草稿（与作答草稿分离，不入正式答案） -->
              <div class="lv-row" style="margin:0 0 4px">
                <button class="lv-chip" class:acc={hideOptions} onclick={() => { hideOptions = !hideOptions; if (hideOptions) recallDraft = ""; }}>
                  {hideOptions ? t("session.recallOn") : t("session.recallOff")}
                </button>
                {#if hideOptions}<span class="lv-muted" style="font-size:var(--lv-font-size-caption)">{t("session.recallHint")}</span>{/if}
              </div>
              {#if hideOptions}
                <textarea class="lv-input lv-textarea" rows="2" bind:value={recallDraft}
                  placeholder={t("session.recallPlaceholder")} aria-label={t("session.recallPlaceholder")}></textarea>
                <div class="lv-row" style="margin:6px 0">
                  <button class="lv-btn lv-btn--primary sm" onclick={() => { if (q) recallUsed.add(q.id); hideOptions = false; }}>{t("session.revealOptions")}</button>
                </div>
              {:else}
              <!-- 45-03：多选用 checkbox/group 语义而非 radio；读屏可感知选中态 -->
              <div role={q.type === "multiple" ? "group" : "radiogroup"} aria-label={t("session.options")}>
                {#each choices as choice (choice.value)}
                  <button class="lv-opt" class:sel={q.type === "multiple" ? selected.includes(choice.value) : selected === choice.value}
                    role={q.type === "multiple" ? "checkbox" : "radio"}
                    aria-checked={q.type === "multiple" ? selected.includes(choice.value) : selected === choice.value}
                    class:right={feedback && feedback.verdict !== "not_attempted" && (q.type === "multiple" ? q.answer.includes(choice.value) : q.answer === choice.value)}
                    class:wrong={feedback?.verdict === "wrong" && (q.type === "multiple" ? (feedback.myAnswer ?? "").includes(choice.value) && !q.answer.includes(choice.value) : feedback.myAnswer === choice.value)}
                    disabled={!!feedback}
                    onclick={() => pickPracticeChoice(choice.value)}>
                    <span class="lv-opt-check" class:box={q.type === "multiple"} aria-hidden="true"></span>
                    <span class="key">{choice.letter}</span>
                    <span class="lv-opt-text">{@html renderInlineText(choice.text)}</span>
                  </button>
                {/each}
              </div>
              {#if q.type === "multiple" && !feedback}
                {@const selLetters = selected ? [...selected].sort().join(", ") : ""}
                <div class="lv-row lv-multi-indicator" style="margin:8px 0 4px;align-items:center;gap:var(--lv-space-2)">
                  <span class="lv-chip num" class:lv-chip--acc={selected.length > 0}>
                    {selected.length > 0 ? t("session.multiSelected").replace("{items}", selLetters).replace("{n}", String(selected.length)) : t("session.multiEmpty")}
                  </span>
                </div>
              {/if}
              {/if}
              {/if}
            {:else}
              {#if curSpec?.kind === "numeric"}
                <!-- 54 第三刀：数值题专用作答框（单行 + 单位提示；宽容解析/容差判分在引擎） -->
                <input class="lv-input lv-answer-num" type="text" inputmode="decimal"
                  placeholder={curSpec.unit ? t("session.numericUnit").replace("{u}", curSpec.unit) : t("session.numericPlain")}
                  value={feedback?.myAnswer ?? currentDraft}
                  oninput={(e) => { draftLive = (e.target as HTMLInputElement).value; session.setDraft(q.id, draftLive); }}
                  onchange={(e) => trailInput(q.id, (e.target as HTMLInputElement).value)}
                  disabled={!!feedback} />
                {#if curSpec.unit}<div class="lv-row" style="margin:6px 0 0"><span class="lv-chip num">{t("session.unitLabel")}：{curSpec.unit}</span></div>{/if}
              {:else if curSpec?.kind === "multiBlank"}
                <!-- 54 第三刀：多空题逐空作答框（草稿按 ";;" 拼接，判分按位置对应） -->
                <div class="lv-row" style="margin:0 0 6px"><span class="lv-muted" style="font-size:var(--lv-font-size-caption)">{t("session.blankHint")}</span></div>
                {#each blankParts as _p, i (i)}
                  <input class="lv-input lv-answer-blank" placeholder={t("session.blankN").replace("{n}", String(i + 1))}
                    value={blankParts[i]}
                    oninput={(e) => setBlank(i, (e.target as HTMLInputElement).value)}
                  onchange={() => trailInput(q.id, joinBlanks(blankParts))}
                    disabled={!!feedback} />
                {/each}
              {:else}
                <textarea class="lv-input lv-textarea" placeholder={q.type === "short" ? t("session.shortPlaceholder") : t("session.fillPlaceholder")} aria-label={t("session.guide." + q.type)}
                  value={feedback?.myAnswer ?? currentDraft}
                  oninput={(e) => { draftLive = (e.target as HTMLTextAreaElement).value; session.setDraft(q.id, draftLive); }}
                onchange={(e) => trailInput(q.id, (e.target as HTMLTextAreaElement).value)}
                  disabled={!!feedback}></textarea>
              {/if}
            {/if}
            {/key}

            {#if feedback}
              <div class="lv-feedback" role="status" aria-live="polite" class:good={feedback.verdict === "correct"}>
                <div class="lv-row" style="margin:0;gap:var(--lv-space-2);align-items:center;flex-wrap:wrap">
                  <span>
                    {q.type === "short" && feedback.myAnswer ? t("session.shortSaved") : feedback.verdict === "correct" ? t("session.correct") : feedback.verdict === "wrong" ? t("session.wrongAns") : t("session.skipped")}
                  </span>
                  {#if feedback.verdict === "wrong"}
                    <span class="lv-chip lv-chip--acc num" style="font-weight:var(--lv-font-weight-bold);font-size:var(--lv-font-size-md)">{q.answer}</span>
                    {#if feedback.myAnswer}
                      <span class="lv-muted" style="margin-left:4px">（{t("session.myAnswer")}: <b class="num" style="color:var(--lv-red)">{feedback.myAnswer}</b>）</span>
                    {/if}
                  {/if}
                  {#if confidenceSel}<span class="lv-chip num" style="margin-left:auto">{t("confidence.recorded")}{t("confidence." + confidenceSel)}</span>{/if}
                </div>
              </div>
              {#if q.type === "short"}<div class="lv-analysis"><b>{t("session.referenceAnswer")}</b><div>{q.answer}</div></div>{/if}
              {#if q.analysis}<div class="lv-analysis">{q.analysis}</div>{/if}
              {#if feedback.verdict === "wrong"}
                <div class="lv-row lv-session-reason-row" style="margin:10px 0;gap:var(--lv-space-compact);align-items:center;flex-wrap:wrap">
                  <span class="lv-muted" style="font-size:var(--lv-font-size-label);font-weight:600">{t("session.reason")}:</span>
                  {#each ["careless", "unknown", "trap"] as r, ri (ri)}
                    <button
                      class="lv-chip lv-reason-btn"
                      class:acc={savedReason === r}
                      aria-pressed={savedReason === r}
                      title={t("entry.days") === "天" ? `快捷键 ${ri + 1}` : `Key ${ri + 1}`}
                      onclick={async () => { await app?.saveWrongReason(q.id, r as any); savedReason = r; }}
                    >
                      <span class="lv-reason-key">{ri + 1}</span>
                      {savedReason === r ? "✓ " : ""}{t("reason." + r)}
                    </button>
                  {/each}
                </div>
              {/if}
            {/if}
            {#if !feedback}
              <div class="lv-row lv-muted" style="font-size:var(--lv-font-size-caption);gap:var(--lv-space-compact);flex-wrap:wrap">
                <span>{t("confidence.before")}</span>
                {#each ["sure", "fuzzy", "guess"] as c, _i (_i)}
                  <button class="lv-chip" class:acc={confidenceSel === c} aria-pressed={confidenceSel === c} title={`Key ${["sure", "fuzzy", "guess"].indexOf(c) + 1}`} onclick={() => confidenceSel = c as "sure" | "fuzzy" | "guess"}>{t("confidence." + c)}</button>
                {/each}
                <span class="lv-chip num" class:lv-chip--amb={qTimeoutS > 0 && qElapsedS >= qTimeoutS * 0.8 && qElapsedS < qTimeoutS} class:lv-chip--red={qTimeoutS > 0 && qElapsedS >= qTimeoutS} class:lv-pulse={qTimeoutS > 0 && qElapsedS >= qTimeoutS} title={qTimeoutS > 0 ? t("session.timeoutHint").replace("{n}", String(qTimeoutS)) : ""}>
                  <Icon name="clock" size={12} /> {qElapsedS}s
                </span>
              </div>
            {/if}

            <div class="lv-row lv-answer-actions">
              {#if !feedback}
                <button class="lv-btn lv-btn--primary" onclick={submitAnswer} disabled={!canSubmitAnswer}>
                  {q.type === "multiple" && selected.length > 0 ? t("session.submitSelected").replace("{n}", String(selected.length)) : t("session.submit")}
                </button>
                <button class="lv-btn lv-btn--ghost" onclick={requestHint} disabled={explainBusy}><Icon name="bulb" size={14} /> {hintButtonLabel(q)}</button>
                {#if q.type === "fill" || q.type === "short"}
                  <button class="lv-btn lv-btn--ghost" onclick={() => { submitAnswer(); }}>{t("session.skip")}</button>
                {/if}
              {:else}
                <button class="lv-btn lv-btn--primary" onclick={nextQuestion}>{t("session.next")} →</button>
                {#if feedback.verdict === "wrong"}
                  <button class="lv-btn" onclick={toCard}><Icon name="layers" size={16} /> {t("memory.toCard")}</button>
                  {#if cardResult}<span class="lv-muted">{cardResult}</span>{/if}
                  <button class="lv-btn" onclick={() => explainCurrent("explain")} disabled={explainBusy}><Icon name="sparkles" size={16} /> {explainBusy ? "…" : t("explain.ask")}</button>
                  <button class="lv-btn" onclick={requestHint} disabled={explainBusy}><Icon name="bulb" size={14} /> {hintButtonLabel(q)}</button>
                  <button class="lv-btn" onclick={() => explainCurrent("socratic")} disabled={explainBusy}><Icon name="message" size={14} /> {t("explain.socratic")}</button>
                {/if}
              {/if}
              {#if leakPending && session?.current && explainQid === session.current.id}
                <div class="lv-analysis lv-explain">
                  ⚠ {t("explain.hintLeak").replace("{r}", leakPending.reasons)}
                  <div class="lv-row">
                    <button class="lv-btn sm" onclick={viewLeakedHint}>{t("explain.hintLeakView")}</button>
                    <button class="lv-btn sm" onclick={() => (leakPending = null)}>{t("explain.hintLeakDismiss")}</button>
                  </div>
                </div>
              {/if}
              {#if explainText && session?.current && explainQid === session.current.id}
                <div class="lv-analysis lv-explain">{explainText}</div>
                <div class="lv-row">
                  {#if explainSavedQid === q.id}
                    <span class="lv-muted" role="status">✓ {t("explain.saved")}</span>
                  {:else}
                    <button class="lv-btn sm" onclick={saveExplain} disabled={explainSaveBusy} aria-busy={explainSaveBusy}><Icon name="pin" size={13} /> {explainSaveBusy ? "…" : explainSaveError ? t("explain.retrySave") : t("explain.save")}</button>
                  {/if}
                  <button class="lv-btn sm" onclick={requestHint} disabled={explainBusy}><Icon name="bulb" size={14} /> {hintButtonLabel(q)}</button>
                  <button class="lv-btn sm" onclick={() => explainCurrent("socratic")} disabled={explainBusy}><Icon name="message" size={14} /> {t("explain.socratic")}</button>
                </div>
                {#if explainSaveErrorQid === q.id && explainSaveError}<div class="lv-error" role="alert">{t("explain.saveFailed").replace("{message}", explainSaveError)}</div>{/if}
                <div class="lv-row">
                  <input class="lv-input" style="flex:1;min-width:160px" placeholder={t("explain.followUp")}
                    bind:value={explainFollowUp}
                    onkeydown={(e) => !e.isComposing && e.keyCode !== 229 && e.key === "Enter" && sendFollowUp()} />
                  <button class="lv-btn sm" onclick={sendFollowUp} disabled={explainBusy || !explainFollowUp.trim()}>{t("explain.send")}</button>
                </div>
              {/if}
            </div>
            {#if reasonPromptQid === q.id && !feedback}
              <div class="lv-row lv-reason" role="group" aria-label={t("trail.reasonTitle")}>
                <span class="lv-muted" style="font-size:var(--lv-font-size-caption)">{t("trail.reasonTitle")}</span>
                <button class="lv-chip" onclick={() => setEditReason(q.id, "unsure")}>{t("trail.reason.unsure")}</button>
                <button class="lv-chip" onclick={() => setEditReason(q.id, "evidence")}>{t("trail.reason.evidence")}</button>
                <button class="lv-chip" onclick={() => setEditReason(q.id, "misclick")}>{t("trail.reason.misclick")}</button>
                <button class="lv-chip lv-btn--ghost" onclick={() => (reasonPromptQid = "")}>{t("trail.reason.skip")}</button>
              </div>
            {/if}
          </div>
          </div>
          <aside class="lv-session-side">
            <div class="lv-card lv-side-card">
              <b class="lv-side-title">{t("session.side.q")}</b>
              <div class="lv-side-rows">
                {#if q.kp}<span class="lv-chip"><Icon name="layers" size={11} /> {q.kp}</span>{/if}
                {#if q.source}<span class="lv-chip num" title={t("manual.source")}>{q.source}</span>{/if}
                {#if q.difficulty}<span class="lv-chip num">★ {q.difficulty}</span>{/if}
                {#if q.score}<span class="lv-chip num">{t("manual.score")} {q.score}</span>{/if}
                {#if curQStats && curQStats.attempts > 0}
                  <span class="lv-chip num" title={t("browse.usage").replace("{a}", String(curQStats.attempts)).replace("{c}", String(Math.round((curQStats.correct / curQStats.attempts) * 100)))}>
                    <Icon name="chart" size={11} /> {curQStats.attempts} · {Math.round((curQStats.correct / curQStats.attempts) * 100)}%
                  </span>
                {/if}
              </div>
            </div>
            <div class="lv-card lv-side-card">
              <b class="lv-side-title">{t("session.side.kbd")}</b>
              <div class="lv-row lv-muted" style="font-size:var(--lv-font-size-label);gap:var(--lv-space-compact);flex-wrap:wrap;margin:0">
                <span class="lv-kbd">A</span>-<span class="lv-kbd">J</span> {t("session.choose")} ·
                <span class="lv-kbd">1</span>-<span class="lv-kbd">3</span> {t("confidence.shortcut")} ·
                <span class="lv-kbd">Enter</span> {t("session.submit")} ·
                <span class="lv-kbd">J</span>/<span class="lv-kbd">K</span> {t("session.next")}/{t("session.kbdPrev")} ·
                <span class="lv-kbd">E</span> {t("session.kbdFav")} ·
                <span class="lv-kbd">Esc</span> {t("session.exit")}
              </div>
            </div>
          </aside>
        </div>
      {/if}
    {/if}
  {:else if view === "recite"}
    <!-- ===== S4 背诵（lite）：盖答案 → 四级自评；纸面质感（原型 .paper） ===== -->
    <div class="lv-pad lv-pad--narrow">
      <div class="lv-screen-head"><span class="lv-eyebrow">{t("head.recite.eyebrow")}</span><h1 class="lv-h1">{t("head.recite.title")}</h1><p>{t("head.recite.desc")}</p></div>
      <div class="lv-row">
        <button class="lv-btn lv-btn--ghost" onclick={exitRecite}>← {t("recite.exit")}</button>
        <span class="lv-chip num">{reciteCursor + 1}/{reciteQueue.length}</span>
        <span class="lv-chip">{t("recite.mode")}</span>
        {#if (reciteQueue[reciteCursor] as any)?.blockId && (reciteQueue[reciteCursor] as any)?.rootId}
          <button class="lv-chip" title={t("recite.jumpSource")} onclick={jumpToSource}><Icon name="pin" size={12} /> {t("recite.jumpSource")}</button>
        {/if}
        {#if reciteQueue[reciteCursor]?.group}
          <span class="lv-chip num"><Icon name="link" size={12} /> {t("session.groupPos")}</span>
        {/if}
        {#if reciteQueue[reciteCursor]}
          <button class="lv-chip" title={t("tts.read")} aria-label={t("tts.read")} onclick={() => ttsSpeak(reciteQueue[reciteCursor].stem)}><Icon name="volume" size={13} /></button>
        {/if}
      </div>
      {#if reciteDone}
        {@const forgotCount = reciteRatings.filter((x) => x === 1).length}
        <div class="lv-card lv-guard">
          <div class="lv-guard-title"><Icon name="trophy" size={17} /> {t("recite.done")}</div>
          <p class="num lv-muted">{t("recite.dist")}：{t("rate.1")} {reciteRatings.filter((x) => x === 1).length} · {t("rate.2")} {reciteRatings.filter((x) => x === 2).length} · {t("rate.3")} {reciteRatings.filter((x) => x === 3).length} · {t("rate.4")} {reciteRatings.filter((x) => x === 4).length}</p>
          <p class="lv-muted" style="font-size:var(--lv-font-size-sm)">{t("recite.doneHint")}</p>
          {#if forgotCount > 0}
            <button class="lv-btn sm lv-btn--primary" style="width:100%;margin-bottom:8px" onclick={retryForgotRecite}>
              <Icon name="rotate" size={15} /> {t("recite.retryForgot")}（{forgotCount}）
            </button>
          {/if}
          <button class="lv-btn lv-btn--primary" style="width:100%" onclick={exitRecite}>{t("session.back")}</button>
        </div>
      {:else if reciteQueue[reciteCursor]}
        {@const q = reciteQueue[reciteCursor]}
        <div class="lv-card lv-question lv-paper">
          {#if reciteMaterial}
            <div class="lv-analysis" style="margin-bottom:12px"><b class="lv-mat-chip"><Icon name="paperclip" size={14} /> {t("material.shared")}</b>{reciteMaterial}</div>
          {/if}
          {#if stemHtml}<div class="lv-stem lv-rich b3-typography">{@html stemHtml}</div>{:else}<div class="lv-stem">{q.stem}</div>{/if}
          {#if !reciteRevealed}
            {#if q.kp || q.analysis}
              <div class="lv-row"><button class="lv-chip" onclick={() => reciteHint = reciteHint === 0 ? (q.kp ? 1 : 2) : reciteHint === 1 && q.analysis ? 2 : 1} title={q.analysis ? t("recite.hint2Key") : ""}><Icon name="bulb" size={12} /> {reciteHint >= 2 ? t("recite.hint2") : t("recite.hint1")}：{reciteHint >= 2 ? (q.analysis ?? "").slice(0, 24) : (q.kp ?? q.analysis ?? "").slice(0, 24)}</button></div>
            {/if}
            <div class="lv-row" style="justify-content:center">
              <button class="lv-btn lv-btn--primary" onclick={() => reciteRevealed = true}>{t("recite.reveal")}</button>
            </div>
          {:else}
            <div class="lv-recite-revealed">
              {#if q.options.length}
                <div class="lv-analysis"><b>{t("recite.answer")}:</b> {q.answer}</div>
                {#each q.options as opt, i (i)}
                  <div class="lv-opt" class:right={q.answer.includes(String.fromCharCode(65 + i))} style="cursor:default">
                    <span class="key">{String.fromCharCode(65 + i)}</span><span class="lv-opt-text">{@html renderInlineText(opt)}</span>
                  </div>
                {/each}
              {:else}
                <div class="lv-analysis"><b>{t("recite.answer")}:</b> {q.answer}</div>
              {/if}
              {#if q.analysis}<div class="lv-analysis">{q.analysis}</div>{/if}
              <div class="lv-rate">
                <!-- Anki 现代改造式自评：数字键帽常显语义色（红/琥珀/绿/主色），可扫视；hover 再整钮染色 -->
                <button class="lv-btn r1" disabled={reciteSaving} onclick={() => rateSelf(1)}><span class="lv-rate-key">1</span> {reciteSaving ? "…" : t("rate.1")}</button>
                <button class="lv-btn r2" disabled={reciteSaving} onclick={() => rateSelf(2)}><span class="lv-rate-key">2</span> {reciteSaving ? "…" : t("rate.2")}</button>
                <button class="lv-btn r3" disabled={reciteSaving} onclick={() => rateSelf(3)}><span class="lv-rate-key">3</span> {reciteSaving ? "…" : t("rate.3")}</button>
                <button class="lv-btn r4" disabled={reciteSaving} onclick={() => rateSelf(4)}><span class="lv-rate-key">4</span> {reciteSaving ? "…" : t("rate.4")}</button>
              </div>
            </div>
          {/if}
          {#if reciteError}<div class="lv-error" role="alert">{reciteError}</div>{/if}
        </div>
      {/if}
    </div>
  {:else if view === "wrongbook"}
    <!-- ===== 错题本（规范 v6 §6 / P0-2）：消灭进度 + 错因分布 + 紧迫队列 + 重练策略 ===== -->
    <div class="lv-pad">
      <div class="lv-screen-head">
        <span class="lv-eyebrow">WRONG BOOK</span>
        <h1 class="lv-h1">{t("wrongbook.title")}</h1>
        <p>{t("wrongbook.desc").replace("{n}", String(ELIMINATE_STREAK))}</p>
      </div>
      {#if !wrongList.length}
        <div class="lv-empty">
          <div class="lv-empty-icon"><Icon name="check" size={26} /></div>
          <b>{t("wrongbook.emptyTitle")}</b>
          <p class="lv-muted">{t("wrongbook.emptyDesc")}</p>
          <div class="lv-row" style="justify-content:center;margin-top:18px">
            <button class="lv-btn lv-btn--primary" onclick={() => void startDrill("quick")}><Icon name="zap" size={15} /> {t("mode.quick")}</button>
            <button class="lv-btn" onclick={() => { view = "entry"; }}><Icon name="home" size={15} /> {t("session.back")}</button>
          </div>
        </div>
      {:else}
        {@const qOf = (qid: string) => questions.find((x) => x.id === qid)}
        <div class="lv-kpis">
          <div class="lv-card lv-kpi"><div class="l"><span>{t("wrongbook.metric.active")}</span><Icon name="xcircle" size={15} /></div><div class="v num">{wrongList.length}</div><span class="lv-muted" style="font-size:var(--lv-font-size-sm)">{t("wrongbook.metric.active.note")}</span></div>
          <div class="lv-card lv-kpi"><div class="l"><span>{t("wrongbook.metric.eliminated")}</span><Icon name="check" size={15} /></div><div class="v num">{eliminatedCount}</div><span class="lv-muted" style="font-size:var(--lv-font-size-sm)">{t("wrongbook.metric.eliminated.note")}</span></div>
          <div class="lv-card lv-kpi"><div class="l"><span>{t("wrongbook.metric.progress")}</span><Icon name="target" size={15} /></div><div class="v num">{clearPct}%</div><span class="lv-muted" style="font-size:var(--lv-font-size-sm)">{t("wrongbook.metric.progress.note")}</span></div>
          <div class="lv-card lv-kpi"><div class="l"><span>{t("widget.streak")}</span><Icon name="flame" size={15} /></div><div class="v num">{streakDays} {t("entry.days")}</div><span class="lv-muted" style="font-size:var(--lv-font-size-sm)">{t("widget.streak.note")}</span></div>
        </div>
        <div class="lv-shell-grid">
          <div class="stack">
            <div class="lv-card">
              <b class="lv-block-title">{t("wrongbook.progress")}</b>
              <div class="lv-row" style="justify-content:space-between;margin:4px 0 8px">
                <strong class="num" style="font-size:22px">{clearPct}%</strong>
                <span class="lv-chip lv-chip--amb num">{t("wrongbook.eliminated.note").replace("{e}", String(eliminatedCount)).replace("{a}", String(wrongList.length))}</span>
              </div>
              <div class="lv-progress"><i style="width:{clearPct}%"></i></div>
              <div class="divider" style="margin:16px 0 12px"></div>
              <b class="lv-block-title">{t("wrongbook.reasons")}</b>
              <div class="lv-chart-row"><span>{t("reason.unknown")}</span><div class="lv-progress"><i style="width:{Math.round((reasonCounts.unknown / Math.max(1, wrongList.length)) * 100)}%"></i></div><strong>{reasonCounts.unknown}</strong></div>
              <div class="lv-chart-row"><span>{t("reason.careless")}</span><div class="lv-progress"><i style="width:{Math.round((reasonCounts.careless / Math.max(1, wrongList.length)) * 100)}%"></i></div><strong>{reasonCounts.careless}</strong></div>
              <div class="lv-chart-row"><span>{t("reason.trap")}</span><div class="lv-progress"><i style="width:{Math.round((reasonCounts.trap / Math.max(1, wrongList.length)) * 100)}%"></i></div><strong>{reasonCounts.trap}</strong></div>
              <div class="lv-chart-row"><span>{t("reason.unmarked")}</span><div class="lv-progress"><i style="width:{Math.round((reasonCounts.unmarked / Math.max(1, wrongList.length)) * 100)}%"></i></div><strong>{reasonCounts.unmarked}</strong></div>
              <p class="lv-muted" style="font-size:var(--lv-font-size-caption);margin:6px 0 0">{t("wrongbook.reasons.note")}</p>
            </div>
            <div class="lv-card">
              <div class="lv-row" style="justify-content:space-between;margin:0 0 6px">
                <b class="lv-block-title" style="margin:0">{t("wrongbook.queue")}</b>
                <span class="lv-muted" style="font-size:var(--lv-font-size-caption)">{t("wrongbook.queue.note")}</span>
              </div>
              <div class="lv-row" style="gap:var(--lv-space-compact);margin:8px 0 12px;flex-wrap:wrap;align-items:center">
                <button class="lv-chip" class:acc={wbReasonFilter === "all"} onclick={() => wbReasonFilter = "all"}>
                  {t("wrongbook.filterAll")} ({wrongQueue.length})
                </button>
                <button class="lv-chip" class:acc={wbReasonFilter === "careless"} onclick={() => wbReasonFilter = "careless"}>
                  {t("wrongbook.filterCareless")} ({reasonCounts.careless})
                </button>
                <button class="lv-chip" class:acc={wbReasonFilter === "unknown"} class:lv-chip--red={reasonCounts.unknown > 0} onclick={() => wbReasonFilter = "unknown"}>
                  {t("wrongbook.filterUnknown")} ({reasonCounts.unknown})
                </button>
                <button class="lv-chip" class:acc={wbReasonFilter === "trap"} onclick={() => wbReasonFilter = "trap"}>
                  {t("wrongbook.filterTrap")} ({reasonCounts.trap})
                </button>
                {#if filteredWrongQueue.length > 0}
                  <button class="lv-btn sm lv-btn--primary" style="margin-left:auto" onclick={() => void startFilteredWrongDrill()} title={t("wrongbook.drillFiltered")}>
                    <Icon name="play" size={13} /> {t("wrongbook.drillFiltered")} ({filteredWrongQueue.length})
                  </button>
                {/if}
              </div>
              {#each filteredWrongQueue as w, wi (w.qid)}
                {@const q = qOf(w.qid)}
                <div class="lv-wrong-row">
                  <span class="task-number num">{wi + 1}</span>
                  <div class="lv-wrong-main">
                    <div class="lv-wrong-stem" title={q?.stem ?? w.qid}>{q?.stem.slice(0, 80) ?? w.qid}</div>
                    <div class="lv-wrong-meta">
                      <span>{t("wrongbook.wrongN").replace("{n}", String(w.wrongCount))}</span>
                      {#if w.streakCorrect > 0}<span class="lv-chip lv-chip--grn num">{t("wrongbook.reClear").replace("{n}", String(ELIMINATE_STREAK - w.streakCorrect))}</span>{/if}
                      {#if reasonOf(w.qid)}<span class="lv-chip num">{t("reason." + reasonOf(w.qid))}</span>{/if}
                      <span>{t("wrongbook.lastWrong")} {new Date(w.lastWrongAt).toLocaleDateString()}</span>
                      {#if q?.kp}<span class="lv-chip num">{q.kp}</span>{/if}
                    </div>
                  </div>
                  <button class="lv-btn sm" onclick={() => void startWrongFor(w.qid)}><Icon name="play" size={13} /> {t("wrongbook.retry")}</button>
                  <button class="lv-btn sm lv-btn--ghost" title={t("wrongbook.sameKpTip")} onclick={() => void startSameKpFor(w.qid)}><Icon name="link" size={13} /> {t("wrongbook.sameKp")}</button>
                  <button class="lv-btn sm lv-btn--ghost" title={t("wrongbook.masteredTip")} disabled={wrongBusyId === w.qid || !!wrongBusyId} aria-busy={wrongBusyId === w.qid} onclick={() => void masterWrong(w.qid)}>{wrongBusyId === w.qid ? "…" : t("wrongbook.mastered")}</button>
                </div>
              {/each}
            </div>
          </div>
          <div class="stack">
            <div class="lv-card">
              <b class="lv-block-title">{t("wrongbook.strategy")}</b>
              <div class="stack-sm" style="margin-top:10px">
                <button class="lv-btn lv-btn--primary" style="width:100%" onclick={() => void startDrill("wrong")}><Icon name="rotate" size={15} /> {t("wrongbook.strategy.weighted")}</button>
                <button class="lv-btn" style="width:100%" onclick={() => { filterWrong = true; view = "browse"; void loadQuestions(); }}><Icon name="table" size={15} /> {t("wrongbook.strategy.browse")}</button>
                <button class="lv-btn" style="width:100%" disabled={!cramCount} title={!cramCount ? t("state.noCram") : ""} onclick={() => void startDrill("cram")}><Icon name="flame" size={15} /> {t("mode.cram")}{!cramCount ? ` (${t("state.noCram")})` : ""}</button>
              </div>
              <div class="divider" style="margin:12px 0 10px"></div>
              <button class="lv-btn lv-btn--ghost" style="width:100%;color:var(--lv-text-3)" disabled={!wrongList.length || bulkMasterBusy} onclick={() => void masterAllWrong()}>
                <Icon name="check" size={14} /> {bulkMasterBusy ? "…" : t("wrongbook.masterAll")}
              </button>
              <p class="lv-muted" style="font-size:var(--lv-font-size-caption);margin:10px 0 0">{t("wrongbook.strategy.note")}</p>
            </div>
            <div class="lv-card">
              <b class="lv-block-title">{t("wrongbook.rules")}</b>
              <div class="stack-sm" style="margin-top:10px;font-size:var(--lv-font-size-meta);color:var(--lv-text-3)">
                <span>{t("wrongbook.rule.eliminate")}</span>
                <span>{t("wrongbook.rule.reason")}</span>
                <span>{t("wrongbook.rule.dedup")}</span>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  {:else if view === "manual"}
    <!-- ===== S10 手工录题表单 ===== -->
    <div class="lv-pad">
      <div class="lv-screen-head"><span class="lv-eyebrow">{t("head.manual.eyebrow")}</span><h1 class="lv-h1">{t("head.manual.title")}</h1><p>{t("head.manual.desc")}</p></div>
      {@render studioNav()}
      <div class="lv-row">
        <button class="lv-btn lv-btn--ghost lv-mobile-back" onclick={() => view = "entry"}>← {t("mode.practice")}</button>
        <span class="lv-chip">{t("manual.title")}</span>
        {#if draftRestored}<span class="lv-chip lv-chip--amb">{t("manual.draftRestored")}</span>{/if}
        {#if mSaved}<span class="lv-chip lv-chip--grn num">✓ {mSaved}</span>{/if}
      </div>
      <div class="lv-studio-grid lv-studio-grid--manual">
      <div class="lv-card lv-pad-card lv-studio-form" data-manual-form>
        <div class="lv-row" role="group" aria-label={t("manual.type", "题型")}>
          <span class="lv-chip">{t("manual.type")}</span>
          {#each ["single", "multiple", "judge", "fill", "short"] as tt, _i (_i)}
            <button class="lv-chip" class:acc={mType === tt} aria-pressed={mType === tt} onclick={() => void switchManualType(tt as typeof mType)}>{t("qtype." + tt)}</button>
          {/each}
        </div>
        <div class="lv-field"><label class="lv-muted" for="lv-manual-stem">{t("manual.stem")}</label>
          <textarea id="lv-manual-stem" class="lv-input lv-textarea" bind:value={mStem} oninput={clearManualValidation} placeholder={t("manual.stemPlaceholder")} data-manual-field="stem" aria-invalid={manualErrorField === "stem" ? "true" : undefined} aria-describedby={manualErrorField === "stem" ? "manual-validation-error" : undefined}></textarea>
        </div>
        {#if mType === "single" || mType === "multiple"}
          <div class="lv-field" role="group" aria-label={t("manual.options")}>
            <span class="lv-muted">{t("manual.options")}</span>
            {#each mOptions as _opt, i (i)}
              <div class="lv-row" style="margin:4px 0">
                <button class="lv-chip" class:acc={mAnswer.includes(String.fromCharCode(65 + i))}
                  title={t("manual.setCorrect")} aria-label={`${t("manual.setCorrect")} ${String.fromCharCode(65 + i)}`} onclick={() => { clearManualValidation(); setCorrectOption(i); }} data-manual-field={i === 0 ? "answer" : undefined} aria-pressed={mAnswer.includes(String.fromCharCode(65 + i))} aria-describedby={manualErrorField === "answer" && i === 0 ? "manual-validation-error" : undefined}>{String.fromCharCode(65 + i)}</button>
                <input class="lv-input" style="flex:1" bind:value={mOptions[i]} oninput={clearManualValidation} aria-label={`${t("manual.options")} ${String.fromCharCode(65 + i)}`} data-manual-field={`option-${i}`} aria-invalid={manualErrorField === `option-${i}` ? "true" : undefined} aria-describedby={manualErrorField === `option-${i}` ? "manual-validation-error" : undefined} />
                {#if mOptions.length > 2}
                  <button class="lv-btn lv-btn--ghost sm" aria-label={`${t("manual.removeOption", "删除选项")} ${String.fromCharCode(65 + i)}`} title={`${t("manual.removeOption", "删除选项")} ${String.fromCharCode(65 + i)}`} onclick={() => { const next = removeChoiceOption(mType, mOptions, mAnswer, i); mOptions = next.options; mAnswer = next.answer; }}>✕</button>
                {/if}
              </div>
            {/each}
            {#if mOptions.length < 6}
              <button class="lv-btn sm" style="border-style:dashed" onclick={() => mOptions = [...mOptions, ""]}>＋ {t("manual.addOption")}</button>
            {/if}
          </div>
        {:else if mType === "judge"}
          <div class="lv-row">
            <button class="lv-chip" class:acc={mAnswer === "对"} onclick={() => { clearManualValidation(); mAnswer = "对"; }} data-manual-field="answer" aria-pressed={mAnswer === "对"} aria-describedby={manualErrorField === "answer" ? "manual-validation-error" : undefined}>对</button>
            <button class="lv-chip" class:acc={mAnswer === "错"} onclick={() => { clearManualValidation(); mAnswer = "错"; }} aria-pressed={mAnswer === "错"}>错</button>
          </div>
        {:else}
          <!-- B1 编辑入口：填空/简答答案输入此前缺失（表单无法完成填空录题）；多空/数值自动识别 -->
          <div class="lv-field"><label class="lv-muted" for="lv-manual-answer">{t("manual.answer")}</label>
            <textarea id="lv-manual-answer" class="lv-input lv-textarea" style="min-height:44px" bind:value={mAnswer} oninput={clearManualValidation}
              placeholder={t("manual.answerHint")} data-manual-field="answer" aria-invalid={manualErrorField === "answer" ? "true" : undefined} aria-describedby={manualErrorField === "answer" ? "manual-validation-error" : undefined}></textarea>
          </div>
          {#if mType === "fill"}
            <!-- 54-02 作者设置：数值判分规格（可折叠；留空=自动识别/exact） -->
            <div class="lv-row" style="margin:4px 0 0">
              <button class="lv-btn sm lv-btn--ghost" onclick={() => (mSpecOpen = !mSpecOpen)}>
                {t("spec.authorSection")}{#if mSpecOpen} ▾{/if}
              </button>
            </div>
            {#if mSpecOpen}
              <div class="lv-row" style="margin:4px 0 0;align-items:flex-end">
                <label class="lv-field" style="max-width:160px"><span class="lv-muted">{t("spec.unit")}</span>
                  <input class="lv-input" bind:value={mSpecUnit} placeholder="m/s" />
                </label>
                <label class="lv-field" style="max-width:150px"><span class="lv-muted">{t("spec.absTol")}</span>
                  <input class="lv-input num" bind:value={mSpecAbsTol} placeholder="0.5" inputmode="decimal" />
                </label>
                <label class="lv-field" style="max-width:150px"><span class="lv-muted">{t("spec.relPct")}</span>
                  <input class="lv-input num" bind:value={mSpecRelPct} placeholder="5" inputmode="decimal" />
                </label>
                <label class="lv-field" style="flex:1;min-width:180px"><span class="lv-muted">{t("spec.altUnits")}</span>
                  <input class="lv-input" bind:value={mSpecAltUnits} placeholder="km/h, cm/s" />
                </label>
              </div>
            {/if}
          {/if}
        {/if}
        <div class="lv-field"><label class="lv-muted" for="lv-manual-analysis">{t("manual.analysis")}</label>
          <textarea id="lv-manual-analysis" class="lv-input lv-textarea" style="min-height:52px" bind:value={mAnalysis}></textarea>
        </div>
        <div class="lv-row">
          <label class="lv-chip" for="lv-manual-kp">{t("manual.kp")}</label><input id="lv-manual-kp" class="lv-input" style="max-width:180px" bind:value={mKp} placeholder={t("manual.kpHint")} />
          <label class="lv-chip" for="lv-manual-source">{t("manual.source")}</label><input id="lv-manual-source" class="lv-input" style="max-width:160px" bind:value={mSource} placeholder={t("manual.sourceHint")} />
          <label class="lv-chip" for="lv-manual-group">{t("manual.group")}</label><input id="lv-manual-group" class="lv-input num" style="max-width:200px" bind:value={mGroup} placeholder="grp-…" />
        </div>
        <div class="lv-row">
          {#if manualErrorMsg}<p class="lv-error" id="manual-validation-error" role="alert">{manualErrorMsg}</p>{/if}
          <button class="lv-btn lv-btn--primary" onclick={saveManual} disabled={mSaving || !mStem.trim() || !mAnswer.trim()}>
            {mSaving ? "…" : t("manual.save")}
          </button>
          <button class="lv-btn lv-btn--ghost" onclick={blankManualDraft} disabled={mSaving || (!mStem && !mAnswer && !mAnalysis)} title={t("manual.blankTitle", "清空并开始录入新题")}>
            {t("manual.blank", "换一道新题")}
          </button>
          {#if mSaved}<span class="lv-muted">{t("manual.savedHint")}</span>{/if}
        </div>
      </div>
      <section class="lv-card lv-pad-card lv-preview-card" aria-live="polite">
        <div class="lv-section-head">
          <div>
            <span class="lv-eyebrow">{t("manual.title")}</span>
            <h2>实际题面预览</h2>
          </div>
          <span class="lv-chip lv-chip--acc">同步预览</span>
        </div>
        <div class="lv-preview-face">
          <span class="lv-chip lv-chip--acc">{t("qtype." + mType)}</span>
          <h3>{mStem.trim() || t("manual.stemPlaceholder")}</h3>
          {#if mType === "single" || mType === "multiple"}
            <div class="lv-preview-options">
              {#each mOptions as option, i (i)}
                <div class="lv-preview-option" class:selected={mAnswer.includes(String.fromCharCode(65 + i))}>
                  <span class="lv-preview-key">{String.fromCharCode(65 + i)}</span>
                  <span>{option.trim() || "待填写选项"}</span>
                </div>
              {/each}
            </div>
          {:else if mType === "judge"}
            <div class="lv-preview-options">
              {#each ["对", "错"] as option (option)}
                <div class="lv-preview-option" class:selected={mAnswer === option}>
                  <span class="lv-preview-key">{option}</span><span>{option === "对" ? "正确" : "错误"}</span>
                </div>
              {/each}
            </div>
          {:else if mType === "fill"}
            {@const isMulti = mAnswer.includes(";;")}
            {@const blanks = isMulti ? mAnswer.split(";;").map((b) => b.trim()).filter(Boolean) : [mAnswer.trim()]}
            <div class="lv-preview-fill">
              {#if isMulti}
                <div class="lv-preview-blanks">
                  {#each blanks as _blank, bi (bi)}
                    <div class="lv-preview-blank-row">
                      <span class="lv-preview-key">{bi + 1}</span>
                      <input class="lv-input" placeholder={`空 ${bi + 1}`} disabled />
                    </div>
                  {/each}
                </div>
                <div class="lv-preview-spec-hint">逐空判分 · {blanks.length} 个空，按题目顺序分别核对</div>
              {:else}
                <div class="lv-preview-blank-row">
                  <input class="lv-input" placeholder={mStem.includes("____") ? "填写划线处内容" : "填写答案"} disabled />
                  {#if mSpecUnit}<span class="lv-chip num">{mSpecUnit}</span>{/if}
                </div>
                {#if mSpecOpen || mSpecUnit || mSpecAbsTol || mSpecRelPct}
                  <div class="lv-preview-spec-hint">
                    数值判分 · 单位：{mSpecUnit || "无"} · 绝对容差：±{mSpecAbsTol || "0"} · 相对容差：{mSpecRelPct ? `${mSpecRelPct}%` : "无"}
                  </div>
                {/if}
              {/if}
            </div>
          {:else if mType === "short"}
            <div class="lv-preview-short">
              <textarea class="lv-input lv-textarea" rows="3" placeholder="考生作答文本框（解答题提交后进入自评）" disabled></textarea>
            </div>
          {/if}
          <div class="lv-preview-answer">
            <strong>{mType === "short" ? "参考要点" : "参考答案"}</strong>
            <p>{mType === "single" || mType === "multiple" ? mAnswer.split("").map((letter) => `${letter}. ${mOptions[letter.charCodeAt(0) - 65] ?? ""}`).join("；") || t("manual.answerHint") : mAnswer.trim() || t("manual.answerHint")}</p>
            {#if mAnalysis.trim()}<small>{mAnalysis}</small>{/if}
          </div>
          {#if mKp.trim() || mSource.trim()}<div class="lv-preview-meta"><span>{mKp.trim() || t("manual.kp")}</span><span>{mSource.trim() || t("manual.source")}</span></div>{/if}
        </div>
        <p class="lv-muted lv-preview-note">编辑左侧内容，右侧会同步展示用户实际看到的题面。</p>
      </section>
      </div>
    </div>
  {:else if view === "ai"}
    <!-- ===== S11 AI 出题（Inbox 式：永不直接入库） ===== -->
    <div class="lv-pad">
      <div class="lv-screen-head"><span class="lv-eyebrow">{t("head.ai.eyebrow")}</span><h1 class="lv-h1">{t("head.ai.title")}</h1><p>{t("head.ai.desc")}</p></div>
      {@render studioNav()}
      {#if aiError}<div class="lv-error" role="alert">{aiError}</div>{/if}
      <div class="lv-row">
        <button class="lv-btn lv-btn--ghost lv-mobile-back" onclick={() => view = "entry"}>← {t("mode.practice")}</button>
        <span class="lv-chip"><Icon name="sparkles" size={12} /> {t("ai.title")}</span>
        <span class="fn__flex-1"></span>
        {#if aiCustomEndpointSet}
          <span class="lv-chip lv-chip--amb" title={t("ai.endpointTitle") + " · " + t("setting.aiEndpoint.desc")}>{t("ai.channel.openai")}</span>
        {:else}
          <span class="lv-chip lv-chip--grn" title={t("ai.endpointTitle")}>{t("ai.channel.siyuan")}</span>
        {/if}
      </div>
      <div class="lv-studio-grid lv-studio-grid--ai">
      <div class="lv-card lv-pad-card lv-ai-source-card">
        <div class="lv-section-head">
          <div><span class="lv-eyebrow">材料</span><h2>{t("ai.source")}</h2></div>
          <span class="lv-chip">{aiSource.length} 字</span>
        </div>
        <div class="lv-field"><span class="lv-muted">{t("ai.source")}</span>
          <button class="lv-chip" title={t("ai.fromDocTitle")} onclick={aiSourceFromCurrentDoc}><Icon name="file-text" size={13} /> {t("ai.fromDoc")}</button>
          {#if aiSourceOrigin}<div class="lv-muted" style="font-size:var(--lv-font-size-caption);margin:4px 0" aria-live="polite">{aiSourceOrigin}</div>{/if}
          <textarea class="lv-input lv-textarea" rows="7" bind:value={aiSource} oninput={() => aiSourceOrigin = ""} placeholder={t("ai.sourcePlaceholder")} aria-label={t("ai.source")}></textarea>
          {#if gleanAvailable}
            <!-- 60-01 lite：拾遗稍后读 → 出题素材（只读；不写拾遗状态） -->
            <div class="lv-row" style="margin:4px 0 0">
                <button class="lv-btn sm lv-btn--ghost" disabled={gleanBusy} aria-busy={gleanBusy} onclick={() => void importGleanClips()}>
                  <Icon name="book" size={14} /> {gleanBusy ? "…" : t("ai.gleanLater")}
                </button>
              <span class="lv-muted" style="font-size:var(--lv-font-size-caption)">{t("ai.gleanHint")}</span>
            </div>
            {#if gleanError}
              <div class="lv-error" role="alert" style="display:flex;align-items:center;justify-content:space-between;gap:var(--lv-space-relaxed);overflow-wrap:anywhere">
                <span>{gleanError}</span>
                <button class="lv-btn sm" disabled={gleanBusy || gleanDoneBusy} onclick={() => gleanErrorAction === "mark" ? void markGleanDone() : void importGleanClips()}>{t("ai.gleanRetry")}</button>
              </div>
            {/if}
            {#if gleanPendingDone.length && aiQueue.length}
              <!-- 60-01 写方向：出题成功后一键标记素材已读（需拾遗侧开启协同写入） -->
              <div class="lv-row" style="margin:6px 0 0">
                <button class="lv-btn sm" disabled={gleanDoneBusy} aria-busy={gleanDoneBusy} onclick={() => void markGleanDone()}>
                  ✓ {gleanDoneBusy ? "…" : t("ai.gleanMarkDone").replace("{n}", String(gleanPendingDone.length))}
                </button>
                {#if gleanDoneNote}<span class="lv-muted" style="font-size:var(--lv-font-size-caption)">{gleanDoneNote}</span>{/if}
              </div>
            {/if}
          {/if}
        </div>
        <div class="lv-row">
          <span class="lv-chip">{t("ai.count")}</span>
          {#each [3, 5, 10, 20] as n, _i (_i)}
            <button class="lv-chip" class:acc={aiCount === n} onclick={() => aiCount = n}>{n}</button>
          {/each}
          <span class="lv-chip">{t("ai.difficulty")}</span>
          {#each ["easy", "medium", "hard", "mixed"] as d, _i (_i)}
            <button class="lv-chip" class:acc={aiDifficulty === d} onclick={() => aiDifficulty = d as any}>{t("ai.diff." + d)}</button>
          {/each}
        </div>
        <div class="lv-row">
          <span class="lv-chip">{t("ai.preset")}</span>
          {#each ["default", "gongkao", "kaoyan", "yixue", "jiakao"] as p, _i (_i)}
            <button class="lv-chip" class:acc={aiPreset === p} onclick={() => aiPreset = p as any}>{p === "default" ? t("ai.preset.default") : { gongkao: t("ai.preset.gongkao"), kaoyan: t("ai.preset.kaoyan"), yixue: t("ai.preset.yixue"), jiakao: t("ai.preset.jiakao") }[p as string]}</button>
          {/each}
        </div>
        <div class="lv-row">
          <span class="lv-chip">{t("ai.quality")}</span>
          <button class="lv-chip" class:acc={aiQuality === "standard"} onclick={() => aiQuality = "standard"}>{t("ai.quality.standard")}</button>
          <button class="lv-chip" class:acc={aiQuality === "economy"} onclick={() => aiQuality = "economy"}>{t("ai.quality.economy")}</button>
        </div>
        <div class="lv-row">
          <span class="lv-chip">{t("manual.kp")}</span>
          <input class="lv-input" style="max-width:200px" bind:value={aiKp} placeholder={t("ai.kpHint")} />
        </div>
        <div class="lv-row">
          <span class="lv-chip">{t("ai.customHint")}</span>
          <input class="lv-input" style="flex:1;min-width:200px" bind:value={aiCustomHint} placeholder={t("ai.customHintHint")} />
        </div>
        <div class="lv-row">
        <button class="lv-btn lv-btn--primary" onclick={runAiGenerate} disabled={aiMutationBusy || !aiSource.trim() || !hasBank} title={!hasBank ? t("guard.needBankFirst") : t("ai.generate")}>
          {aiBusy ? t("ai.generating") : t("ai.generate")}
        </button>
        {#if aiBusy || aiRegenBusy}
          <button class="lv-btn sm" onclick={cancelAiGenerate}>✕ {t("ai.cancel")}</button>
        {/if}
          <span class="lv-muted">{t("ai.pipelineNote")}</span>
          {#if aiUsageTotal}<span class="lv-chip num" title={t("ai.usageTitle")}>Σ ≈{aiUsageTotal.totalTokens} tok · {aiUsageTotal.totalCalls} {t("ai.usageCalls")}</span>{/if}
        </div>
      </div>
      <section class="lv-ai-review">
        <div class="lv-section-head">
          <div><span class="lv-eyebrow">审核工作区</span><h2>{t("ai.queue")}</h2></div>
          {#if aiQueue.length}<span class="lv-chip lv-chip--acc num">{aiQueue.length} 待审核</span>{/if}
        </div>
        {#if aiQueueBankId && (aiQueue.length || aiRejected.length)}
          <p class="lv-muted" role="status">{t("ai.queueTarget").replace("{name}", banks.find((b) => b.id === aiQueueBankId)?.name ?? aiQueueBankId)}</p>
          {#if aiQueueBankId !== activeBankId}<div class="lv-error">{t("ai.queueWrongBank")}</div>{/if}
        {/if}
        {#if aiQueue.length || aiRejected.length || aiDuplicates || aiCost}
        <div class="lv-row" style="margin-top:14px">
          <b style="font-size:var(--lv-font-size-md)">{t("ai.queue")}</b>
          <span class="lv-chip lv-chip--acc num">{aiQueue.length}</span>
          {#if aiRejected.length}<span class="lv-chip lv-chip--red num">✕ {aiRejected.length}</span>{/if}
          {#if aiDuplicates}<span class="lv-chip lv-chip--amb num">⧉ {aiDuplicates}</span>{/if}
          {#if aiCost}<span class="lv-chip num">{aiCost}</span>{/if}
          <span class="fn__flex-1"></span>
          {#if aiRejected.length}
            <button class="lv-btn sm" onclick={retryRejected} disabled={aiMutationBusy || (!!aiQueueBankId && aiQueueBankId !== activeBankId)} title={t("ai.retryTitle")}><Icon name="rotate" size={13} /> {t("ai.retryRejected")}（{aiRejected.length}）</button>
          {/if}
          {#if aiQueue.length}
            <button class="lv-btn lv-btn--primary sm" onclick={approveAllAi} disabled={aiMutationBusy || !hasBank || (!!aiQueueBankId && aiQueueBankId !== activeBankId)}>✓ {t("ai.approveAll")}（{aiQueue.length}）</button>
          {/if}
        </div>
        {#if aiSaved}<div class="lv-success num">✓ {t("ai.saved")} {aiSaved}</div>{/if}
        {#each aiQueue as q (q.id)}
          <div class="lv-card lv-qrow">
            <div class="lv-qrow-head">
              <span class="lv-chip lv-chip--acc">{t("qtype." + q.type)}</span>
              {#if q.kp}<span class="lv-chip">{q.kp}</span>{/if}
              <span class="lv-muted lv-qrow-src">{t("ai.pendingBadge")}</span>
            </div>
            {#if editingAiId === q.id && aiEditDraft}
              <div class="lv-row" style="margin:6px 0 0"><input class="lv-input" bind:value={aiEditDraft.stem} placeholder={t("manual.stem")} /></div>
              {#each aiEditDraft.options as _opt, i (i)}
                <div class="lv-row" style="margin:4px 0 0">
                  <span class="lv-chip num">{String.fromCharCode(65 + i)}</span>
                  <input class="lv-input" bind:value={aiEditDraft.options[i]} />
                  <button class="lv-btn sm lv-btn--ghost" title={t("manual.setCorrect")} onclick={() => { aiEditDraft.answer = String.fromCharCode(65 + i); }}>✓</button>
                </div>
              {/each}
              <div class="lv-row" style="margin:4px 0 0">
                <span class="lv-chip">{t("browse.answer")}</span>
                <input class="lv-input" style="max-width:120px" bind:value={aiEditDraft.answer} />
                <input class="lv-input" style="flex:1" bind:value={aiEditDraft.analysis} placeholder={t("manual.analysis")} />
              </div>
              {#if aiEditError}<div class="lv-error">{aiEditError}</div>{/if}
              <div class="lv-row" style="margin:8px 0 0">
                <button class="lv-btn sm lv-btn--primary" onclick={() => saveEditAi(q)}>✓ {t("ai.editSave")}</button>
                <button class="lv-btn sm lv-btn--ghost" onclick={cancelEditAi}>{t("ai.editCancel")}</button>
              </div>
            {:else}
              <div class="lv-qrow-stem">{q.stem}</div>
              {#if q.options.length}
                <div class="lv-muted" style="margin-top:4px">{q.options.map((o, i) => String.fromCharCode(65 + i) + ". " + o).join("　")}</div>
              {/if}
              <div class="lv-row" style="margin:6px 0;align-items:center;gap:var(--lv-space-compact);flex-wrap:wrap">
                <span class="lv-chip lv-chip--acc num"><b>{t("browse.answer")}:</b> {q.answer}</span>
                {#if q.difficulty}<span class="lv-chip num">★ {q.difficulty}</span>{/if}
              </div>
              <div class="lv-analysis" style="margin:8px 0 0">{q.analysis}</div>
              <div class="lv-row" style="margin:8px 0 0">
                <button class="lv-btn sm lv-btn--primary" onclick={() => approveAi(q)} disabled={aiMutationBusy || !hasBank || (!!aiQueueBankId && aiQueueBankId !== activeBankId)}>✓ {t("ai.approve")}</button>
                <button class="lv-btn sm" onclick={() => startEditAi(q)} disabled={aiMutationBusy}>✎ {t("ai.edit")}</button>
                <button class="lv-btn sm" disabled={aiMutationBusy || (!!aiQueueBankId && aiQueueBankId !== activeBankId)} onclick={() => regenOneAi(q)}><Icon name="rotate" size={13} /> {aiRegenBusy === q.id ? "…" : t("ai.regen")}</button>
                <button class="lv-btn sm lv-btn--ghost" onclick={() => dropAi(q)} disabled={aiMutationBusy}>✕ {t("ai.drop")}</button>
              </div>
            {/if}
          </div>
        {/each}
        {#each aiRejected.slice(0, 10) as rj, _i (_i)}
          <div class="lv-error-row"><b class="num">#{rj.index}</b> {rj.reason}</div>
        {/each}
        {#if aiTaskLog.length}
          <details class="lv-card lv-pad-card" style="padding: var(--lv-space-3) var(--lv-space-4);margin-top:14px">
            <summary style="cursor:pointer;font-weight:var(--lv-font-weight-semibold)">✚ {t("ai.taskLog")}（{aiTaskLog.length}）</summary>
            <p class="lv-muted" style="margin:6px 0 0">{t("ai.taskLogHint")}</p>
            {#each [...aiTaskLog].reverse().slice(0, 5) as e, _i (_i)}
              <div class="lv-row" style="margin:8px 0 0">
                <span class="lv-chip num">{new Date(e.at).toLocaleTimeString()}</span>
                <span class="lv-chip num">{e.templateId}</span>
                <span class="lv-chip num" class:lv-chip--red={e.status !== "ok"}>{e.status}</span>
                <span class="lv-chip num">≈{e.tokens} tok</span>
              </div>
              <details style="margin:2px 0 0 8px">
                <summary class="lv-muted" style="cursor:pointer;font-size:var(--lv-font-size-caption)">{t("ai.taskLogPayload")}</summary>
                {#each e.messages as m, _i (_i)}
                  <pre class="lv-muted num" style="white-space:pre-wrap;font-size:var(--lv-font-size-label);margin:4px 0">[{m.role}] {m.content.slice(0, 400)}{m.content.length > 400 ? "…" : ""}</pre>
                {/each}
              </details>
            {/each}
          </details>
        {/if}
        {:else}
          <div class="lv-card lv-ai-empty">
            <div class="lv-empty-icon"><Icon name="sparkles" size={22} /></div>
            <b>{aiBusy ? t("ai.generating") : "候选题会显示在这里"}</b>
            <p class="lv-muted">先整理本次材料并设置题型、数量和难度；生成结果需要逐题审核后才会写入题库。</p>
          </div>
      {/if}
      </section>
      </div>
    </div>
  {:else if view === "materials"}
    <!-- ===== 学习资料（120-01/02/06 lite）：登记 / 列表 / 最低查看 ===== -->
    <div class="lv-pad">
      <div class="lv-screen-head"><span class="lv-eyebrow">{t("head.materials.eyebrow")}</span><h1 class="lv-h1">{t("head.materials.title")}</h1><p>{t("head.materials.desc")}</p></div>
      {@render studioNav()}
      <div class="lv-row">
        <button class="lv-btn lv-btn--ghost lv-mobile-back" onclick={() => view = "entry"}>← {t("import.back")}</button>
        <b><Icon name="book" size={15} /> {t("materials.title")}</b>
        {#if app.materialsReadonly}<span class="lv-chip lv-chip--amb">{t("materials.readonly")}</span>{/if}
        <span class="lv-chip num">{materialsList.length}</span>
      </div>
      <div class="lv-card" style="margin-top:10px">
        <div class="lv-row">
          <label class="lv-btn" class:disabled={materialsBusy || offline || app.materialsReadonly} style={(materialsBusy || offline || app.materialsReadonly) ? "opacity:.62;cursor:not-allowed;pointer-events:none" : ""} aria-disabled={materialsBusy || offline || app.materialsReadonly} title={app.materialsReadonly ? t("materials.readonly") : offline ? t("state.offlineHint") : ""}>
            <Icon name="paperclip" size={14} /> {t("materials.pickFile")}
            <input type="file" accept=".pdf,.mp4,.webm,.m4v,.mp3,.m4a,.wav,.ogg,.png,.jpg,.jpeg,.gif,.webp,.md,.txt,.docx,.epub" style="display:none" onchange={onMaterialFile} disabled={materialsBusy || offline || app.materialsReadonly} />
          </label>
          <span class="lv-muted">{t("materials.copyHint")}</span>
        </div>
        <div class="lv-row">
          <span class="lv-chip"><Icon name="link" size={12} /> {t("materials.link")}</span>
          <input class="lv-input" style="flex:1;min-width:200px" placeholder="https://…" bind:value={matLink} disabled={materialsBusy} />
          <input class="lv-input" style="max-width:150px" placeholder={t("materials.linkTitle")} bind:value={matLinkTitle} disabled={materialsBusy} />
          <button class="lv-btn" onclick={registerMaterialLink} disabled={materialsBusy || offline || app.materialsReadonly || !matLink.trim()} title={app.materialsReadonly ? t("materials.readonly") : ""}>{t("materials.register")}</button>
        </div>
        <div class="lv-row lv-muted" style="font-size:var(--lv-font-size-label)">
          <span>{t("materials.meta")}</span>
          <input class="lv-input" style="max-width:150px" placeholder={t("materials.subject")} bind:value={matSubject} disabled={materialsBusy || app.materialsReadonly} />
          <input class="lv-input" style="max-width:150px" placeholder={t("materials.chapter")} bind:value={matChapter} disabled={materialsBusy || app.materialsReadonly} />
          <span class="fn__flex-1"></span>
          <!-- 六七批：资料搜索（标题/科目/章节/位置） -->
          <input class="lv-input" style="max-width:200px" placeholder={t("materials.search")} bind:value={materialsSearch} disabled={materialsBusy} />
        </div>
        {#if offline}<div class="lv-muted">⚠ {t("materials.offlineNote")}</div>{/if}
        {#if materialsNote}<div class="lv-row"><span class="lv-chip">{materialsNote}</span></div>{/if}
      </div>
      {#if materialsList.length === 0}
        <div class="lv-empty"><div class="lv-empty-icon"><Icon name="book" size={24} /></div><b>{t("materials.title")}</b><p class="lv-muted">{t("materials.empty")}</p></div>
      {:else if materialsFiltered.length === 0}
        <div class="lv-empty">{t("materials.noMatch")}</div>
      {:else}
        <div class="lv-materials-workspace">
          <aside class="lv-card lv-material-list" aria-label={t("materials.title")}>
            <div class="lv-section-head"><div><span class="lv-eyebrow">资料库</span><h2>{t("materials.title")}</h2></div><span class="lv-chip num">{materialsFiltered.length}</span></div>
            {#each materialsFiltered as m (m.id)}
              <button class="lv-material-item" class:selected={selectedMaterial?.id === m.id} aria-current={selectedMaterial?.id === m.id ? "true" : undefined} disabled={materialsBusy} aria-disabled={materialsBusy} onclick={() => { if (!materialsBusy) selectedMaterialId = m.id; }}>
                <span class="lv-material-icon"><Icon name={matIconName(m.kind)} size={15} /></span>
                <span class="lv-material-copy"><b>{m.title}</b><small>{[m.subject, m.chapter, t("mkind." + m.kind)].filter(Boolean).join(" · ")}</small></span>
                <span class="lv-material-count num">{app.listMaterialNotes(m.id).length}</span>
              </button>
            {/each}
          </aside>
          {#if selectedMaterial}
            {@const m = selectedMaterial}
            <section class="lv-card lv-material-detail" aria-busy={materialsBusy}>
              <div class="lv-section-head">
                <div><span class="lv-eyebrow">资料详情</span><h2>{m.title}</h2></div>
                <span class="lv-chip">{t("mkind." + m.kind)}</span>
              </div>
              <div class="lv-row lv-material-tags">
                {#if m.subject}<span class="lv-chip">{m.subject}</span>{/if}
                {#if m.chapter}<span class="lv-chip">{m.chapter}</span>{/if}
                <span class="lv-chip num">v{m.revision}</span>
                {#if app.listQuestionRefs(m.id).length}<span class="lv-chip num" title={t("qref.linkedTip")}><Icon name="link" size={11} /> {t("qref.linkedCount").replace("{n}", String(app.listQuestionRefs(m.id).length))}</span>{/if}
              </div>
              <div class="lv-material-locations">
                <b>{t("materials.meta")}</b>
                {#each m.locations as l, _li (_li)}
                  <div class="lv-material-location"><Icon name={l.kind === "assets" ? matIconName(m.kind) : "link"} size={13} /><span>{l.path}</span></div>
                {/each}
              </div>
              <div class="lv-row lv-material-actions">
                <button class="lv-btn lv-btn--primary sm" onclick={() => openMaterial(m)}><Icon name="external-link" size={13} /> {t("materials.open")}</button>
                <button class="lv-btn sm" aria-expanded={notesOpenId === m.id} onclick={() => toggleNotes(m)} disabled={materialsBusy}><Icon name="pencil" size={13} /> {t("materials.notes")}（<span class="num">{app.listMaterialNotes(m.id).length}</span>）</button>
                <button class="lv-btn sm lv-btn--ghost" onclick={() => bridgeMaterialToManual(m)} title="把当前资料来源带入手工录题"><Icon name="edit" size={13} /> {t("materials.toManual", "带入录题")}</button>
                <button class="lv-btn sm lv-btn--ghost" onclick={() => bridgeMaterialToAi(m)} title="把当前资料与笔记带入 AI 出题"><Icon name="sparkles" size={13} /> {t("materials.toAi", "带入 AI")}</button>
                <button class="lv-btn sm lv-btn--ghost" onclick={() => void removeMaterialEntry(m)} disabled={materialsBusy || app.materialsReadonly} title={app.materialsReadonly ? t("materials.readonly") : t("materials.removeTitle")}><Icon name="trash" size={13} /></button>
              </div>
              {#if notesOpenId === m.id}
                <div class="lv-material-notes">
                  <div class="lv-section-head"><div><span class="lv-eyebrow">整理与回忆</span><h2>{t("materials.notes")}</h2></div></div>
                  {#each notesCache as n (n.id)}
                    <div class="lv-material-note">
                      <div class="lv-row" style="margin:0;gap:var(--lv-space-1);flex-wrap:wrap">
                        {#if n.locator}<span class="lv-chip num">{locatorLabel(n.locator)}</span>{/if}
                        {#if needsRelocate(n, m.revision)}<span class="lv-chip lv-chip--amb" title={t("materials.relocateTip")}>{t("materials.relocate")}</span>{/if}
                        {#each n.tags as tg (tg)}<span class="lv-chip num" style="font-size:10px">#{tg}</span>{/each}
                      </div>
                      {#if n.locator}<button class="lv-btn sm lv-btn--ghost" onclick={() => openMaterialAt(m, n)}><Icon name="external-link" size={12} /> {t("materials.openAt")}</button>{/if}
                      <div class="lv-material-note-text">{n.text}</div>
                      <div class="lv-row">
                        <button class="lv-btn sm lv-btn--ghost" onclick={() => bridgeMaterialToManual(m, n.text)} title="用本条笔记作为题干草稿"><Icon name="edit" size={12} /> {t("materials.noteToQuestion", "用此笔记出题")}</button>
                        <button class="lv-btn sm lv-btn--ghost" onclick={() => void startEditNote(n)} disabled={materialsBusy || app.materialsReadonly}><Icon name="pencil" size={12} /> {t("materials.noteEdit")}</button>
                        <button class="lv-btn sm lv-btn--ghost" onclick={() => void removeNoteEntry(m, n)} disabled={materialsBusy || app.materialsReadonly}><Icon name="trash" size={13} /> {t("materials.removeTitle")}</button>
                      </div>
                    </div>
                  {/each}
                  {#if !notesCache.length}<div class="lv-muted lv-material-note-empty">{t("materials.noteEmpty")}</div>{/if}
                  <div class="lv-row" style="margin:12px 0 4px"><b class="lv-muted" style="font-size:var(--lv-font-size-sm)">{noteEditingId ? t("materials.noteEdit") : t("materials.noteAdd")}</b></div>
                  <div class="lv-row" style="flex-wrap:wrap">
                    {#if m.kind === "pdf"}<input class="lv-input" style="max-width:90px" placeholder={t("materials.page")} bind:value={notePage} disabled={materialsBusy || app.materialsReadonly} />{:else if m.kind === "video" || m.kind === "audio"}<input class="lv-input" style="max-width:110px" placeholder="mm:ss" bind:value={noteTime} disabled={materialsBusy || app.materialsReadonly} />{/if}
                    <input class="lv-input" style="flex:1;min-width:160px" placeholder={t("materials.quote")} bind:value={noteQuote} disabled={materialsBusy || app.materialsReadonly} />
                  </div>
                  <textarea class="lv-input lv-textarea" rows="3" placeholder={t("materials.notePlaceholder")} bind:value={noteText} disabled={materialsBusy || app.materialsReadonly}></textarea>
                  <div class="lv-row"><input class="lv-input" style="flex:1;min-width:160px" placeholder={t("materials.tagsPlaceholder")} bind:value={noteTags} disabled={materialsBusy || app.materialsReadonly} /><button class="lv-btn lv-btn--primary sm" onclick={() => void saveNote(m)} disabled={!noteText.trim() || materialsBusy || app.materialsReadonly}>{noteEditingId ? t("materials.noteUpdate") : t("materials.noteAddBtn")}</button>{#if noteEditingId}<button class="lv-btn sm lv-btn--ghost" onclick={resetNoteForm} disabled={materialsBusy}>{t("edit.cancel")}</button>{/if}</div>
                  {#if noteDirty}<p class="lv-muted" role="status">{t("materials.noteDraftHint")}</p>{/if}
                  {#if noteFormError}<div class="lv-error">{noteFormError}</div>{/if}
                </div>
              {/if}
            </section>
          {/if}
        </div>
      {/if}
    </div>
  {:else if view === "browse"}
    <!-- ===== S3 浏览 ===== -->
    <div class="lv-pad">
      <div class="lv-screen-head"><span class="lv-eyebrow">{t("head.browse.eyebrow")}</span><h1 class="lv-h1">{t("head.browse.title")}</h1><p>{t("head.browse.desc")}</p></div>
      <!-- 工具条分行（原型密度规则）：筛选行（搜索/结构化筛选）与工具行（动作 chip）分离，高度节奏一致 -->
      <div class="lv-row" style="margin:0 0 8px">
        <input class="lv-input" style="flex:1;min-width:160px" placeholder={t("browse.searchPlaceholder")} bind:value={searchText} />
        <!-- 65-01 lite：结构化筛选（题型/来源/仅错题），与搜索词叠加 -->
        <select class="lv-select" style="max-width:110px" bind:value={filterType} onchange={() => (browseLimit = 200)}>
          <option value="">{t("browse.fAnyType")}</option>
          {#each ["single", "multiple", "judge", "fill", "short", "material"] as tp, _i (_i)}
            <option value={tp}>{t("qtype." + tp)}</option>
          {/each}
        </select>
        {#if sourceOptions.length}
          <select class="lv-select" style="max-width:130px" bind:value={filterSource} onchange={() => (browseLimit = 200)} title={t("browse.fSource")}>
            <option value="">{t("browse.fAnySource")}</option>
            {#each sourceOptions as src, _i (_i)}<option value={src}>{src}</option>{/each}
          </select>
        {/if}
        <button class="lv-chip" class:acc={filterWrong} onclick={() => (filterWrong = !filterWrong)} title={t("browse.fWrongTip")}>✕ {t("browse.fWrong")}</button>
        <button class="lv-chip" class:acc={filterHelp} onclick={() => (filterHelp = !filterHelp)} title={t("browse.fHelpTip")}><Icon name="bulb" size={12} /> {t("browse.fHelp")}</button>
        <button class="lv-chip" class:acc={favOnly} onclick={() => favOnly = !favOnly}><Icon name="star" size={12} /> {t("browse.favOnly")}</button>
        <select class="lv-select" style="max-width:110px" bind:value={filterDays} title={t("browse.fDaysTip")}>
          <option value={0}>{t("browse.fAnyDay")}</option>
          <option value={1}>{t("browse.fToday")}</option>
          <option value={7}>{t("browse.f7")}</option>
          <option value={30}>{t("browse.f30")}</option>
        </select>
        {#if smartViews.length}
          <select class="lv-select" style="max-width:150px" bind:value={selectedView} onchange={() => void applyNamedView(selectedView)} disabled={smartViewBusy || smartViewLoadBusy || smartViewLoadFailed}>
            <option value="">{t("view.pick")}</option>
            {#each smartViews as v, _i (_i)}<option value={v.name}>{v.name}</option>{/each}
          </select>
          <button class="lv-btn sm lv-btn--ghost" title={t("view.delete")} aria-label={t("view.delete")} aria-busy={smartViewBusy} disabled={!selectedView || smartViewBusy || smartViewLoadBusy || smartViewLoadFailed} onclick={() => void deleteNamedView()}><Icon name="trash" size={13} /></button>
        {/if}
        <button class="lv-btn sm lv-btn--ghost" title={t("view.saveTitle")} aria-busy={smartViewBusy} disabled={smartViewBusy || smartViewLoadBusy || smartViewLoadFailed || !activeBankId} onclick={() => void saveCurrentView()}><Icon name="save" size={13} /> {smartViewBusy ? "…" : t("view.save")}</button>
      </div>
          {#if smartViewError}<div class="lv-error" role="alert" style="display:flex;align-items:center;justify-content:space-between;gap:var(--lv-space-relaxed);overflow-wrap:anywhere"><span>{smartViewError}</span>{#if smartViewLoadFailed}<button class="lv-btn sm" disabled={smartViewLoadBusy} aria-busy={smartViewLoadBusy} onclick={() => void loadSmartViews()}>{smartViewLoadBusy ? "…" : t("view.retryLoad")}</button>{/if}</div>{/if}
      <!-- 工具行收敛：高频（章节树/批量编辑）内联，维护面板与导出打印入「更多」菜单；面板开启时按钮出点标 -->
      <div class="lv-row" style="margin:0 0 10px;gap:var(--lv-space-2) 8px">
        <button class="lv-btn lv-btn--ghost lv-mobile-back" onclick={() => view = "entry"}>← {t("mode.practice")}</button>
        <span class="lv-chip num">{shownQuestions.length}/{questions.length} {t("browse.count")}</span>
        <button class="lv-chip" class:acc={sectionOpen} onclick={() => void toggleSectionTree()}><Icon name="file-text" size={13} /> {t("browse.sectionTree")}</button>
        <button class="lv-chip" class:acc={batchMode} onclick={() => { batchMode = !batchMode; if (!batchMode) selectedIds = {}; }}>{t("batch.mode")}</button>
        <div class="lv-more" bind:this={moreRoot}>
          <button class="lv-chip" class:acc={kpOpen || healthOpen || errataOpen || paperOpen} aria-haspopup="menu" aria-expanded={moreOpen}
            onclick={() => toggleMore()}>
            <Icon name="menu" size={13} /> {t("browse.more")}{#if kpOpen || healthOpen || errataOpen || paperOpen}<i class="lv-more-dot" aria-hidden="true"></i>{/if}
          </button>
          {#if moreOpen}
            <div class="lv-more-pop" role="menu" tabindex="-1" bind:this={morePop}
              onkeydown={(e) => { if (e.key === "Escape") { e.stopPropagation(); moreOpen = false; } }}>
              <button role="menuitemcheckbox" aria-checked={kpOpen} onclick={() => { kpOpen = !kpOpen; moreOpen = false; }}><Icon name="compass" size={14} /> {t("kp.title")}</button>
              <button role="menuitemcheckbox" aria-checked={healthOpen} onclick={() => { healthOpen = !healthOpen; moreOpen = false; }}><Icon name="activity" size={14} /> {t("health.title")}</button>
              <button role="menuitemcheckbox" aria-checked={errataOpen} onclick={() => { errataOpen = !errataOpen; moreOpen = false; }}><Icon name="file-text" size={14} /> {t("errata.title")}</button>
              <button role="menuitemcheckbox" aria-checked={paperOpen} onclick={() => { paperOpen = !paperOpen; moreOpen = false; }}><Icon name="paperclip" size={14} /> {t("paper.title")}</button>
              <div class="lv-more-sep" role="separator"></div>
              <button role="menuitem" title={t("browse.exportCsvTitle")} onclick={() => { exportBankCsv(); moreOpen = false; }}><Icon name="export" size={14} /> CSV</button>
              <button role="menuitem" title={t("print.qSheetTip")} onclick={() => { printQuestionSheet(); moreOpen = false; }}><Icon name="printer" size={14} /> {t("print.qSheet")}</button>
              <button role="menuitem" title={t("print.aSheetTip")} onclick={() => { printAnswerSheet(); moreOpen = false; }}><Icon name="printer" size={14} /> {t("print.aSheet")}</button>
              <button role="menuitem" title={t("print.cardTip")} onclick={() => { printAnswerCard(); moreOpen = false; }}><Icon name="printer" size={14} /> {t("print.card")}</button>
            </div>
          {/if}
        </div>
      </div>
      {#if sectionSel}
        <div class="lv-row" style="margin:4px 0">
          <span class="lv-chip acc"><Icon name="file-text" size={12} /> {sectionLabel}</span>
          <button class="lv-btn sm lv-btn--ghost" onclick={() => { sectionSel = null; }}>{t("browse.sectionClear")}</button>
        </div>
      {/if}
      {#if sectionOpen}
        <div class="lv-card lv-pad-card" style="padding: var(--lv-space-3) var(--lv-space-4);max-height:260px;overflow:auto">
          <b style="font-size:var(--lv-font-size-body-compact)">{t("browse.sectionTree")}</b>
          {#if sectionBusy}<span class="lv-muted" style="margin-left:8px">…</span>{/if}
          {#if !sectionTree.length && !sectionBusy}
            <div class="lv-muted" style="margin-top:6px">{t("browse.sectionEmpty")}</div>
          {/if}
          {#each sectionTree as doc, _di (_di)}
            <div class="lv-row" style="margin:6px 0 0">
              <button class="lv-btn sm lv-btn--ghost" class:acc-btn={sectionSel?.kind === "doc" && sectionSel.id === doc.id}
                onclick={() => { sectionSel = { kind: "doc", id: doc.id, hpath: doc.hpath }; }}>
                <Icon name="file" size={13} /> {doc.title || doc.hpath}
              </button>
            </div>
            {#each doc.children as h, _hi (_hi)}
              <div class="lv-row" style="margin:2px 0 0;padding-left:{(h.level - 1) * 14}px">
                <button class="lv-btn sm lv-btn--ghost" class:acc-btn={sectionSel?.kind === "heading" && sectionSel.hpath === h.hpath}
                  onclick={() => { sectionSel = { kind: "heading", id: h.id, hpath: h.hpath }; }}>
                  {"#".repeat(Math.min(6, h.level))} {h.text}
                </button>
              </div>
            {/each}
          {/each}
        </div>
      {/if}
      {#if kpOpen}
        <!-- 51-02 lite：考点治理——概览/同义名合并/空考点填充；变更走批量编辑 dry-run+撤销 -->
        <div class="lv-card lv-pad-card" style="padding: var(--lv-space-3) var(--lv-space-4);max-height:320px;overflow:auto">
          <b style="font-size:var(--lv-font-size-body-compact)">{t("kp.title")}</b>
          {#if !kpData}
            <div class="lv-muted" style="margin-top:6px">{t("browse.empty")}</div>
          {:else}
            <div class="lv-row" style="margin:6px 0 0">
              <span class="lv-chip num">{t("kp.distinct").replace("{n}", String(kpData.entries.length))}</span>
              {#if kpData.emptyCount}<span class="lv-chip lv-chip--amb num">{t("kp.empty").replace("{n}", String(kpData.emptyCount))}</span>{/if}
            </div>
            <div class="lv-row" style="margin:4px 0 0">
              {#each kpData.entries.slice(0, 24) as e, _i (_i)}
                <button class="lv-chip" class:lv-chip--red={e.suspect} class:acc={kpMergeFrom === e.kp}
                  title={e.suspect ? t("kp.suspect") : t("kp.filterTip")}
                  onclick={() => { kpMergeFrom = e.kp; kpMergeTo = ""; kpMergePlan = null; setSearch(e.kp); }}>
                  {e.kp || "（空）"} · {e.count}
                </button>
              {/each}
              {#if kpData.entries.length > 24}<span class="lv-muted num">… +{kpData.entries.length - 24}</span>{/if}
            </div>
            <div class="lv-row" style="margin:8px 0 0">
              <b style="font-size:var(--lv-font-size-meta)">{t("kp.merge")}</b>
              <input class="lv-input" style="max-width:160px" bind:value={kpMergeFrom} placeholder={t("kp.fromPlaceholder")} />
              <span class="lv-muted">→</span>
              <input class="lv-input" style="max-width:160px" bind:value={kpMergeTo} placeholder={t("kp.toPlaceholder")} />
              <button class="lv-btn sm" onclick={previewKpMerge}><Icon name="search" size={13} /> {t("batch.preview")}</button>
            </div>
            {#if kpData.emptyCount}
              <div class="lv-row" style="margin:4px 0 0">
                <b style="font-size:var(--lv-font-size-meta)">{t("kp.fill").replace("{n}", String(kpData.emptyCount))}</b>
                <input class="lv-input" style="max-width:160px" bind:value={kpFillKp} placeholder={t("kp.toPlaceholder")} />
                <button class="lv-btn sm" onclick={previewKpFill}><Icon name="search" size={13} /> {t("batch.preview")}</button>
              </div>
            {/if}
            {#if kpMergePlan}
              <div class="lv-row" style="margin:6px 0 0">
                <span class="lv-chip num">{t("batch.planCount").replace("{n}", String(kpMergePlan.changes.length))}</span>
                <button class="lv-btn lv-btn--primary sm" disabled={kpBusy || !app.kernelOnline || !kpMergePlan.changes.length} onclick={() => void applyKpPlan(kpMergePlan!)}>
                  {kpBusy ? "…" : t("batch.apply").replace("{n}", String(kpMergePlan.changes.length))}
                </button>
                {#if !app.kernelOnline}<span class="lv-chip lv-chip--amb">{t("state.offlineHint")}</span>{/if}
              </div>
            {/if}
            {#if kpFillPlan}
              <div class="lv-row" style="margin:6px 0 0">
                <span class="lv-chip num">{t("batch.planCount").replace("{n}", String(kpFillPlan.changes.length))}</span>
                <button class="lv-btn lv-btn--primary sm" disabled={kpBusy || !app.kernelOnline || !kpFillPlan.changes.length} onclick={() => void applyKpPlan(kpFillPlan!)}>
                  {kpBusy ? "…" : t("batch.apply").replace("{n}", String(kpFillPlan.changes.length))}
                </button>
              </div>
            {/if}
            {#if kpNote}<div class="lv-row"><span class="lv-muted num">{kpNote}</span></div>{/if}
            <!-- 51-01/03 lite：考纲对照——粘贴大纲树，按 kp 前缀覆盖，零题缺口明示可导出 -->
            <div class="lv-row" style="margin:10px 0 0">
              <b style="font-size:var(--lv-font-size-meta)"><Icon name="file-text" size={13} /> {t("syl.title")}</b>
              {#if app.syllabusReadonly}<span class="lv-chip lv-chip--amb">{t("materials.readonly")}</span>{/if}
              {#if sylDoc.roots.length}
                <span class="lv-chip num">{t("syl.nodes").replace("{n}", String(countSyllabusNodes(sylDoc.roots)))}</span>
                {#if sylDoc.meta.publisher}<span class="lv-chip">{sylDoc.meta.publisher}</span>{/if}
                {#if sylDoc.meta.year}<span class="lv-chip num">{sylDoc.meta.year}</span>{/if}
                <span class="lv-muted num">{t("syl.importedAt").replace("{d}", new Date(sylDoc.importedAt).toLocaleDateString())}</span>
              {/if}
            </div>
            {#if sylDoc.roots.length}
              {@const cov = coverageTree(sylDoc.roots, sylKpStats)}
              <div class="lv-row" style="flex-wrap:wrap;margin:4px 0 0;gap:var(--lv-space-1)">
                {#each cov as c, _ci (_ci)}
                  {@const total = subtreeCount(c)}
                  {@const learned = subtreeLearned(c)}
                  <button class="lv-chip" class:lv-chip--red={total === 0} class:lv-chip--amb={total > 0 && learned === 0}
                    title={`${t("syl.gapTip")}${subtreeNoSource(c) ? " · " + t("syl.noSourceTip").replace("{n}", String(subtreeNoSource(c))) : ""}`}
                    onclick={() => { setSearch(c.node.kpPrefix); }}>
                    {c.node.title} · <span class="num">{total}</span>
                    {#if total === 0}&nbsp;{t("syl.gap")}
                    {:else if learned === 0}&nbsp;{t("syl.unmastered")}
                    {:else}&nbsp;<span class="num" title={t("syl.learnedTip")}>✓{learned}</span>{/if}
                  </button>
                {/each}
                <button class="lv-btn sm lv-btn--ghost" onclick={downloadSyllabusGaps}><Icon name="export" size={13} /> {t("syl.exportGaps")}</button>
              </div>
            {/if}
            {#if !sylDoc.roots.length || sylPreviewRoots}
              <div class="lv-row" style="margin:4px 0 0">
                <input class="lv-input" style="max-width:150px" placeholder={t("syl.publisher")} bind:value={sylPublisher} />
                <input class="lv-input" style="max-width:90px" placeholder={t("syl.year")} bind:value={sylYear} />
                <input class="lv-input" style="max-width:150px" placeholder={t("syl.source")} bind:value={sylSource} />
              </div>
              <textarea class="lv-input lv-textarea" rows="4" bind:value={sylText} placeholder={t("syl.placeholder")}></textarea>
              <div class="lv-row">
                <button class="lv-btn sm" onclick={previewSyllabus} disabled={!sylText.trim()}><Icon name="search" size={13} /> {t("syl.preview")}</button>
                {#if sylPreviewRoots?.length}
                  <span class="lv-chip num">{t("syl.nodes").replace("{n}", String(countSyllabusNodes(sylPreviewRoots)))}</span>
                  <button class="lv-btn lv-btn--primary sm" onclick={() => void importSyllabus()} disabled={app.syllabusReadonly}>{t("syl.import")}</button>
                {/if}
              </div>
            {/if}
            {#if sylError}<div class="lv-error">{sylError}</div>{/if}
            {#if sylNote}<div class="lv-row"><span class="lv-muted num">{sylNote}</span></div>{/if}
          {/if}
        </div>
      {/if}
      {#if paperOpen}
        <!-- 68-02 lite：纸笔回录——「题号=作答」判分预览后 append 流水（mode=paper，不覆盖任何线上数据） -->
        <div class="lv-card lv-pad-card" style="padding: var(--lv-space-3) var(--lv-space-4)">
          <div class="lv-row" style="margin:0">
            <b style="font-size:var(--lv-font-size-body-compact)"><Icon name="paperclip" size={13} /> {t("paper.title")}</b>
            <span class="lv-muted" style="font-size:var(--lv-font-size-caption)">{t("paper.hint")}</span>
          </div>
          <textarea class="lv-input lv-textarea" rows="4" bind:value={paperText} placeholder={t("paper.placeholder")}></textarea>
          {#if paperPreview}
            <div class="lv-row" style="margin:4px 0 0;flex-wrap:wrap">
              <span class="lv-chip lv-chip--grn num">✓ {paperPreview.items.filter((i) => i.verdict === "correct").length}</span>
              <span class="lv-chip lv-chip--red num">✕ {paperPreview.items.filter((i) => i.verdict === "wrong").length}</span>
              {#if paperPreview.items.some((i) => i.verdict === "not_attempted")}
                <span class="lv-chip lv-chip--amb num" title={t("paper.shortNote")}>? {paperPreview.items.filter((i) => i.verdict === "not_attempted").length}</span>
              {/if}
              {#if paperPreview.outOfRange.length}
                <span class="lv-chip lv-chip--amb num" title={paperPreview.outOfRange.join("、")}>{t("paper.outOfRange").replace("{n}", String(paperPreview.outOfRange.length))}</span>
              {/if}
              {#each paperPreview.errors.slice(0, 3) as pe, _pi (_pi)}
                <div class="lv-error-row num">#{pe.row} {pe.reason}</div>
              {/each}
              <button class="lv-btn lv-btn--primary sm" disabled={paperBusy} onclick={() => void applyPaperRecall()}>
                {paperBusy ? "…" : t("paper.apply").replace("{n}", String(paperPreview.items.filter((i) => i.verdict !== "not_attempted").length))}
              </button>
            </div>
          {/if}
          {#if paperNote}<div class="lv-row"><span class="lv-chip num">{paperNote}</span></div>{/if}
        </div>
      {/if}
      {#if errataOpen}
        <!-- 57 lite：勘误回导——qid 定向元数据勘误，dry-run 预览后走批量编辑同一写路径与撤销基线 -->
        <div class="lv-card lv-pad-card" style="padding: var(--lv-space-3) var(--lv-space-4);max-height:320px;overflow:auto">
          <div class="lv-row" style="margin:0">
            <b style="font-size:var(--lv-font-size-body-compact)"><Icon name="file-text" size={13} /> {t("errata.title")}</b>
            <span class="lv-muted" style="font-size:var(--lv-font-size-caption)">{t("errata.hint")}</span>
          </div>
          <div class="lv-row" style="margin:6px 0 0">
            <button class="lv-btn sm lv-btn--ghost" onclick={exportErrataTemplate}><Icon name="export" size={13} /> {t("errata.template")}</button>
            <label class="lv-btn sm">
              <Icon name="import" size={13} /> {t("errata.import")}
              <input type="file" accept=".csv,.tsv,.txt" style="display:none" onchange={onErrataFile} disabled={errataBusy} />
            </label>
          </div>
          {#if errataErrors.length}
            {#each errataErrors.slice(0, 5) as er, _ei (_ei)}
              <div class="lv-error-row num">#{er.row} {er.reason}</div>
            {/each}
            {#if errataErrors.length > 5}<div class="lv-muted num">… +{errataErrors.length - 5}</div>{/if}
          {/if}
          {#if errataPlan}
            <div class="lv-row" style="margin:6px 0 0;flex-wrap:wrap">
              <span class="lv-chip num">{t("batch.planCount").replace("{n}", String(errataPlan.changes.length))}</span>
              {#if errataPlan.unchanged}<span class="lv-chip num">{t("errata.unchanged").replace("{n}", String(errataPlan.unchanged))}</span>{/if}
              {#if errataPlan.unknownQids.length}
                <span class="lv-chip lv-chip--amb num" title={errataPlan.unknownQids.join("、")}>{t("errata.unknown").replace("{n}", String(errataPlan.unknownQids.length))}</span>
              {/if}
              <button class="lv-btn lv-btn--primary sm" disabled={errataBusy || !app.kernelOnline || !errataPlan.changes.length} onclick={() => void applyErrata()}>
                {errataBusy ? "…" : t("batch.apply").replace("{n}", String(errataPlan.changes.length))}
              </button>
              {#if !app.kernelOnline}<span class="lv-chip lv-chip--amb">{t("state.offlineHint")}</span>{/if}
            </div>
            {#each errataPlan.changes.slice(0, 8) as c, _ci (_ci)}
              <div class="lv-row lv-muted num" style="margin:2px 0;font-size:var(--lv-font-size-label)">
                {t("batch.field." + c.field)}：{c.from || "（空）"} → {c.to || "（空）"}
              </div>
            {/each}
            {#if errataPlan.changes.length > 8}<div class="lv-muted num">… +{errataPlan.changes.length - 8}</div>{/if}
          {/if}
          {#if errataNote}<div class="lv-row"><span class="lv-chip num">{errataNote}</span></div>{/if}
        </div>
      {/if}
      {#if batchMode}
        <div class="lv-card lv-pad-card" style="padding: var(--lv-space-3) var(--lv-space-4)">
          <div class="lv-row" style="margin:0;gap:var(--lv-space-compact);align-items:center;flex-wrap:wrap">
            <b style="font-size:var(--lv-font-size-body-compact)">{t("batch.title")}</b>
            <span class="lv-chip num">{t("batch.selected").replace("{n}", String(Object.keys(selectedIds).length))}</span>
            <button class="lv-btn sm lv-btn--ghost" onclick={selectAllCurrentPage}>{t("batch.selectAll")}</button>
            {#if selectedCount > 0}
              <button class="lv-btn sm lv-btn--ghost" onclick={clearSelection}>{t("batch.clearSel")}</button>
              <button class="lv-btn sm lv-btn--ghost" onclick={() => void batchConvertToCards()} disabled={batchCardBusy || !app?.kernelOnline} title="将勾选的题目批量制成闪卡送入卡包">
                <Icon name="layers" size={13} /> {batchCardBusy ? "…" : t("batch.toCards")}
              </button>
            {/if}
            {#if batchUndoHere && !appliedChanges.length}
              <span class="lv-chip num" title={t("batch.undoStoredHint")}>↩ {t("batch.undoStored").replace("{n}", String(batchUndo!.changes.length))}</span>
              <button class="lv-btn sm" disabled={batchBusy || !app.kernelOnline} onclick={() => applyBatch(true)}>{t("batch.undo")}</button>
            {/if}
            <select class="lv-select" bind:value={batchField}>
              <option value="kp">{t("batch.field.kp")}</option>
              <option value="difficulty">{t("batch.field.difficulty")}</option>
              <option value="source">{t("batch.field.source")}</option>
              <option value="year">{t("batch.field.year")}</option>
              <option value="score">{t("batch.field.score")}</option>
            </select>
            {#if batchField === "difficulty"}
              <select class="lv-select" bind:value={batchValue}>
                {#each [1, 2, 3, 4, 5] as d, _i (_i)}<option value={String(d)}>{d}</option>{/each}
              </select>
            {:else if batchField === "score"}
              <input class="lv-input" style="max-width:120px" type="number" min="0.5" step="0.5" bind:value={batchValue} placeholder={t("batch.scorePlaceholder")} />
            {:else}
              <input class="lv-input" style="max-width:200px" bind:value={batchValue}
                placeholder={batchField === "kp" ? t("batch.kpPlaceholder") : batchField === "year" ? t("batch.yearPlaceholder") : t("batch.sourcePlaceholder")} />
            {/if}
            <button class="lv-btn sm" disabled={!selectedCount} onclick={previewBatch}><Icon name="search" size={13} /> {t("batch.preview")}</button>
            {#if batchPreview}
              <button class="lv-btn lv-btn--primary sm" disabled={batchBusy || !batchPreview.changes.length} onclick={() => applyBatch(false)}>
                {batchBusy ? "…" : t("batch.apply").replace("{n}", String(batchPreview.changes.length))}
              </button>
              {#if appliedChanges.length || batchUndoHere}
                <button class="lv-btn sm" disabled={batchBusy} onclick={() => applyBatch(true)}>↩ {t("batch.undo")}</button>
              {/if}
            {/if}
          </div>
          {#if batchPreview}
            <div class="lv-row" style="margin:8px 0 0">
              <span class="lv-chip num">{t("batch.planCount").replace("{n}", String(batchPreview.changes.length))}</span>
              {#if batchPreview.skipped}<span class="lv-chip num">{t("batch.skipped").replace("{n}", String(batchPreview.skipped))}</span>{/if}
              {#if !app.kernelOnline}<span class="lv-chip lv-chip--amb">{t("state.offlineHint")}</span>{/if}
            </div>
            {#each batchPreview.changes.slice(0, 20) as c, _i (_i)}
              {@const stem = questions.find((q) => q.id === c.qid)?.stem ?? c.qid}
              <div class="lv-error-row num">{describeChange(c, stem)}</div>
            {/each}
            {#if batchPreview.changes.length > 20}<div class="lv-muted num">… +{batchPreview.changes.length - 20}</div>{/if}
            {#if batchNote}<div class="lv-row"><span class="lv-muted num">{batchNote}</span></div>{/if}
          {/if}
        </div>
      {/if}
      {#if health}
        <div class="lv-card lv-pad-card" style="padding: var(--lv-space-3) var(--lv-space-4)">
          <b style="font-size:var(--lv-font-size-body-compact)">{t("health.title")}</b>
          <span class="lv-chip num" style="margin-left:8px">{t("health.total")} {health.total}</span>
          {#if answerDist && answerDist.total >= 10}
            <!-- 67-03 lite：答案分布（公平性——答案可猜测性来自分布偏斜；样本 ≥10 才判定） -->
            <div class="lv-row" style="margin:6px 0 0;flex-wrap:wrap;gap:var(--lv-space-1)">
              <span class="lv-chip num" title={t("health.distTip")}><Icon name="chart" size={11} /> {t("health.dist")}（{answerDist.total}）</span>
              {#each Object.entries(answerDist.counts).sort() as [letter, n] (letter)}
                <span class="lv-chip num" class:lv-chip--red={answerDist.skewed === letter}>{letter} {n}</span>
              {/each}
              {#if answerDist.skewed}
                <span class="lv-chip lv-chip--red" title={t("health.distSkewTip")}>⚠ {t("health.distSkew").replace("{l}", answerDist.skewed).replace("{n}", String(answerDist.skewedRatio ?? 0))}</span>
              {/if}
              {#if answerDist.starved.length}
                <span class="lv-chip lv-chip--amb" title={t("health.distStarvedTip")}>{t("health.distStarved").replace("{l}", answerDist.starved.join(""))}</span>
              {/if}
            </div>
          {/if}
          {#if unreviewed && unreviewed.count}
            <!-- 67-03 lite：AI 未审校比例（origin=ai 且 review=pending） -->
            <div class="lv-row" style="margin:4px 0 0">
              <span class="lv-chip lv-chip--amb num" title={t("health.unreviewedTip")}><Icon name="sparkles" size={12} /> {t("health.unreviewed").replace("{n}", String(unreviewed.count)).replace("{r}", String(unreviewed.ratio ?? 0))}</span>
            </div>
          {/if}
          {#if coverage}
            <!-- 43-04 lite：生产者覆盖概览（点击 chip 直达对应过滤列表） -->
            <div class="lv-row" style="margin:6px 0 0">
              {#each coverage.byType as t2, _ti (_ti)}
                <button class="lv-chip num" class:acc={filterType === t2.type} title={t("coverage.typeTip")}
                  onclick={() => { filterType = filterType === t2.type ? "" : t2.type; }}>{t("qtype." + t2.type)} {t2.count}</button>
              {/each}
              {#if coverage.kpLearned != null}
                <!-- 51-03 lite：已学考点覆盖（有题考点中至少一题作答过的数量；练一题≠掌握整个考点） -->
                <span class="lv-chip num" title={t("coverage.learnedTip")}><Icon name="book" size={11} /> {t("coverage.learned").replace("{l}", String(coverage.kpLearned)).replace("{t}", String(coverage.kpCovered))}</span>
              {/if}
              <span class="lv-chip num">{t("coverage.sources").replace("{n}", String(coverage.sources))}</span>
              {#if coverage.sourceMissing}<button class="lv-chip lv-chip--amb num" onclick={() => { filterSource = "@@none"; }} title={t("coverage.sourceMissTip")}>{t("coverage.sourceMissing").replace("{n}", String(coverage.sourceMissing))}</button>{/if}
              {#if coverage.kpMissing}<button class="lv-chip lv-chip--amb num" onclick={() => { kpOpen = true; }}>{t("kp.empty").replace("{n}", String(coverage.kpMissing))}</button>{/if}
              {#if coverage.shortAnalysis}<span class="lv-chip lv-chip--amb num" title={t("coverage.shortTip")}>{t("coverage.shortAnalysis").replace("{n}", String(coverage.shortAnalysis))}</span>{/if}
            </div>
          {/if}
          {#if !health.clusters.length && !health.missing.length}
            <span class="lv-chip lv-chip--grn">✓ {t("health.clean")}</span>
          {:else}
            {#each health.clusters as cl, _i (_i)}
              <span class="lv-chip num" class:lv-chip--red={cl.similarity === 1} title={cl.sampleStem}>
                ⧉ {cl.ids.length}× {Math.round(cl.similarity * 100)}%
              </span>
            {/each}
            {#each health.missing as row, _i (_i)}
              <span class="lv-chip lv-chip--amb num" title={row.qids.slice(0, 10).join(" · ")}>{t("health.field." + row.field)} {row.count}</span>
            {/each}
          {/if}
          {#if batchList.length}
            <div class="lv-row" style="margin:10px 0 0">
              <b style="font-size:var(--lv-font-size-meta)">{t("import.batches")}</b>
              {#each batchList as b, _i (_i)}
                <span class="lv-chip num" title={b.batch}><Icon name="folder" size={11} /> {b.batch.slice(0, 16)} · {b.count}</span>
                <button class="lv-btn sm lv-btn--ghost" disabled={rollbackBusy === b.batch} onclick={() => undoBatch(b.batch)}>
                  {rollbackBusy === b.batch ? "…" : t("import.rollback")}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
      {#if questionsError}
        <div class="lv-error">{questionsError}</div>
      {:else if !questions.length}
        <div class="lv-empty"><div class="lv-empty-icon"><Icon name="file" size={24} /></div><b>{t("browse.title")}</b><p class="lv-muted">{t("browse.empty")}</p></div>
      {:else if !shownQuestions.length}
        <!-- 筛选无结果的独立空态：给原因与出路，不留空白区（规范 v6 状态完备） -->
        <div class="lv-empty">
          <div class="lv-empty-icon"><Icon name="search" size={24} /></div>
          <b>{t("browse.noMatch")}</b>
          <p class="lv-muted">{t("browse.noMatch.desc")}</p>
          <div class="lv-row" style="justify-content:center;margin-top:14px">
            <button class="lv-btn lv-btn--primary sm" onclick={clearBrowseFilters}>{t("browse.clearFilters")}</button>
          </div>
        </div>
      {:else}
        {#each shownQuestions as q (q.id)}
          <div class="lv-card lv-qrow" class:sel={batchMode && !!selectedIds[q.id]} class:active-peek={!batchMode && expandedId === q.id}>
            <button type="button" class="lv-qrow-head"
              aria-pressed={batchMode ? !!selectedIds[q.id] : undefined}
              aria-expanded={!batchMode ? expandedId === q.id : undefined}
              aria-describedby={`lv-qrow-stem-${q.id}`}
              onclick={() => toggleBrowseQuestion(q.id)}>
              {#if batchMode}
                <span class="lv-chip num" class:acc={!!selectedIds[q.id]}>{selectedIds[q.id] ? "☑" : "☐"}</span>
              {/if}
              <span class="lv-chip lv-chip--acc">{t("qtype." + q.type)}</span>
              {#if q.kp}<span class="lv-chip">{q.kp}</span>{/if}
              {#if q.source}<span class="lv-muted lv-qrow-src">{q.source}</span>{/if}
              {#if !batchMode && expandedId === q.id}
                <span class="lv-chip lv-chip--acc num" style="margin-left:auto">{t("browse.viewing", "查看中 ▾")}</span>
              {/if}
            </button>
            <div class="lv-qrow-stem" id={`lv-qrow-stem-${q.id}`}>{q.stem}</div>
          </div>
        {/each}
        {#if activePeekQuestion}
          {@const q = activePeekQuestion}
          {@const links = app.kernelOnline ? backlinkCache.get(q.blockId) : undefined}
          <div class="lv-peek-backdrop" onclick={closePeekDrawer} role="presentation"></div>
          <div bind:this={peekDrawerEl} class="lv-card lv-peek-drawer" aria-label={t("browse.detailTitle", "题目详情与操作")} role="dialog" aria-modal="true" tabindex="-1" onkeydown={onPeekDrawerKeydown}>
            <div class="lv-peek-sheet-handle" aria-hidden="true"></div>
            <header class="lv-peek-head">
              <div class="lv-row" style="margin:0;gap:var(--lv-space-1);flex-wrap:wrap">
                <span class="lv-chip lv-chip--acc">{t("qtype." + q.type)}</span>
                {#if q.kp}<span class="lv-chip">{q.kp}</span>{/if}
                {#if q.source}<span class="lv-muted lv-peek-src">{q.source}</span>{/if}
              </div>
              <div class="lv-row" style="margin:0;gap:var(--lv-space-1)">
                {#if currentPeekIndex >= 0}
                  <span class="lv-chip num lv-peek-counter" title={t("browse.peekCounter", "当前位置")}>
                    {currentPeekIndex + 1} / {shownQuestions.length}
                  </span>
                  <button class="lv-btn sm lv-btn--ghost" title={t("browse.prevQuestion", "上一题 (↑/k)")} aria-label={t("browse.prevQuestion", "上一题")} disabled={!hasPrevPeek} onclick={prevPeekQuestion}>
                    ‹
                  </button>
                  <button class="lv-btn sm lv-btn--ghost" title={t("browse.nextQuestion", "下一题 (↓/j)")} aria-label={t("browse.nextQuestion", "下一题")} disabled={!hasNextPeek} onclick={nextPeekQuestion}>
                    ›
                  </button>
                {/if}
                <button class="lv-btn sm lv-btn--ghost" title={t("browse.openDoc")} aria-label={t("browse.openDoc")} onclick={() => openInSiYuan((q as any).rootId)} disabled={!(q as any).rootId}>
                  <Icon name="pin" size={13} />
                </button>
                <button class="lv-btn sm lv-btn--ghost lv-peek-close" title={t("dialog.close", "关闭")} aria-label={t("dialog.close", "关闭")} onclick={closePeekDrawer}>
                  ✕
                </button>
              </div>
            </header>
            <div class="lv-peek-body">
              <div class="lv-peek-stem">{q.stem}</div>
              <div class="lv-detail">
                {#if editingId === q.id && editDraft}
                  <!-- 43-01 lite：题干/选项/答案/解析/考点/难度 内联编辑（updateBlock 整块重写 + exam-id 读回核验） -->
                  <div class="lv-row" style="margin:2px 0"><b>{t("edit.title")}</b><span class="lv-chip">{t("qtype." + q.type)}</span></div>
                  <textarea class="lv-input lv-textarea" rows="3" bind:value={editDraft.stem} placeholder={t("manual.stemPlaceholder")}></textarea>
                  {#if editDraft.options.length}
                    {#each editDraft.options as _o, oi (oi)}
                      <div class="lv-row" style="margin:4px 0">
                        <span class="lv-chip">{String.fromCharCode(65 + oi)}</span>
                        <input class="lv-input" bind:value={editDraft.options[oi]} />
                    <button class="lv-btn sm lv-btn--ghost" aria-label={`${t("manual.removeOption", "删除选项")} ${String.fromCharCode(65 + oi)}`} title={`${t("manual.removeOption", "删除选项")} ${String.fromCharCode(65 + oi)}`} onclick={() => { const next = removeChoiceOption(q.type, editDraft!.options, editDraft!.answer, oi); editDraft = { ...editDraft!, ...next }; }}>✕</button>
                      </div>
                    {/each}
                  {/if}
                  {#if q.type === "single" || q.type === "multiple"}
                    <button class="lv-btn sm lv-btn--ghost" onclick={() => { editDraft!.options.push(""); editDraft = { ...editDraft! }; }}>+ {t("manual.addOption")}</button>
                  {/if}
                  <div class="lv-row" style="margin:6px 0">
                    <label class="lv-muted" for="lv-edit-answer">{t("browse.answer")}</label>
                    <input id="lv-edit-answer" class="lv-input" style="max-width:180px" bind:value={editDraft.answer} placeholder={q.type === "judge" ? "对/错" : q.type === "multiple" ? "AB/ABC" : ""} />
                    <label class="lv-muted" for="lv-edit-kp">{t("manual.kp")}</label>
                    <input id="lv-edit-kp" class="lv-input" style="max-width:180px" bind:value={editDraft.kp} />
                    <label class="lv-muted" for="lv-edit-diff">{t("batch.field.difficulty")}</label>
                    <select id="lv-edit-diff" class="lv-select" bind:value={editDraft.difficulty}>
                      <option value="">—</option>
                      {#each [1, 2, 3, 4, 5] as d, _i (_i)}<option value={String(d)}>{d}</option>{/each}
                    </select>
                  </div>
                  {#if q.type === "fill"}
                    <!-- 54-02：编辑表单的判分规格区（打开时自现有 spec 读入；留空=清除回自动识别） -->
                    <div class="lv-row" style="margin:6px 0 4px">
                      <button class="lv-btn sm lv-btn--ghost" onclick={() => (editSpecOpen = !editSpecOpen)}>
                        ⚙ {t("spec.authorSection")}{#if editSpecOpen} ▾{/if}
                      </button>
                    </div>
                    {#if editSpecOpen}
                      <div class="lv-row" style="margin:4px 0 0;align-items:flex-end">
                        <label class="lv-field" style="max-width:140px"><span class="lv-muted">{t("spec.unit")}</span>
                          <input class="lv-input" bind:value={editSpecUnit} placeholder="m/s" />
                        </label>
                        <label class="lv-field" style="max-width:130px"><span class="lv-muted">{t("spec.absTol")}</span>
                          <input class="lv-input num" bind:value={editSpecAbsTol} placeholder="0.5" inputmode="decimal" />
                        </label>
                        <label class="lv-field" style="max-width:130px"><span class="lv-muted">{t("spec.relPct")}</span>
                          <input class="lv-input num" bind:value={editSpecRelPct} placeholder="5" inputmode="decimal" />
                        </label>
                        <label class="lv-field" style="flex:1;min-width:160px"><span class="lv-muted">{t("spec.altUnits")}</span>
                          <input class="lv-input" bind:value={editSpecAltUnits} placeholder="km/h, cm/s" />
                        </label>
                      </div>
                    {/if}
                  {/if}
                  <textarea class="lv-input lv-textarea" rows="2" bind:value={editDraft.analysis} placeholder={t("manual.analysis")}></textarea>
                  {#if editError}<div class="lv-error">{editError}</div>{/if}
                  <div class="lv-row">
                    <button class="lv-btn lv-btn--primary sm" disabled={editBusy || offline} onclick={() => void saveEdit(q)}>
                      {editBusy ? "…" : t("edit.save")}
                    </button>
                    <button class="lv-btn sm lv-btn--ghost" onclick={closeEditForm}>{t("edit.cancel")}</button>
                    {#if offline}<span class="lv-chip lv-chip--amb">{t("state.offlineHint")}</span>{/if}
                  </div>
                {:else}
                  {@const st = app.derived().byQuestion.get(q.id)}
                  {@const wr = app.derived().wrongbook.get(q.id)}
                  <div class="lv-row" style="margin:8px 0 6px;align-items:center;justify-content:space-between">
                    <button class="lv-chip" class:acc={!peekHideAnswer} onclick={() => peekHideAnswer = !peekHideAnswer}>
                      <Icon name={peekHideAnswer ? "eyeoff" : "eye"} size={12} /> {peekHideAnswer ? t("browse.showAnswer") : t("browse.hideAnswer")}
                    </button>
                    {#if peekHideAnswer}
                      <span class="lv-muted" style="font-size:var(--lv-font-size-caption)">已开启遮挡自测，点击上方按钮揭晓</span>
                    {/if}
                  </div>
                  {#if !peekHideAnswer}
                    <div class="lv-muted lv-peek-answer-box" style="animation: lv-appear var(--lv-dur-view, 0.22s) var(--lv-ease-out)">
                      <b>{t("browse.answer")}:</b> <strong class="num" style="color:var(--lv-accent)">{q.answer}</strong>{#if q.analysis} · {q.analysis}{/if}
                    </div>
                  {/if}
                  {#if st && st.attempts}
                    <!-- 43-02 lite：题目使用分析（作答次数/正确率/最近作答/错次），数据不足如实不显示 -->
                    <div class="lv-muted num" role="status"><Icon name="chart" size={11} /> {t("browse.usage").replace("{a}", String(st.attempts)).replace("{c}", String(Math.round((st.correct / st.attempts) * 100)))}{#if wr} · {t("browse.wrongCount").replace("{n}", String(wr.wrongCount))}{/if} · {new Date(st.lastAt).toLocaleDateString()}</div>
                  <div class="lv-row" style="margin:4px 0 0">
                    <button class="lv-btn sm lv-btn--ghost" aria-expanded={revOpenFor === q.id} aria-busy={revLoadingFor === q.id || revRestoreKey.startsWith(`${q.id}#`)} disabled={!!revLoadingFor || !!revRestoreKey} onclick={() => void toggleRevisions(q.id)}><Icon name="pencil" size={12} /> {revLoadingFor === q.id ? t("rev.loading") : t("rev.drill")}{#if revOpenFor === q.id && revLoaded[q.id] !== undefined}（<span class="num">{revList(q.id).length}</span>）{/if}</button>
                  </div>
                  {#if revOpenFor === q.id}
                    <div class="lv-row" style="flex-direction:column;align-items:stretch;gap:var(--lv-space-1);margin:4px 0 0">
                      {#if revLoadingFor === q.id}
                        <span class="lv-muted" role="status" aria-live="polite">{t("rev.loading")}</span>
                      {:else if revLoadError[q.id]}
                        <div class="lv-error" role="alert" style="overflow-wrap:anywhere">{t("rev.loadFailed").replace("{message}", revLoadError[q.id])}</div>
                        <button class="lv-btn sm" disabled={!!revLoadingFor} onclick={() => void loadRevisions(q.id)}>{t("rev.retry")}</button>
                      {:else}
                        {#each revList(q.id) as r (r.ts)}
                          <div class="lv-error-row" style="white-space:normal">
                            <b class="num">{new Date(r.ts).toLocaleString()}</b> · {t("report.changedFirst")}: {r.answer}
                            {#if r.specChanged}<span class="lv-chip lv-chip--amb" style="margin-left:4px">{t("rev.specChanged")}</span>{/if}
                            {#if r.kp}<span class="lv-muted"> · {r.kp}</span>{/if}
                            {#if revRestoreFailedKey === `${q.id}#${r.ts}`}<span class="lv-error" role="alert">{t("rev.restoreFailed").replace("{message}", revRestoreError[q.id])}</span><button class="lv-btn sm" disabled={!!revRestoreKey} onclick={() => void restoreRevision(q, r)}>{t("rev.retry")}</button>{/if}
                            <button class="lv-btn sm lv-btn--ghost" style="margin-left:6px" disabled={!!revRestoreKey} aria-busy={revRestoreKey === `${q.id}#${r.ts}`} onclick={() => void restoreRevision(q, r)}>{revRestoreKey === `${q.id}#${r.ts}` ? "…" : t("rev.restore")}</button>
                          </div>
                        {:else}
                          <span class="lv-muted num">{t("rev.empty")}</span>
                        {/each}
                      {/if}
                    </div>
                  {/if}
                  {/if}
                  <div class="lv-row">
                    <button class="lv-btn sm lv-btn--primary" onclick={() => void drillSingleQuestion(q)} title={t("browse.drillSingleTip")}><Icon name="play" size={13} /> {t("browse.drillSingle")}</button>
                    <button class="lv-btn sm" onclick={() => openEditForm(q)}>✎ {t("edit.open")}</button>
                    <button class="lv-btn sm" onclick={() => openInSiYuan((q as any).rootId)} disabled={!(q as any).rootId} title={!(q as any).rootId ? t("browse.docUnavailable") : t("browse.openDoc")}><Icon name="pin" size={13} /> {t("browse.openDoc")}</button>
                    <button class="lv-btn sm" onclick={() => void loadBacklinks(q.blockId)} disabled={!app.kernelOnline || !!backlinkBusyFor} aria-busy={backlinkBusyFor === q.blockId} title={!app.kernelOnline ? t("state.offlineHint") : t("browse.backlinks")}><Icon name="link" size={13} /> {backlinkBusyFor === q.blockId ? t("browse.backlinkLoading") : t("browse.backlinks")}</button>
                    {#if links}
                      {#if links.length === 0}<span class="lv-muted">{t("browse.noBacklinks")}</span>
                      {:else}{#each links as l, _i (_i)}<span class="lv-chip" title={l.content}><Icon name="paperclip" size={11} /> {l.title}</span>{/each}{/if}
                    {/if}
                  </div>
                  {#if backlinkError[q.blockId]}<div class="lv-error" role="alert" style="display:flex;align-items:center;justify-content:space-between;gap:var(--lv-space-relaxed);overflow-wrap:anywhere"><span>{backlinkError[q.blockId]}</span><button class="lv-btn sm" disabled={!!backlinkBusyFor || !app.kernelOnline} onclick={() => void loadBacklinks(q.blockId)}>{t("rev.retry")}</button></div>{/if}
                  {#if qrefView[q.id]}
                    <!-- 120-05 lite：题目↔资料关联（回 PDF 页/视频时间点） -->
                    <div class="lv-row lv-qref-bar" style="font-size:var(--lv-font-size-caption);padding:6px 10px;background:var(--lv-surface-2);border-radius:var(--lv-r-1);margin:6px 0;align-items:center;border:1px solid var(--lv-border-subtle)">
                      <span class="lv-chip"><Icon name="file-text" size={11} /> {qrefView[q.id]!.title}{#if qrefView[q.id]!.label} · {qrefView[q.id]!.label}{/if}</span>
                      {#if qrefView[q.id]!.stale}<span class="lv-chip lv-chip--amb" title={t("materials.relocateTip")}>{t("materials.relocate")}</span>{/if}
                      <button class="lv-btn sm lv-btn--ghost" onclick={() => openQref(q.id)}>↗ {t("materials.openAt")}</button>
                      <button class="lv-btn sm lv-btn--ghost" onclick={() => startQrefForm(q.id)}><Icon name="link" size={13} /> {t("qref.relink")}</button>
                      <button class="lv-btn sm lv-btn--ghost" aria-label={t("qref.unlink")} title={t("qref.unlink")} disabled={qrefBusyFor === q.id} aria-busy={qrefBusyFor === q.id} onclick={() => void removeQref(q.id)}>{qrefBusyFor === q.id ? "…" : "✕"}</button>
                    </div>
                    {#if qrefActionError[q.id]}<div class="lv-error" role="alert" style="overflow-wrap:anywhere">{qrefActionError[q.id]}</div>{/if}
                  {:else}
                    <div class="lv-row" style="font-size:var(--lv-font-size-caption)">
                      <button class="lv-btn sm lv-btn--ghost" onclick={() => startQrefForm(q.id)}><Icon name="link" size={13} /> {t("qref.link")}</button>
                    </div>
                  {/if}
                  {#if qrefFormFor === q.id}
                    <div class="lv-detail" style="margin:4px 0">
                      <div class="lv-row" style="flex-wrap:wrap">
                        <select class="lv-select" bind:value={qrefMatId}>
                          <option value="">{t("qref.pickMaterial")}</option>
                          {#each app.listMaterials() as m (m.id)}<option value={m.id}>{m.title}</option>{/each}
                        </select>
                        <input class="lv-input" style="max-width:90px" placeholder={t("materials.page")} bind:value={qrefPage} />
                        <input class="lv-input" style="max-width:110px" placeholder="mm:ss" bind:value={qrefTime} />
                        <button class="lv-btn lv-btn--primary sm" onclick={() => void saveQref(q.id)} disabled={!qrefMatId || !!qrefBusyFor} aria-busy={qrefBusyFor === q.id}>{qrefBusyFor === q.id ? "…" : t("qref.save")}</button>
                        <button class="lv-btn sm lv-btn--ghost" onclick={() => (qrefFormFor = "")}>{t("edit.cancel")}</button>
                      </div>
                      {#if qrefError}<div class="lv-error" role="alert">{qrefError}</div>{/if}
                    </div>
                  {/if}
                  {#if st && st.attempts}
                    <!-- U14 lite：作答回执下钻（显示当时作答/判定/信心/受助/先回忆/用时；错题回执可接 AI 错因假设） -->
                    <div class="lv-row" style="font-size:var(--lv-font-size-caption)">
                      <button class="lv-btn sm lv-btn--ghost" onclick={() => toggleReceipts(q.id)}>
                        <Icon name="table" size={13} /> {t("receipt.title")}（<span class="num">{st.attempts}</span>）
                      </button>
                    </div>
                    {#if receiptOpenFor === q.id}
                      <div class="lv-detail" style="margin:4px 0">
                        {#if receiptStored}
                          <!-- U14：上次 AI 假设（独立存储层回显，与用户复盘分层） -->
                          <div class="lv-row" style="flex-wrap:wrap;margin:3px 0;gap:var(--lv-space-1);font-size:var(--lv-font-size-caption)">
                            <span class="lv-chip"><Icon name="flask" size={11} /> {t("receipt.lastHypothesis")} · {new Date(receiptStored.at).toLocaleDateString()}</span>
                            {#if receiptStored.adoptedAt}<span class="lv-chip lv-chip--grn">{t("receipt.adopted")}</span>{/if}
                          </div>
                          <div class="lv-muted" style="font-size:var(--lv-font-size-caption);white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 6px">{receiptStored.text}</div>
                        {/if}
                        {#each receiptCache as e (e.seq)}
                          {@const rkey = `${e.qid}#${e.seq}`}
                          <div class="lv-row" style="flex-wrap:wrap;font-size:var(--lv-font-size-caption);margin:3px 0;gap:var(--lv-space-1)">
                            <span class="lv-chip num">{new Date(e.ts).toLocaleString()}</span>
                            <span class="lv-chip">{e.verdict === "correct" ? "✓" : e.verdict === "wrong" ? "✕" : "—"}</span>
                            {#if e.myAnswer}<span class="lv-chip num">{t("session.myAnswer")}: {e.myAnswer}</span>{/if}
                            {#if e.confidence}<span class="lv-chip">{t("confidence." + e.confidence)}</span>{/if}
                            {#if e.help}<span class="lv-chip lv-chip--amb"><Icon name="bulb" size={11} /> {t("receipt.help")}</span>{/if}
                            {#if e.recall}<span class="lv-chip"><Icon name="eyeoff" size={11} /> {t("receipt.recall")}</span>{/if}
                            {#if e.timeMs}<span class="lv-chip num">{Math.round(e.timeMs / 1000)}s</span>{/if}
                            {#if e.verdict === "wrong"}
                              <button class="lv-btn sm lv-btn--ghost" disabled={receiptBusy === rkey}
                                onclick={() => void runReceiptMisdiagnosis(q, e)}><Icon name="flask" size={13} /> {receiptBusy === rkey ? "…" : t("misdiagnosis.ask")}</button>
                            {/if}
                            {#if receiptMisdiagnosis[rkey]}
                              <div class="lv-detail" style="width:100%;font-size:var(--lv-font-size-sm);white-space:pre-wrap;overflow-wrap:anywhere">{receiptMisdiagnosis[rkey]}</div>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    {/if}
                  {/if}
                  {#if flashError[q.id]}<div class="lv-error">{flashError[q.id]}</div>{/if}
                  <div class="lv-row" style="font-size:var(--lv-font-size-caption)">
                    <button class="lv-btn sm lv-btn--ghost" disabled={flashBusy === q.id} onclick={() => void makeFlashCandidates(q)}>
                      <Icon name="layers" size={13} /> {flashBusy === q.id ? "…" : t("flash.ask")}
                    </button>
                    {#if flashCandidates[q.id]?.cards?.length}
                      <span class="lv-chip num" title={flashCandidates[q.id]!.splitReason ?? ""}>{summarizeLoad(flashCandidates[q.id]!.cards)}</span>
                    {/if}
                  </div>
                  {#if flashCandidates[q.id]?.cards?.length}
                    <!-- 116-03 T10：先展示卡数/负荷/来源；确认后才建卡（ riff 卡包） -->
                    <div class="lv-detail" style="margin:4px 0">
                      {#each flashCandidates[q.id]!.cards as c, _ci (_ci)}
                        <div class="lv-row" style="font-size:var(--lv-font-size-caption);margin:2px 0;align-items:flex-start;gap:var(--lv-space-1)">
                          <span class="lv-chip">{t("flash.type." + c.type)}</span>
                          <div style="flex:1;min-width:200px;overflow-wrap:anywhere">
                            <b>{c.front}</b>
                            <div class="lv-muted">→ {c.back}</div>
                          </div>
                          <span class="lv-chip num">{c.source}</span>
                        </div>
                      {/each}
                      <div class="lv-row">
                        <button class="lv-btn lv-btn--primary sm" disabled={flashBusy === q.id} onclick={() => void confirmFlashCards(q)}>
                          {t("flash.confirm").replace("{n}", String(flashCandidates[q.id]!.cards.length))}
                        </button>
                        <button class="lv-btn sm lv-btn--ghost" onclick={() => { flashCandidates = { ...flashCandidates, [q.id]: { cards: [] } }; }}>{t("edit.cancel")}</button>
                      </div>
                    </div>
                  {/if}
                {/if}
              </div>
            </div>
            <footer class="lv-peek-footer">
              <button class="lv-btn lv-btn--primary sm" onclick={() => void startSingleById(q.id)}>
                ▶ {t("browse.practiceOne", "只练这道题")}
              </button>
              {#if editingId !== q.id}
                <button class="lv-btn sm" onclick={() => openEditForm(q)}>
                  ✎ {t("edit.open", "编辑题目")}
                </button>
              {/if}
              <button class="lv-btn sm lv-btn--ghost" onclick={closePeekDrawer}>
                {t("dialog.close", "关闭")}
              </button>
            </footer>
          </div>
        {/if}
        {#if hasMore}
          <button class="lv-btn" style="width:100%" onclick={() => (browseLimit += 200)}>
            {t("browse.loadMore")}（{shownQuestions.length}/{questions.length}）
          </button>
        {/if}
      {/if}
    </div>
  {:else if view === "import"}
    <!-- ===== S9 导入 ===== -->
    <div class="lv-pad">
      <div class="lv-screen-head"><span class="lv-eyebrow">{t("head.import.eyebrow")}</span><h1 class="lv-h1">{t("head.import.title")}</h1><p>{t("head.import.desc")}</p></div>
      {@render studioNav()}
      <div class="lv-row">
        <button class="lv-btn lv-btn--ghost lv-mobile-back" onclick={() => view = hasBank ? "entry" : "entry"}>← {t("import.back")}</button>
        <span class="lv-chip">{t("import.title")}</span>
      </div>
      {#if !hasBank}
        <div class="lv-empty">{t("guard.needBankFirst")}</div>
      {:else}
        <div class="lv-card lv-pad-card">
          <div class="lv-row">
            <label class="lv-btn"><Icon name="folder" size={15} /> {t("import.pickExcel")}<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange={onExcelFile} disabled={importBusy} /></label>
            <button class="lv-btn sm" onclick={downloadTemplate}><Icon name="import" size={15} /> {t("import.template")}</button>
            <button class="lv-btn sm lv-btn--ghost" onclick={pasteClipboardToImport} disabled={importBusy} title={t("import.pasteClipboardTip")}><Icon name="copy" size={14} /> {t("import.pasteClipboard")}</button>
            <span class="lv-muted">{t("import.orPaste")}</span>
          </div>
          <textarea class="lv-input lv-textarea" rows="8" placeholder={t("import.placeholder")} bind:value={importText} disabled={importBusy}></textarea>
          <div class="lv-row">
            <button class="lv-btn lv-btn--primary" onclick={doParseText} disabled={importBusy || !importText.trim()} title={importText.trim() ? t("import.parse") : t("import.needInput")}>{importParsing ? t("import.parsing") : t("import.parse")}</button>
            <!-- 38-03：重复合并策略三选（跳过/并存/更新已有题答案） -->
            <select class="lv-select" bind:value={dupeStrategy} onchange={onImportStrategyChange} disabled={importBusy} title={t("import.strategyHint")}>
              <option value="skip">{t("import.strategySkip")}</option>
              <option value="coexist">{t("import.strategyCoexist")}</option>
              <option value="update">{t("import.strategyUpdate")}</option>
            </select>
            <span class="lv-muted">{t("import.excelNote")}</span>
          </div>
          {#if savedMappings.length}
            <div class="lv-row">
              <span class="lv-chip">{t("import.useMapping")}</span>
              <select class="lv-select" style="max-width:220px" bind:value={selectedMapping} disabled={importBusy} onchange={() => { manualMap = null; if (sheetRowsCache.get(activeSheet)?.length) parseActiveSheet(); }}>
                <option value="">{t("import.autoMap")}</option>
                {#each savedMappings as m, _i (_i)}<option value={m.name}>{m.name}</option>{/each}
              </select>
            </div>
          {/if}
          {#if sheetRowsCache.get(activeSheet)?.length}
            <!-- 38-02：手动列映射（自动失败/异名列/乱序表） -->
            <div class="lv-row">
              <button class="lv-btn sm" onclick={toggleMapEditor} disabled={importBusy}><Icon name="pencil" size={13} /> {t("import.manualMap")}</button>
              {#if manualMap}<span class="lv-chip lv-chip--acc">{t("import.manualMapActive")}</span>{/if}
            </div>
            {#if mapEditorOpen}
              <div class="lv-detail" style="margin:4px 0 8px">
                <div class="lv-row" style="flex-wrap:wrap;gap:var(--lv-space-1)">
                  {#each sheetRowsCache.get(activeSheet)![0].map(String) as h, hi (hi)}
                    <span class="lv-chip num" title={t("import.manualMapCol").replace("{l}", columnLabel(hi))}>{columnLabel(hi)}·{h || "—"}</span>
                  {/each}
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--lv-space-1) 12px;margin:6px 0">
                  {#each MAP_FIELDS as f (f.key)}
                    <label class="lv-row" style="margin:0;gap:var(--lv-space-compact)">
                      <span class="lv-muted" style="min-width:56px">{t(f.i18n)}</span>
                      <select class="lv-select" style="flex:1;min-width:0" bind:value={mapAssign[f.key]}>
                        <option value={-1}>{t("import.f.none")}</option>
                        {#each sheetRowsCache.get(activeSheet)![0] as h, hi (hi)}
                          <option value={hi}>{columnLabel(hi)}·{String(h).slice(0, 12) || "—"}</option>
                        {/each}
                      </select>
                    </label>
                  {/each}
                  {#each Array(6) as _, oi (oi)}
                    <label class="lv-row" style="margin:0;gap:var(--lv-space-compact)">
                      <span class="lv-muted" style="min-width:56px">{t("import.f.option")}{String.fromCharCode(65 + oi)}</span>
                      <select class="lv-select" style="flex:1;min-width:0" bind:value={mapAssign.options[oi]}>
                        <option value={-1}>{t("import.f.none")}</option>
                        {#each sheetRowsCache.get(activeSheet)![0] as h, hi (hi)}
                          <option value={hi}>{columnLabel(hi)}·{String(h).slice(0, 12) || "—"}</option>
                        {/each}
                      </select>
                    </label>
                  {/each}
                </div>
                {#each mapErrors as me, _mi (_mi)}<div class="lv-error-row">{me}</div>{/each}
                <div class="lv-row">
                  <button class="lv-btn lv-btn--primary sm" onclick={applyManualMap} disabled={importBusy}>{t("import.manualMapApply")}</button>
                  <button class="lv-btn sm lv-btn--ghost" onclick={() => (mapEditorOpen = false)}>{t("edit.cancel")}</button>
                </div>
              </div>
            {/if}
          {/if}
          {#if importError}<div class="lv-error">{importError}</div>{/if}
          {#if importReport}
            <p class="lv-muted">{t("import.target").replace("{name}", banks.find((b) => b.id === importPreviewBankId)?.name ?? importPreviewBankId)}</p>
            <div class="lv-row">
              <span class="lv-chip lv-chip--grn num">✓ {importReport.ok.length}</span>
              <span class="lv-chip lv-chip--red num">✕ {importReport.errors.length}</span>
              {#if importReport.duplicates}<span class="lv-chip lv-chip--amb num" title={t("import.dupeHint")}>⧉ {importReport.duplicates}</span>{/if}
              {#if importReport.ok.length}
                <button class="lv-btn sm lv-btn--ghost" disabled={spotBusy} onclick={() => void spotCheckRender()}>
                  <Icon name="shuffle" size={13} /> {t("import.spotCheck")}{#if spotIds.length}（{spotIds.length}）{/if}
                </button>
              {/if}
            </div>
            {#if spotIds.length}
              <!-- 渲染式抽查（U07）：md2html 真实渲染管线，所见即入库所得 -->
              {#each spotIds as sid, _si (_si)}
                {@const sq = importReport.ok.find((q) => q.id === sid)}
                {#if sq}
                  <div class="lv-detail" style="margin:6px 0">
                    <div class="lv-row" style="margin:0">
                      <span class="lv-chip lv-chip--acc">{t("qtype." + sq.type)}</span>
                      {#if sq.kp}<span class="lv-chip">{sq.kp}</span>{/if}
                      <span class="lv-muted num">{t("browse.answer")}: {sq.answer}</span>
                    </div>
                    <div class="lv-rich b3-typography" style="font-size:var(--lv-font-size-body-compact)">{@html spotHtml[sid] || escapeHtml(sq.stem)}</div>
                    {#each sq.options as opt, oi (oi)}
                      <div class="lv-muted">{String.fromCharCode(65 + oi)}. {opt}</div>
                    {/each}
                  </div>
                {/if}
              {/each}
            {/if}
            {#each importReport.dupeSamples ?? [] as d, _i (_i)}
              <div class="lv-error-row num" title={t("import.dupeHint")}>#{d.row} ⧉ {t("import.dupeRow")} {d.stem}</div>
            {/each}
            {#if importReport.updates?.length}
              <!-- 38-03：更新式重导预览（这些行不再跳过，提交时按 hash 更新库内题答案/解析） -->
              <div class="lv-row" style="margin:4px 0 0">
                <span class="lv-chip lv-chip--amb num" title={t("import.updatesHint")}>↻ {t("import.updatesCount").replace("{n}", String(importReport.updates.length))}</span>
              </div>
              {#each importReport.updates.slice(0, 10) as u, _ui2 (_ui2)}
                <div class="lv-error-row num" title={u.q.stem}>↻ #{u.row} {u.q.stem.slice(0, 40)} → {t("browse.answer")}: {u.q.answer}</div>
              {/each}
            {/if}
            {#each importReport.errors.slice(0, 20) as err, _i (_i)}
              <div class="lv-error-row">
                <b class="num">#{err.row}</b> {err.reason}<span class="lv-muted"> · {err.raw}</span>
                <button class="lv-btn sm lv-btn--ghost" onclick={() => startRowFix(err.row)} disabled={importBusy}>{t("import.rowFix")}</button>
              </div>
              {#if fixRow === err.row}
                <!-- 单行修复（U07 后半）：Excel=按单元格编辑；文本=题块整块编辑 → 单行重验 → 合回预览 -->
                <div class="lv-detail" style="margin:4px 0 8px">
                  {#if fixCells.length}
                    {#each fixCells as _c, ci (ci)}
                      <div class="lv-row" style="margin:3px 0">
                        <span class="lv-chip num">{ci}</span>
                        <input class="lv-input" bind:value={fixCells[ci]} />
                      </div>
                    {/each}
                  {:else}
                    <textarea class="lv-input lv-textarea" rows="5" bind:value={fixText} aria-label={t("import.rowFixText")}></textarea>
                  {/if}
                  {#if fixNote}<div class="lv-error">{fixNote}</div>{/if}
                  <div class="lv-row">
                    <button class="lv-btn lv-btn--primary sm" disabled={importBusy || (!fixCells.length && !fixText.trim())} onclick={() => void applyRowFix(err.row)}>{t("import.rowFixApply")}</button>
                    <button class="lv-btn sm lv-btn--ghost" onclick={cancelRowFix}>{t("edit.cancel")}</button>
                  </div>
                </div>
              {/if}
            {/each}
            {#if importReport.errors.length > 20}<div class="lv-muted num">… +{importReport.errors.length - 20}</div>{/if}
            {#if importReport.errors.length}
              <div class="lv-row">
                <button class="lv-btn sm" onclick={downloadErrorsCsv}>⬇️ {t("import.exportErrors")}</button>
              </div>
            {/if}
            {#if lastMap}
              <div class="lv-row">
                  <button class="lv-btn sm" onclick={saveMapping} disabled={mappingBusy} aria-busy={mappingBusy}><Icon name="save" size={13} /> {mappingBusy ? "…" : t("import.saveMapping")}</button>
              </div>
            {/if}
            <div class="lv-row">
              <button class="lv-btn lv-btn--primary" onclick={commitImport} disabled={importBusy || (!remainingImportQuestions.length && !importReport.updates?.length && !trialConfirmed.length)}>
                {committing ? t("import.committing") : importReport.updates?.length ? t("import.commitSummary").replace("{new}", String(remainingImportQuestions.length)).replace("{update}", String(importReport.updates.length)) : remainingImportQuestions.length ? t("import.commit") + " (" + remainingImportQuestions.length + ")" : t("import.finishTrial")}
              </button>
              <button class="lv-btn sm" onclick={trialImport5} disabled={importBusy || !remainingImportQuestions.length}>
                {trialBusy ? "…" : t("import.trial5")}
              </button>
              {#if committing && commitProgress}
                <!-- 46-03：分文档写入进度 + 取消（取消在文档间生效，已写部分如实回执） -->
                <span class="lv-chip num" role="status">{t("import.progress").replace("{d}", String(commitProgress.done)).replace("{t}", String(commitProgress.total))}</span>
                <button class="lv-btn sm" onclick={() => { commitCancelRequested = true; }}>{t("import.cancelCommit")}</button>
              {/if}
            </div>
            {#if trialNote}
              <div class="lv-row"><span class="lv-chip num">{trialNote}</span></div>
            {/if}
          {/if}
          {#if importResult}
            {#if importResult.written || !updateResult}<div class="lv-success" role="status">✓ {t("import.done")} {importResult.written}</div>{/if}
            {#if updateResult}
              <!-- 38-03：更新式重导回执（与新增写入分列） -->
              <div class="lv-row" role="status">
                <span class="lv-chip lv-chip--amb num">↻ {t("import.updatesDone").replace("{ok}", String(updateResult.ok)).replace("{f}", String(updateResult.failed)).replace("{m}", String(updateResult.missing))}</span>
                {#if updateResult.unprocessed}<span class="lv-chip num">{t("import.updatesPending").replace("{n}", String(updateResult.unprocessed))}</span>{/if}
              </div>
            {/if}
            <div class="lv-row">
              {#if importResult.cancelled}
                <span class="lv-chip lv-chip--amb num">{t("import.cancelledNote").replace("{w}", String(importResult.written))}</span>
              {/if}
              {#if importResult.unprocessed}<span class="lv-chip num">{t("import.unprocessed").replace("{n}", String(importResult.unprocessed))}</span>{/if}
              {#if importResult.verified}
                {#if importResult.missing === 0}
                  <span class="lv-chip lv-chip--grn num">✓ {t("import.readbackOk").replace("{n}", String(importResult.confirmed))}</span>
                {:else}
                  <span class="lv-chip lv-chip--amb num">⚠ {t("import.readbackPart").replace("{c}", String(importResult.confirmed)).replace("{m}", String(importResult.missing))}</span>
                {/if}
              {:else}
                <span class="lv-chip lv-chip--amb">{t("import.readbackUnknown")}</span>
              {/if}
              {#if retryPool.length}
                <button class="lv-btn sm" disabled={importBusy} onclick={retryMissing}>↻ {t("import.retryMissing").replace("{n}", String(retryPool.length))}</button>
              {/if}
            </div>
            <div class="lv-row">
              <button class="lv-btn lv-btn--primary" onclick={() => { view = "entry"; void loadQuestions(); }}>{t("import.goPractice")}</button>
              <button class="lv-btn" onclick={() => { view = "browse"; void loadQuestions(); }}>{t("import.goBrowse")}</button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
    </div>
    <Palette commands={paletteCommands} bind:open={paletteOpen} {t} />
    {#if hotkeysHelpOpen}
      <button type="button" class="lv-hotkeys-backdrop" aria-label={t("dialog.close", "关闭")} onclick={() => hotkeysHelpOpen = false}></button>
      <div class="lv-hotkeys-wrap">
        <div class="lv-card lv-hotkeys-card" role="dialog" aria-modal="true" tabindex="-1" aria-label={t("hotkeys.title")}>
          <div class="lv-row" style="justify-content:space-between;margin:0 0 14px">
            <b style="font-size:16px"><Icon name="activity" size={16} /> {t("hotkeys.title")}</b>
            <button class="lv-btn sm lv-btn--ghost" onclick={() => hotkeysHelpOpen = false}>✕</button>
          </div>
          <div class="lv-hotkeys-grid">
            <div class="lv-hotkeys-row"><span class="lv-kbd">A</span> - <span class="lv-kbd">D</span><span>快速选择答案选项</span></div>
            <div class="lv-hotkeys-row"><span class="lv-kbd">Enter</span><span>确认作答 / 极速下一题</span></div>
            <div class="lv-hotkeys-row"><span class="lv-kbd">1</span> - <span class="lv-kbd">3</span><span>作答前标记把握度 / 答错后一键标记错因</span></div>
            <div class="lv-hotkeys-row"><span class="lv-kbd">E</span><span>收藏 / 取消收藏本题</span></div>
            <div class="lv-hotkeys-row"><span class="lv-kbd">V</span><span>朗读本题题干（语音助记）</span></div>
            <div class="lv-hotkeys-row"><span class="lv-kbd">Space</span><span>背诵模式翻开答案 / 练习先回忆揭示</span></div>
            <div class="lv-hotkeys-row"><span class="lv-kbd">1</span> - <span class="lv-kbd">4</span><span>背诵模式四级自评（1重来 2困难 3良好 4熟练）</span></div>
            <div class="lv-hotkeys-row"><span class="lv-kbd">↑ / ↓</span><span>题库抽屉上一题 / 下一题连续翻阅</span></div>
            <div class="lv-hotkeys-row"><span class="lv-kbd">⌘K / Ctrl+K</span><span>随时呼出全局命令面板</span></div>
            <div class="lv-hotkeys-row"><span class="lv-kbd">?</span><span>打开 / 关闭本快捷键速查指南</span></div>
            <div class="lv-hotkeys-row"><span class="lv-kbd">Esc</span><span>退出当前会话 / 关闭详情抽屉与浮层</span></div>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .lv-pad { padding: var(--lv-space-4) 22px var(--lv-space-9); overflow: auto; }
  .lv-hotkeys-backdrop { position: fixed; inset: 0; z-index: 124; background: var(--lv-overlay); border: 0; padding: 0; cursor: pointer; backdrop-filter: blur(10px); animation: lv-appear var(--lv-dur-view, 0.22s) var(--lv-ease-out); }
  .lv-hotkeys-wrap { position: fixed; inset: 0; z-index: 125; display: grid; place-items: center; padding: 16px; pointer-events: none; animation: lv-appear var(--lv-dur-view, 0.22s) var(--lv-ease-out); }
  .lv-hotkeys-card { width: min(480px, 100%); pointer-events: auto; background: var(--lv-surface); border: 1px solid var(--lv-border); border-radius: var(--lv-r-card, 16px); box-shadow: var(--lv-sh-pop); padding: 22px; max-height: 85vh; overflow-y: auto; }
  .lv-hotkeys-grid { display: flex; flex-direction: column; gap: 8px; font-size: var(--lv-font-size-body-compact); }
  .lv-hotkeys-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px dashed var(--lv-border-subtle); }
  .lv-hotkeys-row:last-child { border-bottom: 0; }
  /* —— 出题工作区（与 R54 原型保持编辑/预览并置；窄屏自然回落单列） —— */
  .lv-studio-grid { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(300px, .92fr); gap: var(--lv-space-panel); align-items: start; }
  .lv-studio-grid > * { min-width: 0; }
  .lv-studio-form { margin: 8px 0; }
  .lv-preview-card { margin: 8px 0; position: sticky; top: 10px; }
  .lv-section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--lv-space-3); margin-bottom: 16px; }
  .lv-section-head h2 { margin: 2px 0 0; font-size: 17px; line-height: 1.4; }
  .lv-section-head .lv-eyebrow { display: block; font-size: 10px; letter-spacing: 1.4px; color: var(--lv-accent); font-weight: var(--lv-font-weight-semibold); }
  .lv-preview-face { border: 1px solid var(--lv-border); border-radius: var(--lv-r-2); background: var(--lv-surface-2); padding: 20px; }
  .lv-preview-face h3 { margin: 14px 0 18px; font-size: 18px; line-height: 1.7; font-weight: var(--lv-font-weight-semibold); white-space: pre-wrap; overflow-wrap: anywhere; }
  .lv-preview-options { display: grid; gap: var(--lv-space-2); }
  .lv-preview-option { display: flex; align-items: flex-start; gap: var(--lv-space-relaxed); min-height: 42px; padding: var(--lv-space-relaxed) var(--lv-space-3); border: 1px solid var(--lv-ctl-border); border-radius: 10px; background: var(--lv-surface); color: var(--lv-text-2); line-height: 1.55; }
  .lv-preview-option.selected { border-color: var(--lv-accent); background: var(--lv-accent-soft); color: var(--lv-text); }
  .lv-preview-key { display: grid; place-items: center; width: 23px; height: 23px; flex: none; border-radius: 7px; border: 1px solid var(--lv-ctl-border); color: var(--lv-text-2); font-size: var(--lv-font-size-sm); font-weight: var(--lv-font-weight-semibold); }
  .lv-preview-option.selected .lv-preview-key { border-color: transparent; color: var(--lv-accent); background: var(--lv-surface); }
  .lv-preview-answer { margin-top: 16px; padding: 13px 15px; border-left: 3px solid var(--lv-accent); border-radius: 0 9px 9px 0; background: var(--lv-surface); color: var(--lv-text-2); }
  .lv-preview-answer strong { color: var(--lv-text); font-size: var(--lv-font-size-sm); }
  .lv-preview-answer p { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.65; }
  .lv-preview-answer small { display: block; margin-top: 8px; color: var(--lv-text-3); white-space: pre-wrap; line-height: 1.55; }
  .lv-preview-fill, .lv-preview-short { margin: 12px 0; display: grid; gap: 8px; }
  .lv-preview-blanks { display: grid; gap: 8px; }
  .lv-preview-blank-row { display: flex; align-items: center; gap: 8px; }
  .lv-preview-blank-row .lv-input { flex: 1; cursor: default; }
  .lv-preview-spec-hint { font-size: var(--lv-font-size-caption, 12px); color: var(--lv-accent); background: var(--lv-accent-soft); padding: 4px 10px; border-radius: 6px; display: inline-block; }
  .lv-preview-meta { display: flex; flex-wrap: wrap; gap: var(--lv-space-compact); margin-top: 15px; color: var(--lv-text-3); font-size: var(--lv-font-size-caption); }
  .lv-preview-meta span { padding: 3px 8px; border-radius: 6px; background: var(--lv-surface); border: 1px solid var(--lv-border); }
  .lv-preview-note { margin: 12px 2px 0; line-height: 1.55; }
  .lv-studio-grid--ai { grid-template-columns: minmax(0, .86fr) minmax(0, 1.14fr); }
  .lv-ai-source-card { margin: 8px 0; box-shadow: var(--lv-sh-card), var(--lv-inset-highlight, inset 0 1px 0 transparent); border-radius: var(--lv-r-3); border: 1px solid var(--lv-border-subtle, var(--lv-border)); }
  .lv-ai-review { min-width: 0; }
  .lv-ai-review > .lv-card { margin: 8px 0; }
  .lv-ai-review .lv-qrow { margin-bottom: 12px; border: 1px solid var(--lv-border-subtle, var(--lv-border)); box-shadow: var(--lv-sh-1), var(--lv-inset-subtle, inset 0 1px 0 transparent); transition: transform var(--lv-dur-micro) var(--lv-ease-out), box-shadow var(--lv-dur-micro) var(--lv-ease-out), border-color var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-ai-review .lv-qrow:hover { transform: translateY(-2px); border-color: var(--lv-border-hover, var(--lv-accent)); box-shadow: var(--lv-sh-2); }
  .lv-ai-empty { min-height: 220px; display: grid; place-items: center; align-content: center; text-align: center; padding: 36px 24px; border-radius: var(--lv-r-3); border: 1.5px dashed var(--lv-border); background: color-mix(in srgb, var(--lv-surface-2) 40%, var(--lv-surface)); }
  .lv-ai-empty b { margin-top: 14px; font-size: var(--lv-font-size-h3); font-weight: var(--lv-font-weight-bold); color: var(--lv-text); }
  .lv-ai-empty p { max-width: 400px; margin: 8px auto 0; line-height: 1.65; color: var(--lv-text-3); }
  .lv-materials-workspace { display: grid; grid-template-columns: minmax(220px, .36fr) minmax(0, .64fr); gap: var(--lv-space-panel); align-items: start; margin-top: 14px; }
  .lv-material-list, .lv-material-detail { min-width: 0; }
  .lv-material-list { padding: 16px 12px; }
  .lv-material-list .lv-section-head { padding: 0 4px; margin-bottom: 10px; }
  .lv-material-item { width: 100%; display: flex; align-items: center; gap: 9px; padding: 10px 9px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: var(--lv-text); text-align: left; font: inherit; cursor: pointer; transition: background-color var(--lv-dur-micro) var(--lv-ease-out), border-color var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-material-item:hover { background: var(--lv-surface-2); border-color: var(--lv-border); }
  .lv-material-item.selected { background: var(--lv-accent-soft); border-color: color-mix(in srgb, var(--lv-accent) 35%, var(--lv-border)); }
  .lv-material-icon { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 8px; background: var(--lv-surface-2); color: var(--lv-accent); }
  .lv-material-item.selected .lv-material-icon { background: var(--lv-surface); }
  .lv-material-copy { min-width: 0; flex: 1; display: grid; gap: 3px; }
  .lv-material-copy b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--lv-font-size-body-compact); font-weight: 600; }
  .lv-material-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--lv-text-3); font-size: var(--lv-font-size-label); }
  .lv-material-count { color: var(--lv-text-3); font-size: var(--lv-font-size-label); }
  .lv-material-detail { padding: 20px 22px; }
  .lv-material-detail .lv-section-head h2 { overflow-wrap: anywhere; }
  .lv-material-tags { margin: -4px 0 14px; }
  .lv-material-locations { padding: 12px 14px; border: 1px solid var(--lv-border); border-radius: 10px; background: var(--lv-surface-2); }
  .lv-material-locations > b { display: block; margin-bottom: 8px; font-size: var(--lv-font-size-sm); }
  .lv-material-location { display: flex; align-items: flex-start; gap: 7px; padding: 5px 0; color: var(--lv-text-3); font-size: var(--lv-font-size-sm); line-height: 1.5; overflow-wrap: anywhere; }
  .lv-material-location + .lv-material-location { border-top: 1px dashed var(--lv-border); }
  .lv-material-actions { margin-top: 14px; }
  .lv-material-notes { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--lv-border); }
  .lv-material-notes .lv-section-head { margin-bottom: 10px; }
  .lv-material-note { padding: 11px 12px; border: 1px solid var(--lv-border); border-radius: var(--lv-radius-control-sm); background: var(--lv-surface-2); }
  .lv-material-note + .lv-material-note { margin-top: 8px; }
  .lv-material-note-text { margin: 8px 0; color: var(--lv-text); font-size: var(--lv-font-size-body-compact); line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
  .lv-material-note-empty { padding: 12px 0; }
  @container lv-exam (max-width: 820px) { .lv-materials-workspace { grid-template-columns: minmax(0, 1fr); } .lv-material-list { padding: 12px; } .lv-material-item { min-width: 0; } }
  @container lv-exam (max-width: 820px) {
    .lv-studio-grid, .lv-studio-grid--ai { grid-template-columns: minmax(0, 1fr); }
    .lv-preview-card { position: static; }
  }
  /* —— 会话屏右栏（原型 practice 布局：主纸面 + 条件卡） —— */
  .lv-session-grid { display: grid; grid-template-columns: minmax(0, 1fr) 248px; gap: var(--lv-space-5); align-items: start; max-width: 1040px; }
  .lv-session-grid .lv-session-head { grid-column: 1 / -1; }
  .lv-session-main { min-width: 0; }
  .lv-session-main .lv-card { max-width: 660px; box-shadow: var(--lv-sh-card), var(--lv-inset-highlight, inset 0 1px 0 transparent); border-radius: var(--lv-r-3); border: 1px solid var(--lv-border-subtle, var(--lv-border)); }
  .lv-side-card { padding: var(--lv-space-4) var(--lv-space-panel); margin-bottom: 14px; }
  .lv-side-title { display: block; font-size: var(--lv-font-size-md); font-weight: var(--lv-font-weight-semibold); margin-bottom: 10px; }
  .lv-side-rows { display: flex; flex-wrap: wrap; gap: var(--lv-space-compact); }
  @container lv-exam (max-width: 960px) { .lv-session-grid { grid-template-columns: minmax(0, 1fr); } .lv-session-side { order: 2; } }
  /* —— 入口 hero 卡（对齐原型 home 首屏；600px 下折叠单列） —— */
  .lv-entry-overview { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: var(--lv-space-loose); align-items: stretch; margin-bottom: 18px; }
  .lv-entry-hero { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 24px; align-items: center; padding: 26px 28px; position: relative; overflow: hidden; background: linear-gradient(135deg, var(--lv-accent-soft) 0%, color-mix(in srgb, var(--lv-accent-soft) 35%, var(--lv-surface)) 100%); border-color: color-mix(in srgb, var(--lv-accent) 22%, var(--lv-border)); }
  .lv-entry-hero::after { content: ''; position: absolute; right: -80px; top: -80px; width: 260px; height: 260px; border-radius: var(--lv-radius-round); background: radial-gradient(closest-side, color-mix(in srgb, var(--lv-accent) 12%, transparent), transparent); pointer-events: none; }
  .lv-entry-main { min-width: 0; }
  .lv-entry-reason { font-size: 22px; font-weight: var(--lv-font-weight-semibold); letter-spacing: -.4px; line-height: 1.5; margin: 10px 0; overflow-wrap: anywhere; }
  .lv-entry-num { border-left: 1px solid var(--lv-border); padding: 5px 0 5px 28px; display: flex; flex-direction: column; gap: 7px; align-self: stretch; justify-content: center; }
  .lv-entry-countwrap { display: flex; align-items: baseline; gap: var(--lv-space-2); }
  .lv-entry-count { font-size: var(--lv-font-size-display); font-weight: var(--lv-font-weight-semibold); letter-spacing: -2px; line-height: 1.05; font-variant-numeric: tabular-nums; }
  .lv-entry-unit { font-size: var(--lv-font-size-sm); color: var(--lv-text-3); }
  .lv-entry-label { font-size: var(--lv-font-size-label); letter-spacing: 0.6px; color: var(--lv-text-3); }
  .lv-entry-week { display: flex; flex-direction: column; justify-content: center; min-width: 0; padding: 18px 16px; }
  .lv-entry-week-head { display: flex; align-items: center; justify-content: space-between; gap: var(--lv-space-2); font-size: var(--lv-font-size-body-compact); }
  .lv-week-strip { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: var(--lv-space-1); margin: 16px 0 12px; }
  .lv-week-day { min-width: 0; display: grid; justify-items: center; gap: 5px; color: var(--lv-text-3); font-size: 10px; }
  .lv-week-count { display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--lv-radius-round); background: var(--lv-surface-2); color: var(--lv-text-2); font-size: 10px; font-variant-numeric: tabular-nums; }
  .lv-week-count.has-attempts { background: color-mix(in srgb, var(--lv-accent) var(--lv-week-fill), var(--lv-accent-soft)); color: var(--lv-accent-deep); }
  .lv-week-day.is-today .lv-week-count { box-shadow: 0 0 0 1.5px var(--lv-accent), 0 2px 6px color-mix(in srgb, var(--lv-accent) 24%, transparent); }
  .lv-week-day .today-text { color: var(--lv-accent); font-weight: 700; }
  .lv-entry-week p { margin: 0; font-size: var(--lv-font-size-label); line-height: 1.5; }
  @container lv-exam (max-width: 960px) { .lv-entry-overview { grid-template-columns: minmax(0, 1fr); } }
  /* 原型 .hero-actions：主操作在 hero 卡内部 */
  .lv-hero-actions { margin-top: 18px; }
  .lv-hero-actions .lv-btn--primary { box-shadow: 0 3px 10px color-mix(in srgb, var(--b3-theme-primary) 24%, transparent); }
  @container lv-exam (max-width: 600px) {
    .lv-entry-hero { grid-template-columns: minmax(0,1fr); padding: 18px; }
    .lv-entry-num { border-left: 0; border-top: 1px solid var(--lv-border); padding: 12px 0 0; flex-direction: row; align-items: baseline; gap: var(--lv-space-relaxed); justify-content: flex-start; }
  }
  .lv-center { display: flex; align-items: center; justify-content: center; min-height: 60%; }
  /* —— 视图切换（对齐原型 .subnav：文字 + 底部 2px 指示条，非按钮块） —— */
  .lv-card { background: var(--lv-surface); border: 1px solid var(--lv-border-subtle, var(--lv-border)); border-radius: var(--lv-r-3); padding: var(--lv-space-5) 22px; box-shadow: var(--lv-sh-card, var(--lv-sh-1)), var(--lv-inset-highlight, inset 0 1px 0 transparent); transition: box-shadow var(--lv-dur-view) var(--lv-ease-out), transform var(--lv-dur-micro) var(--lv-ease-out), border-color var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-pad-card { margin: 8px 0; }
  .lv-guard { max-width: 460px; width: 100%; }
  .lv-guard--welcome { max-width: 760px; }
  .lv-guard-kicker { display: inline-flex; align-items: center; gap: 7px; color: var(--lv-accent); font-size: var(--lv-font-size-sm); font-weight: var(--lv-font-weight-semibold); margin-bottom: 8px; }
  .lv-guard-title { font-size: 16px; font-weight: var(--lv-font-weight-bold); margin-bottom: 8px; }
  /* —— 结算三联数据（规范 v6 指标语言：大数字 + 标签，语义色只上数字） —— */
  .lv-done-stats { display: grid; grid-template-columns: repeat(3, 1fr); margin: 10px 0 6px; }
  .lv-done-stats > div { display: grid; gap: 2px; justify-items: center; padding: 6px 0; }
  .lv-done-stats > div + div { border-left: 1px solid var(--lv-border); }
  .lv-done-stats strong { font-size: var(--lv-font-size-kpi-mobile); font-weight: var(--lv-font-weight-bold); letter-spacing: -0.02em; }
  .lv-done-stats span { font-size: var(--lv-font-size-label); color: var(--lv-text-3); }
  .lv-done-stats .good strong { color: var(--lv-green); }
  .lv-done-stats .bad strong { color: var(--lv-red); }
  .lv-guard p { margin: 6px 0; }
  .lv-center-text { justify-content: center; }
  .lv-hint { font-size: var(--lv-font-size-sm); color: var(--lv-text-3); text-align: center; }
  .lv-guard-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--lv-space-relaxed); margin: 16px 0 4px; }
  .lv-guard-step { position: relative; min-width: 0; padding: 12px 13px; border: 1px solid var(--lv-border); border-radius: var(--lv-r-2); background: var(--lv-surface-2); }
  .lv-guard-step .lv-tile-icon { width: 30px; height: 30px; }
  .lv-guard-step b { display: block; margin-top: 8px; font-size: var(--lv-font-size-body-compact); }
  .lv-guard-step > span:last-child { display: block; margin-top: 4px; color: var(--lv-text-3); font-size: var(--lv-font-size-caption); line-height: 1.55; }
  .lv-guard-sample-detail { max-width: 620px; margin: 2px auto 0; line-height: 1.55; }
  .lv-input { min-height: var(--lv-control-height-md); padding: var(--lv-component-pad-md); border-radius: var(--lv-r-2); border: 1px solid var(--lv-ctl-border); background: var(--lv-surface); color: var(--lv-text); font: inherit; font-size: var(--lv-font-size-body); flex: 1; min-width: 140px; box-shadow: var(--lv-sh-1), var(--lv-inset-subtle, inset 0 1px 0 transparent); transition: border-color var(--lv-dur-micro) var(--lv-ease-out), box-shadow var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-input:hover:not(:disabled) { border-color: var(--lv-border-hover, var(--lv-accent)); }
  .lv-input:focus { border-color: var(--lv-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--lv-accent) 18%, transparent), var(--lv-inset-subtle, inset 0 1px 0 transparent); outline: none; }
  .lv-textarea { width: 100%; min-height: 90px; resize: vertical; line-height: 1.8; padding: 12px; margin: 6px 0; }
  /* .lv-btn/.lv-chip/.lv-select 外观基线上收 lv-base.scss（三 Tab 共用，暗色一致） */
  .lv-btn--ghost.acc-btn { color: var(--lv-accent); background: var(--lv-accent-soft); border-color: transparent; }
  .lv-onboard-title { display: inline-flex; align-items: center; gap: var(--lv-space-2); }
  /* —— 首用引导三步卡（规范 v6 onboard-steps） —— */
  .lv-onboard { flex-direction: column; align-items: stretch; }
  .lv-onboard-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--lv-space-loose); margin: 14px 0 0; padding: 0; list-style: none; }
  @container lv-exam (max-width: 960px) { .lv-onboard-steps { grid-template-columns: minmax(0, 1fr); } }
  .lv-onboard-step { position: relative; border: 1px solid var(--lv-border); border-radius: var(--lv-r-2); padding: 14px 16px; background: var(--lv-surface-2); }
  .lv-onboard-no { position: absolute; right: 12px; top: 8px; font-size: 26px; font-weight: var(--lv-font-weight-bold); letter-spacing: -0.02em; color: color-mix(in srgb, var(--b3-theme-primary) 26%, transparent); }
  .lv-onboard-step b { display: block; font-size: var(--lv-font-size-body); margin: 8px 0 0; }
  .lv-onboard-step-desc { margin-top: 5px; font-size: var(--lv-font-size-caption); line-height: 1.5; }
  @container lv-exam (max-width: 760px) { .lv-guard-steps { grid-template-columns: minmax(0, 1fr); } }
  .lv-mat-chip { display: inline-flex; align-items: center; gap: 5px; }
  .lv-modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--lv-space-loose); }
  .lv-mode { color: var(--lv-text); font: inherit; padding: 18px 20px; border-radius: var(--lv-r-3); text-align: left; background: var(--lv-surface); border: 1px solid var(--lv-border-subtle, var(--lv-border)); cursor: pointer; box-shadow: var(--lv-sh-card, var(--lv-sh-1)), var(--lv-inset-highlight, inset 0 1px 0 transparent); transition: background-color var(--lv-dur-micro) var(--lv-ease-out), border-color var(--lv-dur-micro) var(--lv-ease-out), box-shadow var(--lv-dur-view) var(--lv-ease-out), transform var(--lv-dur-micro) var(--lv-ease-out); display: flex; align-items: flex-start; gap: var(--lv-space-3); }
  .lv-mode:hover:not(:disabled) { box-shadow: var(--lv-sh-2); border-color: var(--lv-border-hover, var(--lv-accent)); background: color-mix(in srgb, var(--lv-accent-soft) 28%, var(--lv-surface)); transform: translateY(-2.5px); }
  .lv-mode:active:not(:disabled) { transform: translateY(-0.5px) scale(0.985); }
  .lv-mode .lv-mode-icon { color: var(--lv-accent); display: grid; place-items: center; width: 44px; height: 44px; border-radius: var(--lv-radius-icon); background: var(--lv-accent-soft); flex-shrink: 0; font-size: var(--lv-font-size-stat); box-shadow: 0 2px 8px color-mix(in srgb, var(--lv-accent) 18%, transparent); transition: transform var(--lv-dur-micro) var(--lv-ease-out), background-color var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-mode-icon--quick { background: var(--lv-amber-soft) !important; color: var(--lv-amber) !important; box-shadow: 0 2px 8px color-mix(in srgb, var(--lv-amber) 22%, transparent) !important; }
  .lv-mode-icon--daily { background: var(--lv-accent-soft) !important; color: var(--lv-accent) !important; box-shadow: 0 2px 8px color-mix(in srgb, var(--lv-accent) 22%, transparent) !important; }
  .lv-mode-icon--wrong { background: var(--lv-red-soft) !important; color: var(--lv-red) !important; box-shadow: 0 2px 8px color-mix(in srgb, var(--lv-red) 22%, transparent) !important; }
  .lv-mode-icon--recite { background: color-mix(in srgb, var(--lv-accent) 15%, transparent) !important; color: var(--lv-accent) !important; box-shadow: var(--lv-sh-1) !important; }
  .lv-mode-icon--cram { background: color-mix(in srgb, var(--lv-amber) 24%, var(--lv-red-soft)) !important; color: var(--lv-red) !important; box-shadow: 0 2px 8px color-mix(in srgb, var(--lv-red) 16%, transparent) !important; }
  .lv-mode-icon--fav { background: color-mix(in srgb, var(--lv-amber) 20%, transparent) !important; color: var(--lv-amber) !important; box-shadow: var(--lv-sh-1) !important; }
  .lv-mode:hover:not(:disabled) .lv-mode-icon { transform: scale(1.06); background: color-mix(in srgb, var(--lv-accent) 16%, var(--lv-surface)); }
  .lv-mode .lv-mode-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .lv-mode b { font-size: var(--lv-font-size-md); font-weight: var(--lv-font-weight-semibold); letter-spacing: -0.01em; }
  .lv-mode:disabled { opacity: .62; cursor: not-allowed; }
  /* 低频模式降噪：中性键帽 + 收紧字号，与一级队列模式拉开层级 */
  .lv-mode--minor .lv-mode-icon { background: var(--lv-surface-2); color: var(--lv-text-2); box-shadow: var(--lv-sh-1); }
  .lv-mode--minor:hover:not(:disabled) .lv-mode-icon { background: color-mix(in srgb, var(--lv-text) 8%, var(--lv-surface-2)); }
  .lv-mode--minor b { font-size: var(--lv-font-size-body-compact); font-weight: 600; }
  .lv-resume { display: flex; gap: var(--lv-space-loose); align-items: center; padding: 18px 22px; border-radius: var(--lv-r-3); border-left: 4px solid var(--lv-accent); background: color-mix(in srgb, var(--lv-accent-soft) 40%, var(--lv-surface)); box-shadow: var(--lv-sh-1), var(--lv-inset-highlight, inset 0 1px 0 transparent); }
  .lv-resume > div:first-child { flex: 1; }
  .lv-session-head { justify-content: flex-start; }
  @container lv-exam (max-width: 600px) {
    .lv-pad { padding: 12px 14px 36px; }
    .lv-session-head { gap: var(--lv-space-compact); align-items: center; }
    .lv-session-head .lv-progress { min-width: 56px; }
    .lv-session-head > .lv-chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lv-answer-actions { align-items: stretch; }
    .lv-answer-actions > .lv-btn { flex: 1 1 auto; min-width: 0; }
    .lv-rate { grid-template-columns: repeat(2, 1fr); gap: var(--lv-space-2); }
  }
  .lv-pure .lv-stem, .lv-pure .lv-opt > span:not(.key) { display: none; }
  .lv-pure .lv-opt .key { filter: none; }
  .lv-pure .lv-opt { justify-content: center; }
  .lv-question { margin-top: 10px; }
  .lv-stem { font-size: 20px; line-height: 1.75; font-weight: var(--lv-font-weight-medium); letter-spacing: -0.015em; margin-bottom: 18px; white-space: pre-wrap; }
  .lv-opt { display: flex; gap: 14px; align-items: center; width: 100%; text-align: left; padding: 15px 18px; border-radius: var(--lv-r-2); border: 1.5px solid var(--lv-ctl-border); margin-bottom: 11px; cursor: pointer; background: var(--lv-surface); font: inherit; color: inherit; box-shadow: var(--lv-sh-1), var(--lv-inset-subtle, inset 0 1px 0 transparent); transition: background-color var(--lv-dur-micro) ease, border-color var(--lv-dur-micro) ease, box-shadow var(--lv-dur-micro) ease, transform var(--lv-dur-micro) ease; }
  .lv-opt:hover:not([disabled]) { border-color: var(--lv-border-hover, var(--lv-accent)); background: color-mix(in srgb, var(--lv-accent) 4.5%, var(--lv-surface)); transform: translateY(-1px) translateX(2px); box-shadow: var(--lv-sh-2); }
  .lv-opt:active:not([disabled]) { transform: scale(0.985); }
  .lv-opt .key { width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center; flex: none; font-size: 13px; font-weight: var(--lv-font-weight-bold, 700); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: var(--lv-surface-2); color: var(--lv-text-2); border: 1px solid var(--lv-border); box-shadow: var(--lv-keycap-shadow); transition: background-color var(--lv-dur-micro) ease, border-color var(--lv-dur-micro) ease, color var(--lv-dur-micro) ease, transform var(--lv-dur-micro) ease; }
  /* —— 选项圆点指示（规范 v6 .option：radio 圆 / checkbox 方；随四态着色） —— */
  .lv-opt-check { width: 18px; height: 18px; border-radius: var(--lv-radius-round); border: 1.5px solid var(--lv-ctl-border); background: var(--lv-surface); flex: none; display: grid; place-items: center; transition: background-color var(--lv-dur-micro) ease, border-color var(--lv-dur-micro) ease; }
  .lv-opt-check.box { border-radius: 5px; }
  .lv-opt-check::after { content: ""; width: 8px; height: 8px; border-radius: var(--lv-radius-round); background: var(--lv-on-accent, var(--b3-theme-on-primary, #fff)); transform: scale(0); transition: transform var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-opt-check.box::after { border-radius: 1.5px; }
  .lv-opt.sel .lv-opt-check, .lv-opt.right .lv-opt-check, .lv-opt.wrong .lv-opt-check { border-color: transparent; }
  .lv-opt.sel .lv-opt-check { background: var(--lv-accent); }
  .lv-opt.right .lv-opt-check { background: var(--lv-green); }
  .lv-opt.wrong .lv-opt-check { background: var(--lv-red); }
  .lv-opt.sel .lv-opt-check::after, .lv-opt.right .lv-opt-check::after, .lv-opt.wrong .lv-opt-check::after { transform: scale(1); }
  .lv-opt.sel { border-color: var(--lv-accent); background: color-mix(in srgb, var(--lv-accent-soft) 85%, var(--lv-surface)); box-shadow: 0 0 0 1px var(--lv-accent), 0 4px 14px color-mix(in srgb, var(--lv-accent) 18%, transparent); }
  .lv-opt.sel .key { background: var(--lv-accent); border-color: var(--lv-accent); color: var(--lv-on-accent, var(--b3-theme-on-primary, #fff)); box-shadow: 0 2px 8px color-mix(in srgb, var(--lv-accent) 28%, transparent); transform: scale(1.04); }
  .lv-opt.right { border-color: var(--lv-green); background: var(--lv-green-soft); box-shadow: 0 0 0 1px var(--lv-green), 0 4px 14px color-mix(in srgb, var(--lv-green) 18%, transparent); }
  .lv-opt.right .key { background: var(--lv-green); border-color: var(--lv-green); color: var(--lv-on-green, var(--b3-theme-on-primary, #fff)); }
  .lv-opt.wrong { border-color: var(--lv-red); background: var(--lv-red-soft); box-shadow: 0 0 0 1px var(--lv-red), 0 4px 14px color-mix(in srgb, var(--lv-red) 18%, transparent); }
  .lv-opt.wrong .key { background: var(--lv-red); border-color: var(--lv-red); color: var(--lv-on-red, var(--b3-theme-on-primary, #fff)); }
  .lv-feedback { margin: 16px 0 12px; padding: 15px 18px; border: 1px solid color-mix(in srgb, var(--lv-red) 26%, var(--lv-border)); border-left: 4px solid var(--lv-red); border-radius: var(--lv-r-2); font-weight: var(--lv-font-weight-semibold); font-size: var(--lv-font-size-md); background: color-mix(in srgb, var(--lv-red-soft) 85%, var(--lv-surface)); color: var(--lv-red); box-shadow: 0 2px 10px color-mix(in srgb, var(--lv-red) 12%, transparent); animation: lv-appear var(--lv-dur-view) var(--lv-ease-out); }
  .lv-feedback.good { border-color: color-mix(in srgb, var(--lv-green) 26%, var(--lv-border)); border-left-color: var(--lv-green); background: color-mix(in srgb, var(--lv-green-soft) 85%, var(--lv-surface)); color: var(--lv-green); box-shadow: 0 2px 10px color-mix(in srgb, var(--lv-green) 12%, transparent); }
  /* —— 作答动作区（原型 .answer-actions：上分隔线 + 层次） —— */
  .lv-answer-actions { margin-top: 14px; padding-top: 18px; border-top: 1px solid var(--lv-border); }
  /* —— 改答原因弹层（63-03：轻量内联，不阻断作答） —— */
  .lv-reason { margin: 8px 0 0; padding: 10px 14px; border-radius: var(--lv-r-2); border: 1px solid var(--lv-border-subtle, var(--lv-border)); border-left: 3.5px solid var(--lv-amber); background: color-mix(in srgb, var(--lv-amber-soft) 35%, var(--lv-surface)); box-shadow: var(--lv-sh-1), var(--lv-inset-subtle, inset 0 1px 0 transparent); }
  /* —— 结构化作答框（54 第三刀：数值单行 / 多空逐空） —— */
  .lv-answer-num { min-height: 48px; font-size: 16px; font-variant-numeric: tabular-nums; }
  .lv-answer-blank { min-height: 44px; margin-bottom: 10px; }
  .lv-analysis { border-left: 3px solid var(--lv-accent); background: var(--lv-surface-2); border-radius: 0 var(--lv-r-2) var(--lv-r-2) 0; padding: var(--lv-space-3) var(--lv-space-4); font-size: var(--lv-font-size-body); color: var(--lv-text-2); margin-bottom: 10px; white-space: pre-wrap; }
  .lv-success { margin: 8px 0; padding: 10px 14px; border-radius: var(--lv-r-2); background: var(--lv-green-soft); color: var(--lv-green); font-size: var(--lv-font-size-body-compact); font-weight: var(--lv-font-weight-semibold); }
  .lv-error-row { font-size: var(--lv-font-size-meta); color: var(--lv-red); padding: 4px 2px; border-bottom: 1px dashed var(--lv-border); }
  .lv-empty { border-radius: var(--lv-r-3); padding: 52px 24px; text-align: center; color: var(--lv-text-3); font-size: var(--lv-font-size-body); background: color-mix(in srgb, var(--lv-surface-2) 40%, var(--lv-surface)); border: 1.5px dashed var(--lv-border); }
  .lv-empty-icon { display: grid; place-items: center; width: 60px; height: 60px; margin: 0 auto; border-radius: 18px; background: var(--lv-accent-soft); color: var(--lv-accent); box-shadow: 0 4px 16px color-mix(in srgb, var(--lv-accent) 18%, transparent); }
  .lv-empty b { display: block; font-size: 18px; font-weight: var(--lv-font-weight-bold); color: var(--lv-text); margin: 16px 0 8px; letter-spacing: -0.01em; }
  .lv-empty .lv-muted { max-width: 440px; margin: 0 auto; line-height: 1.65; }
  /* —— 错题本视图（规范 v6 §6）：指标联排 + 双栏 + 队列行 —— */
  .lv-shell-grid { display: grid; grid-template-columns: minmax(0, 1fr) 288px; gap: var(--lv-space-5); align-items: start; }
  @container lv-exam (max-width: 960px) { .lv-shell-grid { grid-template-columns: minmax(0, 1fr); } }
  /* 嵌套网格链路逐级解除 min-width:auto（否则窄屏 min-content 404 撑破轨道） */
  .lv-shell-grid > .stack { min-width: 0; }
  .lv-shell-grid > .stack > .lv-card { min-width: 0; }
  .lv-block-title { display: block; font-size: var(--lv-font-size-h3); font-weight: var(--lv-font-weight-semibold); letter-spacing: -0.2px; }
  .stack { display: grid; gap: var(--lv-space-4); align-content: start; min-width: 0; }
  .stack-sm { display: grid; gap: var(--lv-space-2); }
  .task-number { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; border: 1px solid var(--lv-border); background: var(--lv-surface-2); color: var(--lv-accent); font-size: var(--lv-font-size-sm); font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .lv-skeleton { height: 180px; border-radius: var(--lv-r-3); background: linear-gradient(100deg, var(--lv-surface-2) 40%, var(--lv-surface) 50%, var(--lv-surface-2) 60%); background-size: 200% 100%; animation: lv-shimmer 1.4s infinite; border: 1px solid var(--lv-border); }
  @keyframes lv-shimmer { to { background-position: -200% 0; } }
  .lv-qrow { padding: 14px 18px; margin-bottom: 9px; border: 1px solid var(--lv-border-subtle, var(--lv-border)); border-radius: var(--lv-r-2); background: var(--lv-surface); box-shadow: var(--lv-sh-1), var(--lv-inset-subtle, inset 0 1px 0 transparent); transition: transform var(--lv-dur-micro) var(--lv-ease-out), border-color var(--lv-dur-micro) var(--lv-ease-out), background-color var(--lv-dur-micro) var(--lv-ease-out), box-shadow var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-qrow:hover { transform: translateY(-1px); border-color: var(--lv-border-hover, var(--lv-accent)); box-shadow: var(--lv-sh-2); }
  /* 行头可点可供养：hover 浅底 + 手型；批量模式选中行 accent 描边 */
  .lv-qrow-head { display: flex; gap: var(--lv-space-2); align-items: center; width: calc(100% + 16px); margin: -4px -8px 4px; padding: 4px 8px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; flex-wrap: wrap; transition: background-color var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-qrow-head:hover { background: var(--lv-surface-2); }
  .lv-qrow.sel { border-color: var(--lv-accent); background: var(--lv-accent-soft); box-shadow: 0 2px 8px color-mix(in srgb, var(--lv-accent) 15%, transparent); }
  .lv-qrow-src { margin-left: auto; font-size: var(--lv-font-size-caption); color: var(--lv-text-3); }
  .lv-qrow-stem { font-size: var(--lv-font-size-body); font-weight: var(--lv-font-weight-medium); color: var(--lv-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* —— 工具行「更多」菜单（浮层走卡片语言：surface + pop 阴影 + 38px 行） —— */
  .lv-more { position: relative; display: inline-flex; }
  .lv-more-dot { display: inline-block; width: 6px; height: 6px; margin-left: 5px; border-radius: var(--lv-radius-round); background: var(--lv-accent); }
  .lv-more-pop { position: absolute; top: calc(100% + 6px); right: 0; z-index: 40; min-width: 216px; padding: 6px; background: color-mix(in srgb, var(--lv-surface) 94%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid var(--lv-border-subtle, var(--lv-border)); border-radius: var(--lv-r-2); box-shadow: var(--lv-sh-pop), var(--lv-inset-highlight, inset 0 1px 0 transparent); display: grid; gap: 3px; animation: lv-pop-in var(--lv-dur-view) var(--lv-ease-out) both; }
  .lv-more-pop button { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 36px; padding: 7px 12px; border: 0; border-radius: 8px; background: transparent; color: var(--lv-text); font: inherit; font-size: var(--lv-font-size-body-compact); text-align: left; cursor: pointer; transition: background-color var(--lv-dur-micro) var(--lv-ease-out), color var(--lv-dur-micro) var(--lv-ease-out), transform var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-more-pop button:hover { background: var(--lv-accent-soft); color: var(--lv-accent); transform: translateX(2px); }
  .lv-more-pop button[aria-checked="true"] { color: var(--lv-accent); font-weight: 600; background: color-mix(in srgb, var(--lv-accent-soft) 80%, transparent); }
  .lv-more-sep { height: 1px; margin: 4px 6px; background: var(--lv-border); }
  .lv-rate { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 14px; }
  .lv-reason-btn { padding: 4px 10px; border-radius: var(--lv-r-1); cursor: pointer; touch-action: manipulation; transition: transform var(--lv-dur-micro) ease, background-color var(--lv-dur-micro) ease, border-color var(--lv-dur-micro) ease; }
  .lv-reason-btn:hover { transform: translateY(-1px); border-color: var(--lv-accent); }
  .lv-reason-btn:active { transform: scale(0.96); }
  .lv-reason-key { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 4px; margin-right: 4px; font-size: 10px; font-weight: 700; font-family: ui-monospace, monospace; background: color-mix(in srgb, var(--lv-text) 10%, transparent); color: var(--lv-text-2); }
  .lv-recite-revealed { animation: lv-appear var(--lv-dur-view, 0.22s) var(--lv-ease-out); }
  .lv-rate .lv-btn { justify-content: center; min-height: 48px; padding: 10px 14px; font-weight: var(--lv-font-weight-semibold); box-shadow: var(--lv-sh-1), var(--lv-inset-subtle, inset 0 1px 0 transparent); transition: background-color var(--lv-dur-micro) ease, border-color var(--lv-dur-micro) ease, color var(--lv-dur-micro) ease, transform var(--lv-dur-micro) ease, box-shadow var(--lv-dur-micro) ease; }
  .lv-rate .lv-btn:active:not(:disabled) { transform: scale(0.97); }
  /* 语义键帽常显（Anki 现代改造融合）：数字块随等级着色，按钮本体保持中性 */
  .lv-rate-key { display: inline-grid; place-items: center; width: 22px; height: 22px; margin-right: 6px; border-radius: 7px; font-size: var(--lv-font-size-label); font-weight: var(--lv-font-weight-bold); font-variant-numeric: tabular-nums; font-family: ui-monospace, monospace; color: var(--lv-text-2); background: var(--lv-surface-2); border: 1px solid var(--lv-border); box-shadow: var(--lv-keycap-shadow); transition: background-color var(--lv-dur-micro) var(--lv-ease-out), color var(--lv-dur-micro) var(--lv-ease-out), border-color var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-rate .r1 .lv-rate-key { color: var(--lv-red); background: var(--lv-red-soft); border-color: transparent; }
  .lv-rate .r2 .lv-rate-key { color: var(--lv-amber); background: var(--lv-amber-soft); border-color: transparent; }
  .lv-rate .r3 .lv-rate-key { color: var(--lv-green); background: var(--lv-green-soft); border-color: transparent; }
  .lv-rate .r4 .lv-rate-key { color: var(--lv-accent); background: var(--lv-accent-soft); border-color: transparent; }
  .lv-rate .r1:hover { border-color: var(--lv-red); color: var(--lv-red); background: color-mix(in srgb, var(--lv-red-soft) 60%, var(--lv-surface)); box-shadow: 0 4px 12px color-mix(in srgb, var(--lv-red) 18%, transparent); }
  .lv-rate .r2:hover { border-color: var(--lv-amber); color: var(--lv-amber); background: color-mix(in srgb, var(--lv-amber-soft) 60%, var(--lv-surface)); box-shadow: 0 4px 12px color-mix(in srgb, var(--lv-amber) 18%, transparent); }
  .lv-rate .r3:hover { border-color: var(--lv-green); color: var(--lv-green); background: color-mix(in srgb, var(--lv-green-soft) 60%, var(--lv-surface)); box-shadow: 0 4px 12px color-mix(in srgb, var(--lv-green) 18%, transparent); }
  .lv-rate .r4:hover { border-color: var(--lv-accent); color: var(--lv-accent); background: color-mix(in srgb, var(--lv-accent-soft) 60%, var(--lv-surface)); box-shadow: 0 4px 12px color-mix(in srgb, var(--lv-accent) 18%, transparent); }
  @container lv-exam (max-width: 960px) { .lv-modes { grid-template-columns: repeat(2, 1fr); } }
  @container lv-exam (max-width: 480px) { .lv-modes { grid-template-columns: 1fr; } }
  /* —— R54 原型高级交互：题目浏览 Peek 抽屉 (Desktop 右侧抽屉 / Mobile 底部 Sheet) —— */
  .lv-studio-nav { display: inline-flex; align-items: center; gap: 4px; padding: 4px; margin: 6px 0 14px; background: var(--lv-surface-2); border: 1px solid var(--lv-border); border-radius: var(--lv-r-card, 12px); max-width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; box-shadow: var(--lv-inset-subtle, inset 0 1px 0 transparent); }
  .lv-studio-nav::-webkit-scrollbar { display: none; }
  .lv-studio-tab { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--lv-text-2); font: inherit; font-size: var(--lv-font-size-body-compact, 13px); font-weight: var(--lv-font-weight-medium, 500); cursor: pointer; white-space: nowrap; transition: background-color var(--lv-dur-micro) var(--lv-ease-out), color var(--lv-dur-micro) var(--lv-ease-out), border-color var(--lv-dur-micro) var(--lv-ease-out), box-shadow var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-studio-tab:hover { color: var(--lv-text); background: color-mix(in srgb, var(--lv-surface) 60%, transparent); }
  .lv-studio-tab.active { background: var(--lv-surface); color: var(--lv-accent); border-color: var(--lv-border); box-shadow: var(--lv-sh-1), var(--lv-inset-highlight, inset 0 1px 0 transparent); font-weight: var(--lv-font-weight-semibold, 600); }
  .lv-qrow.active-peek { border-color: var(--lv-accent); border-left: 3.5px solid var(--lv-accent); background: color-mix(in srgb, var(--lv-accent-soft) 35%, var(--lv-surface)); box-shadow: 0 4px 16px color-mix(in srgb, var(--lv-accent) 18%, transparent); }
  .lv-peek-backdrop { position: fixed; inset: 0; background: var(--lv-overlay); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); z-index: 120; animation: lv-fade-in var(--lv-dur-fast, 0.18s) ease-out; }
  .lv-peek-sheet-handle { display: none; width: 36px; height: 4px; border-radius: 2px; background: var(--lv-border); margin: 8px auto 2px; }
  .lv-peek-drawer { position: fixed; top: 12px; right: 14px; bottom: 14px; width: min(520px, calc(100vw - 28px)); max-width: 560px; z-index: 121; background: var(--lv-surface); border: 1px solid var(--lv-border); border-radius: var(--lv-r-card, 16px); box-shadow: var(--lv-sh-pop), var(--lv-inset-highlight, inset 0 1px 0 transparent); display: flex; flex-direction: column; overflow: hidden; animation: lv-slide-left var(--lv-dur-view, 0.22s) var(--lv-ease-out); }
  .lv-peek-head { display: flex; align-items: center; justify-content: space-between; gap: var(--lv-space-2); padding: 14px 18px; border-bottom: 1px solid var(--lv-border); background: var(--lv-surface-2); flex-shrink: 0; }
  .lv-peek-src { font-size: var(--lv-font-size-caption); color: var(--lv-text-3); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lv-peek-head .lv-btn { min-width: 44px; min-height: 44px; }
  .lv-peek-close { width: 44px; height: 44px; padding: 0; display: grid; place-items: center; border-radius: 8px; font-size: 14px; }
  .lv-peek-body { flex: 1; min-height: 0; padding: 18px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
  .lv-peek-stem { font-size: 17px; font-weight: var(--lv-font-weight-semibold, 600); line-height: 1.6; color: var(--lv-text); overflow-wrap: anywhere; }
  .lv-peek-footer { display: flex; align-items: center; gap: 8px; justify-content: flex-end; padding: 12px 18px; border-top: 1px solid var(--lv-border); background: var(--lv-surface-2); flex-shrink: 0; }
  @keyframes lv-slide-left { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes lv-slide-up { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes lv-fade-in { from { opacity: 0; } to { opacity: 1; } }
  @container lv-exam (max-width: 759px) {
    .lv-peek-sheet-handle { display: block; }
    .lv-peek-drawer { top: auto; left: 0; right: 0; bottom: 0; width: 100%; max-height: 88vh; border-radius: var(--lv-r-card, 18px) var(--lv-r-card, 18px) 0 0; border-bottom: 0; padding-bottom: max(6px, env(safe-area-inset-bottom)); animation: lv-slide-up var(--lv-dur-view, 0.22s) var(--lv-ease-out); }
    .lv-peek-close { width: 44px; height: 44px; min-width: 44px; min-height: 44px; }
    .lv-peek-footer { padding-bottom: max(12px, env(safe-area-inset-bottom)); }
  }
  @media (prefers-reduced-motion: reduce) { .lv-skeleton { animation: none; } .lv-mode, .lv-btn, .lv-opt, .lv-peek-drawer, .lv-peek-backdrop { transition: none; animation: none; } }
</style>
