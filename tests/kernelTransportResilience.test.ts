import { describe, it, expect, vi } from "vitest";
import {
  HttpTransport,
  KernelError,
  computeRetryDelayMs,
  parseRetryAfterMs,
} from "../src/kernel/client";

function makeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const headerMap = new Map<string, string>(Object.entries(headers));
  const isString = typeof body === "string";
  const bodyText = isString ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k: string) => headerMap.get(k) ?? headerMap.get(k.toLowerCase()) ?? null,
    } as any,
    text: async () => bodyText,
  } as unknown as Response;
}

describe("HttpTransport 网络波动与瞬态读写失败自愈", () => {
  it("网络层底层 ECONNRESET 瞬态故障自动重试并在第二次成功自愈", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        const netErr = new TypeError("fetch failed");
        (netErr as any).cause = { code: "ECONNRESET" };
        throw netErr;
      }
      return makeResponse(200, { code: 0, msg: "ok", data: { blockId: "b-100" } });
    });

    const transport = new HttpTransport(
      "http://127.0.0.1:6806",
      "test-token",
      fetchMock as any,
      1000,
      2,
    );

    const res = await transport.post<{ blockId: string }>("/api/block/getBlock", { id: "b-100" });
    expect(res.code).toBe(0);
    expect(res.data.blockId).toBe("b-100");
    expect(callCount).toBe(2);
  });

  it("连续网络超时（ETIMEDOUT）耗尽重试次数后抛出可重试分类的 KernelError", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      const netErr = new Error("connect ETIMEDOUT 127.0.0.1:6806");
      throw netErr;
    });

    const transport = new HttpTransport(
      "http://127.0.0.1:6806",
      "test-token",
      fetchMock as any,
      1000,
      2,
    );

    await expect(transport.post("/api/query/sql", { stmt: "SELECT 1" })).rejects.toThrowError(
      KernelError,
    );
    expect(callCount).toBe(3);
  });

  it("当 options.retryable 为 false 时，即使发生网络异常也绝不重试，仅请求 1 次", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      throw new Error("network socket hang up");
    });

    const transport = new HttpTransport(
      "http://127.0.0.1:6806",
      "test-token",
      fetchMock as any,
      1000,
      3,
    );

    await expect(
      transport.post("/api/block/insert", { val: "x" }, { retryable: false }),
    ).rejects.toThrowError(KernelError);

    expect(callCount).toBe(1);
  });

  it("外部 signal 在重试期间被中止时，立刻终止重试循环并抛出已取消", async () => {
    const controller = new AbortController();
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      // 第一次请求失败时触发 abort
      controller.abort("user cancel");
      throw new Error("fetch failed");
    });

    const transport = new HttpTransport(
      "http://127.0.0.1:6806",
      "test-token",
      fetchMock as any,
      1000,
      3,
    );

    await expect(
      transport.post("/api/block/update", {}, { signal: controller.signal }),
    ).rejects.toThrow();

    expect(callCount).toBe(1);
  });
});

describe("HttpTransport HTTP 状态码与异常响应分类", () => {
  it("HTTP 429 触发限流重试，识别 Retry-After 秒数头并在下次成功返回", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return makeResponse(429, "Too Many Requests", { "Retry-After": "0.01" });
      }
      return makeResponse(200, { code: 0, msg: "ok", data: { quota: 100 } });
    });

    const transport = new HttpTransport(
      "http://127.0.0.1:6806",
      "test-token",
      fetchMock as any,
      1000,
      2,
    );

    const res = await transport.post<{ quota: number }>("/api/query", {});
    expect(res.code).toBe(0);
    expect(res.data.quota).toBe(100);
    expect(callCount).toBe(2);
  });

  it("HTTP 429 持续限流耗尽重试后抛出 status=429 的 retryable KernelError", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      return makeResponse(429, "Rate limit exceeded", { "Retry-After": "0.01" });
    });

    const transport = new HttpTransport(
      "http://127.0.0.1:6806",
      "test-token",
      fetchMock as any,
      1000,
      1,
    );

    try {
      await transport.post("/api/heavy", {});
      expect.fail("应抛出 KernelError");
    } catch (err: any) {
      expect(err).toBeInstanceOf(KernelError);
      expect(err.kind).toBe("retryable");
      expect(err.code).toBe(429);
      expect(callCount).toBe(2);
    }
  });

  it("HTTP 404/403 等致命状态码直接抛出 fatal 错误且不进行任何无谓重试", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      return makeResponse(404, "Not Found");
    });

    const transport = new HttpTransport(
      "http://127.0.0.1:6806",
      "test-token",
      fetchMock as any,
      1000,
      3,
    );

    try {
      await transport.post("/api/nonexistent", {});
      expect.fail("应抛出 fatal KernelError");
    } catch (err: any) {
      expect(err).toBeInstanceOf(KernelError);
      expect(err.kind).toBe("fatal");
      expect(err.code).toBe(404);
      expect(callCount).toBe(1); // 致命错误禁止重试
    }
  });

  it("返回 200 但内容为非 JSON（如网关 HTML 错误页）时，安全抛出 fatal 错误且不重试", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      return makeResponse(200, "<html><body>502 Bad Gateway</body></html>");
    });

    const transport = new HttpTransport(
      "http://127.0.0.1:6806",
      "test-token",
      fetchMock as any,
      1000,
      2,
    );

    try {
      await transport.post("/api/sql", {});
      expect.fail("应抛出非 JSON 响应异常");
    } catch (err: any) {
      expect(err).toBeInstanceOf(KernelError);
      expect(err.kind).toBe("fatal");
      expect(err.message).toContain("非 JSON 响应");
      expect(callCount).toBe(1);
    }
  });

  it("返回 200 但业务 code !== 0（如思源授权失效 code -1）时，抛出包含错误代码的 fatal 异常", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      return makeResponse(200, { code: -1, msg: "API token unauthorized" });
    });

    const transport = new HttpTransport(
      "http://127.0.0.1:6806",
      "test-token",
      fetchMock as any,
      1000,
      2,
    );

    try {
      await transport.post("/api/auth", {});
      expect.fail("应抛出业务错误异常");
    } catch (err: any) {
      expect(err).toBeInstanceOf(KernelError);
      expect(err.kind).toBe("fatal");
      expect(err.code).toBe(-1);
      expect(err.message).toContain("API token unauthorized");
      expect(callCount).toBe(1);
    }
  });
});

describe("parseRetryAfterMs 与 computeRetryDelayMs 极端边界", () => {
  it("parseRetryAfterMs 能精确解析整数、小数秒数，并过滤负数与畸形值，且超过上限时截断", () => {
    expect(parseRetryAfterMs("0")).toBe(0);
    expect(parseRetryAfterMs("3")).toBe(3000);
    expect(parseRetryAfterMs("1.5")).toBe(1500);
    expect(parseRetryAfterMs("-1")).toBeNull();
    expect(parseRetryAfterMs("-0.5")).toBeNull();
    expect(parseRetryAfterMs("invalid")).toBeNull();
    expect(parseRetryAfterMs("")).toBeNull();
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs(undefined)).toBeNull();
    // 超过 RETRY_AFTER_MAX_MS (60,000ms) 时截断为 60,000
    expect(parseRetryAfterMs("999999")).toBe(60_000);
  });

  it("parseRetryAfterMs 能解析 RFC 7231 日期，已过去的日期返回 0，畸形日期返回 null", () => {
    const fixedNow = 1_700_000_000_000;
    const nowFn = () => fixedNow;

    // 未来 10 秒
    const futureDateStr = new Date(fixedNow + 10_000).toUTCString();
    expect(parseRetryAfterMs(futureDateStr, nowFn)).toBe(10_000);

    // 已过去 5 秒
    const pastDateStr = new Date(fixedNow - 5_000).toUTCString();
    expect(parseRetryAfterMs(pastDateStr, nowFn)).toBe(0);

    // 格式损坏的日期字符串
    expect(parseRetryAfterMs("Mon, 99 Foo 2099 99:99:99 GMT", nowFn)).toBeNull();
  });

  it("computeRetryDelayMs 退避梯度与上限截断保护", () => {
    // 常规退避序列：base 300 * (attempt + 1)
    expect(computeRetryDelayMs(0)).toBe(300);
    expect(computeRetryDelayMs(1)).toBe(600);
    expect(computeRetryDelayMs(2)).toBe(900);
    expect(computeRetryDelayMs(3)).toBe(1200);

    // 429 缺省 Retry-After 时 base 1000 * (attempt + 1)
    expect(computeRetryDelayMs(0, { status: 429 })).toBe(1000);
    expect(computeRetryDelayMs(1, { status: 429 })).toBe(2000);

    // 429 携带有效 headerMs（优先遵循 headerMs）
    expect(computeRetryDelayMs(0, { status: 429, headerMs: 2500 })).toBe(2500);

    // 429 headerMs 为 0 或负数时保底为 0
    expect(computeRetryDelayMs(0, { status: 429, headerMs: 0 })).toBe(0);
    expect(computeRetryDelayMs(0, { status: 429, headerMs: -100 })).toBe(0);
  });
});

describe("HttpTransport.postForm 文件上传韧性", () => {
  it("文件上传遇底层网络抖动时自动重试并成功", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("upload socket hang up");
      }
      return makeResponse(200, { code: 0, msg: "ok", data: { imported: 1 } });
    });

    const transport = new HttpTransport(
      "http://127.0.0.1:6806",
      "test-token",
      fetchMock as any,
      1000,
      2,
    );

    const dummyBlob = new Blob(["test"], { type: "text/plain" });
    const res = await transport.postForm<{ imported: number }>("/api/import", dummyBlob, "test.zip");
    expect(res.code).toBe(0);
    expect(res.data.imported).toBe(1);
    expect(callCount).toBe(2);
  });
});
