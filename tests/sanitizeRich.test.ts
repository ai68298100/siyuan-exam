// @vitest-environment jsdom
// P0-07：富文本净化边界测试（恶意 HTML/属性注入）
// 背景：题干来自导入（不可信源），内核 md2html 透传裸 HTML，
// renderStem 是 {@html} 消费（stemHtml/materialHtml/spotHtml）的唯一生产口。
// 注意：须用 jsdom——DOMPurify 在 happy-dom 下 isSupported=false（已由 fail-closed 兜底），无法测真实白名单。
import { describe, expect, it } from "vitest";
import { escapeHtml, sanitizeRichHtml } from "../src/libs/sanitize";
import { ExamApp } from "../src/app";
import { KernelApiClient } from "../src/kernel/client";
import type { KernelTransport } from "../src/kernel/client";
import { makeQuestion } from "../src/core/blockTemplate";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("escapeHtml（纯文本边界）", () => {
  it("转义全部活动字符", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });
});

describe("sanitizeRichHtml（富文本白名单）", () => {
  it("剥离 script 标签", () => {
    const out = sanitizeRichHtml(`<p>ok</p><script>alert(1)</script>`);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("<p>ok</p>");
  });

  it("剥离事件属性（onerror/onclick）", () => {
    const out = sanitizeRichHtml(`<img src="#a.png" onerror="alert(1)"><b onclick="alert(2)">t</b>`);
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("onclick");
    expect(out).toContain("<b>t</b>");
  });

  it("中和 javascript: 链接", () => {
    const out = sanitizeRichHtml(`<a href="javascript:alert(1)">x</a>`);
    expect(out.toLowerCase()).not.toContain("javascript:");
  });

  it("剥离 iframe/object/embed/form 等嵌入向量", () => {
    const out = sanitizeRichHtml(
      `<iframe srcdoc="<p>x"></iframe><object data="x"></object><embed src="x"><form action="x"><input type="text"></form><p>keep</p>`,
    );
    expect(out).not.toMatch(/<(iframe|object|embed|form)\b/i);
    expect(out).toContain("keep");
  });

  it("剥离 style 标签与内联 expression/url() 注入", () => {
    const out = sanitizeRichHtml(`<style>body{background:url(javascript:alert(1))}</style><p style="color:red">t</p>`);
    expect(out).not.toContain("<style");
    expect(out).toContain("color");
  });

  it("剥离 data-* 属性（可被框架语义误读）", () => {
    const out = sanitizeRichHtml(`<p data-type="query_embed" data-node-id="x">t</p>`);
    expect(out).not.toContain("data-");
  });

  it("保留合法排版：表格/代码块/引用/链接/图", () => {
    const html = `<table><thead><tr><th>h</th></tr></thead><tbody><tr><td colspan="2">d</td></tr></tbody></table>` +
      `<pre><code>code()</code></pre><blockquote>q</blockquote>` +
      `<a href="https://example.com" title="t">l</a><img src="#a.png" alt="a">`;
    const out = sanitizeRichHtml(html);
    expect(out).toContain("<table>");
    expect(out).toContain('colspan="2"');
    expect(out).toContain("<code>code()</code>");
    expect(out).toContain("<blockquote>q</blockquote>");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('src="#a.png"');
  });

  it("保留 KaTeX 排版所需的 class/style", () => {
    const out = sanitizeRichHtml(`<span class="katex" style="color:red">x</span>`);
    expect(out).toContain('class="katex"');
    expect(out).toContain("style");
  });

  it("移除远程图片自动加载，保留本地与内嵌资源", () => {
    const out = sanitizeRichHtml(
      `<img src="https://tracker.example/p.gif?u=1" alt="remote"><img src="//tracker.example/p.gif" alt="protocol"><img src="http:/tracker.example/p.gif" alt="single-slash"><img src="\\\\tracker.example\\p.gif" alt="backslash"><img src="assets/p.png" alt="local"><img src="#p" alt="anchor"><img src="data:image/png;base64,AA==" alt="inline">`,
    );
    expect(out).not.toContain("tracker.example");
    expect(out).toContain('src="assets/p.png"');
    expect(out).toContain('src="#p"');
    expect(out).toContain('src="data:image/png;base64,AA=="');
  });
});

describe("renderStem 源头净化（ExamApp 边界）", () => {
  it("内核 md2html 返回恶意 HTML 时，产出被白名单净化", async () => {
    const malicious = `<p>题干</p><img src="#x" onerror="alert(1)"><script>alert(2)</script>`;
    const t: KernelTransport = {
      async post(endpoint) {
        if (endpoint === "/api/lute/md2html") return { code: 0, msg: "", data: { html: malicious } };
        return { code: 0, msg: "", data: {} };
      },
    };
    const app = new ExamApp({
      client: new KernelApiClient(t),
      storage: { async load() { return undefined; }, async save() {} },
    });
    app.kernelOnline = true; // 直置在线位：renderStem 只依赖 renderCache + kernelOnline
    const html = await app.renderStem(makeQuestion({ type: "single", stem: "<img src=x onerror=alert(1)>", options: ["1", "2"], answer: "A" }));
    expect(html).toContain("题干");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script");
  });
});

describe("PracticeTab 富文本回退边界", () => {
  it("材料和抽查的 {@html} 回退必须先转义纯文本", () => {
    const source = readFileSync(resolve(process.cwd(), "src/ui/practice/PracticeTab.svelte"), "utf8");
    expect(source).toContain("escapeHtml(materialShown)");
    expect(source).toContain("escapeHtml(sq.stem)");
    expect(source).not.toMatch(/\{@html\s+[^}]*\?\s*[^:]+:\s*materialShown\s*\}/);
    expect(source).not.toMatch(/\{@html\s+spotHtml\[sid\]\s*\?\?\s*sq\.stem\s*\}/);
  });
});
