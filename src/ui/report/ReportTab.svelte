<script lang="ts">
    // 报告中心：热力图 / 考点掌握度树 / 雷达图 / 分数预测
    // 功能规格见 docs/01-功能全景PRD.md 第六节第 8 节
    let { plugin }: { plugin: any } = $props();
    const i18n = $derived(plugin?.i18n ?? {});
    const placeholder = $derived(i18n["placeholder.report"] ?? "");
</script>

<div class="lv-exam-placeholder fn__flex-1 fn__flex-column">
    <div class="block__icons">
        <div class="block__logo">
            <svg class="block__logoicon"><use xlink:href="#iconReport"></use></svg>
            {i18n["tab.report"] ?? "Reports"}
        </div>
        <div class="fn__flex-1"></div>
    </div>
    <div class="fn__flex-1 fn__flex-center">
        <div class="b3-card b3-card--wrap" style="max-width:560px">
            <div class="b3-card__body">
                <p class="b3-typography">{placeholder}</p>
            </div>
        </div>
    </div>
</div>

<style>
    .lv-exam-placeholder { padding: 0 8px; }
    .fn__flex-center { display: flex; align-items: center; justify-content: center; }
</style>
