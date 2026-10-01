<script lang="ts">
    // 报告中心（S8 lite）：KPI / 热力图 / 考点掌握度 / 薄弱 Top10 / 时段分布
    // 数据全部来自流水重算（可离线）；聚合逻辑见 src/core/report.ts
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import type { ExamApp } from "../../app";
    import { heatmap, masteryByKp, weakTop, hourly } from "@/core/report";

    let { plugin, examApp: app }: { plugin: any; examApp: ExamApp | null } = $props();
    const i18n = $derived(plugin?.i18n ?? {});
    const t = (k: string, fb = "") => i18n[k] ?? fb;

    let loading = $state(true);
    let kpi = $state({ attempts: 0, accuracy: 0, eliminated: 0, streak: 0 });
    let heat = $state<{ date: string; count: number }[]>([]);
    let mastery = $state<ReturnType<typeof masteryByKp>>([]);
    let weak = $state<ReturnType<typeof weakTop>>([]);
    let hours = $state<number[]>(new Array(24).fill(0));
    let mockHistory = $state<any[]>([]);
    let errorMsg = $state("");
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
        let attempts = 0, correct = 0;
        for (const s of d.byQuestion.values()) { attempts += s.attempts; correct += s.correct; }
        const { streak } = await import("@/core/replayer");
        kpi = { attempts, accuracy: attempts ? Math.round((correct / attempts) * 100) : 0, eliminated: [...d.wrongbook.values()].filter((w) => w.status === "eliminated").length, streak: streak(d) };
        heat = heatmap(d.days);
        hours = hourly(app.attempts.all());
        const banks = app.listBanks();
        if (banks.length) {
          const qs = await app.listQuestions(banks[0].id);
          mastery = masteryByKp(qs, d.byQuestion, app.attempts.all());
          weak = weakTop(mastery);
        }
        mockHistory = await app.listMockResults();
      } catch (e) {
        errorMsg = String(e instanceof Error ? e.message : e);
      } finally { loading = false; }
    });

    const heatColor = (n: number) => n === 0 ? "var(--lv-surface-2)" : n < 5 ? "l1" : n < 15 ? "l2" : n < 30 ? "l3" : "l4";
    const maxHour = $derived(Math.max(1, ...hours));
    const hoursSvg = $derived(hours.map((n, i) => `${(i / 23) * 300},${40 - Math.round((n / maxHour) * 36)}`).join(" "));
</script>

<div class="fn__flex-1 lv-pad">
  <div class="block__icons">
    <div class="block__logo">
      <svg class="block__logoicon"><use xlink:href="#iconReport"></use></svg>
      {t("tab.report")}
    </div>
    <span class="fn__flex-1"></span>
    <span class="lv-chip">{t("report.dataFromLog")}</span>
  </div>

  {#if loading}
    <div class="lv-skeleton"></div>
  {:else if errorMsg}
    <div class="lv-error">{errorMsg}</div>
  {:else}
    <div class="lv-kpis">
      <div class="lv-card lv-kpi"><div class="l">⚡ {t("report.attempts")}</div><div class="v num">{kpi.attempts}</div></div>
      <div class="lv-card lv-kpi"><div class="l">◎ {t("report.accuracy")}</div><div class="v num">{kpi.accuracy}%</div></div>
      <div class="lv-card lv-kpi"><div class="l">❌ {t("report.eliminated")}</div><div class="v num">{kpi.eliminated}</div></div>
      <div class="lv-card lv-kpi"><div class="l">🔥 {t("report.streak")}</div><div class="v num">{kpi.streak} {t("entry.days")}</div></div>
    </div>

    <div class="lv-card lv-section">
      <b>{t("report.heat")}</b>
      <div class="lv-heat">
        {#each heat as c}
          <i class={heatColor(c.count)} title="{c.date} · {c.count}"></i>
        {/each}
      </div>
    </div>

    <div class="lv-card lv-section">
      <b>{t("report.mastery")}</b>
      {#if !mastery.length}
        <p class="lv-muted">{t("report.noData")}</p>
      {:else}
        {#each mastery.slice(0, 8) as m}
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
        {#each weak.slice(0, 5) as w, i}
          <div class="lv-row" style="margin:4px 0">
            <span class="lv-chip lv-chip--red num">{i + 1}</span>
            <span style="flex:1">{w.root}</span>
            <span class="num" style="color:var(--lv-red);font-weight:700">{Math.round(w.accuracy * 100)}%</span>
          </div>
        {/each}
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
    </div>
  {/if}
</div>

<style>
  .lv-pad { padding: 12px 16px; overflow: auto; }
  .lv-muted { color: var(--lv-text-3); font-size: 12.5px; }
  .lv-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
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
