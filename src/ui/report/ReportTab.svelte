<script lang="ts">
    // 报告中心（S8 lite）：KPI / 热力图 / 考点掌握度 / 薄弱 Top10 / 时段分布
    // 数据全部来自流水重算（可离线）；聚合逻辑见 src/core/report.ts
    import { onMount } from "svelte";
    import { SvelteMap } from "svelte/reactivity";
    import { showMessage } from "siyuan";
    import { resolveAiKey } from "@/ai/secrets";
    import { weeklyAggregates, weekCompare, dailyTrend } from "@/core/weekly";
    import { quadrantReport, quadrantSignals, type QuadrantReport } from "@/core/quadrant";
    import type { ExamApp } from "../../app";
    import Rail from "../shared/Rail.svelte";
    import { changedAnswerList } from "../../core/answerTrail";
    import { recentExposureList } from "../../core/exposure";
    import Icon from "../shared/Icon.svelte";
    import Palette from "../shared/Palette.svelte";
    import type { PaletteCommand } from "../shared/Palette.svelte";
    import { heatmap, masteryByKp, weakTop, hourly, calibration, confidentWrongList, uncertainCorrectList, delayedRecall, exposureStats, type CalibrationReport } from "@/core/report";
    import { extractRadarDimensions, buildRadarChartModel, exportRadarDimensionsCsv } from "@/core/radar";
    import { trendToCsv, heatmapToCsv, hourlyToCsv } from "@/core/exportMd";
    import type { ActionItem } from "@/core/actions";
    import SaveStatus from "../shared/SaveStatus.svelte";
    import { emitExamEvent, onExamEvent } from "@/core/bus";
    import { openPracticeView, type ExamPluginLike } from "@/core/pluginTab";
    import type { AttemptEvent, Question } from "@/core/types";
    import { reportWindowStart, reportDateKey } from "@/core/reportWindow";

    let { plugin, examApp }: { plugin: ExamPluginLike; examApp?: ExamApp | null } = $props();
    let appOverride = $state<ExamApp | null>(null);
    const app = $derived<ExamApp | null>(appOverride ?? examApp ?? (plugin?.examApp as ExamApp | undefined) ?? null);
    const i18n = $derived(plugin?.i18n ?? {});
    const t = (k: string, fb = "") => i18n[k] ?? fb;
    const writeLocal = (key: string, value: string | null) => {
      try {
        if (value == null) globalThis.localStorage?.removeItem(key);
        else globalThis.localStorage?.setItem(key, value);
      } catch { /* optional browser preference */ }
    };

    let railOpen = $state(false);
    let menuBtn: HTMLButtonElement | null = null;
    function closeRail() { railOpen = false; menuBtn?.focus(); }

    function onTaskNav(target: "today" | "bank" | "create" | "mock" | "report") {
      if (target === "report") return;
      if (target === "mock") return plugin.openMock?.();
      const next = target === "today" ? "entry" : target === "bank" ? "browse" : "manual";
      openPracticeView(plugin, next);
    }

    let loading = $state(true);

    let paletteOpen = $state(false);
    const paletteCommands: PaletteCommand[] = [
      { group: t("palette.actions"), icon: "rotate", label: t("report.refresh"), keywords: "refresh recompute", run: () => void refreshReport(true) },
      { group: t("palette.actions"), icon: "table", label: t("report.writeDaily"), keywords: "daily write diary", run: () => void writeDaily() },
      { group: t("palette.actions"), icon: "export", label: t("data.export"), keywords: "export data", run: () => void exportAllData() },
      { group: t("palette.tabs"), icon: "home", label: t("tab.practice"), keywords: "practice", run: () => plugin.openPractice?.() },
      { group: t("palette.tabs"), icon: "clock", label: t("tab.mock"), keywords: "mock exam", run: () => plugin.openMock?.() },
    ];    let questions = $state<any[]>([]);
    const questionMap = $derived.by(() => {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived 内纯派生映射（重算即生成新引用）
      const map = new Map<string, any>();
      for (const q of questions) {
        if (q && q.id) map.set(q.id, q);
      }
      return map;
    });
    let kpi = $state({ attempts: 0, accuracy: 0, eliminated: 0, streak: 0 });
    let heat = $state<{ date: string; count: number }[]>([]);
    let mastery = $state<ReturnType<typeof masteryByKp>>([]);
    let masteryTab = $state<"radar" | "list">("radar");
    const radarDimensions = $derived(extractRadarDimensions(mastery, 8));
    const radarChart = $derived(buildRadarChartModel(radarDimensions, { size: 320, radius: 100 }));

    function exportRadarCsv() {
      if (!radarDimensions.length) return;
      const csv = exportRadarDimensionsCsv(radarDimensions);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `radar-dimensions-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showMessage(t("report.exportRadarCsv") + " ✓", 3000, "info");
    }
    let readinessExportBusy = $state(false);
    async function exportReadinessReport() {
      if (readinessExportBusy || !app) return;
      readinessExportBusy = true;
      try {
        const md = await app.exportReadinessReportMarkdown(bankId || undefined);
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `备考完备度体检报告-${new Date().toISOString().slice(0, 10)}.md`;
        a.click();
        URL.revokeObjectURL(url);
        showMessage("备考完备度体检报告已导出 ✓", 3000, "info");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      } finally {
        readinessExportBusy = false;
      }
    }
    let graphGuideBusy = $state(false);
    async function exportClearanceGuide() {
      if (graphGuideBusy || !app) return;
      graphGuideBusy = true;
      try {
        const md = await app.exportClearanceStudyGuideMarkdown(bankId || undefined);
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `考点通关路径与图谱导学案-${new Date().toISOString().slice(0, 10)}.md`;
        a.click();
        URL.revokeObjectURL(url);
        showMessage("考点通关导学案已导出 ✓", 3000, "info");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      } finally {
        graphGuideBusy = false;
      }
    }
    let badgeWallBusy = $state(false);
    async function exportBadgeWall() {
      if (badgeWallBusy || !app) return;
      badgeWallBusy = true;
      try {
        const md = await app.exportMilestoneBadgeWallMarkdown(bankId || undefined);
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `备考个人荣誉勋章墙-${new Date().toISOString().slice(0, 10)}.md`;
        a.click();
        URL.revokeObjectURL(url);
        showMessage("荣誉勋章墙已导出 ✓", 3000, "info");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      } finally {
        badgeWallBusy = false;
      }
    }
    let weak = $state<ReturnType<typeof weakTop>>([]);
    let hours = $state<number[]>(new Array(24).fill(0));
    let mockHistory = $state<any[]>([]);
    let calib = $state<CalibrationReport | null>(null);
    let quad = $state<QuadrantReport | null>(null);
    let quadSignals = $state<string[]>([]);
    const typeByQid = new SvelteMap<string, string>();
    let reportEvents = $state<AttemptEvent[]>([]);
    const exposureNodes = $derived(exposureStats(reportEvents).nodes);
    let openActionList = $state<ActionItem[]>([]);
    let actionBusyId = $state("");
    let diagnosticsBusy = $state(false);
    let trend30 = $state<{ date: string; attempts: number; correct?: number }[]>([]);
    let errorMsg = $state("");
    let weekCmp = $state<ReturnType<typeof weekCompare> | null>(null);
    let reportBusy = $state(false);
    let reportRefreshing = $state(false);
    let reportRefreshQueued = false;
    const BANK_PREF_KEY = "lv-exam/activeBank";

    /** 每日战报写入思源日记（联动小驴复盘预留通道） */
    async function writeDaily() {
      if (!app || reportBusy) return;
      reportBusy = true;
      try {
        const banks = app.listBanks();
        if (!banks.length) throw new Error(t("guard.needBankFirst"));
        const bank = banks.find((b) => b.id === bankId) ?? banks[0];
        await app.writeDailyReport(bank.id, bank.name);
        showMessage(t("report.dailyDone"), 3600, "info");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4800, "error");
      } finally { reportBusy = false; }
    }

    /** 周报通知 lite：周一首次打开且有上周数据时轻提示（localStorage 防重） */
    let weeklyNudged = false;
    $effect(() => {
      if (loading || weeklyNudged || !app) return;
      const now = new Date();
      if (now.getDay() !== 1) return;
      const K = "lv-exam-weekly-nudge";
      const wk = `${now.getFullYear()}-W${Math.ceil(now.getDate() / 7)}`;
      try { if (localStorage.getItem(K) === wk) return; } catch { /* 隐私模式不阻断报告 */ }
      const d = app.derived();
      // effect 内一次性临时量（非组件状态），不转 SvelteDate
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const lastMonday = new Date(now);
      lastMonday.setDate(now.getDate() - 7);
      const k2 = `${lastMonday.getFullYear()}-${String(lastMonday.getMonth() + 1).padStart(2, "0")}-${String(lastMonday.getDate()).padStart(2, "0")}`;
      if ([...d.days.keys()].some((k) => k.startsWith(k2.slice(0, 7)))) {
        try { localStorage.setItem(K, wk); } catch { /* 本页仍以 weeklyNudged 防重 */ }
        weeklyNudged = true;
        showMessage(t("report.weeklyNudge"), 5200, "info");
      }
    });

    /** 39-06 lite：统计日期范围（0=全部）。口径：作答量/正确率/时段/校准按范围过滤；
     *  消灭错题与连续天数为状态类指标保持全局；掌握度按题库范围（reloadBankScope） */
    let rangeDays = $state(0);
    // R54：报告按「概览 / 考点与错题 / 记录与证据」分段，降低长页滚动成本。
    let reportSection = $state<"overview" | "knowledge" | "evidence">("overview");
    /** 69-03：聚合结果 memo——追加式流水 → (rangeDays, 条数, 末位 eid) 命中即免重算。
     *  报告页每次挂载/切日期范围都调 computeReport；重开面板不再付全量聚合成本。 */
    const reportMemo = new SvelteMap<string, { kpi: typeof kpi; hours: number[]; calib: CalibrationReport | null; quad: QuadrantReport | null; quadSignals: string[]; trend30: { date: string; attempts: number }[] }>();
    function computeReport() {
      if (!app) return;
      const d = app.derived();
      const all = app.attempts.all();
      const cutoff = reportWindowStart(rangeDays);
      const events = all.filter((e) => !cutoff || e.ts >= cutoff);
      reportEvents = events;
      const last = all[all.length - 1];
      const memoKey = `${cutoff}|${all.length}|${last ? last.eid : "-"}|${typeByQid.size}`;
      const cached = reportMemo.get(memoKey);
      if (cached) {
        kpi = cached.kpi; hours = cached.hours; calib = cached.calib;
        quad = cached.quad; quadSignals = cached.quadSignals; trend30 = cached.trend30;
        return;
      }
      let attempts = 0, correct = 0;
      for (const e of events) {
        if (e.verdict === "not_attempted") continue;
        attempts++;
        if (e.verdict === "correct") correct++;
      }
      kpi = { ...kpi, attempts, accuracy: attempts ? Math.round((correct / attempts) * 100) : 0 };
      hours = hourly(events);
      calib = calibration(events);
      // 63-01：信心×结果四象限聚合（独立练习口径；typeByQid 来自各题库读回）
      quad = quadrantReport(
        events.filter((e) => e.kind === "practice"),
        (qid) => typeByQid.get(qid) ?? "",
        rangeDays,
      );
      quadSignals = quadrantSignals(quad);
      const cutoffDate = cutoff ? reportDateKey(cutoff) : "";
      trend30 = cutoff ? dailyTrend(d.days).filter((p) => p.date >= cutoffDate) : dailyTrend(d.days);
      reportMemo.set(memoKey, { kpi, hours, calib, quad, quadSignals, trend30 });
      if (reportMemo.size > 8) reportMemo.delete(reportMemo.keys().next().value as string); // FIFO 上限
    }

    // ---------- AI 报告解读（117-01 T11：只解释确定性统计，事实全部来自 report.ts 既有聚合） ----------
    let explainBusy = $state(false);
    let explainText = $state("");
    let explainError = $state("");
    let reportContextVersion = 0;

    function resetAiResults() {
      reportContextVersion++;
      explainText = ""; explainError = "";
      nextActionText = ""; nextActionError = "";
    }

    function onRangeChange() {
      resetAiResults();
      computeReport();
    }

    function windowLabel(): string {
      return rangeDays === 1 ? t("report.rangeToday") : rangeDays === 7 ? t("report.range7") : rangeDays === 30 ? t("report.range30") : t("report.rangeAll");
    }

    async function runReportExplain() {
      if (!app || explainBusy || loading || reportRefreshing || scopeLoading) return;
      if (!app.kernelOnline) { explainError = t("state.offlineHint"); return; }
      explainBusy = true; explainError = ""; explainText = "";
      const requestedVersion = reportContextVersion;
      try {
        const { SiyuanAiChannel, OpenAiChannel } = await import("@/ai/client");
        const { buildReportExplainMessages } = await import("@/ai/reportExplain");
        const { AiTaskRunner } = await import("@/ai/task");
        const endpoint = String(plugin?.settingUtils?.get?.("aiEndpoint") ?? "");
        const key = resolveAiKey(plugin);
        const model = String(plugin?.settingUtils?.get?.("aiModel") ?? "gpt-4o-mini");
        const ch = endpoint && key
          ? new OpenAiChannel({ endpoint, apiKey: key, model }, (u, i) => fetch(u, i))
          : new SiyuanAiChannel(app.deps.client);
        const cutoff = reportWindowStart(rangeDays);
        const events = reportEvents;
        let attempts = 0, correct = 0;
        for (const e of events) {
          if (e.verdict === "not_attempted") continue;
          attempts++;
          if (e.verdict === "correct") correct++;
        }
        const cutoffDate = cutoff ? reportDateKey(cutoff) : "";
        const facts: import("@/ai/reportExplain").ReportFactsInput = {
          windowLabel: windowLabel(),
          attempts,
          correct,
          accuracy: attempts ? Math.round((correct / attempts) * 100) : null,
          trend: cutoff ? dailyTrend(app.derived().days).filter((p) => p.date >= cutoffDate) : dailyTrend(app.derived().days),
          calibration: calibration(events),
          exposure: exposureStats(events),
          delayed: delayedRecall(events),
          weakKp: weak.slice(0, 3).map((w) => ({ kp: w.root, accuracy: w.accuracy, attempts: w.total })),
        };
        const messages = buildReportExplainMessages(facts);
        const reqCtx: import("@/ai/task").AiTaskContext = {
          templateId: "report.explain",
          templateVersion: 1,
          qid: "", // 聚合统计任务：无单题身份
          questionRevision: "",
          learnerAnswer: null,
          submitted: true, // 报告=事后解读（揭示闸门天然满足）
          mode: "report",
          sessionId: "",
        };
        const env = await new AiTaskRunner(ch).run(reqCtx, messages);
        if (env.status === "ok" && env.data.text) void app.recordAiUsage(ch.id, env.tokens, 1).catch(() => undefined);
        if (requestedVersion !== reportContextVersion) {
          showMessage(t("report.aiScopeChanged", "统计范围已变化，本次 AI 结果未应用，请基于当前范围重新生成。"), 3400, "info");
          return;
        }
        if (env.status === "ok" && env.data.text) {
          explainText = env.data.text;
        } else {
          explainError = `${env.summary}${env.error ? "：" + env.error : ""}`;
        }
      } catch (e) {
        if (requestedVersion === reportContextVersion) explainError = String(e instanceof Error ? e.message : e);
      } finally { explainBusy = false; }
    }

    // ---------- AI 下一行动（117-02：容量+开放行动+弱项+错题在册 → 2-3 条任务建议） ----------
    let nextActionBusy = $state(false);
    let nextActionText = $state("");
    let nextActionError = $state("");

    async function runNextAction() {
      if (!app || nextActionBusy || loading || reportRefreshing || scopeLoading) return;
      if (!app.kernelOnline) { nextActionError = t("state.offlineHint"); return; }
      nextActionBusy = true; nextActionError = ""; nextActionText = "";
      const requestedVersion = reportContextVersion;
      try {
        const { SiyuanAiChannel, OpenAiChannel } = await import("@/ai/client");
        const { buildNextActionMessages } = await import("@/ai/nextAction");
        const { AiTaskRunner } = await import("@/ai/task");
        const { estimatePlanMinutes, avgMsByType } = await import("@/core/timeBudget");
        const endpoint = String(plugin?.settingUtils?.get?.("aiEndpoint") ?? "");
        const key = resolveAiKey(plugin);
        const model = String(plugin?.settingUtils?.get?.("aiModel") ?? "gpt-4o-mini");
        const ch = endpoint && key
          ? new OpenAiChannel({ endpoint, apiKey: key, model }, (u, i) => fetch(u, i))
          : new SiyuanAiChannel(app.deps.client);
        // 容量口径：错题重练队列前 10 题（53-01 估算；入口页今日计划不在此上下文，如实标注口径）
        const wrongItems = app.wrongItems();
        let redoQueue: Question[] = [];
        const scopeBank = bankId || app.listBanks()[0]?.id || "";
        if (wrongItems.length && scopeBank) {
          const qs = await app.listQuestions(scopeBank);
          const byId = new Map(qs.map((q: Question) => [q.id, q]));
          redoQueue = wrongItems.map((w) => byId.get(w.qid)).filter((q): q is Question => Boolean(q)).slice(0, 10);
        }
        const typeOf = new Map(redoQueue.map((q) => [q.id, q.type] as const));
        const est = redoQueue.length
          ? estimatePlanMinutes(redoQueue, avgMsByType(app.attempts.all(), (qid) => typeOf.get(qid)))
          : null;
        const openActions = await app.listOpenActions();
        const events = reportEvents;
        let attempts = 0, correct = 0;
        for (const e of events) {
          if (e.verdict === "not_attempted") continue;
          attempts++;
          if (e.verdict === "correct") correct++;
        }
        const now = Date.now();
        const facts: import("@/ai/nextAction").NextActionFactsInput = {
          windowLabel: windowLabel(),
          capacity: est ? { minutes: est.minutes, low: est.low, high: est.high, sourced: est.sourced } : null,
          capacityScope: "错题重练队列前 10 题（非入口页今日计划）",
          openActions: openActions.slice(0, 8).map((a) => ({
            detail: a.detail,
            kind: a.kind,
            ageDays: Math.max(0, Math.floor((now - a.createdAt) / 86_400_000)),
          })),
          weakKp: weak.slice(0, 3).map((w) => ({ kp: w.root, accuracy: w.accuracy, attempts: w.total })),
          wrongInBook: wrongItems.length,
          recentAttempts: attempts,
          recentAccuracy: attempts ? Math.round((correct / attempts) * 100) : null,
        };
        const messages = buildNextActionMessages(facts);
        if (requestedVersion !== reportContextVersion) return;
        const reqCtx: import("@/ai/task").AiTaskContext = {
          templateId: "plan.nextaction",
          templateVersion: 1,
          qid: "",
          questionRevision: "",
          learnerAnswer: null,
          submitted: true,
          mode: "report",
          sessionId: "",
        };
        const env = await new AiTaskRunner(ch).run(reqCtx, messages);
        if (env.status === "ok" && env.data.text) void app.recordAiUsage(ch.id, env.tokens, 1).catch(() => undefined);
        if (requestedVersion !== reportContextVersion) {
          showMessage(t("report.aiScopeChanged", "统计范围已变化，本次 AI 结果未应用，请基于当前范围重新生成。"), 3400, "info");
          return;
        }
        if (env.status === "ok" && env.data.text) {
          nextActionText = env.data.text;
        } else {
          nextActionError = `${env.summary}${env.error ? "：" + env.error : ""}`;
        }
      } catch (e) {
        if (requestedVersion === reportContextVersion) nextActionError = String(e instanceof Error ? e.message : e);
      } finally { nextActionBusy = false; }
    }

    // ---------- 题库范围（39-06/U21 lite）：掌握度/薄弱/下钻按所选题库聚合；KPI/热力图为全局口径 ----------
    let bankOptions = $state<{ id: string; name: string }[]>([]);
    let bankId = $state("");
    /** 侧栏项目卡与当前报告题库范围保持一致。 */
    const railBankName = $derived(bankOptions.find((b) => b.id === bankId)?.name || t("guard.title"));
    let scopeLoading = $state(false);
    let scopeError = $state("");

    /** 重新读取报告依赖的数据，保证从练习/模考返回后报告不会停留在旧快照。 */
    async function refreshReport(showFeedback = false) {
      if (!app) return;
      if (reportRefreshing) {
        if (!showFeedback) reportRefreshQueued = true;
        return;
      }
      reportRefreshing = true;
      resetAiResults();
      errorMsg = "";
      try {
        const d = app.derived();
        const { streak } = await import("@/core/replayer");
        bankOptions = app.listBanks();
        if (!bankOptions.some((b) => b.id === bankId)) {
          let rememberedBank = "";
          try { rememberedBank = localStorage.getItem(BANK_PREF_KEY) ?? ""; } catch { /* 隐私模式 */ }
          bankId = bankOptions.some((b) => b.id === rememberedBank) ? rememberedBank : bankOptions[0]?.id ?? "";
        }
        weekCmp = weekCompare(weeklyAggregates(d.days, new Date(), 2));
        kpi = { attempts: 0, accuracy: 0, eliminated: [...d.wrongbook.values()].filter((w) => w.status === "eliminated").length, streak: streak(d) };
        reportMemo.clear();
        computeReport();
        heat = heatmap(d.days);
        openActionList = await app.listOpenActions();
        mockHistory = await app.listMockResults();
        typeByQid.clear();
        // qid→题型映射全库加载；单库读失败不阻塞整份报告。
        for (const b of bankOptions) {
          try {
            for (const q of await app.listQuestions(b.id)) typeByQid.set(q.id, q.type);
          } catch { /* 单库读取失败跳过 */ }
        }
        await reloadBankScope(d);
        computeReport();
        if (showFeedback) showMessage(t("report.refreshDone"), 2600, "info");
      } catch (e) {
        errorMsg = String(e instanceof Error ? e.message : e);
      } finally {
        reportRefreshing = false;
        if (reportRefreshQueued) {
          reportRefreshQueued = false;
          void refreshReport(false);
        }
      }
    }

    onMount(() => {
      const refreshAfterChange = () => void refreshReport(false);
      const initReport = () => {
        if (!app) return;
        errorMsg = "";
        void refreshReport(false).finally(() => { loading = false; });
      };
      if (app) initReport();
      else loading = true;

      const offs = [
        onExamEvent("app-ready", () => {
          appOverride = plugin?.examApp ?? null;
          if (appOverride) initReport();
        }),
        onExamEvent("session-ended", refreshAfterChange),
        onExamEvent("wrongbook-changed", refreshAfterChange),
        onExamEvent<{ bank: string }>("bank-changed", (event) => {
          resetAiResults();
          bankId = event.payload.bank;
          refreshAfterChange();
        }),
      ];
      return () => offs.forEach((off) => off());
    });

    async function reloadBankScope(d = app?.derived()) {
      const requestedVersion = ++scopeReadVersion;
      const targetBankId = bankId;
      if (!app || !d || !bankId) {
        questions = []; mastery = []; weak = []; scopeError = ""; scopeLoading = false;
        return;
      }
      scopeLoading = true;
      scopeError = "";
      try {
        const loaded = await app.listQuestions(targetBankId);
        if (requestedVersion !== scopeReadVersion || targetBankId !== bankId) return;
        questions = loaded;
        mastery = masteryByKp(questions, d.byQuestion, app.attempts.all());
        weak = weakTop(mastery);
      } catch (e) {
        if (requestedVersion !== scopeReadVersion || targetBankId !== bankId) return;
        questions = [];
        mastery = [];
        weak = [];
        scopeError = String(e instanceof Error ? e.message : e);
      } finally { if (requestedVersion === scopeReadVersion) scopeLoading = false; }
    }
    let scopeReadVersion = 0;

    async function onBankChange() {
      resetAiResults();
      writeLocal(BANK_PREF_KEY, bankId || null);
      await reloadBankScope();
    }

    /** 薄弱考点下钻：打开对应题库并带入考点搜索，先核对题目再决定如何练习。 */
    function drillWeak(root: string) {
      if (!app) return;
      const picked = questions.filter((q) => q.type !== "material" && q.kp?.split("/")[0] === root);
      if (!picked.length) { showMessage(t("state.emptyBank"), 3000, "error"); return; }
      writeLocal(BANK_PREF_KEY, bankId);
      openPracticeView(plugin, "browse", { bankId, search: root });
    }

    /** 薄弱考点一键攻坚：直接以该薄弱考点题目开启专项练习会话 */
    function startWeakDrill(root: string) {
      if (!app || !bankId) return;
      const picked = questions.filter((q) => q.type !== "material" && q.kp?.split("/")[0] === root);
      if (!picked.length) { showMessage(t("state.emptyBank"), 3000, "error"); return; }
      if (plugin) {
        plugin.pendingPractice = picked;
        plugin.pendingPracticeBankId = bankId;
      }
      emitExamEvent("open-practice-questions", { qids: picked.map((q) => q.id), bank: bankId });
      plugin.openPractice?.();
    }

    /** 下一行动（U15 lite）：完成=用户确认（最小证据）；取消保留记录可回看 */
    async function finishAction(id: string) {
      if (!app || actionBusyId) return;
      actionBusyId = id;
      try {
        await app.completeAction(id);
        openActionList = openActionList.filter((item) => item.id !== id);
        showMessage(t("action.completed", "行动已完成"), 2600, "info");
        try { openActionList = await app.listOpenActions(); }
        catch (e) { showMessage(t("action.refreshFailed", "行动已更新，但列表刷新失败。请重新打开报告查看。") + ` ${String(e instanceof Error ? e.message : e)}`, 4800, "error"); }
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      } finally { actionBusyId = ""; }
    }
    async function dropAction(id: string) {
      if (!app || actionBusyId) return;
      actionBusyId = id;
      try {
        const { confirmDialogSync } = await import("../../libs/dialog");
        if (!(await confirmDialogSync({
          title: t("action.dismissTitle", "取消这项行动？"),
          content: t("action.dismissConfirm", "这会将行动标记为已取消并从待办列表移除；记录仍可在历史中查看。"),
        }))) return;
        await app.cancelAction(id);
        openActionList = openActionList.filter((item) => item.id !== id);
        showMessage(t("action.dismissed", "行动已取消，记录仍保留"), 2600, "info");
        try { openActionList = await app.listOpenActions(); }
        catch (e) { showMessage(t("action.refreshFailed", "行动已更新，但列表刷新失败。请重新打开报告查看。") + ` ${String(e instanceof Error ? e.message : e)}`, 4800, "error"); }
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      } finally { actionBusyId = ""; }
    }

    /** 行动重练只启动题目；完成作答后由用户确认完成，不把打开题目当作已完成。 */
    async function redoAction(a: ActionItem) {
      if (!app || !a.qid || actionBusyId) return;
      actionBusyId = a.id;
      try {
      let q = questionMap.get(a.qid);
      let targetBankId = bankId;
      // 行动记录跨题库保存；当前选中的题库没有该题时，自动定位到包含它的题库。
      if (!q) {
        for (const bank of app.listBanks()) {
          try {
            const candidate = (await app.listQuestions(bank.id)).find((x) => x.id === a.qid);
            if (candidate) { q = candidate; targetBankId = bank.id; break; }
          } catch { /* 继续查找其他题库 */ }
        }
      }
      if (!q) { showMessage(t("action.redoMissing"), 3400, "info"); return; }
        await app.startSession([q], "wrong", targetBankId || undefined);
        // 练习台已挂载时通过总线同步其本地会话引用；未挂载时 pending 字段由首次挂载消费。
        if (plugin) {
          plugin.pendingPractice = [q];
          plugin.pendingPracticeBankId = targetBankId;
        }
        emitExamEvent("open-practice-questions", { qids: [q.id], bank: targetBankId });
        plugin.openPractice?.();
        showMessage(t("action.redoStarted", "已进入重练。完成作答后回到报告确认完成；仅打开题目不会结清行动。"), 3600, "info");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      } finally {
        actionBusyId = "";
      }
    }

    /** 诊断信息导出（7A/46-06 lite）：脱敏 JSON → 剪贴板；不含题干/key/路径/个人内容 */
    async function exportDiagnostics() {
      if (!app || diagnosticsBusy) return;
      diagnosticsBusy = true;
      try {
        const d = app.derived();
        const usage = await app.aiUsage();
        const storageRows = await app.storageUsage();
        const audit = app.auditData(new Set()); // 无已知 qid 集 → 孤儿项跳过（诊断口径保守）
        const bundle = {
          app: "siyuan-exam",
          exportedAt: new Date().toISOString(),
          kernelOnline: app.kernelOnline,
          probe: app.probeMessage,
          banks: app.listBanks().length,
          attempts: app.attempts.all().length,
          wrongbookActive: app.wrongItems().length,
          clockAnomalies: d.clockAnomalies,
          skippedEvents: d.skipped,
          mockResults: (await app.listMockResults()).length,
          openActions: (await app.listOpenActions()).length,
          aiUsage: usage,
          saveStates: app.saves.all().map((r) => ({ key: r.key, state: r.state })),
          // 46-06/69-06 扩展（四三批）：存储占用与数据体检摘要（脱敏，仅计数）
          storageKB: Math.round(storageRows.reduce((s, r) => s + r.bytes, 0) / 1024),
          dataAudit: {
            events: audit.events,
            duplicateEids: audit.duplicateEids,
            badEvents: audit.badEvents,
            futureEvents: audit.futureEvents,
          },
        };
        await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
        showMessage(t("diag.copied"), 3800, "info");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      } finally { diagnosticsBusy = false; }
    }

    // ---------- 存储占用 / 数据体检 / 数据出库（69-01/69-06/58-01 lite，三十批） ----------
    let storageRows = $state<{ key: string; bytes: number; present: boolean; error?: string }[]>([]);
    let storageOpen = $state(false);
    let storageBusy = $state(false);
    let storageError = $state("");
    const storageTotalKb = $derived(Math.round(storageRows.reduce((s, r) => s + r.bytes, 0) / 1024));
    async function loadStorage() {
      if (!app || storageBusy) return;
      storageBusy = true;
      storageError = "";
      try {
        storageRows = await app.storageUsage();
      } catch (e) {
        storageError = String(e instanceof Error ? e.message : e);
        showMessage(storageError, 4200, "error");
      } finally { storageBusy = false; }
    }
    async function toggleStorage() {
      if (storageBusy) return;
      storageOpen = !storageOpen;
      if (!storageOpen || !app) return;
      await loadStorage();
    }

    let auditResult = $state<import("@/core/dataAudit").DataAuditReport | null>(null);
    let auditBusy = $state(false);
    let auditError = $state("");
    let auditSkippedBanks = $state(0);
    async function runDataAudit() {
      if (!app || auditBusy) return;
      auditBusy = true;
      auditResult = null;
      auditError = "";
      auditSkippedBanks = 0;
      try {
        // 孤儿检测口径：当前所有已加载题库的题目 id（跨库扫描；空题库=跳过孤儿项）
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- 函数内累加器（非组件状态）
        const known = new Set<string>();
        for (const b of app.listBanks()) {
          try {
            for (const q of await app.listQuestions(b.id)) known.add(q.id);
          } catch { auditSkippedBanks++; }
        }
        auditResult = app.auditData(known);
      } catch (e) {
        auditError = String(e instanceof Error ? e.message : e);
        showMessage(auditError, 4200, "error");
      } finally { auditBusy = false; }
    }

    let exportBusy = $state(false);
    async function exportAllData() {
      if (!app || exportBusy) return;
      exportBusy = true;
      try {
        const json = await app.exportAllData();
        const blob = new Blob([json], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `小驴考试（内测版）-数据出库 ${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        showMessage(t("data.exportDone"), 3200, "info");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      } finally { exportBusy = false; }
    }

    /** 清除插件数据（58-03 lite）：双确认 → 逐键置空 → 逐对象回执。
     *  范围：题库注册表/流水/错题处置/错因/行动/模考记录/AI 队列/映射/视图/草稿等插件存储；
     *  不动：思源笔记本与题目块本体、AI Key（宿主密钥库）、已外发数据（无法撤回）。 */
    let purgeReceipts = $state<{ key: string; ok: boolean }[]>([]);
    let purgeBusy = $state(false);
    async function purgeAllData() {
      if (!app || purgeBusy) return;
      purgeBusy = true;
      try {
        const { confirmDialogSync } = await import("../../libs/dialog");
        if (!(await confirmDialogSync({ title: t("data.purgeTitle"), content: t("data.purgeScope") }))) return;
        // 第二次确认：不可撤销（建议先「数据出库」备份）。忙碌锁同时覆盖确认阶段。
        if (!(await confirmDialogSync({ title: t("data.purgeTitle"), content: t("data.purgeFinal") }))) return;
        purgeReceipts = await app.purgeAllData();
        const failed = purgeReceipts.filter((r) => !r.ok).length;
        showMessage(failed ? t("data.purgePartial").replace("{f}", String(failed)) : t("data.purgeDone"), 5600, failed ? "error" : "info");
        await refreshReport(false);
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      } finally { purgeBusy = false; }
    }

    const heatColor = (n: number) => (n === 0 ? "" : n < 5 ? "l1" : n < 15 ? "l2" : n < 30 ? "l3" : "l4");
    const maxHour = $derived(Math.max(1, ...hours));
    const hoursSvg = $derived(hours.map((n, i) => `${(i / 23) * 300},${40 - Math.round((n / maxHour) * 36)}`).join(" "));
    const maxTrend = $derived(Math.max(1, ...trend30.map((p) => p.attempts)));
    const trendSpan = $derived(Math.max(1, trend30.length - 1));
    /** 55-04 lite：正确率折线点——有作答日连成段（0 题日以 null 断开），比例尺 0-100% 对满高（viewBox 600×90） */
    const trendAccLines = $derived.by(() => {
      const lines: string[] = [];
      let points: string[] = [];
      for (const [i, p] of trend30.entries()) {
        if (p.attempts > 0) points.push(`${(i / trendSpan) * 600},${86 - Math.round(((p.correct ?? 0) / p.attempts) * 78)}`);
        else if (points.length) { lines.push(points.join(" ")); points = []; }
      }
      if (points.length) lines.push(points.join(" "));
      return lines;
    });

    /** v6 图表质感：题量面积多边形（渐变填充）与最后一个有作答日的末点坐标 */
    const trendArea = $derived.by(() => {
      const pts = trend30
        .map((p, i) => `${(i / trendSpan) * 600},${86 - Math.round((p.attempts / maxTrend) * 78)}`)
        .filter(Boolean);
      if (!pts.length) return "";
      const lastX = pts[pts.length - 1].split(",")[0];
      return `0,88 ${pts.join(" ")} ${lastX},88`;
    });
    const trendLastDot = $derived.by(() => {
      for (let i = trend30.length - 1; i >= 0; i--) {
        if (trend30[i].attempts > 0) return { x: (i / trendSpan) * 600, y: 86 - Math.round((trend30[i].attempts / maxTrend) * 78) };
      }
      return null;
    });

    // 44-02 lite：确定-错 下钻（展开时从流水实时取，随报告数据同源）
    let cwOpen = $state(false);
    let caOpen = $state(false);
    const caList = $derived(changedAnswerList(reportEvents));
    let expOpen = $state(false);
    const expList = $derived(expOpen ? recentExposureList(reportEvents, 7 * 86_400_000, Date.now()) : []);
    const cwList = $derived(cwOpen ? confidentWrongList(reportEvents) : []);
    // 44-02 lite 对偶：不确定-对 下钻
    let ucOpen = $state(false);
    const ucList = $derived(ucOpen ? uncertainCorrectList(reportEvents) : []);
    // 39-08 lite：延迟独立回忆（错后隔日首次作答；随日期范围联动）
    const recall = $derived(delayedRecall(reportEvents));
    // 52-02/114-01 呈现端：独立/受助/先回忆三口径（随日期范围联动）
    const exposure = $derived(exposureStats(reportEvents));

    // 45-08：图表数据表展开态（单选一个卡）+ CSV 下载（与 SVG 同一数据快照）
    let tableOpen = $state<"trend" | "heat" | "hourly" | "">("");
    function downloadChartCsv(csv: string, name: string) {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `小驴考试（内测版）-报告-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
</script>

<div class="fn__flex-1 lv-exam-tab">
  <div class="block__icons">
    <button class="lv-menu-btn" aria-label={t("menu.open")} aria-expanded={railOpen} bind:this={menuBtn} onclick={() => railOpen = true}><Icon name="menu" size={16} /></button>
    <div class="lv-crumbs">
      <span class="lv-crumb">{railBankName}</span>
      <span class="lv-crumb-sep" aria-hidden="true">/</span>
      <span class="lv-crumb-current">{t("tab.report")}</span>
    </div>
    {#if app}<SaveStatus gate={app.saves} {t} />{/if}
    <button class="lv-btn lv-btn--ghost sm lv-palette-btn" onclick={() => paletteOpen = true} title="Ctrl / ⌘ K">
      <Icon name="search" size={13} /> <span class="lv-palette-label">{t("palette.open")}</span> <span class="lv-kbd">⌘K</span>
    </button>
    <!-- 39-06 lite：统计日期范围（消灭错题/连续天数为状态类指标保持全局） -->
    <select class="lv-select" bind:value={rangeDays} onchange={onRangeChange} disabled={loading || reportRefreshing} title={t("report.rangeTip")}>
      <option value={0}>{t("report.rangeAll")}</option>
      <option value={1}>{t("report.rangeToday")}</option>
      <option value={7}>{t("report.range7")}</option>
      <option value={30}>{t("report.range30")}</option>
    </select>
    <!-- 69-04 lite：陈旧态显式控制——流水可能在报告打开期间新增，强制刷新清 memo 重算 -->
    <button class="lv-btn sm lv-btn--ghost" disabled={!app || reportRefreshing} onclick={() => void refreshReport(true)} title={t("report.refreshTip")}>
      <Icon name="rotate" size={14} /> {reportRefreshing ? "…" : t("report.refresh")}
    </button>
    {#if bankOptions.length > 1}
      <select class="lv-select" style="max-width:200px" bind:value={bankId} disabled={scopeLoading || reportRefreshing} onchange={onBankChange}>
        {#each bankOptions as b, _i (_i)}<option value={b.id}>{b.name}</option>{/each}
      </select>
      <span class="lv-muted" style="font-size:var(--lv-font-size-caption)">{t("report.scopeHint")}</span>
    {/if}
    <span class="fn__flex-1"></span>
    <!-- 117-01 T11 / 117-02：AI 解读与 AI 下一行动（按当前统计范围；只解释/建议，不重算不虚构） -->
    <button class="lv-btn sm" onclick={() => void runReportExplain()} disabled={!app || loading || reportRefreshing || scopeLoading || explainBusy} aria-busy={explainBusy}>
      <Icon name="sparkles" size={13} /> {explainBusy ? "…" : t("reportExplain.ask")}
    </button>
    <button class="lv-btn sm" onclick={() => void runNextAction()} disabled={!app || loading || reportRefreshing || scopeLoading || nextActionBusy} aria-busy={nextActionBusy}>
      <Icon name="target" size={13} /> {nextActionBusy ? "…" : t("nextAction.ask")}
    </button>
    <span class="lv-chip">{t("report.dataFromLog")}</span>
  </div>
<div class="fn__flex-1 lv-shell">
  <Rail active="report" taskactive="report" ontasknavigate={onTaskNav} {plugin} open={railOpen} onclose={closeRail}
    project={{ name: railBankName || t("guard.title"), kicker: t("rail.projectKicker") }} onproject={() => plugin.openPractice?.()} />
  <div class="lv-main">
  <div class="fn__flex-1 lv-pad">
  <div class="lv-screen-head"><span class="lv-eyebrow">{t("head.report.eyebrow")}</span><h1 class="lv-h1">{t("head.report.title")}</h1><p>{t("head.report.desc")}</p></div>

  {#if explainBusy}<p class="lv-muted" role="status">{t("reportExplain.generating", "正在解读当前统计，请稍候…")}</p>{/if}
  {#if nextActionBusy}<p class="lv-muted" role="status">{t("nextAction.generating", "正在根据当前统计生成行动建议，请稍候…")}</p>{/if}
  {#if explainError}
    <div class="lv-error" role="alert" style="margin:0 0 8px">{explainError}</div>
    <p class="lv-muted">{t("report.aiSetupHint", "AI 需要先配置：可使用思源设置中的可用模型，或在本插件设置中填写兼容端点、模型与密钥。统计和手动练习无需 AI。")}</p>
  {:else if explainText}
    <div class="lv-card" style="margin:0 0 10px;padding:10px 14px">
      <div class="lv-row" style="margin:0 0 4px">
        <b class="lv-card-title" style="font-size:var(--lv-font-size-body-compact)"><Icon name="flask" size={14} /> {t("reportExplain.title")}</b>
        <span class="lv-chip">{windowLabel()}</span>
        <span class="fn__flex-1"></span>
        <button class="lv-btn sm lv-btn--ghost" onclick={() => { explainText = ""; }}>{t("edit.cancel")}</button>
      </div>
      <div style="font-size:var(--lv-font-size-body-compact);white-space:pre-wrap;overflow-wrap:anywhere">{explainText}</div>
      <div class="lv-muted" style="font-size:var(--lv-font-size-compact);margin-top:4px">{t("reportExplain.disclaimer")}</div>
    </div>
  {/if}
  {#if nextActionError}
    <div class="lv-error" role="alert" style="margin:0 0 8px">{nextActionError}</div>
    <p class="lv-muted">{t("report.aiSetupHint", "AI 需要先配置：可使用思源设置中的可用模型，或在本插件设置中填写兼容端点、模型与密钥。统计和手动练习无需 AI。")}</p>
  {:else if nextActionText}
    <div class="lv-card" style="margin:0 0 10px;padding:10px 14px">
      <div class="lv-row" style="margin:0 0 4px">
        <b style="font-size:var(--lv-font-size-body-compact)"><Icon name="target" size={14} /> {t("nextAction.title")}</b>
        <span class="fn__flex-1"></span>
        <button class="lv-btn sm lv-btn--ghost" onclick={() => { nextActionText = ""; }}>{t("edit.cancel")}</button>
      </div>
      <div style="font-size:var(--lv-font-size-body-compact);white-space:pre-wrap;overflow-wrap:anywhere">{nextActionText}</div>
      <div class="lv-muted" style="font-size:var(--lv-font-size-compact);margin-top:4px">{t("nextAction.disclaimer")}</div>
    </div>
  {/if}

  {#if loading || !app}
    <div class="lv-pad" role="status" aria-live="polite" aria-busy="true">
      <p class="lv-muted">{!app ? (t("state.initializing") || "正在初始化小驴考试，请稍候…") : t("report.loadingStats", "正在计算学习数据…")}</p>
      <div class="lv-skeleton" aria-hidden="true"></div>
    </div>
  {:else if errorMsg}
    <div class="lv-error" role="alert">
      {errorMsg}
      <button class="lv-btn sm lv-btn--ghost" style="margin-left:8px" disabled={reportRefreshing} onclick={() => void refreshReport(true)}>
        <Icon name="rotate" size={13} /> {reportRefreshing ? "…" : t("report.retryLoad")}
      </button>
    </div>
    {#if !bankOptions.length}
      <div class="lv-card" style="margin-top:12px;padding:18px 20px" role="status">
        <b>{t("report.noBankTitle")}</b>
        <p class="lv-muted">{t("report.noBankDesc")}</p>
        <button class="lv-btn lv-btn--primary" onclick={() => plugin.openPractice?.()}>{t("report.goPractice")}</button>
      </div>
    {/if}
  {:else if !bankOptions.length}
    <div class="lv-card" style="padding:18px 20px" role="status">
      <b>{t("report.noBankTitle")}</b>
      <p class="lv-muted">{t("report.noBankDesc")}</p>
      <button class="lv-btn lv-btn--primary" onclick={() => plugin.openPractice?.()}>{t("report.goPractice")}</button>
    </div>
  {:else}
    <p class="lv-muted" style="margin:0 0 8px;font-size:var(--lv-font-size-caption)">{t("report.scopeDetails", "作答统计：{range}，全部题库。考点掌握与薄弱项：{bank}，历史累计。热力图、连胜与消灭错题为全局历史状态。").replace("{range}", windowLabel()).replace("{bank}", railBankName)}</p>
    {#if scopeError}
      <div class="lv-error" style="margin:0 0 10px" role="alert">
        <span>{t("report.scopeLoadError")}: {scopeError}</span>
        <button class="lv-btn sm lv-btn--ghost" style="margin-left:8px" disabled={scopeLoading} onclick={() => void reloadBankScope()}>
          <Icon name="rotate" size={13} /> {scopeLoading ? "…" : t("report.scopeRetry")}
        </button>
      </div>
    {:else if scopeLoading}
      <div class="lv-muted" style="margin:0 0 10px" role="status">{t("report.scopeLoading")}</div>
    {/if}
    <div class="lv-report-tabs" role="group" aria-label={t("report.sectionsLabel", "报告分区")}>
      <button class="lv-report-tab" class:active={reportSection === "overview"} aria-pressed={reportSection === "overview"} onclick={() => reportSection = "overview"}>{t("report.sectionOverview", "概览")}</button>
      <button class="lv-report-tab" class:active={reportSection === "knowledge"} aria-pressed={reportSection === "knowledge"} onclick={() => reportSection = "knowledge"}>{t("report.sectionKnowledge", "考点与错题")}</button>
      <button class="lv-report-tab" class:active={reportSection === "evidence"} aria-pressed={reportSection === "evidence"} onclick={() => reportSection = "evidence"}>{t("report.sectionEvidence", "记录与证据")}</button>
    </div>
    {#if reportSection === "evidence" && reportEvents.length === 0}
      <div class="lv-empty" style="padding:20px 18px;margin-bottom:12px" role="status">
        <div class="lv-empty-icon"><Icon name="file-text" size={22} /></div>
        <b>{t("report.noEvidenceTitle", "还没有学习记录")}</b>
        <p class="lv-muted">{t("report.noEvidenceDesc", "完成一次练习或模考后，作答过程与证据会显示在这里。")}</p>
        <button class="lv-btn lv-btn--primary sm" style="margin-top:10px" onclick={() => plugin.openPractice?.()}>{t("report.goPractice")}</button>
      </div>
    {/if}
    {#if kpi.attempts === 0 && reportSection === "overview"}
      <div class="lv-empty" style="padding:24px 18px;margin-bottom:12px" role="status">
        <div class="lv-empty-icon"><Icon name="chart" size={24} /></div>
        <b>{rangeDays ? t("report.noRangeAttemptsTitle") : t("report.noAttemptsTitle")}</b>
        <p class="lv-muted">{rangeDays ? t("report.noRangeAttemptsDesc") : t("report.noAttemptsDesc")}</p>
        <button class="lv-btn lv-btn--primary sm" style="margin-top:12px" onclick={() => plugin.openPractice?.()}>{t("report.goPractice")}</button>
      </div>
    {/if}
    <div class="lv-kpis" class:lv-report-section--hidden={reportSection !== "overview"}>
      <div class="lv-card lv-kpi"><div class="l"><span>{t("report.attempts")}</span><Icon name="zap" size={15} /></div><div class="v num">{kpi.attempts}</div></div>
      <div class="lv-card lv-kpi"><div class="l"><span>{t("report.accuracy")}</span><Icon name="target" size={15} /></div><div class="v num">{kpi.attempts ? `${kpi.accuracy}%` : "—"}</div></div>
      <div class="lv-card lv-kpi"><div class="l"><span>{t("report.eliminated")}</span><Icon name="xcircle" size={15} /></div><div class="v num">{kpi.eliminated}</div></div>
      <div class="lv-card lv-kpi"><div class="l"><span>{t("report.streak")}</span><Icon name="flame" size={15} /></div><div class="v num">{kpi.streak} {t("entry.days")}</div></div>
    </div>
    {#if reportSection === "overview" && (weak.length || weekCmp)}
      <div class="lv-report-overview-grid" class:has-both={weak.length > 0 && Boolean(weekCmp)}>
      {#if weak.length}
        <div class="lv-card lv-report-next">
          <div><span class="lv-eyebrow">{t("report.nextStep", "建议下一步")}</span><b>{weak[0].root}</b><p class="lv-muted">{t("report.nextStepHint", "从当前薄弱考点开始重练，练习结果会继续记入本地报告。")}</p></div>
          <div class="lv-row" style="margin:0;gap:var(--lv-space-compact);flex-wrap:wrap">
            <button class="lv-btn lv-btn--primary sm" onclick={() => startWeakDrill(weak[0].root)}>
              <Icon name="play" size={13} /> {t("report.drillWeakAction")}
            </button>
            <button class="lv-btn sm lv-btn--ghost" onclick={() => drillWeak(weak[0].root)}>
              <Icon name="search" size={13} /> {t("report.drillKp")}
            </button>
          </div>
        </div>
      {/if}
      {#if weekCmp}
      <!-- 周对比（原型 chart-row 数据语言：双条对比 + 带数值 delta，替代孤箭头 chip） -->
      {@const delta = weekCmp.thisWeek.attempts - weekCmp.lastWeek.attempts}
      {@const maxW = Math.max(weekCmp.thisWeek.attempts, weekCmp.lastWeek.attempts, 1)}
      <div class="lv-card lv-section lv-report-week">
        <div class="lv-row" style="margin:0 0 6px;justify-content:space-between">
          <b>{t("report.weekCompare")}</b>
          {#if delta !== 0}
            <span class="lv-chip num {delta > 0 ? 'lv-chip--grn' : 'lv-chip--red'}">{delta > 0 ? "↑" : "↓"} {delta > 0 ? "+" : ""}{delta} {t("browse.count")}</span>
          {:else}
            <span class="lv-chip num">±0</span>
          {/if}
        </div>
        <p class="lv-muted lv-report-week-scope">{t("report.weekCompareScope")}</p>
        <div class="lv-chart-row"><span>{t("report.thisWeek")}</span><div class="lv-progress"><i style="width:{Math.round((weekCmp.thisWeek.attempts / maxW) * 100)}%"></i></div><b class="num">{weekCmp.thisWeek.attempts}</b></div>
        <div class="lv-chart-row"><span>{t("report.lastWeek")}</span><div class="lv-progress"><i style="width:{Math.round((weekCmp.lastWeek.attempts / maxW) * 100)}%"></i></div><b class="num">{weekCmp.lastWeek.attempts}</b></div>
      </div>
      {/if}
      </div>
    {/if}

    {#if quad}
      <!-- 63-01：信心×结果四象限（独立练习口径；置信度缺失不补猜测） -->
      <div class="lv-card lv-section" class:lv-report-section--hidden={reportSection !== "knowledge"} style="margin-bottom:12px">
        <b>{t("quad.title")}</b>
        {#if quad.denominator === 0}
          <div class="lv-muted">{t("quad.empty")}</div>
        {:else}
          <div class="lv-quad-grid">
            <div class="lv-quad lv-quad--grn"><span class="v num">{quad.cells.sureRight}</span><span class="l">{t("quad.sureRight")}</span></div>
            <div class="lv-quad lv-quad--red"><span class="v num">{quad.cells.sureWrong}</span><span class="l">{t("quad.sureWrong")}</span></div>
            <div class="lv-quad lv-quad--amb"><span class="v num">{quad.cells.guessedRight}</span><span class="l">{t("quad.guessedRight")}</span></div>
            <div class="lv-quad"><span class="v num">{quad.cells.fuzzyRight}</span><span class="l">{t("quad.fuzzyRight")}</span></div>
          </div>
          {#if quad.cells.noConfidence}
            <div class="lv-row lv-muted" style="font-size:var(--lv-font-size-caption);margin:8px 0 0">{t("quad.noConf").replace("{n}", String(quad.cells.noConfidence))}</div>
          {/if}
          {#if quad.lowSample}
            <div class="lv-row" style="margin:8px 0 0"><span class="lv-chip lv-chip--amb">{t("quad.lowSample")}</span></div>
          {/if}
          {#if quadSignals.length}
            <div class="lv-row" style="margin:10px 0 0;align-items:flex-start">
              {#each quadSignals as sig (sig)}
                <span class="lv-chip lv-chip--amb" style="white-space:normal;text-align:left">{t("quad.sig." + sig)}</span>
              {/each}
            </div>
          {/if}
          {#if quad.byType.length > 1}
            <div class="lv-dtable" style="margin-top:12px">
              <table>
                <thead><tr><th>{t("quad.byType")}</th><th>{t("quad.sureRight")}</th><th>{t("quad.sureWrong")}</th><th>{t("quad.guessedRight")}</th><th>{t("quad.fuzzyRight")}</th></tr></thead>
                <tbody>
                  {#each quad.byType as row (row.type)}
                    <tr><td>{t("qtype." + row.type, row.type)}</td><td class="num">{row.cells.sureRight}</td><td class="num">{row.cells.sureWrong}</td><td class="num">{row.cells.guessedRight}</td><td class="num">{row.cells.fuzzyRight}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        {/if}
      </div>
    {/if}

    <!-- 63-02/65-06：近期曝光查询（近 7 天 lite；布尔事实，不含题面内容） -->
    <div class="lv-card lv-section" class:lv-report-section--hidden={reportSection !== "evidence"} style="margin-bottom:12px">
      <b>{t("exposure.title")}</b>
      {#if Object.keys(exposureNodes).length}
        <div class="lv-row" style="margin:4px 0 0">
          {#each Object.entries(exposureNodes) as [node, n] (node)}
            <span class="lv-chip num" title={t("exposure.node." + node, node)}>{t("exposure.node." + node, node)} ×<span class="num">{n}</span></span>
          {/each}
        </div>
      {/if}
      <button class="lv-btn sm lv-btn--ghost" style="margin:4px 0" aria-expanded={expOpen} onclick={() => expOpen = !expOpen}>
        {expOpen ? "▾" : "▸"} {expOpen ? t("exposure.hide") : t("exposure.drill")}
      </button>
      {#if expOpen}
        {#if expList.length}
          <div class="lv-row" style="margin:6px 0 0;flex-direction:column;align-items:stretch;gap:var(--lv-space-1)">
            {#each expList as x (x.qid + x.lastTs)}
              {@const stem = questionMap.get(x.qid)?.stem}
              <div class="lv-error-row" style="white-space:normal" title={stem ?? x.qid}>
                <span class="lv-inline-icon"><Icon name="eye" size={13} /></span> {stem ? stem.slice(0, 60) : x.qid}
                <span class="lv-muted num"> · {new Date(x.lastTs).toLocaleString()}</span>
                <span class="lv-chip num">×{x.count}</span>
                {#each x.kinds as k (k)}<span class="lv-chip">{t("qk." + k, k)}</span>{/each}
                {#each x.nodes as n (n)}<span class="lv-chip lv-chip--amb">{t("exposure.node." + n, n)}</span>{/each}
              </div>
            {/each}
          </div>
        {:else}
          <div class="lv-muted" role="status">{t("exposure.empty")}</div>
        {/if}
      {/if}
    </div>

    {#if caList.length || caOpen}
      <!-- 63-03：改答题清单（首答 → 终答 分离；报告口径：终答==首答不列） -->
      <div class="lv-card lv-section" class:lv-report-section--hidden={reportSection !== "evidence"} style="margin-bottom:12px">
        <b>{t("report.changedTitle")}</b>
        <button class="lv-btn sm lv-btn--ghost" style="margin-top:4px" onclick={() => caOpen = !caOpen}>
          {caOpen ? "▾" : "▸"} {t("report.changedDrill")}（<span class="num">{caList.length}</span>）
        </button>
        {#if caOpen}
          <div class="lv-row" style="margin:6px 0 0;flex-direction:column;align-items:stretch;gap:var(--lv-space-1)">
            {#each caList as c, _ci (_ci)}
              {@const stem = questionMap.get(c.qid)?.stem}
              <div class="lv-error-row" style="white-space:normal" title={stem ?? c.qid}>
                <b class="num">↺</b> {stem ? stem.slice(0, 60) : c.qid}
                <span class="lv-muted"> · {t("report.changedFirst")}: {c.first} → {c.final}</span>
                <span class="lv-chip num" style="margin-left:4px">{c.editCount}</span>
                {#if c.reasons.length}<span class="lv-muted"> · {c.reasons.map((r) => t("trail.reason." + r)).join("、")}</span>{/if}
              </div>
            {:else}
              <span class="lv-muted num">{t("report.changedEmpty")}</span>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if trend30.some((p) => p.attempts > 0)}
      <div class="lv-card lv-section" class:lv-report-section--hidden={reportSection !== "overview"} style="margin-bottom:12px">
        <b>{rangeDays ? t("report.trendWindow", "{range}作答趋势").replace("{range}", windowLabel()) : t("report.trend30")}</b>
        <!-- 全宽趋势图（6.7:1 viewBox）：随卡片伸缩，不在大卡里缩成小图 -->
        <svg viewBox="0 0 600 90" style="width:100%;display:block" role="img" aria-label={t("report.trend30")}>
          <defs>
            <linearGradient id="lv-trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="var(--lv-accent)" stop-opacity="0.22" />
              <stop offset="1" stop-color="var(--lv-accent)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" y1="88.5" x2="600" y2="88.5" stroke="var(--lv-border)" stroke-width="1" />
          {#if trendArea}<polygon points={trendArea} fill="url(#lv-trend-fill)" />{/if}
          <polyline points={trend30.map((p, i) => `${(i / trendSpan) * 600},${86 - Math.round((p.attempts / maxTrend) * 78)}`).join(" ")} fill="none" stroke="var(--lv-accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          {#if trendLastDot}<circle cx={trendLastDot.x} cy={trendLastDot.y} r="3" fill="var(--lv-accent)" stroke="var(--lv-surface)" stroke-width="1.5" />{/if}
          <!-- 55-04 lite：正确率曲线（有作答日连成段，0 题日断点；比例尺 0-100% 对满高） -->
          {#each trendAccLines as points (points)}<polyline {points} fill="none" stroke="var(--lv-green)" stroke-width="1.6" stroke-dasharray="3 2" />{/each}
          <!-- Anki hover-columns 灵感：逐日透明命中区 + SVG 原生 title（零 JS，悬浮看当日题量/正确率） -->
          {#each trend30 as p, i (p.date)}
            {#if p.attempts > 0}
              <circle cx={(i / trendSpan) * 600} cy={86 - Math.round((p.attempts / maxTrend) * 78)} r="9" fill="transparent" style="cursor:default">
                <title>{p.date} · {p.attempts} {t("browse.count")} · {t("report.accuracy")} {Math.round(((p.correct ?? 0) / p.attempts) * 100)}%</title>
              </circle>
            {/if}
          {/each}
        </svg>
        <div class="lv-row" style="margin:4px 0 0">
          <span class="lv-chip num">{t("report.trendMax")} {maxTrend}</span>
          <span class="lv-chip num">{t("report.trendSum")} {trend30.reduce((n, p) => n + p.attempts, 0)}</span>
          <span class="lv-chip lv-chip--grn">— {t("report.accuracyTrend")}</span>
          <!-- 45-08：SVG 图表的文本等价物 + CSV（同一数据快照，读屏/打印/导出数字一致） -->
          <button class="lv-btn sm lv-btn--ghost" aria-expanded={tableOpen === "trend"} onclick={() => tableOpen = tableOpen === "trend" ? "" : "trend"}><Icon name="table" size={13} /> {t("data.table")}</button>
          <button class="lv-btn sm lv-btn--ghost" onclick={() => downloadChartCsv(trendToCsv(trend30), "trend30")}><Icon name="export" size={13} /> CSV</button>
        </div>
        {#if tableOpen === "trend"}
          <table class="lv-dtable">
            <thead><tr><th>{t("report.trendDay")}</th><th>{t("report.attempts")}</th><th>{t("report.accuracy")}</th></tr></thead>
            <tbody>
              {#each trend30.filter((p) => p.attempts > 0) as p, _i (_i)}
                <tr><td class="num">{p.date}</td><td class="num">{p.attempts}</td><td class="num">{Math.round(((p.correct ?? 0) / p.attempts) * 100)}%</td></tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    {/if}

    <div class="lv-card lv-section" class:lv-report-section--hidden={reportSection !== "overview"}>
      <b>{t("report.heat")}</b>
      <div class="lv-heat">
        {#each heat as c, _i (_i)}
          <i class={heatColor(c.count)} title="{c.date} · {c.count}"></i>
        {/each}
      </div>
        <div class="lv-row" style="margin:6px 0 0">
        <button class="lv-btn sm lv-btn--ghost" aria-expanded={tableOpen === "heat"} onclick={() => tableOpen = tableOpen === "heat" ? "" : "heat"}><Icon name="table" size={13} /> {t("data.table")}</button>
        <button class="lv-btn sm lv-btn--ghost" onclick={() => downloadChartCsv(heatmapToCsv(heat), "heatmap")}><Icon name="export" size={13} /> CSV</button>
      </div>
      {#if tableOpen === "heat"}
        <div class="lv-row" style="margin:6px 0 0;flex-direction:column;align-items:stretch;gap:2px;max-height:180px;overflow:auto">
          {#if heat.some((c) => c.count > 0)}
            {#each heat.filter((c) => c.count > 0) as c, _i (_i)}
              <span class="lv-muted num">{c.date} · {c.count}</span>
            {/each}
          {:else}<span class="lv-muted" role="status">{t("report.noData")}</span>{/if}
        </div>
      {/if}
    </div>

    <div class="lv-card lv-section" class:lv-report-section--hidden={reportSection !== "knowledge"}>
      <div class="lv-row" style="justify-content:space-between;align-items:center;margin-bottom:var(--lv-space-2)">
        <b>{t("report.mastery")}</b>
        {#if mastery.length >= 3}
          <div class="lv-row" style="gap:var(--lv-space-1);align-items:center">
            <button
              type="button"
              class="lv-chip sm"
              class:acc={masteryTab === "radar"}
              aria-pressed={masteryTab === "radar"}
              onclick={() => masteryTab = "radar"}
              title={t("report.radarTitle")}
            >
              <Icon name="sparkles" size={12} /> {t("report.asChart")}
            </button>
            <button
              type="button"
              class="lv-chip sm"
              class:acc={masteryTab === "list"}
              aria-pressed={masteryTab === "list"}
              onclick={() => masteryTab = "list"}
              title={t("report.asTable")}
            >
              <Icon name="table" size={12} /> {t("report.asTable")}
            </button>
            <button
              type="button"
              class="lv-chip sm"
              onclick={exportRadarCsv}
              title={t("report.exportRadarCsv")}
            >
              <Icon name="export" size={12} /> CSV
            </button>
            <button
              type="button"
              class="lv-chip sm"
              onclick={exportReadinessReport}
              disabled={readinessExportBusy}
              title="导出五维健康度体检雷达与考点盲区清单 Markdown 报告"
            >
              <Icon name="sparkles" size={12} /> {readinessExportBusy ? "…" : t("report.readinessReport")}
            </button>
            <button
              type="button"
              class="lv-chip sm"
              onclick={exportClearanceGuide}
              disabled={graphGuideBusy}
              title="导出考点拓扑图谱与阶段通关路径导学案"
            >
              <Icon name="book" size={12} /> {graphGuideBusy ? "…" : t("report.graphGuide")}
            </button>
            <button
              type="button"
              class="lv-chip sm"
              onclick={exportBadgeWall}
              disabled={badgeWallBusy}
              title="导出个人备考荣誉勋章与成长里程碑手账"
            >
              <Icon name="activity" size={12} /> {badgeWallBusy ? "…" : t("milestone.badgeWall")}
            </button>
          </div>
        {/if}
      </div>
      {#if mastery.length}
        <!-- 39-07：算法与口径标注（启发式估计；非真实 FSRS 卡片状态） -->
        <div class="lv-row lv-muted" style="font-size:var(--lv-font-size-label);margin:2px 0 6px">{t("report.masteryNote")}</div>
      {/if}
      {#if !mastery.length}
        <p class="lv-muted">{t("report.noData")}</p>
      {:else if masteryTab === "radar"}
        {#if radarChart}
          <div class="lv-radar-container" style="display:flex;flex-direction:column;align-items:center;padding:var(--lv-space-3) 0">
            <svg
              viewBox="0 0 320 320"
              style="width:100%;max-width:320px;height:auto;overflow:visible;"
              role="img"
              aria-label={t("report.radarTitle") + " - " + t("report.radarSubtitle")}
            >
              <!-- 1. 同心网格环 -->
              {#each radarChart.rings as ring, ringIdx (ringIdx)}
                <polygon
                  points={ring.pointsString}
                  fill="none"
                  stroke="var(--lv-border)"
                  stroke-width="1"
                  stroke-dasharray="3,3"
                />
              {/each}

              <!-- 2. 同心轴线与文字标签 -->
              {#each radarChart.axes as axis, axisIdx (axisIdx)}
                <line
                  x1={axis.from.x}
                  y1={axis.from.y}
                  x2={axis.to.x}
                  y2={axis.to.y}
                  stroke="var(--lv-border)"
                  stroke-width="1"
                />
                <text
                  x={axis.labelPoint.x}
                  y={axis.labelPoint.y}
                  text-anchor={axis.anchor}
                  font-size="11"
                  fill="var(--lv-text)"
                  font-weight="var(--lv-font-weight-medium)"
                >
                  {axis.label}
                </text>
              {/each}

              <!-- 3. 能力多边形面积 -->
              <polygon
                points={radarChart.polygonPointsString}
                fill="color-mix(in srgb, var(--lv-accent) 22%, transparent)"
                stroke="var(--lv-accent)"
                stroke-width="2"
              />

              <!-- 4. 顶点微圆点徽章 -->
              {#each radarChart.points as pt, idx (idx)}
                {@const dim = radarChart.dimensions[idx]}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r="4"
                  fill="var(--lv-surface)"
                  stroke="var(--lv-accent)"
                  stroke-width="2"
                >
                  <title>{dim ? `${dim.label}: ${dim.score}%` : ""}</title>
                </circle>
              {/each}
            </svg>
            <div class="lv-row lv-muted" style="font-size:var(--lv-font-size-xs);margin-top:var(--lv-space-2);justify-content:center">
              <span>{t("report.radarSubtitle")}</span>
            </div>
          </div>
        {:else}
          <div class="lv-muted" style="padding:var(--lv-space-3) 0;font-size:var(--lv-font-size-sm)">
            {t("report.radarNeedMore")}
          </div>
        {/if}
      {:else}
        {#each mastery.slice(0, 8) as m, _i (_i)}
          <!-- 栅格行：五列定宽对齐，窄屏末列折行到第二行（避免 flex-wrap 造成的悬挂碎片） -->
          <div class="lv-mastery-row">
            <span>{m.root}</span>
            <div class="progress">
              {#if m.mastery < 0}<i style="width:100%;background:var(--lv-border)"></i>
              {:else}<i class:ok={m.mastery >= 0.8} class:mid={m.mastery >= 0.5 && m.mastery < 0.8} class:low={m.mastery < 0.5} style="width:{Math.round(m.mastery * 100)}%"></i>{/if}
            </div>
            <span class="num lv-muted">{m.mastery < 0 ? t("report.insufficient") : Math.round(m.mastery * 100) + "%"}</span>
            <span class="num lv-muted">{m.total} {t("browse.count")}</span>
            <!-- 39-07：独立题/覆盖率（覆盖率 -1=题库无该考点题，不显示） -->
            <span class="num lv-muted" title={t("report.uniqueTip")}>{t("report.uniqueQ")} {m.uniqueQids}{#if m.coverage >= 0} · {t("report.coverage")} {Math.round(m.coverage * 100)}%{/if}</span>
          </div>
        {/each}
      {/if}
    </div>

    {#if weak.length}
      <div class="lv-card lv-section" class:lv-report-section--hidden={reportSection !== "knowledge"}>
        <b>{t("report.weak")}</b>
        {#each weak.slice(0, 5) as w, i (i)}
          <div class="lv-row" style="margin:4px 0">
            <span class="lv-chip lv-chip--red num">{i + 1}</span>
            <span style="flex:1">{w.root}</span>
            <span class="num" style="color:var(--lv-red);font-weight:var(--lv-font-weight-bold)">{Math.round(w.accuracy * 100)}%</span>
            <button class="lv-btn sm" onclick={() => drillWeak(w.root)}>{t("report.drillKp")}</button>
          </div>
        {/each}
      </div>
    {/if}

    {#if calib && (calib.rows.length || calib.unreported)}
      <div class="lv-card lv-section" class:lv-report-section--hidden={reportSection !== "knowledge"}>
        <b>{t("report.calibration")}</b>
        <p class="lv-muted" style="margin:0 0 8px">{t("report.calibrationHint")}</p>
        {#each calib.rows as r, _i (_i)}
          <!-- 44-02：样本门槛 UI——不足 3 题的档位淡化并标注（不参与 spread 但仍如实显示） -->
          <div class="lv-row" style="margin:4px 0" class:low-sample={r.attempts < 3}
            title={r.attempts < 3 ? t("report.lowSampleTip") : ""}>
            <span class="lv-chip num">{t("confidence." + r.confidence)}</span>
            <div class="progress" style="flex:1"><i class:ok={r.accuracy >= 80} class:mid={r.accuracy >= 50 && r.accuracy < 80} class:low={r.accuracy < 50} style="width:{r.accuracy}%"></i></div>
            <span class="num lv-muted" style="width:130px">{r.accuracy}% · {r.attempts} {t("browse.count")}{r.attempts < 3 ? " · " + t("report.lowSample") : ""}</span>
            {#if r.assisted}
              <span class="lv-chip lv-chip--amb num" title={t("report.assistedTip")}><Icon name="bulb" size={11} /> {r.assisted}</span>
            {/if}
          </div>
        {/each}
        {#if calib.rows.some((r) => r.confidence === "sure" && r.accuracy < 80 && r.attempts > 0)}
          <!-- 44-02 lite：确定-错 下钻（低样本不误导，样本门槛沿用校准卡口径） -->
          <button class="lv-btn sm lv-btn--ghost" style="margin-top:4px" onclick={() => cwOpen = !cwOpen}>
            {cwOpen ? "▾" : "▸"} {t("report.cwDrill")}
          </button>
          {#if cwOpen}
            <div class="lv-row" style="margin:6px 0 0;flex-direction:column;align-items:stretch;gap:var(--lv-space-1)">
              {#each cwList as c, _ci (_ci)}
                {@const stem = questionMap.get(c.qid)?.stem}
                <div class="lv-error-row" style="white-space:normal" title={stem ?? c.qid}>
                  <b class="num">✕</b> {stem ? stem.slice(0, 70) : c.qid}
                  {#if c.myAnswer}<span class="lv-muted"> · {t("session.myAnswer")}: {c.myAnswer}</span>{/if}
                  <span class="lv-muted num"> · {new Date(c.ts).toLocaleDateString()}</span>
                </div>
              {:else}
                <span class="lv-muted num">{t("report.cwEmpty")}</span>
              {/each}
            </div>
          {/if}
        {/if}
        {#if calib.rows.some((r) => (r.confidence === "fuzzy" || r.confidence === "guess") && r.accuracy > 0 && r.attempts > 0)}
          <!-- 44-02 lite 对偶：不确定-对 下钻（运气/直觉 vs 真实掌握） -->
          <button class="lv-btn sm lv-btn--ghost" style="margin-top:4px" onclick={() => ucOpen = !ucOpen}>
            {ucOpen ? "▾" : "▸"} {t("report.ucDrill")}
          </button>
          {#if ucOpen}
            <div class="lv-row" style="margin:6px 0 0;flex-direction:column;align-items:stretch;gap:var(--lv-space-1)">
              {#each ucList as u, _ui (_ui)}
                {@const stem = questionMap.get(u.qid)?.stem}
                <div class="lv-row" style="margin:0;white-space:normal" title={stem ?? u.qid}>
                  <span class="lv-chip num">{t("confidence." + u.confidence)}</span>
                  <span style="font-size:var(--lv-font-size-meta)">{stem ? stem.slice(0, 70) : u.qid}</span>
                  <span class="lv-muted num"> · {new Date(u.ts).toLocaleDateString()}</span>
                </div>
              {:else}
                <span class="lv-muted num">{t("report.ucEmpty")}</span>
              {/each}
            </div>
          {/if}
        {/if}
        {#if calib.spread != null}
          <div class="lv-row" style="margin:6px 0 0">
            <span class="lv-chip num" class:acc={calib.spread >= 20}>Δ {t("report.calibSpread")} {calib.spread}%</span>
          </div>
        {/if}
        {#if calib.unreported}
          <p class="lv-muted num" style="margin:6px 0 0">{t("report.calibUnreported").replace("{n}", String(calib.unreported))}</p>
        {/if}
      </div>
    {/if}

    {#if recall && recall.pairs > 0}
      <!-- 39-08 lite：延迟独立回忆（错后隔日首次作答口径；受助单列防虚增留存） -->
      <div class="lv-card lv-section" class:lv-report-section--hidden={reportSection !== "knowledge"}>
        <b>{t("report.recallTitle")}</b>
        <p class="lv-muted" style="margin:0 0 8px;font-size:var(--lv-font-size-caption)">{t("report.recallHint")}</p>
        <div class="lv-row" style="margin:4px 0">
          <span class="lv-chip num">{t("report.recallPairs").replace("{n}", String(recall.pairs))}</span>
          <span class="lv-chip acc num">{t("report.recallIndependent").replace("{n}", String(recall.independentRecall))}</span>
          {#if recall.assistedCorrect}<span class="lv-chip lv-chip--amb num">{t("report.recallAssisted").replace("{n}", String(recall.assistedCorrect))}</span>{/if}
          {#if recall.stillWrong}<span class="lv-chip lv-chip--red num">{t("report.recallWrong").replace("{n}", String(recall.stillWrong))}</span>{/if}
          <span class="lv-chip num">{t("report.recallRate").replace("{n}", String(recall.rate ?? 0))}</span>
        </div>
      </div>
    {/if}

    {#if exposure && exposure.attempts > 0}
      <!-- 52-02/114-01 呈现端：独立/受助/先回忆三口径分栏（互不混算） -->
      <div class="lv-card lv-section" class:lv-report-section--hidden={reportSection !== "evidence"}>
        <b>{t("report.exposureTitle")}</b>
        <p class="lv-muted" style="margin:0 0 8px;font-size:var(--lv-font-size-caption)">{t("report.exposureHint")}</p>
        <div class="lv-row" style="margin:4px 0">
          <span class="lv-chip acc num">{t("report.exposureIndependent").replace("{n}", String(exposure.independent))}</span>
          {#if exposure.assisted}<span class="lv-chip lv-chip--amb num">{t("report.exposureAssisted").replace("{n}", String(exposure.assisted))}</span>{/if}
          {#if exposure.recallFirst}<span class="lv-chip num">{t("report.exposureRecall").replace("{n}", String(exposure.recallFirst))}</span>{/if}
          <span class="lv-chip num">{t("report.exposureTotal").replace("{n}", String(exposure.attempts))}</span>
        </div>
      </div>
    {/if}

    {#if openActionList.length}
      <div class="lv-card lv-section" class:lv-report-section--hidden={reportSection !== "evidence"}>
        <b>{t("action.title")}（{openActionList.length}）</b>
        <p class="lv-muted" style="margin:0 0 8px">{t("action.hint")}</p>
        {#each openActionList.slice(0, 10) as a, _i (_i)}
          <div class="lv-row" style="margin:4px 0">
            <span class="lv-chip num">{t("action.kind." + a.kind)}</span>
            <span style="flex:1;min-width:140px">{a.detail}</span>
            {#if a.qid}<button class="lv-btn sm" disabled={!!actionBusyId} aria-busy={actionBusyId === a.id} onclick={() => redoAction(a)}><Icon name="rotate" size={13} /> {actionBusyId === a.id ? t("action.working", "处理中…") : t("action.kind.redo")}</button>{/if}
            <button class="lv-btn sm" disabled={!!actionBusyId} aria-busy={actionBusyId === a.id} onclick={() => finishAction(a.id)}>{actionBusyId === a.id ? t("action.working", "处理中…") : `✓ ${t("action.doneBtn")}`}</button>
            <button class="lv-btn sm lv-btn--ghost" disabled={!!actionBusyId} aria-busy={actionBusyId === a.id} aria-label={t("action.dismiss")} title={t("action.dismiss")} onclick={() => dropAction(a.id)}>{actionBusyId === a.id ? "…" : "✕"}</button>
          </div>
        {/each}
        {#if openActionList.length > 10}
          <p class="lv-muted num" style="margin:6px 0 0">… +{openActionList.length - 10}</p>
        {/if}
      </div>
    {/if}

    {#if mockHistory.length >= 2}
    <div class="lv-card lv-section" class:lv-report-section--hidden={reportSection !== "evidence"}>
        <b>{t("mock.history")}</b>
        <p class="lv-muted">{t("mock.historyScope", "历史记录可能来自不同题库、卷面或时长，百分比仅供回看，不直接比较进步或能力。")}</p>
        <svg viewBox="0 0 300 110" style="width:100%;max-width:420px;display:block" role="img" aria-label={t("mock.history")}>
          <polyline points={mockHistory.map((h, i) => `${(i / Math.max(1, mockHistory.length - 1)) * 300},${100 - Math.round(h.percent)}`).join(" ")} fill="none" stroke="var(--lv-accent)" stroke-width="2" />
        </svg>
      </div>
    {/if}

    <div class="lv-card lv-section" class:lv-report-section--hidden={reportSection !== "evidence"}>
      <b>{t("report.hourly")}</b>
      <svg viewBox="0 0 300 46" style="width:100%;max-width:420px;display:block" role="img" aria-label={t("report.hourly")}>
        <polyline points={hoursSvg} fill="none" stroke="var(--lv-accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <div class="lv-row" style="margin:4px 0 0">
        <button class="lv-btn sm lv-btn--ghost" aria-expanded={tableOpen === "hourly"} onclick={() => tableOpen = tableOpen === "hourly" ? "" : "hourly"}><Icon name="table" size={13} /> {t("data.table")}</button>
        <button class="lv-btn sm lv-btn--ghost" onclick={() => downloadChartCsv(hourlyToCsv(hours), "hourly")}><Icon name="export" size={13} /> CSV</button>
      </div>
      {#if tableOpen === "hourly"}
        <div class="lv-row" style="margin:6px 0 0;flex-direction:column;align-items:stretch;gap:2px;max-height:180px;overflow:auto">
          {#if hours.some((n) => n > 0)}
            {#each hours.map((n, i) => [i, n] as const).filter(([, n]) => n > 0) as [h, n], _i (_i)}
              <span class="lv-muted num">{String(h).padStart(2, "0")}:00 · {n}</span>
            {/each}
          {:else}<span class="lv-muted" role="status">{t("report.noData")}</span>{/if}
        </div>
      {/if}
      <button class="lv-btn sm" style="margin-top:8px" disabled={reportBusy || reportRefreshing} onclick={writeDaily} title={t("report.dailyScope", "写入当前题库今日作答的战报，与上方日期筛选无关。") }>
        <Icon name="table" size={14} /> {reportBusy ? "…" : t("report.writeDaily")}
      </button>
      <p class="lv-muted lv-daily-report-scope">{t("report.dailyScope", "写入当前题库今日作答的战报，与上方日期筛选无关。")}</p>
      <button class="lv-btn sm lv-btn--ghost" style="margin-top:8px" disabled={diagnosticsBusy} aria-busy={diagnosticsBusy} onclick={exportDiagnostics}>
        <Icon name="activity" size={13} /> {diagnosticsBusy ? t("diag.exporting", "正在生成诊断信息…") : t("diag.export")}
      </button>
      <!-- 69-01/69-06/58-01 lite：存储占用 / 数据体检 / 数据出库 -->
      <button class="lv-btn sm lv-btn--ghost" style="margin-top:8px" disabled={storageBusy} onclick={() => void toggleStorage()}>
        <Icon name="save" size={13} /> {storageBusy ? "…" : storageOpen ? t("data.hideStorage") : t("data.showStorage")}{#if storageRows.length}&nbsp;· {storageTotalKb} KB{/if}
      </button>
      {#if storageOpen}
        {#if storageBusy}
          <p class="lv-muted" role="status" aria-busy="true" style="margin:6px 0 0">{t("data.storageLoading", "正在读取插件存储占用…")}</p>
        {:else if storageError}
          <div class="lv-error" role="alert" style="margin:6px 0 0;overflow-wrap:anywhere">
            <span>{t("data.storageReadError", "读取存储占用失败")}: {storageError}</span>
            <button class="lv-btn sm lv-btn--ghost" style="margin-left:8px" disabled={storageBusy} onclick={() => void loadStorage()}>
              <Icon name="rotate" size={13} /> {storageBusy ? "…" : t("data.auditRetry", "重试")}
            </button>
          </div>
        {:else if storageRows.length}
          <div class="lv-row" style="margin:6px 0 0">
            {#each storageRows as r, _i (_i)}
              <span class="lv-chip num" class:lv-chip--amb={!r.present} class:lv-chip--red={!!r.error} title={r.error ? `${r.key}: ${r.error}` : r.key}>{r.key} · {r.error ? t("data.storageUnknown", "读取失败") : `${Math.round(r.bytes / 1024 * 10) / 10}K`}</span>
            {/each}
          </div>
        {:else}
          <div class="lv-empty" role="status" style="margin-top:6px;padding:12px">
            <div class="lv-empty-icon"><Icon name="save" size={18} /></div>
            <span>{t("data.storageEmpty", "没有可显示的存储记录")}</span>
            <button class="lv-btn sm lv-btn--ghost" style="margin-top:6px" disabled={storageBusy} onclick={() => void loadStorage()}>
              <Icon name="rotate" size={13} /> {t("data.auditRetry", "重新读取")}
            </button>
          </div>
        {/if}
        <div class="lv-muted" style="margin-top:4px;font-size:var(--lv-font-size-caption)">{t("data.storageNote")}</div>
      {/if}
      <button class="lv-btn sm lv-btn--ghost" style="margin-top:8px" disabled={auditBusy} onclick={() => void runDataAudit()}>
        {auditBusy ? "…" : t("data.audit")}
      </button>
      {#if auditBusy}
        <p class="lv-muted" role="status" aria-busy="true" style="margin:6px 0 0">{t("data.auditLoading", "正在扫描题库与作答流水…")}</p>
      {:else if auditError}
        <div class="lv-error" role="alert" style="margin:6px 0 0;overflow-wrap:anywhere">
          <span>{t("data.auditReadError", "数据体检失败")}: {auditError}</span>
          <button class="lv-btn sm lv-btn--ghost" style="margin-left:8px" disabled={auditBusy} onclick={() => void runDataAudit()}>
            <Icon name="rotate" size={13} /> {t("data.auditRetry", "重试")}
          </button>
        </div>
      {/if}
      {#if auditSkippedBanks > 0 && !auditBusy && !auditError}
        <div class="lv-error" role="alert" style="margin:6px 0 0;overflow-wrap:anywhere">
          <span>{t("data.auditPartial", "有 {n} 个题库读取失败，本次体检结果不完整。请重试。").replace("{n}", String(auditSkippedBanks))}</span>
          <button class="lv-btn sm lv-btn--ghost" style="margin-left:8px" disabled={auditBusy} onclick={() => void runDataAudit()}>
            <Icon name="rotate" size={13} /> {t("data.auditRetry", "重试")}
          </button>
        </div>
      {/if}
      {#if auditResult}
        <div class="lv-row" style="margin:6px 0 0" role="status">
          <span class="lv-chip num">{t("data.auditEvents").replace("{n}", String(auditResult.events))}</span>
          {#if auditResult.problemCount === 0}
            <span class="lv-chip acc">✓ {t("data.auditClean")}</span>
          {:else}
            {#if auditResult.duplicateEids}<span class="lv-chip lv-chip--red num">{t("data.auditDup").replace("{n}", String(auditResult.duplicateEids))}</span>{/if}
            {#if auditResult.badEvents}<span class="lv-chip lv-chip--red num">{t("data.auditBad").replace("{n}", String(auditResult.badEvents))}</span>{/if}
            {#if auditResult.futureEvents}<span class="lv-chip lv-chip--amb num">{t("data.auditFuture").replace("{n}", String(auditResult.futureEvents))}</span>{/if}
          {/if}
          {#if auditResult.orphanEvents}<span class="lv-chip num" title={t("data.auditOrphanTip")}>{t("data.auditOrphan").replace("{n}", String(auditResult.orphanEvents))}</span>{/if}
        </div>
      {/if}
      <button class="lv-btn sm lv-btn--ghost" style="margin-top:8px" disabled={exportBusy} onclick={() => void exportAllData()}>
        <Icon name="export" size={14} /> {t("data.export")}
      </button>
      <button class="lv-btn sm" style="margin-top:8px" disabled={purgeBusy} onclick={() => void purgeAllData()}>
        {purgeBusy ? "…" : t("data.purge")}
      </button>
      {#if purgeReceipts.length}
        <!-- 58-03/U30：逐对象回执（不冒充全部删除）；重载思源后内存态归零 -->
        <div class="lv-row" style="margin:6px 0 0" role="status">
          {#each purgeReceipts as r, _i (_i)}
            <span class="lv-chip num" class:lv-chip--red={!r.ok} title={r.key}>{r.key} {r.ok ? "✓" : "✕"}</span>
          {/each}
        </div>
        <div class="lv-muted" style="margin-top:4px;font-size:var(--lv-font-size-caption)">{t("data.purgeNote")}</div>
      {/if}
    </div>
  {/if}
</div>
  </div>
  <Palette commands={paletteCommands} bind:open={paletteOpen} {t} />
</div>
</div>

<style>
  .lv-pad { padding: var(--lv-space-4) 22px var(--lv-space-9); overflow: auto; }
  .lv-report-tabs { display: flex; gap: var(--lv-space-2); margin: var(--lv-space-3) 0 var(--lv-space-3); padding: var(--lv-space-1); border: 1px solid var(--lv-border); border-radius: var(--lv-r-1); background: var(--lv-surface-2); width: fit-content; max-width: 100%; overflow-x: auto; }
  .lv-report-tab { min-height: var(--lv-control-height-sm); padding: 6px var(--lv-space-3); border: 0; border-radius: var(--lv-r-1); color: var(--lv-text-3); background: transparent; font-size: var(--lv-font-size-meta); font-weight: 600; white-space: nowrap; cursor: pointer; transition: background-color var(--lv-duration-micro) var(--lv-ease-out), color var(--lv-duration-micro) var(--lv-ease-out); }
  .lv-report-tab:hover { color: var(--lv-text); background: color-mix(in srgb, var(--lv-accent-soft) 60%, transparent); }
  .lv-report-tab.active { color: var(--lv-accent); background: var(--lv-surface); box-shadow: var(--lv-sh-1); }
  .lv-report-section--hidden { display: none !important; }
  .lv-report-overview-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--lv-space-3); align-items: stretch; margin-bottom: 12px; }
  .lv-report-overview-grid.has-both { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .lv-report-overview-grid > .lv-card { margin-bottom: 0; }
  .lv-report-next { display: flex; align-items: center; justify-content: space-between; gap: var(--lv-space-4); padding: 16px 20px; border-left: 3.5px solid var(--lv-accent); border-color: color-mix(in srgb, var(--lv-accent) 26%, var(--lv-border)); background: color-mix(in srgb, var(--lv-accent-soft) 55%, var(--lv-surface)); box-shadow: var(--lv-sh-1), var(--lv-inset-highlight, inset 0 1px 0 transparent); }
  .lv-report-next b { display: block; margin-top: 3px; font-size: var(--lv-font-size-h3); }
  .lv-report-next p { margin: 4px 0 0; }
  .lv-daily-report-scope { max-width: 480px; margin: 4px 0 10px; }
  .lv-report-week-scope { margin: 0 0 8px; font-size: var(--lv-font-size-caption); line-height: 1.5; }
  @container lv-exam (max-width: 960px) { .lv-report-overview-grid.has-both { grid-template-columns: minmax(0, 1fr); } }
  @container lv-exam (max-width: 600px) { .lv-report-tabs { width: 100%; } .lv-report-tab { flex: 1 0 auto; } .lv-report-next { align-items: flex-start; flex-direction: column; } .lv-quad-grid { grid-template-columns: minmax(0, 1fr); } }
  /* .lv-btn/.lv-select 外观基线上收 lv-base.scss（修复暗色露 UA 白底） */
  .lv-card-title { display: inline-flex; align-items: center; gap: var(--lv-space-compact); }
  .lv-inline-icon { display: inline-flex; margin-right: 5px; }
  .lv-card { background: var(--lv-surface); border: 1px solid var(--lv-border-subtle, var(--lv-border)); border-radius: var(--lv-r-3); padding: var(--lv-space-5) 22px; box-shadow: var(--lv-sh-card, var(--lv-sh-1)), var(--lv-inset-highlight, inset 0 1px 0 transparent); transition: box-shadow var(--lv-dur-view) var(--lv-ease-out), transform var(--lv-dur-micro) var(--lv-ease-out), border-color var(--lv-dur-micro) var(--lv-ease-out); margin-bottom: var(--lv-space-3); }
  .lv-kpi { display: flex; flex-direction: column; justify-content: space-between; gap: var(--lv-space-2); transition: transform var(--lv-dur-micro) var(--lv-ease-out), box-shadow var(--lv-dur-micro) var(--lv-ease-out), border-color var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-kpi:hover { transform: translateY(-2px); border-color: var(--lv-border-hover, var(--lv-accent)); box-shadow: var(--lv-sh-2); }
  .lv-kpi .v { font-size: 28px; font-weight: var(--lv-font-weight-bold); letter-spacing: -0.025em; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .lv-kpi .l { display: flex; align-items: center; justify-content: space-between; color: var(--lv-text-3); font-size: var(--lv-font-size-caption); font-weight: var(--lv-font-weight-medium); }
  .lv-row.low-sample { opacity: .55; }
  .lv-section b { display: block; font-size: var(--lv-font-size-h3); font-weight: var(--lv-font-weight-semibold); letter-spacing: -.2px; margin-bottom: 12px; }
  .lv-chip { display: inline-flex; align-items: center; gap: var(--lv-space-1); padding: 3px var(--lv-space-3); border-radius: var(--lv-r-1); font-size: var(--lv-font-size-sm); font-weight: var(--lv-font-weight-medium); color: var(--lv-text-2); background: var(--lv-surface-2); border: 1px solid transparent; }
  .lv-chip.acc { color: var(--lv-accent); background: var(--lv-accent-soft); }
  .lv-chip.lv-chip--red { color: var(--lv-red); background: var(--lv-red-soft); }
  /* —— 63-01 四象限（现代微质感指标卡） —— */
  .lv-quad-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--lv-space-3); }
  .lv-quad { border: 1px solid var(--lv-border-subtle, var(--lv-border)); border-radius: var(--lv-r-2); padding: 16px 18px; background: var(--lv-surface); box-shadow: var(--lv-sh-1), var(--lv-inset-subtle, inset 0 1px 0 transparent); display: flex; flex-direction: column; gap: var(--lv-space-2); transition: transform var(--lv-dur-micro) var(--lv-ease-out), box-shadow var(--lv-dur-micro) var(--lv-ease-out); }
  .lv-quad:hover { transform: translateY(-2px); box-shadow: var(--lv-sh-2); }
  .lv-quad .v { font-size: 26px; font-weight: var(--lv-font-weight-bold); letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .lv-quad .l { font-size: var(--lv-font-size-caption); color: var(--lv-text-3); font-weight: var(--lv-font-weight-medium); }
  .lv-quad--grn { background: color-mix(in srgb, var(--lv-green-soft) 55%, var(--lv-surface)); border-color: color-mix(in srgb, var(--lv-green) 24%, var(--lv-border)); } .lv-quad--grn .v { color: var(--lv-green); }
  .lv-quad--red { background: color-mix(in srgb, var(--lv-red-soft) 55%, var(--lv-surface)); border-color: color-mix(in srgb, var(--lv-red) 24%, var(--lv-border)); } .lv-quad--red .v { color: var(--lv-red); }
  .lv-quad--amb { background: color-mix(in srgb, var(--lv-amber-soft) 55%, var(--lv-surface)); border-color: color-mix(in srgb, var(--lv-amber) 24%, var(--lv-border)); } .lv-quad--amb .v { color: var(--lv-amber); }
  @container lv-exam (max-width: 960px) { .lv-quad-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .lv-heat { display: grid; grid-template-columns: repeat(53, 1fr); gap: 2.5px; }
  /* 空格子 = 卡片上的轻微抬升（border 混合），暗色不再呈黑洞；有值格子在抬升底上叠主色 */
  .lv-heat i { aspect-ratio: 1; border-radius: 3px; background: color-mix(in srgb, var(--lv-border) 45%, var(--lv-surface)); transition: transform var(--lv-dur-micro) var(--lv-ease-out), filter var(--lv-dur-micro) var(--lv-ease-out), box-shadow var(--lv-dur-micro) var(--lv-ease-out); position: relative; }
  .lv-heat i:hover { transform: scale(1.45); filter: brightness(1.2); z-index: 3; box-shadow: 0 0 6px color-mix(in srgb, var(--lv-accent) 45%, transparent); cursor: pointer; }
  .lv-heat i.l1 { background: color-mix(in srgb, var(--lv-accent) 26%, color-mix(in srgb, var(--lv-border) 45%, var(--lv-surface))); }
  .lv-heat i.l2 { background: color-mix(in srgb, var(--lv-accent) 48%, color-mix(in srgb, var(--lv-border) 45%, var(--lv-surface))); }
  .lv-heat i.l3 { background: color-mix(in srgb, var(--lv-accent) 72%, color-mix(in srgb, var(--lv-border) 45%, var(--lv-surface))); }
  .lv-heat i.l4 { background: var(--lv-accent); box-shadow: 0 1px 3px color-mix(in srgb, var(--lv-accent) 40%, transparent); }
  .progress { height: 7px; border-radius: var(--lv-radius-pill); background: var(--lv-surface-2); box-shadow: inset 0 1px 2px color-mix(in srgb, var(--lv-text) 10%, transparent); overflow: hidden; }
  .progress i { display: block; height: 100%; border-radius: var(--lv-radius-pill); background: var(--lv-accent-grad); }
  .progress i.ok { background: var(--lv-green); }
  .progress i.mid { background: var(--lv-amber); }
  .progress i.low { background: var(--lv-red); }
  /* —— 考点掌握度行：五列栅格（考点/条/掌握度/题数/独立题·覆盖），窄屏末列折行 —— */
  .lv-mastery-row { display: grid; grid-template-columns: 88px minmax(0, 1fr) 52px 64px minmax(0, 150px); gap: var(--lv-space-relaxed); align-items: center; margin: 8px 0; font-size: var(--lv-font-size-meta); }
  .lv-mastery-row > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @container lv-exam (max-width: 720px) {
    .lv-mastery-row { grid-template-columns: 72px minmax(0, 1fr) 48px; }
    .lv-mastery-row > span:last-child { grid-column: 2 / -1; }
  }
  .lv-error { margin: 8px 0; padding: 10px 14px; border-radius: var(--lv-r-2); background: var(--lv-red-soft); color: var(--lv-red); font-size: var(--lv-font-size-body-compact); }
  .lv-skeleton { height: 160px; border-radius: var(--lv-r-3); background: linear-gradient(100deg, var(--lv-surface-2) 40%, var(--lv-surface) 50%, var(--lv-surface-2) 60%); background-size: 200% 100%; animation: lv-shim 1.4s infinite; }
  @keyframes lv-shim { to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { .lv-skeleton { animation: none; } }
</style>
