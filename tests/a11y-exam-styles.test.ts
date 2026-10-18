import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("小驴考试 · A11y & High-Contrast Design Contracts", () => {
  const baseScssPath = path.resolve(__dirname, "../src/scss/lv-base.scss");
  const baseContent = fs.readFileSync(baseScssPath, "utf8");

  it("declares comprehensive forced-colors: active block with system color mappings", () => {
    expect(baseContent).toContain("@media (forced-colors: active)");
    expect(baseContent).toMatch(/--lv-accent:\s*Highlight/);
    expect(baseContent).toMatch(/--lv-border:\s*CanvasText/);
    expect(baseContent).toMatch(/--lv-canvas:\s*Canvas/);
    expect(baseContent).toMatch(/--lv-text:\s*CanvasText/);
    expect(baseContent).toMatch(/--lv-btn-primary-bg:\s*Highlight/);
  });

  it("enforces border outlines and background overrides on modal/drawer/palette under forced-colors", () => {
    expect(baseContent).toMatch(/\.lv-palette,\s*\.lv-modal \.lv-sheet,\s*\.lv-drawer\s*\{[^}]*border:\s*2px solid CanvasText/);
    expect(baseContent).toMatch(/forced-color-adjust:\s*none/);
  });

  it("declares prefers-contrast: more block with enhanced borders and focus outlines", () => {
    expect(baseContent).toContain("@media (prefers-contrast: more)");
    expect(baseContent).toMatch(/--lv-border:\s*color-mix\(in srgb,\s*var\(--lv-text\)\s*45%,\s*transparent\)/);
    expect(baseContent).toMatch(/:where\(button, input, select, textarea, \[tabindex="0"\]\):focus-visible\s*\{[^}]*outline:\s*3px/);
  });

  it("ensures options and segment buttons receive high-contrast selection outlines", () => {
    expect(baseContent).toMatch(/\.lv-opt--sel,\s*\.lv-opt\[aria-selected="true"\]\s*\{[^}]*outline:\s*2px/);
    expect(baseContent).toMatch(/\.lv-seg button\.on/);
  });
});
