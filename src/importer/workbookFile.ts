// ============================================================
// 文件入口二进制/文本分流（TODO 38-01）：
// XLSX/XLS 保留二进制读取（type:"array"），仅 CSV 才做编码探测 + 分隔符探测。
// 此前 .xlsx 也走 decodeCsv 文本路径 → 二进制 ZIP 被当文本解析，真 XLSX 报
// "Bad compressed size"（官方模板/中文 XLSX 全部导入失败）。
// ============================================================
import type * as XLSXType from "xlsx";
import { decodeCsv, detectDelimiter } from "./csvDecode";

export type WorkbookKind = "xlsx" | "csv" | "unsupported";

/** 按扩展名分流（拖拽与文件选择共用；无扩展名视为不支持） */
export function resolveWorkbookKind(fileName: string): WorkbookKind {
  if (/\.(xlsx|xls)$/i.test(fileName)) return "xlsx";
  if (/\.csv$/i.test(fileName)) return "csv";
  return "unsupported";
}

export interface WorkbookParse {
  sheetNames: string[];
  /** sheet 名 → 二维行（header:1, 空单元格补 ""，与既有 Excel 流程同口径） */
  sheets: Map<string, string[][]>;
  /** CSV 路径专用：编码不可信（疑似非 UTF-8/GBK）；二进制路径恒 false */
  garbled: boolean;
  /** CSV 实际使用的编码；二进制路径为 "binary" */
  encoding: string;
}

/** CSV 路径的元信息（解析 workbook 前先解码一次取得） */
interface CsvMeta {
  garbled: boolean;
  encoding: string;
}

/**
 * 按类型解析工作簿文件：
 * - xlsx/xls：二进制交 SheetJS（公式/多 sheet/格式由库处理），不做编码探测；
 * - csv：decodeCsv（UTF-8 优先回退 GBK）→ 文本 + 分隔符探测读取。
 * 不支持的类型抛可行动错误，由调用方显示。
 */
export async function parseWorkbookFile(
  XLSX: typeof XLSXType,
  buf: ArrayBuffer,
  fileName: string,
): Promise<WorkbookParse> {
  const kind = resolveWorkbookKind(fileName);
  if (kind === "unsupported") {
    throw new Error(`不支持的文件类型：${fileName || "(未命名)"}（支持 .xlsx / .xls / .csv）`);
  }
  let csvMeta: CsvMeta = { garbled: false, encoding: "binary" };
  const wb =
    kind === "xlsx"
      ? XLSX.read(new Uint8Array(buf), { type: "array" })
      : (() => {
          const r = decodeCsv(buf);
          csvMeta = { garbled: r.garbled, encoding: r.encoding };
          return XLSX.read(r.text, { type: "string", FS: detectDelimiter(r.text) });
        })();
  const sheetNames = wb.SheetNames;
  const sheets = new Map(
    sheetNames.map((n) => {
      const rows = (wb.Sheets[n]
        ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" })
        : []) as string[][];
      return [n, rows] as [string, string[][]];
    }),
  );
  return { sheetNames, sheets, garbled: csvMeta.garbled, encoding: csvMeta.encoding };
}
