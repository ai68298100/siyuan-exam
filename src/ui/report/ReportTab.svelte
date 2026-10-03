<script lang="ts">
    // 报告中心（S8 lite）：KPI / 热力图 / 考点掌握度 / 薄弱 Top10 / 时段分布
    // 数据全部来自流水重算（可离线）；聚合逻辑见 src/core/report.ts
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import { weeklyAggregates, weekCompare, dailyTrend } from "@/core/weekly";
    import type { ExamApp } from "../../app";
    import { heatmap, masteryByKp, weakTop, hourly, calibration, confidentWrongList, uncertainCorrectList, delayedRecall, type CalibrationReport } from "@/core/report";
    import { trendToCsv, heatmapToCsv, hourlyToCsv } from "@/core/exportMd";
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

    /** 39-06 lite：统计日期范围（0=全部）。口径：作答量/正确率/时段/校准按范围过滤；
     *  消灭错题与连续天数为状态类指标保持全局；掌握度按题库范围（reloadBankScope） */
    let rangeDays = $state(0);
    function computeReport() {
      if (!app) return;
      const d = app.derived();
      const cutoff = rangeDays > 0 ? Date.now() - rangeDays * 86_400_000 : 0;
      const events = app.attempts.all().filter((e) => !cutoff || e.ts >= cutoff);
      let attempts = 0, correct = 0;
      for (const e of events) {
        if (e.verdict === "not_attempted") continue;
        attempts++;
        if (e.verdict === "correct") correct++;
      }
      kpi = { ...kpi, attempts, accuracy: attempts ? Math.round((correct / attempts) * 100) : 0 };
      hours = hourly(events);
      calib = calibration(events);
      const cutoffDate = cutoff ? new Date(cutoff).toISOString().slice(0, 10) : "";
      trend30 = cutoff ? dailyTrend(d.days).filter((p) => p.date >= cutoffDate) : dailyTrend(d.days);
    }

    onMount(async () => {
      if (!app) { loading = false; errorMsg = t("state.appNotReady"); return; }
      try {
        const d = app.derived();
        weekCmp = weekCompare(weeklyAggregates(d.days, new Date(), 2));
        const { streak } = await import("@/core/replayer");
        kpi = { attempts: 0, accuracy: 0, eliminated: [...d.wrongbook.values()].filter((w) => w.status === "eliminated").length, streak: streak(d) };
        computeReport();
        heat = heatmap(d.days);
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
      }
    }

    // ---------- 存储占用 / 数据体检 / 数据出库（69-01/69-06/58-01 lite，三十批） ----------
    let storageRows = $state<{ key: string; bytes: number; present: boolean }[]>([]);
    let storageOpen = $state(false);
    const storageTotalKb = $derived(Math.round(storageRows.reduce((s, r) => s + r.bytes, 0) / 1024));
    async function toggleStorage() {
      storageOpen = !storageOpen;
      if (storageOpen && app) storageRows = await app.storageUsage();
    }

    let auditResult = $state<import("@/core/dataAudit").DataAuditReport | null>(null);
    let auditBusy = $state(false);
    async function runDataAudit() {
      if (!app || auditBusy) return;
      auditBusy = true;
      try {
        // 孤儿检测口径：当前所有已加载题库的题目 id（跨库扫描；空题库=跳过孤儿项）
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- 函数内累加器（非组件状态）
        const known = new Set<string>();
        for (const b of app.listBanks()) {
          try {
            for (const q of await app.listQuestions(b.id)) known.add(q.id);
          } catch { /* 单库读取失败跳过 */ }
        }
        auditResult = app.auditData(known);
      } finally { auditBusy = false; }
    }

    async function exportAllData() {
      if (!app) return;
      try {
        const json = await app.exportAllData();
        const blob = new Blob([json], { type: "application/json;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `小驴考试-数据出库 ${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        showMessage(t("data.exportDone"), 3200, "info");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      }
    }

    /** 清除插件数据（58-03 lite）：双确认 → 逐键置空 → 逐对象回执。
     *  范围：题库注册表/流水/错题处置/错因/行动/模考记录/AI 队列/映射/视图/草稿等插件存储；
     *  不动：思源笔记本与题目块本体、AI Key（宿主密钥库）、已外发数据（无法撤回）。 */
    let purgeReceipts = $state<{ key: string; ok: boolean }[]>([]);
    let purgeBusy = $state(false);
    async function purgeAllData() {
      if (!app || purgeBusy) return;
      const { confirmDialogSync } = await import("../../libs/dialog");
      if (!(await confirmDialogSync({ title: t("data.purgeTitle"), content: t("data.purgeScope") }))) return;
      // 第二次确认：不可撤销（建议先「数据出库」备份）
      if (!(await confirmDialogSync({ title: t("data.purgeTitle"), content: t("data.purgeFinal") }))) return;
      purgeBusy = true;
      try {
        purgeReceipts = await app.purgeAllData();
        const failed = purgeReceipts.filter((r) => !r.ok).length;
        showMessage(failed ? t("data.purgePartial").replace("{f}", String(failed)) : t("data.purgeDone"), 5600, failed ? "error" : "info");
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
      } finally { purgeBusy = false; }
    }

    const heatColor = (n: number) => n === 0 ? "var(--lv-surface-2)" : n < 5 ? "l1" : n < 15 ? "l2" : n < 30 ? "l3" : "l4";
    const maxHour = $derived(Math.max(1, ...hours));
    const hoursSvg = $derived(hours.map((n, i) => `${(i / 23) * 300},${40 - Math.round((n / maxHour) * 36)}`).join(" "));
    const maxTrend = $derived(Math.max(1, ...trend30.map((p) => p.attempts)));

    // 44-02 lite：确定-错 下钻（展开时从流水实时取，随报告数据同源）
    let cwOpen = $state(false);
    const cwList = $derived(cwOpen && app ? confidentWrongList(app.attempts.all()) : []);
    // 44-02 lite 对偶：不确定-对 下钻
    let ucOpen = $state(false);
    const ucList = $derived(ucOpen && app ? uncertainCorrectList(app.attempts.all()) : []);
    // 39-08 lite：延迟独立回忆（错后隔日首次作答；随日期范围联动）
    const recall = $derived(app ? delayedRecall(app.attempts.all().filter((e) => !rangeDays || e.ts >= Date.now() - rangeDays * 86_400_000)) : null);

    // 45-08：图表数据表展开态（单选一个卡）+ CSV 下载（与 SVG 同一数据快照）
    let tableOpen = $state<"trend" | "heat" | "hourly" | "">("");
    function downloadChartCsv(csv: string, name: string) {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `小驴考试-报告-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
</script>

<div class="fn__flex-1 lv-pad">
  <div class="block__icons">
    <div class="block__logo">
      <svg class="block__logoicon"><use xlink:href="#iconReport"></use></svg>
      {t("tab.report")}
    </div>
    {#if app}<SaveStatus gate={app.saves} {t} />{/if}
    <!-- 39-06 lite：统计日期范围（消灭错题/连续天数为状态类指标保持全局） -->
    <select class="lv-select" bind:value={rangeDays} onchange={computeReport} title={t("report.rangeTip")}>
      <option value={0}>{t("report.rangeAll")}</option>
      <option value={1}>{t("report.rangeToday")}</option>
      <option value={7}>{t("report.range7")}</option>
      <option value={30}>{t("report.range30")}</option>
    </select>
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
          <!-- 45-08：SVG 图表的文本等价物 + CSV（同一数据快照，读屏/打印/导出数字一致） -->
          <button class="lv-btn sm lv-btn--ghost" onclick={() => tableOpen = tableOpen === "trend" ? "" : "trend"}>📋 {t("data.table")}</button>
          <button class="lv-btn sm lv-btn--ghost" onclick={() => downloadChartCsv(trendToCsv(trend30), "trend30")}>⬇️ CSV</button>
        </div>
        {#if tableOpen === "trend"}
          <table class="lv-dtable">
            <thead><tr><th>{t("report.trendDay")}</th><th>{t("report.attempts")}</th></tr></thead>
            <tbody>
              {#each trend30.filter((p) => p.attempts > 0) as p, _i (_i)}
                <tr><td class="num">{p.date}</td><td class="num">{p.attempts}</td></tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    {/if}

    <div class="lv-card lv-section">
      <b>{t("report.heat")}</b>
      <div class="lv-heat">
        {#each heat as c, _i (_i)}
          <i class={heatColor(c.count)} title="{c.date} · {c.count}"></i>
        {/each}
      </div>
      <div class="lv-row" style="margin:6px 0 0">
        <button class="lv-btn sm lv-btn--ghost" onclick={() => tableOpen = tableOpen === "heat" ? "" : "heat"}>📋 {t("data.table")}</button>
        <button class="lv-btn sm lv-btn--ghost" onclick={() => downloadChartCsv(heatmapToCsv(heat), "heatmap")}>⬇️ CSV</button>
      </div>
      {#if tableOpen === "heat"}
        <div class="lv-row" style="margin:6px 0 0;flex-direction:column;align-items:stretch;gap:2px;max-height:180px;overflow:auto">
          {#each heat.filter((c) => c.count > 0) as c, _i (_i)}
            <span class="lv-muted num">{c.date} · {c.count}</span>
          {/each}
        </div>
      {/if}
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
            {#if r.assisted}
              <span class="lv-chip lv-chip--amb num" title={t("report.assistedTip")}>🫱 {r.assisted}</span>
            {/if}
          </div>
        {/each}
        {#if calib.rows.some((r) => r.confidence === "sure" && r.accuracy < 80 && r.attempts > 0)}
          <!-- 44-02 lite：确定-错 下钻（低样本不误导，样本门槛沿用校准卡口径） -->
          <button class="lv-btn sm lv-btn--ghost" style="margin-top:4px" onclick={() => cwOpen = !cwOpen}>
            {cwOpen ? "▾" : "▸"} {t("report.cwDrill")}
          </button>
          {#if cwOpen}
            <div class="lv-row" style="margin:6px 0 0;flex-direction:column;align-items:stretch;gap:4px">
              {#each cwList as c, _ci (_ci)}
                {@const stem = questions.find((x) => x.id === c.qid)?.stem}
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
            <div class="lv-row" style="margin:6px 0 0;flex-direction:column;align-items:stretch;gap:4px">
              {#each ucList as u, _ui (_ui)}
                {@const stem = questions.find((x) => x.id === u.qid)?.stem}
                <div class="lv-row" style="margin:0;white-space:normal" title={stem ?? u.qid}>
                  <span class="lv-chip num">{t("confidence." + u.confidence)}</span>
                  <span style="font-size:12.5px">{stem ? stem.slice(0, 70) : u.qid}</span>
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
      <div class="lv-card lv-section">
        <b>{t("report.recallTitle")}</b>
        <p class="lv-muted" style="margin:0 0 8px;font-size:11.5px">{t("report.recallHint")}</p>
        <div class="lv-row" style="margin:4px 0">
          <span class="lv-chip num">{t("report.recallPairs").replace("{n}", String(recall.pairs))}</span>
          <span class="lv-chip acc num">{t("report.recallIndependent").replace("{n}", String(recall.independentRecall))}</span>
          {#if recall.assistedCorrect}<span class="lv-chip lv-chip--amb num">{t("report.recallAssisted").replace("{n}", String(recall.assistedCorrect))}</span>{/if}
          {#if recall.stillWrong}<span class="lv-chip lv-chip--red num">{t("report.recallWrong").replace("{n}", String(recall.stillWrong))}</span>{/if}
          <span class="lv-chip num">{t("report.recallRate").replace("{n}", String(recall.rate ?? 0))}</span>
        </div>
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
      <div class="lv-row" style="margin:4px 0 0">
        <button class="lv-btn sm lv-btn--ghost" onclick={() => tableOpen = tableOpen === "hourly" ? "" : "hourly"}>📋 {t("data.table")}</button>
        <button class="lv-btn sm lv-btn--ghost" onclick={() => downloadChartCsv(hourlyToCsv(hours), "hourly")}>⬇️ CSV</button>
      </div>
      {#if tableOpen === "hourly"}
        <div class="lv-row" style="margin:6px 0 0;flex-direction:column;align-items:stretch;gap:2px;max-height:180px;overflow:auto">
          {#each hours.map((n, i) => [i, n] as const).filter(([, n]) => n > 0) as [h, n], _i (_i)}
            <span class="lv-muted num">{String(h).padStart(2, "0")}:00 · {n}</span>
          {/each}
        </div>
      {/if}
      <button class="lv-btn sm" style="margin-top:8px" disabled={reportBusy} onclick={writeDaily}>
        📄 {reportBusy ? "…" : t("report.writeDaily")}
      </button>
      <button class="lv-btn sm lv-btn--ghost" style="margin-top:8px" onclick={exportDiagnostics}>
        🩰 {t("diag.export")}
      </button>
      <!-- 69-01/69-06/58-01 lite：存储占用 / 数据体检 / 数据出库 -->
      <button class="lv-btn sm lv-btn--ghost" style="margin-top:8px" onclick={() => void toggleStorage()}>
        💾 {storageOpen ? t("data.hideStorage") : t("data.showStorage")}{#if storageRows.length}&nbsp;· {storageTotalKb} KB{/if}
      </button>
      {#if storageOpen}
        <div class="lv-row" style="margin:6px 0 0">
          {#each storageRows as r, _i (_i)}
            <span class="lv-chip num" class:lv-chip--amb={!r.present} title={r.key}>{r.key} · {Math.round(r.bytes / 1024 * 10) / 10}K</span>
          {/each}
        </div>
        <div class="lv-muted" style="margin-top:4px;font-size:11.5px">{t("data.storageNote")}</div>
      {/if}
      <button class="lv-btn sm lv-btn--ghost" style="margin-top:8px" disabled={auditBusy} onclick={() => void runDataAudit()}>
        {auditBusy ? "…" : `🔍 ${t("data.audit")}`}
      </button>
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
      <button class="lv-btn sm lv-btn--ghost" style="margin-top:8px" onclick={() => void exportAllData()}>
        ⬇️ {t("data.export")}
      </button>
      <button class="lv-btn sm" style="margin-top:8px" disabled={purgeBusy} onclick={() => void purgeAllData()}>
        {purgeBusy ? "…" : `🗑 ${t("data.purge")}`}
      </button>
      {#if purgeReceipts.length}
        <!-- 58-03/U30：逐对象回执（不冒充全部删除）；重载思源后内存态归零 -->
        <div class="lv-row" style="margin:6px 0 0" role="status">
          {#each purgeReceipts as r, _i (_i)}
            <span class="lv-chip num" class:lv-chip--red={!r.ok} title={r.key}>{r.key} {r.ok ? "✓" : "✕"}</span>
          {/each}
        </div>
        <div class="lv-muted" style="margin-top:4px;font-size:11.5px">{t("data.purgeNote")}</div>
      {/if}
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
