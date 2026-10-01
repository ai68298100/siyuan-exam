// HTML 转义工具（26.2 P0：Dialog/题面/AI 输出禁止未净化 innerHTML）
// 用法：任何把动态文本拼进 innerHTML/模板串的路径必须先过 escapeHtml；
// 富文本（md2html 输出）在 DOMPurify 决策落地前仅允许来自内核 Lute（可信源），
// AI 输出一律先 escapeHtml 或走文本节点。

const ESC_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ESC_MAP[ch]);
}

/** 属性值转义（同 escapeHtml，语义别名，便于调用点自文档） */
export const escapeAttr = escapeHtml;
