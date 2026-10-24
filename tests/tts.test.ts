import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ttsSupported, ttsSpeak, ttsStop } from "../src/core/tts";

describe("TTS 语音朗读引擎 (tts)", () => {
  it("遇到空文本或空白文本安全返回 false 不调用语音合成", () => {
    expect(ttsSpeak("")).toBe(false);
    expect(ttsSpeak("   ")).toBe(false);
    expect(ttsSpeak(null as unknown as string)).toBe(false);
    expect(ttsSpeak(undefined as unknown as string)).toBe(false);
  });

  describe("有 SpeechSynthesis 环境时的调用与按句切分", () => {
    let mockSynth: any;

    beforeEach(() => {
      mockSynth = {
        cancel: vi.fn(),
        speak: vi.fn(),
      };
      (globalThis as any).speechSynthesis = mockSynth;
      (globalThis as any).SpeechSynthesisUtterance = function (this: any, text: string) {
        this.text = text;
      };
    });

    afterEach(() => {
      delete (globalThis as any).speechSynthesis;
      delete (globalThis as any).SpeechSynthesisUtterance;
    });

    it("ttsSupported 在支持环境下返回 true", () => {
      expect(ttsSupported()).toBe(true);
    });

    it("ttsSpeak 按标点切分并逐句朗读", () => {
      const ok = ttsSpeak("第一句。第二句！第三句？");
      expect(ok).toBe(true);
      expect(mockSynth.cancel).toHaveBeenCalledTimes(1);
      expect(mockSynth.speak).toHaveBeenCalledTimes(3);
    });

    it("ttsStop 调用 cancel 停止播放", () => {
      ttsStop();
      expect(mockSynth.cancel).toHaveBeenCalledTimes(1);
    });
  });
});
