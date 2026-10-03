<script lang="ts">
    // 练习台：入口(S1) / 会话(S2) / 浏览(S3) / 导入(S9) 四视图
    // 状态设计（docs/11）：loading/empty(守卫)/error/normal 四态可达
    import { onMount } from "svelte";
import { showMessage } from "siyuan";
    import { planToday, parseExamProfiles, nearestUpcoming, nextPlanTrace } from "@/core/planner";
import { ttsSpeak } from "@/core/tts";
    import type { ExamApp } from "../../app";
    import type { Question } from "../../core/types";
    import { parseText, parseExcelRows, autoMapExcel, errorsToCsv, extractTextRowAt, type ImportReport } from "../../importer/pipeline";
    import { groupAdjacent } from "../../core/session";
    import { makeQuestion } from "../../core/blockTemplate";
    import { normalizeAnswer, questionHash } from "../../core/answer";
    import { validate } from "../../importer/pipeline";
    import { bankHealthReport, coverageStats, type BankHealthReport } from "../../core/bankHealth";
    import { planBatchEdit, invertPlan, describeChange } from "../../core/batchEdit";
    import { buildSectionTree, questionInSection } from "../../core/sectionTree";
    import { upsertView, viewBankMismatch } from "@/core/smartViews";
    import { avgMsByType, estimatePlanMinutes } from "@/core/timeBudget";
    import { kpAudit, planKpMerge, planEmptyKpFill } from "@/core/kpGovernance";
    import { probeCheckinApi, syncCheckin, localDateKeyOf, bridgeEnabled, fetchStreak } from "@/core/checkinBridge";
    import { probeGlean, listLaterClips, formatClipsForSource } from "@/core/gleanBridge";
    import { onExamEvent, emitExamEvent } from "@/core/bus";
    import { escapeHtml } from "../../libs/sanitize";
    import { questionFingerprint } from "@/ai/task";
    import SaveStatus from "../shared/SaveStatus.svelte";

    let { plugin, examApp: app }: { plugin: any; examApp: ExamApp } = $props();
    const i18n = $derived(plugin?.i18n ?? {});
    const t = (k: string, fb = "") => i18n[k] ?? fb;

    type View = "entry" | "session" | "browse" | "import" | "recite" | "manual" | "ai";
    let view: View = $state("entry");
    let loading = $state(true);
    let errorMsg = $state("");
    let banks = $state<any[]>([]);
    let activeBankId = $state("");
    let questions = $state<(Question & { blockId: string; rootId: string })[]>([]);
    let questionsError = $state("");

    // 背诵态（S4 lite）：盖答案 → 四级自评
    let reciteQueue = $state<Question[]>([]);
    let reciteCursor = $state(0);
    let reciteRevealed = $state(false);
    let reciteSessionId = $state("");
    let reciteDone = $state(false);
    let reciteHint = $state(0);
    let reciteRatings = $state<number[]>([]);

    // 会话态
    let session = $state<any>(null);
    let feedback = $state<null | { verdict: string; myAnswer: string | null }>(null);
    let selected = $state<string>("");
    let answerStart = $state(0);
    let sessionDone = $state<null | { total: number; correct: number; wrong: number }>(null);
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

    // 导入态
    let importText = $state("");
    let importReport = $state<ImportReport | null>(null);
    let importError = $state("");
    let committing = $state(false);
    /** 重复合并策略 lite（2.3）：并存=与题库已有题重复的行照常入库（批内去重仍生效）；覆盖策略挂 38-03 */
    let coexistDupe = $state(false);
    let importResult = $state<null | { written: number; confirmed: number; missing: number; verified: boolean; cancelled?: boolean }>(null);

    /** 答前置信自评（U12 最小）：随本次 attempt 落流水；提交后不可改写最初记录 */
    let confidenceSel = $state<"sure" | "fuzzy" | "guess" | "">("");

    // 题库健康（TODO 2.2）：重复聚类 + 缺字段清单（纯函数，浏览视图按需展开）
    let healthOpen = $state(false);
    const health = $derived<BankHealthReport | null>(healthOpen && questions.length ? bankHealthReport(questions) : null);
    /** 43-04 lite：生产者覆盖概览（与健康面板同开） */
    const coverage = $derived(healthOpen && questions.length ? coverageStats(questions) : null);

    // 每题用时显示 + 超时提示（TODO 13 组 lite）：会话作答期 1s tick；超时阈值取设置（0=关）
    let qTick = $state(0);
    $effect(() => {
      if (view !== "session" || feedback) return;
      const t = setInterval(() => { qTick++; }, 1000);
      return () => clearInterval(t);
    });
    const qElapsedS = $derived.by(() => { void qTick; return Math.max(0, Math.floor((Date.now() - answerStart) / 1000)); });
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
        content: t("import.rollbackConfirm").replace("{n}", String(n)).replace("{b}", batch.slice(0, 16)),
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
        const v = (await (app as any).deps.storage.load("batchedit/last")) as typeof batchUndo;
        batchUndo = v && Array.isArray(v.changes) ? v : null;
      } catch { batchUndo = null; }
    }
    async function saveBatchUndo() {
      try { await (app as any).deps.storage.save("batchedit/last", batchUndo); } catch { /* 静默 */ }
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
    const offline = $derived(!app.kernelOnline);
    /** onMount 注册的窗口事件监听清理（Svelte onMount 返回值与内部 async 冲突时用变量中转） */
    let onMountCleanup: (() => void) | null = null;
    onMount(() => () => { onMountCleanup?.(); onMountCleanup = null; });

    // ---------- 题目编辑（43-01 lite：块菜单「编辑」→ 浏览视图内联表单） ----------
    let editingId = $state("");
    let editBusy = $state(false);
    let editError = $state("");
    let editDraft = $state<{ stem: string; options: string[]; answer: string; analysis: string; kp: string; difficulty: string } | null>(null);

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
      };
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
      if (!app) { loading = false; errorMsg = t("state.appNotReady"); return; }
      void (async () => {
        try { explainHistory = ((await (app as any).deps.storage.load("ai/explain-history")) ?? {}) as Record<string, import("@/ai/client").AiMessage[]>; } catch { /* 忽略 */ }
        await restoreAiQueue();
        await loadMappings();
        await loadSmartViews();
        await loadBatchUndo();
        await loadAiTaskLog();
        void retryCheckinPending(); // 48-03：上次未写入的打卡事件原引用补写
        void loadCheckinStreak(); // 48-04 lite：桥开启时读连续天数（只读投影）
        // 45-06：恢复未提交的录题草稿（切视图/重载不丢输入）
        try {
          const d = (await (app as any).deps.storage.load("draft/manual")) as
            | { type: string; stem: string; options: string[]; answer: string; analysis: string; kp: string; source: string; group: string }
            | undefined;
          if (d?.stem?.trim()) {
            mType = (d.type as typeof mType) ?? "single";
            mStem = d.stem; mOptions = d.options?.length ? d.options : ["", ""];
            mAnswer = d.answer ?? ""; mAnalysis = d.analysis ?? "";
            mKp = d.kp ?? ""; mSource = d.source ?? ""; mGroup = d.group ?? "";
            draftRestored = true;
          }
        } catch { /* 草稿读取失败静默 */ }
      })();
      banks = app.listBanks();
      if (banks.length) activeBankId = banks[0].id;
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
        searchText = pid;
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
      const offs = [
        onExamEvent("open-question", onOpenQ),
        onExamEvent("open-in-browse", onBrowseQ),
        onExamEvent("edit-question", onEditQ),
      ];
      onMountCleanup = () => offs.forEach((off) => off());
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
      if (pending?.length && app.currentSession()?.phase !== "running") {
        (plugin as any).pendingPractice = undefined;
        app.startSession(pending, "query", activeBankId).then((s) => { session = s; view = "session"; loading = false; }).catch(() => { loading = false; });
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
      // 恢复未完成会话（37-05：校验题库归属，缺题剔除后提示）
      app.resumeSession(async (qids) => {
        const all = await loadQuestions();
        return qids.map((id) => all.find((q) => q.id === id)).filter(Boolean) as Question[];
      }, activeBankId).then((s) => {
        if (s) {
          s.advancePastAnswered();                       // 37-05：恢复跳过已答位置防双计
          if (s.allAnswered()) sessionDone = s.finish();
          session = s; view = "session";
          if (app.lastResumeMissing.length) showMessage(t("resume.missing").replace("{n}", String(app.lastResumeMissing.length)), 4200, "info");
        }
        rebuildPlan();
        loading = false;
      }).catch(() => { loading = false; });
    });

    async function loadQuestions(): Promise<Question[]> {
      if (!activeBankId) return [];
      questionsError = "";
      try {
        questions = await app.listQuestions(activeBankId);
        return questions;
      } catch (e) {
        questionsError = String(e instanceof Error ? e.message : e);
        return [];
      }
    }

    async function createBank() {
      if (!newBankName.trim() || creating) return;
      creating = true; errorMsg = "";
      try {
        const b = await app.createBank(newBankName);
        banks = app.listBanks();
        activeBankId = b.id;
        newBankName = "";
        view = "import"; // 建库后引导导入
      } catch (e) {
        errorMsg = offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e);
      } finally { creating = false; }
    }

    /** 移出题库管理（app.removeBank）：仅移出注册表，笔记本本体保留可手动删 */
    async function removeActiveBank() {
      if (!activeBankId) return;
      const { confirmDialogSync } = await import("../../libs/dialog");
      if (!(await confirmDialogSync({ title: t("bank.removeTitle"), content: t("bank.removeConfirm").replace("{name}", bankName) }))) return;
      (app as any).removeBank(activeBankId);
      banks = app.listBanks();
      activeBankId = banks[0]?.id ?? "";
      showMessage(t("bank.removed"), 2800, "info");
    }

    /** 44-03 lite：材料组排序策略（设置项）——false=分块连排（默认）/ true=交错打散 */
    const materialInterleave = $derived(
      plugin.settingUtils?.get?.("materialInterleave") === true || plugin.settingUtils?.get?.("materialInterleave") === "true",
    );

    /** 47-02 lite：首用引导（有题库 + 零作答记录 + 未跳过时显示；产生首个作答后自动消失） */
    let onboardingDismissed = $state(false);
    try { onboardingDismissed = localStorage.getItem("lv-exam-onboarded") === "1"; } catch { /* 忽略 */ }
    const onboarding = $derived(
      hasBank && !onboardingDismissed && view === "entry" && !!app && app.attempts.all().length === 0,
    );

    /** 会话启动失败可见化（47-06 lite）：单活动冲突/离线等不再静默吞掉。
     *  40-05 活动会话协商：冲突时提供「放弃当前并新开」（旧会话有 checkpoint，可恢复） */
    async function negotiateStart(qs: Question[], mode: string): Promise<boolean> {
      try {
        session = await app.startSession(qs, mode, activeBankId, { interleave: materialInterleave });
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
          session = await app.startSession(qs, mode, activeBankId, { interleave: materialInterleave });
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
      return true;
    }

    async function startDrill(mode: string) {
      errorMsg = "";
      const qs = (await loadQuestions()).filter((q) => q.type !== "material");
      if (!qs.length) { errorMsg = t("state.emptyBank"); return; }
      let picked: Question[];
      if (mode === "wrong") {
        picked = app.wrongDrill(qs);
        if (!picked.length) { errorMsg = t("state.noWrong"); return; }
      } else if (mode === "cram") {
        picked = app.cramDrill(qs);
        if (!picked.length) { errorMsg = t("state.noCram"); return; }
      } else if (mode === "fav") {
        picked = app.favDrill(qs);
        if (!picked.length) { errorMsg = t("state.noFav"); return; }
      } else if (mode === "daily") {
        const goal = Number(plugin.settingUtils?.get?.("dailyGoal") ?? 10);
        picked = app.dailyDrill(qs, [], Number.isFinite(goal) && goal > 0 ? goal : 10);
        if (!picked.length) { errorMsg = t("state.emptyBank"); return; }
      } else {
        picked = app.quickDrill(qs, 20);
      }
      await safeStart(groupAdjacent(picked), mode, () => {
        feedback = null; selected = ""; confidenceSel = ""; sessionDone = null;
        view = "session";
      });
    }

    // ---------- 收藏（exam-fav；E 键 + 星标 + 过滤） ----------
    async function toggleFavCurrent() {
      const q = session?.current as (Question & { blockId?: string; fav?: boolean }) | undefined;
      if (!q) return;
      try { await app.toggleFav(q); } catch { /* 离线静默 */ }
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
        const prev = ((await (app as any).deps.storage.load("plan/trace")) as import("@/core/planner").PlanTrace | null) ?? null;
        const yesterday = new Date(Date.now() - 86_400_000);
        const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
        const doneY = app.attempts
          .all()
          .filter((e) => e.verdict !== "not_attempted" && localDateKeyOf(e.ts) === yKey).length;
        const trace = nextPlanTrace(prev, localDateKeyOf(Date.now()), plan!.queue.length, doneY);
        planTrace = trace;
        void (app as any).deps.storage.save("plan/trace", trace);
      })();
    }

    /** 每日任务直接使用计划队列（零决策入口） */
    async function startToday() {
      errorMsg = "";
      const qs = (await loadQuestions()).filter((q) => q.type !== "material");
      if (!qs.length) { errorMsg = t("state.emptyBank"); return; }
      // FSRS 到期优先（docs/11 S8：dueFirst 供给；离线/无卡自然为空）
      let due: Question[];
      try { due = await (app as any).dueQuestions(bankName, qs); } catch { due = []; }
      rebuildPlan(due);
      const queue = groupAdjacent((plan?.queue?.length ? plan.queue : qs.slice(0, 10)).filter((q) => q.type !== "material"));
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
    function startRecite() { void 0; // 背诵朗读按钮在视图内直接调用 ttsSpeak
      const qs = app.wrongDrill(questions.length ? questions : []);
      const pool = qs.length ? qs : questions;
      if (!pool.length) { errorMsg = t("state.emptyBank"); return; }
      // 背诵组大小可配（TODO 13 组）：设置 reciteGroupSize，夹在 5–50
      const size = Math.max(5, Math.min(50, Number(plugin.settingUtils?.get?.("reciteGroupSize") ?? 15) || 15));
      reciteQueue = app.quickDrill(pool, size);
      reciteCursor = 0; reciteRevealed = false; reciteDone = false; reciteHint = 0; reciteRatings = [];
      reciteSessionId = `s-recite-${Date.now().toString(36)}`;
      view = "recite";
    }

    async function rateSelf(rating: 1 | 2 | 3 | 4) {
      const q = reciteQueue[reciteCursor];
      if (!q) return;
      reciteRatings.push(rating);
      await app.reciteAnswer(bankName, q as Question & { blockId?: string }, rating, reciteSessionId, 0);
      plugin.refreshDock?.();
      reciteHint = 0;
      if (reciteCursor < reciteQueue.length - 1) {
        reciteCursor++; reciteRevealed = false;
      } else {
        reciteDone = true;
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
      if (!paper.questions.length) { errorMsg = t("state.emptyBank"); return; }
      const { encodeChallengeCopy } = await import("@/core/challenge");
      await navigator.clipboard.writeText(encodeChallengeCopy(paper));
      showMessage(t("challenge.copied"), 3600, "info");
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
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!hasBank && !/\.zip$/i.test(file.name)) { errorMsg = t("guard.needBankFirst"); return; }
      if (/\.xlsx$|\.xls$|\.csv$/i.test(file.name)) {
        view = "import";
        void onExcelFile({ target: inputLike(file) } as unknown as Event);
      } else if (/\.zip$/i.test(file.name)) {
        errorMsg = ""; importError = ""; importResult = null;
        void importBank({ target: inputLike(file) } as unknown as Event);
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
      await (app as any).deps.storage.save("ai/explain-history", Object.fromEntries(entries));
    }

    /** AI 发送记录（U23/41-01 lite）：本地留存实际 payload（信封+消息），供"我发送了什么"审计 */
    async function logAiTask(entry: { templateId: string; qid: string; status: string; tokens: number; messages: import("@/ai/client").AiMessage[] }) {
      try {
        const log = ((await (app as any).deps.storage.load("ai/task-log")) ?? []) as (typeof entry & { at: number })[];
        log.push({ ...entry, at: Date.now() });
        await (app as any).deps.storage.save("ai/task-log", log.slice(-20));
      } catch { /* 审计日志失败不影响任务本身 */ }
    }

    interface AiTaskLogEntry { at: number; templateId: string; qid: string; status: string; tokens: number; messages: import("@/ai/client").AiMessage[] }
    let aiTaskLog = $state<AiTaskLogEntry[]>([]);
    async function loadAiTaskLog() {
      try { aiTaskLog = ((await (app as any).deps.storage.load("ai/task-log")) ?? []) as AiTaskLogEntry[]; } catch { aiTaskLog = []; }
    }
    let explainFollowUp = $state("");

    async function explainCurrent(mode: "explain" | "hint" | "socratic" = "explain") {
      const q = session?.current;
      if (!q || explainBusy || !feedback) return;
      if (!app.kernelOnline) { explainText = `⚠ ${t("state.offlineHint")}`; return; }   // 离线早退（兜底）
      explainBusy = true; explainText = ""; explainQid = q.id;
      // G1 任务身份：模板+题面指纹+作答快照+提交状态（ai/task.ts 信封契约）
      const reqCtx: import("@/ai/task").AiTaskContext = {
        templateId: mode === "explain" ? "practice.explain" : mode === "hint" ? "practice.hint" : "practice.socratic",
        templateVersion: 1,
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
        const key = String(plugin.settingUtils?.get?.("aiKey") ?? "");
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
          void persistExplainHistory();
          void app.recordAiUsage(ch.id, env.tokens, 1);
          helpShown.set(q.id, mode); // 114-01：受助标记——同题再答（重排队）时随 attempt 落 help 字段
        } else {
          // 有类型失败（G6 闸门/预算/通道错误）：显示信封摘要，不裸抛异常栈
          explainText = `⚠ ${env.summary}${env.error ? "：" + env.error : ""}`;
        }
        // G2：响应期间切题时，explainQid 门控使旧讲解不占当前题展示；历史已按 q.id 留草稿
      } catch (e) {
        explainText = String(e instanceof Error ? e.message : e);
      } finally { explainBusy = false; }
    }

    async function sendFollowUp() {
      const q = session?.current;
      const history = explainHistory[q?.id ?? ""];
      if (!q || !history?.length || explainBusy || !explainFollowUp.trim()) return;
      explainBusy = true;
      // 追问沿用苏格拉底模板身份；揭示状态随当前题提交事实
      const reqCtx: import("@/ai/task").AiTaskContext = {
        templateId: "practice.socratic",
        templateVersion: 1,
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
        const key = String(plugin.settingUtils?.get?.("aiKey") ?? "");
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
          void persistExplainHistory();
          explainText = (explainText.endsWith(reply) ? explainText : explainText + "\n\n") + "【追问】" + explainFollowUp.trim() + "\n" + reply;
          explainFollowUp = "";
          void app.recordAiUsage(ch.id, env.tokens, 1);
        } else {
          explainText = (explainText ? explainText + "\n\n" : "") + `⚠ ${env.summary}${env.error ? "：" + env.error : ""}`;
        }
      } catch (e) {
        explainText = String(e instanceof Error ? e.message : e);
      } finally { explainBusy = false; }
    }

    // ---------- 纯听题 lite（TTS + 遮罩） ----------
    let pureListen = $state(false);
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
      if (!q || !explainText) return;
      try {
        await (app as any).appendQuestionNote(q.id, q.blockId, explainText, "ai-explain");
        explainText = "✓ " + t("explain.saved");
      } catch (e) {
        explainText = String(e instanceof Error ? e.message : e);
      }
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

    async function resume() {
      const s = await app.resumeSession(async (qids) => {
        const all = await loadQuestions();
        return qids.map((id) => all.find((q) => q.id === id)).filter(Boolean) as Question[];
      }, activeBankId);
      if (s) {
        // 37-05 恢复推进：跳过已答位置，防重复作答双计事件；全答完直接进结算
        s.advancePastAnswered();
        if (s.allAnswered()) sessionDone = s.finish();
        session = s; feedback = null; selected = ""; confidenceSel = ""; view = "session";
        if (app.lastResumeMissing.length) showMessage(t("resume.missing").replace("{n}", String(app.lastResumeMissing.length)), 4200, "info");
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
      await (app as any).deps.storage.save(CHECKIN_PENDING_KEY, st.event ?? null); // pending 持久化（原引用）
      checkinStatus = st.status;
      if (st.status === "pending") checkinNote = String(st.event?.externalRef ?? "");
    }
    /** 重载补写：上次未写入的打卡事件以原 externalRef 重试（写入成功才清除） */
    async function retryCheckinPending() {
      const pending = await (app as any).deps.storage.load(CHECKIN_PENDING_KEY);
      if (!pending) return;
      const api = probeCheckinApi(window);
      if (!api) return; // 打卡未装：保留待重试
      try {
        await api.whenReady?.();
        if (api.hasCapability && !api.hasCapability("events.record")) return;
        const result = api.recordEvent?.(pending);
        if (result !== undefined) await (app as any).deps.storage.save(CHECKIN_PENDING_KEY, null);
      } catch { /* 保留待重试 */ }
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
        if (a.grade.verdict === "correct") continue;
        const r = await app.loadWrongReflection(a.qid);
        if (r) next[a.qid] = r;
      }
      reflections = next;
    }
    /** 114-01 lite：本会话受助标记（qid → 讲解模式）；同题再答时随 attempt 落 help 字段 */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- 函数内累加 Map（非组件遍历状态）
    const helpShown = new Map<string, "explain" | "hint" | "socratic">();
    function submitAnswer() {
      if (!session || feedback) return;
      const q = session.current;
      if (!q) return;
      const timeMs = Date.now() - answerStart;
      // 选择题/判断用 selected；填空/简答用 draft
      const ans = q.options.length ? selected : session.getDraft(q.id);
      if (hideOptions) recallUsed.add(q.id); // 未揭示就提交也算先回忆作答（52-02 可追溯）
      const r = session.submit(ans || null, timeMs);
      if (!r) {
        // 已答位置守卫（session.submit 拒绝重计）：K 回退误入已答位 → 静默前进，不重复写流水
        nextQuestion();
        return;
      }
      const g = r.grade;
      app.recordAttempt({
        qid: q.id, kind: "practice", mode: session.state.mode,
        verdict: g.verdict, myAnswer: g.myAnswer, sessionId: session.id,
        queue: session.state.mode === "wrong" ? "wrong" : "normal", timeMs,
        confidence: confidenceSel || undefined,   // U12：答前快照随 attempt；未选=如实缺省
        help: helpShown.get(q.id),               // 114-01：本题曾被讲解/提示 → 受助作答如实标记
        recall: recallUsed.has(q.id) || undefined, // 52-02：先回忆模式揭示可追溯
      });
      plugin.refreshDock?.();
      void app.saveSession();   // 37-05 checkpoint：作答即存（SaveGate 同键合并，重载不重复作答）
      if (feedbackMode === "end") {
        // 44-01：会话末复盘——作答事件完全一致，仅对错不在逐题显示，结算页统一回看
        showMessage(t("session.recordedSilent"), 1500, "info");
        nextQuestion();
        return;
      }
      feedback = { verdict: g.verdict, myAnswer: g.myAnswer };
    }

    function nextQuestion() {
      feedback = null; selected = ""; confidenceSel = ""; materialExpanded = false; answerStart = Date.now();
      hideOptions = false; recallDraft = ""; // 52-02：切题重置先回忆态（揭示/草稿不沿用上一题，U02 口径）
      if (!session.next()) { void finishSession(); return; }
      void app.saveSession();   // 游标推进随答随存
    }

    async function finishSession() {
      sessionDone = session.finish();
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
      void runCheckinBridge(); // 48-03 lite：结算自动同步打卡（幂等 externalRef，失败进待重试）
    }

    /** 结算页错题批量转卡（LeetFlash 零成本化）：一次点击入 FSRS 队列（按块幂等，重复转卡自动跳过） */
    async function wrongsToCard() {
      if (!session || !activeBankId) return;
      const wrongQs = session.answered
        .filter((a) => a.grade.verdict === "wrong")
        .map((a) => questions.find((q) => q.id === a.qid))
        .filter((q): q is Question & { blockId?: string } => !!q?.blockId);
      if (!wrongQs.length) { showMessage(t("session.noCardable"), 2800, "info"); return; }
      try {
        const n = await app.convertToCards(activeBankId, bankName, wrongQs);
        showMessage(`${t("memory.toCardDone")} ${n}`, 2800, "info");
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
      if (!session) { view = "entry"; return; }
      if (!sessionDone && session.answered.length) {
        const { confirmDialogSync } = await import("../../libs/dialog");
        if (!(await confirmDialogSync({ title: t("session.exit"), content: t("session.exitConfirm") }))) return;
      }
      await app.saveSession();
      await app.flush();
      session = null; feedback = null; selected = ""; confidenceSel = ""; sessionDone = null;
      plugin.refreshDock?.();
      view = "entry";
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
    let mSaving = $state(false);
    let mSaved = $state("");

    function setCorrectOption(i: number) {
      const L = String.fromCharCode(65 + i);
      mAnswer = mType === "multiple"
        ? (mAnswer.includes(L) ? mAnswer.replace(L, "") : (mAnswer + L).split("").sort().join(""))
        : L;
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
      };
      if (draftTimer) clearTimeout(draftTimer);
      if (!snap.stem.trim() && !snap.answer.trim() && !snap.analysis.trim()) return; // 空草稿不写
      draftTimer = setTimeout(() => {
        void (app as any)?.deps?.storage?.save(MANUAL_DRAFT_KEY, snap);
      }, 800);
      return () => { if (draftTimer) clearTimeout(draftTimer); };
    });

    async function saveManual() {
      if (mSaving || !mStem.trim()) return;
      mSaving = true; mSaved = ""; errorMsg = "";
      try {
        const { makeQuestion } = await import("@/core/blockTemplate");
        const q = makeQuestion({
          type: mType, stem: mStem,
          options: mType === "single" || mType === "multiple" ? mOptions.filter((o) => o.trim()) : [],
          answer: mAnswer, analysis: mAnalysis, kp: mKp, source: mSource,
          group: mGroup.trim() || undefined,
        });
        await app.writeManualQuestion(activeBankId, q);
        mSaved = q.id;
        mStem = ""; mOptions = ["", ""]; mAnswer = ""; mAnalysis = "";
        draftRestored = false;
        void (app as any).deps.storage.save(MANUAL_DRAFT_KEY, null); // 45-06：提交成功清理草稿
      } catch (e) {
        errorMsg = offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e);
      } finally { mSaving = false; }
    }

    // ---------- AI 出题（v0.4：双通道 + 待审核队列，Inbox 式永不直接入库） ----------
    let aiSource = $state("");
    /** 60-01 lite：拾遗桥可用性（apiVersion===1 才显示入口） */
    const gleanAvailable = $derived(!!probeGlean(window));
    let gleanBusy = $state(false);
    async function importGleanClips() {
      if (gleanBusy) return;
      gleanBusy = true;
      try {
        const g = probeGlean(window);
        if (!g) return;
        const clips = await listLaterClips(g, 10);
        if (!clips.length) { showMessage(t("ai.gleanEmpty"), 3200, "info"); return; }
        const block = formatClipsForSource(clips);
        aiSource = aiSource.trim() ? `${aiSource.trim()}\n\n${block}` : block;
        showMessage(t("ai.gleanImported").replace("{n}", String(clips.length)), 3200, "info");
      } finally { gleanBusy = false; }
    }
    let aiCount = $state(5);
    let aiDifficulty = $state<"easy" | "medium" | "hard" | "mixed">("mixed");
    let aiKp = $state("");
    const aiCustomEndpointSet = $derived(!!String(plugin.settingUtils?.get?.("aiEndpoint") ?? "").trim() && !!String(plugin.settingUtils?.get?.("aiKey") ?? "").trim());
    let aiBusy = $state(false);
    let aiCancel = $state({ aborted: false });
    let aiQuality = $state<"standard" | "economy">("standard");
    let aiCost = $state("");
    let aiCustomHint = $state("");
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
      try { await (app as any).deps.storage.save("ai/review-queue", { queue: aiQueue, rejected: aiRejected, duplicates: aiDuplicates, bankId: aiQueueBankId, material: aiQueueMaterial }); } catch { /* 忽略 */ }
    }
    async function restoreAiQueue() {
      try {
        const v = (await (app as any).deps.storage.load("ai/review-queue")) as { queue: Question[]; rejected: typeof aiRejected; duplicates: number; material?: string } | undefined;
        if (v?.queue?.length) { aiQueue = v.queue; aiRejected = v.rejected ?? []; aiDuplicates = v.duplicates ?? 0; aiQueueBankId = (v as any).bankId ?? ""; aiQueueMaterial = v.material ?? ""; }
      } catch { /* 忽略 */ }
    }

    async function runAiGenerate() {
      if (aiBusy || !aiSource.trim()) return;
      // 未审旧队列守卫（41-04）：重新生成会替换队列，旧候选需用户显式确认放弃
      const { confirmDialogSync } = await import("../../libs/dialog");
      if (aiQueue.length && !(await confirmDialogSync({
        title: t("ai.regenerate"),
        content: t("ai.regenerateConfirm").replace("{n}", String(aiQueue.length)),
      }))) return;
      // 首次调用数据流确认（26.2 P0）：端点/范围/取消入口
      if (!localStorage.getItem("lv-exam-ai-consent")) {
        const ep = String(plugin.settingUtils?.get?.("aiEndpoint") ?? "").trim();
        const msg = ep
          ? `${t("ai.consentTitle")}<br>${t("ai.consentCustom")} ${escapeHtml(ep)}`
          : `${t("ai.consentTitle")}<br>${t("ai.consentSiyuan")}`;
        if (!(await confirmDialogSync({ title: t("ai.consentTitle"), content: `${msg}<br><br>${t("ai.consentScope")}` }))) return;
        localStorage.setItem("lv-exam-ai-consent", "1");
      }
      aiCancel = { aborted: false };
      aiBusy = true; errorMsg = ""; aiQueue = []; aiRejected = []; aiDuplicates = 0; aiSaved = 0;
      try {
        const { generate } = await import("@/ai/gen");
        const { CountingChannel } = await import("@/ai/counting");
        const counting = new CountingChannel(await makeAiChannel());
        const aiCustomHint = String(plugin.settingUtils?.get?.("aiCustomHint") ?? "");
        const r = await generate(counting, aiSource, {
          types: ["single", "multiple", "judge"], count: aiCount, difficulty: aiDifficulty,
          kp: aiKp, sourceTitle: t("ai.pastedMaterial"), preset: aiPreset, quality: aiQuality,
          customHint: aiCustomHint || undefined, signal: aiCancel,
        });
        aiCost = `≈${counting.approxTokens} tok · ${counting.calls} ${t("ai.usageCalls")}`;
        await app.recordAiUsage(counting.id, counting.approxTokens, counting.calls);
        aiUsageTotal = await (app as any).aiUsage();
        aiQueue = r.pending; aiRejected = r.rejected; aiDuplicates = r.duplicates; aiQueueBankId = activeBankId;
        aiQueueMaterial = aiSource;             // 单题重生成的输入快照（41-04）
        void persistAiQueue();
        if (!r.pending.length && !r.rejected.length) errorMsg = t("ai.empty");
      } catch (e) {
        errorMsg = String(e instanceof Error ? e.message : e);
      } finally {
        aiCancel.aborted = false;
        aiBusy = false;
      }
    }

    function cancelAiGenerate() {
      aiCancel.aborted = true;
      showMessage(t("ai.cancelled"), 3000, "info");
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
      const key = String((plugin as any).getSecret?.("lv-exam-ai-key") || plugin.settingUtils?.get?.("aiKey") || "");
      const model = String(plugin.settingUtils?.get?.("aiModel") ?? "gpt-4o-mini");
      return endpoint && key
        ? new OpenAiChannel({ endpoint, apiKey: key, model }, (u, i) => fetch(u, i))
        : new SiyuanAiChannel((app as any).deps.client);
    }

    /** 拒绝项重试（AI Inbox 范式"重试"腿）：带否决原因让 AI 修复 → 复检 → 合入待审核 */
    async function retryRejected() {
      if (aiBusy || !aiRejected.length) return;
      const source = aiSource.trim();
      if (!source) { errorMsg = t("ai.emptySource"); return; }
      aiCancel = { aborted: false };
      aiBusy = true;
      try {
        const { repairIssues } = await import("@/ai/gen");
        const { CountingChannel } = await import("@/ai/counting");
        const counting = new CountingChannel(await makeAiChannel());
        const aiCustomHint = String(plugin.settingUtils?.get?.("aiCustomHint") ?? "");
        const r = await repairIssues(counting, aiRejected as import("@/ai/gen").GenIssue[], source, {
          types: ["single", "multiple", "judge"], count: aiRejected.length, difficulty: aiDifficulty,
          kp: aiKp, sourceTitle: t("ai.pastedMaterial"), preset: aiPreset, quality: aiQuality,
          customHint: aiCustomHint || undefined, signal: aiCancel,
        });
        aiCost = `≈${counting.approxTokens} tok · ${counting.calls} ${t("ai.usageCalls")}`;
        await app.recordAiUsage(counting.id, counting.approxTokens, counting.calls);
        aiUsageTotal = await (app as any).aiUsage();
        aiQueue = [...aiQueue, ...r.pending]; if (!aiQueueBankId) aiQueueBankId = activeBankId;
        aiRejected = r.rejected;
        aiDuplicates += r.duplicates;
        void persistAiQueue();
        if (r.pending.length) showMessage(`${t("ai.saved")} ${r.pending.length}`, 2600, "info");
      } catch (e) {
        errorMsg = String(e instanceof Error ? e.message : e);
      } finally {
        aiCancel.aborted = false;
        aiBusy = false;
      }
    }

    // 审批防重入（41-04）：写入在途时同一题不再触发；失败退回队列不丢候选
    // 命令式守卫 Set（非渲染状态），不转 SvelteSet
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const approving = new Set<string>();
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
      if (approving.has(q.id) || queueBankMismatch()) return;   // 双击/在途/切库：恰好入库一次且不误写
      approving.add(q.id);
      // 乐观出队：按钮即消失，不依赖写入往返；计数只加一次
      aiQueue = aiQueue.filter((x) => x.id !== q.id);
      aiSaved++;
      try {
        await app.writeManualQuestion(activeBankId, q);
        void persistAiQueue();
      } catch (e) {
        aiQueue = [...aiQueue, q];                           // 写入失败：退回队列（保住候选与计数一致）
        aiSaved--;
        if (!silent) showMessage(offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e), 4200, "error");
      } finally {
        approving.delete(q.id);
      }
    }

    function dropAi(q: Question) {
      if (approving.has(q.id)) return;
      aiQueue = aiQueue.filter((x) => x.id !== q.id);
      void persistAiQueue();
    }

    async function approveAllAi() {
      if (queueBankMismatch()) return;
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
    }

    // ---------- 候选编辑 + 单题重生成（41-04 剩余收口） ----------
    let aiQueueMaterial = $state("");      // 生成时材料快照：单题重生成的输入（随队列持久化）
    let editingAiId = $state("");
    let aiEditDraft = $state<{ stem: string; options: string[]; answer: string; analysis: string } | null>(null);
    let aiEditError = $state("");
    let aiRegenBusy = $state("");

    function startEditAi(q: Question) {
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
      if (aiBusy || aiRegenBusy) return;
      if (!aiQueueMaterial.trim()) { showMessage(t("ai.regenNoSource"), 3600, "info"); return; }
      aiRegenBusy = q.id; errorMsg = "";
      try {
        const { generate } = await import("@/ai/gen");
        const { CountingChannel } = await import("@/ai/counting");
        const counting = new CountingChannel(await makeAiChannel());
        const aiCustomHint = String(plugin.settingUtils?.get?.("aiCustomHint") ?? "");
        const r = await generate(counting, aiQueueMaterial, {
          types: [q.type], count: 1, difficulty: "mixed",
          kp: q.kp, sourceTitle: t("ai.pastedMaterial"), preset: aiPreset, quality: aiQuality,
          customHint: aiCustomHint || undefined, signal: aiCancel,
        });
        aiCost = `≈${counting.approxTokens} tok · ${counting.calls} ${t("ai.usageCalls")}`;
        await app.recordAiUsage(counting.id, counting.approxTokens, counting.calls);
        aiUsageTotal = await (app as any).aiUsage();
        if (r.pending[0]) {
          aiQueue = aiQueue.map((x) => (x.id === q.id ? r.pending[0] : x));
          void persistAiQueue();
          showMessage(t("ai.regenDone"), 2800, "info");
        } else {
          errorMsg = r.rejected[0]?.reason ?? t("ai.empty");
        }
      } catch (e) {
        errorMsg = String(e instanceof Error ? e.message : e);
      } finally { aiRegenBusy = ""; }
    }

    // ---------- 导入 ----------
    async function doParseText() {
      importError = ""; importResult = null; retryPool = []; trialConfirmed = []; trialNote = "";
      if (!importText.trim()) { importError = t("import.noInput"); return; }
      try {
        // parseText 按内容特征分流（廿五批）：GIFT / TSV(Anki) / Aiken；
        // 并存模式（2.3 重复合并策略 lite）：不回灌已有题 hash → 与题库重复的行照常入库（批内去重仍生效）
        importReport = await parseText(importText, {
          existingHashes: coexistDupe ? new Set<string>() : new Set(questions.map((q) => q.hash)),
        });
      } catch (e) { importError = String(e); }
    }

    async function onExcelFile(e: Event) {
      importError = ""; importResult = null; importReport = null; retryPool = []; trialConfirmed = []; trialNote = "";
      // 清理上次导入残留（TODO 27 组：多 Sheet 残留状态 bug 预防）
      pendingWorkbook = null; sheetNames = []; sheetRowsCache = new Map();
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      try {
        const XLSX = await import("xlsx");
        const { decodeCsv, detectDelimiter } = await import("@/importer/csvDecode");
        const buf = await file.arrayBuffer();
        const { text, garbled } = decodeCsv(buf);
        if (garbled) showMessage(t("import.garbledWarning"), 5200, "info");
        pendingWorkbook = XLSX.read(text, { type: "string", FS: detectDelimiter(text) });
        sheetNames = pendingWorkbook.SheetNames;
        sheetRowsCache = new Map(sheetNames.map((n: string) => {
          const rows: string[][] = XLSX.utils.sheet_to_json(pendingWorkbook.Sheets[n], { header: 1, defval: "" });
          return [n, rows] as [string, string[][]];
        }));
        activeSheet = sheetNames[0];
        parseActiveSheet();
      } catch (e) { importError = String(e instanceof Error ? e.message : e); }
      input.value = "";
    }

    /** 多 Sheet 支持（TODO 12 组）：读文件时缓存各行，选择工作表重解析 */
    let pendingWorkbook: any = null;
    let sheetNames = $state<string[]>([]);
    let activeSheet = $state("");
    let sheetRowsCache = $state(new Map<string, string[][]>());

    function parseActiveSheet() {
      importError = "";
      // U07：重解析（切映射/切 Sheet）产生全新 qid → 旧试导确认/重试池全部失效；
      // 不清会导致 commitImport 的排除过滤永远不命中 → 已试导确认的行被整批重导（双导入）
      trialConfirmed = []; trialNote = ""; retryPool = [];
      const rows = sheetRowsCache.get(activeSheet);
      if (!rows?.length) { importError = t("import.emptyFile"); return; }
      // 回灌去重（2.3）：与题库已有题比对；并存模式（重合并策略 lite）置空 → 重复行照常入库
      const existing = coexistDupe ? new Set<string>() : new Set(questions.map((q) => q.hash));
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
        importReport = parseExcelRows(rows.slice(1), saved.map, { existingHashes: existing });
        return;
      }
      const { map, missing } = autoMapExcel(rows[0].map(String));
      if (missing.length) { importError = t("import.missingColumns") + missing.join("、"); return; }
      lastMap = map;
      importReport = parseExcelRows(rows.slice(1), map, { existingHashes: existing });
    }

    // ---------- 映射保存/复用（2.3/38-02） ----------
    let savedMappings = $state<{ name: string; map: import("../../importer/pipeline").ExcelColumnMap }[]>([]);
    let selectedMapping = $state("");
    let lastMap = $state<import("../../importer/pipeline").ExcelColumnMap | null>(null);

    async function loadMappings() {
      try {
        const v = (await (app as any).deps.storage.load("import/mappings")) as { name: string; map: import("../../importer/pipeline").ExcelColumnMap }[] | undefined;
        savedMappings = Array.isArray(v) ? v : [];
      } catch { savedMappings = []; }
    }

    async function saveMapping() {
      if (!lastMap) return;
      const { inputDialogSync } = await import("../../libs/dialog");
      const name = (await inputDialogSync({ title: t("import.mappingName"), placeholder: t("import.mappingNameHint") }))?.trim();
      if (!name) return;
      savedMappings = [...savedMappings.filter((m) => m.name !== name), { name, map: JSON.parse(JSON.stringify(lastMap)) }].slice(-20);
      try { await (app as any).deps.storage.save("import/mappings", savedMappings); showMessage(t("settingSaved"), 2400, "info"); } catch { /* 本地保存失败静默 */ }
    }

    let favOnly = $state(false);
    let browseLimit = $state(200);
    let searchText = $state("");
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
      const kw = searchText.trim().toLowerCase();
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
    async function loadSmartViews() {
      try {
        const v = (await (app as any).deps.storage.load("browse/smartViews")) as import("@/core/smartViews").SmartView[] | undefined;
        smartViews = Array.isArray(v) ? v : [];
      } catch { smartViews = []; }
    }
    async function saveSmartViews() {
      try { await (app as any).deps.storage.save("browse/smartViews", smartViews); } catch { /* 本地保存失败静默 */ }
    }
    /** 当前过滤态 → 视图快照（43-05：过滤条件+题库身份+schema 版本一起存） */
    async function saveCurrentView() {
      if (!activeBankId) return;
      const { inputDialogSync } = await import("../../libs/dialog");
      const name = (await inputDialogSync({ title: t("view.saveTitle"), placeholder: t("view.namePlaceholder") }))?.trim();
      if (!name) return;
      smartViews = upsertView(smartViews, {
        name,
        v: 1,
        bankId: activeBankId,
        search: searchText,
        favOnly,
        section: sectionSel ? JSON.parse(JSON.stringify(sectionSel)) : null,
        createdAt: Date.now(),
      });
      selectedView = name;
      await saveSmartViews();
      showMessage(t("view.saved"), 2400, "info");
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
      searchText = v.search ?? "";
      favOnly = !!v.favOnly;
      sectionSel = v.section ? { ...v.section } : null;
    }
    async function deleteNamedView() {
      if (!selectedView) return;
      smartViews = smartViews.filter((v) => v.name !== selectedView);
      selectedView = "";
      await saveSmartViews();
    }

    // ---------- 浏览详情：展开/文档跳转/反链 ----------
    let expandedId = $state("");
    let backlinkCache = $state(new Map<string, { docId: string; title: string; content: string }[]>());

    async function loadBacklinks(blockId: string) {
      if (!app.kernelOnline) return;
      try {
        const links = await (app as any).deps.client.backlinks(blockId);
        // 写时复制更新 $state Map（惯用法），不转 SvelteMap
        // eslint-disable-next-line svelte/prefer-svelte-reactivity
        const next = new Map(backlinkCache);
        next.set(blockId, links);
        backlinkCache = next;
      } catch { /* 静默：反链失败不阻塞浏览 */ }
    }

    function openInSiYuan(rootId: string) {
      if (!rootId) return;
      void import("siyuan").then(({ openTab }) => {
        openTab({ app: (plugin as any).app ?? (plugin as any), doc: { id: rootId } } as any);
      });
    }

    // ---------- 题面富文本（md2html；离线回退纯文本） ----------
    let stemHtml = $state("");
    let stemHtmlFor = $state("");
    let materialHtml = $state("");
    let materialHtmlFor = $state("");
    $effect(() => {
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
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      if (view === "session") {
        if (!session || sessionDone) return;
        const q = session.current;
        if (!q) return;
        if (e.key === "Escape") { e.preventDefault(); exitSession(); return; }
        if (feedback) {
          if (e.key === "Enter" || e.key.toLowerCase() === "j") { e.preventDefault(); nextQuestion(); }
          else if (e.key.toLowerCase() === "k") { e.preventDefault(); session.prev(); }
          else if (feedback.verdict === "wrong" && /^[1-3]$/.test(e.key)) {
            // 错因快捷键（docs/11：1-4 错因；1-3 对应三分类）
            const reasons = ["careless", "unknown", "trap"] as const;
            void app.saveWrongReason(q.id, reasons[Number(e.key) - 1]);
            savedReason = reasons[Number(e.key) - 1];
            e.preventDefault();
          }
          return;
        }
        const key = e.key.toUpperCase();
        if (q.options.length && /^[A-J]$/.test(key)) {
          const idx = key.charCodeAt(0) - 65;
          if (idx < q.options.length) { e.preventDefault(); selected = key; }
        } else if (/^[1-3]$/.test(e.key)) {
          // 答前置信快捷键（U12）：1=确定 2=模糊 3=蒙（提交前选择，随 attempt 落流水）
          e.preventDefault();
          confidenceSel = (["sure", "fuzzy", "guess"] as const)[Number(e.key) - 1];
        } else if (e.key.toLowerCase() === "e") {
          e.preventDefault();
          void toggleFavCurrent();
        } else if (e.key === "Enter") {
          e.preventDefault();
          submitAnswer();
        } else if (e.key.toLowerCase() === "k" && session.progress.done > 0) {
          e.preventDefault();
          session.prev();
        }
      } else if (view === "recite") {
        if (reciteDone || !reciteQueue.length) return;
        if (!reciteRevealed && e.key === " ") { e.preventDefault(); reciteRevealed = true; return; }
        if (reciteRevealed && /^[1-4]$/.test(e.key)) { e.preventDefault(); void rateSelf(Number(e.key) as 1 | 2 | 3 | 4); }
      }
    }

    async function commitImport() {
      if (!importReport || committing) return;
      // 先导 5 行（2.3）：已试导确认的题从完整入库中排除，不重导
      const remaining = trialConfirmed.length ? importReport.ok.filter((q) => !trialConfirmed.includes(q.id)) : importReport.ok;
      if (!remaining.length) {
        importResult = { written: 0, confirmed: trialConfirmed.length, missing: 0, verified: true };
        retryPool = []; importReport = null; importText = ""; trialConfirmed = []; trialNote = "";
        return;
      }
      await runCommit({ ...importReport, ok: remaining });
      trialConfirmed = []; trialNote = "";
    }

    // 先导 5 行试导入（TODO 2.3）：试导前 5 题并读回确认；完整入库时排除已确认行
    let trialConfirmed = $state<string[]>([]);
    let trialNote = $state("");
    let trialBusy = $state(false);

    async function trialImport5() {
      if (!importReport || trialBusy || committing) return;
      trialBusy = true; importError = ""; trialNote = "";
      try {
        const trial: ImportReport = { ok: importReport.ok.slice(0, 5), errors: [], duplicates: 0, batch: importReport.batch + "-t5" };
        const r = await app.commitImport(activeBankId, trial);
        trialConfirmed = [...new Set([...trialConfirmed, ...r.readback.confirmed])];
        trialNote = r.readback.verified
          ? t("import.trialDone").replace("{c}", String(r.readback.confirmed.length)).replace("{m}", String(r.readback.missing.length))
          : t("import.readbackUnknown");
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

    async function runCommit(report: ImportReport) {
      committing = true; importError = "";
      commitCancelRequested = false;
      commitProgress = { done: 0, total: report.ok.length };
      try {
        const r = await app.commitImport(activeBankId, report, {
          onProgress: (done, total) => { commitProgress = { done, total }; },
          isCancelled: () => commitCancelRequested,
        });
        importResult = {
          written: r.written,
          confirmed: r.readback.confirmed.length,
          missing: r.readback.missing.length,
          verified: r.readback.verified,
          cancelled: r.cancelled === true,
        };
        retryPool = report.ok.filter((q) => r.readback.missing.includes(q.id));
        retryBatch = report.batch;
        retryBankId = activeBankId;
        importReport = null; importText = "";
      } catch (e) {
        importError = offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e);
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
      if (!importReport || fixRow == null) return;
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
          existingHashes: coexistDupe ? new Set<string>() : new Set(questions.map((q) => q.hash)),
        });
      } else {
        // 文本路径：整块重验（GIFT/TSV 特征同样走 parseText 分流）
        single = await parseText(fixText, {
          existingHashes: coexistDupe ? new Set<string>() : new Set(questions.map((q) => q.hash)),
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
      await runCommit({ ok: retryPool, errors: [], duplicates: 0, batch: retryBatch });
    }
</script>

<svelte:window onkeydown={onKeydown} ondragover={(e) => e.preventDefault()} ondrop={onDrop} />

<div class="fn__flex-1 lv-exam-tab" role="region" aria-label={t("tab.practice")}>
  <div class="block__icons">
    <div class="block__logo">
      <svg class="block__logoicon"><use xlink:href="#iconExam"></use></svg>
      {t("tab.practice")}
    </div>
    <SaveStatus gate={app.saves} {t} />
    {#if view === "entry" && hasBank}
      <div class="seg lv-seg">
        <button class="on">{t("mode.practice")}</button>
        <button onclick={() => { view = "browse"; void loadQuestions(); }}>{t("mode.browse")}</button>
      </div>
    {/if}
    <span class="fn__flex-1"></span>
    {#if offline}<span class="lv-chip lv-chip--amb">{t("state.offline")}</span>{/if}
    {#if plan}
      {#if plan.mode === "sprint"}<span class="lv-chip lv-chip--red num">🔥 {t("entry.sprint")} D-{plan.daysToExam}</span>
      {:else if plan.daysToExam != null}<span class="lv-chip amb num">⏱ {t("entry.examIn")} {plan.daysToExam} {t("entry.days")}</span>{/if}
      {#if examProfileList.filter((p) => p.days != null && p.days >= 0).length > 1}
        <!-- 53-02 lite：多考期并存展示（计划锚定最近，其余一目了然） -->
        {#each examProfileList.filter((p) => p.days != null && p.days >= 0) as p, _pi (_pi)}
          <span class="lv-chip num" title={t("entry.profileTip")}>📌 {p.name} D-{p.days}</span>
        {/each}
      {/if}
      {#if planTrace && planTrace.absentStreak >= 2}
        <!-- 44-05 lite：连续缺席提醒（配额恒定不爆量，仅可见性） -->
        <span class="lv-chip lv-chip--amb num" title={t("entry.absentTip")}>⚠ {t("entry.absent").replace("{n}", String(planTrace.absentStreak))}</span>
      {:else if planTrace && planTrace.planned > 0 && planTrace.done >= 0}
        <span class="lv-chip num" title={t("entry.yesterdayTip")}>📅 {t("entry.yesterday").replace("{p}", String(planTrace.planned)).replace("{d}", String(planTrace.done))}</span>
      {/if}
      {#if planTime}
        <!-- 53-01 lite：今日计划分钟预算；缺历史题型如实标注默认值口径 -->
        <span class="lv-chip num" title={planTime.sourced ? t("entry.timeSourced") : t("entry.timeDefault")}>
          ⏳ ~{planTime.minutes} {t("entry.minutes")}（{planTime.low}-{planTime.high}）
        </span>
      {/if}
    {/if}
      {#if checkinStreak != null && checkinStreak > 0}
        <!-- 48-04 lite：打卡→考试只读投影（连续数由打卡单一实现计算，考试侧不自算） -->
        <span class="lv-chip num" title={t("entry.checkinStreakTip")}>🔥 {t("entry.checkinStreak").replace("{n}", String(checkinStreak))}</span>
      {/if}
      {#if hasBank}<span class="lv-chip">{t("bank.label")} {bankName}</span><button class="lv-chip" title={t("bank.removeTitle")} onclick={removeActiveBank}>✕</button>{/if}
  </div>

  {#if loading}
    <div class="lv-pad"><div class="lv-skeleton"></div></div>
  {:else if errorMsg && view !== "session"}
    <div class="lv-pad"><div class="lv-error">{errorMsg}</div></div>
  {:else if view === "entry"}
    <!-- ===== S1 入口 / 守卫 ===== -->
    {#if !hasBank}
      <div class="lv-pad lv-center">
        <div class="lv-card lv-guard">
          <div class="lv-guard-title">{t("guard.title")}</div>
          <p class="lv-muted">{t("guard.desc")}</p>
          <div class="lv-row">
            <input class="lv-input" placeholder={t("guard.namePlaceholder")} bind:value={newBankName}
              onkeydown={(e) => e.key === "Enter" && createBank()} />
            <button class="lv-btn lv-btn--primary" onclick={createBank} disabled={creating || !newBankName.trim()}>
              {creating ? "…" : t("guard.create")}
            </button>
          </div>
          <div class="lv-row lv-center-text"><span class="lv-muted">{t("guard.or")}</span></div>
          <button class="lv-btn" style="width:100%" onclick={() => view = "import"}>
            {t("import.title")}
          </button>
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
            <button class="lv-btn lv-btn--primary" onclick={resume}>{t("resume.continue")}</button>
            <button class="lv-btn lv-btn--ghost" onclick={async () => { await app.discardSession(); session = null; }}>{t("resume.discard")}</button>
          </div>
        </div>
      {/if}
      {#if onboarding}
        <!-- 47-02 lite：首次五分钟任务引导（无作答记录时显示；可跳过，有作答自动消失） -->
        <div class="lv-pad">
          <div class="lv-card lv-resume">
            <div>
              <b>🧭 {t("onboard.title")}</b>
              <div class="lv-muted">{t("onboard.desc")}</div>
            </div>
            <div class="lv-row" style="margin:6px 0 0">
              <button class="lv-btn sm" onclick={() => { view = "import"; }}>① {t("onboard.step1")}</button>
              <button class="lv-btn sm" onclick={() => { view = "manual"; }}>① {t("onboard.step1b")}</button>
              <button class="lv-btn sm" onclick={() => { view = "ai"; }}>① {t("onboard.step1c")}</button>
              <button class="lv-btn lv-btn--primary sm" onclick={() => void startDrill("quick")}>② {t("onboard.step2")}</button>
              <button class="lv-btn sm" onclick={() => plugin.openReport?.()}>③ {t("onboard.step3")}</button>
              <span class="fn__flex-1"></span>
              <button class="lv-btn sm lv-btn--ghost" onclick={() => { onboardingDismissed = true; try { localStorage.setItem("lv-exam-onboarded", "1"); } catch { /* 忽略 */ } }}>{t("onboard.skip")}</button>
            </div>
          </div>
        </div>
      {/if}
      <div class="lv-pad">
        {#if plan}
          <div class="lv-card lv-resume" style="margin-bottom:12px">
            <div>
              <b>📅 {t("entry.today")}</b>
              <div class="lv-muted">{plan.reason}</div>
            </div>
            <button class="lv-btn lv-btn--primary" onclick={startToday}>▶ {t("entry.startToday")}</button>
          </div>
        {/if}
        <div class="lv-modes">
          <button class="lv-mode" onclick={() => startDrill("single")}>
            <b>⚡ {t("mode.quick")}</b><span class="lv-muted">{t("mode.quick.desc")}</span>
          </button>
          <button class="lv-mode" onclick={() => startDrill("daily")}>
            <b>📅 {t("mode.daily")}</b><span class="lv-muted">{t("mode.daily.desc")}</span>
          </button>
          <button class="lv-mode" onclick={() => startRecite()}>
            <b>🔄 {t("mode.recite")}</b><span class="lv-muted">{t("mode.recite.desc")}</span>
          </button>
          <button class="lv-mode" onclick={() => startDrill("wrong")}>
            <b>❌ {t("mode.wrong")}</b><span class="lv-muted num">{app.wrongItems().length} {t("mode.wrong.unit")}</span>
          </button>
          <button class="lv-mode" onclick={() => startDrill("cram")}>
            <b>🔥 {t("mode.cram")}</b><span class="lv-muted">{t("mode.cram.desc")}</span>
          </button>
          <button class="lv-mode" onclick={() => startDrill("fav")}>
            <b>⭐ {t("mode.fav")}</b><span class="lv-muted">{t("mode.fav.desc")}（<span class="num">{questions.filter((q) => q.fav).length}</span> {t("mode.wrong.unit")}）</span>
          </button>
          <button class="lv-mode lv-mode--disabled" title={t("todo")}>
            <b>🌲 {t("mode.special")}</b><span class="lv-muted">{t("todo")}</span>
          </button>
        </div>
        <div class="lv-row" style="margin-top:14px">
          <button class="lv-btn" onclick={() => view = "import"}>📥 {t("import.title")}</button>
          <button class="lv-btn" onclick={() => view = "ai"}>✨ {t("ai.title")}</button>
          <button class="lv-btn" onclick={() => view = "manual"}>✏️ {t("entry.manual")}</button>
          <button class="lv-btn" onclick={copyChallengeCode}>🎯 {t("challenge.copy")}</button>
          <button class="lv-btn" onclick={importChallengeCode}>📥 {t("challenge.import")}</button>
          <details class="lv-export-fold">
            <summary class="lv-btn">📤 {t("export.wrongbook")}</summary>
            <div class="lv-card" style="padding:10px 12px;margin-top:6px">
              <div class="lv-row" style="margin:4px 0">
                <span class="lv-chip">{t("manual.kp")}</span>
                <select class="lv-select" bind:value={expKp}>
                  <option value="">全部</option>
                  {#each expKpRoots as k, _i (_i)}<option value={k}>{k}</option>{/each}
                </select>
                <span class="lv-chip">{t("session.reason")}</span>
                <select class="lv-select" bind:value={expReason}>
                  <option value="">全部</option>
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
              <button class="lv-btn sm lv-btn--primary" onclick={exportWrong}>📤 {t("export.run")}</button>
              <div class="lv-row" style="margin:6px 0 0">
                <button class="lv-btn sm" disabled={offline} onclick={exportBank}>📦 {t("share.export")}</button>
                <label class="lv-btn sm" class:disabled={offline} style={offline ? "opacity:.5;pointer-events:none" : ""}>📥 {t("share.import")}<input type="file" accept=".sy.zip,.zip" style="display:none" onchange={importBank} /></label>
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
          <div class="lv-guard-title">🏁 {t("session.done")}</div>
          <p class="num">{t("session.total")} {sessionDone.total} · <span class="lv-green">{t("session.correct")} {sessionDone.correct}</span> · <span class="lv-red">{t("session.wrong")} {sessionDone.wrong}</span></p>
          {#if checkinStatus && checkinStatus !== "disabled" && checkinStatus !== "below-threshold" && checkinStatus !== "no-api"}
            <!-- 48-03 lite：打卡桥状态（未配置/未达标/打卡未装时安静不显） -->
            <p class="lv-muted" style="margin:2px 0" role="status">
              📅 {t("checkin.status." + checkinStatus)}{#if checkinStatus === "pending" && checkinNote}<span class="num">（{checkinNote}）</span>{/if}
            </p>
          {/if}
          {#if session.state.order}
            <!-- 44-03：结算显示本次排序策略（同队列可重放，不能以单次正确率下学习结论） -->
            <p class="lv-muted" style="margin:2px 0">{t("session.orderLabel")}：{session.state.order === "interleaved" ? t("session.orderInter") : t("session.orderAdj")}</p>
          {/if}
          {#if session.answered.length}
            <div class="lv-row" style="flex-wrap:wrap;gap:4px;margin:8px 0">
              {#each session.answered as a, ai (ai)}
                {@const aq = questions.find((x) => x.id === a.qid)}
                <span class="lv-chip num" class:lv-chip--grn={a.grade.verdict === "correct"} class:lv-chip--red={a.grade.verdict === "wrong"} title={aq?.stem.slice(0, 60) ?? a.qid}>{ai + 1} {a.grade.verdict === "correct" ? "✓" : a.grade.verdict === "wrong" ? "✕" : "–"} {(a.timeMs / 1000).toFixed(0)}s</span>
              {/each}
            </div>
          {/if}
          {#if sessionDone.wrong > 0}
            <button class="lv-btn" style="width:100%" onclick={sameKpSession}>🔁 {t("memory.sameKp")}</button>
            <button class="lv-btn" style="width:100%;margin-top:6px" onclick={wrongsToCard}>🎴 {t("session.wrongsToCard")}</button>
            <button class="lv-btn" style="width:100%;margin-top:6px" disabled={actionBusy} onclick={wrongsToActions}>
              📌 {actionBusy ? "…" : t("action.addWrong")}
            </button>
            {#if actionNote}<p class="lv-muted num" style="margin:6px 0 0">{actionNote}</p>{/if}
            <!-- 44-01 end 模式/回看：错题逐题展开（题干+我的答案+正确答案+解析） -->
            <button class="lv-btn lv-btn--ghost" style="width:100%;margin-top:6px" onclick={() => { reviewOpen = !reviewOpen; if (reviewOpen) void loadReflections(); }}>
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
                      <div class="lv-muted" style="font-size:11.5px">📝 {t("reflection.last").replace("{d}", new Date(reflections[a.qid].at).toLocaleDateString())}：{reflections[a.qid].text}</div>
                    {/if}
                    <button class="lv-btn sm lv-btn--ghost" onclick={() => void editReflection(a.qid)}>
                      📝 {reflections[a.qid] ? t("reflection.edit") : t("reflection.add")}
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
          <button class="lv-btn lv-btn--primary" style="width:100%;margin-top:8px" onclick={exitSession}>{t("session.back")}</button>
        </div>
      </div>
    {:else}
      {@const q = session.current}
      {#if q}
        <div class="lv-pad">
          <div class="lv-row lv-session-head">
            <button class="lv-btn lv-btn--ghost" onclick={exitSession}>← {t("session.exit")}</button>
            <div class="lv-row" style="flex:1;min-width:120px;gap:8px">
              <div class="lv-progress" style="flex:1" role="progressbar" aria-label={t("session.progress")} aria-valuemin="0" aria-valuemax={session.progress.total} aria-valuenow={session.progress.done}><i style="width:{session.progress.total ? Math.round((session.progress.done / session.progress.total) * 100) : 0}%"></i></div>
              <span class="num lv-muted">{session.progress.done}/{session.progress.total}</span>
            </div>
            <span class="lv-chip lv-chip--acc">{t("qtype." + q.type)}</span>
            {#if q.group}
              {@const sibs = questions.filter((x) => x.group === q.group)}
              {@const pos = sibs.findIndex((x) => x.id === q.id) + 1}
              <span class="lv-chip num">🔗 {t("session.groupPos")} {pos}/{sibs.length}</span>
            {/if}
            <button class="lv-chip" title={t("tts.read")} onclick={() => ttsSpeak([q.stem, ...q.options].join(" "))}>🔊</button>
            <button class="lv-chip" class:acc={pureListen} title={t("tts.pureListen")} onclick={togglePureListen}>🙈</button>
            <button class="lv-chip" class:acc={!!q.fav} title="E" onclick={() => toggleFavCurrent()}>⭐</button>
          </div>
          <div class="lv-card lv-question" class:lv-pure={pureListen}>
            {#if materialContext}
              <div class="lv-analysis lv-rich b3-typography" style="margin-bottom:12px">
                <b>📎 共用材料：</b>{@html materialLong && !materialExpanded ? materialShown : (materialHtml || materialShown)}
                {#if materialLong}
                  <button class="lv-chip num" style="margin-left:6px" onclick={() => materialExpanded = !materialExpanded}>
                    {materialExpanded ? t("material.fold") : t("material.expand")}
                  </button>
                {/if}
              </div>
            {/if}
            {#if stemHtml}<div class="lv-stem lv-rich b3-typography">{@html stemHtml}</div>{:else}<div class="lv-stem">{q.stem}</div>{/if}
            {#if q.options.length}
              <!-- 52-02 lite：先回忆后显示选项——藏选项 + 独立回忆草稿（与作答草稿分离，不入正式答案） -->
              <div class="lv-row" style="margin:0 0 4px">
                <button class="lv-chip" class:acc={hideOptions} onclick={() => { hideOptions = !hideOptions; if (hideOptions) recallDraft = ""; }}>
                  {hideOptions ? "🙈 " + t("session.recallOn") : "👁 " + t("session.recallOff")}
                </button>
                {#if hideOptions}<span class="lv-muted" style="font-size:11.5px">{t("session.recallHint")}</span>{/if}
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
                {#each q.options as opt, i (i)}
                  {@const L = String.fromCharCode(65 + i)}
                  <button class="lv-opt" class:sel={selected.includes(L)}
                    role={q.type === "multiple" ? "checkbox" : "radio"}
                    aria-checked={q.type === "multiple" ? selected.includes(L) : selected === L}
                    class:right={feedback && feedback.verdict !== "not_attempted" && q.answer.includes(L) && (q.type === "single" ? q.answer === L : true)}
                    class:wrong={feedback && feedback.myAnswer === L && feedback.verdict === "wrong"}
                    onclick={() => {
                      if (feedback) return;
                      if (q.type === "multiple") {
                        // 多选/不定项：点击切换
                        const arr = (selected || "").split("").filter(Boolean);
                        const pos = arr.indexOf(L);
                        pos >= 0 ? arr.splice(pos, 1) : arr.push(L);
                        selected = arr.sort().join("");
                      } else {
                        selected = L;
                      }
                    }}>
                    <span class="key">{L}</span>
                    <span>{opt}</span>
                  </button>
                {/each}
              </div>
              {/if}
            {:else}
              <textarea class="lv-input lv-textarea" placeholder={t("session.answerPlaceholder")}
                value={session.getDraft(q.id)}
                oninput={(e) => session.setDraft(q.id, (e.target as HTMLTextAreaElement).value)}
                disabled={!!feedback}></textarea>
            {/if}

            {#if feedback}
              <div class="lv-feedback" class:good={feedback.verdict === "correct"}>
                {feedback.verdict === "correct" ? "✓ " + t("session.correct") : feedback.verdict === "wrong" ? "✕ " + t("session.wrongAns") + " " + q.answer : "– " + t("session.skipped")}
                {#if confidenceSel}<span class="lv-chip num" style="margin-left:8px">{t("confidence.recorded")}{t("confidence." + confidenceSel)}</span>{/if}
              </div>
              {#if q.analysis}<div class="lv-analysis">{q.analysis}</div>{/if}
              {#if feedback.verdict === "wrong"}
                <div class="lv-row lv-muted">{t("session.reason")}:
                  {#each ["careless", "unknown", "trap"] as r, ri (ri)}
                    <button class="lv-chip" class:acc={savedReason === r} title={t("entry.days") === "天" ? `快捷键 ${ri + 1}` : `Key ${ri + 1}`} onclick={async () => { await app.saveWrongReason(q.id, r as any); savedReason = r; }}>{savedReason === r ? "✓ " : ""}{t("reason." + r)}</button>
                  {/each}
                </div>
              {/if}
            {/if}
            {#if !feedback}
              <div class="lv-row lv-muted" style="font-size:11.5px;gap:6px;flex-wrap:wrap">
                <span>{t("confidence.before")}</span>
                {#each ["sure", "fuzzy", "guess"] as c, _i (_i)}
                  <button class="lv-chip" class:acc={confidenceSel === c} title={`Key ${["sure", "fuzzy", "guess"].indexOf(c) + 1}`} onclick={() => confidenceSel = c as "sure" | "fuzzy" | "guess"}>{t("confidence." + c)}</button>
                {/each}
                <span class="lv-chip num" class:lv-chip--red={qTimeoutS > 0 && qElapsedS >= qTimeoutS} title={qTimeoutS > 0 ? t("session.timeoutHint").replace("{n}", String(qTimeoutS)) : ""}>
                  ⏱ {qElapsedS}s{qTimeoutS > 0 && qElapsedS >= qTimeoutS ? " ⚠" : ""}
                </span>
              </div>
              <div class="lv-row lv-muted" style="font-size:11px;gap:6px;flex-wrap:wrap">
                <span class="lv-kbd">A</span>-<span class="lv-kbd">J</span> {t("session.choose")} ·
                <span class="lv-kbd">1</span>-<span class="lv-kbd">3</span> {t("confidence.shortcut")} ·
                <span class="lv-kbd">Enter</span> {t("session.submit")} ·
                <span class="lv-kbd">J</span>/<span class="lv-kbd">K</span> {t("session.next")}/{t("session.kbdPrev")} ·
                <span class="lv-kbd">E</span> ⭐ ·
                <span class="lv-kbd">Esc</span> {t("session.exit")}
              </div>
            {/if}

            <div class="lv-row">
              {#if !feedback}
                <button class="lv-btn lv-btn--primary" onclick={submitAnswer} disabled={!selected && !session.getDraft(q.id)}>{t("session.submit")}</button>
                {#if q.type === "fill" || q.type === "short"}
                  <button class="lv-btn lv-btn--ghost" onclick={() => { submitAnswer(); }}>{t("session.skip")}</button>
                {/if}
              {:else}
                <button class="lv-btn lv-btn--primary" onclick={nextQuestion}>{t("session.next")} →</button>
                {#if feedback.verdict === "wrong"}
                  <button class="lv-btn" onclick={toCard}>🎴 {t("memory.toCard")}</button>
                  {#if cardResult}<span class="lv-muted">{cardResult}</span>{/if}
                  <button class="lv-btn" onclick={() => explainCurrent("explain")} disabled={explainBusy}>🤖 {explainBusy ? "…" : t("explain.ask")}</button>
                  <button class="lv-btn" onclick={() => explainCurrent("hint")} disabled={explainBusy}>💡 {t("explain.hint")}</button>
                  <button class="lv-btn" onclick={() => explainCurrent("socratic")} disabled={explainBusy}>🧠 {t("explain.socratic")}</button>
                {/if}
              {/if}
              {#if explainText && session?.current && explainQid === session.current.id}
                <div class="lv-analysis lv-explain">{explainText}</div>
                <div class="lv-row">
                  {#if !explainText.startsWith("✓")}
                    <button class="lv-btn sm" onclick={saveExplain}>📌 {t("explain.save")}</button>
                  {/if}
                  <button class="lv-btn sm" onclick={() => explainCurrent("hint")} disabled={explainBusy}>💡 {t("explain.hint")}</button>
                  <button class="lv-btn sm" onclick={() => explainCurrent("socratic")} disabled={explainBusy}>🧠 {t("explain.socratic")}</button>
                </div>
                <div class="lv-row">
                  <input class="lv-input" style="flex:1;min-width:160px" placeholder={t("explain.followUp")}
                    bind:value={explainFollowUp}
                    onkeydown={(e) => e.key === "Enter" && sendFollowUp()} />
                  <button class="lv-btn sm" onclick={sendFollowUp} disabled={explainBusy || !explainFollowUp.trim()}>{t("explain.send")}</button>
                </div>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    {/if}
  {:else if view === "recite"}
    <!-- ===== S4 背诵（lite）：盖答案 → 四级自评 ===== -->
    <div class="lv-pad">
      <div class="lv-row">
        <button class="lv-btn lv-btn--ghost" onclick={exitRecite}>← {t("recite.exit")}</button>
        <span class="lv-chip num">{reciteCursor + 1}/{reciteQueue.length}</span>
        <span class="lv-chip">{t("recite.mode")}</span>
        {#if (reciteQueue[reciteCursor] as any)?.blockId && (reciteQueue[reciteCursor] as any)?.rootId}
          <button class="lv-chip" title={t("recite.jumpSource")} onclick={jumpToSource}>📍 {t("recite.jumpSource")}</button>
        {/if}
        {#if reciteQueue[reciteCursor]?.group}
          <span class="lv-chip num">🔗 {t("session.groupPos")}</span>
        {/if}
        {#if reciteQueue[reciteCursor]}
          <button class="lv-chip" title={t("tts.read")} onclick={() => ttsSpeak(reciteQueue[reciteCursor].stem)}>🔊</button>
        {/if}
      </div>
      {#if reciteDone}
        <div class="lv-card lv-guard">
          <div class="lv-guard-title">🏁 {t("recite.done")}</div>
          <p class="num lv-muted">{t("recite.dist")}：{t("rate.1")} {reciteRatings.filter((x) => x === 1).length} · {t("rate.2")} {reciteRatings.filter((x) => x === 2).length} · {t("rate.3")} {reciteRatings.filter((x) => x === 3).length} · {t("rate.4")} {reciteRatings.filter((x) => x === 4).length}</p>
          <p class="lv-muted" style="font-size:12px">{t("recite.doneHint")}</p>
          <button class="lv-btn lv-btn--primary" style="width:100%" onclick={exitRecite}>{t("session.back")}</button>
        </div>
      {:else if reciteQueue[reciteCursor]}
        {@const q = reciteQueue[reciteCursor]}
        <div class="lv-card lv-question">
          {#if reciteMaterial}
            <div class="lv-analysis" style="margin-bottom:12px"><b>📎 共用材料：</b>{reciteMaterial}</div>
          {/if}
          {#if stemHtml}<div class="lv-stem lv-rich b3-typography">{@html stemHtml}</div>{:else}<div class="lv-stem">{q.stem}</div>{/if}
          {#if !reciteRevealed}
            {#if q.kp}
              <div class="lv-row"><button class="lv-chip" onclick={() => reciteHint = 1}>💡 {t("recite.hint1")}：{q.kp}</button></div>
            {/if}
            {#if reciteHint >= 2 && q.analysis}
              <div class="lv-row"><span class="lv-chip">💡 {t("recite.hint2")}：{q.analysis.slice(0, 24)}…</span></div>
            {/if}
            <div class="lv-row" style="justify-content:center">
              <button class="lv-btn lv-btn--primary" onclick={() => reciteRevealed = true}>{t("recite.reveal")}</button>
            </div>
          {:else}
            {#if q.options.length}
              <div class="lv-analysis"><b>{t("recite.answer")}:</b> {q.answer}</div>
              {#each q.options as opt, i (i)}
                <div class="lv-opt" class:right={q.answer.includes(String.fromCharCode(65 + i))} style="cursor:default">
                  <span class="key">{String.fromCharCode(65 + i)}</span><span>{opt}</span>
                </div>
              {/each}
            {:else}
              <div class="lv-analysis"><b>{t("recite.answer")}:</b> {q.answer}</div>
            {/if}
            {#if q.analysis}<div class="lv-analysis">{q.analysis}</div>{/if}
            <div class="lv-rate">
              <button class="lv-btn r1" onclick={() => rateSelf(1)}>1 {t("rate.1")}</button>
              <button class="lv-btn r2" onclick={() => rateSelf(2)}>2 {t("rate.2")}</button>
              <button class="lv-btn r3" onclick={() => rateSelf(3)}>3 {t("rate.3")}</button>
              <button class="lv-btn r4" onclick={() => rateSelf(4)}>4 {t("rate.4")}</button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {:else if view === "manual"}
    <!-- ===== S10 手工录题表单 ===== -->
    <div class="lv-pad">
      <div class="lv-row">
        <button class="lv-btn lv-btn--ghost" onclick={() => view = "entry"}>← {t("mode.practice")}</button>
        <span class="lv-chip">{t("manual.title")}</span>
        {#if draftRestored}<span class="lv-chip lv-chip--amb">{t("manual.draftRestored")}</span>{/if}
        {#if mSaved}<span class="lv-chip lv-chip--grn num">✓ {mSaved}</span>{/if}
      </div>
      <div class="lv-card lv-pad-card">
        <div class="lv-row">
          <span class="lv-chip">{t("manual.type")}</span>
          {#each ["single", "multiple", "judge", "fill", "short"] as tt, _i (_i)}
            <button class="lv-chip" class:acc={mType === tt} onclick={() => { mType = tt as any; mAnswer = ""; }}>{t("qtype." + tt)}</button>
          {/each}
        </div>
        <div class="lv-field"><span class="lv-muted">{t("manual.stem")}</span>
          <textarea class="lv-input lv-textarea" bind:value={mStem} placeholder={t("manual.stemPlaceholder")} aria-label={t("manual.stem")}></textarea>
        </div>
        {#if mType === "single" || mType === "multiple"}
          <div class="lv-field"><span class="lv-muted">{t("manual.options")}</span>
            {#each mOptions as _opt, i (i)}
              <div class="lv-row" style="margin:4px 0">
                <button class="lv-chip" class:acc={mAnswer.includes(String.fromCharCode(65 + i))}
                  title={t("manual.setCorrect")} onclick={() => setCorrectOption(i)}>{String.fromCharCode(65 + i)}</button>
                <input class="lv-input" style="flex:1" bind:value={mOptions[i]} />
                {#if mOptions.length > 2}
                  <button class="lv-btn lv-btn--ghost sm" onclick={() => mOptions = mOptions.filter((_, j) => j !== i)}>✕</button>
                {/if}
              </div>
            {/each}
            {#if mOptions.length < 6}
              <button class="lv-btn sm" style="border-style:dashed" onclick={() => mOptions = [...mOptions, ""]}>＋ {t("manual.addOption")}</button>
            {/if}
          </div>
        {:else if mType === "judge"}
          <div class="lv-row">
            <button class="lv-chip" class:acc={mAnswer === "对"} onclick={() => mAnswer = "对"}>对</button>
            <button class="lv-chip" class:acc={mAnswer === "错"} onclick={() => mAnswer = "错"}>错</button>
          </div>
        {/if}
        <div class="lv-field"><span class="lv-muted">{t("manual.analysis")}</span>
          <textarea class="lv-input lv-textarea" style="min-height:52px" bind:value={mAnalysis} aria-label={t("manual.analysis")}></textarea>
        </div>
        <div class="lv-row">
          <span class="lv-chip">{t("manual.kp")}</span><input class="lv-input" style="max-width:180px" bind:value={mKp} placeholder="资料分析/增长率" />
          <span class="lv-chip">{t("manual.source")}</span><input class="lv-input" style="max-width:160px" bind:value={mSource} placeholder="2023 国考 · 115" />
          <span class="lv-chip">{t("manual.group")}</span><input class="lv-input num" style="max-width:200px" bind:value={mGroup} placeholder="grp-…" />
        </div>
        <div class="lv-row">
          <button class="lv-btn lv-btn--primary" onclick={saveManual} disabled={mSaving || !mStem.trim() || !mAnswer.trim()}>
            {mSaving ? "…" : t("manual.save")}
          </button>
          {#if mSaved}<span class="lv-muted">{t("manual.savedHint")}</span>{/if}
        </div>
      </div>
    </div>
  {:else if view === "ai"}
    <!-- ===== S11 AI 出题（Inbox 式：永不直接入库） ===== -->
    <div class="lv-pad">
      <div class="lv-row">
        <button class="lv-btn lv-btn--ghost" onclick={() => view = "entry"}>← {t("mode.practice")}</button>
        <span class="lv-chip">✨ {t("ai.title")}</span>
        <span class="fn__flex-1"></span>
        {#if aiCustomEndpointSet}
          <span class="lv-chip lv-chip--amb" title={t("ai.endpointTitle") + " · " + t("setting.aiEndpoint.desc")}>{t("ai.channel.openai")}</span>
        {:else}
          <span class="lv-chip lv-chip--grn" title={t("ai.endpointTitle")}>{t("ai.channel.siyuan")}</span>
        {/if}
      </div>
      <div class="lv-card lv-pad-card">
        <div class="lv-field"><span class="lv-muted">{t("ai.source")}</span>
          <button class="lv-chip" title={t("ai.fromDocTitle")} onclick={aiSourceFromCurrentDoc}>📄 {t("ai.fromDoc")}</button>
          <textarea class="lv-input lv-textarea" rows="7" bind:value={aiSource} placeholder={t("ai.sourcePlaceholder")} aria-label={t("ai.source")}></textarea>
          {#if gleanAvailable}
            <!-- 60-01 lite：拾遗稍后读 → 出题素材（只读；不写拾遗状态） -->
            <div class="lv-row" style="margin:4px 0 0">
              <button class="lv-btn sm lv-btn--ghost" disabled={gleanBusy} onclick={() => void importGleanClips()}>
                📚 {gleanBusy ? "…" : t("ai.gleanLater")}
              </button>
              <span class="lv-muted" style="font-size:11.5px">{t("ai.gleanHint")}</span>
            </div>
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
            <button class="lv-chip" class:acc={aiPreset === p} onclick={() => aiPreset = p as any}>{p === "default" ? t("ai.preset.default") : { gongkao: "公考行测", kaoyan: "考研政治", yixue: "医学执业", jiakao: "驾考" }[p]}</button>
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
        <button class="lv-btn lv-btn--primary" onclick={runAiGenerate} disabled={aiBusy || !aiSource.trim()}>
          {aiBusy ? t("ai.generating") : "✨ " + t("ai.generate")}
        </button>
        {#if aiBusy}
          <button class="lv-btn sm" onclick={cancelAiGenerate}>✕ {t("ai.cancel")}</button>
        {/if}
          <span class="lv-muted">{t("ai.pipelineNote")}</span>
          {#if aiUsageTotal}<span class="lv-chip num" title={t("ai.usageTitle")}>Σ ≈{aiUsageTotal.totalTokens} tok · {aiUsageTotal.totalCalls} {t("ai.usageCalls")}</span>{/if}
        </div>
      </div>
        {#if aiQueue.length || aiRejected.length || aiDuplicates || aiCost}
        <div class="lv-row" style="margin-top:14px">
          <b style="font-size:14px">{t("ai.queue")}</b>
          <span class="lv-chip lv-chip--acc num">{aiQueue.length}</span>
          {#if aiRejected.length}<span class="lv-chip lv-chip--red num">✕ {aiRejected.length}</span>{/if}
          {#if aiDuplicates}<span class="lv-chip lv-chip--amb num">⧉ {aiDuplicates}</span>{/if}
          {#if aiCost}<span class="lv-chip num">{aiCost}</span>{/if}
          <span class="fn__flex-1"></span>
          {#if aiRejected.length}
            <button class="lv-btn sm" onclick={retryRejected} disabled={aiBusy} title={t("ai.retryTitle")}>⟳ {t("ai.retryRejected")}（{aiRejected.length}）</button>
          {/if}
          {#if aiQueue.length}
            <button class="lv-btn lv-btn--primary sm" onclick={approveAllAi}>✓ {t("ai.approveAll")}（{aiQueue.length}）</button>
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
              <div class="lv-analysis" style="margin:8px 0 0">{q.analysis}</div>
              <div class="lv-row" style="margin:8px 0 0">
                <button class="lv-btn sm lv-btn--primary" onclick={() => approveAi(q)}>✓ {t("ai.approve")}</button>
                <button class="lv-btn sm" onclick={() => startEditAi(q)}>✎ {t("ai.edit")}</button>
                <button class="lv-btn sm" disabled={aiRegenBusy === q.id} onclick={() => regenOneAi(q)}>⟳ {aiRegenBusy === q.id ? "…" : t("ai.regen")}</button>
                <button class="lv-btn sm lv-btn--ghost" onclick={() => dropAi(q)}>✕ {t("ai.drop")}</button>
              </div>
            {/if}
          </div>
        {/each}
        {#each aiRejected.slice(0, 10) as rj, _i (_i)}
          <div class="lv-error-row"><b class="num">#{rj.index}</b> {rj.reason}</div>
        {/each}
        {#if aiTaskLog.length}
          <details class="lv-card lv-pad-card" style="padding:12px 16px;margin-top:14px">
            <summary style="cursor:pointer;font-weight:650">🧾 {t("ai.taskLog")}（{aiTaskLog.length}）</summary>
            <p class="lv-muted" style="margin:6px 0 0">{t("ai.taskLogHint")}</p>
            {#each [...aiTaskLog].reverse().slice(0, 5) as e, _i (_i)}
              <div class="lv-row" style="margin:8px 0 0">
                <span class="lv-chip num">{new Date(e.at).toLocaleTimeString()}</span>
                <span class="lv-chip num">{e.templateId}</span>
                <span class="lv-chip num" class:lv-chip--red={e.status !== "ok"}>{e.status}</span>
                <span class="lv-chip num">≈{e.tokens} tok</span>
              </div>
              <details style="margin:2px 0 0 8px">
                <summary class="lv-muted" style="cursor:pointer;font-size:11.5px">{t("ai.taskLogPayload")}</summary>
                {#each e.messages as m, _i (_i)}
                  <pre class="lv-muted num" style="white-space:pre-wrap;font-size:11px;margin:4px 0">[{m.role}] {m.content.slice(0, 400)}{m.content.length > 400 ? "…" : ""}</pre>
                {/each}
              </details>
            {/each}
          </details>
        {/if}
      {/if}
    </div>
  {:else if view === "browse"}
    <!-- ===== S3 浏览 ===== -->
    <div class="lv-pad">
      <div class="lv-row">
        <button class="lv-btn lv-btn--ghost" onclick={() => view = "entry"}>← {t("mode.practice")}</button>
        <span class="lv-chip num">{shownQuestions.length}/{questions.length} {t("browse.count")}</span>
        <button class="lv-chip" class:acc={favOnly} onclick={() => favOnly = !favOnly}>⭐ {t("browse.favOnly")}</button>
        <button class="lv-chip" class:acc={sectionOpen} onclick={() => void toggleSectionTree()}>📑 {t("browse.sectionTree")}</button>
        <button class="lv-chip" class:acc={kpOpen} onclick={() => { kpOpen = !kpOpen; }}>🧭 {t("kp.title")}</button>
        <button class="lv-chip" class:acc={healthOpen} onclick={() => healthOpen = !healthOpen}>🩺 {t("health.title")}</button>
        <button class="lv-chip" class:acc={batchMode} onclick={() => { batchMode = !batchMode; if (!batchMode) selectedIds = {}; }}>{t("batch.mode")}</button>
        <button class="lv-chip" title={t("browse.exportCsvTitle")} onclick={exportBankCsv}>⬇️ CSV</button>
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
        <button class="lv-chip" class:acc={filterHelp} onclick={() => (filterHelp = !filterHelp)} title={t("browse.fHelpTip")}>🫱 {t("browse.fHelp")}</button>
        <select class="lv-select" style="max-width:110px" bind:value={filterDays} title={t("browse.fDaysTip")}>
          <option value={0}>{t("browse.fAnyDay")}</option>
          <option value={1}>{t("browse.fToday")}</option>
          <option value={7}>{t("browse.f7")}</option>
          <option value={30}>{t("browse.f30")}</option>
        </select>
        {#if smartViews.length}
          <select class="lv-select" style="max-width:150px" bind:value={selectedView} onchange={() => void applyNamedView(selectedView)}>
            <option value="">{t("view.pick")}</option>
            {#each smartViews as v, _i (_i)}<option value={v.name}>{v.name}</option>{/each}
          </select>
          <button class="lv-btn sm lv-btn--ghost" title={t("view.delete")} disabled={!selectedView} onclick={() => void deleteNamedView()}>🗑</button>
        {/if}
        <button class="lv-btn sm lv-btn--ghost" title={t("view.saveTitle")} onclick={() => void saveCurrentView()}>💾 {t("view.save")}</button>
      </div>
      {#if sectionSel}
        <div class="lv-row" style="margin:4px 0">
          <span class="lv-chip acc">📑 {sectionLabel}</span>
          <button class="lv-btn sm lv-btn--ghost" onclick={() => { sectionSel = null; }}>{t("browse.sectionClear")}</button>
        </div>
      {/if}
      {#if sectionOpen}
        <div class="lv-card lv-pad-card" style="padding:12px 16px;max-height:260px;overflow:auto">
          <b style="font-size:13px">{t("browse.sectionTree")}</b>
          {#if sectionBusy}<span class="lv-muted" style="margin-left:8px">…</span>{/if}
          {#if !sectionTree.length && !sectionBusy}
            <div class="lv-muted" style="margin-top:6px">{t("browse.sectionEmpty")}</div>
          {/if}
          {#each sectionTree as doc, _di (_di)}
            <div class="lv-row" style="margin:6px 0 0">
              <button class="lv-btn sm lv-btn--ghost" class:acc-btn={sectionSel?.kind === "doc" && sectionSel.id === doc.id}
                onclick={() => { sectionSel = { kind: "doc", id: doc.id, hpath: doc.hpath }; }}>
                📄 {doc.title || doc.hpath}
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
        <div class="lv-card lv-pad-card" style="padding:12px 16px;max-height:320px;overflow:auto">
          <b style="font-size:13px">{t("kp.title")}</b>
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
                  onclick={() => { kpMergeFrom = e.kp; kpMergeTo = ""; kpMergePlan = null; searchText = e.kp; }}>
                  {e.kp || "（空）"} · {e.count}
                </button>
              {/each}
              {#if kpData.entries.length > 24}<span class="lv-muted num">… +{kpData.entries.length - 24}</span>{/if}
            </div>
            <div class="lv-row" style="margin:8px 0 0">
              <b style="font-size:12.5px">{t("kp.merge")}</b>
              <input class="lv-input" style="max-width:160px" bind:value={kpMergeFrom} placeholder={t("kp.fromPlaceholder")} />
              <span class="lv-muted">→</span>
              <input class="lv-input" style="max-width:160px" bind:value={kpMergeTo} placeholder={t("kp.toPlaceholder")} />
              <button class="lv-btn sm" onclick={previewKpMerge}>🔍 {t("batch.preview")}</button>
            </div>
            {#if kpData.emptyCount}
              <div class="lv-row" style="margin:4px 0 0">
                <b style="font-size:12.5px">{t("kp.fill").replace("{n}", String(kpData.emptyCount))}</b>
                <input class="lv-input" style="max-width:160px" bind:value={kpFillKp} placeholder={t("kp.toPlaceholder")} />
                <button class="lv-btn sm" onclick={previewKpFill}>🔍 {t("batch.preview")}</button>
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
          {/if}
        </div>
      {/if}
      {#if batchMode}
        <div class="lv-card lv-pad-card" style="padding:12px 16px">
          <div class="lv-row" style="margin:0">
            <b style="font-size:13px">{t("batch.title")}</b>
            <span class="lv-chip num">{t("batch.selected").replace("{n}", String(Object.keys(selectedIds).length))}</span>
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
            <button class="lv-btn sm" disabled={!selectedCount} onclick={previewBatch}>🔍 {t("batch.preview")}</button>
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
        <div class="lv-card lv-pad-card" style="padding:12px 16px">
          <b style="font-size:13px">{t("health.title")}</b>
          <span class="lv-chip num" style="margin-left:8px">{t("health.total")} {health.total}</span>
          {#if coverage}
            <!-- 43-04 lite：生产者覆盖概览（点击 chip 直达对应过滤列表） -->
            <div class="lv-row" style="margin:6px 0 0">
              {#each coverage.byType as t2, _ti (_ti)}
                <button class="lv-chip num" class:acc={filterType === t2.type} title={t("coverage.typeTip")}
                  onclick={() => { filterType = filterType === t2.type ? "" : t2.type; }}>{t("qtype." + t2.type)} {t2.count}</button>
              {/each}
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
              <b style="font-size:12.5px">{t("import.batches")}</b>
              {#each batchList as b, _i (_i)}
                <span class="lv-chip num" title={b.batch}>📦 {b.batch.slice(0, 16)} · {b.count}</span>
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
        <div class="lv-empty">{t("browse.empty")}</div>
      {:else}
        {#each shownQuestions as q (q.id)}
          <div class="lv-card lv-qrow">
            <div class="lv-qrow-head" role="button" tabindex="0"
              onclick={() => { if (batchMode) { const next = { ...selectedIds }; if (next[q.id]) delete next[q.id]; else next[q.id] = true; selectedIds = next; } else expandedId = expandedId === q.id ? "" : q.id; }}
              onkeydown={(e) => e.key === "Enter" && (expandedId = expandedId === q.id ? "" : q.id)}>
              {#if batchMode}
                <span class="lv-chip num" class:acc={!!selectedIds[q.id]}>{selectedIds[q.id] ? "☑" : "☐"}</span>
              {/if}
              <span class="lv-chip lv-chip--acc">{t("qtype." + q.type)}</span>
              {#if q.kp}<span class="lv-chip">{q.kp}</span>{/if}
              {#if q.source}<span class="lv-muted lv-qrow-src">{q.source}</span>{/if}
            </div>
            <div class="lv-qrow-stem">{q.stem}</div>
            {#if expandedId === q.id}
              {@const links = app.kernelOnline ? backlinkCache.get(q.blockId) : undefined}
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
                        <button class="lv-btn sm lv-btn--ghost" onclick={() => { editDraft!.options.splice(oi, 1); editDraft = { ...editDraft! }; }}>✕</button>
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
                  <div class="lv-muted"><b>{t("browse.answer")}:</b> {q.answer}{#if q.analysis} · {q.analysis}{/if}</div>
                  {#if st && st.attempts}
                    <!-- 43-02 lite：题目使用分析（作答次数/正确率/最近作答/错次），数据不足如实不显示 -->
                    <div class="lv-muted num" role="status">📊 {t("browse.usage").replace("{a}", String(st.attempts)).replace("{c}", String(Math.round((st.correct / st.attempts) * 100)))}{#if wr} · {t("browse.wrongCount").replace("{n}", String(wr.wrongCount))}{/if} · {new Date(st.lastAt).toLocaleDateString()}</div>
                  {/if}
                  <div class="lv-row">
                    <button class="lv-btn sm" onclick={() => openEditForm(q)}>✎ {t("edit.open")}</button>
                    <button class="lv-btn sm" onclick={() => openInSiYuan((q as any).rootId)}>📍 {t("browse.openDoc")}</button>
                    <button class="lv-btn sm" onclick={() => void loadBacklinks(q.blockId)}>🔗 {t("browse.backlinks")}</button>
                    {#if links}
                      {#if links.length === 0}<span class="lv-muted">{t("browse.noBacklinks")}</span>
                      {:else}{#each links as l, _i (_i)}<span class="lv-chip" title={l.content}>📎 {l.title}</span>{/each}{/if}
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
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
      <div class="lv-row">
        <button class="lv-btn lv-btn--ghost" onclick={() => view = hasBank ? "entry" : "entry"}>← {t("import.back")}</button>
        <span class="lv-chip">{t("import.title")}</span>
      </div>
      {#if !hasBank}
        <div class="lv-empty">{t("guard.needBankFirst")}</div>
      {:else}
        <div class="lv-card lv-pad-card">
          <div class="lv-row">
            <label class="lv-btn">📁 {t("import.pickExcel")}<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange={onExcelFile} /></label>
            <button class="lv-btn sm" onclick={downloadTemplate}>⬇️ {t("import.template")}</button>
            <span class="lv-muted">{t("import.orPaste")}</span>
          </div>
          <textarea class="lv-input lv-textarea" rows="8" placeholder={t("import.placeholder")} bind:value={importText}></textarea>
          <div class="lv-row">
            <button class="lv-btn lv-btn--primary" onclick={doParseText} disabled={!importText.trim()}>{t("import.parse")}</button>
            <label class="lv-chip" for="lv-import-coexist" title={t("import.coexistHint")}>
              <input id="lv-import-coexist" type="checkbox" bind:checked={coexistDupe} style="margin-right:4px" />
              {t("import.coexist")}
            </label>
            <span class="lv-muted">{t("import.excelNote")}</span>
          </div>
          {#if savedMappings.length}
            <div class="lv-row">
              <span class="lv-chip">{t("import.useMapping")}</span>
              <select class="lv-select" style="max-width:220px" bind:value={selectedMapping} onchange={() => { if (sheetRowsCache.get(activeSheet)?.length) parseActiveSheet(); }}>
                <option value="">{t("import.autoMap")}</option>
                {#each savedMappings as m, _i (_i)}<option value={m.name}>{m.name}</option>{/each}
              </select>
            </div>
          {/if}
          {#if importError}<div class="lv-error">{importError}</div>{/if}
          {#if importReport}
            <div class="lv-row">
              <span class="lv-chip lv-chip--grn num">✓ {importReport.ok.length}</span>
              <span class="lv-chip lv-chip--red num">✕ {importReport.errors.length}</span>
              {#if importReport.duplicates}<span class="lv-chip lv-chip--amb num" title={t("import.dupeHint")}>⧉ {importReport.duplicates}</span>{/if}
              {#if importReport.ok.length}
                <button class="lv-btn sm lv-btn--ghost" disabled={spotBusy} onclick={() => void spotCheckRender()}>
                  🎲 {t("import.spotCheck")}{#if spotIds.length}（{spotIds.length}）{/if}
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
                    <div class="b3-typography" style="font-size:13px">{@html spotHtml[sid] ?? sq.stem}</div>
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
            {#each importReport.errors.slice(0, 20) as err, _i (_i)}
              <div class="lv-error-row">
                <b class="num">#{err.row}</b> {err.reason}<span class="lv-muted"> · {err.raw}</span>
                <button class="lv-btn sm lv-btn--ghost" onclick={() => startRowFix(err.row)}>{t("import.rowFix")}</button>
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
                    <button class="lv-btn lv-btn--primary sm" disabled={fixCells.length ? false : !fixText.trim()} onclick={() => void applyRowFix(err.row)}>{t("import.rowFixApply")}</button>
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
                <button class="lv-btn sm" onclick={saveMapping}>💾 {t("import.saveMapping")}</button>
              </div>
            {/if}
            <div class="lv-row">
              <button class="lv-btn lv-btn--primary" onclick={commitImport} disabled={!importReport.ok.length || committing}>
                {committing ? "…" : t("import.commit") + " (" + (importReport.ok.length - trialConfirmed.length) + ")"}
              </button>
              <button class="lv-btn sm" onclick={trialImport5} disabled={committing || trialBusy || !importReport.ok.length}>
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
            <div class="lv-success">✓ {t("import.done")} {importResult.written}</div>
            <div class="lv-row">
              {#if importResult.cancelled}
                <span class="lv-chip lv-chip--amb num">{t("import.cancelledNote").replace("{w}", String(importResult.written))}</span>
              {/if}
              {#if importResult.verified}
                {#if importResult.missing === 0}
                  <span class="lv-chip lv-chip--grn num">✓ {t("import.readbackOk").replace("{n}", String(importResult.confirmed))}</span>
                {:else}
                  <span class="lv-chip lv-chip--amb num">⚠ {t("import.readbackPart").replace("{c}", String(importResult.confirmed)).replace("{m}", String(importResult.missing))}</span>
                  {#if retryPool.length}
                    <button class="lv-btn sm" disabled={committing} onclick={retryMissing}>↻ {t("import.retryMissing").replace("{n}", String(retryPool.length))}</button>
                  {/if}
                {/if}
              {:else}
                <span class="lv-chip lv-chip--amb">{t("import.readbackUnknown")}</span>
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

<style>
  .lv-pad { padding: 12px 16px; overflow: auto; }
  .lv-center { display: flex; align-items: center; justify-content: center; min-height: 60%; }
  .lv-muted { color: var(--lv-text-3); font-size: 12.5px; }
  .lv-green { color: var(--lv-green); font-weight: 650; }
  .lv-red { color: var(--lv-red); font-weight: 650; }
  .lv-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
  .lv-seg { display: inline-flex; padding: 3px; border-radius: 10px; background: var(--lv-surface-2); border: 1px solid var(--lv-border); gap: 2px; }
  .lv-seg button { padding: 5px 14px; border-radius: 8px; font-size: 13px; font-weight: 550; color: var(--lv-text-2); }
  .lv-seg button.on { background: var(--lv-surface); color: var(--lv-text); box-shadow: var(--lv-sh-1); }
  .lv-card { background: var(--lv-surface); border: 1px solid var(--lv-border); border-radius: var(--lv-r-3); padding: 20px 22px; box-shadow: var(--lv-sh-1); }
  .lv-pad-card { margin: 8px 0; }
  .lv-guard { max-width: 460px; width: 100%; }
  .lv-guard-title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
  .lv-guard p { margin: 6px 0; }
  .lv-center-text { justify-content: center; }
  .lv-hint { font-size: 12px; color: var(--lv-text-3); text-align: center; }
  .lv-input { padding: 8px 12px; border-radius: 10px; border: 1px solid var(--lv-border); background: var(--lv-surface); color: var(--lv-text); font: inherit; font-size: 13.5px; flex: 1; min-width: 140px; }
  .lv-input:focus { border-color: var(--lv-accent); box-shadow: var(--lv-ring); outline: none; }
  .lv-textarea { width: 100%; min-height: 90px; resize: vertical; line-height: 1.65; margin: 6px 0; }
  .lv-btn { display: inline-flex; align-items: center; gap: 7px; padding: 9px 18px; border-radius: 10px; font-size: 14px; font-weight: 600; border: 1px solid var(--lv-border); background: var(--lv-surface); color: var(--lv-text); cursor: pointer; transition: all var(--lv-dur-micro) ease; }
  .lv-btn:hover:not(:disabled) { border-color: var(--lv-border); box-shadow: var(--lv-sh-1); transform: translateY(-1px); }
  .lv-btn:disabled { opacity: .5; cursor: not-allowed; }
  .lv-btn--primary { background: var(--lv-accent-grad); border-color: transparent; color: var(--b3-theme-on-primary, #fff); box-shadow: var(--lv-glow, none); }
  .lv-btn--ghost { border-color: transparent; color: var(--lv-text-2); background: transparent; }
  .lv-btn--ghost.acc-btn { color: var(--lv-accent); background: var(--lv-accent-soft); }
  .lv-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 550; color: var(--lv-text-2); background: var(--lv-surface-2); border: 1px solid var(--lv-border); }
  .lv-chip.acc { color: var(--lv-accent); background: var(--lv-accent-soft); border-color: transparent; }
  .lv-chip--acc { color: var(--lv-accent); background: var(--lv-accent-soft); border-color: transparent; }
  .lv-chip--grn { color: var(--lv-green); background: var(--lv-green-soft); border-color: transparent; }
  .lv-chip--red { color: var(--lv-red); background: var(--lv-red-soft); border-color: transparent; }
  .lv-chip--amb { color: var(--lv-amber); background: var(--lv-amber-soft); border-color: transparent; }
  .lv-modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .lv-mode { padding: 16px; border-radius: var(--lv-r-3); text-align: left; background: var(--lv-surface); border: 1px solid var(--lv-border); cursor: pointer; transition: all .18s ease; display: flex; flex-direction: column; gap: 4px; }
  .lv-mode:hover:not(.lv-mode--disabled) { transform: translateY(-2px); box-shadow: var(--lv-sh-2); border-color: var(--lv-accent); }
  .lv-mode b { font-size: 14px; }
  .lv-mode--disabled { opacity: .55; cursor: not-allowed; }
  .lv-resume { display: flex; gap: 14px; align-items: center; }
  .lv-resume > div:first-child { flex: 1; }
  .lv-session-head { justify-content: flex-start; }
  .lv-pure .lv-stem, .lv-pure .lv-opt > span:not(.key) { display: none; }
  .lv-pure .lv-opt .key { filter: none; }
  .lv-pure .lv-opt { justify-content: center; }
  .lv-question { margin-top: 6px; }
  .lv-stem { font-size: 16px; line-height: 1.75; margin-bottom: 14px; white-space: pre-wrap; }
  .lv-opt { display: flex; gap: 12px; align-items: flex-start; width: 100%; text-align: left; padding: 11px 14px; border-radius: var(--lv-r-2); border: 1.5px solid var(--lv-border); margin-bottom: 8px; cursor: pointer; background: var(--lv-surface); font: inherit; color: inherit; transition: all var(--lv-dur-micro) ease; }
  .lv-opt:hover:not([disabled]) { border-color: var(--lv-accent); background: var(--lv-accent-soft); }
  .lv-opt .key { width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; flex: none; font-size: 12.5px; font-weight: 700; background: var(--lv-surface-2); color: var(--lv-text-2); border: 1px solid var(--lv-border); }
  .lv-opt.sel { border-color: var(--lv-accent); background: var(--lv-accent-soft); }
  .lv-opt.sel .key { background: var(--lv-accent); border-color: var(--lv-accent); color: var(--b3-theme-on-primary, #fff); }
  .lv-opt.right { border-color: var(--lv-green); background: var(--lv-green-soft); }
  .lv-opt.right .key { background: var(--lv-green); border-color: var(--lv-green); color: var(--b3-theme-on-primary, #fff); }
  .lv-opt.wrong { border-color: var(--lv-red); background: var(--lv-red-soft); }
  .lv-opt.wrong .key { background: var(--lv-red); border-color: var(--lv-red); color: var(--b3-theme-on-primary, #fff); }
  .lv-feedback { margin: 12px 0; padding: 10px 14px; border-radius: var(--lv-r-2); font-weight: 650; font-size: 14px; background: var(--lv-red-soft); color: var(--lv-red); }
  .lv-feedback.good { background: var(--lv-green-soft); color: var(--lv-green); }
  .lv-analysis { border-left: 3px solid var(--lv-accent); background: var(--lv-surface-2); border-radius: 0 var(--lv-r-2) var(--lv-r-2) 0; padding: 10px 14px; font-size: 13.5px; color: var(--lv-text-2); margin-bottom: 10px; white-space: pre-wrap; }
  .lv-error { margin: 8px 0; padding: 10px 14px; border-radius: var(--lv-r-2); background: var(--lv-red-soft); color: var(--lv-red); font-size: 13px; }
  .lv-success { margin: 8px 0; padding: 10px 14px; border-radius: var(--lv-r-2); background: var(--lv-green-soft); color: var(--lv-green); font-size: 13px; font-weight: 650; }
  .lv-error-row { font-size: 12.5px; color: var(--lv-red); padding: 4px 2px; border-bottom: 1px dashed var(--lv-border); }
  .lv-empty { border: 1.5px dashed var(--lv-border); border-radius: 14px; padding: 26px; text-align: center; color: var(--lv-text-3); }
  .lv-skeleton { height: 180px; border-radius: var(--lv-r-3); background: linear-gradient(100deg, var(--lv-surface-2) 40%, var(--lv-surface) 50%, var(--lv-surface-2) 60%); background-size: 200% 100%; animation: lv-shimmer 1.4s infinite; border: 1px solid var(--lv-border); }
  @keyframes lv-shimmer { to { background-position: -200% 0; } }
  .lv-qrow { padding: 12px 16px; margin-bottom: 8px; }
  .lv-qrow-head { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; flex-wrap: wrap; }
  .lv-qrow-src { margin-left: auto; font-size: 11.5px; }
  .lv-qrow-stem { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lv-rate { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }
  .lv-rate .lv-btn { justify-content: center; }
  .lv-rate .r1:hover { border-color: var(--lv-red); color: var(--lv-red); }
  .lv-rate .r2:hover { border-color: var(--lv-amber); color: var(--lv-amber); }
  .lv-rate .r3:hover { border-color: var(--lv-green); color: var(--lv-green); }
  .lv-rate .r4:hover { border-color: var(--lv-accent); color: var(--lv-accent); }
  @media (max-width: 960px) { .lv-modes { grid-template-columns: repeat(2, 1fr); } }
  @media (prefers-reduced-motion: reduce) { .lv-skeleton { animation: none; } .lv-mode, .lv-btn, .lv-opt { transition: none; } }
</style>
