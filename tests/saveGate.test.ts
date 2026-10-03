import { describe, it, expect } from "vitest";
import { SaveGate } from "../src/core/saveGate";
import { MemoryStorage } from "../src/core/attemptLog";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("SaveGate 对象级保存确认（Q2/U06）", () => {
  it("成功 → confirmed；失败 → failed 且错误留痕", async () => {
    const g = new SaveGate();
    await g.run("session/active", async () => "ok");
    expect(g.state("session/active")).toBe("confirmed");
    await expect(g.run("mock/run", async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
    const rec = g.record("mock/run")!;
    expect(rec.state).toBe("failed");
    expect(rec.error).toBe("disk full");
  });

  it("一个目标失败不被另一目标成功清除（顶栏可定位失败对象）", async () => {
    const g = new SaveGate();
    await g.run("a", async () => { throw new Error("x"); }).catch(() => {});
    await g.run("b", async () => 1);
    expect(g.state("a")).toBe("failed");
    expect(g.state("b")).toBe("confirmed");
    expect(g.summary().failed.map((r) => r.key)).toEqual(["a"]);
  });

  it("同 key 在途写入合并：并发调用只执行一次底层写入", async () => {
    const g = new SaveGate();
    let calls = 0;
    const p1 = g.run("k", async () => { calls++; await sleep(20); return 1; });
    const p2 = g.run("k", async () => { calls++; await sleep(20); return 2; });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(calls).toBe(1);
    expect(r1).toBe(1);
    expect(r2).toBe(1);
    expect(g.state("k")).toBe("confirmed");
  });

  it("超时 → unknown（结果未知≠失败）；底层完成后升级为 confirmed", async () => {
    const g = new SaveGate(undefined, 15);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const p = g.run("slow", async () => { await gate; return "done"; });
    await sleep(40);
    expect(g.state("slow")).toBe("unknown");
    release();
    await p;
    expect(g.state("slow")).toBe("confirmed");
  });

  it("verify：读回核对重写结论（重载后按目标恢复 confirmed/failed）", async () => {
    const storage = new MemoryStorage();
    await storage.save("k", { n: 3 });
    const g = new SaveGate();
    await g.run("k", () => Promise.reject(new Error("lost"))).catch(() => {});
    expect(g.state("k")).toBe("failed");
    const ok = await g.verify("k", () => storage.load("k"), (v) => (v as { n: number }).n === 3);
    expect(ok).toBe(true);
    expect(g.state("k")).toBe("confirmed");
    const bad = await g.verify("k2", () => storage.load("nope"), (v) => (v as { n?: number } | undefined)?.n === 3);
    expect(bad).toBe(false);
    expect(g.state("k2")).toBe("failed");
  });

  it("summary 汇总 pending/failed/unknown/confirmed", async () => {
    const g = new SaveGate(undefined, 10);
    await g.run("ok1", async () => 1);
    await g.run("bad", () => Promise.reject(new Error("e"))).catch(() => {});
    const hold = g.run("pend", () => new Promise<number>(() => {}));
    await sleep(20);
    const s = g.summary();
    expect(s.confirmed).toBe(1);
    expect(s.failed.map((r) => r.key)).toEqual(["bad"]);
    expect(s.unknown).toEqual(["pend"]);
    void hold;
  });
});
