<script lang="ts">
    // 对象级保存状态顶栏汇总（37-01/U06）：pending/failed/unknown 任一存在时显示；
    // 点击定位具体目标与失败原因。SaveGate 无订阅机制，4s 轮询刷新（开销可忽略）。
    import { onMount, onDestroy } from "svelte";
    import { showMessage } from "siyuan";
    import type { SaveGate } from "../../core/saveGate";
    import Icon from "./Icon.svelte";

    let { gate, t }: { gate: SaveGate; t: (k: string, fb?: string) => string } = $props();

    let tick = $state(0);
    let timer: ReturnType<typeof setInterval> | null = null;
    onMount(() => { timer = setInterval(() => { tick++; }, 4000); });
    onDestroy(() => { if (timer) clearInterval(timer); });

    const s = $derived.by(() => { void tick; return gate.summary(); });
    const worst = $derived(s.failed.length ? "failed" : s.unknown.length ? "unknown" : s.pending.length ? "pending" : "");
    const count = $derived(worst === "failed" ? s.failed.length : worst === "unknown" ? s.unknown.length : s.pending.length);

    function targetLabel(key: string) {
        const targets: Record<string, [string, string]> = {
            "session/active": ["save.targetPractice", "练习进度"],
            "mock/run": ["save.targetMock", "模考进度"],
            "actions/items": ["save.targetActions", "下一步行动"],
            "materials/registry": ["save.targetMaterials", "学习资料"],
            "materials/notes": ["save.targetNotes", "学习笔记"],
            "materials/qrefs": ["save.targetLinks", "资料与题目的关联"],
            "ai/misdiagnosis": ["save.targetReflection", "AI 错因分析"],
            "syllabus/tree": ["save.targetSyllabus", "考纲"],
        };
        if (targets[key]) return t(...targets[key]);
        if (/^(mark-kp|edit-q|batch-edit|answer-update)\//.test(key)) return t("save.targetQuestion", "题目更改");
        if (key.startsWith("rollback/")) return t("save.targetRollback", "撤销导入");
        if (key.startsWith("daily-report/")) return t("save.targetDailyReport", "学习日报");
        return t("save.targetOther", "其他更改");
    }

    function detail() {
        // 状态可能在两次轮询之间完成；点击时直接读最新回执。
        tick++;
        const summary = gate.summary();
        const parts: string[] = [];
        if (summary.failed.length) parts.push(`${t("save.failed")}：${summary.failed.map((f) => targetLabel(f.key) + (f.error ? `（${f.error}）` : "")).join("、")}`, t("save.failedHelp", "请保留当前页面，检查思源连接与存储是否可用后，再保存对应内容。"));
        if (summary.unknown.length) parts.push(`${t("save.unknown")}：${summary.unknown.map(targetLabel).join("、")}`, t("save.unknownHelp", "保存请求尚未返回明确结果，请稍后再次查看状态。"));
        if (summary.pending.length) parts.push(`${t("save.pending")}：${summary.pending.map(targetLabel).join("、")}`);
        showMessage(parts.join("\n") || t("save.allOk"), 5600, summary.failed.length ? "error" : "info");
    }
</script>

{#if worst}
    <button class="lv-save-status lv-save-{worst}" onclick={detail} title={t("save.detailTitle")}>
        <Icon name="save" size={13} /> {t("save." + worst)} {count}
    </button>
{/if}
<style>
    .lv-save-status { 
        display: inline-flex; 
        align-items: center; 
        gap: 6px; 
        padding: 4px 12px; 
        border-radius: var(--lv-radius-pill); 
        font-size: var(--lv-font-size-sm); 
        font-weight: var(--lv-font-weight-medium); 
        border: 1px solid var(--lv-border-subtle, var(--lv-border)); 
        cursor: pointer; 
        background: var(--lv-surface); 
        color: var(--lv-text-2); 
        box-shadow: var(--lv-sh-1), var(--lv-inset-subtle, inset 0 1px 0 transparent);
        transition: transform var(--lv-dur-micro) var(--lv-ease-out), box-shadow var(--lv-dur-micro) var(--lv-ease-out), background-color var(--lv-dur-micro) var(--lv-ease-out);
    }
    .lv-save-status:hover {
        transform: translateY(-1px);
        box-shadow: var(--lv-sh-2);
    }
    .lv-save-status:active {
        transform: scale(0.98);
    }
    .lv-save-pending {
        color: var(--lv-accent);
        background: var(--lv-accent-soft);
        border-color: color-mix(in srgb, var(--lv-accent) 25%, transparent);
        animation: lv-pulse 2s infinite ease-in-out;
    }
    .lv-save-failed { 
        color: var(--lv-red); 
        background: var(--lv-red-soft); 
        border-color: color-mix(in srgb, var(--lv-red) 30%, transparent); 
    }
    .lv-save-unknown { 
        color: var(--lv-amber); 
        background: var(--lv-amber-soft); 
        border-color: color-mix(in srgb, var(--lv-amber) 30%, transparent); 
    }
    @keyframes lv-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.65; }
    }
    @media (prefers-reduced-motion: reduce) {
        .lv-save-pending { animation: none; }
    }
</style>
