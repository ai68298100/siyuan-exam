import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { resolveWorkbookKind, parseWorkbookFile } from "../src/importer/workbookFile";

/** 构造真实 XLSX 二进制（38-01：文件入口此前按文本解码真 XLSX 必报 Bad compressed size） */
function buildXlsxBytes(sheets: Record<string, string[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(out);
}

describe("38-01 文件入口分流", () => {
  it("resolveWorkbookKind：xlsx/xls → 二进制路径，csv → 文本路径，其余不支持", () => {
    expect(resolveWorkbookKind("题库.xlsx")).toBe("xlsx");
    expect(resolveWorkbookKind("OLD.XLS")).toBe("xlsx");
    expect(resolveWorkbookKind("export.csv")).toBe("csv");
    expect(resolveWorkbookKind("bank.sy.zip")).toBe("unsupported");
    expect(resolveWorkbookKind("noext")).toBe("unsupported");
  });

  it("真 XLSX 二进制经二进制路径解析成功（多 sheet round-trip）", async () => {
    const bytes = buildXlsxBytes({
      题库: [
        ["题型", "题干", "选项A", "答案"],
        ["单选", "1+1=?", "2", "A"],
      ],
      备用: [["题干"], ["第二题"]],
    });
    const r = await parseWorkbookFile(XLSX, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "题库.xlsx");
    expect(r.garbled).toBe(false);
    expect(r.encoding).toBe("binary");
    expect(r.sheetNames).toEqual(["题库", "备用"]);
    expect(r.sheets.get("题库")![1][1]).toBe("1+1=?");
    expect(r.sheets.get("备用")![1][0]).toBe("第二题");
  });

  it("UTF-8 CSV 走文本路径，逗号分隔", async () => {
    const text = "题型,题干,答案\n单选,水的沸点?,A";
    const bytes = new TextEncoder().encode(text);
    const r = await parseWorkbookFile(XLSX, bytes.buffer as ArrayBuffer, "t.csv");
    expect(r.encoding).toBe("utf-8");
    expect(r.garbled).toBe(false);
    expect(r.sheetNames).toEqual(["Sheet1"]);
    expect(r.sheets.get("Sheet1")![1][1]).toBe("水的沸点?");
  });

  it("GBK CSV 回退解码成功且不误报乱码；双编码失败才标 garbled", async () => {
    // 0xD2 0xBC 0xB8 0xF6 = GBK「几个」；合法 UTF-8 解码必含替换符 → 回退 GBK
    const gbk = new Uint8Array([0xd2, 0xbc, 0xb8, 0xf6, 0x2c, 0x41]);
    const r = await parseWorkbookFile(XLSX, gbk.buffer, "t.csv");
    expect(r.encoding).toBe("gbk");
    expect(r.garbled).toBe(false);
    // 0xFF 0xFF 在 UTF-8/GBK 均非法 → 低置信 + 替换符 → garbled
    const bad = new Uint8Array([0xff, 0xff, 0x2c, 0x41]);
    const r2 = await parseWorkbookFile(XLSX, bad.buffer, "t.csv");
    expect(r2.garbled).toBe(true);
  });

  it("不支持类型抛可行动错误", async () => {
    await expect(parseWorkbookFile(XLSX, new ArrayBuffer(4), "notes.txt")).rejects.toThrow(/不支持/);
  });
});
