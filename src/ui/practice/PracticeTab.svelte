<script lang="ts">
    // 练习台：入口(S1) / 会话(S2) / 浏览(S3) / 导入(S9) 四视图
    // 状态设计（docs/11）：loading/empty(守卫)/error/normal 四态可达
    import { onMount } from "svelte";
import { showMessage } from "siyuan";
import { planToday } from "@/core/planner";
import { ttsSpeak } from "@/core/tts";
    import type { ExamApp } from "../../app";
    import type { Question } from "../../core/types";
    import { parseText, parseExcelRows, autoMapExcel, errorsToCsv, type ImportReport } from "../../importer/pipeline";
    import { groupAdjacent } from "../../core/session";
    import { makeQuestion } from "../../core/blockTemplate";
    import { grade } from "../../core/answer";

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
    let importResult = $state<null | { written: number }>(null);

    const bankName = $derived(banks.find((b) => b.id === activeBankId)?.name ?? "");
    const hasBank = $derived(banks.length > 0);
    const offline = $derived(!app.kernelOnline);

    onMount(() => {
      if (!app) { loading = false; errorMsg = t("state.appNotReady"); return; }
      void (async () => {
        try { explainHistory = ((await (app as any).deps.storage.load("ai/explain-history")) ?? {}) as Record<string, import("@/ai/client").AiMessage[]>; } catch { /* 忽略 */ }
        await restoreAiQueue();
      })();
      banks = app.listBanks();
      if (banks.length) activeBankId = banks[0].id;
      // Dock 信号优先：按 qid 直达单题
      if (consumePendingQuestion()) { loading = false; return; }
      /** Dock 信号：按 qid 开单题会话（题目从已加载列表定位） */
    function consumePendingQuestion() {
      const pid = (plugin as any).pendingQuestionId as string | undefined;
      if (!pid) return false;
      (plugin as any).pendingQuestionId = undefined;
      const q = questions.find((x) => x.id === pid);
      if (!q) { errorMsg = t("state.emptyBank"); return true; }
      void app.startSession([q], "wrong").then((s) => {
        session = s; feedback = null; selected = ""; sessionDone = null; view = "session";
      });
      return true;
    }

    // 查询圈题待处理集（块菜单发起，优先于恢复）
      const pending = (plugin as any).pendingPractice as Question[] | undefined;
      if (pending?.length && app.currentSession()?.phase !== "running") {
        (plugin as any).pendingPractice = undefined;
        app.startSession(pending, "query").then((s) => { session = s; view = "session"; loading = false; }).catch(() => { loading = false; });
        return;
      }
      // 恢复未完成会话
      app.resumeSession(async (qids) => {
        const all = await loadQuestions();
        return qids.map((id) => all.find((q) => q.id === id)).filter(Boolean) as Question[];
      }).then((s) => {
        if (s) { session = s; view = "session"; }
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
      if (!confirm(t("bank.removeConfirm").replace("{name}", bankName))) return;
      (app as any).removeBank(activeBankId);
      banks = app.listBanks();
      activeBankId = banks[0]?.id ?? "";
      showMessage(t("bank.removed"), 2800, "info");
    }

    async function startDrill(mode: string) {
      errorMsg = "";
      const qs = (await loadQuestions()).filter((q) => q.type !== "material");
      if (!qs.length) { errorMsg = t("state.emptyBank"); return; }
      let picked: Question[] = [];
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
      session = await app.startSession(groupAdjacent(picked), mode);
      feedback = null; selected = ""; sessionDone = null;
      view = "session";
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

    /** 共用题干：材料组母卡（背诵视图） */    const reciteMaterial = $derived.by(() => {
      const q = reciteQueue[reciteCursor];
      if (!q?.group) return "";
      const mat = questions.find((x) => x.type === "material" && x.group === q.group);
      return mat?.stem ?? "";
    });

    /** 备考计划（v0.5）：读取设置考日 → planToday 聚合（冲刺 cram 优先/常规到期优先） */
    // 可练习题过滤在 loadQuestions 后各入口处执行（材料母块只作上下文）

    let plan = $state<ReturnType<typeof import("@/core/planner").planToday> | null>(null);

    function rebuildPlan() {
      if (!app) { plan = null; return; }
      const examDate = String(plugin.settingUtils?.get?.("examDate") ?? "").trim();
      const sprintDays = Number(plugin.settingUtils?.get?.("sprintDays") ?? 14);
      const goal = Number(plugin.settingUtils?.get?.("dailyGoal") ?? 10);
      const wrongCounts = new Map<string, number>();
      for (const w of app.derived().wrongbook.values()) wrongCounts.set(w.qid, w.wrongCount);
      const activeWrongIds = new Set(app.wrongItems().map((w) => w.qid));
      plan = planToday({
        examDate: examDate || undefined,
        sprintDays: Number.isFinite(sprintDays) && sprintDays > 0 ? sprintDays : 14,
        dailyGoal: Number.isFinite(goal) && goal > 0 ? goal : 10,
        all: questions, wrongCounts, activeWrongIds,
        wrongReasons: (app as any).wrongReasonMap?.() ?? undefined,
      });
    }

    /** 每日任务直接使用计划队列（零决策入口） */
    async function startToday() {
      errorMsg = "";
      const qs = (await loadQuestions()).filter((q) => q.type !== "material");
      if (!qs.length) { errorMsg = t("state.emptyBank"); return; }
      rebuildPlan();
      const queue = groupAdjacent((plan?.queue?.length ? plan.queue : qs.slice(0, 10)).filter((q) => q.type !== "material"));
      session = await app.startSession(queue, plan?.mode === "sprint" ? "cram" : "daily");
      feedback = null; selected = ""; sessionDone = null;
      view = "session";
    }

    // ---------- 背诵（S4 lite） ----------
    function startRecite() { void 0; // 背诵朗读按钮在视图内直接调用 ttsSpeak
      const qs = app.wrongDrill(questions.length ? questions : []);
      const pool = qs.length ? qs : questions;
      if (!pool.length) { errorMsg = t("state.emptyBank"); return; }
      reciteQueue = app.quickDrill(pool, 15);
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
        session = await app.startSession(qs, "challenge");
        feedback = null; selected = ""; sessionDone = null;
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
        // Electron 提供绝对路径；browser 前端按钮已隐藏
        const path = (file as any).path as string | undefined;
        if (!path) { showMessage(t("share.needDesktop"), 4200, "error"); return; }
        await (app as any).importBankSyZip(path);
        banks = app.listBanks();
        showMessage(t("share.importDone"), 4000, "info");
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
    let explainFollowUp = $state("");

    async function explainCurrent(mode: "explain" | "hint" | "socratic" = "explain") {
      const q = session?.current;
      if (!q || explainBusy || !feedback) return;
      explainBusy = true; explainText = ""; explainQid = q.id;
      try {
        const { SiyuanAiChannel, OpenAiChannel } = await import("@/ai/client");
        const { buildExplainMessages } = await import("@/ai/explain");
        const endpoint = String(plugin.settingUtils?.get?.("aiEndpoint") ?? "");
        const key = String(plugin.settingUtils?.get?.("aiKey") ?? "");
        const model = String(plugin.settingUtils?.get?.("aiModel") ?? "gpt-4o-mini");
        const ch = endpoint && key
          ? new OpenAiChannel({ endpoint, apiKey: key, model }, (u, i) => fetch(u, i))
          : new SiyuanAiChannel((app as any).deps.client);
        const messages = buildExplainMessages(q, feedback.myAnswer, mode);
        explainText = await ch.chat(messages);
        explainHistory[q.id] = [...messages, { role: "assistant", content: explainText }];
        void persistExplainHistory();
      } catch (e) {
        explainText = String(e instanceof Error ? e.message : e);
      } finally { explainBusy = false; }
    }

    async function sendFollowUp() {
      const q = session?.current;
      const history = explainHistory[q?.id ?? ""];
      if (!q || !history?.length || explainBusy || !explainFollowUp.trim()) return;
      explainBusy = true;
      try {
        const { SiyuanAiChannel, OpenAiChannel } = await import("@/ai/client");
        const { continueExplainMessages } = await import("@/ai/explain");
        const endpoint = String(plugin.settingUtils?.get?.("aiEndpoint") ?? "");
        const key = String(plugin.settingUtils?.get?.("aiKey") ?? "");
        const model = String(plugin.settingUtils?.get?.("aiModel") ?? "gpt-4o-mini");
        const ch = endpoint && key
          ? new OpenAiChannel({ endpoint, apiKey: key, model }, (u, i) => fetch(u, i))
          : new SiyuanAiChannel((app as any).deps.client);
        const messages = continueExplainMessages(history, explainFollowUp.trim());
        const reply = await ch.chat(messages);
        explainHistory[q.id] = [...messages, { role: "assistant", content: reply }];
        void persistExplainHistory();
        explainText = (explainText.endsWith(reply) ? explainText : explainText + "\n\n") + "【追问】" + explainFollowUp.trim() + "\n" + reply;
        explainFollowUp = "";
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
      session = await app.startSession(picked, "special");
      feedback = null; selected = ""; sessionDone = null;
      view = "session";
    }

    async function resume() {
      const s = await app.resumeSession(async (qids) => {
        const all = await loadQuestions();
        return qids.map((id) => all.find((q) => q.id === id)).filter(Boolean) as Question[];
      });
      if (s) { session = s; feedback = null; selected = ""; view = "session"; }
    }

    function submitAnswer() {
      if (!session || feedback) return;
      const q = session.current;
      if (!q) return;
      const timeMs = Date.now() - answerStart;
      // 选择题/判断用 selected；填空/简答用 draft
      const ans = q.options.length ? selected : session.getDraft(q.id);
      const g = grade(q, ans || null);
      session.submit(ans || null, timeMs);
      app.recordAttempt({
        qid: q.id, kind: "practice", mode: session.state.mode,
        verdict: g.verdict, myAnswer: g.myAnswer, sessionId: session.id,
        queue: session.state.mode === "wrong" ? "wrong" : "normal", timeMs,
      });
      feedback = { verdict: g.verdict, myAnswer: g.myAnswer };
      plugin.refreshDock?.();
    }

    function nextQuestion() {
      feedback = null; selected = ""; answerStart = Date.now();
      if (!session.next()) finishSession();
    }

    async function finishSession() {
      sessionDone = session.finish();
      await app.saveSession();
      await app.flush();
      plugin.refreshDock?.();
      rebuildPlan();
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

    async function exitSession() {
      if (!session) { view = "entry"; return; }
      if (!sessionDone && session.answered.length && !confirm(t("session.exitConfirm"))) return;
      await app.saveSession();
      await app.flush();
      session = null; feedback = null; selected = ""; sessionDone = null;
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
      } catch (e) {
        errorMsg = offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e);
      } finally { mSaving = false; }
    }

    // ---------- AI 出题（v0.4：双通道 + 待审核队列，Inbox 式永不直接入库） ----------
    let aiSource = $state("");
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
      try { await (app as any).deps.storage.save("ai/review-queue", { queue: aiQueue, rejected: aiRejected, duplicates: aiDuplicates }); } catch { /* 忽略 */ }
    }
    async function restoreAiQueue() {
      try {
        const v = (await (app as any).deps.storage.load("ai/review-queue")) as { queue: Question[]; rejected: typeof aiRejected; duplicates: number } | undefined;
        if (v?.queue?.length) { aiQueue = v.queue; aiRejected = v.rejected ?? []; aiDuplicates = v.duplicates ?? 0; }
      } catch { /* 忽略 */ }
    }

    async function runAiGenerate() {
      if (aiBusy || !aiSource.trim()) return;
      // 首次调用数据流确认（26.2 P0）：端点/范围/取消入口
      if (!localStorage.getItem("lv-exam-ai-consent")) {
        const ep = String(plugin.settingUtils?.get?.("aiEndpoint") ?? "").trim();
        const msg = ep
          ? `${t("ai.consentTitle")}\n${t("ai.consentCustom")} ${ep}`
          : `${t("ai.consentTitle")}\n${t("ai.consentSiyuan")}`;
        if (!confirm(`${msg}\n\n${t("ai.consentScope")}`)) return;
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
        aiQueue = r.pending; aiRejected = r.rejected; aiDuplicates = r.duplicates;
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
        aiQueue = [...aiQueue, ...r.pending];
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

    async function approveAi(q: Question) {
      await app.writeManualQuestion(activeBankId, q);
      aiQueue = aiQueue.filter((x) => x.id !== q.id);
      aiSaved++;
      aiQueue = aiQueue.filter((x) => x.id !== q.id);
      aiSaved++;
      void persistAiQueue();
    }

    function dropAi(q: Question) {
      aiQueue = aiQueue.filter((x) => x.id !== q.id);
      void persistAiQueue();
    }

    async function approveAllAi() {
      for (const q of [...aiQueue]) await approveAi(q);
      void persistAiQueue();
    }

    // ---------- 导入 ----------
    function doParseText() {
      importError = ""; importResult = null;
      if (!importText.trim()) { importError = t("import.noInput"); return; }
      try {
        importReport = parseText(importText);
      } catch (e) { importError = String(e); }
    }

    async function onExcelFile(e: Event) {
      importError = ""; importResult = null; importReport = null;
      // 清理上次导入残留（TODO 27 组：多 Sheet 残留状态 bug 预防）
      pendingWorkbook = null; sheetNames = []; sheetRowsCache = new Map();
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      try {
        const XLSX = await import("xlsx");
        const { decodeCsv } = await import("@/importer/csvDecode");
        const buf = await file.arrayBuffer();
        const { text, garbled } = decodeCsv(buf);
        if (garbled) showMessage(t("import.garbledWarning"), 5200, "info");
        pendingWorkbook = XLSX.read(text, { type: "string" });
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
      const rows = sheetRowsCache.get(activeSheet);
      if (!rows?.length) { importError = t("import.emptyFile"); return; }
      const { map, missing } = autoMapExcel(rows[0].map(String));
      if (missing.length) { importError = t("import.missingColumns") + missing.join("、"); return; }
      importReport = parseExcelRows(rows.slice(1), map);
    }

    let favOnly = $state(false);
    let browseLimit = $state(200);
    let searchText = $state("");
    const filteredQuestions = $derived.by(() => {
      let list = favOnly ? questions.filter((q) => q.fav) : questions;
      const kw = searchText.trim().toLowerCase();
      if (kw) {
        list = list.filter((q) =>
          q.stem.toLowerCase().includes(kw) ||
          q.options.some((o) => o.toLowerCase().includes(kw)) ||
          (q.analysis ?? "").toLowerCase().includes(kw));
      }
      return list;
    });
    const shownQuestions = $derived(filteredQuestions.slice(0, browseLimit));
    const hasMore = $derived(filteredQuestions.length > browseLimit);

    // ---------- 浏览详情：展开/文档跳转/反链 ----------
    let expandedId = $state("");
    let backlinkCache = $state(new Map<string, { docId: string; title: string; content: string }[]>());

    async function loadBacklinks(blockId: string) {
      if (!app.kernelOnline) return;
      try {
        const links = await (app as any).deps.client.backlinks(blockId);
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
    $effect(() => {
      const q = view === "session" ? session?.current : view === "recite" ? reciteQueue[reciteCursor] : null;
      if (!q) { stemHtml = ""; stemHtmlFor = ""; return; }
      // 竞态防护（27 组）：异步返回时校验仍是当前题才应用
      stemHtml = ""; stemHtmlFor = q.id;
      void app.renderStem(q).then((html) => {
        if (html && stemHtmlFor === q.id) stemHtml = html;
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
      committing = true; importError = "";
      try {
        const r = await app.commitImport(activeBankId, importReport);
        importResult = { written: r.written };
        importReport = null; importText = "";
      } catch (e) {
        importError = offline ? t("state.offlineHint") : String(e instanceof Error ? e.message : e);
      } finally { committing = false; }
    }
</script>

<svelte:window onkeydown={onKeydown} ondragover={(e) => e.preventDefault()} ondrop={onDrop} />

<div class="fn__flex-1 lv-exam-tab" role="region" aria-label={t("tab.practice")}>
  <div class="block__icons">
    <div class="block__logo">
      <svg class="block__logoicon"><use xlink:href="#iconExam"></use></svg>
      {t("tab.practice")}
    </div>
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
                  {#each expKpRoots as k}<option value={k}>{k}</option>{/each}
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
          {#if session.answered.length}
            <div class="lv-row" style="flex-wrap:wrap;gap:4px;margin:8px 0">
              {#each session.answered as a, ai}
                {@const aq = questions.find((x) => x.id === a.qid)}
                <span class="lv-chip num" class:lv-chip--grn={a.grade.verdict === "correct"} class:lv-chip--red={a.grade.verdict === "wrong"} title={aq?.stem.slice(0, 60) ?? a.qid}>{ai + 1} {a.grade.verdict === "correct" ? "✓" : a.grade.verdict === "wrong" ? "✕" : "–"} {(a.timeMs / 1000).toFixed(0)}s</span>
              {/each}
            </div>
          {/if}
          {#if sessionDone.wrong > 0}
            <button class="lv-btn" style="width:100%" onclick={sameKpSession}>🔁 {t("memory.sameKp")}</button>
            <button class="lv-btn" style="width:100%;margin-top:6px" onclick={wrongsToCard}>🎴 {t("session.wrongsToCard")}</button>
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
              <div class="lv-analysis" style="margin-bottom:12px"><b>📎 共用材料：</b>{materialContext}</div>
            {/if}
            {#if stemHtml}<div class="lv-stem lv-rich b3-typography">{@html stemHtml}</div>{:else}<div class="lv-stem">{q.stem}</div>{/if}
            {#if q.options.length}
              <div role="radiogroup" aria-label={t("session.options")}>
                {#each q.options as opt, i}
                  <button class="lv-opt" class:sel={selected.includes(String.fromCharCode(65 + i))}
                    role="radio" aria-checked={selected === String.fromCharCode(65 + i)}
                    class:right={feedback && feedback.verdict !== "not_attempted" && q.answer.includes(String.fromCharCode(65 + i)) && (q.type === "single" ? q.answer === String.fromCharCode(65 + i) : true)}
                    class:wrong={feedback && feedback.myAnswer === String.fromCharCode(65 + i) && feedback.verdict === "wrong"}
                    onclick={() => {
                      if (feedback) return;
                      const L = String.fromCharCode(65 + i);
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
                    <span class="key">{String.fromCharCode(65 + i)}</span>
                    <span>{opt}</span>
                  </button>
                {/each}
              </div>
            {:else}
              <textarea class="lv-input lv-textarea" placeholder={t("session.answerPlaceholder")}
                value={session.getDraft(q.id)}
                oninput={(e) => session.setDraft(q.id, (e.target as HTMLTextAreaElement).value)}
                disabled={!!feedback}></textarea>
            {/if}

            {#if feedback}
              <div class="lv-feedback" class:good={feedback.verdict === "correct"}>
                {feedback.verdict === "correct" ? "✓ " + t("session.correct") : feedback.verdict === "wrong" ? "✕ " + t("session.wrongAns") + " " + q.answer : "– " + t("session.skipped")}
              </div>
              {#if q.analysis}<div class="lv-analysis">{q.analysis}</div>{/if}
              {#if feedback.verdict === "wrong"}
                <div class="lv-row lv-muted">{t("session.reason")}:
                  {#each ["careless", "unknown", "trap"] as r, ri}
                    <button class="lv-chip" class:acc={savedReason === r} title={t("entry.days") === "天" ? `快捷键 ${ri + 1}` : `Key ${ri + 1}`} onclick={async () => { await app.saveWrongReason(q.id, r as any); savedReason = r; }}>{savedReason === r ? "✓ " : ""}{t("reason." + r)}</button>
                  {/each}
                </div>
              {/if}
            {/if}
            {#if !feedback}
              <div class="lv-row lv-muted" style="font-size:11px;gap:6px;flex-wrap:wrap">
                <span class="lv-kbd">A</span>-<span class="lv-kbd">J</span> {t("session.choose")} ·
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
              {#each q.options as opt, i}
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
        {#if mSaved}<span class="lv-chip lv-chip--grn num">✓ {mSaved}</span>{/if}
      </div>
      <div class="lv-card lv-pad-card">
        <div class="lv-row">
          <span class="lv-chip">{t("manual.type")}</span>
          {#each ["single", "multiple", "judge", "fill", "short"] as tt}
            <button class="lv-chip" class:acc={mType === tt} onclick={() => { mType = tt as any; mAnswer = ""; }}>{t("qtype." + tt)}</button>
          {/each}
        </div>
        <div class="lv-field"><span class="lv-muted">{t("manual.stem")}</span>
          <textarea class="lv-input lv-textarea" bind:value={mStem} placeholder={t("manual.stemPlaceholder")} aria-label={t("manual.stem")}></textarea>
        </div>
        {#if mType === "single" || mType === "multiple"}
          <div class="lv-field"><span class="lv-muted">{t("manual.options")}</span>
            {#each mOptions as _opt, i}
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
        </div>
        <div class="lv-row">
          <span class="lv-chip">{t("ai.count")}</span>
          {#each [3, 5, 10, 20] as n}
            <button class="lv-chip" class:acc={aiCount === n} onclick={() => aiCount = n}>{n}</button>
          {/each}
          <span class="lv-chip">{t("ai.difficulty")}</span>
          {#each ["easy", "medium", "hard", "mixed"] as d}
            <button class="lv-chip" class:acc={aiDifficulty === d} onclick={() => aiDifficulty = d as any}>{t("ai.diff." + d)}</button>
          {/each}
        </div>
        <div class="lv-row">
          <span class="lv-chip">{t("ai.preset")}</span>
          {#each ["default", "gongkao", "kaoyan", "yixue", "jiakao"] as p}
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
            <div class="lv-qrow-stem">{q.stem}</div>
            {#if q.options.length}
              <div class="lv-muted" style="margin-top:4px">{q.options.map((o, i) => String.fromCharCode(65 + i) + ". " + o).join("　")}</div>
            {/if}
            <div class="lv-analysis" style="margin:8px 0 0">{q.analysis}</div>
            <div class="lv-row" style="margin:8px 0 0">
              <button class="lv-btn sm lv-btn--primary" onclick={() => approveAi(q)}>✓ {t("ai.approve")}</button>
              <button class="lv-btn sm lv-btn--ghost" onclick={() => dropAi(q)}>✕ {t("ai.drop")}</button>
            </div>
          </div>
        {/each}
        {#each aiRejected.slice(0, 10) as rj}
          <div class="lv-error-row"><b class="num">#{rj.index}</b> {rj.reason}</div>
        {/each}
      {/if}
    </div>
  {:else if view === "browse"}
    <!-- ===== S3 浏览 ===== -->
    <div class="lv-pad">
      <div class="lv-row">
        <button class="lv-btn lv-btn--ghost" onclick={() => view = "entry"}>← {t("mode.practice")}</button>
        <span class="lv-chip num">{shownQuestions.length}/{questions.length} {t("browse.count")}</span>
        <button class="lv-chip" class:acc={favOnly} onclick={() => favOnly = !favOnly}>⭐ {t("browse.favOnly")}</button>
        <input class="lv-input" style="flex:1;min-width:160px" placeholder={t("browse.searchPlaceholder")} bind:value={searchText} />
      </div>
      {#if questionsError}
        <div class="lv-error">{questionsError}</div>
      {:else if !questions.length}
        <div class="lv-empty">{t("browse.empty")}</div>
      {:else}
        {#each shownQuestions as q (q.id)}
          <div class="lv-card lv-qrow">
            <div class="lv-qrow-head" role="button" tabindex="0"
              onclick={() => expandedId = expandedId === q.id ? "" : q.id}
              onkeydown={(e) => e.key === "Enter" && (expandedId = expandedId === q.id ? "" : q.id)}>
              <span class="lv-chip lv-chip--acc">{t("qtype." + q.type)}</span>
              {#if q.kp}<span class="lv-chip">{q.kp}</span>{/if}
              {#if q.source}<span class="lv-muted lv-qrow-src">{q.source}</span>{/if}
            </div>
            <div class="lv-qrow-stem">{q.stem}</div>
            {#if expandedId === q.id}
              {@const links = app.kernelOnline ? backlinkCache.get(q.blockId) : undefined}
              <div class="lv-detail">
                <div class="lv-muted"><b>{t("browse.answer")}:</b> {q.answer}{#if q.analysis} · {q.analysis}{/if}</div>
                <div class="lv-row">
                  <button class="lv-btn sm" onclick={() => openInSiYuan((q as any).rootId)}>📍 {t("browse.openDoc")}</button>
                  <button class="lv-btn sm" onclick={() => void loadBacklinks(q.blockId)}>🔗 {t("browse.backlinks")}</button>
                  {#if links}
                    {#if links.length === 0}<span class="lv-muted">{t("browse.noBacklinks")}</span>
                    {:else}{#each links as l}<span class="lv-chip" title={l.content}>📎 {l.title}</span>{/each}{/if}
                  {/if}
                </div>
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
            <span class="lv-muted">{t("import.excelNote")}</span>
          </div>
          {#if importError}<div class="lv-error">{importError}</div>{/if}
          {#if importReport}
            <div class="lv-row">
              <span class="lv-chip lv-chip--grn num">✓ {importReport.ok.length}</span>
              <span class="lv-chip lv-chip--red num">✕ {importReport.errors.length}</span>
              {#if importReport.duplicates}<span class="lv-chip lv-chip--amb num">⧉ {importReport.duplicates}</span>{/if}
            </div>
            {#each importReport.errors.slice(0, 20) as err}
              <div class="lv-error-row"><b class="num">#{err.row}</b> {err.reason}<span class="lv-muted"> · {err.raw}</span></div>
            {/each}
            {#if importReport.errors.length > 20}<div class="lv-muted num">… +{importReport.errors.length - 20}</div>{/if}
            {#if importReport.errors.length}
              <div class="lv-row">
                <button class="lv-btn sm" onclick={downloadErrorsCsv}>⬇️ {t("import.exportErrors")}</button>
              </div>
            {/if}
            <div class="lv-row">
              <button class="lv-btn lv-btn--primary" onclick={commitImport} disabled={!importReport.ok.length || committing}>
                {committing ? "…" : t("import.commit") + " (" + importReport.ok.length + ")"}
              </button>
            </div>
          {/if}
          {#if importResult}
            <div class="lv-success">✓ {t("import.done")} {importResult.written}</div>
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
  .lv-btn--primary { background: var(--lv-accent-grad); border-color: transparent; color: #fff; box-shadow: var(--lv-glow, none); }
  .lv-btn--ghost { border-color: transparent; color: var(--lv-text-2); background: transparent; }
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
  .lv-opt.sel .key { background: var(--lv-accent); border-color: var(--lv-accent); color: #fff; }
  .lv-opt.right { border-color: var(--lv-green); background: var(--lv-green-soft); }
  .lv-opt.right .key { background: var(--lv-green); border-color: var(--lv-green); color: #fff; }
  .lv-opt.wrong { border-color: var(--lv-red); background: var(--lv-red-soft); }
  .lv-opt.wrong .key { background: var(--lv-red); border-color: var(--lv-red); color: #fff; }
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
