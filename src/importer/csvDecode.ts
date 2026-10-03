// ============================================================
// CSV/文本编码检测（TODO 12 组）：UTF-8 优先，失败回退 GBK
// 判定依据：UTF-8 解码含替换符 U+FFFD → 视为非 UTF-8，尝试 GBK
// ============================================================

/** 替换符/控制符污染检测：合法 UTF-8 解码不应产生大量 U+FFFD */
function replacementRatio(text: string): number {
  if (!text.length) return 0;
  let bad = 0;
  for (const ch of text) if (ch === "\uFFFD") bad++;
  return bad / text.length;
}

/**
 * 按候选编码序列依次解码，返回第一个"无替换符污染"的结果；
 * 全部污染时返回 UTF-8 结果（调用方提示乱码风险）。
 */
export function decodeBuffer(buffer: ArrayBuffer, candidates: string[] = ["utf-8", "gbk"]): { text: string; encoding: string; confident: boolean } {
  const bytes = new Uint8Array(buffer);
  // UTF-8 BOM 检测
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(buffer), encoding: "utf-8-sig", confident: true };
  }
  let fallback = { text: "", encoding: candidates[0], confident: false };
  for (const enc of candidates) {
    try {
      const dec = new TextDecoder(enc);
      const text = dec.decode(buffer);
      if (!replacementRatio(text)) return { text, encoding: enc, confident: true };
      if (enc === candidates[0]) fallback = { text, encoding: enc, confident: false };
    } catch {
      // 编码不支持 → 继续下一候选
    }
  }
  return fallback;
}

/** 导出：检测 + 解码一步到位（onExcelFile 用） */
export function decodeCsv(buffer: ArrayBuffer): { text: string; encoding: string; garbled: boolean } {
  const r = decodeBuffer(buffer, ["utf-8", "gbk"]);
  return { text: r.text, encoding: r.encoding, garbled: !r.confident && r.text.includes("\uFFFD") };
}

// ---------- 分隔符自动探测（TODO 12 组）：逗号 / 分号 / Tab ----------

/**
 * 前 20 行样本内计数字符出现次数，取最多者；并列时按 , ; \t 优先级取先。
 * 仅服务 CSV 文件导入路径（XLSX.read 的 FS 参数）；粘贴 Aiken 文本不走此探测。
 */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  let best = ",";
  let bestN = -1;
  for (const d of [",", ";", "\t"]) {
    let n = 0;
    for (let i = 0; i < sample.length; i++) if (sample[i] === d) n++;
    if (n > bestN) { best = d; bestN = n; }
  }
  return best;
}
