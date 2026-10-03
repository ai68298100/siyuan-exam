import { describe, it, expect } from "vitest";
import {
  hashText,
  questionFingerprint,
  taskContextHash,
  helpAllowed,
  AiTaskRunner,
  applyResult,
  type AiTaskContext,
} from "../src/ai/task";
import type { AiChannel } from "../src/ai/client";
import { makeQuestion } from "../src/core/blockTemplate";

const q = makeQuestion({ type: "single", stem: "1+1=?", options: ["1", "2", "3"], answer: "B" });

const ctx = (over: Partial<AiTaskContext> = {}): AiTaskContext => ({
  templateId: "practice.explain",
  templateVersion: 1,
  qid: q.id,
  questionRevision: questionFingerprint(q),
  learnerAnswer: "A",
  submitted: true,
  mode: "practice",
  sessionId: "s1",
  ...over,
});

const channel = (reply = "讲解文本"): AiChannel => ({ id: "test", chat: async () => reply });

describe("AI 任务信封（Q5/G1/G2/G6）", () => {
  it("指纹与哈希：题面/作答任一变化 → hash 变化；同上下文稳定", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
    const a = questionFingerprint(q);
    const b = questionFingerprint({ stem: q.stem + "（修订）", options: q.options });
    expect(a).not.toBe(b);
    expect(taskContextHash(ctx())).toBe(taskContextHash(ctx()));
    expect(taskContextHash(ctx())).not.toBe(taskContextHash(ctx({ learnerAnswer: "C" })));
  });

  it("G6 帮助闸门：strictMock 全拒；未提交拒揭示型，放行提示型", () => {
    expect(helpAllowed({ mode: "strictMock", submitted: false }, "hint").allowed).toBe(false);
    expect(helpAllowed({ mode: "strictMock", submitted: true }, "reveal").allowed).toBe(false);
    expect(helpAllowed({ mode: "practice", submitted: false }, "reveal").allowed).toBe(false);
    expect(helpAllowed({ mode: "practice", submitted: false }, "hint").allowed).toBe(true);
    expect(helpAllowed({ mode: "practice", submitted: true }, "reveal").allowed).toBe(true);
  });

  it("执行成功：status=ok + token 粗估 + duration；失败返回 failed 信封不抛出", async () => {
    const runner = new AiTaskRunner(channel("OK 讲解"), {
      now: (() => {
        let n = 1000;
        return () => (n += 500);
      })(),
    });
    const env = await runner.run(ctx(), [{ role: "user", content: "题面" }]);
    expect(env.status).toBe("ok");
    expect(env.data.text).toBe("OK 讲解");
    expect(env.contextHash).toBe(taskContextHash(ctx()));
    expect(env.tokens).toBeGreaterThan(0);
    expect(env.durationMs).toBe(500);

    const bad = new AiTaskRunner({
      id: "test",
      chat: async () => {
        throw new Error("boom");
      },
    });
    const env2 = await bad.run(ctx(), [{ role: "user", content: "x" }]);
    expect(env2.status).toBe("failed");
    expect(env2.error).toBe("boom");
  });

  it("G6 闸门在执行器生效：strictMock/未提交揭示 → unsupported，通道零调用", async () => {
    let calls = 0;
    const counting: AiChannel = {
      id: "test",
      chat: async () => {
        calls++;
        return "x";
      },
    };
    const runner = new AiTaskRunner(counting);
    const env = await runner.run(ctx({ mode: "strictMock" }), [{ role: "user", content: "x" }]);
    expect(env.status).toBe("unsupported");
    const env2 = await runner.run(ctx({ submitted: false }), [{ role: "user", content: "x" }]);
    expect(env2.status).toBe("unsupported");
    expect(calls).toBe(0);
  });

  it("预算闸门：超 maxCalls 拒绝且不发请求（119-04 lite）", async () => {
    let calls = 0;
    const counting: AiChannel = {
      id: "test",
      chat: async () => {
        calls++;
        return "x";
      },
    };
    const runner = new AiTaskRunner(counting, { maxCalls: 1 });
    await runner.run(ctx(), []);
    const env = await runner.run(ctx(), []);
    expect(env.status).toBe("unsupported");
    expect(calls).toBe(1);
  });

  it("G1/G2 迟到隔离：身份一致才应用；改答/切题/改题后 stale 保留草稿", async () => {
    const runner = new AiTaskRunner(channel());
    const env = await runner.run(ctx(), []);
    expect(applyResult(env, ctx()).applied).toBe(true);
    expect(applyResult(env, ctx({ learnerAnswer: "C" })).reason).toBe("stale"); // 改答
    expect(applyResult(env, ctx({ sessionId: "s2" })).reason).toBe("stale"); // 换会话
    const revisedQ = { stem: q.stem, options: [...q.options, "4"] };
    const newCtx = ctx({ questionRevision: questionFingerprint(revisedQ) });
    expect(applyResult(env, newCtx).reason).toBe("stale"); // 题被修订
    expect(applyResult({ ...env, status: "failed" }, ctx()).reason).toBe("not-ok");
  });
});
