// ============================================================
// AI 双通道客户端（docs/03 决策 #3；26.2 AI 数据流约束）
// - 通道 A（默认）：思源内置 AI —— 内核 /api/ai/chatGPT（用户已在思源配置模型）
// - 通道 B（高级）：OpenAI 兼容端点，用户自带 key（仅存本地插件数据）
// 数据流承诺（README/设置文案一致）：题源本地；仅用户主动调用时发送所选内容
// ============================================================
import type { KernelApiClient } from "../kernel/client";

export interface OpenAiConfig {
  endpoint: string;             // https://.../v1/chat/completions
  apiKey: string;
  model: string;
}

export type AiMessage = { role: "system" | "user" | "assistant"; content: string };

/** 统一接口：两条通道各自实现 */
export interface AiChannel {
  readonly id: "siyuan" | "openai";
  chat(messages: AiMessage[], signal?: AbortSignal): Promise<string>;
}

/** 通道 A：内核代理（无 key 管理、无 CORS 问题；响应 data 为字符串或 {text}） */
export class SiyuanAiChannel implements AiChannel {
  readonly id = "siyuan" as const;
  constructor(private readonly kernel: KernelApiClient) {}

  async chat(messages: AiMessage[], _signal?: AbortSignal): Promise<string> {
    // 思源 chatGPT 端点为单轮 msg 语义：拼接为一条消息（系统提示前缀）
    // 内核 API 无取消机制——signal 被忽略（长按取消仅中断本地 await，HTTP 已发出不可撤）
    const msg = messages.map((m) => (m.role === "system" ? `[指令]\n${m.content}` : m.content)).join("\n\n");
    const data = await this.kernel.aiChat(msg);
    if (typeof data === "string") return data;
    const rec = data as Record<string, unknown>;
    return String(rec?.text ?? rec?.content ?? "");
  }
}

/** 通道 B：OpenAI 兼容 /chat/completions */
export class OpenAiChannel implements AiChannel {
  readonly id = "openai" as const;
  constructor(
    private readonly cfg: OpenAiConfig,
    private readonly fetchImpl: (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>,
    private readonly timeoutMs = 60_000,
  ) {}

  async chat(messages: AiMessage[], signal?: AbortSignal): Promise<string> {
    if (!this.cfg.endpoint || !this.cfg.apiKey) {
      throw new Error("[lv-exam] AI 端点或 Key 未配置");
    }
    const ctrl = new AbortController();
    // 外部 signal → 内联中止（链式）
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.cfg.endpoint, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({ model: this.cfg.model, messages, temperature: 0.7 }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      const body = JSON.parse(text);
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("响应缺少 choices[0].message.content");
      return content;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
