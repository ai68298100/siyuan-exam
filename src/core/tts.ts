// TTS 读题（v0.5 lite）：Web Speech API 封装（docs/11 听学；纯听题模式待 v0.5.x）
// 不支持的环境静默降级（返回 false，UI 按钮常显但不生效）

export const ttsSupported = (): boolean =>
  typeof globalThis.speechSynthesis !== "undefined" && typeof globalThis.SpeechSynthesisUtterance !== "undefined";

export function ttsSpeak(text: string, rate = 1): boolean {
  if (!ttsSupported()) return false;
  const synth = globalThis.speechSynthesis;
  synth.cancel();
  // 按句切分（引擎对超长文本不稳；docs/11 §听学）
  const sentences = text.split(/(?<=[。？！?!.;；])\s*/).filter((s) => s.trim());
  for (const sentence of sentences) {
    const u = new SpeechSynthesisUtterance(sentence);
    u.lang = "zh-CN";
    u.rate = Math.min(2, Math.max(0.8, rate));
    synth.speak(u);
  }
  return true;
}

export function ttsStop(): void {
  globalThis.speechSynthesis?.cancel();
}
