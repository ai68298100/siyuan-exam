import { describe, expect, it } from "vitest";
import { isExternalHref, resolveLink } from "../src/core/externalLinks";

const BASE = "https://siyuan.local/plugins/exam/";

describe("external link policy", () => {
  it.each([
    ["https://example.com/path", true],
    ["//example.com/path", true],
    ["mailto:owner@example.com", true],
  ])("识别外部 href：%s", (href, expected) => {
    expect(isExternalHref(href, BASE)).toBe(expected);
  });

  it.each([
    ["/plugins/exam/help.html", "internal"],
    ["./help.html", "internal"],
    ["#answer", "internal"],
    ["https://siyuan.local.evil.example/", "external"],
  ])("按 origin 分类：%s", (href, expected) => {
    expect(resolveLink(href, BASE).disposition).toBe(expected);
  });

  it.each(["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "http://[invalid"]) (
    "拒绝危险或无效 href：%s",
    (href) => {
      expect(resolveLink(href, BASE).disposition).toBe("blocked");
    },
  );
});
