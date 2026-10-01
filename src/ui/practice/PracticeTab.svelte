<script lang="ts">
    // 练习台：入口(S1) / 会话(S2) / 浏览(S3) / 导入(S9) 四视图
    // 状态设计（docs/11）：loading/empty(守卫)/error/normal 四态可达
    import { onMount } from "svelte";
    import type { ExamApp } from "../../app";
    import type { Question } from "../../core/types";
    import { parseText, parseExcelRows, autoMapExcel, type ImportReport } from "../../importer/pipeline";
    import { grade } from "../../core/answer";

    let { plugin, examApp: app }: { plugin: any; examApp: ExamApp } = $props();
    const i18n = $derived(plugin?.i18n ?? {});
    const t = (k: string, fb = "") => i18n[k] ?? fb;

    type View = "entry" | "session" | "browse" | "import";
    let view: View = $state("entry");
    let loading = $state(true);
    let errorMsg = $state("");
    let banks = $state<any[]>([]);
    let activeBankId = $state("");
    let questions = $state<Question[]>([]);
    let questionsError = $state("");

    // 会话态
    let session = $state<any>(null);
    let feedback = $state<null | { verdict: string; myAnswer: string | null }>(null);
    let selected = $state<string>("");
    let answerStart = $state(0);
    let sessionDone = $state<null | { total: number; correct: number; wrong: number }>(null);

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
      banks = app.listBanks();
      if (banks.length) activeBankId = banks[0].id;
      // 恢复未完成会话
      app.resumeSession(async (qids) => {
        const all = await loadQuestions();
        return qids.map((id) => all.find((q) => q.id === id)).filter(Boolean) as Question[];
      }).then((s) => {
        if (s) { session = s; view = "session"; }
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

    async function startDrill(mode: string) {
      errorMsg = "";
      const qs = await loadQuestions();
      if (!qs.length) { errorMsg = t("state.emptyBank"); return; }
      let picked: Question[] = [];
      if (mode === "wrong") {
        picked = app.wrongDrill(qs);
        if (!picked.length) { errorMsg = t("state.noWrong"); return; }
      } else {
        picked = app.quickDrill(qs, 20);
      }
      session = await app.startSession(picked, mode);
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
      const g = grade(q, selected || null);
      session.submit(selected || null, timeMs);
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
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      try {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf);
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        if (!rows.length) { importError = t("import.emptyFile"); return; }
        const { map, missing } = autoMapExcel(rows[0].map(String));
        if (missing.length) { importError = t("import.missingColumns") + missing.join("、"); return; }
        importReport = parseExcelRows(rows.slice(1), map);
      } catch (e) { importError = String(e instanceof Error ? e.message : e); }
      input.value = "";
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

<div class="fn__flex-1 lv-exam-tab">
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
    {#if hasBank}<span class="lv-chip">{t("bank.label")} {bankName}</span>{/if}
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
        <div class="lv-modes">
          <button class="lv-mode" onclick={() => startDrill("single")}>
            <b>⚡ {t("mode.quick")}</b><span class="lv-muted">{t("mode.quick.desc")}</span>
          </button>
          <button class="lv-mode" onclick={() => startDrill("wrong")}>
            <b>❌ {t("mode.wrong")}</b><span class="lv-muted num">{app.wrongItems().length} {t("mode.wrong.unit")}</span>
          </button>
          <button class="lv-mode lv-mode--disabled" title={t("todo")}>
            <b>🌲 {t("mode.special")}</b><span class="lv-muted">{t("todo")}</span>
          </button>
          <button class="lv-mode lv-mode--disabled" title={t("todo")}>
            <b>📄 {t("mode.paper")}</b><span class="lv-muted">{t("todo")}</span>
          </button>
          <button class="lv-mode lv-mode--disabled" title={t("todo")}>
            <b>⭐ {t("mode.fav")}</b><span class="lv-muted">{t("todo")}</span>
          </button>
          <button class="lv-mode lv-mode--disabled" title={t("todo")}>
            <b>🔥 {t("mode.cram")}</b><span class="lv-muted">{t("todo")}</span>
          </button>
        </div>
        <div class="lv-row" style="margin-top:14px">
          <button class="lv-btn" onclick={() => view = "import"}>📥 {t("import.title")}</button>
          <button class="lv-btn" disabled title={t("todo")}>✏️ {t("entry.manual")}</button>
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
          <button class="lv-btn lv-btn--primary" style="width:100%" onclick={exitSession}>{t("session.back")}</button>
        </div>
      </div>
    {:else}
      {@const q = session.current}
      {#if q}
        <div class="lv-pad">
          <div class="lv-row lv-session-head">
            <button class="lv-btn lv-btn--ghost" onclick={exitSession}>← {t("session.exit")}</button>
            <span class="lv-chip">{t("session.progress")}: <span class="num">{session.progress.done}/{session.progress.total}</span></span>
            <span class="lv-chip lv-chip--acc">{t("qtype." + q.type)}</span>
          </div>
          <div class="lv-card lv-question">
            <div class="lv-stem">{q.stem}</div>
            {#if q.options.length}
              <div role="radiogroup" aria-label={t("session.options")}>
                {#each q.options as opt, i}
                  <button class="lv-opt" class:sel={selected === String.fromCharCode(65 + i)}
                    role="radio" aria-checked={selected === String.fromCharCode(65 + i)}
                    class:right={feedback && feedback.verdict !== "not_attempted" && q.answer.includes(String.fromCharCode(65 + i)) && (q.type === "single" ? q.answer === String.fromCharCode(65 + i) : true)}
                    class:wrong={feedback && feedback.myAnswer === String.fromCharCode(65 + i) && feedback.verdict === "wrong"}
                    onclick={() => !feedback && (selected = String.fromCharCode(65 + i))}>
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
                  {#each ["careless", "unknown", "trap"] as r}
                    <button class="lv-chip" onclick={async () => { await app.saveWrongReason(q.id, r as any); }}>{t("reason." + r)}</button>
                  {/each}
                </div>
              {/if}
            {/if}

            <div class="lv-row">
              {#if !feedback}
                <button class="lv-btn lv-btn--primary" onclick={submitAnswer} disabled={!selected && !session.getDraft(q.id)}>{t("session.submit")}</button>
                {#if q.type === "fill" || q.type === "short"}
                  <button class="lv-btn lv-btn--ghost" onclick={() => { submitAnswer(); }}>{t("session.skip")}</button>
                {/if}
              {:else}
                <button class="lv-btn lv-btn--primary" onclick={nextQuestion}>{t("session.next")} →</button>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    {/if}
  {:else if view === "browse"}
    <!-- ===== S3 浏览 ===== -->
    <div class="lv-pad">
      <div class="lv-row">
        <button class="lv-btn lv-btn--ghost" onclick={() => view = "entry"}>← {t("mode.practice")}</button>
        <span class="lv-chip num">{questions.length} {t("browse.count")}</span>
      </div>
      {#if questionsError}
        <div class="lv-error">{questionsError}</div>
      {:else if !questions.length}
        <div class="lv-empty">{t("browse.empty")}</div>
      {:else}
        {#each questions as q (q.id)}
          <div class="lv-card lv-qrow">
            <div class="lv-qrow-head">
              <span class="lv-chip lv-chip--acc">{t("qtype." + q.type)}</span>
              {#if q.kp}<span class="lv-chip">{q.kp}</span>{/if}
              {#if q.source}<span class="lv-muted lv-qrow-src">{q.source}</span>{/if}
            </div>
            <div class="lv-qrow-stem">{q.stem}</div>
          </div>
        {/each}
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
  @media (max-width: 960px) { .lv-modes { grid-template-columns: repeat(2, 1fr); } }
  @media (prefers-reduced-motion: reduce) { .lv-skeleton { animation: none; } .lv-mode, .lv-btn, .lv-opt { transition: none; } }
</style>
