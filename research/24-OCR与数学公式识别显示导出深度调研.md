# OCR 与数学公式识别、显示及导出深度调研报告（2026-10-22）

> 调研背景：对于考研、考公、专升本、K12 理科、医学、工科及金融等严肃备考群体，数学公式、物理化学方程、图表及扫描版试卷是高频刚需题源。
> 本调研深入剖析思源笔记最新自带的 OCR 接口机制，横向对比业界主流 OCR 与公式识别方案，并针对数学公式的**识别输入、格式归一、前端渲染（KaTeX/MathJax）与双栏打印导出**建立完整的工程化落地体系。

---

## 一、 思源笔记最新自带 OCR 能力深度解析

### 1.1 内核 API 契约与底层链路
在思源笔记 v3.8+ 体系中，内核已开放了面向附件资源（assets）的内置 OCR 接口（见 `node_modules/siyuan/types/api/index.d.ts`）：

| 接口端点 | 方法 | 请求参数 | 返回结构 | 核心机制与特征 |
|---|---|---|---|---|
| `/api/asset/ocr` | POST | `{ path: string }` | `{ code: 0, data: AssetOCRData }` | 主动对指定附件图片（如 `assets/q-1.png`）执行 OCR 识别，返回全文本与行块坐标。 |
| `/api/asset/getImageOCRText` | POST | `{ path: string }` | `{ code: 0, data: { text: string } }` | 读取思源内核已索引的 OCR 缓存文本，避免同一图片重复消耗算力。 |
| `/api/asset/setImageOCRText` | POST | `{ path: string, text: string }` | `{ code: 0, data: null }` | 手工或插件校对后回写修正后的 OCR 文本，利于全文检索与后续读取。 |
| `/api/asset/upload` | POST (multipart) | `FormData(file)` | `{ code: 0, data: { succMap } }` | 将外部图片/剪贴板图片安全上传到当前笔记本 assets 目录。 |

**数据结构规格（`AssetOCRData`）**：
```typescript
export interface AssetOCRData {
  text: string; // 识别出的完整连续纯文本（包含换行符）
  ocrJSON: Array<{
    words: string; // 当前识别文本行内容
    location?: { top: number; left: number; width: number; height: number }; // 物理像素包围盒
  }> | null;
}
```

### 1.2 思源内置 OCR 的优势与短板评估
- **核心优势**：
  1. **零配置、完全本地离线**：无需配置第三方 AppKey、无任何调用计费，符合思源“隐私与本地优先（Local-First）”的核心价值观；
  2. **与文档/资产原生打通**：识别文本会自动纳入思源 FTS 全文检索索引库；
  3. **速度极快**：对于标准印刷体中文、英文、标点符号具有高准确率。
- **现存短板与痛点**：
  1. **公式识别羸弱**：思源内置离线 OCR 主要基于通用文字模型（如 PaddleOCR 轻量版），缺乏专业数学公式模型，常将分式 $\frac{a}{b}$ 识别为 `a-b` 或 `a/b`，将积分号 $\int$、希腊字母 $\alpha, \beta, \theta$、根号 $\sqrt{x}$、矩阵误识别为英文乱码；
  2. **缺乏试题语义切分**：输出结果仅为扁平的一维文字行，无法自动划分“题干”、“选项 A/B/C/D”、“答案”、“解析”；
  3. **分行断字生硬**：题目换行处常常出现多余硬回车或在公式中间被截断。

---

## 二、 业界主流 OCR 与公式识别方案横向调研

| 方案类别 | 代表产品 / 技术 | 识别准确度 | 数学公式支持度 | 试题结构化能力 | 部署与集成成本 | 适用场景 |
|---|---|---|---|---|---|---|
| **专业公式 OCR** | **Mathpix Snip / API** | ★★★★★ | ★★★★★ (LaTeX 原生) | ★★★☆☆ (需正则分切) | 需商业授权，按次/按月计费 | 高阶理科科研、纯公式论文录入 |
| **教育专业云端 OCR** | **百度文心试题识别 / 腾讯云试题 OCR / 菁优网** | ★★★★☆ | ★★★★☆ (支持中低难度 LaTeX) | ★★★★☆ (专有题干/选项/答案识别) | 需申请云 API Key，有免费额度后付费 | 扫描试卷整页批量切题入库 |
| **开源本地 OCR** | **RapidOCR / PaddleOCR / Tesseract** | ★★★☆☆ | ★☆☆☆☆ (仅基础符号) | ★☆☆☆☆ (纯文本行) | 浏览器插件需借助 WASM/ONNX，体积大 | 离线纯文本识别 |
| **多模态视觉大模型 (VLM)** | **GPT-4o / Claude 3.5 Sonnet / Qwen2-VL / DeepSeek-VL** | ★★★★★ | ★★★★★ (原生输出 $...$ LaTeX) | ★★★★★ (直接端到端输出结构化 JSON) | 直接复用现有 AI 通道（OpenAI/本地），体验降维打击 | **现代题库录入与错题拍照的终极形态** |

### 2.1 现代趋势启示：从“传统 OCR 拼图”到“多模态大模型端到端提题”
- **传统路径**：图片 $\to$ OCR 提取扁平文字 $\to$ 正则表达式提取题干与选项 $\to$ 人工修复公式 $\to$ 生成题目。流程长、边界条件极其脆弱，遇到稍微复杂的排版就崩溃。
- **先进路径（小驴考试推荐方案）**：
  1. **双轨驱动（Dual-Track）**：
     - **离线轨道（思源内置）**：调用 `/api/asset/ocr`，配合自研的**试题结构启发式切分器（`parseOcrQuestionText`）**，在零网络、零费用的情况下完成 80% 的常规文字题录入；
     - **云端/大模型轨道（多模态视觉）**：直接复用小驴考试既有的 `SiyuanAiChannel` / `OpenAiChannel` 与 `AiTaskRunner`，将试卷截图传入 Vision 模型，一次性端到端返回完美的题型、Markdown 题干、LaTeX 公式、选项列表、答案及解析。

---

## 三、 数学公式（LaTeX）全生命周期工程化规范

### 3.1 格式多样性与格式归一化（Normalize）
在现实备考题库中，数学公式来源多样，常见以下格式漂移，需在入库与渲染前做统一归一化：
1. **行内公式定界符归一**：将 `\( ... \)` 统一归一化为标准的 `$ ... $`；
2. **块级公式定界符归一**：将 `\[ ... \]` 统一归一化为标准的 `$$ ... $$`；
3. **OCR 常见粘连与错符自动修复**：
   - 空格断裂修复：如 `\ frac { a } { b }` 纠正为 `\frac{a}{b}`；`\ sqrt { x }` 纠正为 `\sqrt{x}`；
   - 常见错符纠正：如 OCR 将 `\le` 识别为 `< =`、`\ge` 识别为 `> =`、`\pm` 识别为 `+ -`、`\times` 识别为 `*`；
   - 希腊字母与数学符号规范：`alpha` 修复为 `\alpha`，`pi` 修复为 `\pi`，`infty` 修复为 `\infty`；
4. **Markdown 转义冲突防范**：在解析选项时，防止选项中的 `A.` 序号与公式内的字母产生正则误判。

### 3.2 前端显示与渲染（KaTeX vs MathJax）
- **性能与体积对比**：
  - **KaTeX**：速度比 MathJax 快一个数量级（同步渲染 1000 个公式 < 50ms），纯 CSS 布局，且思源笔记自身默认内置了 KaTeX 样式与字体资源；
  - **MathJax**：功能更全（支持全部复杂宏），但体积庞大、异步加载有明显重排抖动（Flash of Unstyled Math）。
- **小驴考试的优雅双模渲染架构**：
  1. **一级优先：宿主全局 KaTeX 探测**：若 `window.katex` 存在，调用 `katex.renderToString(expr, { throwOnError: false })` 获得像素级出版效果；
  2. **二级优雅降级：纯语义 HTML / MathML 解析器**：在离线单测环境、无 KaTeX 运行时或轻量选项行内渲染中，内置自主研发的 LaTeX 语义解析器，将分式、上下标、根号、希腊字母转换为结构化 HTML 标签（`<span class="lv-math-frac">`、`<sup>`、`<sub>` 等）及 MathML，彻底告别原始丑陋代码字符。

### 3.3 打印导出（A4 双栏试卷与答题册）的最佳实践
- **现状缺陷**：原 `printPro.ts` 导出 HTML 时简单调用 `escapeHtml(q.stem)`，导致打印出来的试卷公式显示为 `$\frac{1}{2}$` 纯代码。
- **出版级打印增强方案**：
  1. 在导出的独立 HTML 文件中，将题干与选项通过 `renderMathInText` 转换为具有完整排版标签的富文本；
  2. 注入针对 A4 打印优化的 **Print-Safe 数学排版 CSS**：
     - 分数线微调（`border-bottom: 1px solid currentColor`）；
     - 分子分母居中对齐、字号比例微缩（0.85em）；
     - 上下标防止撑大行高（`line-height: 0; position: relative`）；
     - 公式内部强制 `white-space: nowrap`，防止长公式跨栏跨行断裂。

---

## 四、 本轮工程化交付与待办规划

1. **新建 `src/core/ocr.ts`（试题 OCR 与结构化提取引擎）**：
   - 封装思源原生 `/api/asset/ocr` 接口调用契约；
   - 实现 `parseOcrQuestionText`：支持单选/多选/判断/填空/简答的启发式自动分拣；
   - 提供多模态视觉大模型试题提取的标准 Prompt 模板。
2. **新建 `src/core/math.ts`（LaTeX 公式规范化与双模渲染引擎）**：
   - 实现 `normalizeLatexFormula` 语法归一化；
   - 实现 `renderMathInText`（KaTeX 宿主探测 + 语义 HTML 降级引擎）；
   - 在 `src/libs/sanitize.ts` 的 `renderInlineText` 中接入公式支持（使选项支持 LaTeX）；
   - 在 `src/core/printPro.ts` A4 双栏试卷中完成公式无缝渲染与打印排版 CSS 注入。
3. **在 `ExamApp` 中暴露接口并编写全面单测保障**。
