<script lang="ts">
  // 侧栏导航 rail（原型 .sidebar shell 的共享实现）：品牌位 + 全局三项导航 +
  // 各 Tab 上下文导航项（可选）+ 底部隐私说明。三 Tab（练习/模考/报告）共用。
  // V04：窄屏抽屉契约——open 时在插件面板内显示抽屉 + 遮罩；Esc/遮罩/关闭钮关闭；
  // 打开聚焦关闭钮，Tab 焦点循环锁在 rail 内，关闭后由父级归还焦点。
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";
  import { openPracticeView } from "../../core/pluginTab";

  type TaskTarget = "today" | "bank" | "create" | "mock" | "report";

  let {
    active,
    plugin,
    items = [],
    taskactive,
    ontasknavigate,
    tasknavhidden = false,
    open = false,
    onclose,
    project,
    onproject,
    onquickcreate,
  }: {
    active: "practice" | "mock" | "report";
    plugin: any;
    /** Tab 内上下文导航项（如练习台的浏览/错题本/导入/录题…） */
    items?: { icon: string; name: string; on: boolean; badge?: string; onclick: () => void }[];
    /** R54 五项任务导航的当前项及宿主接管。 */
    taskactive?: TaskTarget;
    ontasknavigate?: (target: TaskTarget) => void;
    tasknavhidden?: boolean;
    /** 窄屏抽屉开合（桌面端常显，不受影响） */
    open?: boolean;
    onclose?: () => void;
    /** 73-02/原型 project-switch：当前题库上下文卡（品牌位下方） */
    project?: { name: string; kicker: string };
    onproject?: () => void;
    /** R54 任务入口：在练习工作台直接录入一道题。 */
    onquickcreate?: () => void;
  } = $props();

  const t = (k: string, fb = "") => ((plugin?.i18n as Record<string, string>) ?? {})[k] ?? fb;

  let asideEl: HTMLElement | null = $state(null);
  let closeBtn: HTMLButtonElement | null = null;
  let returnFocus: HTMLElement | null = null;
  let wasDrawerOpen = false;
  let launcherOpen = $state(false);
  let launcherWrapEl = $state<HTMLElement | null>(null);

  function toggleLauncher(e: MouseEvent) {
    e.stopPropagation();
    launcherOpen = !launcherOpen;
  }

  function closeLauncher() {
    launcherOpen = false;
  }

  function runQuickAction(act: "drill" | "create" | "mock" | "wrong" | "import" | "ai") {
    closeLauncher();
    if (drawerOpen) onclose?.();
    switch (act) {
      case "drill":
        openPracticeView(plugin, "entry");
        break;
      case "create":
        if (onquickcreate) onquickcreate();
        else openPracticeView(plugin, "manual");
        break;
      case "mock":
        plugin?.openMock?.();
        break;
      case "wrong":
        openPracticeView(plugin, "wrongbook");
        break;
      case "import":
        openPracticeView(plugin, "import");
        break;
      case "ai":
        openPracticeView(plugin, "ai");
        break;
    }
  }

  function onWindowClick(e: MouseEvent) {
    if (launcherOpen && launcherWrapEl && !launcherWrapEl.contains(e.target as Node)) {
      closeLauncher();
    }
  }

  // The rail is a desktop sidebar until the responsive breakpoint. Keep the
  // drawer contract scoped to the narrow layout so a resize while it is open
  // cannot leave a backdrop or an inert main panel behind.
  let narrow = $state(false);
  const drawerOpen = $derived(open && narrow);

  $effect(() => {
    const container = asideEl?.closest<HTMLElement>(".lv-exam-tab");
    if (!container || typeof ResizeObserver === "undefined") return;
    const update = (width: number) => (narrow = width <= 759);
    update(container.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number") update(width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  });

  // A modal drawer must remove the shell's background surfaces from both
  // pointer and accessibility navigation. Restore any pre-existing
  // attributes on close or when the component is destroyed.
  $effect(() => {
    const active = drawerOpen;
    const shell = asideEl?.parentElement;
    const root = shell?.parentElement;
    if (!shell) return;
    const background: HTMLElement[] = [];
    const addBackground = (node: HTMLElement) => {
      if (!background.includes(node)) background.push(node);
    };
    for (const node of shell.children) {
      if (node instanceof HTMLElement && node !== asideEl && !node.classList.contains("lv-nav-backdrop")) addBackground(node);
    }
    for (const node of root?.children ?? []) {
      if (node instanceof HTMLElement && node !== shell) addBackground(node);
    }
    if (!background.length) return;
    const previous = [...background].map((node) => ({
      node,
      hadInert: node.hasAttribute("inert"),
      ariaHidden: node.getAttribute("aria-hidden"),
    }));
    if (active) for (const { node } of previous) {
      node.setAttribute("inert", "");
      node.setAttribute("aria-hidden", "true");
    }
    return () => {
      for (const { node, hadInert, ariaHidden } of previous) {
        if (hadInert) node.setAttribute("inert", "");
        else node.removeAttribute("inert");
        if (ariaHidden === null) node.removeAttribute("aria-hidden");
        else node.setAttribute("aria-hidden", ariaHidden);
      }
    };
  });

  // 聚焦与归还都等待 inert 更新；父页面立即聚焦触发钮时，背景可能仍被锁定。
  $effect(() => {
    if (drawerOpen) {
      if (!wasDrawerOpen && document.activeElement instanceof HTMLElement) returnFocus = document.activeElement;
      wasDrawerOpen = true;
      tick().then(() => { if (drawerOpen) closeBtn?.focus(); });
    } else if (wasDrawerOpen) {
      wasDrawerOpen = false;
      const target = returnFocus;
      returnFocus = null;
      tick().then(() => {
        if (target?.isConnected && target.getClientRects().length) target.focus();
        else if (asideEl?.getClientRects().length) asideEl.querySelector<HTMLElement>(".lv-rail-btn[aria-current='page']")?.focus();
      });
    }
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && launcherOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeLauncher();
      return;
    }
    if (!drawerOpen || !asideEl?.getClientRects().length) return;
    // 命令面板可能在导航抽屉上方打开；抽屉仅接管自己的焦点，避免互相锁死。
    if (!(e.target instanceof Node) || !asideEl.contains(e.target)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onclose?.();
      return;
    }
    // V04 焦点循环：Tab 锁在抽屉内（仅抽屉打开时接管）
    if (e.key === "Tab" && asideEl) {
      const focusables = [...asideEl.querySelectorAll<HTMLElement>("button:not([disabled])")];
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const idx = focusables.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && (idx <= 0)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (idx === focusables.length - 1 || idx === -1)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function nav(item: { onclick: () => void }) {
    item.onclick();
    // 窄屏抽屉内完成导航后自动收回
    if (drawerOpen) onclose?.();
  }

  function goTask(target: TaskTarget) {
    if (ontasknavigate) return ontasknavigate(target);
    if (target === "mock") return plugin?.openMock?.();
    if (target === "report") return plugin?.openReport?.();
    const view = target === "today" ? "entry" : target === "bank" ? "browse" : "manual";
    openPracticeView(plugin, view);
  }

  const globals = [
    { target: "today" as const, icon: "home", label: t("task.today", "今日") },
    { target: "bank" as const, icon: "book", label: t("task.bank", "题库") },
    { target: "create" as const, icon: "pencil", label: t("task.create", "出题") },
    { target: "mock" as const, icon: "clock", label: t("task.mock", "模考") },
    { target: "report" as const, icon: "chart", label: t("task.report", "复盘") },
  ];
  const activeTask = $derived(taskactive ?? (active === "practice" ? "today" : active));
</script>

<svelte:window onkeydown={onKeydown} onclick={onWindowClick} />
{#if drawerOpen}
  <button class="lv-nav-backdrop" aria-label={t("menu.closeNav", "关闭导航")} onclick={() => onclose?.()}></button>
{/if}
<aside class="lv-rail" class:open={drawerOpen} bind:this={asideEl} role={drawerOpen ? "dialog" : undefined} aria-modal={drawerOpen ? "true" : undefined} aria-label="小驴考试（内测版）">
  <div class="lv-brand">
    <span class="lv-brand-mark" aria-hidden="true">驴</span>
    <span class="lv-brand-name">小驴考试（内测版）<span class="lv-brand-sub">LV EXAM</span></span>
    <button class="lv-drawer-close" bind:this={closeBtn} aria-label={t("menu.close", "关闭")} onclick={() => onclose?.()}>
      <Icon name="close" size={15} />
    </button>
  </div>
  {#if project}
    <!-- 原型 .project-switch：当前题库上下文卡（surface 底+阴影；点击回入口/练习台） -->
    <button class="lv-project" onclick={() => nav({ onclick: () => onproject?.() })} title={project.name}>
      <span class="lv-project-kicker">{project.kicker}</span>
      <span class="lv-project-row">
        <span class="lv-project-name">{project.name}</span>
        <span class="lv-project-go" aria-hidden="true">↗</span>
      </span>
    </button>
  {/if}
  <div class="lv-quick-launcher-wrap" bind:this={launcherWrapEl}>
    <button
      class="lv-quick-create"
      class:active={launcherOpen}
      title={t("rail.quickActions", "快捷行动")}
      aria-expanded={launcherOpen}
      aria-haspopup="menu"
      onclick={toggleLauncher}
    >
      <span class="lv-quick-create-lead">
        <Icon name="zap" size={15} />
        <span class="lv-quick-create-text">{t("rail.quickActions", "快捷行动")}</span>
      </span>
      <span class="lv-quick-create-chevron" class:expanded={launcherOpen} aria-hidden="true">▾</span>
    </button>
    {#if launcherOpen}
      <div class="lv-quick-popover" role="menu" aria-label={t("rail.quickActions", "快捷行动")}>
        <button class="lv-quick-menu-item" role="menuitem" onclick={() => runQuickAction("drill")}>
          <span class="lv-quick-item-badge lv-quick-item-badge--zap"><Icon name="play" size={13} /></span>
          <div class="lv-quick-item-meta">
            <span class="lv-quick-item-title">{t("rail.quickDrill", "即刻刷题")}</span>
            <span class="lv-quick-item-desc">{t("rail.quickDrillHint", "快速开练 15 道题")}</span>
          </div>
        </button>
        <button class="lv-quick-menu-item" role="menuitem" onclick={() => runQuickAction("create")}>
          <span class="lv-quick-item-badge lv-quick-item-badge--pen"><Icon name="pencil" size={13} /></span>
          <div class="lv-quick-item-meta">
            <span class="lv-quick-item-title">{t("rail.quickCreate", "快速录题")}</span>
            <span class="lv-quick-item-desc">{t("rail.quickCreateHint", "录入一道新题目")}</span>
          </div>
        </button>
        <button class="lv-quick-menu-item" role="menuitem" onclick={() => runQuickAction("mock")}>
          <span class="lv-quick-item-badge lv-quick-item-badge--clock"><Icon name="clock" size={13} /></span>
          <div class="lv-quick-item-meta">
            <span class="lv-quick-item-title">{t("rail.quickMock", "全真模考")}</span>
            <span class="lv-quick-item-desc">{t("rail.quickMockHint", "标准模拟考试")}</span>
          </div>
        </button>
        <button class="lv-quick-menu-item" role="menuitem" onclick={() => runQuickAction("wrong")}>
          <span class="lv-quick-item-badge lv-quick-item-badge--red"><Icon name="xcircle" size={13} /></span>
          <div class="lv-quick-item-meta">
            <span class="lv-quick-item-title">{t("rail.quickWrong", "错题特训")}</span>
            <span class="lv-quick-item-desc">{t("rail.quickWrongHint", "消灭在册错题")}</span>
          </div>
        </button>
        <button class="lv-quick-menu-item" role="menuitem" onclick={() => runQuickAction("import")}>
          <span class="lv-quick-item-badge lv-quick-item-badge--lavender"><Icon name="import" size={13} /></span>
          <div class="lv-quick-item-meta">
            <span class="lv-quick-item-title">{t("rail.quickImport", "批量导入")}</span>
            <span class="lv-quick-item-desc">{t("rail.quickImportHint", "Excel / CSV / 剪贴板")}</span>
          </div>
        </button>
        <button class="lv-quick-menu-item" role="menuitem" onclick={() => runQuickAction("ai")}>
          <span class="lv-quick-item-badge lv-quick-item-badge--accent"><Icon name="sparkles" size={13} /></span>
          <div class="lv-quick-item-meta">
            <span class="lv-quick-item-title">{t("rail.quickAi", "AI 出题")}</span>
            <span class="lv-quick-item-desc">{t("rail.quickAiHint", "智能解析与出题")}</span>
          </div>
        </button>
      </div>
    {/if}
  </div>
  <div>
    <p class="lv-nav-label">{t("rail.workbench", "")}</p>
    <nav class="lv-rail-nav">
      {#each globals as g (g.target)}
        <button class="lv-rail-btn" class:on={activeTask === g.target} title={g.label} aria-label={g.label} onclick={() => { goTask(g.target); if (drawerOpen) onclose?.(); }} aria-current={activeTask === g.target ? "page" : undefined}>
          <Icon name={g.icon} size={16} /> {g.label}
        </button>
      {/each}
      {#if items.length}
        <div class="lv-rail-divider" role="separator"></div>
        {#each items as it (it.name)}
          <button class="lv-rail-btn lv-rail-btn--sub" class:on={it.on} title={it.name} onclick={() => nav(it)} aria-current={it.on ? "page" : undefined}>
            <Icon name={it.icon} size={16} /> {it.name}
            {#if it.badge}<span class="lv-rail-badge">{it.badge}</span>{/if}
          </button>
        {/each}
      {/if}
    </nav>
  </div>
  <div class="lv-rail-note">{t("rail.note", "")}</div>
</aside>
<nav class="lv-mobile-tasknav" class:focus={tasknavhidden} aria-label={t("rail.tasks", "主要功能")}>
  {#each globals as g (g.target)}
    <button class="lv-mobile-task" class:on={activeTask === g.target} aria-current={activeTask === g.target ? "page" : undefined} onclick={() => goTask(g.target)}>
      <Icon name={g.icon} size={18} />
      <span>{g.label}</span>
    </button>
  {/each}
</nav>

<style>
  .lv-rail {
    border-right: 1px solid var(--lv-border);
    background: color-mix(in srgb, var(--lv-text) 3%, var(--lv-surface-2));
    padding: 26px 14px 18px;
    display: flex;
    flex-direction: column;
    gap: var(--lv-space-section);
    overflow: auto;
  }
  .lv-brand {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 10px;
  }
  .lv-brand-mark {
    width: 29px;
    height: 34px;
    border-radius: 0;
    display: grid;
    place-items: center;
    background: transparent;
    color: var(--lv-accent);
    font-family: Georgia, "Songti SC", serif;
    font-size: 22px;
    flex-shrink: 0;
  }
  .lv-brand-name {
    font-size: var(--lv-font-size-h3);
    font-weight: var(--lv-font-weight-semibold);
    line-height: 1.25;
  }
  .lv-brand-sub {
    display: block;
    font-size: 9px;
    letter-spacing: 2px;
    color: var(--lv-text-3);
    font-weight: 500;
    white-space: nowrap; /* 极窄屏 Rail 挤压时防竖排 */
  }
  .lv-rail-nav {
    display: grid;
    gap: var(--lv-space-1);
  }
  .lv-mobile-tasknav {
    display: none;
    position: absolute;
    inset: auto 0 0;
    z-index: 80;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    padding: 6px 8px max(6px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--lv-border-subtle, var(--lv-border));
    background: color-mix(in srgb, var(--lv-surface) 92%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 -4px 20px color-mix(in srgb, var(--lv-text) 6%, transparent), var(--lv-inset-subtle, inset 0 1px 0 transparent);
  }
  .lv-mobile-task {
    display: grid;
    min-width: 0;
    min-height: 52px;
    place-items: center;
    align-content: center;
    gap: 3px;
    padding: 5px 2px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--lv-text-2);
    font: inherit;
    font-size: var(--lv-font-size-label);
    line-height: 1.2;
    cursor: pointer;
    touch-action: manipulation;
    transition:
      transform var(--lv-dur-micro) var(--lv-ease-out),
      background-color var(--lv-dur-micro) var(--lv-ease-out),
      color var(--lv-dur-micro) var(--lv-ease-out);

    &:active {
      transform: scale(0.92);
    }
  }
  .lv-mobile-task.on {
    background: var(--lv-accent-soft);
    color: var(--lv-accent);
    font-weight: var(--lv-font-weight-semibold, 600);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--lv-accent) 22%, transparent);
  }
  .lv-mobile-task:focus-visible {
    outline: 2px solid var(--lv-accent);
    outline-offset: 1px;
  }
  @container lv-exam (min-width: 760px) and (max-width: 1119px) {
    .lv-rail {
      padding: 22px 10px;
    }
    .lv-brand {
      justify-content: center;
      padding: 0;
    }
    .lv-brand-name,
    .lv-project,
    .lv-nav-label,
    .lv-rail-note {
      display: none;
    }
    .lv-quick-create {
      justify-content: center;
      min-height: 44px;
      padding: 10px;
      font-size: 0;
    }
    .lv-quick-create-text,
    .lv-quick-create-chevron {
      display: none;
    }
    .lv-quick-popover {
      left: 100%;
      top: 0;
      margin-left: 8px;
    }
    .lv-rail-btn {
      justify-content: center;
      min-height: 44px;
      padding: 10px;
      font-size: 0;
    }
    .lv-rail-btn :global(svg) {
      flex: 0 0 auto;
    }
    .lv-rail-badge {
      display: none;
    }
  }
  /* 原型 .project-switch：当前题库上下文卡 */
  .lv-project {
    display: block;
    width: 100%;
    text-align: left;
    padding: 12px 14px;
    background: var(--lv-surface);
    border: 1px solid var(--lv-border-subtle, var(--lv-border));
    border-radius: var(--lv-r-2);
    box-shadow: var(--lv-sh-card, var(--lv-sh-1)), var(--lv-inset-subtle, inset 0 1px 0 transparent);
    cursor: pointer;
    transition:
      transform var(--lv-dur-micro) ease,
      box-shadow var(--lv-dur-micro) ease,
      border-color var(--lv-dur-micro) ease;
  }
  .lv-project:hover {
    transform: translateY(-1px);
    border-color: var(--lv-border-hover, var(--lv-accent));
    box-shadow: var(--lv-sh-2), var(--lv-inset-subtle, inset 0 1px 0 transparent);
  }
  .lv-quick-launcher-wrap {
    position: relative;
    width: 100%;
  }
  .lv-quick-create {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--lv-space-2);
    width: 100%;
    min-height: 40px;
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--lv-accent) 24%, var(--lv-border));
    border-radius: var(--lv-radius-control-sm);
    background: var(--lv-accent-soft);
    color: var(--lv-accent);
    box-shadow: var(--lv-sh-1), var(--lv-inset-subtle, inset 0 1px 0 transparent);
    font: inherit;
    font-size: var(--lv-font-size-meta);
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
    transition:
      transform var(--lv-dur-micro) ease,
      background-color var(--lv-dur-micro) ease,
      border-color var(--lv-dur-micro) ease,
      box-shadow var(--lv-dur-micro) ease;
  }
  .lv-quick-create:hover {
    transform: translateY(-1px);
    border-color: var(--lv-accent);
    background: var(--lv-surface);
    box-shadow: var(--lv-sh-2);
  }
  .lv-quick-create:active {
    transform: scale(0.98);
  }
  .lv-quick-create.active {
    border-color: var(--lv-accent);
    background: var(--lv-surface);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--lv-accent) 20%, transparent);
  }
  .lv-quick-create-lead {
    display: inline-flex;
    align-items: center;
    gap: var(--lv-space-2);
    min-width: 0;
  }
  .lv-quick-create-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lv-quick-create-chevron {
    font-size: 11px;
    line-height: 1;
    color: var(--lv-accent);
    transition: transform var(--lv-dur-micro) ease;
  }
  .lv-quick-create-chevron.expanded {
    transform: rotate(180deg);
  }
  .lv-quick-popover {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    width: 220px;
    max-width: calc(100vw - 32px);
    z-index: 100;
    background: var(--lv-surface);
    border: 1px solid var(--lv-border);
    border-radius: var(--lv-r-2);
    box-shadow: var(--lv-sh-pop);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .lv-quick-menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    width: 100%;
    border: 0;
    border-radius: var(--lv-radius-control-sm);
    background: transparent;
    color: var(--lv-text);
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
    transition: background-color var(--lv-dur-micro) ease, transform var(--lv-dur-micro) ease;
  }
  .lv-quick-menu-item:hover {
    background: var(--lv-surface-2);
    transform: translateX(2px);
  }
  .lv-quick-menu-item:active {
    transform: scale(0.98);
  }
  .lv-quick-item-badge {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    flex-shrink: 0;
  }
  .lv-quick-item-badge--zap { background: var(--lv-amber-soft); color: var(--lv-amber); }
  .lv-quick-item-badge--pen { background: var(--lv-accent-soft); color: var(--lv-accent); }
  .lv-quick-item-badge--clock { background: color-mix(in srgb, var(--lv-accent) 15%, transparent); color: var(--lv-accent); }
  .lv-quick-item-badge--red { background: var(--lv-red-soft); color: var(--lv-red); }
  .lv-quick-item-badge--lavender { background: color-mix(in srgb, var(--lv-accent) 12%, transparent); color: var(--lv-accent); }
  .lv-quick-item-badge--accent { background: var(--lv-accent-soft); color: var(--lv-accent); }
  .lv-quick-item-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .lv-quick-item-title {
    font-size: var(--lv-font-size-meta);
    font-weight: 600;
    color: var(--lv-text);
    line-height: 1.3;
  }
  .lv-quick-item-desc {
    font-size: 10px;
    color: var(--lv-text-3);
    line-height: 1.3;
  }
  .lv-project-kicker {
    display: block;
    color: var(--lv-text-3);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.6px;
    margin-bottom: 4px;
  }
  .lv-project-name {
    flex: 1;
    min-width: 0;
    font-size: var(--lv-font-size-body);
    font-weight: 600;
    line-height: 1.5;
    color: var(--lv-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* 原型 project-switch：↗ 与名称同行收尾（不孤行） */
  .lv-project-row {
    display: flex;
    align-items: center;
    gap: var(--lv-space-compact);
    min-width: 0;
  }
  .lv-project-go {
    flex-shrink: 0;
    font-size: var(--lv-font-size-label);
    color: var(--lv-text-3);
  }
  /* 原型 .nav-label：10px 字距分组标签 */
  .lv-nav-label {
    font-size: 10px;
    letter-spacing: 0.6px;
    color: var(--lv-text-3);
    padding: 0 13px;
    margin: 2px 0 10px;
  }
  .lv-rail-btn {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--lv-space-relaxed);
    width: 100%;
    text-align: left;
    padding: 10px 14px;
    border: 1px solid transparent;
    border-radius: var(--lv-radius-control-sm);
    background: transparent;
    color: var(--lv-text-2);
    font-size: var(--lv-font-size-body-compact);
    min-height: 46px;
    cursor: pointer;
    transition:
      background-color var(--lv-dur-micro) ease,
      color var(--lv-dur-micro) ease,
      transform var(--lv-dur-micro) ease;
  }
  .lv-rail-btn:hover {
    background: var(--lv-surface);
    color: var(--lv-text);
    transform: translateX(2px);
  }
  .lv-rail-btn.on {
    background: var(--lv-accent-soft);
    color: var(--lv-accent);
    border-color: color-mix(in srgb, var(--lv-accent) 22%, transparent);
    font-weight: 600;
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--lv-accent) 15%, transparent);
  }
  .lv-rail-btn.on::before {
    content: "";
    position: absolute;
    left: -1px;
    top: 9px;
    bottom: 9px;
    width: 3.5px;
    background: var(--lv-accent);
    border-radius: 0 3px 3px 0;
    box-shadow: 0 0 6px color-mix(in srgb, var(--lv-accent) 60%, transparent);
  }
  .lv-rail-btn--sub {
    color: var(--lv-text-2);
  }
  /* 组级徽标（规范 v6：错题在册数等计数；tabular） */
  .lv-rail-badge {
    margin-left: auto;
    font-size: var(--lv-font-size-label);
    background: var(--lv-accent-soft);
    color: var(--lv-accent);
    border-radius: 6px;
    padding: 0 7px;
    font-variant-numeric: tabular-nums;
  }
  .lv-rail-divider {
    height: 1px;
    background: var(--lv-border);
    margin: 6px 4px;
  }
  .lv-rail-note {
    margin-top: auto;
    margin-left: 8px;
    margin-right: 8px;
    padding: 13px 12px;
    border-radius: 14px;
    background: var(--lv-amber-soft);
    color: var(--lv-amber);
    border: 1px solid color-mix(in srgb, var(--lv-amber) 20%, transparent);
    box-shadow: var(--lv-sh-1), var(--lv-inset-subtle, inset 0 1px 0 transparent);
    font-size: var(--lv-font-size-sm);
    line-height: 1.65;
  }
  /* V04 抽屉件：遮罩 + 关闭钮（窄屏） */
  .lv-nav-backdrop {
    position: absolute;
    inset: 0;
    z-index: 89;
    background: var(--lv-overlay);
    border: 0;
    padding: 0;
    cursor: default;
  }
  .lv-drawer-close {
    display: none;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 1px solid var(--lv-border);
    background: var(--lv-surface);
    color: var(--lv-text-2);
    cursor: pointer;
    margin-left: auto;
    flex-shrink: 0;
  }
  @container lv-exam (max-width: 759px) {
    .lv-mobile-tasknav {
      display: grid;
    }
    .lv-mobile-tasknav.focus {
      display: none;
    }
    .lv-drawer-close {
      display: grid;
      width: 44px;
      height: 44px;
      min-width: 44px;
      min-height: 44px;
    }
  }
</style>
