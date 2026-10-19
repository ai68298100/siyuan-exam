// 计数装饰通道：成本记录（28 组 P2）——tokens 按 chars/4 粗估
// 41-05：失败与取消的调用同样已送出，必须计入用量（不能只在成功路径累加 charsOut 就丢掉失败账）
import type { AiChannel, AiMessage } from "./client";
import { emptyLedger, recordCall, type CallUsage, type UsageLedger } from "../core/usageLedger";

export class CountingChannel implements AiChannel {
  readonly id: AiChannel["id"];
  calls = 0;
  charsIn = 0;
  charsOut = 0;
  /** 41-05：逐次调用账本（含失败与取消；skipped 表示未送出） */
  ledger: UsageLedger = emptyLedger();

  constructor(private readonly inner: AiChannel) {
    this.id = inner.id;
  }

  async chat(messages: AiMessage[]): Promise<string> {
    const charsIn = messages.reduce((n, m) => n + m.content.length, 0);
    this.calls++;
    this.charsIn += charsIn;
    const index = this.ledger.totals.calls + 1;
    try {
      const out = await this.inner.chat(messages);
      this.charsOut += out.length;
      this.ledger = recordCall(this.ledger, { index, charsIn, charsOut: out.length, outcome: "ok" });
      return out;
    } catch (e) {
      // 请求已送出但结果失败/中断：输入消耗如实入账，不因失败而漏记
      const outcome: CallUsage["outcome"] = /timeout|abort|cancel/i.test(String(e instanceof Error ? e.message : e))
        ? "cancelled"
        : "failed";
      this.ledger = recordCall(this.ledger, { index, charsIn, charsOut: 0, outcome });
      throw e;
    }
  }

  /** 粗估 token（经验值 ~4 chars/token，中文偏保守） */
  get approxTokens(): number {
    return Math.round((this.charsIn + this.charsOut) / 4);
  }
}
