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

// CSS 属性值可以影响插件壳的布局和交互，即使没有执行脚本也可能把题面
// 覆盖在导航/按钮上，或把必要内容隐藏。这里仅拦截高影响属性，保留颜色、
// 字体、间距、表格等正常排版；活动 token 则仍然按下方的整段 style 策略处理。
const CSS_LAYOUT_OR_INTERACTION_RE = /(?:^|;)\s*(?:-[a-z]+-)?(?:position|inset(?:-(?:block|inline)(?:-(?:start|end))?)?|top|right|bottom|left|z-index|pointer-events|visibility|opacity|display|transform(?:-[a-z-]+)?|translate|rotate|scale|clip(?:-path)?|mask(?:-[a-z-]+)?|filter|mix-blend-mode|isolation|contain|content|all|animation(?:-[a-z-]+)?|transition(?:-[a-z-]+)?|will-change)\s*:/i;
const CSS_ACTIVE_TOKEN_RE = /(?:@import|url\s*\(|image-set\s*\(|expression\s*\(|behavior\s*:|-moz-binding\s*:|var\s*\(|attr\s*\(|env\s*\(|--[a-z0-9_-]+\s*:|\/\*|\\)/i;

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
  // 保留相对路径、# 锚点和安全 data 等本地或已内嵌资源；blob 等其他协议仍由
  // DOMPurify 的 URI 策略处理。外链仍可作为 <a>
  // 由用户显式打开，且不改变其他富文本标签的渲染策略。
  if (typeof DOMParser === "undefined") return sanitized;
  const doc = new DOMParser().parseFromString(sanitized, "text/html");
  for (const image of Array.from(doc.querySelectorAll("img[src]"))) {
    const src = image.getAttribute("src")?.trim() ?? "";
    if (/^(?:https?:|\/\/|\\\\)/i.test(src)) {
      image.removeAttribute("src");
    } else if (src.startsWith("data:") && !/^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,/i.test(src)) {
      image.removeAttribute("src");
    }
  }
  // <a> 标签加固：防范危险协议与自动注入 noopener noreferrer
  for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href")?.trim() ?? "";
    if (/^(?:javascript|vbscript|file|blob|data):/i.test(href)) {
      anchor.removeAttribute("href");
    } else if (/^https?:\/\//i.test(href)) {
      anchor.setAttribute("rel", "noopener noreferrer");
    }
  }
  // <input> 标签加固：GFM 任务列表仅允许 checkbox，阻断伪装表单控件
  for (const input of Array.from(doc.querySelectorAll("input"))) {
    if (input.getAttribute("type") !== "checkbox") {
      input.remove();
    }
  }
  // CSS 的 url()/expression()/behavior 等能触发远程请求或协议注入；反斜杠、
  // 注释、var() 和 @import 还可隐藏或注入样式。保留普通 KaTeX 样式，风险 token 命中就
  // 移除整段 style，避免用不完整 CSS 解析器做错误放行。
  for (const element of Array.from(doc.querySelectorAll("[style]"))) {
    const style = element.getAttribute("style") ?? "";
    if (CSS_ACTIVE_TOKEN_RE.test(style) || CSS_LAYOUT_OR_INTERACTION_RE.test(style)) {
      element.removeAttribute("style");
    }
  }
  return doc.body.innerHTML;
}

/**
 * 轻量行内富文本安全呈现（用于选项、简短标签等单行文本）：
 * 支持 **粗体**、*斜体*、`行内代码`、x^2 上标、H~2~O / a_1 下标等轻量数学与排版格式，
 * 先 escapeHtml 防注入，再转标签，最后过 sanitizeRichHtml 白名单。
 */
export function renderInlineText(text: string): string {
  if (!text) return "";
  if (!/[*`~^<>]/.test(text) && !/_[0-9a-zA-Z]/.test(text)) return escapeHtml(text);
  let s = escapeHtml(text);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/`([^`]+)`/g, '<code class="lv-inline-code">$1</code>');
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  // 上标支持：x^2^ 或 x^2 / m^3
  s = s.replace(/\^([0-9a-zA-Z+-]+)\^/g, "<sup>$1</sup>");
  s = s.replace(/(?<=[a-zA-Z0-9\u4e00-\u9fa5])\^([0-9a-zA-Z+-]+)(?!\^)/g, "<sup>$1</sup>");
  // 下标支持：H~2~O 或 a_1 / x_i
  s = s.replace(/~([0-9a-zA-Z+-]+)~/g, "<sub>$1</sub>");
  s = s.replace(/(?<=[a-zA-Z0-9\u4e00-\u9fa5])_([0-9a-zA-Z+-]+)(?!_)/g, "<sub>$1</sub>");
  return sanitizeRichHtml(s);
}
