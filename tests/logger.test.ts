import { describe, it, expect, vi, afterEach } from "vitest";
import { classifyError, lvLogger } from "../src/core/logger";
import { KernelError } from "../src/kernel/client";

afterEach(() => vi.restoreAllMocks());

describe("[lv-exam] 日志封装与错误二分类（TODO 0 组）", () => {
  it("classifyError：KernelError 透传 kind；网络/超时/中断 → retryable；其余 → fatal", () => {
    expect(classifyError(new KernelError("retryable", "/api/x", "timeout"))).toBe("retryable");
    expect(classifyError(new KernelError("fatal", "/api/x", "HTTP 500"))).toBe("fatal");
    expect(classifyError(new Error("Failed to fetch"))).toBe("retryable");
    expect(classifyError(new Error("ECONNRESET while posting"))).toBe("retryable");
    expect(classifyError(new DOMException("Aborted", "AbortError"))).toBe("retryable");
    expect(classifyError(new Error("非 JSON 响应"))).toBe("fatal");
    expect(classifyError("字符串错误")).toBe("fatal");
  });

  it("lvLogger：统一 [lv-exam][scope] 前缀且不抛出", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = lvLogger("import");
    log.warn("映射失效", { col: 3 });
    expect(spy).toHaveBeenCalledOnce();
    const line = String(spy.mock.calls[0][0]);
    expect(line.startsWith("[lv-exam][import]")).toBe(true);
    expect(line).toContain("映射失效");
    spy.mockRestore();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => lvLogger("mock").error("boom")).not.toThrow();
    errSpy.mockRestore();
  });
});
