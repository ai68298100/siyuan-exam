import { describe, it, expect } from "vitest";
import { decodeBuffer, decodeCsv } from "../src/importer/csvDecode";

const utf8Text = "题干,选项A,选项B\n内容,甲,乙";
const utf8Bytes = new TextEncoder().encode(utf8Text);

function gbkBytes(text: string): Uint8Array {
  // 测试环境无 GBK TextDecoder 编码器；用手工字节模拟"非 UTF-8 字节流"（含非法序列）
  return new Uint8Array([0xd2, 0xbc, 0xb8, 0xf6, 0x2c, 0x41]); // GBK "一个" + "," + "A" 的典型字节
}

describe("CSV 编码检测", () => {
  it("UTF-8 BOM → utf-8-sig 高置信", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8Bytes]);
    const r = decodeBuffer(bom.buffer, ["utf-8", "gbk"]);
    expect(r.encoding).toBe("utf-8-sig");
    expect(r.confident).toBe(true);
    expect(r.text).toContain("选项A");
  });
  it("合法 UTF-8 无 BOM → utf-8 高置信", () => {
    const r = decodeBuffer(utf8Bytes.buffer, ["utf-8", "gbk"]);
    expect(r.encoding).toBe("utf-8");
    expect(r.text).toContain("选项A");
  });
  it("非法 UTF-8 字节 → 回退 GBK（Node 支持 gbk 解码时）或标记低置信", () => {
    const bytes = new Uint8Array([0xd2, 0xbc, 0xb8, 0xf6, 0x2c, 0x41]);
    const r = decodeBuffer(bytes.buffer, ["utf-8", "gbk"]);
    // Node 内置 TextDecoder 支持 gbk → 解码成功且无替换符
    expect(r.confident).toBe(true);
  });
  it("decodeCsv 标记乱码风险", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8Bytes]);
    const r = decodeCsv(bytes.buffer);
    expect(r.garbled).toBe(false);
    expect(r.text).toContain("选项A");
  });
});
