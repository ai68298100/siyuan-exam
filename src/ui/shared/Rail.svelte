<script lang="ts">
  // 侧栏导航 rail（原型 .sidebar shell 的共享实现）：品牌位 + 全局三项导航 +
  // 各 Tab 上下文导航项（可选）+ 底部隐私说明。三 Tab（练习/模考/报告）共用。
  // V04：窄屏抽屉契约——open 时 fixed 抽屉 + 遮罩；Esc/遮罩/关闭钮关闭；
  // 打开聚焦关闭钮，Tab 焦点循环锁在 rail 内，关闭后由父级归还焦点。
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";

  let {
    active,
    plugin,
    items = [],
    onnavigate,
    open = false,
    onclose,
    project,
    onproject,
  }: {
    active: "practice" | "mock" | "report";
    plugin: any;
    /** Tab 内上下文导航项（如练习台的浏览/导入/录题…） */
    items?: { icon: string; name: string; on: boolean; onclick: () => void }[];
    /** 全局项点击的 Tab 内接管（缺省走 plugin.openPractice/openMock/openReport） */
    onnavigate?: (target: "practice" | "mock" | "report") => void;
    /** 窄屏抽屉开合（桌面端常显，不受影响） */
    open?: boolean;
    onclose?: () => void;
    /** 73-02/原型 project-switch：当前题库上下文卡（品牌位下方） */
    project?: { name: string; kicker: string };
    onproject?: () => void;
  } = $props();

  const t = (k: string, fb = "") => ((plugin?.i18n as Record<string, string>) ?? {})[k] ?? fb;

  let asideEl: HTMLElement | null = null;
  let closeBtn: HTMLButtonElement | null = null;

  // 打开时聚焦关闭钮（焦点移入抽屉）
  $effect(() => {
    if (open) tick().then(() => closeBtn?.focus());
  });

  function onKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
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
    if (open) onclose?.();
  }

  function go(target: "practice" | "mock" | "report") {
    if (onnavigate) return onnavigate(target);
    if (target === "practice") plugin?.openPractice?.();
    else if (target === "mock") plugin?.openMock?.();
    else plugin?.openReport?.();
  }

  const globals = [
    { target: "practice" as const, icon: "home", label: t("tab.practice", "练习台") },
    { target: "mock" as const, icon: "clock", label: t("tab.mock", "模考场") },
    { target: "report" as const, icon: "chart", label: t("tab.report", "报告中心") },
  ];
</script>

<svelte:window onkeydown={onKeydown} />
{#if open}
  <button class="lv-nav-backdrop" aria-label={t("menu.closeNav", "关闭导航")} onclick={() => onclose?.()}></button>
{/if}
<aside class="lv-rail" class:open bind:this={asideEl} aria-label="Lv Exam">
  <div class="lv-brand">
    <span class="lv-brand-mark" aria-hidden="true">驴</span>
    <span class="lv-brand-name">小驴考试<span class="lv-brand-sub">LV EXAM</span></span>
    <button class="lv-drawer-close" bind:this={closeBtn} aria-label={t("menu.close", "关闭")} onclick={() => onclose?.()}>
      <Icon name="close" size={15} />
    </button>
  </div>
  {#if project}
    <!-- 原型 .project-switch：当前题库上下文卡（surface 底+阴影；点击回入口/练习台） -->
    <button class="lv-project" onclick={() => onproject?.()} title={project.name}>
      <span class="lv-project-kicker">{project.kicker}</span>
      <span class="lv-project-name">{project.name}</span>
      <span class="lv-project-go">↗</span>
    </button>
  {/if}
  <div>
    <p class="lv-nav-label">{t("rail.workbench", "")}</p>
    <nav class="lv-rail-nav">
      {#each globals as g (g.target)}
        <button class="lv-rail-btn" class:on={active === g.target} onclick={() => { go(g.target); if (open) onclose?.(); }} aria-current={active === g.target ? "page" : undefined}>
          <Icon name={g.icon} size={16} /> {g.label}
        </button>
      {/each}
      {#if items.length}
        <div class="lv-rail-divider" role="separator"></div>
        {#each items as it (it.name)}
          <button class="lv-rail-btn lv-rail-btn--sub" class:on={it.on} onclick={() => nav(it)} aria-current={it.on ? "page" : undefined}>
            <Icon name={it.icon} size={16} /> {it.name}
          </button>
        {/each}
      {/if}
    </nav>
  </div>
  <div class="lv-rail-note">{t("rail.note", "")}</div>
</aside>

<style>
  .lv-rail {
    border-right: 1px solid var(--lv-border);
    background: color-mix(in srgb, var(--lv-text) 3%, var(--lv-surface-2));
    padding: 18px 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    overflow: auto;
  }
  .lv-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 8px;
  }
  .lv-brand-mark {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    background: var(--lv-accent);
    color: var(--b3-theme-on-primary, #fff);
    font-family: Georgia, "Songti SC", serif;
    font-size: 19px;
    box-shadow: var(--lv-btn-primary-shadow);
    flex-shrink: 0;
  }
  .lv-brand-name {
    font-size: 15px;
    font-weight: 650;
    line-height: 1.25;
  }
  .lv-brand-sub {
    display: block;
    font-size: 9px;
    letter-spacing: 2px;
    color: var(--lv-text-3);
    font-weight: 500;
  }
  .lv-rail-nav {
    display: grid;
    gap: 4px;
  }
  /* 原型 .project-switch：当前题库上下文卡 */
  .lv-project {
    display: block;
    width: 100%;
    text-align: left;
    padding: 12px 14px;
    background: var(--lv-surface);
    border: 1px solid var(--lv-border);
    border-radius: var(--lv-r-2);
    box-shadow: var(--lv-sh-1);
    cursor: pointer;
    transition:
      box-shadow var(--lv-dur-micro) ease,
      border-color var(--lv-dur-micro) ease;
  }
  .lv-project:hover {
    border-color: var(--lv-accent);
    box-shadow: var(--lv-sh-2);
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
    display: block;
    font-size: 13.5px;
    font-weight: 600;
    line-height: 1.5;
    color: var(--lv-text);
    overflow-wrap: anywhere;
  }
  .lv-project-go {
    display: block;
    margin-top: 4px;
    font-size: 11px;
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
    gap: 10px;
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    border: 1px solid transparent;
    border-radius: var(--lv-r-2);
    background: transparent;
    color: var(--lv-text-2);
    font-size: 13px;
    min-height: 40px;
    cursor: pointer;
    transition:
      background-color var(--lv-dur-micro) ease,
      color var(--lv-dur-micro) ease;
  }
  .lv-rail-btn:hover {
    background: var(--lv-surface);
    color: var(--lv-text);
  }
  .lv-rail-btn.on {
    background: var(--lv-surface);
    color: var(--lv-accent);
    border-color: var(--lv-border);
    font-weight: 600;
    box-shadow: var(--lv-sh-1);
  }
  .lv-rail-btn.on::before {
    content: "";
    position: absolute;
    left: -1px;
    top: 9px;
    bottom: 9px;
    width: 3px;
    background: var(--lv-accent);
    border-radius: 0 3px 3px 0;
  }
  .lv-rail-btn--sub {
    color: var(--lv-text-2);
  }
  .lv-rail-divider {
    height: 1px;
    background: var(--lv-border);
    margin: 6px 4px;
  }
  .lv-rail-note {
    margin-top: auto;
    padding: 10px 8px 0;
    font-size: 11px;
    line-height: 1.8;
    color: var(--lv-text-3);
  }
  /* V04 抽屉件：遮罩 + 关闭钮（窄屏） */
  .lv-nav-backdrop {
    position: fixed;
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
  @media (max-width: 1023px) {
    .lv-drawer-close {
      display: grid;
    }
  }
</style>
