<script lang="ts">
  // ============================================================
  // 命令面板（设计规范 v6 §5.2 / P0-3）：⌘K / Ctrl+K 全局命令。
  // 组件自持开合与键盘导航；命令集由宿主 Tab 注入（页面直达 + 动作 + 跨 Tab）。
  // 无外部输入面：命令为静态闭包，无题干/答案内容。
  // ============================================================
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";

  export interface PaletteCommand {
    group: string;
    icon: string;
    label: string;
    /** 搜索别名（en 关键词等；对 label 之外的关键词命中） */
    keywords?: string;
    kbd?: string;
    run: () => void;
  }

  let {
    commands,
    open = $bindable(false),
    t,
  }: {
    commands: PaletteCommand[];
    open?: boolean;
    t: (k: string, fb?: string) => string;
  } = $props();

  let q = $state("");
  let sel = $state(0);
  let panelEl: HTMLDivElement | null = $state(null);
  let returnFocus: HTMLElement | null = null;
  let wasOpen = false;
  // 实例级 id 后缀（同页多 Tab 各挂一个面板，避免 aria id 冲突）
  const uid = Math.random().toString(36).slice(2, 8);
  let inputEl: HTMLInputElement | null = $state(null);
  const shown = $derived.by(() => {
    const query = q.trim().toLowerCase();
    if (!query) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(query) || (c.keywords ?? "").toLowerCase().includes(query) || c.group.toLowerCase().includes(query),
    );
  });

  $effect(() => {
    if (open) {
      if (!wasOpen && document.activeElement instanceof HTMLElement) returnFocus = document.activeElement;
      wasOpen = true;
      q = "";
      sel = 0;
      tick().then(() => inputEl?.focus());
    } else if (wasOpen) {
      wasOpen = false;
      const target = returnFocus;
      returnFocus = null;
      tick().then(() => target?.isConnected && target.focus());
    }
  });

  function run(c: PaletteCommand | undefined) {
    if (!c) return;
    open = false;
    c.run();
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      open = !open;
      return;
    }
    if (open && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      open = false;
      return;
    }
    if (!open) return;
    if (e.key === "Tab" && panelEl) {
      const focusables = [...panelEl.querySelectorAll<HTMLElement>("input:not([disabled]), button:not([disabled])")];
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first && last && (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      sel = Math.min(sel + 1, shown.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      sel = Math.max(sel - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(shown[sel]);
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />
{#if open}
  <div
    class="lv-palette-overlay"
    role="presentation"
    onclick={(e) => { if (e.target === e.currentTarget) open = false; }}
  >
    <div bind:this={panelEl} class="lv-palette" role="dialog" aria-modal="true" aria-label={t("palette.title", "命令面板")}>
      <div class="lv-palette-input">
        <Icon name="search" size={16} />
        <input
          bind:this={inputEl}
          bind:value={q}
          oninput={() => (sel = 0)}
          type="text"
          placeholder={t("palette.placeholder", "搜索页面与动作…")}
          aria-label={t("palette.placeholder", "搜索页面与动作…")}
          role="combobox"
          aria-expanded="true"
          aria-controls={"lv-palette-list-" + uid}
          aria-activedescendant={shown[sel] ? `lv-palette-opt-${uid}-${sel}` : undefined}
        />
        <span class="lv-kbd">Esc</span>
      </div>
      <div class="lv-palette-list" role="listbox" id={"lv-palette-list-" + uid}>
        {#if !shown.length}
          <p class="lv-palette-empty">{t("palette.empty", "没有匹配的命令。试试“练习”“模考”或“导出”。")}</p>
        {:else}
          {#each shown as c, i (c.group + c.label)}
            {#if i === 0 || shown[i - 1].group !== c.group}
              <div class="lv-palette-group">{c.group}</div>
            {/if}
            <button class="lv-palette-item" class:sel={i === sel} role="option" aria-selected={i === sel}
              id={`lv-palette-opt-${uid}-${i}`}
              onclick={() => run(c)} onpointerenter={() => (sel = i)}>
              <Icon name={c.icon} size={15} />
              <span>{c.label}</span>
              {#if c.kbd}<span class="lv-kbd">{c.kbd}</span>{/if}
            </button>
          {/each}
        {/if}
      </div>
      <div class="lv-palette-foot">
        <span><span class="lv-kbd">↑</span> <span class="lv-kbd">↓</span> {t("palette.select", "选择")}</span>
        <span><span class="lv-kbd">Enter</span> {t("palette.run", "执行")}</span>
        <span style="flex:1"></span>
        <span>{t("palette.kbdHint", "Ctrl / ⌘ K 随时呼出")}</span>
      </div>
    </div>
  </div>
{/if}
