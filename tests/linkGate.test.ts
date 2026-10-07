import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("rich text link privacy gate wiring", () => {
  const source = readFileSync(resolve(process.cwd(), "src/ui/practice/PracticeTab.svelte"), "utf8");

  it("delegates clicks from rich text and handles auxiliary activation", () => {
    // onclick 合并了「更多」菜单的外点关闭（onWindowClick）；富文本委托与辅助键闸门仍须在位
    expect(source).toContain("<svelte:window");
    expect(source).toContain("onclick={(e) => { onRichTextClick(e); onWindowClick(e); }}");
    expect(source).toContain("onauxclick={onRichTextClick}");
    expect(source).toContain('target.closest(".lv-rich")');
  });

  it("opens gated links with both opener and referrer protection", () => {
    expect(source).toContain('window.open(link.href, "_blank", "noopener,noreferrer")');
    expect(source).not.toContain("/^https?:///i.test(url)");
  });

  it("displays a redacted URL while keeping the full value only for explicit copy", () => {
    expect(source).toContain("redactUrlForDisplay(link.href)");
    expect(source).toContain("navigator.clipboard.writeText(link.href)");
    expect(source).toContain("redactUrlForDisplay(ep)");
  });
});
