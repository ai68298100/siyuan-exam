<script lang="ts">
    // 模考场（v0.3）：蓝图配置器 → 全真考试（计时/答题卡/标旗）→ 成绩单
    // 规格见 docs/11 S5/S6/S7；引擎见 src/core/mock.ts（53 项单测覆盖）
    import { onMount } from "svelte";

    /** 切屏计数（docs/11 S6：失焦计次进报告，不阻断） */
    function onBlur() { if (view === "exam" && session && !session.submitted) session.screenSwitches++; }
    import type { ExamApp } from "../../app";
    import type { Question } from "../../core/types";
    import { assemble, blueprintTotals, MockSession, type Blueprint, type BlueprintSection, type MockScore } from "../../core/mock";
    
    let { plugin, examApp: app }: { plugin: any; examApp: ExamApp } = $props();
    const i18n = $derived(plugin?.i18n ?? {});
    const t = (k: string, fb = "") => i18n[k] ?? fb;

    type View = "config" | "exam" | "report";
    let view: View = $state("config");
    let loading = $state(true);
    let errorMsg = $state("");
    let bankName = $state(""); void bankName;
    let questions = $state<Question[]>([]);

    let bp = $state<Blueprint>({
      id: "bp-default", name: "模拟卷 #1", durationS: 3600, passLine: 60,
      shuffleOptions: false, sectionTimed: true,
      sections: []
    });

    let session: MockSession | null = $state(null);
    void 0; // assembleInfo 由 session 内部持有
    let cursor = $state(0);
    let selected = $state("");
    let answeredMap = $state<Record<string, string>>({});
    let feedbackOn = $state(false);          // 模考默认不即时判分；交卷后统一
    let score = $state<MockScore | null>(null);
    let nowTick = $state(Date.now());
    let timer: ReturnType<typeof setInterval> | null = null;
    let startedAt = $state(0);

    onMount(async () => {
      if (!app) { loading = false; errorMsg = t("state.appNotReady"); return; }
      const banks = app.listBanks();
      if (!banks.length) { loading = false; errorMsg = t("guard.needBankFirst"); return; }
      bankName = banks[0].name;
      try {
        questions = await app.listQuestions(banks[0].id);
        bp.sections = defaultSections(questions);
      } catch (e) { errorMsg = String(e instanceof Error ? e.message : e); }
      loading = false;
    });

    /** 默认蓝图：按考点首段聚类（无考点 → 单段全量） */
    function defaultSections(qs: Question[]): BlueprintSection[] {
      if (!qs.length) return [];
      const byRoot = new Map<string, number>();
      for (const q of qs) {
        const root = q.kp?.split("/")[0] ?? "全部";
        byRoot.set(root, (byRoot.get(root) ?? 0) + 1);
      }
      return [...byRoot.entries()].slice(0, 5).map(([name, n]) => ({
        name, count: Math.min(n, 20), scoreEach: 1, source: "mixed" as const, types: [],
      }));
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
      bp.sections = [...bp.sections, { name: "新模块", count: 10, scoreEach: 1, source: "mixed", types: [] }];
    }
    function removeSection(i: number) {
      bp.sections = bp.sections.filter((_, j) => j !== i);
    }
    function updateSection(i: number, patch: Partial<BlueprintSection>) {
      bp.sections = bp.sections.map((s, j) => (j === i ? { ...s, ...patch } : s));
    }

    function startExam() {
      errorMsg = "";
      if (!questions.length) { errorMsg = t("state.emptyBank"); return; }
      const r = assemble(bp, questions);
      if (!r.paper.length) { errorMsg = t("state.emptyBank"); return; }
      startedAt = Date.now();
      session = new MockSession(bp, r.paper, { sectionOf: r.sectionOf, scoreOf: r.scoreOf }, startedAt);
      cursor = 0; selected = ""; answeredMap = {}; score = null;
      session.enterSection(currentSection || (bp.sections[0]?.name ?? ""), startedAt);
      view = "exam";
      timer = setInterval(() => {
        nowTick = Date.now();
        if (session?.shouldAutoSubmit(nowTick)) finishExam(true);
      }, 1000);
    }

    function pickOption(letter: string) {
      if (!current || feedbackOn) return;
      selected = letter;
      session?.setAnswer(current, letter, Date.now());
      answeredMap = { ...answeredMap, [current]: letter };
    }

    function goto(i: number) {
      if (!session) return;
      cursor = Math.max(0, Math.min(session.state.qids.length - 1, i));
      selected = answeredMap[session.state.qids[cursor]] ?? "";
      if (bp.sectionTimed && currentSection) session.enterSection(currentSection, Date.now());
    }

    async function finishExam(auto = false) {
      // 提前交卷二次确认（TODO 27：未答完且非自动交卷）
      if (!auto && session && !session.shouldAutoSubmit(Date.now())) {
        const unanswered = session.state.qids.length - session.answers.size;
        if (unanswered > 0 && !confirm(t("mock.confirmHandIn").replace("{n}", String(unanswered)))) return;
      }
      if (timer) { clearInterval(timer); timer = null; }
      session?.submit(Date.now());
      // 作答写流水（kind=mock；模考错题自动进错题本——replayer 收录）
      if (session) {
        for (const a of session.answers.values()) {
          app.recordAttempt({
            qid: a.qid, kind: "mock", mode: "paper",
            verdict: a.verdict, myAnswer: a.answer,
            sessionId: "mock-" + bp.id, examId: bp.id,
            queue: "normal", changes: a.changes,
          });
        }
        await app.flush();
        plugin.refreshDock?.();
      }
      score = session?.score() ?? null;
      view = "report";
    }

    /** 错题回炉：本次模考错题开练习会话 */
    async function rewrongDrill() {
      if (!session) return;
      const wrongIds = [...session.answers.values()].filter((a) => a.verdict === "wrong").map((a) => a.qid);
      const wrongs = questions.filter((q) => wrongIds.includes(q.id));
      if (!wrongs.length) return;
      await app.startSession(wrongs, "wrong");
      openPractice();
    }

    function openPractice() {
      void import("siyuan").then(({ openTab }) => {
        openTab({ app: (plugin as any).app ?? (plugin as any), custom: { id: "exam-practice", icon: "iconExam", title: t("tab.practice"), data: { plugin, examApp: app } } } as any);
      });
    }

    function percentBar(v: number, full: number) { return full ? Math.round((v / full) * 100) : 0; }
</script>

<svelte:window onblur={onBlur} />

<div class="fn__flex-1 lv-pad">
  <div class="block__icons">
    <div class="block__logo">
      <svg class="block__logoicon"><use xlink:href="#iconMock"></use></svg>
      {t("tab.mock")}
    </div>
    <span class="fn__flex-1"></span>
    {#if view === "exam"}
      <span class="lv-chip num">⏱ {remainText()}</span>
    {/if}
  </div>

  {#if loading}
    <div class="lv-skeleton"></div>
  {:else if errorMsg}
    <div class="lv-error">{errorMsg}</div>
  {:else if view === "config"}
    <!-- ===== S5 蓝图配置器 ===== -->
    <div class="lv-row">
      <input class="lv-input" bind:value={bp.name} style="max-width:220px" />
      <span class="lv-chip num">{t("mock.totalQ")} {totals.questions}</span>
      <span class="lv-chip num">{t("mock.totalScore")} {totals.score}</span>
      <span class="lv-chip num"><svg class="ic" width="12" height="12"><use xlink:href="#iconMock" /></svg>{Math.round(bp.durationS / 60)} min</span>
    </div>
    <div class="lv-bp-table">
      <div class="lv-bp-row head"><span>{t("mock.sec")}</span><span>{t("mock.count")}</span><span>{t("mock.each")}</span><span>{t("mock.source")}</span><span></span></div>
      {#each bp.sections as s, i}
        <div class="lv-bp-row">
          <input class="lv-input" bind:value={s.name} oninput={() => updateSection(i, { name: s.name })} />
          <input class="lv-input num" type="number" min="0" value={s.count} oninput={(e) => updateSection(i, { count: Math.max(0, parseInt((e.target as HTMLInputElement).value) || 0) })} />
          <input class="lv-input num" type="number" min="0" step="0.1" value={s.scoreEach} oninput={(e) => updateSection(i, { scoreEach: Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0) })} />
          <select class="lv-select" value={s.source} onchange={(e) => updateSection(i, { source: (e.target as HTMLSelectElement).value as any })}>
            <option value="mixed">mixed</option><option value="real">真题</option><option value="mock">模拟</option>
          </select>
          <button class="lv-btn lv-btn--ghost sm" onclick={() => removeSection(i)}>✕</button>
        </div>
      {/each}
      <div style="padding:8px 12px"><button class="lv-btn sm" style="border-style:dashed;width:100%" onclick={addSection}>＋ {t("mock.addSec")}</button></div>
    </div>
    <div class="lv-row">
      <label class="lv-row" style="margin:0"><input type="checkbox" bind:checked={bp.sectionTimed} /> {t("mock.sectionTimed")}</label>
      <label class="lv-row" style="margin:0"><input type="checkbox" bind:checked={bp.shuffleOptions} disabled /> {t("mock.shuffle")}（v0.4）</label>
      <span class="lv-chip">{t("mock.passLine")} <input class="lv-input num" style="width:64px" type="number" bind:value={bp.passLine} /></span>
    </div>
    {#if !bp.sections.length}<div class="lv-empty">{t("mock.needSec")}</div>{/if}
    <div class="lv-row">
      <button class="lv-btn lv-btn--primary" onclick={startExam} disabled={!bp.sections.length}>▶ {t("mock.start")}</button>
    </div>
  {:else if view === "exam" && session && currentQ}
    <!-- ===== S6 全真考试 ===== -->
    <div class="lv-row">
      <span class="lv-chip">{currentSection}</span>
      <span class="lv-chip num">{cursor + 1}/{session.state.qids.length}</span>
      <span class="fn__flex-1"></span>
      <button class="lv-btn sm" onclick={() => session?.toggleFlag(current)}>🚩 {session.flags.has(current) ? "✓" : ""}</button>
      <button class="lv-btn lv-btn--primary sm" onclick={() => finishExam(false)}>{t("mock.handIn")}</button>
    </div>
    <div class="lv-card lv-question">
      <div class="lv-stem">{currentQ.stem}</div>
      {#if currentQ.options.length}
        {#each currentQ.options as opt, i}
          <button class="lv-opt" class:sel={selected === String.fromCharCode(65 + i)} onclick={() => pickOption(String.fromCharCode(65 + i))}>
            <span class="key">{String.fromCharCode(65 + i)}</span><span>{opt}</span>
          </button>
        {/each}
      {:else}
        <textarea class="lv-input lv-textarea" value={answeredMap[current] ?? ""}
          oninput={(e) => { session?.setAnswer(current, (e.target as HTMLTextAreaElement).value, Date.now()); answeredMap = { ...answeredMap, [current]: (e.target as HTMLTextAreaElement).value }; }}></textarea>
      {/if}
    </div>
    <!-- 答题卡 -->
    <div class="lv-sheet">
      {#each session.state.qids as qid, i}
        <button class="lv-cell" class:done={!!answeredMap[qid]} class:flag={session.flags.has(qid)}
          class:cur={i === cursor} onclick={() => goto(i)}>{i + 1}</button>
      {/each}
    </div>
    <div class="lv-row">
      <button class="lv-btn sm" onclick={() => goto(cursor - 1)} disabled={cursor === 0}>◀</button>
      <button class="lv-btn sm" onclick={() => goto(cursor + 1)} disabled={cursor >= session.state.qids.length - 1}>▶</button>
    </div>
  {:else if view === "report" && score}
    <!-- ===== S7 成绩单 ===== -->
    <div class="lv-row">
      <b style="font-size:16px">{bp.name}</b>
      <span class="lv-chip num">{new Date(startedAt).toLocaleString()}</span>
    </div>
    <div class="lv-card" style="margin-bottom:14px">
      <div class="lv-row" style="align-items:center;padding:6px 4px">
        <span class="num" style="font-size:40px;font-weight:800;color:var(--lv-accent)">{score.total}</span>
        <span class="lv-muted">/ {score.full}</span>
        <span class="lv-chip" class:grn={score.pass} class:red={!score.pass}>{score.pass ? t("mock.pass") : t("mock.fail")}（{t("mock.passLine")} {bp.passLine}）</span>
        <span class="lv-chip num">{score.percent}%</span>
      </div>
    </div>
    {#each score.sections as sec}
      <div class="lv-row" style="margin:4px 0">
        <span style="width:70px">{sec.name}</span>
        <div class="progress" style="flex:1"><i style="width:{percentBar(sec.score, sec.full)}%"></i></div>
        <span class="num lv-muted">{sec.score}/{sec.full} · {t("mock.correct")} {sec.correct}/{sec.total}</span>
      </div>
    {/each}
    <div class="lv-row">
      <span class="lv-chip num">🚩 {score.flagsUsed}</span>
      <span class="lv-chip num">{t("mock.changes")} {score.changes}</span>
      <span class="lv-chip num">{t("mock.last20")} {score.last20min.correct}/{score.last20min.attempted}</span>
    </div>
    <div class="lv-row">
      <button class="lv-btn lv-btn--primary" onclick={rewrongDrill}>❌ {t("mock.rewrong")}</button>
      <button class="lv-btn" onclick={() => { view = "config"; }}>▶ {t("mock.again")}</button>
    </div>
  {/if}
</div>

<style>
  .lv-pad { padding: 12px 16px; overflow: auto; }
  .lv-muted { color: var(--lv-text-3); font-size: 12.5px; }
  .lv-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
  .lv-input { padding: 6px 10px; border-radius: 9px; border: 1px solid var(--lv-border); background: var(--lv-surface); color: var(--lv-text); font: inherit; font-size: 13px; }
  .lv-input:focus { border-color: var(--lv-accent); box-shadow: var(--lv-ring); outline: none; }
  .lv-input.num { width: 72px; }
  .lv-select { padding: 6px 10px; border-radius: 9px; border: 1px solid var(--lv-border); background: var(--lv-surface); color: var(--lv-text); font: inherit; font-size: 13px; }
  .lv-textarea { width: 100%; min-height: 80px; resize: vertical; }
  .lv-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 10px; font-size: 13.5px; font-weight: 600; border: 1px solid var(--lv-border); background: var(--lv-surface); color: var(--lv-text); cursor: pointer; transition: all var(--lv-dur-micro) ease; }
  .lv-btn:hover:not(:disabled) { box-shadow: var(--lv-sh-1); transform: translateY(-1px); }
  .lv-btn:disabled { opacity: .5; cursor: not-allowed; }
  .lv-btn--primary { background: var(--lv-accent-grad); border-color: transparent; color: #fff; }
  .lv-btn--ghost { border-color: transparent; background: transparent; color: var(--lv-text-2); }
  .lv-btn.sm { padding: 5px 12px; font-size: 12.5px; }
  .lv-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 550; color: var(--lv-text-2); background: var(--lv-surface-2); border: 1px solid var(--lv-border); }
  .lv-chip.grn { color: var(--lv-green); background: var(--lv-green-soft); border-color: transparent; }
  .lv-chip.red { color: var(--lv-red); background: var(--lv-red-soft); border-color: transparent; }
  .lv-card { background: var(--lv-surface); border: 1px solid var(--lv-border); border-radius: var(--lv-r-3); padding: 18px 20px; box-shadow: var(--lv-sh-1); }
  .lv-stem { font-size: 16px; line-height: 1.75; margin-bottom: 14px; white-space: pre-wrap; }
  .lv-opt { display: flex; gap: 12px; width: 100%; text-align: left; padding: 11px 14px; border-radius: var(--lv-r-2); border: 1.5px solid var(--lv-border); margin-bottom: 8px; cursor: pointer; background: var(--lv-surface); font: inherit; color: inherit; transition: all var(--lv-dur-micro) ease; }
  .lv-opt:hover { border-color: var(--lv-accent); background: var(--lv-accent-soft); }
  .lv-opt .key { width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; flex: none; font-size: 12.5px; font-weight: 700; background: var(--lv-surface-2); border: 1px solid var(--lv-border); }
  .lv-opt.sel { border-color: var(--lv-accent); background: var(--lv-accent-soft); }
  .lv-opt.sel .key { background: var(--lv-accent); border-color: var(--lv-accent); color: #fff; }
  .lv-bp-table { border: 1px solid var(--lv-border); border-radius: 12px; overflow: hidden; margin: 10px 0; }
  .lv-bp-row { display: grid; grid-template-columns: 1.2fr .6fr .6fr .9fr 36px; gap: 8px; padding: 8px 12px; border-bottom: 1px dashed var(--lv-border); align-items: center; }
  .lv-bp-row:last-child { border-bottom: none; }
  .lv-bp-row.head { background: var(--lv-surface-2); font-size: 11.5px; font-weight: 700; color: var(--lv-text-3); border-bottom: 1px solid var(--lv-border); }
  .lv-sheet { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
  .lv-cell { width: 30px; height: 30px; border-radius: 7px; border: 1px solid var(--lv-border); background: var(--lv-surface); font-size: 11.5px; font-family: var(--mono); color: var(--lv-text-2); cursor: pointer; }
  .lv-cell.done { background: var(--lv-green-soft); color: var(--lv-green); border-color: transparent; }
  .lv-cell.flag { outline: 2px solid var(--lv-amber); }
  .lv-cell.cur { background: var(--lv-accent); color: #fff; border-color: transparent; }
  .lv-error { margin: 8px 0; padding: 10px 14px; border-radius: var(--lv-r-2); background: var(--lv-red-soft); color: var(--lv-red); font-size: 13px; }
  .lv-empty { border: 1.5px dashed var(--lv-border); border-radius: 14px; padding: 26px; text-align: center; color: var(--lv-text-3); }
  .lv-skeleton { height: 160px; border-radius: var(--lv-r-3); background: linear-gradient(100deg, var(--lv-surface-2) 40%, var(--lv-surface) 50%, var(--lv-surface-2) 60%); background-size: 200% 100%; animation: lv-shim 1.4s infinite; }
  @keyframes lv-shim { to { background-position: -200% 0; } }
  .progress { height: 6px; border-radius: 999px; background: var(--lv-surface-2); overflow: hidden; }
  .progress i { display: block; height: 100%; background: var(--lv-accent-grad); border-radius: 999px; }
  @media (prefers-reduced-motion: reduce) { .lv-skeleton { animation: none; } .lv-opt, .lv-btn { transition: none; } }
</style>
