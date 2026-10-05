<script lang="ts">
  // 侧栏导航 rail（原型 .sidebar shell 的共享实现）：品牌位 + 全局三项导航 +
  // 各 Tab 上下文导航项（可选）+ 底部隐私说明。三 Tab（练习/模考/报告）共用。
  import Icon from "./Icon.svelte";

  let {
    active,
    plugin,
    items = [],
    onnavigate,
  }: {
    active: "practice" | "mock" | "report";
    plugin: any;
    /** Tab 内上下文导航项（如练习台的浏览/导入/录题…） */
    items?: { icon: string; name: string; on: boolean; onclick: () => void }[];
    /** 全局项点击的 Tab 内接管（缺省走 plugin.openPractice/openMock/openReport） */
    onnavigate?: (target: "practice" | "mock" | "report") => void;
  } = $props();

  const t = (k: string, fb = "") => ((plugin?.i18n as Record<string, string>) ?? {})[k] ?? fb;

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

<aside class="lv-rail" aria-label="Lv Exam">
  <div class="lv-brand">
    <span class="lv-brand-mark" aria-hidden="true">驴</span>
    <span class="lv-brand-name">小驴考试<span class="lv-brand-sub">LV EXAM</span></span>
  </div>
  <nav class="lv-rail-nav">
    {#each globals as g (g.target)}
      <button class="lv-rail-btn" class:on={active === g.target} onclick={() => go(g.target)} aria-current={active === g.target ? "page" : undefined}>
        <Icon name={g.icon} size={16} /> {g.label}
      </button>
    {/each}
    {#if items.length}
      <div class="lv-rail-divider" role="separator"></div>
      {#each items as it (it.name)}
        <button class="lv-rail-btn lv-rail-btn--sub" class:on={it.on} onclick={it.onclick} aria-current={it.on ? "page" : undefined}>
          <Icon name={it.icon} size={16} /> {it.name}
        </button>
      {/each}
    {/if}
  </nav>
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
</style>
