<script lang="ts">
  // 线性图标组件（V03）：静态自绘路径，经 iconSvg 输出，无外部输入面。
  import { iconSvg } from "./icons";
  let { name, size = 19 }: { name: string; size?: number } = $props();
</script>

<span class="lv-icon">{@html iconSvg(name, size)}</span>
