// 计数装饰通道：成本记录（28 组 P2）——tokens 按 chars/4 粗估
import type { AiChannel, AiMessage } from "./client";

export class CountingChannel implements AiChannel {
  readonly id: AiChannel["id"];
  calls = 0;
  charsIn = 0;
  charsOut = 0;

  constructor(private readonly inner: AiChannel) {
    this.id = inner.id;
  }

  async chat(messages: AiMessage[]): Promise<string> {
    this.calls++;
    this.charsIn += messages.reduce((n, m) => n + m.content.length, 0);
    const out = await this.inner.chat(messages);
    this.charsOut += out.length;
    return out;
  }

  /** 粗估 token（经验值 ~4 chars/token，中文偏保守） */
  get approxTokens(): number {
    return Math.round((this.charsIn + this.charsOut) / 4);
  }
}
