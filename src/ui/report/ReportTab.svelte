<script lang="ts">
    // 报告中心（S8 lite）：KPI / 热力图 / 考点掌握度 / 薄弱 Top10 / 时段分布
    // 数据全部来自流水重算（可离线）；聚合逻辑见 src/core/report.ts
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import { weeklyAggregates, weekCompare, dailyTrend } from "@/core/weekly";
    import type { ExamApp } from "../../app";
    import { heatmap, masteryByKp, weakTop, hourly, calibration, type CalibrationReport } from "@/core/report";
    import type { ActionItem } from "@/core/actions";
    import SaveStatus from "../shared/SaveStatus.svelte";

    let { plugin, examApp: app }: { plugin: any; examApp: ExamApp | null } = $props();
    const i18n = $derived(plugin?.i18n ?? {});
    const t = (k: string, fb = "") => i18n[k] ?? fb;

    let loading = $state(true);
    let questions = $state<any[]>([]);
    let kpi = $state({ attempts: 0, accuracy: 0, eliminated: 0, streak: 0 });
    let heat = $state<{ date: string; count: number }[]>([]);
    let mastery = $state<ReturnType<typeof masteryByKp>>([]);
    let weak = $state<ReturnType<typeof weakTop>>([]);
    let hours = $state<number[]>(new Array(24).fill(0));
    let mockHistory = $state<any[]>([]);
    let calib = $state<CalibrationReport | null>(null);
    let openActionList = $state<ActionItem[]>([]);
    let trend30 = $state<{ date: string; attempts: number }[]>([]);
    let errorMsg = $state("");
    let weekCmp = $state<ReturnType<typeof weekCompare> | null>(null);
    let reportBusy = $state(false);

    /** 每日战报写入思源日记（联动小驴复盘预留通道） */
    async function writeDaily() {
      if (!app || reportBusy) return;
      reportBusy = true;
      try {
        const banks = app.listBanks();
        if (!banks.length) throw new Error(t("guard.needBankFirst"));
        await app.writeDailyReport(banks[0].id, banks[0].name);
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
      if (localStorage.getItem(K) === wk) return;
      const d = app.derived();
      // effect 内一次性临时量（非组件状态），不转 SvelteDate
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const lastMonday = new Date(now);
      lastMonday.setDate(now.getDate() - 7);
      const k2 = `${lastMonday.getFullYear()}-${String(lastMonday.getMonth() + 1).padStart(2, "0")}-${String(lastMonday.getDate()).padStart(2, "0")}`;
      if ([...d.days.keys()].some((k) => k.startsWith(k2.slice(0, 7)))) {
        localStorage.setItem(K, wk);
        weeklyNudged = true;
        showMessage(t("report.weeklyNudge"), 5200, "info");
      }
    });

    onMount(async () => {
      if (!app) { loading = false; errorMsg = t("state.appNotReady"); return; }
      try {
        const d = app.derived();
        weekCmp = weekCompare(weeklyAggregates(d.days, new Date(), 2));
        let attempts = 0, correct = 0;
        for (const s of d.byQuestion.values()) { attempts += s.attempts; correct += s.correct; }
        const { streak } = await import("@/core/replayer");
        kpi = { attempts, accuracy: attempts ? Math.round((correct / attempts) * 100) : 0, eliminated: [...d.wrongbook.values()].filter((w) => w.status === "eliminated").length, streak: streak(d) };
        heat = heatmap(d.days);
        hours = hourly(app.attempts.all());
        calib = calibration(app.attempts.all());
        trend30 = dailyTrend(d.days);
        openActionList = await app.listOpenActions();
        bankOptions = app.listBanks();
        bankId = bankOptions[0]?.id ?? "";
        mockHistory = await app.listMockResults();
        await reloadBankScope(d);
      } catch (e) {
        errorMsg = String(e instanceof Error ? e.message : e);
      } finally { loading = false; }
    });

    // ---------- 题库范围（39-06/U21 lite）：掌握度/薄弱/下钻按所选题库聚合；KPI/热力图为全局口径 ----------
    let bankOptions = $state<{ id: string; name: string }[]>([]);
    let bankId = $state("");
    let scopeLoading = $state(false);

    async function reloadBankScope(d = app?.derived()) {
      if (!app || !d || !bankId) { questions = []; mastery = []; weak = []; return; }
      scopeLoading = true;
      try {
        questions = await app.listQuestions(bankId);
        mastery = masteryByKp(questions, d.byQuestion, app.attempts.all());
        weak = weakTop(mastery);
      } finally { scopeLoading = false; }
    }

    async function onBankChange() {
      await reloadBankScope();
    }

    /** 薄弱考点一键组卷：按考点首段过滤 → pendingPractice 移交练习台 */
    function drillWeak(root: string) {
      if (!app) return;
      const picked = questions.filter((q) => q.type !== "material" && q.kp?.split("/")[0] === root);
      if (!picked.length) { showMessage(t("state.emptyBank"), 3000, "error"); return; }
      (plugin as any).pendingPractice = picked;
      void import("siyuan").then(({ openTab }) => {
        openTab({ app: (plugin as any).app ?? (plugin as any), custom: { id: "exam-practice", icon: "iconExam", title: t("tab.practice"), data: { plugin, examApp: app } } } as any);
      });
    }

    /** 下一行动（U15 lite）：完成=用户确认（最小证据）；取消保留记录可回看 */
    async function finishAction(id: string) {
      if (!app) return;
      await app.completeAction(id);
      openActionList = await app.listOpenActions();
    }
    async function dropAction(id: string) {
      if (!app) return;
      await app.cancelAction(id);
      openActionList = await app.listOpenActions();
    }

    /** 行动重练（82-04 lite）：单题错题会话 + 完成并记证据 redo-drill；仅当前题库可定位 */
    async function redoAction(a: ActionItem) {
      if (!app || !a.qid) return;
      const q = questions.find((x) => x.id === a.qid);
      if (!q) { showMessage(t("action.redoMissing"), 3400, "info"); return; }
      try {
        const bank = app.listBanks()[0];
        await app.startSession([q], "wrong", bank?.id);
        await app.completeAction(a.id, "redo-drill");
        openActionList = await app.listOpenActions();
        void import("siyuan").then(({ openTab }) => {
          openTab({ app: (plugin as any).app ?? (plugin as any), custom: { id: "exam-practice", icon: "iconExam", title: t("tab.practice"), data: { plugin, examApp: app } } } as any);
        });
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      }
    }

    /** 诊断信息导出（7A/46-06 lite）：脱敏 JSON → 剪贴板；不含题干/key/路径/个人内容 */
    async function exportDiagnostics() {
      if (!app) return;
      try {
        const d = app.derived();
        const usage = await app.aiUsage();
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
        };
        await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
        showMessage(t("diag.copied"), 3800, "info");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      }
    }

    const heatColor = (n: number) => n === 0 ? "var(--lv-surface-2)" : n < 5 ? "l1" : n < 15 ? "l2" : n < 30 ? "l3" : "l4";
    const maxHour = $derived(Math.max(1, ...hours));
    const hoursSvg = $derived(hours.map((n, i) => `${(i / 23) * 300},${40 - Math.round((n / maxHour) * 36)}`).join(" "));
    const maxTrend = $derived(Math.max(1, ...trend30.map((p) => p.attempts)));
</script>

<div class="fn__flex-1 lv-pad">
  <div class="block__icons">
    <div class="block__logo">
      <svg class="block__logoicon"><use xlink:href="#iconReport"></use></svg>
      {t("tab.report")}
    </div>
    {#if app}<SaveStatus gate={app.saves} {t} />{/if}
    {#if bankOptions.length > 1}
      <select class="lv-select" style="max-width:200px" bind:value={bankId} disabled={scopeLoading} onchange={onBankChange}>
        {#each bankOptions as b, _i (_i)}<option value={b.id}>{b.name}</option>{/each}
      </select>
      <span class="lv-muted" style="font-size:11.5px">{t("report.scopeHint")}</span>
    {/if}
    <span class="fn__flex-1"></span>
    <span class="lv-chip">{t("report.dataFromLog")}</span>
  </div>

  {#if loading}
    <div class="lv-skeleton"></div>
  {:else if errorMsg}
    <div class="lv-error">{errorMsg}</div>
  {:else}
    <p class="lv-muted" style="margin:0 0 8px;font-size:11.5px">{t("report.scopeAll")}</p>
    <div class="lv-kpis">
      <div class="lv-card lv-kpi"><div class="l">⚡ {t("report.attempts")}</div><div class="v num">{kpi.attempts}</div></div>
      <div class="lv-card lv-kpi"><div class="l">◎ {t("report.accuracy")}</div><div class="v num">{kpi.accuracy}%</div></div>
      <div class="lv-card lv-kpi"><div class="l">❌ {t("report.eliminated")}</div><div class="v num">{kpi.eliminated}</div></div>
      <div class="lv-card lv-kpi"><div class="l">🔥 {t("report.streak")}</div><div class="v num">{kpi.streak} {t("entry.days")}</div></div>
    </div>

    {#if weekCmp}
      <div class="lv-card lv-section" style="margin-bottom:12px">
        <b>{t("report.weekCompare")}</b>
        <div class="lv-row" style="margin:4px 0">
          <span class="lv-chip">{t("report.thisWeek")} <b class="num">{weekCmp.thisWeek.attempts}</b> {t("browse.count")}</span>
          <span class="lv-chip">{t("report.lastWeek")} <b class="num">{weekCmp.lastWeek.attempts}</b> {t("browse.count")}</span>
          {#if weekCmp.thisWeek.attempts >= weekCmp.lastWeek.attempts}
            <span class="lv-chip lv-chip--grn">↑</span>
          {:else}
            <span class="lv-chip lv-chip--red">↓</span>
          {/if}
        </div>
      </div>
    {/if}

    {#if trend30.some((p) => p.attempts > 0)}
      <div class="lv-card lv-section" style="margin-bottom:12px">
        <b>{t("report.trend30")}</b>
        <svg viewBox="0 0 300 46" style="width:100%;max-width:420px;display:block" role="img" aria-label={t("report.trend30")}>
          <polyline points={trend30.map((p, i) => `${(i / 29) * 300},${42 - Math.round((p.attempts / maxTrend) * 38)}`).join(" ")} fill="none" stroke="var(--lv-accent)" stroke-width="2" />
        </svg>
        <div class="lv-row" style="margin:4px 0 0">
          <span class="lv-chip num">{t("report.trendMax")} {maxTrend}</span>
          <span class="lv-chip num">{t("report.trendSum")} {trend30.reduce((n, p) => n + p.attempts, 0)}</span>
        </div>
      </div>
    {/if}

    <div class="lv-card lv-section">
      <b>{t("report.heat")}</b>
      <div class="lv-heat">
        {#each heat as c, _i (_i)}
          <i class={heatColor(c.count)} title="{c.date} · {c.count}"></i>
        {/each}
      </div>
    </div>

    <div class="lv-card lv-section">
      <b>{t("report.mastery")}</b>
      {#if !mastery.length}
        <p class="lv-muted">{t("report.noData")}</p>
      {:else}
        {#each mastery.slice(0, 8) as m, _i (_i)}
          <div class="lv-row" style="margin:4px 0">
            <span style="width:80px">{m.root}</span>
            <div class="progress" style="flex:1">
              {#if m.mastery < 0}<i style="width:100%;background:var(--lv-border)"></i>
              {:else}<i class:ok={m.mastery >= 0.8} class:mid={m.mastery >= 0.5 && m.mastery < 0.8} class:low={m.mastery < 0.5} style="width:{Math.round(m.mastery * 100)}%"></i>{/if}
            </div>
            <span class="num lv-muted">{m.mastery < 0 ? t("report.insufficient") : Math.round(m.mastery * 100) + "%"}</span>
            <span class="num lv-muted" style="width:56px">{m.total} {t("browse.count")}</span>
          </div>
        {/each}
      {/if}
    </div>

    {#if weak.length}
      <div class="lv-card lv-section">
        <b>{t("report.weak")}</b>
        {#each weak.slice(0, 5) as w, i (i)}
          <div class="lv-row" style="margin:4px 0">
            <span class="lv-chip lv-chip--red num">{i + 1}</span>
            <span style="flex:1">{w.root}</span>
            <span class="num" style="color:var(--lv-red);font-weight:700">{Math.round(w.accuracy * 100)}%</span>
            <button class="lv-btn sm" onclick={() => drillWeak(w.root)}>{t("report.drillKp")}</button>
          </div>
        {/each}
      </div>
    {/if}

    {#if calib && (calib.rows.length || calib.unreported)}
      <div class="lv-card lv-section">
        <b>{t("report.calibration")}</b>
        <p class="lv-muted" style="margin:0 0 8px">{t("report.calibrationHint")}</p>
        {#each calib.rows as r, _i (_i)}
          <div class="lv-row" style="margin:4px 0">
            <span class="lv-chip num">{t("confidence." + r.confidence)}</span>
            <div class="progress" style="flex:1"><i class:ok={r.accuracy >= 80} class:mid={r.accuracy >= 50 && r.accuracy < 80} class:low={r.accuracy < 50} style="width:{r.accuracy}%"></i></div>
            <span class="num lv-muted" style="width:90px">{r.accuracy}% · {r.attempts} {t("browse.count")}</span>
          </div>
        {/each}
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

    {#if openActionList.length}
      <div class="lv-card lv-section">
        <b>{t("action.title")}（{openActionList.length}）</b>
        <p class="lv-muted" style="margin:0 0 8px">{t("action.hint")}</p>
        {#each openActionList.slice(0, 10) as a, _i (_i)}
          <div class="lv-row" style="margin:4px 0">
            <span class="lv-chip num">{t("action.kind." + a.kind)}</span>
            <span style="flex:1;min-width:140px">{a.detail}</span>
            {#if a.qid}<button class="lv-btn sm" onclick={() => redoAction(a)}>🔁 {t("action.kind.redo")}</button>{/if}
            <button class="lv-btn sm" onclick={() => finishAction(a.id)}>✓ {t("action.doneBtn")}</button>
            <button class="lv-btn sm lv-btn--ghost" onclick={() => dropAction(a.id)}>✕</button>
          </div>
        {/each}
        {#if openActionList.length > 10}
          <p class="lv-muted num" style="margin:6px 0 0">… +{openActionList.length - 10}</p>
        {/if}
      </div>
    {/if}

    {#if mockHistory.length >= 2}
      <div class="lv-card lv-section">
        <b>{t("mock.history")}</b>
        <svg viewBox="0 0 300 110" style="width:100%;max-width:420px;display:block">
          <polyline points={mockHistory.map((h, i) => `${(i / Math.max(1, mockHistory.length - 1)) * 300},${100 - Math.round(h.percent)}`).join(" ")} fill="none" stroke="var(--lv-accent)" stroke-width="2" />
        </svg>
      </div>
    {/if}

    <div class="lv-card lv-section">
      <b>{t("report.hourly")}</b>
      <svg viewBox="0 0 300 46" style="width:100%;max-width:420px;display:block">
        <polyline points={hoursSvg} fill="none" stroke="var(--lv-accent)" stroke-width="2" />
      </svg>
      <button class="lv-btn sm" style="margin-top:8px" disabled={reportBusy} onclick={writeDaily}>
        📄 {reportBusy ? "…" : t("report.writeDaily")}
      </button>
      <button class="lv-btn sm lv-btn--ghost" style="margin-top:8px" onclick={exportDiagnostics}>
        🩰 {t("diag.export")}
      </button>
    </div>
  {/if}
</div>

<style>
  .lv-pad { padding: 12px 16px; overflow: auto; }
  .lv-muted { color: var(--lv-text-3); font-size: 12.5px; }
  .lv-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
  .lv-select { padding: 4px 10px; border-radius: 9px; border: 1px solid var(--lv-border); background: var(--lv-surface); color: var(--lv-text); font: inherit; font-size: 12.5px; }
  .lv-card { background: var(--lv-surface); border: 1px solid var(--lv-border); border-radius: var(--lv-r-3); padding: 16px 18px; box-shadow: var(--lv-sh-1); margin-bottom: 12px; }
  .lv-section b { display: block; font-size: 13px; margin-bottom: 10px; }
  .lv-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 550; color: var(--lv-text-2); background: var(--lv-surface-2); border: 1px solid var(--lv-border); }
  .lv-chip.acc { color: var(--lv-accent); background: var(--lv-accent-soft); border-color: transparent; }
  .lv-chip.lv-chip--red { color: var(--lv-red); background: var(--lv-red-soft); border-color: transparent; }
  .lv-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px; }
  .lv-kpi .l { font-size: 12.5px; color: var(--lv-text-3); margin-bottom: 4px; }
  .lv-kpi .v { font-size: 22px; font-weight: 750; }
  .lv-heat { display: grid; grid-template-columns: repeat(53, 1fr); gap: 2.5px; }
  .lv-heat i { aspect-ratio: 1; border-radius: 2.5px; background: var(--lv-surface-2); }
  .lv-heat i.l1 { background: color-mix(in srgb, var(--lv-accent) 22%, var(--lv-surface-2)); }
  .lv-heat i.l2 { background: color-mix(in srgb, var(--lv-accent) 45%, var(--lv-surface-2)); }
  .lv-heat i.l3 { background: color-mix(in srgb, var(--lv-accent) 70%, var(--lv-surface-2)); }
  .lv-heat i.l4 { background: var(--lv-accent); }
  .progress { height: 6px; border-radius: 999px; background: var(--lv-surface-2); overflow: hidden; }
  .progress i { display: block; height: 100%; border-radius: 999px; background: var(--lv-accent-grad); }
  .progress i.ok { background: var(--lv-green); }
  .progress i.mid { background: var(--lv-amber); }
  .progress i.low { background: var(--lv-red); }
  .lv-error { margin: 8px 0; padding: 10px 14px; border-radius: var(--lv-r-2); background: var(--lv-red-soft); color: var(--lv-red); font-size: 13px; }
  .lv-skeleton { height: 160px; border-radius: var(--lv-r-3); background: linear-gradient(100deg, var(--lv-surface-2) 40%, var(--lv-surface) 50%, var(--lv-surface-2) 60%); background-size: 200% 100%; animation: lv-shim 1.4s infinite; }
  @keyframes lv-shim { to { background-position: -200% 0; } }
  @media (max-width: 960px) { .lv-kpis { grid-template-columns: repeat(2, 1fr); } }
  @media (prefers-reduced-motion: reduce) { .lv-skeleton { animation: none; } }
</style>
