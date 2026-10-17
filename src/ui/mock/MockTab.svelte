<script lang="ts">
    // 模考场（v0.3）：蓝图配置器 → 全真考试（计时/答题卡/标旗）→ 成绩单
    // 规格见 docs/11 S5/S6/S7；引擎见 src/core/mock.ts（53 项单测覆盖）
    import { onDestroy, onMount } from "svelte";

    /** 切屏计数（docs/11 S6：失焦计次进报告，不阻断） */
    function onBlur() { if (view === "exam" && session && !session.submitted) session.screenSwitches++; }
    import type { ExamApp } from "../../app";
    import Rail from "../shared/Rail.svelte";
    import type { Question } from "../../core/types";
    import { showMessage } from "siyuan";
    import { assemble, blueprintTotals, defaultMockSections, dedupeSectionNames, MockSession, validateBlueprint, type Blueprint, type BlueprintSection, type MockRunSnapshot, type MockScore } from "../../core/mock";
    import { newRunId } from "../../core/ids";
    import { emitExamEvent, onExamEvent } from "../../core/bus";
    import { openPracticeView } from "../../core/pluginTab";
    import { answerChoices, isChoiceQuestion, toggleChoice } from "../../core/answerChoices";
    import { specOf, splitBlanks, joinBlanks } from "../../core/structuredAnswer";
    import { estimateScore, normalizeEstimateInput } from "../../core/estimate";
    import Icon from "../shared/Icon.svelte";
    import Palette from "../shared/Palette.svelte";
    import type { PaletteCommand } from "../shared/Palette.svelte";
    import SaveStatus from "../shared/SaveStatus.svelte";
    import { mockSectionsToCsv, mockHistoryToCsv } from "../../core/exportMd";
    import { renderInlineText } from "../../libs/sanitize";
    
    let { plugin, examApp }: { plugin: any; examApp?: ExamApp | null } = $props();
    let appOverride = $state<ExamApp | null>(null);
    const app = $derived<ExamApp | null>(appOverride ?? examApp ?? plugin?.examApp ?? null);
    const i18n = $derived(plugin?.i18n ?? {});
    const t = (k: string, fb = "") => i18n[k] ?? fb;

    /** 侧栏项目卡显示名：当前题库（无题库时回退建库引导文案） */
    let activeBankName = $state("");
    const railBankName = $derived(activeBankName || t("guard.title"));

    let railOpen = $state(false);
    let tabRoot: HTMLDivElement | null = null;
    let menuBtn: HTMLButtonElement | null = null;
    function closeRail() { railOpen = false; menuBtn?.focus(); }

    type View = "config" | "exam" | "report";
    let view: View = $state("config");
    let paletteOpen = $state(false);
    const paletteCommands: PaletteCommand[] = [
      { group: t("palette.views"), icon: "clock", label: t("tab.mock"), keywords: "mock config blueprint", run: () => { if (view !== "exam") showConfig(); } },
      { group: t("palette.actions"), icon: "play", label: t("mock.start"), keywords: "start exam", run: () => { if (view === "config") void startExam(); } },
      { group: t("palette.actions"), icon: "rotate", label: t("mock.resumeGo"), keywords: "resume", run: () => { if (view === "config" && resumable) void resumeExam(); } },
      { group: t("palette.tabs"), icon: "home", label: t("tab.practice"), keywords: "practice", run: () => plugin.openPractice?.() },
      { group: t("palette.tabs"), icon: "chart", label: t("tab.report"), keywords: "report stats", run: () => plugin.openReport?.() },
    ];
    let loading = $state(true);
    let errorMsg = $state("");
    let questions = $state<Question[]>([]);

    let bp = $state<Blueprint>({
      id: "bp-default", name: t("mock.defaultName"), durationS: 3600, passLine: 60,
      shuffleOptions: false, sectionTimed: true,
      sections: []
    });

    let session: MockSession | null = $state(null);
    let cursor = $state(0);
    let selected = $state("");
    let answeredMap = $state<Record<string, string>>({});
    let feedbackOn = $state(false);          // 模考默认不即时判分；交卷后统一
    let score = $state<MockScore | null>(null);
    let history = $state<any[]>([]);
    let historyDetail = $state(-1);
    let nowTick = $state(Date.now());
    let timer: ReturnType<typeof setInterval> | null = null;
    let startedAt = $state(0);

    // ---------- 运行快照（U19/U20 最小）：runId 与蓝图分离；交卷防重 ----------
    let runId = $state("");
    let submitting = $state(false);
    let handInConfirming = $state(false);
    let resumable = $state<MockRunSnapshot | null>(null);
    let restoreNote = $state("");
    let lastSnapAt = 0;
    let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
    let runSaveBusy = $state(false);
    let runSaveQueued = $state(false);
    let runSaveConfirmed = $state(false);
    let runSaveError = $state("");
    let runSaveRevision = 0;
    let submitError = $state("");
    let extraTimeBusy = $state(false);
    let blueprintBusy = $state(false);
    const BANK_PREF_KEY = "lv-exam/activeBank";
    let starting = $state(false);
    let resumeBusy = $state(false);
    let discardBusy = $state(false);
    // 考试/成绩页保留原题库上下文；配置页再消费题库变化，读取中的后续变化合并重试。
    let bankDataDirty = false;
    let mockDataLoading = false;
    let pendingBankId: string | null = null;
    let historyLoading = $state(true);
    let historyError = $state("");
    let historyRequest = 0;

    async function reloadMockHistory() {
      const request = ++historyRequest;
      historyLoading = true;
      historyError = "";
      try {
        const next = await app.listMockResults();
        if (request === historyRequest) history = next;
      } catch (e) {
        if (request === historyRequest) {
          history = [];
          historyError = t("mock.historyLoadFailed", "模考历史读取失败：{message}").replace("{message}", String(e instanceof Error ? e.message : e));
        }
      } finally {
        if (request === historyRequest) historyLoading = false;
      }
    }

    const blueprintIssues = $derived(validateBlueprint(bp));
    const blueprintBlockingIssues = $derived(blueprintIssues.filter((x) => !x.includes("题数为 0")));
    const hasPositiveSection = $derived(bp.sections.some((s) => s.count > 0));
    const canStartExam = $derived(Boolean(questions.length && bp.sections.length && hasPositiveSection && !blueprintBlockingIssues.length && !loading && !starting && !submitting && !resumeBusy && !discardBusy && !blueprintBusy));
    const examLocked = $derived(submitting || Boolean(session?.submitted));

    function emitMockSessionEnded() {
      if (!session || !score) return;
      const answers = [...session.answers.values()];
      emitExamEvent("session-ended", {
        sessionId: runId,
        mode: "mock",
        total: session.state.qids.length,
        correct: answers.filter((a) => a.verdict === "correct").length,
        wrong: answers.filter((a) => a.verdict === "wrong").length,
      });
    }
    const startDisabledReason = $derived(
      !bp.sections.length ? t("mock.needSec")
        : !hasPositiveSection ? t("mock.needPositiveSec", "至少需要一个题数大于 0 的模块")
        : blueprintBlockingIssues.length ? blueprintBlockingIssues.join("；")
        : !questions.length ? t("state.emptyBank")
        : "",
    );

    onDestroy(() => {
      if (timer) { clearInterval(timer); timer = null; }
      // Ensure answers entered during the 3s throttle window survive leaving this tab.
      if (snapshotTimer) { clearTimeout(snapshotTimer); snapshotTimer = null; }
      runSaveQueued = false;
      persistRun(true);
    });

    /** 快照节流保存（3s）：关页/休眠后按 wall clock 恢复同一 run */
    function persistRun(force = false) {
      if (!session || session.submitted || !runId) return;
      const now = Date.now();
      if (!force && now - lastSnapAt < 3000) {
        runSaveConfirmed = false;
        runSaveQueued = true;
        if (!snapshotTimer) {
          snapshotTimer = setTimeout(() => {
            snapshotTimer = null;
            persistRun(true);
          }, 3000 - (now - lastSnapAt));
        }
        return;
      }
      if (snapshotTimer) { clearTimeout(snapshotTimer); snapshotTimer = null; }
      runSaveQueued = false;
      lastSnapAt = now;
      const revision = ++runSaveRevision;
      runSaveBusy = true;
      runSaveConfirmed = false;
      runSaveError = "";
      // ExamApp.saveMockRun serializes writes through its mockRunSaveTail. This
      // lets a newer snapshot queue behind an older one while preserving the
      // latest-answer-wins ordering even when storage is slow or a retry is
      // triggered during an earlier write.
      void app.saveMockRun(session.toSnapshot(runId, now)).then(() => {
        if (revision === runSaveRevision) runSaveConfirmed = true;
      }).catch((e) => {
        if (revision === runSaveRevision) {
          runSaveError = t("mock.runSaveFailed", "答题进度保存失败：{message}。当前答案仍保留在页面中，可重试保存。")
            .replace("{message}", String(e instanceof Error ? e.message : e));
        }
      }).finally(() => {
        if (revision === runSaveRevision) runSaveBusy = false;
      });
    }

    function retryRunSave() {
      if (runSaveBusy) return;
      persistRun(true);
    }

    async function extendExamTime() {
      if (!session || !runId || extraTimeBusy || session.state.extraTimeS) return;
      extraTimeBusy = true;
      const previousExtraTime = session.state.extraTimeS ?? 0;
      try {
        session.extendTime(300);
        await app.saveMockRun(session.toSnapshot(runId, Date.now()));
        lastSnapAt = Date.now();
        showMessage(t("mock.extraAdded"), 3000, "info");
      } catch (e) {
        session.state.extraTimeS = previousExtraTime;
        showMessage(t("mock.extraSaveFailed").replace("{message}", String(e instanceof Error ? e.message : e)), 4200, "error");
      } finally {
        extraTimeBusy = false;
      }
    }

    /** 读取当前题库并恢复进行中的模考。索引尚未完成时允许在当前页重试。 */
    async function loadMockData() {
      if (view !== "config" || starting || resumeBusy || discardBusy || mockDataLoading) {
        bankDataDirty = true;
        return;
      }
      if (!app) { loading = false; errorMsg = t("state.appNotReady"); return; }
      mockDataLoading = true;
      bankDataDirty = false;
      const requestedBankId = pendingBankId;
      pendingBankId = null;
      loading = true;
      errorMsg = "";
      try {
        const banks = app.listBanks();
        if (!banks.length) {
          questions = [];
          activeBankId = "";
          activeBankName = "";
          resumable = null;
          loading = false;
          errorMsg = t("guard.needBankFirst");
          return;
        }
        let rememberedBank = "";
        try { rememberedBank = localStorage.getItem(BANK_PREF_KEY) ?? ""; } catch { /* 隐私模式 */ }
        const previousBankId = activeBankId;
        const preferredBankId = requestedBankId ?? rememberedBank;
        activeBankId = banks.some((b) => b.id === preferredBankId) ? preferredBankId : banks[0].id;
        activeBankName = banks.find((b) => b.id === activeBankId)?.name ?? "";
        questions = await app.listQuestions(activeBankId);
        // 仅在没有可编辑蓝图时生成默认模块，重试不会覆盖用户已经配置的内容。
        if (!bp.sections.length || (previousBankId && previousBankId !== activeBankId)) bp.sections = defaultMockSections(questions);
        // 历史成绩用于恢复报告中的趋势对比；历史读取失败不应阻断当前模考。
        await reloadMockHistory();

        // 恢复提示（读不到快照=无进行中考试，静默即可；题库不可读时不给恢复入口）
        try {
          const snap = await app.loadMockRun();
          resumable = null;
          if (snap?.finishedAt) await app.clearMockRun();
          else if (snap && questions.length) resumable = snap;
        } catch { /* 恢复快照失败不应阻断题库使用 */ }
      } catch (e) {
        questions = [];
        errorMsg = String(e instanceof Error ? e.message : e);
      } finally {
        mockDataLoading = false;
        loading = false;
        refreshPendingBankData();
      }
    }

    function refreshPendingBankData() {
      if (bankDataDirty && view === "config" && !starting && !resumeBusy && !discardBusy) void loadMockData();
    }

    /** 所有回配置页的入口统一在此消费考试/成绩期间积累的题库变化。 */
    function showConfig() {
      if (scoreWriteBusy || scoreExportBusy || rewrongBusy) return;
      view = "config";
      refreshPendingBankData();
    }

    onMount(() => {
      const initMock = () => {
        if (!app) return;
        void loadMockData();
        void loadEstimateHistory();
      };
      if (app) initMock();
      const offs = [
        onExamEvent("app-ready", () => {
          appOverride = plugin?.examApp ?? null;
          if (appOverride) initMock();
        }),
        onExamEvent<{ bank: string }>("bank-changed", (event) => {
          bankDataDirty = true;
          pendingBankId = event.payload.bank;
          // 考试与成绩页都保留本次卷面、题库和蓝图，回到配置页后再读取。
          refreshPendingBankData();
        }),
      ];
      return () => offs.forEach((off) => off());
    });

    let sheetFilter = $state<"all" | "unanswered" | "flagged">("all");
    const unansweredIndices = $derived(
      session ? session.state.qids.map((qid, idx) => ({ qid, idx })).filter(({ qid }) => !answeredMap[qid]?.trim()).map((x) => x.idx) : [],
    );
    const flaggedIndices = $derived(
      session ? session.state.qids.map((qid, idx) => ({ qid, idx })).filter(({ qid }) => session.flags.has(qid)).map((x) => x.idx) : [],
    );

    function gotoNextUnanswered() {
      if (!session || !unansweredIndices.length) return;
      const after = unansweredIndices.find((idx) => idx > cursor);
      goto(after !== undefined ? after : unansweredIndices[0]);
    }

    const totals = $derived(blueprintTotals(bp));
    const current = $derived(session ? session.state.qids[cursor] : null);
    const currentQ = $derived(current ? questions.find((q) => q.id === current) ?? null : null);
    const currentSection = $derived(current && session ? session.sectionOfQ(current) : "");
    const remainText = $derived(() => {
      if (!session) return "--:--";
      const ms = Math.max(0, session.remaining(nowTick));
      const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    });

    function addSection() {
      bp.sections = [...bp.sections, { name: t("mock.newSection"), count: 10, scoreEach: 1, source: "mixed", types: ["single", "multiple", "judge", "fill"] }];
    }
    let sectionRemoveBusy = $state(false);
    async function removeSection(i: number) {
      if (sectionRemoveBusy || !bp.sections[i]) return;
      sectionRemoveBusy = true;
      try {
        const sectionName = bp.sections[i].name || t("mock.sec");
        const { confirmDialogSync } = await import("../../libs/dialog");
        if (!(await confirmDialogSync({
          title: t("mock.removeSectionTitle", "删除考试模块？"),
          content: t("mock.removeSectionConfirm", "将从当前蓝图移除「{name}」模块及其题量、分值和配额。若尚未保存，无法恢复。")
            .replace("{name}", sectionName),
        }))) return;
        bp.sections = bp.sections.filter((_, j) => j !== i);
      } catch (e) {
        errorMsg = String(e instanceof Error ? e.message : e);
      } finally { sectionRemoveBusy = false; }
    }
    function updateSection(i: number, patch: Partial<BlueprintSection>) {
      bp.sections = bp.sections.map((s, j) => (j === i ? { ...s, ...patch } : s));
    }

    /** 55-02 lite：配额满足度实时预览（来源/题型/考点配额下的可出题数），缺口显式提示 */
    const quotaShort = $derived.by(() => {
      if (!bp.sections.length || !questions.length) return [];
      return bp.sections
        .map((s) => {
          const have = questions.filter(
            (q) =>
              (s.source === "mixed" || (q.sourceKind ?? "mock") === s.source) &&
              (!s.types.length || s.types.includes(q.type)) &&
              (!s.kp || q.kp === s.kp || (q.kp?.startsWith(s.kp + "/") ?? false)),
          ).length;
          return { name: s.name, need: s.count, have };
        })
        .filter((x) => x.have < x.need);
    });

    /** 蓝图持久化（TODO 27 P2）：保存/恢复命名蓝图 */
    async function saveBlueprint() {
      if (blueprintBusy) return;
      blueprintBusy = true;
      try { await app.saveAux("mock/blueprint", JSON.parse(JSON.stringify(bp))); showMessage(t("mock.bpSaved"), 3000, "info"); }
      catch (e) { showMessage(t("mock.bpSaveFailed").replace("{message}", String(e instanceof Error ? e.message : e)), 4200, "error"); }
      finally { blueprintBusy = false; }
    }
    async function restoreBlueprint() {
      if (blueprintBusy) return;
      blueprintBusy = true;
      try {
        const saved = await app.loadAux<Blueprint>("mock/blueprint");
        if (Array.isArray(saved?.sections) && saved.sections.length) {
          if (!saved.sections.every((s) => typeof s?.name === "string" && Array.isArray(s.types))) {
            throw new Error(t("mock.bpInvalid", "保存的蓝图内容不完整，请重新配置并保存。"));
          }
          const { confirmDialogSync } = await import("../../libs/dialog");
          if (!(await confirmDialogSync({
            title: t("mock.restoreBlueprintTitle", "恢复已保存的蓝图？"),
            content: t("mock.restoreBlueprintConfirm", "这会覆盖当前未保存的蓝图设置，且无法自动撤销。")
          }))) return;
          bp = saved;
          showMessage(t("mock.bpRestored"), 3000, "info");
        }
        else showMessage(t("mock.bpRestoreEmpty"), 3000, "info");
      } catch (e) { showMessage(String(e instanceof Error ? e.message : e), 4200, "error"); }
      finally { blueprintBusy = false; }
    }

    async function startExam() {
      if (starting || loading || resumeBusy || discardBusy || blueprintBusy) return;
      starting = true;
      errorMsg = "";
      try {
        if (!questions.length) { errorMsg = t("state.emptyBank"); return; }
        // 40-02 lite：蓝图健康检查——重名段自动改名（防统计合并）、零题段剔除、其余问题阻断并明示
        const issues = validateBlueprint(bp);
        const blocking = issues.filter((x) => !x.includes("题数为 0"));
        if (blocking.length) { errorMsg = blocking.join("；"); return; }
        let workingBp = dedupeSectionNames(bp);
        const zeroSections = workingBp.sections.filter((s) => s.count === 0);
        if (zeroSections.length) {
          workingBp = { ...workingBp, sections: workingBp.sections.filter((s) => s.count > 0) };
          showMessage(t("mock.zeroSectionDropped").replace("{n}", String(zeroSections.length)), 4200, "info");
        }
        const r = assemble(workingBp, questions);
        if (!r.paper.length) { errorMsg = t("state.emptyBank"); return; }
        if (r.paper.some((q) => q.type === "short" || q.type === "material")) {
          errorMsg = t("mock.unscoredTypes", "当前模考仅支持可自动判分的单选、多选、判断和填空。请在蓝图中排除简答、材料题，或到练习台使用自评。");
          return;
        }
        // 40-02：蓝图短缺不阻断开考，但实际题数/实际满分必须在开考前明示（不由其他题偷偷补齐）
        const requested = workingBp.sections.reduce((n, s) => n + s.count, 0);
        if (r.paper.length < requested) {
          const actualFull = [...r.scoreOf.values()].reduce((a, b) => a + b, 0);
          const { confirmDialogSync } = await import("../../libs/dialog");
          const ok = await confirmDialogSync({
            title: t("mock.shortTitle"),
            content: t("mock.shortBody")
              .replace("{want}", String(requested))
              .replace("{actual}", String(r.paper.length))
              .replace("{full}", String(actualFull)),
          });
          if (!ok) return;
        }
        startedAt = Date.now();
        scoreWriteError = "";
        runId = newRunId();
        bp = workingBp; // 本次考试使用去重/剔除后的蓝图（保存蓝图仍由用户显式操作）
        session = new MockSession(bp, r.paper, { sectionOf: r.sectionOf, scoreOf: r.scoreOf }, startedAt);
        cursor = 0; selected = ""; answeredMap = {}; score = null;
        session.enterSection(bp.sections[0]?.name ?? "", startedAt);
        lastSnapAt = 0;
        persistRun();
        view = "exam";
        startTimer();
      } catch (e) {
        errorMsg = String(e instanceof Error ? e.message : e);
      } finally {
        starting = false;
        refreshPendingBankData();
      }
    }

    function startTimer() {
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        nowTick = Date.now();
        if (session?.shouldAutoSubmit(nowTick)) { void finishExam(true); return; }
        // 分段计时归零自动跳段（docs/11 S6：段倒计时归零 → 下一模块首题）
        if (bp.sectionTimed && session && currentSection) {
          const sr = session.sectionRemaining(currentSection, nowTick);
          if (sr !== null && sr <= 0) {
            const secIdx = bp.sections.findIndex((s) => s.name === currentSection);
            const nextSec = bp.sections[secIdx + 1];
            if (nextSec) {
              const nextQ = session.state.qids.findIndex((id) => session.sectionOfQ(id) === nextSec.name);
              if (nextQ >= 0) { session.navigateTo(nextQ, nowTick); cursor = nextQ; }
            }
          }
        }
      }, 1000);
    }

    /** 恢复进行中的 run：答案/标旗/游标原样回填；已过期仅触发一次自动交卷（U19） */
    async function resumeExam() {
      if (!resumable || resumeBusy || loading || starting || discardBusy || blueprintBusy) return;
      resumeBusy = true;
      errorMsg = "";
      const snap = resumable;
      try {
        const r = MockSession.restore(snap, questions);
        // 兜底：卷面题全部读不到（题库被删/离线）→ 不进入空考试，保留快照待题库可用
        if (!r.session.state.qids.length) {
          errorMsg = t("mock.restoreEmpty");
          return;
        }
        session = r.session;
        scoreWriteError = "";
        runId = snap.runId;
        startedAt = snap.startedAt;
        bp = snap.bp;
        const am: Record<string, string> = {};
        for (const a of session.answers.values()) if (a.answer != null) am[a.qid] = a.answer;
        answeredMap = am;
        restoreNote = r.missingQids.length ? t("mock.restoreMissing").replace("{n}", String(r.missingQids.length)) : "";
        resumable = null;
        if (r.alreadySubmitted) {
          // 残留已交卷快照：只重放报告，不重写流水/成绩（U20 恢复不重复交卷）
          score = session.score();
          await reloadMockHistory();
          await app.clearMockRun();
          view = "report";
          return;
        }
        if (session.shouldAutoSubmit(Date.now())) {
          // 已过期：恢复后唯一一次自动交卷，不重开考试
          cursor = session.cursor;
          await finishExam(true);
          return;
        }
        cursor = session.cursor;
        selected = answeredMap[session.state.qids[cursor]] ?? "";
        lastSnapAt = 0;
        persistRun();
        view = "exam";
        startTimer();
      } catch (e) {
        errorMsg = t("mock.restoreEmpty") + " " + String(e instanceof Error ? e.message : e);
      } finally {
        resumeBusy = false;
        refreshPendingBankData();
      }
    }

    /** 放弃进行中的 run（快照清除；答案不写流水） */
    async function discardRun() {
      if (discardBusy || resumeBusy || starting) return;
      discardBusy = true;
      try {
        const { confirmDialogSync } = await import("../../libs/dialog");
        if (!(await confirmDialogSync({
          title: t("mock.discardTitle", "放弃这场模考？"),
          content: t("mock.discardConfirm", "将删除本机恢复快照和未提交答案，无法恢复；不会生成成绩或作答记录。"),
        }))) return;
        await app.clearMockRun();
        resumable = null;
        errorMsg = "";
      } catch (e) {
        errorMsg = String(e instanceof Error ? e.message : e);
      } finally {
        discardBusy = false;
        refreshPendingBankData();
      }
    }

    function pickOption(letter: string) {
      if (!current || !currentQ || feedbackOn || examLocked) return;
      selected = toggleChoice(currentQ.type, answeredMap[current] ?? "", letter);
      session?.setAnswer(current, selected, Date.now());
      answeredMap = { ...answeredMap, [current]: selected };
      persistRun();
    }

    function setTextAnswer(value: string) {
      if (!current || examLocked) return;
      session?.setAnswer(current, value, Date.now());
      answeredMap = { ...answeredMap, [current]: value };
      persistRun();
    }

    function goto(i: number) {
      if (!session || examLocked) return;
      session.navigateTo(i, Date.now());
      cursor = session.cursor;
      selected = answeredMap[session.state.qids[cursor]] ?? "";
      if (bp.sectionTimed && currentSection) session.enterSection(currentSection, Date.now());
      persistRun();
    }

    async function finishExam(auto = false) {
      if (submitting || !session || session.submitted) return;   // 双击/计时器竞态：只交一次（U20 幂等交卷）
      // 提前交卷二次确认（TODO 27：未答完且非自动交卷；45-04 lite 可访问对话框）
      if (!auto && !session.shouldAutoSubmit(Date.now())) {
        if (handInConfirming) return;
        handInConfirming = true;
        const targetSession = session;
        const unanswered = session.state.qids.length - [...session.answers.values()].filter((a) => a.answer?.trim()).length;
        try {
          const { confirmDialogSync } = await import("../../libs/dialog");
          const prompt = unanswered > 0 ? t("mock.confirmHandIn").replace("{n}", String(unanswered)) : t("mock.confirmHandInAll", "所有题目均已填写，确认交卷？");
          if (!(await confirmDialogSync({ title: t("mock.handIn"), content: prompt + "\n" + t("mock.confirmHandInImpact", "交卷后答案将锁定、计时停止；未答题按 0 分计入本卷成绩。") }))) return;
        } finally { handInConfirming = false; }
        // 确认框打开期间可能已到时自动交卷，不能再次写入相同流水。
        if (submitting || targetSession !== session || session.submitted) return;
      }
      submitting = true;
      submitError = "";
      try {
        if (timer) { clearInterval(timer); timer = null; }
        session.submit(Date.now());
        // 作答写流水（kind=mock；模考错题自动进错题本——replayer 收录）；examId=runId 与蓝图分离
        const effectiveRunId = runId || "mock-" + bp.id;
        for (const a of session.answers.values()) {
          app.recordAttempt({
            qid: a.qid, kind: "mock", mode: "paper",
            verdict: a.verdict, myAnswer: a.answer,
            sessionId: effectiveRunId, examId: effectiveRunId,
            queue: "normal", changes: a.changes,
          });
        }
        // 未答题落 not_attempted 审计轨（40-03：进考试分母但不冒充已答；replayer 跳过不计统计分母）
        for (const qid of session.state.qids) {
          if (!session.answers.has(qid)) {
            app.recordAttempt({
              qid, kind: "mock", mode: "paper",
              verdict: "not_attempted", myAnswer: null,
              sessionId: effectiveRunId, examId: effectiveRunId,
              queue: "normal",
            });
          }
        }
        await app.flush();
        plugin.refreshDock?.();
        score = session.score();
        if (score && app) {
          await app.saveMockResult({
            id: bp.id, runId: effectiveRunId, name: bp.name, startedAt, total: score.total, full: score.full, percent: score.percent, pass: score.pass,
            sections: score.sections.map((s) => ({ name: s.name, score: s.score, full: s.full, correct: s.correct, total: s.total })),
            extraTimeS: session.state.extraTimeS,
          });
          await reloadMockHistory();
        }
        await app.clearMockRun();   // 交卷回执落定后清除运行快照
        emitMockSessionEnded();
        view = "report";
      } catch (e) {
        submitError = t("mock.submitFailed").replace("{message}", String(e instanceof Error ? e.message : e));
        // 自动交卷或保存失败时保持成绩视图可见，用户才能看到“重试保存”入口。
        if (session) view = "exam";
      } finally {
        submitting = false;
      }
    }

    async function retryFinishExam() {
      if (!session || submitting) return;
      // submit() is idempotent; retry only persists the already computed score.
      submitting = true;
      try {
        if (!session.submitted) session.submit(Date.now());
        await app.flush();
        const effectiveRunId = runId || "mock-" + bp.id;
        score = session.score();
        if (score) {
          await app.saveMockResult({ id: bp.id, runId: effectiveRunId, name: bp.name, startedAt, total: score.total, full: score.full, percent: score.percent, pass: score.pass, sections: score.sections.map((s) => ({ name: s.name, score: s.score, full: s.full, correct: s.correct, total: s.total })), extraTimeS: session.state.extraTimeS });
          await reloadMockHistory();
        }
        await app.clearMockRun();
        submitError = "";
        emitMockSessionEnded();
        view = "report";
      } catch (e) {
        submitError = t("mock.submitFailed").replace("{message}", String(e instanceof Error ? e.message : e));
      } finally { submitting = false; }
    }

    /** 成绩单导出 Markdown（本地下载） */
    let scoreExportBusy = $state(false);
    let scoreWriteBusy = $state(false);
    let scoreWriteError = $state("");
    async function exportScoreMd() {
      if (!score || scoreExportBusy) return;
      scoreExportBusy = true;
      try {
        const m = await import("@/core/exportScore");
        const md = m.scoreToMarkdown(bp, score!, startedAt);
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
        downloadBlob(blob, `模考成绩单 ${bp.name}.md`);
        showMessage(t("mock.exportReady", "已开始下载文件。"), 3000, "info");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      } finally { scoreExportBusy = false; }
    }

    async function writeScoreDoc() {
      if (!score || !activeBankId || scoreWriteBusy) return;
      scoreWriteBusy = true;
      scoreWriteError = "";
      // 写入时固定当前成绩与目标，返回配置或切库不会把它写入另一份题库。
      const targetBankId = activeBankId;
      const result = score;
      const blueprint = JSON.parse(JSON.stringify(bp)) as Blueprint;
      const resultStartedAt = startedAt;
      try {
        const { scoreToMarkdown } = await import("@/core/exportScore");
        await app.writeScoreDoc(targetBankId, scoreToMarkdown(blueprint, result, resultStartedAt));
        showMessage(t("mock.scoreWritten", "成绩单已写入本题库的「导出」文档。"), 3200, "info");
      } catch (e) {
        scoreWriteError = t("mock.scoreWriteFailed", "成绩单写入失败，成绩仍保留，可重试或下载：{message}").replace("{message}", String(e instanceof Error ? e.message : e));
      } finally { scoreWriteBusy = false; }
    }

    /** 错题回炉：本次模考错题开练习会话（启动失败可见化，47-06 lite） */
    async function rewrongDrill() {
      if (!session || rewrongBusy || !wrongList.length) return;
      const wrongIds = [...session.answers.values()].filter((a) => a.verdict === "wrong").map((a) => a.qid);
      const wrongs = questions.filter((q) => wrongIds.includes(q.id));
      if (!wrongs.length) return;
      rewrongBusy = true;
      try {
        await app.startSession(wrongs, "wrong", activeBankId);
        // 练习台已打开时同步到现有组件；未打开时由 pending 入口接管。
        (plugin as any).pendingPractice = wrongs;
        (plugin as any).pendingPracticeBankId = activeBankId;
        emitExamEvent("open-practice-questions", { qids: wrongs.map((q) => q.id), bank: activeBankId });
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
        return;
      } finally {
        rewrongBusy = false;
      }
      openPractice();
    }
    let rewrongBusy = $state(false);

    // ---------- 复盘（44-07 lite）：本次错题清单 + 加入下一步行动（U15 去重） ----------
    const wrongList = $derived(score && session
      ? [...session.answers.values()].filter((a) => a.verdict === "wrong").map((a) => ({
          qid: a.qid,
          stem: (questions.find((q) => q.id === a.qid)?.stem ?? a.qid).slice(0, 40),
        }))
      : []);
    let mockActionNote = $state("");
    let mockActionBusy = $state(false);
    let mockReasonBusy = $state(false);

    async function wrongsToActions() {
      if (!wrongList.length || mockActionBusy) return;
      mockActionBusy = true; mockActionNote = "";
      try {
        const r = await app.addActions(wrongList.map((w) => ({
          kind: "redo" as const,
          qid: w.qid,
          sessionId: runId || "mock-" + bp.id,
          detail: `${t("action.kind.redo")}：${w.stem}`,
        })));
        mockActionNote = t("action.added").replace("{n}", String(r.added)).replace("{d}", String(r.skipped));
      } catch (e) {
        mockActionNote = String(e instanceof Error ? e.message : e);
      } finally { mockActionBusy = false; }
    }

    /** 批量错因标注（44-07 lite）：本次全部错题标记同一错因（逐题已有细粒度入口） */
    async function bulkWrongReason(reason: "careless" | "unknown" | "trap") {
      if (!wrongList.length || mockReasonBusy) return;
      mockReasonBusy = true;
      let ok = 0;
      let failed = 0;
      try {
        for (const w of wrongList) {
          try { await app.saveWrongReason(w.qid, reason); ok++; } catch { failed++; }
        }
        showMessage((failed ? t("mock.bulkReasonPartial").replace("{ok}", String(ok)).replace("{failed}", String(failed)) : t("mock.bulkReasonDone").replace("{n}", String(ok))), 4200, failed ? "error" : "info");
      } finally { mockReasonBusy = false; }
    }

    function openPractice() {
      plugin.openPractice?.();
    }

    function onTaskNav(target: "today" | "bank" | "create" | "mock" | "report") {
      if (target === "mock") return;
      if (target === "report") return plugin.openReport?.();
      const next = target === "today" ? "entry" : target === "bank" ? "browse" : "manual";
      openPracticeView(plugin, next);
    }

    function historyPoints(): string {
      return history.map((h, i) => `${(i / Math.max(1, history.length - 1)) * 300},${100 - Math.round(h.percent)}`).join(" ");
    }
    /** 三线对比数据（docs/11 S7）：本次 / 历史均值 / 及格线目标（本地版以及格线为目标锚） */
    const tri = $derived(score ? {
      this: percentBar(score.total, score.full),
      // 历史记录尚未保存完整卷面与评分条件，不能把不同卷子的百分比混算作进步基线。
      avg: null as number | null,
      target: bp.passLine,
    } : null);
    // ---------- 考后估分（v0.5）：答案串对比 / 题库真题序列 ----------
    let estKey = $state("");
    let estMine = $state("");
    let estResult = $state<ReturnType<typeof import("../../core/estimate").estimateScore>>(null);
    let estResultFor = $state("");
    let estimateBusy = $state(false);
    let estFromBank = $state(false);
    let activeBankId = $state("");
    let estSourceFilter = $state("");
    let estHistory = $state<any[]>([]);
    let estHistoryLoading = $state(false);
    let estHistoryError = $state("");
    let estHistoryRequest = 0;
    let estimateSaveError = $state("");
    let pendingEstimateSave = $state<{ key: string; mine: string; percent: number; score: number; total: number } | null>(null);
    let estimateMineInput = $state<HTMLInputElement | null>(null);
    const estimateKeyLength = $derived(normalizeEstimateInput(estKey).length);
    const estimateMineLength = $derived(normalizeEstimateInput(estMine).length);
    const estimateInputSignature = $derived(`${normalizeEstimateInput(estKey)}\u0000${normalizeEstimateInput(estMine)}`);
    const estimateLengthMismatch = $derived(Boolean(estimateKeyLength && estimateMineLength && estimateKeyLength !== estimateMineLength));
    const estimateBankPool = $derived.by(() => {
      const letterTypes = new Set(["single", "multiple", "judge"]);
      return questions.filter((q) => letterTypes.has(q.type) && (!estSourceFilter.trim() || (q.source ?? "").includes(estSourceFilter.trim())));
    });

    async function loadEstimateHistory() {
      if (!app) return;
      const request = ++estHistoryRequest;
      estHistoryLoading = true;
      estHistoryError = "";
      try {
        const next = await app.listEstimates();
        if (request === estHistoryRequest) estHistory = [...next].reverse();
      } catch (e) {
        if (request === estHistoryRequest) {
          estHistory = [];
          estHistoryError = t("estimate.historyLoadFailed").replace("{message}", String(e instanceof Error ? e.message : e));
        }
      } finally {
        if (request === estHistoryRequest) estHistoryLoading = false;
      }
    }

    $effect(() => {
      if (estFromBank && questions.length) {
        estKey = estimateBankPool.map((q) => q.answer).join("");
      }
    });

    async function runEstimate() {
      if (estimateBusy) return;
      if (!estimateKeyLength || !estimateMineLength || estimateKeyLength !== estimateMineLength) {
        return;
      }
      estimateBusy = true;
      estimateSaveError = "";
      try {
        estResult = estimateScore(estMine, estKey, { scoreEach: 1, passLine: bp.passLine });
        estResultFor = estimateInputSignature;
        if (estResult) {
          pendingEstimateSave = { key: estKey.slice(0, 40), mine: estMine.slice(0, 40), percent: estResult.percent, score: estResult.score, total: estResult.total };
          await persistEstimateResult();
        }
      } finally {
        estimateBusy = false;
      }
    }

    async function saveEstimateResult() {
      if (!pendingEstimateSave || estimateBusy) return;
      estimateBusy = true;
      await persistEstimateResult();
      estimateBusy = false;
    }

    async function persistEstimateResult() {
      if (!pendingEstimateSave) return;
      estimateSaveError = "";
      try {
        await app.saveEstimate(pendingEstimateSave);
        pendingEstimateSave = null;
        await loadEstimateHistory();
      } catch (e) {
        estimateSaveError = t("estimate.saveFailed").replace("{message}", String(e instanceof Error ? e.message : e));
      }
    }

    function percentBar(v: number, full: number) { return full ? Math.round((v / full) * 100) : 0; }

    /** 雷达图坐标（成绩单；n 段均分圆周，值域 0-100%） */
    function radarPoints(vals: number[]): string {
      const cx = 110, cy = 92, r = 72, n = vals.length;
      if (!n) return "";
      return vals.map((v, i) => {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const rr = r * Math.max(0.04, Math.min(1, v));
        return `${(cx + rr * Math.cos(ang)).toFixed(1)},${(cy + rr * Math.sin(ang)).toFixed(1)}`;
      }).join(" ");
    }
    function radarLabel(vals: number[]): { x: number; y: number; name: string }[] {
      const cx = 110, cy = 92, r = 86, n = vals.length;
      return vals.map((_v, i) => {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        return { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) + 4, name: score!.sections[i].name };
      });
    }
    const secAccuracy = $derived(score ? score.sections.map((s) => (s.total ? s.correct / s.total : 0)) : []);
    /** 55-07 lite：当前题库相对开考冻结题版已修订的题（成绩单如实标注，不重算历史） */
    const revisionDrift = $derived(session ? session.revisionDrift(questions) : []);

    // 45-08 收口：成绩单分段/历史数据表 + CSV（与雷达/折线同一数据快照）
    let mockTableOpen = $state(false);
    async function copyExamSummaryMarkdown() {
      if (!score) return;
      const passText = score.pass ? "🎉 及格" : "⚠️ 未及格";
      const lines = [
        `### 📝 小驴考试 · 全真模考战报`,
        `- **考试科目**：${bp.name || "全真模拟卷"}`,
        `- **交卷时间**：${new Date().toLocaleString()}`,
        `- **最终成绩**：**${score.total} / ${score.full}**（得分率 ${score.percent}% · ${passText}）`,
        `- **及格线**：${bp.passLine}%`,
        `- **各模块得分明细**：`,
        ...score.sections.map((s) => `  - **${s.name}**：${s.score}/${s.full} 分（正确率 ${s.total ? Math.round((s.correct / s.total) * 100) : 0}%）`),
      ];
      if (revisionDrift.length) {
        lines.push(`- **改动说明**：包含 ${revisionDrift.length} 道在考后已修订题`);
      }
      lines.push(`\n> 来自小驴考试（内测版）`);
      const text = lines.join("\n");
      try {
        await navigator.clipboard.writeText(text);
        showMessage(t("mock.summaryCopied", "📋 模考战报已复制，可直接粘贴到思源笔记！"), 3200, "info");
      } catch {
        showMessage(t("mock.summaryCopyFailed", "复制失败，请重试或导出 CSV。"), 3200, "error");
      }
    }

    function downloadMockCsv(csv: string, name: string) {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      downloadBlob(blob, `小驴考试（内测版）-模考-${name}-${new Date().toISOString().slice(0, 10)}.csv`);
      showMessage(t("mock.exportReady", "已开始下载文件。"), 3000, "info");
    }

    function downloadBlob(blob: Blob, filename: string) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.hidden = true;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Let the browser begin consuming the object URL before releasing it.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function toggleExamFullscreen(target: EventTarget | null) {
      try {
        if (document.fullscreenElement) {
          if (!document.exitFullscreen) throw new Error(t("mock.fullscreenUnavailable", "当前环境不支持退出全屏。"));
          await document.exitFullscreen();
          return;
        }
        const el = (target as HTMLElement | null)?.closest<HTMLElement>(".lv-pad");
        if (!el?.requestFullscreen) throw new Error(t("mock.fullscreenUnavailable", "当前环境不支持全屏。"));
        await el.requestFullscreen();
      } catch (e) {
        showMessage(t("mock.fullscreenFailed", "无法切换全屏：{message}").replace("{message}", String(e instanceof Error ? e.message : e)), 4200, "error");
      }
    }

    /** 40-06：模考键盘作答——A-J 选择/多选 toggle、←/→ 导航；
     *  守卫 textarea/input/select/contenteditable 与 IME 组合期/修饰键 */
    function onExamKey(e: KeyboardEvent) {
      if (view !== "exam" || !session || !currentQ || examLocked) return;
      if (!tabRoot?.getClientRects().length) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && tgt !== document.body && !tabRoot.contains(tgt)) return;
      if (tgt && (tgt.tagName === "TEXTAREA" || tgt.tagName === "INPUT" || tgt.tagName === "SELECT" || tgt.isContentEditable)) return;
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toUpperCase();
      if (key === "F" && current) {
        e.preventDefault();
        session.toggleFlag(current);
        persistRun();
        return;
      }
      if (/^[A-J]$/.test(key)) {
        const idx = key.charCodeAt(0) - 65;
        const choice = isChoiceQuestion(currentQ) ? answerChoices(currentQ)[idx] : null;
        if (choice) {
          e.preventDefault();
          pickOption(choice.value);
        }
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const optionGroup = tgt?.closest<HTMLElement>('[role="radiogroup"], [role="group"]');
        if (optionGroup) {
          e.preventDefault();
          const options = [...optionGroup.querySelectorAll<HTMLButtonElement>('[role="radio"], [role="checkbox"]')]
            .filter((option) => !option.disabled);
          if (!options.length) return;
          const currentOption = options.indexOf(tgt as HTMLButtonElement);
          const direction = e.key === "ArrowRight" ? 1 : -1;
          const nextIndex = (currentOption + direction + options.length) % options.length;
          options[nextIndex].focus();
          if (options[nextIndex].getAttribute("role") === "radio") {
            const choice = answerChoices(currentQ)[nextIndex];
            if (choice) pickOption(choice.value);
          }
          return;
        }
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goto(Math.min(session.state.qids.length - 1, cursor + 1));
      } else if (e.key === "ArrowLeft" && !bp.lockout) {
        e.preventDefault();
        goto(Math.max(0, cursor - 1));
      }
    }
</script>

<svelte:window onblur={onBlur} onkeydown={onExamKey} />

<div class="fn__flex-1 lv-exam-tab" bind:this={tabRoot}>
  <div class="block__icons" class:lv-focus-toolbar={view === "exam"}>
    <button class="lv-menu-btn" aria-label={t("menu.open")} aria-expanded={railOpen} bind:this={menuBtn} onclick={() => railOpen = true}><Icon name="menu" size={16} /></button>
    {#if view === "exam"}<div class="lv-focus-brand"><Icon name="clock" size={15} /><strong>{t("mock.focusTitle", "专注模考")}</strong></div>{/if}
    <div class="lv-crumbs" class:lv-focus-context={view === "exam"}>
      <span class="lv-crumb">{railBankName}</span>
      <span class="lv-crumb-sep" aria-hidden="true">/</span>
      <span class="lv-crumb-current">{t("tab.mock")}</span>
    </div>
    {#if app}<SaveStatus gate={app.saves} {t} />{/if}
    <span class="fn__flex-1"></span>
    <button class="lv-btn lv-btn--ghost sm lv-palette-btn" onclick={() => paletteOpen = true} title="Ctrl / ⌘ K">
      <Icon name="search" size={13} /> <span class="lv-palette-label">{t("palette.open")}</span> <span class="lv-kbd">⌘K</span>
    </button>
    {#if view === "exam"}
      {@const remainMs = session ? Math.max(0, session.remaining(nowTick)) : 3600000}
      <span class="lv-chip num" class:lv-chip--amb={remainMs <= 300000 && remainMs > 60000} class:lv-chip--red={remainMs <= 60000} title={remainMs <= 60000 ? t("mock.urgentTime") : remainMs <= 300000 ? t("mock.warningTime") : ""}>
        <Icon name="clock" size={13} /> {remainText()}
      </span>
      {#if (session?.state.extraTimeS ?? 0) > 0}
        <span class="lv-chip lv-chip--amb num" title={t("mock.extraTip")}><Icon name="clock" size={13} />+{Math.round((session!.state.extraTimeS ?? 0) / 60)}{t("entry.minutes")}</span>
      {/if}
      <!-- 55-06 lite：单次条件覆盖——延时入快照与成绩记录，原卷不变 -->
        <button class="lv-chip" title={t("mock.extraTip")} disabled={(session?.state.extraTimeS ?? 0) > 0 || extraTimeBusy || examLocked} onclick={extendExamTime}>
        <Icon name="clock" size={13} />+5{t("entry.minutes")}
      </button>
    {/if}
  </div>
<div class="fn__flex-1 lv-shell" class:lv-shell-focus={view === "exam" || view === "report"}>
  <Rail active="mock" taskactive="mock" tasknavhidden={view === "exam" || view === "report"} ontasknavigate={onTaskNav} {plugin} open={railOpen} onclose={closeRail}
    project={{ name: railBankName || t("guard.title"), kicker: t("rail.projectKicker") }} onproject={() => plugin.openPractice?.()} />
  <div class="lv-main">
  <div class="fn__flex-1 lv-pad">
  {#if view === "config"}
    <div class="lv-screen-head"><span class="lv-eyebrow">{t("head.mock.eyebrow")}</span><h1 class="lv-h1">{t("head.mock.title")}</h1><p>{t("head.mock.desc")}</p></div>
  {/if}

  {#if loading}
    <div aria-busy="true">
      <p class="lv-muted" role="status" aria-live="polite">{t("mock.loadingBank", "正在读取题库…")}</p>
      <div class="lv-skeleton" aria-hidden="true"></div>
    </div>
  {:else if errorMsg && !questions.length}
    <div class="lv-error" role="alert">{errorMsg}</div>
    <div class="lv-row" style="margin-top:10px">
      {#if activeBankId}
        <button class="lv-btn sm" onclick={() => void loadMockData()} disabled={loading}>{loading ? "…" : t("mock.retryLoad", "重新读取题库")}</button>
      {/if}
      <button class="lv-btn lv-btn--primary sm" onclick={() => plugin.openPractice?.()}>{t("mock.goPractice")}</button>
    </div>
  {:else if !questions.length}
    <div class="lv-empty" role="status">
      <b>{t("state.emptyBank")}</b>
      <p class="lv-muted">{t("mock.emptyBankDesc")}</p>
      <button class="lv-btn lv-btn--primary sm" onclick={() => plugin.openPractice?.()}>{t("mock.goPractice")}</button>
    </div>
  {:else if view === "config"}
    <div class="lv-card" style="padding:14px 16px;margin-bottom:14px">
      <b>{t("mock.setupGuideTitle", "先确认本次模考条件")}</b>
      <p class="lv-muted" style="margin:6px 0">{t("mock.setupGuide", "默认蓝图已按考点配置可自动判分题。先核对模块、题数与分值，再设置时长和及格百分比；开考后独立作答，统一交卷。简答题请在练习台或背诵模式自评。")}</p>
    </div>
    <!-- ===== 恢复进行中的模考（U19：关页/休眠后回到同一 run） ===== -->
    {#if resumable}
      <div class="lv-card" style="margin-bottom:14px;border-color:var(--lv-accent)">
        <div class="lv-row" style="margin:0">
          <b>{t("mock.resumeTitle")}</b>
          <span class="lv-chip num">{resumable.bp.name} · {resumable.answers.length}/{resumable.qids.length}</span>
          <span class="lv-chip num" class:lv-chip--red={resumable.startedAt + resumable.bp.durationS * 1000 < Date.now()}>
            {t("mock.resumeLeft")} {Math.max(0, Math.round(((resumable.startedAt + resumable.bp.durationS * 1000 - Date.now()) / 60_000)))} min
          </span>
          <span class="fn__flex-1"></span>
        <button class="lv-btn lv-btn--primary sm" disabled={resumeBusy || discardBusy || starting || blueprintBusy} onclick={resumeExam}>{resumeBusy ? "…" : t("mock.resumeGo")}</button>
          <button class="lv-btn sm" disabled={resumeBusy || discardBusy || starting || blueprintBusy} onclick={discardRun}>{discardBusy ? "…" : t("mock.resumeDrop")}</button>
        </div>
        <p class="lv-muted" style="margin:6px 0 0">{t("mock.resumeHint")}</p>
      </div>
    {/if}
    <!-- ===== S5 蓝图配置器 ===== -->
    {#if errorMsg}<div class="lv-error" role="alert" style="margin:8px 12px">{errorMsg}</div>{/if}
    <div class="lv-row">
      <input class="lv-input" bind:value={bp.name} style="max-width:220px" aria-label={t("mock.bpName")} />
      <span class="lv-chip num">{t("mock.totalQ")} {totals.questions}</span>
      <span class="lv-chip num">{t("mock.totalScore")} {totals.score}</span>
      <span class="lv-chip num"><Icon name="clock" size={12} />{Math.round(bp.durationS / 60)} min</span>
      {#each quotaShort as qs, _i (_i)}
        <span class="lv-chip lv-chip--red num" title={t("mock.quotaShortTip")}>⚠ {qs.name} {t("mock.quotaShort").replace("{have}", String(qs.have)).replace("{need}", String(qs.need))}</span>
      {/each}
    </div>
    <div class="lv-bp-table">
      <div class="lv-bp-row head"><span>{t("mock.sec")}</span><span>{t("mock.count")}</span><span>{t("mock.each")}</span><span>{t("mock.source")}</span><span>{t("mock.secKp")}</span><span></span></div>
      {#each bp.sections as s, i (i)}
        <div class="lv-bp-row">
          <input class="lv-input" bind:value={s.name} oninput={() => updateSection(i, { name: s.name })} aria-label={t("mock.sec")} />
          <input class="lv-input num" type="number" min="0" value={s.count} aria-label={t("mock.count")} oninput={(e) => updateSection(i, { count: Math.max(0, parseInt((e.target as HTMLInputElement).value) || 0) })} />
          <input class="lv-input num" type="number" min="0" step="0.1" value={s.scoreEach} aria-label={t("mock.each")} oninput={(e) => updateSection(i, { scoreEach: Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0) })} />
          <select class="lv-select" value={s.source} aria-label={t("mock.source")} onchange={(e) => updateSection(i, { source: (e.target as HTMLSelectElement).value as any })}>
            <option value="mixed">{t("mock.sourceMixed", "不限来源")}</option><option value="real">{t("mock.sourceReal")}</option><option value="mock">{t("mock.sourceMock")}</option>
          </select>
          <!-- 55-02 lite：考点配额（前缀匹配；缺口显式计入短缺，不用其他考点补齐） -->
          <input class="lv-input" value={s.kp ?? ""} placeholder={t("mock.secKpHint")}
            aria-label={t("mock.secKp")}
            oninput={(e) => updateSection(i, { kp: (e.target as HTMLInputElement).value.trim() || undefined })} />
          <button class="lv-btn lv-btn--ghost sm lv-bp-del" title={t("mock.removeSection")} aria-label={`${t("mock.removeSection")}：${s.name}`} aria-busy={sectionRemoveBusy} disabled={sectionRemoveBusy} onclick={() => void removeSection(i)}><Icon name="close" size={13} /></button>
        </div>
      {/each}
      <div style="padding:8px 12px"><button class="lv-btn sm" style="border-style:dashed;width:100%" onclick={addSection}>＋ {t("mock.addSec")}</button></div>
    </div>
    <div class="lv-row">
      <label class="lv-row" style="margin:0">{t("mock.durationMinutes", "考试时长（分钟）")} <input class="lv-input num" type="number" min="1" step="1" value={bp.durationS / 60} oninput={(e) => bp.durationS = Number((e.target as HTMLInputElement).value) * 60} /></label>
      <label class="lv-row" style="margin:0"><input type="checkbox" bind:checked={bp.sectionTimed} /> {t("mock.sectionTimed")}</label>
      <span class="lv-chip" title={t("mock.shuffleUnavailable", "选项乱序暂未开放")}>{t("mock.keepOptionOrder", "选项保持原顺序")}</span>
      <label class="lv-row" style="margin:0"><input type="checkbox" bind:checked={bp.lockout} /> {t("mock.lockout")}</label>
      <span class="lv-chip">{t("mock.passLine")} <input class="lv-input num" style="width:64px" type="number" min="0" max="100" bind:value={bp.passLine} aria-label={t("mock.passLine")} />%</span>
    </div>
    {#if !bp.sections.length}<div class="lv-empty">{t("mock.needSec")}</div>{/if}
    <div class="lv-row">
      <button class="lv-btn lv-btn--primary" onclick={startExam} disabled={!canStartExam} title={!canStartExam ? startDisabledReason : ""}><Icon name="play" size={16} /> {starting ? "…" : t("mock.start")}</button>
      <button class="lv-btn sm" onclick={saveBlueprint} disabled={blueprintBusy || starting || resumeBusy || discardBusy} aria-busy={blueprintBusy}><Icon name="save" size={14} /> {blueprintBusy ? "…" : t("mock.bpSave")}</button>
      <button class="lv-btn sm" onclick={restoreBlueprint} disabled={blueprintBusy || starting || resumeBusy || discardBusy} aria-busy={blueprintBusy}><Icon name="folder" size={14} /> {blueprintBusy ? "…" : t("mock.bpRestore")}</button>
    </div>
    {#if !canStartExam && startDisabledReason}<p class="lv-muted" role="status" style="margin:4px 0">{startDisabledReason}</p>{/if}
    <!-- 考后估分 -->
    <details class="lv-card lv-pad-card" style="padding: var(--lv-space-3) var(--lv-space-4)">
      <summary style="cursor:pointer;font-weight:var(--lv-font-weight-semibold);display:flex;align-items:center;justify-content:space-between;gap:var(--lv-space-3);flex-wrap:wrap">
        <span>{t("estimate.title")}</span>
        <span class="lv-muted" style="font-weight:400;font-size:var(--lv-font-size-sm)">{t("estimate.hint")}</span>
      </summary>
      {#if !questions.length}
        <p class="lv-muted">{t("state.emptyBank")}</p>
      {:else}
      <div class="lv-row" style="margin-top:10px">
        <label class="lv-row" style="margin:0"><input type="checkbox" bind:checked={estFromBank} /> {t("estimate.fromBank")}</label>
        {#if estFromBank}
          <input class="lv-input num" style="width:140px" bind:value={estSourceFilter} placeholder={t("estimate.sourceFilter")} />
          <span class="lv-chip num">{t("estimate.bankQ")} {estimateBankPool.length}</span>
        {:else}
          <label class="lv-chip" for="estimate-key-input">{t("estimate.key")}</label>
          <input id="estimate-key-input" class="lv-input num" style="flex:1;min-width:160px" bind:value={estKey} placeholder="BADCA…" aria-invalid={estimateLengthMismatch} aria-describedby={estimateLengthMismatch ? "estimate-length-error" : undefined} />
        {/if}
      </div>
      <div class="lv-row" style="margin-top:6px">
        <label class="lv-chip" for="estimate-mine-input">{t("estimate.mine")}</label>
        <input id="estimate-mine-input" bind:this={estimateMineInput} class="lv-input num" style="flex:1;min-width:160px" bind:value={estMine} placeholder="BADCA…" aria-invalid={estimateLengthMismatch} aria-describedby={estimateLengthMismatch ? "estimate-length-error" : undefined} />
      </div>
      <div class="lv-row">
      <button class="lv-btn sm" onclick={runEstimate} disabled={estimateBusy || !estimateKeyLength || !estimateMineLength || estimateLengthMismatch} aria-busy={estimateBusy} title={estimateLengthMismatch ? t("estimate.lengthMismatch") : ""}>{estimateBusy ? "…" : t("estimate.run")}</button>
      {#if estimateLengthMismatch}<span id="estimate-length-error" class="lv-chip lv-chip--amb" role="alert">{t("estimate.lengthMismatch")}</span>{/if}
      {#if estimateSaveError}<div class="lv-error" role="alert" style="width:100%">{estimateSaveError} <button class="lv-btn sm" disabled={estimateBusy} onclick={() => void saveEstimateResult()}>{estimateBusy ? "…" : t("estimate.retrySave")}</button></div>{/if}
        {#if estResult && estResultFor === estimateInputSignature}
          <div class="lv-card" style="margin-top:10px;padding:12px 16px;background:var(--lv-surface);width:100%">
            <div class="lv-row" style="margin:0 0 6px;align-items:center;flex-wrap:wrap">
              <span class="lv-chip lv-chip--acc num">
                {t("estimate.score")}: <b style="font-size:16px">{estResult.score}</b> / {estResult.full}
              </span>
              <span class="lv-chip lv-chip--grn num">✓ {estResult.correct}</span>
              <span class="lv-chip lv-chip--red num">✕ {estResult.wrong}</span>
              {#if estResult.blank}<span class="lv-chip lv-chip--amb num">– {estResult.blank}</span>{/if}
              <span class="lv-chip num" class:lv-chip--grn={estResult.percent >= bp.passLine} class:lv-chip--red={estResult.percent < bp.passLine}>
                {estResult.percent}% {estResult.percent >= bp.passLine ? "合格 ✔️" : "未达标 ✕"}
              </span>
            </div>
            <div class="lv-marks num" style="font-size:12px;margin:6px 0;letter-spacing:1px">{estResult.marks.join(" ")}</div>
            {#if estFromBank}
              <div class="lv-row" style="margin:6px 0 0;flex-wrap:wrap;gap:4px">
                {#each estimateBankPool as q, i (i)}
                  {@const mark = estResult.marks[i] ?? "–"}
                  <span class="lv-chip num" class:lv-chip--grn={mark === "✓"} class:lv-chip--red={mark === "✕"} class:lv-chip--amb={mark === "–"} title={q.stem.slice(0, 60)}>{i + 1}. {q.answer} {mark}</span>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
      {#if estHistoryLoading}
        <p class="lv-muted" role="status" aria-live="polite">{t("estimate.historyLoading")}</p>
      {:else if estHistoryError}
        <div class="lv-error" role="alert">{estHistoryError} <button class="lv-btn sm" disabled={estHistoryLoading} onclick={() => void loadEstimateHistory()}>{estHistoryLoading ? "…" : t("estimate.retryHistory")}</button></div>
      {:else if estHistory.length}
        <div class="lv-row" style="margin:8px 0 0;align-items:center;flex-wrap:wrap">
          <span class="lv-muted" style="font-size:var(--lv-font-size-label)">{t("estimate.history")}:</span>
          {#each estHistory.slice(0, 8) as h, _i (_i)}
            <span class="lv-chip num" class:lv-chip--grn={h.percent >= bp.passLine} title={new Date(h.at).toLocaleString()}>{h.percent}%</span>
          {/each}
        </div>
      {:else}
        <div class="lv-empty" style="margin-top:10px">
          <b>{t("estimate.historyEmptyTitle")}</b>
          <p class="lv-muted">{t("estimate.historyEmptyDesc")}</p>
          <button class="lv-btn sm" onclick={() => estimateMineInput?.focus()}>{t("estimate.getStarted")}</button>
        </div>
      {/if}
      {/if}
    </details>
  {:else if view === "exam" && session && currentQ}
    <!-- ===== S6 全真考试 ===== -->
    <div class="lv-row">
      <span class="lv-chip">{currentSection}</span>
      {#if bp.sectionTimed}
        {@const sr = session.sectionRemaining(currentSection, Date.now())}
        <span class="lv-chip num" class:lv-chip--red={sr !== null && sr < 60_000}>
          <Icon name="clock" size={13} /> {t("mock.secTime")} {sr !== null ? `${Math.max(0, Math.floor(sr / 60_000))}:${String(Math.floor((sr % 60_000) / 1000)).padStart(2, "0")}` : "--"}
        </span>
      {/if}
      <span class="lv-chip num">{cursor + 1}/{session.state.qids.length}</span>
      <span class="fn__flex-1"></span>
      <button class="lv-btn sm lv-flag-btn" class:lv-flag-btn--on={session.flags.has(current)} title={`${t("mock.flag")} (F)`} aria-label={`${t("mock.flag")} (F)`} aria-pressed={session.flags.has(current)} disabled={examLocked} onclick={() => { session?.toggleFlag(current); persistRun(); }}><Icon name="pin" size={14} /> <span class="lv-kbd sm">F</span></button>
      <button class="lv-btn sm" title={t("mock.fullscreen")} aria-label={t("mock.fullscreen")} disabled={examLocked} onclick={(e) => void toggleExamFullscreen(e.currentTarget)}><Icon name="expand" size={14} /></button>
      <button class="lv-btn lv-btn--primary sm" disabled={examLocked || handInConfirming} aria-busy={submitting || handInConfirming} onclick={() => finishExam(false)}>{submitting ? t("mock.savingScore", "正在保存成绩…") : handInConfirming ? t("mock.confirmingHandIn", "等待交卷确认…") : t("mock.handIn")}</button>
    </div>
    {#if submitError}
      <div class="lv-error" role="alert" style="margin:8px 0">
        {submitError}
        <button class="lv-btn sm" style="margin-left:8px" disabled={submitting} onclick={retryFinishExam}>{submitting ? "…" : t("mock.retrySubmit")}</button>
      </div>
    {/if}
    {#if restoreNote}<div class="lv-error">{restoreNote}</div>{/if}
    <div class="lv-card lv-question">
      <span class="lv-chip lv-chip--acc">{t("qtype." + currentQ.type)}</span>
      <div class="lv-stem">{currentQ.stem}</div>
      <p class="lv-muted">{t("session.guide." + currentQ.type)}</p>
      {#if runSaveBusy}
        <p class="lv-hint" role="status" aria-live="polite">{t("mock.runSaving", "正在保存答题进度…")}</p>
      {:else if runSaveError}
        <div class="lv-error" role="alert">{runSaveError}
          <button class="lv-btn sm" disabled={runSaveBusy} aria-busy={runSaveBusy} onclick={retryRunSave}>{t("mock.runSaveRetry", "重试保存进度")}</button>
        </div>
      {:else if runSaveQueued}
        <p class="lv-hint" role="status" aria-live="polite">{t("mock.runSaveQueued", "答案已更新，正在等待自动保存…")}</p>
      {:else if runSaveConfirmed}
        <p class="lv-muted" role="status" aria-live="polite">{t("mock.runSaved", "答题进度已保存")}</p>
      {:else}
        <p class="lv-hint">{t("mock.answerSaveHint")}</p>
      {/if}
      {#key current}
      {#if isChoiceQuestion(currentQ)}
        {@const choices = answerChoices(currentQ)}
        {#if !choices.length}<div class="lv-error" role="alert">{t("session.missingOptions")}</div>{/if}
        <!-- 45-03：多选 checkbox/group 语义，单选/判断 radiogroup -->
        <div role={currentQ.type === "multiple" ? "group" : "radiogroup"} aria-label={t("session.options")}>
          {#each choices as choice (choice.value)}
            <button class="lv-opt" class:sel={currentQ.type === "multiple" ? (answeredMap[current] ?? "").includes(choice.value) : selected === choice.value} disabled={examLocked}
              role={currentQ.type === "multiple" ? "checkbox" : "radio"}
              aria-checked={currentQ.type === "multiple" ? (answeredMap[current] ?? "").includes(choice.value) : selected === choice.value}
              onclick={() => pickOption(choice.value)}>
              <span class="lv-opt-check" class:box={currentQ.type === "multiple"} aria-hidden="true"></span>
              <span class="key">{choice.letter}</span><span class="lv-opt-text">{@html renderInlineText(choice.text)}</span>
            </button>
          {/each}
        </div>
        {#if currentQ.type === "multiple"}
          {@const currentMultiAns = answeredMap[current] ?? ""}
          {@const selLetters = currentMultiAns ? [...currentMultiAns].sort().join(", ") : ""}
          <div class="lv-row lv-multi-indicator" style="margin:8px 0 4px;align-items:center;gap:var(--lv-space-2)">
            <span class="lv-chip num" class:lv-chip--acc={currentMultiAns.length > 0}>
              {currentMultiAns.length > 0 ? t("session.multiSelected").replace("{items}", selLetters).replace("{n}", String(currentMultiAns.length)) : t("session.multiEmpty")}
            </span>
          </div>
        {/if}
      {:else}
        {@const spec = specOf(currentQ)}
        {#if spec?.kind === "numeric"}
          <input class="lv-input lv-answer-num" type="text" inputmode="decimal" value={answeredMap[current] ?? ""} disabled={examLocked}
            placeholder={spec.unit ? t("session.numericUnit").replace("{u}", spec.unit) : t("session.numericPlain")}
            oninput={(e) => setTextAnswer((e.target as HTMLInputElement).value)} />
          {#if spec.unit}<span class="lv-chip">{t("session.unitLabel")}: {spec.unit}</span>{/if}
        {:else if spec?.kind === "multiBlank"}
          {@const parts = splitBlanks(answeredMap[current] ?? "", spec.blanks.length)}
          <p class="lv-hint">{t("session.blankHint")}</p>
          {#each parts as part, i (i)}
            <input class="lv-input lv-answer-blank" value={part} disabled={examLocked} placeholder={t("session.blankN").replace("{n}", String(i + 1))}
              oninput={(e) => { const next = [...parts]; next[i] = (e.target as HTMLInputElement).value; setTextAnswer(joinBlanks(next)); }} />
          {/each}
        {:else}
          <textarea class="lv-input lv-textarea" value={answeredMap[current] ?? ""} disabled={examLocked}
            placeholder={currentQ.type === "short" ? t("session.shortPlaceholder") : t("session.fillPlaceholder")}
            oninput={(e) => setTextAnswer((e.target as HTMLTextAreaElement).value)}></textarea>
        {/if}
      {/if}
      {/key}
    </div>
    <!-- 答题卡与速查筛选 -->
    <div class="lv-sheet-bar">
      <div class="lv-sheet-tabs">
        <button class="lv-chip" class:acc={sheetFilter === "all"} onclick={() => sheetFilter = "all"}>
          {t("mock.filterAll")} ({session.state.qids.length})
        </button>
        <button class="lv-chip" class:acc={sheetFilter === "unanswered"} class:lv-chip--red={unansweredIndices.length > 0} onclick={() => sheetFilter = "unanswered"}>
          {t("mock.filterUnanswered")} ({unansweredIndices.length})
        </button>
        <button class="lv-chip" class:acc={sheetFilter === "flagged"} class:lv-chip--amb={flaggedIndices.length > 0} onclick={() => sheetFilter = "flagged"}>
          <Icon name="star" size={11} /> {t("mock.filterFlagged")} ({flaggedIndices.length})
        </button>
      </div>
      {#if unansweredIndices.length > 0}
        <button class="lv-btn sm lv-btn--ghost" onclick={gotoNextUnanswered} title={t("mock.jumpNextUnanswered")}>
          {t("mock.jumpNextUnanswered")} →
        </button>
      {/if}
    </div>
    <div class="lv-sheet">
      {#each session.state.qids as qid, i (i)}
        {@const answered = Boolean(answeredMap[qid]?.trim())}
        {@const flagged = session.flags.has(qid)}
        {@const dimmed = sheetFilter === "unanswered" ? answered : sheetFilter === "flagged" ? !flagged : false}
        <button class="lv-cell" class:done={answered} class:flag={flagged} class:dimmed={dimmed} disabled={examLocked}
          class:cur={i === cursor} aria-current={i === cursor ? "step" : undefined}
          aria-label={`${t("mock.questionN", "第 {n} 题").replace("{n}", String(i + 1))}，${answered ? t("mock.legend.done") : t("mock.unanswered", "未答")}，${flagged ? t("mock.legend.flag") : t("mock.unflagged", "未标记")}${i === cursor ? `，${t("mock.legend.cur")}` : ""}`}
          onclick={() => goto(i)}>{i + 1}</button>
      {/each}
    </div>
    <!-- 三态图例：新用户无需猜测紫底/琥珀框/实心的含义 -->
    <div class="lv-row lv-muted" style="margin:0;font-size:var(--lv-font-size-label);gap:var(--lv-space-loose)">
      <span class="lv-legend"><i class="dot" style="background:var(--lv-accent-soft)"></i>{t("mock.legend.done")}</span>
      <span class="lv-legend"><i class="dot" style="background:transparent;border:2px solid var(--lv-amber)"></i>{t("mock.legend.flag")}</span>
      <span class="lv-legend"><i class="dot" style="background:var(--lv-accent)"></i>{t("mock.legend.cur")}</span>
    </div>
    <div class="lv-row" style="margin-top:2px">
      <!-- 人机对话模式不可回退：左键不再「向左却前进」（误触会不可逆跳题），与右键一起仅保留前进 -->
      <button class="lv-btn sm" onclick={() => goto(cursor - 1)} disabled={examLocked || bp.lockout || cursor === 0} aria-label={t("session.kbdPrev")} title={bp.lockout ? t("mock.lockout") : t("session.kbdPrev")}><Icon name="chev-left" size={14} /></button>
      <button class="lv-btn sm" onclick={() => goto(cursor + 1)} disabled={examLocked || cursor >= session.state.qids.length - 1} aria-label={t("session.next")} title={t("session.next")}><Icon name="chev-right" size={14} /></button>
      <!-- 位置读数：顺序作答模式下尤其需要知道当前进度 -->
      <span class="lv-muted num">{cursor + 1} / {session.state.qids.length}</span>
    </div>
  {:else if view === "report" && score}
    <!-- ===== S7 成绩单 ===== -->
    <div class="lv-row">
      <b style="font-size:16px">{bp.name}</b>
      <span class="lv-chip num">{new Date(startedAt).toLocaleString()}</span>
      {#if session && revisionDrift.length}
        <!-- 55-07 lite：改题后成绩仍按开考冻结版本记录，历史不静默重算 -->
        <span class="lv-chip lv-chip--amb num" title={t("mock.revisedTip")}><Icon name="pencil" size={12} /> {t("mock.revisedNote").replace("{n}", String(revisionDrift.length))}</span>
      {/if}
    </div>
    <div class="lv-card lv-score-card" style="margin-bottom:14px">
      <div class="lv-row" style="align-items:center;padding:6px 4px">
        <span class="num" style="font-size:40px;font-weight:800;color:var(--lv-accent)">{score.total}</span>
        <span class="lv-muted">/ {score.full}</span>
        <span class="lv-chip" class:grn={score.pass} class:red={!score.pass}>{score.pass ? t("mock.pass") : t("mock.fail")}（{t("mock.passLine")} {bp.passLine}%）</span>
        <span class="lv-chip num">{score.percent}%</span>
        {#if tri}
          <div class="lv-row" style="width:100%;margin:10px 0 0">
            <span class="lv-muted" style="width:44px">{t("mock.thisRun")}</span>
            <div class="progress" style="flex:1"><i style="width:{tri.this}%"></i></div>
            <span class="num lv-muted">{tri.this}%</span>
          </div>
          {#if tri.avg != null}
            <div class="lv-row" style="width:100%;margin:0">
              <span class="lv-muted" style="width:44px">{t("mock.histAvg")}</span>
              <div class="progress" style="flex:1"><i style="width:{tri.avg}%"></i></div>
              <span class="num lv-muted">{tri.avg}%</span>
            </div>
            <p class="lv-muted" style="margin:4px 0 0">{tri.this >= tri.avg ? "↑" : "↓"} {t("mock.vsAvg")} {Math.abs(tri.this - tri.avg)} {t("mock.points")}</p>
          {/if}
        {/if}
      </div>
    </div>
    {#each score.sections as sec, _i (_i)}
      <div class="lv-row" style="margin:4px 0">
        <span style="width:70px">{sec.name}</span>
        <div class="progress" style="flex:1"><i style="width:{percentBar(sec.score, sec.full)}%"></i></div>
        <span class="num lv-muted">{sec.score}/{sec.full} · {t("mock.correct")} {sec.correct}/{sec.total} · {Math.round(sec.timeSpentMs / 1000)}s</span>
        {#if sec.short}
          <!-- 40-02：短缺段如实标注（要求 N 实际 M；满分已按实际题数计） -->
          <span class="lv-chip lv-chip--amb num" title={t("mock.shortSecTip").replace("{n}", String(sec.required))}>{t("mock.shortSec").replace("{n}", String(sec.required))}</span>
        {/if}
      </div>
    {/each}
    {#if historyLoading}
      <p class="lv-muted" role="status" aria-live="polite">{t("mock.historyLoading", "正在读取模考历史…")}</p>
    {:else if historyError}
      <div class="lv-error" role="alert">{historyError} <button class="lv-btn sm" disabled={historyLoading} onclick={() => void reloadMockHistory()}>{historyLoading ? "…" : t("mock.historyRetry", "重试读取")}</button></div>
    {:else if history.length < 2}
      <p class="lv-muted">{t("mock.historyEmpty", "完成两场模考后，这里会显示历史趋势。")}</p>
    {/if}
    <!-- 45-08 收口：分段/历史图表的文本等价物 + CSV（同一数据快照） -->
    <div class="lv-row" style="margin:6px 0;gap:var(--lv-space-2);flex-wrap:wrap">
      <button class="lv-btn sm lv-btn--primary" onclick={copyExamSummaryMarkdown} title={t("mock.copySummary")}>
        <Icon name="copy" size={13} /> {t("mock.copySummary")}
      </button>
      <button class="lv-btn sm lv-btn--ghost" aria-expanded={mockTableOpen} onclick={() => mockTableOpen = !mockTableOpen}><Icon name="table" size={13} /> {t("data.table")}</button>
      <button class="lv-btn sm lv-btn--ghost" onclick={() => downloadMockCsv(mockSectionsToCsv(score.sections), "sections")}><Icon name="export" size={13} /> CSV</button>
      {#if history.length}
        <button class="lv-btn sm lv-btn--ghost" onclick={() => downloadMockCsv(mockHistoryToCsv(history), "history")}><Icon name="export" size={13} /> CSV {t("mock.history")}</button>
      {/if}
    </div>
    {#if mockTableOpen}
      <div class="lv-card" style="margin:6px 0;overflow:auto">
        <table class="lv-dtable">
          <thead><tr><th>{t("mock.sec")}</th><th>{t("mock.each")}</th><th>{t("mock.correct")}</th><th>{t("report.accuracy")}</th></tr></thead>
          <tbody>
            {#each score.sections as sec, _si (_si)}
              <tr><td class="num">{sec.name}</td><td class="num">{sec.score}/{sec.full}</td><td class="num">{sec.correct}/{sec.total}</td><td class="num">{sec.total ? Math.round((sec.correct / sec.total) * 100) : 0}%</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    {#if score.sections.length >= 3}
      <div class="lv-card" style="margin:12px 0">
        <b style="font-size:var(--lv-font-size-body-compact)">{t("mock.radar")}</b>
        <svg viewBox="0 0 220 190" style="width:100%;max-width:300px;margin:0 auto;display:block" role="img" aria-label={t("mock.radar")}>
          <polygon points={radarPoints(score.sections.map(() => 1))} fill="none" stroke="var(--lv-border)" />
          <polygon points={radarPoints(score.sections.map(() => 0.5))} fill="none" stroke="var(--lv-border)" stroke-dasharray="3 3" />
          <polygon points={radarPoints(secAccuracy)} fill="var(--lv-accent-soft)" stroke="var(--lv-accent)" stroke-width="2" />
          {#each radarLabel(secAccuracy) as lb, _i (_i)}
            <text x={lb.x} y={lb.y} font-size="10" fill="var(--lv-text-3)" text-anchor="middle">{lb.name}</text>
          {/each}
        </svg>
      </div>
    {/if}
    <div class="lv-row">
      <span class="lv-chip num"><Icon name="pin" size={12} /> {score.flagsUsed}</span>
      <span class="lv-chip num">{t("mock.changes")} {score.changes}</span>
      <span class="lv-chip num">{t("mock.last20")} {score.last20min.correct}/{score.last20min.attempted}</span>
      {#if session?.state.extraTimeS}
        <!-- 55-06 lite：单次条件覆盖明示（同卷不同条件不混排比较的依据） -->
        <span class="lv-chip lv-chip--amb num" title={t("mock.extraTip")}><Icon name="clock" size={13} />+{Math.round(session.state.extraTimeS / 60)}{t("entry.minutes")}</span>
      {/if}
    </div>
    {#if history.length >= 2}
      <div class="lv-card" style="margin:12px 0">
        <b style="font-size:var(--lv-font-size-body-compact)">{t("mock.history")}</b>
        <p class="lv-muted">{t("mock.historyScope", "历史记录可能来自不同题库、卷面或时长，百分比仅供回看，不直接比较进步或能力。")}</p>
        <svg viewBox="0 0 300 110" style="width:100%;max-width:420px;display:block" role="img" aria-label={t("mock.history")}>
          <polyline points={historyPoints()} fill="none" stroke="var(--lv-accent)" stroke-width="2" />
          {#each history as h, i (i)}
            <circle cx={(i / Math.max(1, history.length - 1)) * 300} cy={100 - Math.round(h.percent)} r="3" fill="var(--lv-accent)"><title>{h.name} {h.percent}%</title></circle>
          {/each}
        </svg>
        <div class="lv-row" style="margin:6px 0 0">
          {#each history.slice(-5) as h, i (i)}
            <button class="lv-chip num" class:acc={historyDetail === Math.max(0, history.length - 5) + i}
              title={new Date(h.startedAt).toLocaleString()}
              aria-pressed={historyDetail === Math.max(0, history.length - 5) + i}
              onclick={() => historyDetail = historyDetail === Math.max(0, history.length - 5) + i ? -1 : Math.max(0, history.length - 5) + i}>
              {h.name} {h.percent}%{h.pass ? " ✓" : ""}
            </button>
          {/each}
        </div>
        {#if historyDetail >= 0 && history[historyDetail]}
          {@const h = history[historyDetail]}
          <div class="lv-card" style="padding:10px 14px;margin-top:8px">
            <b class="num" style="font-size:var(--lv-font-size-body-compact)">{h.name} · {h.percent}%</b>
            {#if h.sections?.length}
              {#each h.sections as s, _i (_i)}
                <div class="lv-row" style="margin:3px 0">
                  <span class="lv-muted" style="width:64px">{s.name}</span>
                  <div class="progress" style="flex:1"><i style="width:{percentBar(s.score, s.full)}%"></i></div>
                  <span class="num lv-muted">{s.score}/{s.full}</span>
                </div>
              {/each}
            {:else}
              <p class="lv-muted" style="margin:4px 0 0">{t("mock.legacyRecord")}</p>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
    {#if wrongList.length}
      <div class="lv-card" style="margin:12px 0">
        <b style="font-size:var(--lv-font-size-body-compact)">{t("mock.wrongList")}（{wrongList.length}）</b>
        <div class="lv-row" style="margin:8px 0 0;gap:var(--lv-space-compact)">
          {#each wrongList.slice(0, 12) as w, _i (_i)}
            <span class="lv-chip num" title={w.stem}>{w.stem}</span>
          {/each}
          {#if wrongList.length > 12}<span class="lv-muted num">… +{wrongList.length - 12}</span>{/if}
        </div>
        <div class="lv-row" style="margin:8px 0 0">
          <button class="lv-btn sm" disabled={mockActionBusy} onclick={wrongsToActions}><Icon name="pin" size={13} /> {mockActionBusy ? "…" : t("action.addWrong")}</button>
          <span class="lv-muted">{t("session.reason")}:</span>
          {#each ["careless", "unknown", "trap"] as r, _i (_i)}
            <button class="lv-chip" disabled={mockReasonBusy} onclick={() => bulkWrongReason(r as "careless" | "unknown" | "trap")}>{t("reason." + r)}</button>
          {/each}
          {#if mockActionNote}<span class="lv-muted num">{mockActionNote}</span>{/if}
        </div>
      </div>
    {/if}
    <div class="lv-row">
      <button class="lv-btn lv-btn--ghost sm" onclick={exportScoreMd} disabled={scoreExportBusy}><Icon name="table" size={13} /> {scoreExportBusy ? "…" : t("mock.exportScore")}</button>
      {#if activeBankId}
        <button class="lv-btn lv-btn--ghost sm" onclick={writeScoreDoc} disabled={scoreWriteBusy} aria-busy={scoreWriteBusy}><Icon name="book" size={14} /> {scoreWriteBusy ? t("mock.scoreWriting", "正在写入成绩单…") : scoreWriteError ? t("mock.scoreWriteRetry", "重试写入成绩单") : t("mock.exportToDoc")}</button>
      {/if}
      {#if wrongList.length}<button class="lv-btn lv-btn--primary" disabled={rewrongBusy} onclick={rewrongDrill}><Icon name="xcircle" size={15} /> {rewrongBusy ? "…" : t("mock.rewrong")}</button>{/if}
      <button class="lv-btn" onclick={showConfig} disabled={scoreWriteBusy || scoreExportBusy || rewrongBusy}><Icon name="rotate" size={15} /> {t("mock.again")}</button>
    </div>
    {#if scoreWriteError}<div class="lv-error" role="alert">{scoreWriteError}</div>{/if}
  {/if}
</div>
  </div>
  <Palette commands={paletteCommands} bind:open={paletteOpen} {t} />
</div>
</div>

<style>
  .lv-pad { padding: var(--lv-space-4) 22px var(--lv-space-9); overflow: auto; }
  .lv-input { min-height: var(--lv-control-height-md); padding: var(--lv-component-pad-md); border-radius: var(--lv-r-2); border: 1px solid var(--lv-ctl-border); background: var(--lv-surface); color: var(--lv-text); font: inherit; font-size: var(--lv-font-size-body); box-shadow: var(--lv-sh-1), var(--lv-inset-subtle, inset 0 1px 0 transparent); transition: border-color var(--lv-dur-micro) var(--lv-ease-out), box-shadow var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-input:hover:not(:disabled) { border-color: var(--lv-border-hover, var(--lv-accent)); }
  .lv-input:focus { border-color: var(--lv-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--lv-accent) 18%, transparent), var(--lv-inset-subtle, inset 0 1px 0 transparent); outline: none; }
  .lv-input.num { width: 72px; }
  .lv-textarea { width: 100%; min-height: 80px; resize: vertical; }
  /* .lv-btn/.lv-select 外观基线上收 lv-base.scss */
  .lv-flag-btn { min-width: 34px; padding: 5px 8px; }
  .lv-flag-btn--on { border-color: var(--lv-amber); color: var(--lv-amber); background: var(--lv-amber-soft); }
  .lv-chip { display: inline-flex; align-items: center; gap: var(--lv-space-1); padding: 3px var(--lv-space-3); border-radius: var(--lv-r-1); font-size: var(--lv-font-size-sm); font-weight: var(--lv-font-weight-medium); color: var(--lv-text-2); background: var(--lv-surface-2); border: 1px solid transparent; }
  .lv-chip.grn { color: var(--lv-green); background: var(--lv-green-soft); }
  .lv-chip.red { color: var(--lv-red); background: var(--lv-red-soft); }
  .lv-card { background: var(--lv-surface); border: 1px solid var(--lv-border-subtle, var(--lv-border)); border-radius: var(--lv-r-3); padding: var(--lv-space-5) var(--lv-space-6); box-shadow: var(--lv-sh-card, var(--lv-sh-1)), var(--lv-inset-highlight, inset 0 1px 0 transparent); transition: box-shadow var(--lv-dur-view) var(--lv-ease-out), transform var(--lv-dur-micro) var(--lv-ease-out), border-color var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-stem { font-size: var(--lv-font-size-stat); line-height: 1.8; letter-spacing: -.2px; margin-bottom: 16px; white-space: pre-wrap; }
  .lv-opt { display: flex; gap: 14px; align-items: center; width: 100%; text-align: left; padding: 15px 18px; border-radius: var(--lv-r-2); border: 1.5px solid var(--lv-ctl-border); margin-bottom: 11px; cursor: pointer; background: var(--lv-surface); font: inherit; color: inherit; box-shadow: var(--lv-sh-1), var(--lv-inset-subtle, inset 0 1px 0 transparent); transition: background-color var(--lv-dur-micro) ease, border-color var(--lv-dur-micro) ease, box-shadow var(--lv-dur-micro) ease, transform var(--lv-dur-micro) ease; }
  .lv-opt:hover { border-color: var(--lv-border-hover, var(--lv-accent)); background: color-mix(in srgb, var(--lv-accent) 4%, var(--lv-surface)); transform: translateX(2px); }
  .lv-opt:active { transform: scale(0.99); }
  .lv-opt .key { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; flex: none; font-size: 13px; font-weight: var(--lv-font-weight-semibold); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: var(--lv-surface-2); color: var(--lv-text-2); border: 1px solid var(--lv-border); box-shadow: var(--lv-keycap-shadow); transition: background-color var(--lv-dur-micro) ease, border-color var(--lv-dur-micro) ease, color var(--lv-dur-micro) ease; }
  .lv-opt-check { width: 18px; height: 18px; border-radius: var(--lv-radius-round); border: 1.5px solid var(--lv-ctl-border); background: var(--lv-surface); flex: none; display: grid; place-items: center; transition: background-color var(--lv-dur-micro) ease, border-color var(--lv-dur-micro) ease; }
  .lv-opt-check.box { border-radius: 5px; }
  .lv-opt-check::after { content: ""; width: 8px; height: 8px; border-radius: var(--lv-radius-round); background: var(--lv-on-accent, var(--b3-theme-on-primary, #fff)); transform: scale(0); transition: transform var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-opt-check.box::after { border-radius: 1.5px; }
  .lv-opt.sel .lv-opt-check { border-color: transparent; background: var(--lv-accent); }
  .lv-opt.sel .lv-opt-check::after { transform: scale(1); }
  .lv-opt.sel { border-color: var(--lv-accent); background: var(--lv-accent-soft); box-shadow: 0 2px 8px color-mix(in srgb, var(--lv-accent) 18%, transparent); }
  .lv-opt.sel .key { background: var(--lv-accent); border-color: var(--lv-accent); color: var(--lv-on-accent, var(--b3-theme-on-primary, #fff)); box-shadow: 0 2px 6px color-mix(in srgb, var(--lv-accent) 28%, transparent); }
  .lv-bp-table { border: 1px solid var(--lv-border); border-radius: 12px; overflow-x: auto; margin: 10px 0; }
  .lv-bp-row { display: grid; grid-template-columns: 1.1fr .5fr .5fr .8fr 1fr 36px; gap: var(--lv-space-2); padding: 8px 12px; border-bottom: 1px dashed var(--lv-border); align-items: center; min-width: 560px; }
  .lv-bp-row:last-child { border-bottom: none; }
  .lv-bp-row:not(.head):hover { background: var(--lv-surface-2); }
  .lv-bp-row.head { background: var(--lv-surface-2); font-size: var(--lv-font-size-caption); font-weight: var(--lv-font-weight-bold); color: var(--lv-text-3); border-bottom: 1px solid var(--lv-border); }
  /* 蓝图行数据网格密度（规范 v6）：34px 控件，行更紧凑 */
  .lv-bp-row .lv-input, .lv-bp-row .lv-select { min-height: 34px; padding: 5px 10px; border-radius: var(--lv-radius-control-sm); font-size: var(--lv-font-size-body-compact); }
  .lv-bp-del:hover:not(:disabled) { border-color: var(--lv-red); color: var(--lv-red); background: var(--lv-red-soft); }
  /* 答题卡（规范 v6 §5.4）：现代微质感 CBT 格子矩阵 */
  .lv-sheet-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--lv-space-2); margin-top: 14px; margin-bottom: 8px; flex-wrap: wrap; }
  .lv-sheet-tabs { display: flex; gap: var(--lv-space-compact); flex-wrap: wrap; }
  .lv-cell.dimmed { opacity: 0.22; }
  .lv-sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 9px; margin: 14px 0 10px; max-width: 660px; padding: 14px; background: var(--lv-surface-2); border-radius: var(--lv-r-2); border: 1px solid var(--lv-border-subtle, var(--lv-border)); }
  /* 三态图例小方块 */
  .lv-legend { display: inline-flex; align-items: center; gap: 6px; font-weight: var(--lv-font-weight-medium); }
  .lv-legend .dot { display: inline-block; width: 12px; height: 12px; border-radius: 4px; flex: none; box-shadow: var(--lv-sh-1); }
  .lv-cell { min-width: 44px; min-height: 44px; border-radius: 10px; border: 1px solid var(--lv-ctl-border); background: var(--lv-surface); font-size: var(--lv-font-size-body-compact); font-weight: var(--lv-font-weight-semibold); font-variant-numeric: tabular-nums; font-family: ui-monospace, monospace; color: var(--lv-text-2); cursor: pointer; box-shadow: var(--lv-sh-1), var(--lv-inset-subtle, inset 0 1px 0 transparent); transition: background-color var(--lv-dur-micro) var(--lv-ease-out), border-color var(--lv-dur-micro) var(--lv-ease-out), color var(--lv-dur-micro) var(--lv-ease-out), transform var(--lv-dur-micro) var(--lv-ease-out), box-shadow var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-cell:hover:not(:disabled) { transform: translateY(-1px); box-shadow: var(--lv-sh-2); border-color: var(--lv-border-hover, var(--lv-accent)); }
  .lv-cell:active:not(:disabled) { transform: scale(0.96); }
  .lv-cell.done { background: var(--lv-accent-soft); color: var(--lv-accent); border-color: color-mix(in srgb, var(--lv-accent) 36%, transparent); font-weight: var(--lv-font-weight-bold); }
  .lv-cell.flag { outline: 2px solid var(--lv-amber); outline-offset: -2px; box-shadow: 0 0 8px color-mix(in srgb, var(--lv-amber) 35%, transparent); }
  .lv-cell.cur { background: var(--lv-accent); color: var(--lv-on-accent, var(--b3-theme-on-primary, #fff)); border-color: transparent; box-shadow: 0 0 0 2px var(--lv-surface), 0 0 0 4.5px var(--lv-accent), 0 2px 10px color-mix(in srgb, var(--lv-accent) 35%, transparent); animation: lv-radar-pulse 2.2s infinite ease-in-out; transform: scale(1.04); z-index: 2; }
  @keyframes lv-radar-pulse {
    0%, 100% { box-shadow: 0 0 0 2px var(--lv-surface), 0 0 0 4px var(--lv-accent), 0 2px 10px color-mix(in srgb, var(--lv-accent) 30%, transparent); }
    50% { box-shadow: 0 0 0 2px var(--lv-surface), 0 0 0 5.5px color-mix(in srgb, var(--lv-accent) 75%, transparent), 0 4px 16px color-mix(in srgb, var(--lv-accent) 45%, transparent); }
  }
  .lv-card.lv-question { box-shadow: var(--lv-sh-card), var(--lv-inset-highlight, inset 0 1px 0 transparent); border-radius: var(--lv-r-3); border: 1px solid var(--lv-border-subtle, var(--lv-border)); }
  .lv-score-card { box-shadow: var(--lv-sh-card), var(--lv-inset-highlight, inset 0 1px 0 transparent); border-radius: var(--lv-r-3); border: 1px solid var(--lv-border-subtle, var(--lv-border)); }
  .lv-score-card .lv-chip.grn { background: var(--lv-green-soft); color: var(--lv-green); font-weight: var(--lv-font-weight-semibold); box-shadow: 0 0 10px color-mix(in srgb, var(--lv-green) 35%, transparent); }
  .lv-score-card .lv-chip.red { background: var(--lv-red-soft); color: var(--lv-red); font-weight: var(--lv-font-weight-semibold); box-shadow: 0 0 8px color-mix(in srgb, var(--lv-red) 25%, transparent); }
  .lv-empty { border: 1.5px dashed var(--lv-border); border-radius: var(--lv-r-3); padding: var(--lv-space-7); text-align: center; color: var(--lv-text-3); background: color-mix(in srgb, var(--lv-surface-2) 40%, var(--lv-surface)); }
  .lv-skeleton { height: 160px; border-radius: var(--lv-r-3); background: linear-gradient(100deg, var(--lv-surface-2) 40%, var(--lv-surface) 50%, var(--lv-surface-2) 60%); background-size: 200% 100%; animation: lv-shim 1.4s infinite; }
  @keyframes lv-shim { to { background-position: -200% 0; } }
  .progress { height: 6px; border-radius: var(--lv-radius-pill); background: var(--lv-surface-2); overflow: hidden; }
  .progress i { display: block; height: 100%; background: var(--lv-accent-grad); border-radius: var(--lv-radius-pill); }
  @media (prefers-reduced-motion: reduce) { .lv-skeleton { animation: none; } .lv-opt, .lv-btn { transition: none; } }
  @container lv-exam (max-width: 480px) {
    /* 极窄屏适配：答题卡 3 列、蓝图表格保持横滚 */
    .lv-sheet { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .lv-btn { white-space: nowrap; }
  }
</style>
