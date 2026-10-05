<script lang="ts">
    // 模考场（v0.3）：蓝图配置器 → 全真考试（计时/答题卡/标旗）→ 成绩单
    // 规格见 docs/11 S5/S6/S7；引擎见 src/core/mock.ts（53 项单测覆盖）
    import { onMount } from "svelte";

    /** 切屏计数（docs/11 S6：失焦计次进报告，不阻断） */
    function onBlur() { if (view === "exam" && session && !session.submitted) session.screenSwitches++; }
    import type { ExamApp } from "../../app";
    import type { Question } from "../../core/types";
    import { showMessage } from "siyuan";
    import { assemble, blueprintTotals, dedupeSectionNames, MockSession, validateBlueprint, type Blueprint, type BlueprintSection, type MockRunSnapshot, type MockScore } from "../../core/mock";
    import { newRunId } from "../../core/ids";
    import { estimateScore } from "../../core/estimate";
    import Icon from "../shared/Icon.svelte";
    import SaveStatus from "../shared/SaveStatus.svelte";
    import { mockSectionsToCsv, mockHistoryToCsv } from "../../core/exportMd";
    
    let { plugin, examApp: app }: { plugin: any; examApp: ExamApp } = $props();
    const i18n = $derived(plugin?.i18n ?? {});
    const t = (k: string, fb = "") => i18n[k] ?? fb;

    type View = "config" | "exam" | "report";
    let view: View = $state("config");
    let loading = $state(true);
    let errorMsg = $state("");
    let questions = $state<Question[]>([]);

    let bp = $state<Blueprint>({
      id: "bp-default", name: "模拟卷 #1", durationS: 3600, passLine: 60,
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
    let resumable = $state<MockRunSnapshot | null>(null);
    let restoreNote = $state("");
    let lastSnapAt = 0;

    /** 快照节流保存（3s）：关页/休眠后按 wall clock 恢复同一 run */
    function persistRun() {
      if (!session || session.submitted || !runId) return;
      const now = Date.now();
      if (now - lastSnapAt < 3000) return;
      lastSnapAt = now;
      void app.saveMockRun(session.toSnapshot(runId, now));
    }

    onMount(async () => {
      if (!app) { loading = false; errorMsg = t("state.appNotReady"); return; }
      const banks = app.listBanks();
      if (!banks.length) { loading = false; errorMsg = t("guard.needBankFirst"); return; }
      activeBankId = banks[0].id;
      try {
        questions = await app.listQuestions(banks[0].id);
        bp.sections = defaultSections(questions);
      } catch (e) { errorMsg = String(e instanceof Error ? e.message : e); }
      // 恢复提示（兜底语义：读不到快照=无进行中考试，静默即可；题库不可读时不给恢复入口，避免空卷恢复）
      try {
        const snap = await app.loadMockRun();
        if (snap?.finishedAt) await app.clearMockRun();   // 残留已交卷快照：清除不留陈旧入口
        else if (snap && questions.length) resumable = snap;
      } catch { /* 忽略 */ }
      loading = false;
    });

    /** 默认蓝图：按考点首段聚类（无考点 → 单段全量） */
    function defaultSections(qs: Question[]): BlueprintSection[] {
      if (!qs.length) return [];
      // 函数内非响应式累加器（非组件状态），不转 SvelteMap
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
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
      try { await (app as any).deps.storage.save("mock/blueprint", JSON.parse(JSON.stringify(bp))); showMessage(t("mock.bpSaved"), 3000, "info"); } catch { /* 忽略 */ }
    }
    async function restoreBlueprint() {
      try {
        const saved = (await (app as any).deps.storage.load("mock/blueprint")) as Blueprint | undefined;
        if (saved?.sections?.length) bp = saved;
      } catch { /* 忽略 */ }
    }

    async function startExam() {
      errorMsg = "";
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
      runId = newRunId();
      bp = workingBp; // 本次考试使用去重/剔除后的蓝图（保存蓝图仍由用户显式操作）
      session = new MockSession(bp, r.paper, { sectionOf: r.sectionOf, scoreOf: r.scoreOf }, startedAt);
      cursor = 0; selected = ""; answeredMap = {}; score = null;
      session.enterSection(currentSection || (bp.sections[0]?.name ?? ""), startedAt);
      lastSnapAt = 0;
      persistRun();
      view = "exam";
      startTimer();
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
      if (!resumable) return;
      const snap = resumable;
      const r = MockSession.restore(snap, questions);
      // 兜底：卷面题全部读不到（题库被删/离线）→ 不进入空考试，保留快照待题库可用
      if (!r.session.state.qids.length) {
        errorMsg = t("mock.restoreEmpty");
        return;
      }
      session = r.session;
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
        void app.clearMockRun();
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
    }

    /** 放弃进行中的 run（快照清除；答案不写流水） */
    async function discardRun() {
      resumable = null;
      await app.clearMockRun();
    }

    function pickOption(letter: string) {
      if (!current || !currentQ || feedbackOn) return;
      if (currentQ.type === "multiple") {
        // 40-01：多选 toggle 组合答案（同一字母再点=取消；grade 侧 normalizeAnswer 排序去重同一规范）
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- 局部临时 Set，非响应式状态
        const cur = new Set((answeredMap[current] ?? "").split(""));
        if (cur.has(letter)) cur.delete(letter);
        else cur.add(letter);
        const combo = [...cur].sort().join("");
        selected = combo;
        session?.setAnswer(current, combo, Date.now());
        answeredMap = { ...answeredMap, [current]: combo };
      } else {
        // 单选/判断互斥
        selected = letter;
        session?.setAnswer(current, letter, Date.now());
        answeredMap = { ...answeredMap, [current]: letter };
      }
      persistRun();
    }

    function goto(i: number) {
      if (!session) return;
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
        const unanswered = session.state.qids.length - session.answers.size;
        if (unanswered > 0) {
          const { confirmDialogSync } = await import("../../libs/dialog");
          if (!(await confirmDialogSync({ title: t("mock.handIn"), content: t("mock.confirmHandIn").replace("{n}", String(unanswered)) }))) return;
        }
      }
      submitting = true;
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
          history = await app.listMockResults();
        }
        await app.clearMockRun();   // 交卷回执落定后清除运行快照
        view = "report";
      } finally {
        submitting = false;
      }
    }

    /** 成绩单导出 Markdown（本地下载） */
    function exportScoreMd() {
      if (!score) return;
      void import("@/core/exportScore").then((m) => {
        const md = m.scoreToMarkdown(bp, score!, startedAt);
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `模考成绩单 ${bp.name}.md`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }

    /** 错题回炉：本次模考错题开练习会话（启动失败可见化，47-06 lite） */
    async function rewrongDrill() {
      if (!session) return;
      const wrongIds = [...session.answers.values()].filter((a) => a.verdict === "wrong").map((a) => a.qid);
      const wrongs = questions.filter((q) => wrongIds.includes(q.id));
      if (!wrongs.length) return;
      try {
        await app.startSession(wrongs, "wrong", activeBankId);
      } catch (e) {
        showMessage(String(e instanceof Error ? e.message : e), 4200, "error");
        return;
      }
      openPractice();
    }

    // ---------- 复盘（44-07 lite）：本次错题清单 + 加入下一步行动（U15 去重） ----------
    const wrongList = $derived(score && session
      ? [...session.answers.values()].filter((a) => a.verdict === "wrong").map((a) => ({
          qid: a.qid,
          stem: (questions.find((q) => q.id === a.qid)?.stem ?? a.qid).slice(0, 40),
        }))
      : []);
    let mockActionNote = $state("");
    let mockActionBusy = $state(false);

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
      if (!wrongList.length) return;
      for (const w of wrongList) {
        try { await app.saveWrongReason(w.qid, reason); } catch { /* 单题失败不中断 */ }
      }
      showMessage(t("mock.bulkReasonDone").replace("{n}", String(wrongList.length)), 3000, "info");
    }

    function openPractice() {
      void import("siyuan").then(({ openTab }) => {
        openTab({ app: (plugin as any).app ?? (plugin as any), custom: { id: "exam-practice", icon: "iconExam", title: t("tab.practice"), data: { plugin, examApp: app } } } as any);
      });
    }

    function historyPoints(): string {
      return history.map((h, i) => `${(i / Math.max(1, history.length - 1)) * 300},${100 - Math.round(h.percent)}`).join(" ");
    }
    /** 三线对比数据（docs/11 S7）：本次 / 历史均值 / 及格线目标（本地版以及格线为目标锚） */
    const tri = $derived(score ? {
      this: percentBar(score.total, score.full),
      avg: history.length > 1 ? Math.round(history.slice(0, -1).reduce((n, h) => n + h.percent, 0) / (history.length - 1)) : null,
      target: bp.passLine,
    } : null);
    // ---------- 考后估分（v0.5）：答案串对比 / 题库真题序列 ----------
    let estKey = $state("");
    let estMine = $state("");
    let estResult = $state<ReturnType<typeof import("../../core/estimate").estimateScore>>(null);
    let estFromBank = $state(false);
    let activeBankId = $state("");
    let estSourceFilter = $state("");
    let estHistory = $state<any[]>([]);

    $effect(() => {
      if (app) void app.listEstimates().then((h) => (estHistory = h.reverse()));
    });

    $effect(() => {
      if (estFromBank && questions.length) {
        const LETTER_TYPES = new Set(["single", "multiple", "judge"]);
        const pool = estSourceFilter.trim()
          ? questions.filter((q) => LETTER_TYPES.has(q.type) && (q.source ?? "").includes(estSourceFilter.trim()))
          : questions.filter((q) => LETTER_TYPES.has(q.type));
        estKey = pool.map((q) => q.answer).join("");
      }
    });

    async function runEstimate() {
      estResult = estimateScore(estMine, estKey, { scoreEach: 1, passLine: bp.passLine });
      if (estResult) {
        await app.saveEstimate({ key: estKey.slice(0, 40), mine: estMine.slice(0, 40), percent: estResult.percent, score: estResult.score, total: estResult.total });
        estHistory = [...(await app.listEstimates())].reverse();
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
    function downloadMockCsv(csv: string, name: string) {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `小驴考试-模考-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    /** 40-06：模考键盘作答——A-J 选择/多选 toggle、←/→ 导航；
     *  守卫 textarea/input/select/contenteditable 与 IME 组合期/修饰键 */
    function onExamKey(e: KeyboardEvent) {
      if (view !== "exam" || !session || !currentQ) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "TEXTAREA" || tgt.tagName === "INPUT" || tgt.tagName === "SELECT" || tgt.isContentEditable)) return;
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toUpperCase();
      if (/^[A-J]$/.test(key)) {
        const idx = key.charCodeAt(0) - 65;
        if (idx < currentQ.options.length) {
          e.preventDefault();
          pickOption(key);
        }
        return;
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

<div class="fn__flex-1 lv-pad">
  <div class="lv-screen-head"><span class="lv-eyebrow">{t("head.mock.eyebrow")}</span><h1 class="lv-h1">{t("head.mock.title")}</h1><p>{t("head.mock.desc")}</p></div>
  <div class="block__icons">
    <div class="block__logo">
      <svg class="block__logoicon"><use xlink:href="#iconMock"></use></svg>
      {t("tab.mock")}
    </div>
    <SaveStatus gate={app.saves} {t} />
    <span class="fn__flex-1"></span>
    {#if view === "exam"}
      <span class="lv-chip num"><Icon name="clock" size={13} /> {remainText()}</span>
      {#if (session?.state.extraTimeS ?? 0) > 0}
        <span class="lv-chip lv-chip--amb num" title={t("mock.extraTip")}><Icon name="clock" size={13} />+{Math.round((session!.state.extraTimeS ?? 0) / 60)}{t("entry.minutes")}</span>
      {/if}
      <!-- 55-06 lite：单次条件覆盖——延时入快照与成绩记录，原卷不变 -->
      <button class="lv-chip" title={t("mock.extraTip")} onclick={() => { session?.extendTime(300); }}>
        <Icon name="clock" size={13} />+5{t("entry.minutes")}
      </button>
    {/if}
  </div>

  {#if loading}
    <div class="lv-skeleton"></div>
  {:else if errorMsg}
    <div class="lv-error">{errorMsg}</div>
  {:else if view === "config"}
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
          <button class="lv-btn lv-btn--primary sm" onclick={resumeExam}>{t("mock.resumeGo")}</button>
          <button class="lv-btn sm" onclick={discardRun}>{t("mock.resumeDrop")}</button>
        </div>
        <p class="lv-muted" style="margin:6px 0 0">{t("mock.resumeHint")}</p>
      </div>
    {/if}
    <!-- ===== S5 蓝图配置器 ===== -->
    <div class="lv-row">
      <input class="lv-input" bind:value={bp.name} style="max-width:220px" />
      <span class="lv-chip num">{t("mock.totalQ")} {totals.questions}</span>
      <span class="lv-chip num">{t("mock.totalScore")} {totals.score}</span>
      <span class="lv-chip num"><svg class="ic" width="12" height="12"><use xlink:href="#iconMock" /></svg>{Math.round(bp.durationS / 60)} min</span>
      {#each quotaShort as qs, _i (_i)}
        <span class="lv-chip lv-chip--red num" title={t("mock.quotaShortTip")}>⚠ {qs.name} {t("mock.quotaShort").replace("{have}", String(qs.have)).replace("{need}", String(qs.need))}</span>
      {/each}
    </div>
    <div class="lv-bp-table">
      <div class="lv-bp-row head"><span>{t("mock.sec")}</span><span>{t("mock.count")}</span><span>{t("mock.each")}</span><span>{t("mock.source")}</span><span>{t("mock.secKp")}</span><span></span></div>
      {#each bp.sections as s, i (i)}
        <div class="lv-bp-row">
          <input class="lv-input" bind:value={s.name} oninput={() => updateSection(i, { name: s.name })} />
          <input class="lv-input num" type="number" min="0" value={s.count} oninput={(e) => updateSection(i, { count: Math.max(0, parseInt((e.target as HTMLInputElement).value) || 0) })} />
          <input class="lv-input num" type="number" min="0" step="0.1" value={s.scoreEach} oninput={(e) => updateSection(i, { scoreEach: Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0) })} />
          <select class="lv-select" value={s.source} onchange={(e) => updateSection(i, { source: (e.target as HTMLSelectElement).value as any })}>
            <option value="mixed">mixed</option><option value="real">真题</option><option value="mock">模拟</option>
          </select>
          <!-- 55-02 lite：考点配额（前缀匹配；缺口显式计入短缺，不用其他考点补齐） -->
          <input class="lv-input" value={s.kp ?? ""} placeholder={t("mock.secKpHint")}
            oninput={(e) => updateSection(i, { kp: (e.target as HTMLInputElement).value.trim() || undefined })} />
          <button class="lv-btn lv-btn--ghost sm" onclick={() => removeSection(i)}>✕</button>
        </div>
      {/each}
      <div style="padding:8px 12px"><button class="lv-btn sm" style="border-style:dashed;width:100%" onclick={addSection}>＋ {t("mock.addSec")}</button></div>
    </div>
    <div class="lv-row">
      <label class="lv-row" style="margin:0"><input type="checkbox" bind:checked={bp.sectionTimed} /> {t("mock.sectionTimed")}</label>
      <label class="lv-row" style="margin:0"><input type="checkbox" bind:checked={bp.shuffleOptions} disabled /> {t("mock.shuffle")}（v0.4）</label>
      <label class="lv-row" style="margin:0"><input type="checkbox" bind:checked={bp.lockout} /> {t("mock.lockout")}</label>
      <span class="lv-chip">{t("mock.passLine")} <input class="lv-input num" style="width:64px" type="number" bind:value={bp.passLine} /></span>
    </div>
    {#if !bp.sections.length}<div class="lv-empty">{t("mock.needSec")}</div>{/if}
    <div class="lv-row">
      <button class="lv-btn lv-btn--primary" onclick={startExam} disabled={!bp.sections.length}><Icon name="play" size={16} /> {t("mock.start")}</button>
      <button class="lv-btn sm" onclick={saveBlueprint}><Icon name="save" size={14} /> {t("mock.bpSave")}</button>
      <button class="lv-btn sm" onclick={restoreBlueprint}><Icon name="folder" size={14} /> {t("mock.bpRestore")}</button>
    </div>
    <!-- 考后估分 -->
    <details class="lv-card lv-pad-card" style="padding:12px 16px">
      <summary style="cursor:pointer;font-weight:650">{t("estimate.title")}</summary>
      {#if !questions.length}
        <p class="lv-muted">{t("state.emptyBank")}</p>
      {:else}
      <div class="lv-row" style="margin-top:10px">
        <label class="lv-row" style="margin:0"><input type="checkbox" bind:checked={estFromBank} /> {t("estimate.fromBank")}</label>
        {#if estFromBank}
          <input class="lv-input num" style="width:140px" bind:value={estSourceFilter} placeholder={t("estimate.sourceFilter")} />
          <span class="lv-chip num">{t("estimate.bankQ")} {questions.filter((q) => q.type !== "material" && (!estSourceFilter.trim() || (q.source ?? "").includes(estSourceFilter.trim()))).length}</span>
        {:else}
          <span class="lv-chip">{t("estimate.key")}</span>
          <input class="lv-input num" style="flex:1;min-width:160px" bind:value={estKey} placeholder="BADCA…" />
        {/if}
      </div>
      <div class="lv-row" style="margin-top:6px">
        <span class="lv-chip">{t("estimate.mine")}</span>
        <input class="lv-input num" style="flex:1;min-width:160px" bind:value={estMine} placeholder="BADCA…" />
      </div>
      <div class="lv-row">
        <button class="lv-btn sm" onclick={runEstimate} disabled={!estKey.trim() || !estMine.trim()}>{t("estimate.run")}</button>
        {#if estResult}
          <span class="lv-chip num">{t("estimate.score")} <b>{estResult.score}</b>/{estResult.full}</span>
          <span class="lv-chip lv-chip--grn num">✓ {estResult.correct}</span>
          <span class="lv-chip lv-chip--red num">✕ {estResult.wrong}</span>
          {#if estResult.blank}<span class="lv-chip lv-chip--amb num">– {estResult.blank}</span>{/if}
          <span class="lv-chip num">{estResult.percent}%</span>
          <span class="lv-marks num">{estResult.marks.join(" ")}</span>
          {#if estFromBank}
            <div class="lv-row" style="margin:4px 0 0">
              {#each estKey.split("") as _ans, i (i)}
                {@const q = questions.filter((x) => x.type !== "material")[i]}
                {@const mark = estResult.marks[i] ?? "–"}
                {#if q}<span class="lv-chip num" class:lv-chip--grn={mark === "✓"} class:lv-chip--red={mark === "✕"} class:lv-chip--amb={mark === "–"} title={q.stem.slice(0, 60)}>{i + 1}. {q.answer} {mark}</span>{/if}
              {/each}
            </div>
          {/if}
        {/if}
      </div>
      {#if estHistory.length}
        <div class="lv-row" style="margin:6px 0 0">
          <span class="lv-muted">{t("estimate.history")}</span>
          {#each estHistory.slice(0, 8) as h, _i (_i)}
            <span class="lv-chip num" title={new Date(h.at).toLocaleString()}>{h.percent}%</span>
          {/each}
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
          <Icon name="clock" size={13} /> 段 {sr !== null ? `${Math.max(0, Math.floor(sr / 60_000))}:${String(Math.floor((sr % 60_000) / 1000)).padStart(2, "0")}` : "--"}
        </span>
      {/if}
      <span class="lv-chip num">{cursor + 1}/{session.state.qids.length}</span>
      <span class="fn__flex-1"></span>
      <button class="lv-btn sm" onclick={() => { session?.toggleFlag(current); persistRun(); }}>🚩 {session.flags.has(current) ? "✓" : ""}</button>
      <button class="lv-btn sm" title={t("mock.fullscreen")} onclick={(e) => {
        const el = (e.target as HTMLElement).closest(".lv-pad");
        if (!document.fullscreenElement) el?.requestFullscreen?.();
        else document.exitFullscreen?.();
      }}>⛶</button>
      <button class="lv-btn lv-btn--primary sm" disabled={submitting} onclick={() => finishExam(false)}>{t("mock.handIn")}</button>
    </div>
    {#if restoreNote}<div class="lv-error">{restoreNote}</div>{/if}
    <div class="lv-card lv-question">
      <div class="lv-stem">{currentQ.stem}</div>
      {#if currentQ.options.length}
        <!-- 45-03：多选 checkbox/group 语义，单选/判断 radiogroup -->
        <div role={currentQ.type === "multiple" ? "group" : "radiogroup"} aria-label={t("session.options")}>
          {#each currentQ.options as opt, i (i)}
            {@const L = String.fromCharCode(65 + i)}
            <button class="lv-opt" class:sel={currentQ.type === "multiple" ? (answeredMap[current] ?? "").includes(L) : selected === L}
              role={currentQ.type === "multiple" ? "checkbox" : "radio"}
              aria-checked={currentQ.type === "multiple" ? (answeredMap[current] ?? "").includes(L) : selected === L}
              onclick={() => pickOption(L)}>
              <span class="key">{L}</span><span>{opt}</span>
            </button>
          {/each}
        </div>
      {:else}
        <textarea class="lv-input lv-textarea" value={answeredMap[current] ?? ""}
          oninput={(e) => { session?.setAnswer(current, (e.target as HTMLTextAreaElement).value, Date.now()); answeredMap = { ...answeredMap, [current]: (e.target as HTMLTextAreaElement).value }; persistRun(); }}></textarea>
      {/if}
    </div>
    <!-- 答题卡 -->
    <div class="lv-sheet">
      {#each session.state.qids as qid, i (i)}
        <button class="lv-cell" class:done={!!answeredMap[qid]} class:flag={session.flags.has(qid)}
          class:cur={i === cursor} onclick={() => goto(i)}>{i + 1}</button>
      {/each}
    </div>
    <div class="lv-row">
      <button class="lv-btn sm" onclick={() => goto(bp.lockout ? cursor + 1 : cursor - 1)} disabled={bp.lockout ? false : cursor === 0}>◀</button>
      <button class="lv-btn sm" onclick={() => goto(cursor + 1)} disabled={cursor >= session.state.qids.length - 1}><Icon name="play" size={14} /></button>
    </div>
  {:else if view === "report" && score}
    <!-- ===== S7 成绩单 ===== -->
    <div class="lv-row">
      <b style="font-size:16px">{bp.name}</b>
      <span class="lv-chip num">{new Date(startedAt).toLocaleString()}</span>
      {#if session && revisionDrift.length}
        <!-- 55-07 lite：改题后成绩仍按开考冻结版本记录，历史不静默重算 -->
        <span class="lv-chip lv-chip--amb num" title={t("mock.revisedTip")}>✏️ {t("mock.revisedNote").replace("{n}", String(revisionDrift.length))}</span>
      {/if}
    </div>
    <div class="lv-card" style="margin-bottom:14px">
      <div class="lv-row" style="align-items:center;padding:6px 4px">
        <span class="num" style="font-size:40px;font-weight:800;color:var(--lv-accent)">{score.total}</span>
        <span class="lv-muted">/ {score.full}</span>
        <span class="lv-chip" class:grn={score.pass} class:red={!score.pass}>{score.pass ? t("mock.pass") : t("mock.fail")}（{t("mock.passLine")} {bp.passLine}）</span>
        <span class="lv-chip num">{score.percent}%</span>
        {#if tri}
          <div class="lv-row" style="width:100%;margin:10px 0 0">
            <span class="lv-muted" style="width:44px">本次</span>
            <div class="progress" style="flex:1"><i style="width:{tri.this}%"></i></div>
            <span class="num lv-muted">{tri.this}%</span>
          </div>
          {#if tri.avg != null}
            <div class="lv-row" style="width:100%;margin:0">
              <span class="lv-muted" style="width:44px">历均</span>
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
      </div>
    {/each}
    <!-- 45-08 收口：分段/历史图表的文本等价物 + CSV（同一数据快照） -->
    <div class="lv-row" style="margin:6px 0">
      <button class="lv-btn sm lv-btn--ghost" onclick={() => mockTableOpen = !mockTableOpen}>📋 {t("data.table")}</button>
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
        <b style="font-size:13px">{t("mock.radar")}</b>
        <svg viewBox="0 0 220 190" style="width:100%;max-width:300px;margin:0 auto;display:block">
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
      <span class="lv-chip num">🚩 {score.flagsUsed}</span>
      <span class="lv-chip num">{t("mock.changes")} {score.changes}</span>
      <span class="lv-chip num">{t("mock.last20")} {score.last20min.correct}/{score.last20min.attempted}</span>
      {#if session?.state.extraTimeS}
        <!-- 55-06 lite：单次条件覆盖明示（同卷不同条件不混排比较的依据） -->
        <span class="lv-chip lv-chip--amb num" title={t("mock.extraTip")}><Icon name="clock" size={13} />+{Math.round(session.state.extraTimeS / 60)}{t("entry.minutes")}</span>
      {/if}
    </div>
    {#if history.length >= 2}
      <div class="lv-card" style="margin:12px 0">
        <b style="font-size:13px">{t("mock.history")}</b>
        {#if tri}
          <span class="lv-chip num" style="margin-left:auto">本周 {tri.this}% · 上周 {tri.avg ?? "–"}%</span>
        {/if}
        <svg viewBox="0 0 300 110" style="width:100%;max-width:420px;display:block">
          <line x1="0" y1={100 - bp.passLine} x2="300" y2={100 - bp.passLine} stroke="var(--lv-green)" stroke-dasharray="4 4" />
          <polyline points={historyPoints()} fill="none" stroke="var(--lv-accent)" stroke-width="2" />
          {#each history as h, i (i)}
            <circle cx={(i / Math.max(1, history.length - 1)) * 300} cy={100 - Math.round(h.percent)} r="3" fill="var(--lv-accent)"><title>{h.name} {h.percent}%</title></circle>
          {/each}
        </svg>
        <div class="lv-row" style="margin:6px 0 0">
          {#each history.slice(-5) as h, i (i)}
            <button class="lv-chip num" class:acc={historyDetail === history.length - 5 + i}
              title={new Date(h.startedAt).toLocaleString()}
              onclick={() => historyDetail = historyDetail === history.length - 5 + i ? -1 : history.length - 5 + i}>
              {h.name} {h.percent}%{h.pass ? " ✓" : ""}
            </button>
          {/each}
        </div>
        {#if historyDetail >= 0 && history[historyDetail]}
          {@const h = history[historyDetail]}
          <div class="lv-card" style="padding:10px 14px;margin-top:8px">
            <b class="num" style="font-size:13px">{h.name} · {h.percent}%</b>
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
        <b style="font-size:13px">{t("mock.wrongList")}（{wrongList.length}）</b>
        <div class="lv-row" style="margin:8px 0 0;gap:6px">
          {#each wrongList.slice(0, 12) as w, _i (_i)}
            <span class="lv-chip num" title={w.stem}>{w.stem}</span>
          {/each}
          {#if wrongList.length > 12}<span class="lv-muted num">… +{wrongList.length - 12}</span>{/if}
        </div>
        <div class="lv-row" style="margin:8px 0 0">
          <button class="lv-btn sm" disabled={mockActionBusy} onclick={wrongsToActions}>📌 {mockActionBusy ? "…" : t("action.addWrong")}</button>
          <span class="lv-muted">{t("session.reason")}:</span>
          {#each ["careless", "unknown", "trap"] as r, _i (_i)}
            <button class="lv-chip" onclick={() => bulkWrongReason(r as "careless" | "unknown" | "trap")}>{t("reason." + r)}</button>
          {/each}
          {#if mockActionNote}<span class="lv-muted num">{mockActionNote}</span>{/if}
        </div>
      </div>
    {/if}
    <div class="lv-row">
      <button class="lv-btn ghost sm" onclick={exportScoreMd}><Icon name="table" size={13} /> {t("mock.exportScore")}</button>
      {#if activeBankId}
        <button class="lv-btn ghost sm" onclick={async () => {
          if (!score) return;
          const { scoreToMarkdown } = await import("@/core/exportScore");
          const md = scoreToMarkdown(bp, score, startedAt);
          await (app as any).writeScoreDoc(activeBankId, md);
          showMessage(t("report.dailyDone"), 3200, "info");
        }}>📚 {t("mock.exportToDoc")}</button>
      {/if}
      <button class="lv-btn lv-btn--primary" onclick={rewrongDrill}><Icon name="xcircle" size={15} /> {t("mock.rewrong")}</button>
      <button class="lv-btn" onclick={() => { view = "config"; }}><Icon name="rotate" size={15} /> {t("mock.again")}</button>
    </div>
  {/if}
</div>

<style>
  .lv-pad { padding: 16px 22px 48px; overflow: auto; }
  .lv-muted { color: var(--lv-text-3); font-size: 12.5px; }
  .lv-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
  .lv-input { min-height: 44px; padding: 9px 12px; border-radius: 11px; border: 1px solid var(--lv-ctl-border); background: var(--lv-surface); color: var(--lv-text); font: inherit; font-size: 13px; }
  .lv-input:focus { border-color: var(--lv-accent); box-shadow: var(--lv-ring); outline: none; }
  .lv-input.num { width: 72px; }
  .lv-select { min-height: 44px; padding: 9px 12px; border-radius: 11px; border: 1px solid var(--lv-ctl-border); background: var(--lv-surface); color: var(--lv-text); font: inherit; font-size: 13px; }
  .lv-textarea { width: 100%; min-height: 80px; resize: vertical; }
  .lv-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 9px 16px; border-radius: 11px; font-size: 14px; font-weight: 550; border: 1px solid var(--lv-ctl-border); background: var(--lv-surface); color: var(--lv-text); cursor: pointer; transition: background-color var(--lv-dur-micro) ease, border-color var(--lv-dur-micro) ease, box-shadow var(--lv-dur-micro) ease; }
  .lv-btn:hover:not(:disabled) { border-color: var(--lv-accent); background: var(--lv-accent-soft); }
  .lv-btn:disabled { opacity: .62; cursor: not-allowed; }
  .lv-btn--primary { background: var(--lv-accent); border-color: var(--lv-accent); color: var(--b3-theme-on-primary, #fff); box-shadow: var(--lv-btn-primary-shadow); }
  .lv-btn--primary:hover:not(:disabled) { background: var(--lv-accent); filter: brightness(.95); }
  .lv-btn--ghost { border-color: transparent; background: transparent; color: var(--lv-text-2); }
  .lv-btn.sm { min-height: 34px; padding: 5px 12px; font-size: 12.5px; border-radius: 9px; }
  .lv-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 7px; font-size: 12px; font-weight: 550; color: var(--lv-text-2); background: var(--lv-surface-2); border: 1px solid transparent; }
  .lv-chip.grn { color: var(--lv-green); background: var(--lv-green-soft); }
  .lv-chip.red { color: var(--lv-red); background: var(--lv-red-soft); }
  .lv-card { background: var(--lv-surface); border: 1px solid var(--lv-border); border-radius: var(--lv-r-3); padding: 18px 20px; box-shadow: var(--lv-sh-1); }
  .lv-stem { font-size: 19px; line-height: 1.8; letter-spacing: -.2px; margin-bottom: 16px; white-space: pre-wrap; }
  .lv-opt { display: flex; gap: 13px; align-items: center; width: 100%; text-align: left; padding: 14px 17px; border-radius: var(--lv-r-2); border: 1px solid var(--lv-ctl-border); margin-bottom: 10px; cursor: pointer; background: var(--lv-surface); font: inherit; color: inherit; transition: background-color var(--lv-dur-micro) ease, border-color var(--lv-dur-micro) ease; }
  .lv-opt:hover { border-color: var(--lv-accent); background: var(--lv-surface-2); }
  .lv-opt .key { width: 28px; height: 28px; border-radius: 7px; display: grid; place-items: center; flex: none; font-size: 12px; font-weight: 550; background: var(--lv-surface); color: var(--lv-text-2); border: 1px solid var(--lv-ctl-border); }
  .lv-opt.sel { border-color: var(--lv-accent); background: var(--lv-accent-soft); }
  .lv-opt.sel .key { background: var(--lv-accent); border-color: var(--lv-accent); color: var(--b3-theme-on-primary, #fff); }
  .lv-bp-table { border: 1px solid var(--lv-border); border-radius: 12px; overflow: hidden; margin: 10px 0; }
  .lv-bp-row { display: grid; grid-template-columns: 1.1fr .5fr .5fr .8fr 1fr 36px; gap: 8px; padding: 8px 12px; border-bottom: 1px dashed var(--lv-border); align-items: center; }
  .lv-bp-row:last-child { border-bottom: none; }
  .lv-bp-row.head { background: var(--lv-surface-2); font-size: 11.5px; font-weight: 700; color: var(--lv-text-3); border-bottom: 1px solid var(--lv-border); }
  .lv-sheet { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin: 12px 0; }
  .lv-cell { min-width: 0; min-height: 44px; border-radius: 8px; border: 1px solid var(--lv-border); background: var(--lv-surface); font-size: 12px; font-variant-numeric: tabular-nums; color: var(--lv-text-2); cursor: pointer; }
  .lv-cell.done { background: var(--lv-green-soft); color: var(--lv-green); border-color: transparent; }
  .lv-cell.flag { outline: 2px solid var(--lv-amber); }
  .lv-cell.cur { background: var(--lv-accent); color: var(--b3-theme-on-primary, #fff); border-color: transparent; }
  .lv-error { margin: 8px 0; padding: 10px 14px; border-radius: var(--lv-r-2); background: var(--lv-red-soft); color: var(--lv-red); font-size: 13px; }
  .lv-empty { border: 1.5px dashed var(--lv-border); border-radius: 14px; padding: 26px; text-align: center; color: var(--lv-text-3); }
  .lv-skeleton { height: 160px; border-radius: var(--lv-r-3); background: linear-gradient(100deg, var(--lv-surface-2) 40%, var(--lv-surface) 50%, var(--lv-surface-2) 60%); background-size: 200% 100%; animation: lv-shim 1.4s infinite; }
  @keyframes lv-shim { to { background-position: -200% 0; } }
  .progress { height: 6px; border-radius: 999px; background: var(--lv-surface-2); overflow: hidden; }
  .progress i { display: block; height: 100%; background: var(--lv-accent-grad); border-radius: 999px; }
  @media (prefers-reduced-motion: reduce) { .lv-skeleton { animation: none; } .lv-opt, .lv-btn { transition: none; } }
</style>
