import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("小驴考试 · A11y & High-Contrast Design Contracts (Epoch 5)", () => {
  const baseScssPath = path.resolve(__dirname, "../src/scss/lv-base.scss");
  const indexScssPath = path.resolve(__dirname, "../src/index.scss");
  const baseContent = fs.readFileSync(baseScssPath, "utf8");
  const indexContent = fs.readFileSync(indexScssPath, "utf8");

  it("declares comprehensive forced-colors: active block with system color mappings and host bridge", () => {
    expect(baseContent).toContain("@media (forced-colors: active)");
    expect(baseContent).toMatch(/--lv-accent:\s*Highlight;/);
    expect(baseContent).toMatch(/--lv-accent-contrast:\s*HighlightText;/);
    expect(baseContent).toMatch(/--lv-border:\s*CanvasText;/);
    expect(baseContent).toMatch(/--lv-canvas:\s*Canvas;/);
    expect(baseContent).toMatch(/--lv-surface:\s*Canvas;/);
    expect(baseContent).toMatch(/--lv-text:\s*CanvasText;/);
    expect(baseContent).toMatch(/--lv-btn-primary-bg:\s*Highlight;/);
    expect(baseContent).toMatch(/--b3-theme-primary:\s*Highlight;/);
    expect(baseContent).toMatch(/--b3-theme-on-primary:\s*HighlightText;/);
    expect(baseContent).toMatch(/--b3-theme-background:\s*Canvas;/);
    expect(baseContent).toMatch(/--b3-border-color:\s*CanvasText;/);
  });

  it("enforces 1px CanvasText borders on cards, controls, options and panels under forced-colors", () => {
    expect(baseContent).toMatch(/\.lv-card,\s*\.lv-chip,\s*\.lv-opt/);
    expect(baseContent).toMatch(/border:\s*1px solid CanvasText;/);
  });

  it("enforces 2px border outlines and background overrides on modal/drawer/palette/dialog under forced-colors", () => {
    expect(baseContent).toMatch(/\.lv-palette,\s*\.lv-modal \.lv-sheet,\s*\.lv-drawer,\s*\.b3-dialog__container\s*\{[^}]*border:\s*2px solid CanvasText !important;\s*background:\s*Canvas !important;/);
    expect(indexContent).toMatch(/\.b3-dialog__container\s*\{[^}]*border:\s*2px solid CanvasText !important;\s*background:\s*Canvas !important;/);
  });

  it("maps primary buttons and active selections to Highlight and HighlightText", () => {
    expect(baseContent).toMatch(/\.lv-btn--primary,\s*\.b3-button--primary\s*\{[^}]*background:\s*Highlight !important;\s*color:\s*HighlightText !important;/);
    expect(baseContent).toMatch(/\.lv-opt--sel,\s*\.lv-opt\[aria-selected="true"\]\s*\{[^}]*outline:\s*2px solid Highlight !important;/);
    expect(baseContent).toMatch(/\.lv-seg button\.on/);
    expect(indexContent).toMatch(/\.b3-button--primary,\s*#confirmDialogConfirmBtn\s*\{[^}]*background:\s*Highlight !important;/);
  });

  it("enforces accessible focus-visible rings with outline-color and offset", () => {
    expect(baseContent).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid Highlight !important;\s*outline-color:\s*Highlight !important;\s*outline-offset:\s*2px;/);
    expect(indexContent).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid Highlight !important;/);
  });

  it("preserves visual indicators, badges, and state affordances with forced-color-adjust: none", () => {
    expect(baseContent).toMatch(/\.lv-avatar,\s*\.lv-icon,\s*\.lv-badge,\s*\.lv-score-badge/);
    expect(baseContent).toMatch(/input\[type="checkbox"\]\.b3-switch/);
    expect(baseContent).toMatch(/svg\s*\{[^}]*forced-color-adjust:\s*none;/);
  });

  it("declares prefers-contrast: more block with enhanced borders and focus outlines", () => {
    expect(baseContent).toContain("@media (prefers-contrast: more)");
    expect(baseContent).toMatch(/--lv-border:\s*color-mix\(in srgb,\s*var\(--lv-text\)\s*45%,\s*transparent\);/);
    expect(baseContent).toMatch(/--b3-border-color:\s*var\(--b3-theme-on-background\);/);
    expect(baseContent).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--b3-theme-primary\);/);
    expect(indexContent).toContain("@media (prefers-contrast: more)");
  });

  it("preserves essential container query breakpoints for narrow and split panes", () => {
    expect(indexContent).toContain("@container lv-exam (max-width: 759px)");
    expect(indexContent).toContain("@container lv-exam (min-width: 760px) and (max-width: 1119px)");
  });
});
