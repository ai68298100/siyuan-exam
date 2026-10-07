// HTML 转义与富文本净化（26.2 P0 → P0-07 收口）
// 用法：
// - 纯文本拼进 innerHTML/模板串 → escapeHtml；
// - 富文本（md2html 输出、AI 渲染结果）进 {@html}/dialog → sanitizeRichHtml（DOMPurify 白名单）。
// 边界事实（P0-07 实测结论）：内核 Lute md2html 对题干原文透传裸 HTML，
// 题干来自导入（CSV/GIFT/Aiken 等不可信源），"内核=可信源"的旧假设不成立——
// 因此富文本一律过 DOMPurify 白名单后才允许进入 DOM。
import DOMPurify from "dompurify";

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

// 排版 + 表格 + GFM 任务列表 + 图/链接； KaTeX 走 span+style，不需要额外标签
const RICH_ALLOWED_TAGS = [
  "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "code",
  "strong", "b", "em", "i", "u", "s", "del", "ins", "mark", "kbd", "sub", "sup", "small",
  "span", "div",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "a", "img", "figure", "figcaption",
  "details", "summary",
  "input",
];

// class/style 供思源排版与 KaTeX；id 供锚点；colspan/rowspan/start 供表格与有序列表
const RICH_ALLOWED_ATTR = [
  "class", "style", "id", "href", "src", "alt", "title",
  "colspan", "rowspan", "start", "type", "checked", "disabled",
];

/**
 * 富文本净化：所有进入 {@html} / dialog innerHTML 的第三方/渲染产物（md2html、AI 输出、
 * 导入内容衍生的 HTML）必须经此白名单。剥离 script/iframe/事件属性/javascript: 协议等
 * 活动向量；保留思源排版与 KaTeX 所需的 class/style。
 */
export function sanitizeRichHtml(html: string): string {
  // fail-closed：净化器不可用（无 DOMParser 的异常环境）时退化为纯文本，绝不放行未净化 HTML。
  // happy-dom 实测：DOMPurify.isSupported=false 时 sanitize 会原样返回脏输入，必须显式拦截。
  if (!DOMPurify.isSupported) return escapeHtml(html ?? "");
  const sanitized = DOMPurify.sanitize(html ?? "", {
    ALLOWED_TAGS: RICH_ALLOWED_TAGS,
    ALLOWED_ATTR: RICH_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    // 收紧协议：http(s)、mailto、锚点与相对路径；拒绝 javascript:/vbscript:/file: 等
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
  // 73-02：题文中的远程图片不能在用户打开题目时静默外发请求。
  // 保留相对路径、# 锚点和 data 等本地或已内嵌资源；blob 等其他协议仍由
  // DOMPurify 的 URI 策略处理。外链仍可作为 <a>
  // 由用户显式打开，且不改变其他富文本标签的渲染策略。
  if (typeof DOMParser === "undefined") return sanitized;
  const doc = new DOMParser().parseFromString(sanitized, "text/html");
  for (const image of Array.from(doc.querySelectorAll("img[src]"))) {
    const src = image.getAttribute("src")?.trim() ?? "";
    if (/^(?:https?:|\/\/|\\\\)/i.test(src)) image.removeAttribute("src");
  }
  return doc.body.innerHTML;
}
