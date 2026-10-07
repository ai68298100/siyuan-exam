import { describe, expect, it } from "vitest";
import { redactUrlForDisplay } from "../src/core/urlRedaction";

describe("URL display redaction", () => {
  it("保留目的地但移除 query 值和 fragment", () => {
    const out = redactUrlForDisplay(
      "https://example.test/course/1?token=signed-secret&next=https%3A%2F%2Fprivate.test%2Fdoc#page=12&user=alice",
    );
    expect(out).toBe("https://example.test/course/1?[redacted]#[redacted]");
    expect(out).not.toContain("signed-secret");
    expect(out).not.toContain("private.test");
    expect(out).not.toContain("page=12");
  });

  it("移除 URL userinfo，即使没有 query", () => {
    expect(redactUrlForDisplay("https://alice:password@example.test/path")).toBe("https://example.test/path");
  });

  it("支持 mailto 目的地但不回显 subject/fragment", () => {
    expect(redactUrlForDisplay("mailto:owner@example.test?subject=private#draft")).toBe(
      "mailto:owner@example.test?[redacted]#[redacted]",
    );
  });

  it("解析失败或危险协议 fail closed，不把原值带入回执", () => {
    expect(redactUrlForDisplay("javascript:alert('token')")).toBe("[blocked URL]");
    expect(redactUrlForDisplay("https://[invalid?token=secret")).toBe("[blocked URL]");
    expect(redactUrlForDisplay("   ")).toBe("[blocked URL]");
  });
});

