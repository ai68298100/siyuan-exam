<script lang="ts">
    // 对象级保存状态顶栏汇总（37-01/U06）：pending/failed/unknown 任一存在时显示；
    // 点击定位具体目标与失败原因。SaveGate 无订阅机制，4s 轮询刷新（开销可忽略）。
    import { onMount, onDestroy } from "svelte";
    import { showMessage } from "siyuan";
    import type { SaveGate } from "../../core/saveGate";

    let { gate, t }: { gate: SaveGate; t: (k: string, fb?: string) => string } = $props();

    let tick = $state(0);
    let timer: ReturnType<typeof setInterval> | null = null;
    onMount(() => { timer = setInterval(() => { tick++; }, 4000); });
    onDestroy(() => { if (timer) clearInterval(timer); });

    const s = $derived.by(() => { void tick; return gate.summary(); });
    const worst = $derived(s.failed.length ? "failed" : s.unknown.length ? "unknown" : s.pending.length ? "pending" : "");
    const count = $derived(worst === "failed" ? s.failed.length : worst === "unknown" ? s.unknown.length : s.pending.length);

    function detail() {
        const parts: string[] = [];
        if (s.failed.length) parts.push(`${t("save.failed")}：${s.failed.map((f) => f.key + (f.error ? `（${f.error}）` : "")).join("、")}`);
        if (s.unknown.length) parts.push(`${t("save.unknown")}：${s.unknown.join("、")}`);
        if (s.pending.length) parts.push(`${t("save.pending")}：${s.pending.join("、")}`);
        showMessage(parts.join("\n") || t("save.allOk"), 5600, s.failed.length ? "error" : "info");
    }
</script>

{#if worst}
    <button class="lv-save-status lv-save-{worst}" onclick={detail} title={t("save.detailTitle")}>
        💾 {t("save." + worst)} {count}
    </button>
{/if}

<style>
    .lv-save-status { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 550; border: 1px solid var(--lv-border); cursor: pointer; background: var(--lv-surface-2); color: var(--lv-text-2); }
    .lv-save-failed { color: var(--lv-red); background: var(--lv-red-soft); border-color: transparent; }
    .lv-save-unknown { color: var(--lv-amber); background: var(--lv-amber-soft); border-color: transparent; }
</style>
