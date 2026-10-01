<script lang="ts">
    // 模考场：组卷蓝图 / 限时与分段计时 / 答题卡标旗 / 成绩单
    // 功能规格见 docs/01-功能全景PRD.md 第六节第 6 节
    let { plugin }: { plugin: any } = $props();
    const i18n = $derived(plugin?.i18n ?? {});
    const placeholder = $derived(i18n["placeholder.mock"] ?? "");
</script>

<div class="lv-exam-placeholder fn__flex-1 fn__flex-column">
    <div class="block__icons">
        <div class="block__logo">
            <svg class="block__logoicon"><use xlink:href="#iconMock"></use></svg>
            {i18n["tab.mock"] ?? "Mock Exam"}
        </div>
        <div class="fn__flex-1"></div>
        <button class="b3-button b3-button--outline" title="Blueprint">
            <svg><use xlink:href="#iconSettings"></use></svg> {i18n["action.blueprint"] ?? ""}
        </button>
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
