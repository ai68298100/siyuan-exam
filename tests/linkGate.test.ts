import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("rich text link privacy gate wiring", () => {
  const source = readFileSync(resolve(process.cwd(), "src/ui/practice/PracticeTab.svelte"), "utf8");

  it("delegates clicks from rich text and handles auxiliary activation", () => {
    expect(source).toContain("<svelte:window onkeydown={onKeydown} onclick={onRichTextClick} onauxclick={onRichTextClick}");
    expect(source).toContain('target.closest(".lv-rich")');
  });

  it("opens gated links with both opener and referrer protection", () => {
    expect(source).toContain('window.open(link.href, "_blank", "noopener,noreferrer")');
    expect(source).not.toContain("/^https?:///i.test(url)");
  });
});
