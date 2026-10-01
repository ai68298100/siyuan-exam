<script lang="ts">
    // 模考场：v0.3 路线（docs/04）。当前仅入口，所有动作给明确禁用原因（TODO 26.1：无响应按钮清零）
    let { plugin }: { plugin: any } = $props();
    const i18n = $derived(plugin?.i18n ?? {});
    const t = (k: string, fb = "") => i18n[k] ?? fb;
</script>

<div class="fn__flex-1 lv-pad">
    <div class="block__icons">
        <div class="block__logo">
            <svg class="block__logoicon"><use xlink:href="#iconMock"></use></svg>
            {t("tab.mock")}
        </div>
        <span class="fn__flex-1"></span>
        <span class="lv-chip lv-chip--amb">{t("planned.v03")}</span>
    </div>
    <div class="lv-empty">
        <div style="font-size:26px;margin-bottom:6px;opacity:.7">📋</div>
        <b>{t("mock.placeholder.title")}</b>
        <p class="lv-muted">{t("mock.placeholder.desc")}</p>
        <p class="lv-muted">{t("mock.placeholder.hint")}</p>
    </div>
</div>

<style>
    .lv-pad { padding: 12px 16px; overflow: auto; }
    .lv-empty { border: 1.5px dashed var(--lv-border); border-radius: 14px; padding: 28px; text-align: center; color: var(--lv-text-3); max-width: 520px; margin: 40px auto; }
    .lv-muted { color: var(--lv-text-3); font-size: 12.5px; margin: 4px 0; }
    .lv-chip { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 550; color: var(--lv-amber); background: var(--lv-amber-soft); }
</style>
