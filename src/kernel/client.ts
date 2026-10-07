// ============================================================
// KernelApiClient：内核 HTTP 统一收口（docs/03 决策 #1、26.1）
// - 传输层可替换（renderer=petal fetchSync；测试=mock transport）
// - 统一超时 / 有限重试 / 错误二分类（retryable | fatal）
// - 启动能力探测（md2html / query / riff / 属性），失败降级为明确能力位
// ============================================================
import type { Question } from "../core/types";
import { questionToMarkdown, questionFromBlock } from "../core/blockTemplate";

export interface KernelTransport {
  post(endpoint: string, payload: unknown): Promise<{ code: number; msg: string; data: unknown }>;
  /** multipart 文件上传（importSY 等；38-05 实测：JSON path 形态返回 -1）。可选：测试桩可不实现 */
  postForm?(endpoint: string, file: Blob, filename: string): Promise<{ code: number; msg: string; data: unknown }>;
}

export type ErrKind = "retryable" | "fatal";
export class KernelError extends Error {
  constructor(
    readonly kind: ErrKind,
    readonly endpoint: string,
    msg: string,
    readonly cause?: unknown,
  ) {
    super(`[${endpoint}] ${msg} (${kind})`);
  }
}

const RETRIABLE_HOST = /ECONN|ETIMEDOUT|timeout|abort|network/i;

function classify(e: unknown): ErrKind {
  const msg = e instanceof Error ? e.message : String(e);
  return RETRIABLE_HOST.test(msg) ? "retryable" : "fatal";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ProbeResult {
  kernelOk: boolean;
  version: string;
  md2html: boolean;
  query: boolean;
  riff: boolean;
}

export interface FetchLike {
  (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string | FormData; signal?: AbortSignal },
  ): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
}

/** HTTP 传输：直连内核（renderer 环境带 token；测试注入 fetchLike） */
export class HttpTransport implements KernelTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike,
    private readonly timeoutMs = 10_000,
    private readonly retries = 1,
  ) {}

  async post(endpoint: string, payload: unknown) {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      let retryDelay: number | undefined;
      try {
        const res = await this.fetchImpl(this.baseUrl + endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Token ${this.token}`,
          },
          body: JSON.stringify(payload ?? {}),
          signal: ctrl.signal,
        });
        const text = await res.text();
        if (!res.ok) {
          // 429 限流（3.8.6 真机发现）：归 retryable 走退避重试；Retry-After 提示带回
          if (res.status === 429) throw new KernelError("retryable", endpoint, "HTTP 429 限流，稍后重试");
          throw new KernelError("fatal", endpoint, `HTTP ${res.status}`);
        }
        let body: { code: number; msg: string; data: unknown };
        try {
          body = JSON.parse(text);
        } catch {
          throw new KernelError("fatal", endpoint, "非 JSON 响应");
        }
        if (body.code !== 0) throw new KernelError("fatal", endpoint, body.msg || `code ${body.code}`);
        return body;
      } catch (e) {
        lastErr = e;
        const kind = e instanceof KernelError ? e.kind : classify(e);
        if (kind === "fatal" || attempt === this.retries) {
          throw e instanceof KernelError
            ? e
            : new KernelError(kind, endpoint, e instanceof Error ? e.message : String(e), e);
        }
        const retryAfter = /429/.test(String(lastErr)) ? 1000 : 300;
        retryDelay = retryAfter * (attempt + 1);
      } finally {
        clearTimeout(timer);
      }
      if (retryDelay !== undefined) await sleep(retryDelay);
    }
    throw lastErr;
  }

  /** multipart 文件上传（importSY 契约，38-05 真机实测：JSON path 形态返回 -1）。
   *  浏览器 FormData 自动带 boundary，不可手工设 Content-Type */
  async postForm(endpoint: string, file: Blob, filename: string) {
    const fd = new FormData();
    fd.append("file", file, filename);
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      let retryDelay: number | undefined;
      try {
        const res = await this.fetchImpl(this.baseUrl + endpoint, {
          method: "POST",
          headers: { Authorization: `Token ${this.token}` },
          body: fd,
          signal: ctrl.signal,
        });
        const text = await res.text();
        if (!res.ok) {
          if (res.status === 429) throw new KernelError("retryable", endpoint, "HTTP 429 限流，稍后重试");
          throw new KernelError("fatal", endpoint, `HTTP ${res.status}`);
        }
        let body: { code: number; msg: string; data: unknown };
        try {
          body = JSON.parse(text);
        } catch {
          throw new KernelError("fatal", endpoint, "非 JSON 响应");
        }
        if (body.code !== 0) throw new KernelError("fatal", endpoint, body.msg || `code ${body.code}`);
        return body;
      } catch (e) {
        lastErr = e;
        const kind = e instanceof KernelError ? e.kind : classify(e);
        if (kind === "fatal" || attempt === this.retries) {
          throw e instanceof KernelError
            ? e
            : new KernelError(kind, endpoint, e instanceof Error ? e.message : String(e), e);
        }
        const retryAfter = /429/.test(String(lastErr)) ? 1000 : 300;
        retryDelay = retryAfter * (attempt + 1);
      } finally {
        clearTimeout(timer);
      }
      if (retryDelay !== undefined) await sleep(retryDelay);
    }
    throw lastErr;
  }
}

export class KernelApiClient {
  constructor(private readonly t: KernelTransport) {}

  /** 启动探测：任何一项失败只置位 false，不抛出（离线降级的依据） */
  async probe(): Promise<ProbeResult> {
    const r: ProbeResult = { kernelOk: false, version: "", md2html: false, query: false, riff: false };
    try {
      const v = await this.t.post("/api/system/version", {});
      r.kernelOk = true;
      r.version = String((v.data as Record<string, unknown>)?.version ?? "");
    } catch {
      return r;
    }
    try {
      await this.renderMarkdown("x");
      r.md2html = true;
    } catch {
      /* md2html 不可用 */
    }
    try {
      await this.t.post("/api/query/sql", { stmt: "SELECT 1" });
      r.query = true;
    } catch {
      /* SQL 不可用 */
    }
    try {
      await this.t.post("/api/riff/getRiffDecks", {});
      r.riff = true;
    } catch {
      /* riff 不可用 */
    }
    return r;
  }

  /** 思源内置 AI（/api/ai/chatGPT 单轮 msg 语义；端点 2026-10-02 实测存在） */
  async aiChat(msg: string): Promise<unknown> {
    const r = await this.t.post("/api/ai/chatGPT", { msg });
    return r.data;
  }

  async getNotebookConf(notebookId: string): Promise<{ name: string; dailyNoteSavePath: string }> {
    const r = await this.t.post("/api/notebook/getNotebookConf", { notebook: notebookId });
    const d = (r.data as Record<string, unknown>) ?? {};
    const conf = (d.conf as Record<string, string>) ?? {};
    return { name: String(d.name ?? ""), dailyNoteSavePath: String(conf.dailyNoteSavePath ?? "") };
  }

  /** 笔记本导出 .sy.zip（题库包分享；返回工作区相对路径，如 /export/X.sy.zip） */
  async exportNotebookSy(notebookId: string): Promise<{ zipPath: string }> {
    const r = await this.t.post("/api/export/exportNotebookSY", { id: notebookId });
    const zip = String((r.data as Record<string, unknown>)?.zip ?? "");
    if (!zip) throw new KernelError("fatal", "exportNotebookSY", "响应缺少 zip 路径");
    return { zipPath: zip };
  }

  /** 原生包导入（38-05 真机契约）：importSY 要求 multipart/form-data 文件上传，
   *  JSON {path} 绝对路径形态返回 -1（2026-10-04 实测）——旧实现已废弃。
   *  导入的笔记本按包内名称落库（同名自动避让），需调用方随后 lsNotebooks 登记 */
  async importSyUpload(file: Blob, filename = "bank.sy.zip"): Promise<void> {
    if (!this.t.postForm) throw new KernelError("fatal", "/api/import/importSY", "传输层不支持 multipart 上传");
    await this.t.postForm("/api/import/importSY", file, filename);
  }

  /** 笔记本清单（38-06 lite：导入后发现/登记新库；closed 笔记本不返回） */
  async listNotebooks(): Promise<{ id: string; name: string }[]> {
    const r = await this.t.post("/api/notebook/lsNotebooks", {});
    const notebooks = (r.data as { notebooks?: { id: string; name: string; closed?: boolean }[] } | null)?.notebooks ?? [];
    return notebooks.filter((n) => !n.closed).map((n) => ({ id: n.id, name: n.name }));
  }

  /** 文档导出 Markdown（AI 出题"当前文档"输入源；2026-10-02 实测返回 hPath+content，content 带 YAML 头需剥离） */
  async exportDocMarkdown(docId: string): Promise<{ title: string; content: string }> {
    const r = await this.t.post("/api/export/exportMdContent", { id: docId });
    const d = (r.data ?? {}) as { hPath?: string; content?: string };
    const raw = String(d.content ?? "");
    const content = raw.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
    return { title: (d.hPath ?? "").split("/").pop() ?? "", content };
  }

  async renderMarkdown(markdown: string): Promise<string> {
    const r = await this.t.post("/api/lute/md2html", { markdown, mode: "" });
    return String((r.data as Record<string, unknown>)?.html ?? "");
  }

  async sql<T = Record<string, unknown>>(stmt: string): Promise<T[]> {
    const r = await this.t.post("/api/query/sql", { stmt });
    return (r.data as T[]) ?? [];
  }

  async createNotebook(name: string): Promise<string> {
    const r = await this.t.post("/api/notebook/createNotebook", { name });
    const d = r.data as unknown;
    // 形状漂移（perf-bank 脚本 3.8.6 实测发现）三形态并存：
    // ① 3.8.6={ notebook: { id, ... } } 嵌套对象；② 3.8.5 部分={ notebook: "id" }；③ 另有裸 id 字符串。
    // 取不到 id 时显式失败，绝不带 "[object Object]" 下行。
    const id =
      typeof d === "string"
        ? d
        : String(
            (d as { notebook?: { id?: string } | string } | null)?.notebook != null
              ? typeof (d as { notebook: { id?: string } | string }).notebook === "string"
                ? (d as { notebook: string }).notebook
                : ((d as { notebook: { id?: string } }).notebook.id ?? "")
              : ((d as { id?: string })?.id ?? ""),
          );
    if (!id || id === "[object Object]" || id === "null") {
      throw new KernelError(
        "fatal",
        "notebook/createNotebook",
        `响应缺少 notebook id（内核版本形状变化？）: ${JSON.stringify(d).slice(0, 80)}`,
      );
    }
    return id;
  }

  async createDocWithMd(notebook: string, hpath: string, markdown: string): Promise<string> {
    const r = await this.t.post("/api/filetree/createDocWithMd", { notebook, path: hpath, markdown });
    return String(r.data ?? "");
  }

  /** 写入工作区文件（120-02 资料登记：/api/file/putFile，file=base64；目录不存在自动创建） */
  async putFile(path: string, base64: string): Promise<void> {
    await this.t.post("/api/file/putFile", { path, file: base64, isDir: false, mtime: Math.floor(Date.now() / 1000) });
  }

  /** 删除工作区文件（资料移除时的可选清理；调用方自担确认） */
  async removeFile(path: string): Promise<void> {
    await this.t.post("/api/file/removeFile", { path });
  }

  async appendBlock(parentId: string, markdown: string): Promise<string[]> {
    // 3.8.5 实测：insertBlock 必须带 dataType
    const r = await this.t.post("/api/block/insertBlock", { dataType: "markdown", data: markdown, parentID: parentId });
    const ops = (r.data as { doOperations?: { id?: string }[] }[] | null)?.[0]?.doOperations;
    return ops ? ops.map((o) => String(o.id ?? "")) : [];
  }

  /** 批量写入题目块：返回 (qid, blockId) 对（insertBlock 响应逐操作回传） */
  async appendQuestions(parentId: string, questions: Question[]): Promise<{ qid: string; blockId: string }[]> {
    const out: { qid: string; blockId: string }[] = [];
    // 分批 20 题，避免单请求过大（TODO 12 组：分批事务化）
    for (let i = 0; i < questions.length; i += 20) {
      const slice = questions.slice(i, i + 20);
      const md = slice.map(questionToMarkdown).join("\n");
      const r = await this.t.post("/api/block/insertBlock", {
        dataType: "markdown",
        data: md,
        parentID: parentId,
      });
      const opsArr = Array.isArray(r.data) ? (r.data as { doOperations?: { id?: string }[] }[]) : [];
      const ops = opsArr[0]?.doOperations ?? [];
      ops.forEach((op, j) => {
        if (slice[j]) out.push({ qid: slice[j].id, blockId: String(op.id ?? "") });
      });
    }
    return out;
  }

  /** 题库内检索：custom-exam-* 属性驱动（2026-10-02 实测前缀约定）；带 root_id 供文档跳转、hpath 供章节树过滤 */
  async listQuestions(notebook: string): Promise<(Question & { blockId: string; rootId: string; hpath: string })[]> {
    const rows = await this.sql<Record<string, string>>(
      `SELECT b.id AS blockId, b.root_id AS rootId, b.content AS content, b.hpath AS hpath,
              a.name AS attrName, a.value AS attrValue
       FROM attributes a JOIN blocks b ON a.block_id = b.id
       WHERE b.root_id IN (SELECT id FROM blocks WHERE box='${escapeSql(notebook)}' AND type='d')
         AND a.name LIKE 'custom-exam-%'`,
    );
    const byBlock = new Map<string, { attrs: Record<string, string>; content: string; rootId: string; hpath: string }>();
    for (const row of rows) {
      const e =
        byBlock.get(row.blockId) ??
        { attrs: {}, content: row.content ?? "", rootId: row.rootId ?? "", hpath: row.hpath ?? "" };
      e.attrs[row.attrName] = row.attrValue ?? "";
      byBlock.set(row.blockId, e);
    }
    const out: (Question & { blockId: string; rootId: string; hpath: string })[] = [];
    for (const [blockId, e] of byBlock) {
      const q = questionFromBlock({ attrs: e.attrs, text: e.content });
      if (q) out.push({ ...q, blockId, rootId: e.rootId, hpath: e.hpath });
    }
    return out;
  }

  /** 章节树数据源（TODO 2.2）：notebook → 文档 → 标题层级；块 hpath 含标题祖先路径，供按章节过滤题目 */
  async docTree(notebook: string): Promise<{
    docs: { id: string; title: string; hpath: string }[];
    headings: { id: string; text: string; hpath: string; level: number }[];
  }> {
    const box = escapeSql(notebook);
    const docRows = await this.sql<Record<string, string>>(
      `SELECT id, content, hpath FROM blocks WHERE box='${box}' AND type='d' ORDER BY hpath`,
    );
    const hRows = await this.sql<Record<string, string>>(
      `SELECT id, content, hpath, subtype FROM blocks WHERE box='${box}' AND type='h' ORDER BY hpath`,
    );
    return {
      docs: docRows.map((r) => ({ id: String(r.id ?? ""), title: String(r.content ?? ""), hpath: String(r.hpath ?? "") })),
      headings: hRows.map((r) => ({
        id: String(r.id ?? ""),
        text: String(r.content ?? ""),
        hpath: String(r.hpath ?? ""),
        level: parseInt(String(r.subtype ?? "h1").replace("h", ""), 10) || 1,
      })),
    };
  }

  /** 反链聚合：引用了某题块的笔记（refs 表 2026-10-02 实测：block_id=容器块, def_block_id=被引块, root_id=文档） */
  async backlinks(blockId: string): Promise<{ docId: string; title: string; content: string }[]> {
    const rows = await this.sql<Record<string, string>>(
      `SELECT r.root_id AS docId, d.content AS title, r.content AS content
       FROM refs r
       JOIN blocks d ON r.root_id = d.id
       WHERE r.def_block_id = '${escapeSql(blockId)}'
       LIMIT 20`,
    );
    return rows.map((r) => ({ docId: r.docId ?? "", title: r.title ?? "", content: (r.content ?? "").slice(0, 120) }));
  }

  async getBlockAttrs(blockId: string): Promise<Record<string, string>> {
    const r = await this.t.post("/api/attr/getBlockAttrs", { id: blockId });
    return (r.data as Record<string, string>) ?? {};
  }

  /** 块 kramdown 原文（query_embed 的 SQL 只存于此；3.8.5 实测 content 为空） */
  async getBlockKramdown(blockId: string): Promise<string> {
    const r = await this.t.post("/api/block/getBlockKramdown", { id: blockId });
    return String((r.data as { kramdown?: string } | null)?.kramdown ?? "");
  }

  /** 收藏切换（custom-exam-fav 属性；attributes 表只索引 custom- 前缀，3.8.5 实测） */
  async setExamFav(blockId: string, on: boolean): Promise<void> {
    await this.t.post("/api/attr/setBlockAttrs", { id: blockId, attrs: { "custom-exam-fav": on ? "1" : "" } });
  }

  /** 批量编辑写属性（43-06）：exam-* 裸名 → custom-exam-* 全名；空值写 ""（内核语义=清除） */
  async setExamAttrs(blockId: string, attrs: Record<string, string>): Promise<void> {
    const full: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) full[`custom-${k.startsWith("exam-") ? k : `exam-${k}`}`] = v;
    await this.t.post("/api/attr/setBlockAttrs", { id: blockId, attrs: full });
  }

  /** 删除单个块（12 组批次回滚用；真实宿主行为待 preflight/冒烟复核） */
  async removeBlock(blockId: string): Promise<void> {
    await this.t.post("/api/block/deleteBlock", { id: blockId });
  }

  /** 整块替换（题目编辑 43-01 lite）：超级块 markdown 全量重写，exam-id IAL 不变即身份不变；
   *  写后读回核验由调用方（app.updateQuestionContent）负责 */
  async updateBlock(blockId: string, markdown: string): Promise<void> {
    await this.t.post("/api/block/updateBlock", { dataType: "markdown", data: markdown, id: blockId });
  }

  async getDueCards(deckId: string): Promise<unknown[]> {
    // 3.8.5 实测：data 为 { cards: [...], unreviewedCount } 包裹对象
    const r = await this.t.post("/api/riff/getRiffDueCards", { deckID: deckId, reviewedCards: [] });
    const cards = (r.data as { cards?: unknown[] } | null)?.cards;
    return Array.isArray(cards) ? cards : [];
  }

  async createRiffDeck(name: string): Promise<string> {
    // 3.8.5 实测：data 为 { id, name, size, ... } 对象（旧版为裸 id 字符串，双形态兼容）
    const r = await this.t.post("/api/riff/createRiffDeck", { name });
    const d = r.data as unknown;
    return typeof d === "string" ? d : String((d as { id?: string } | null)?.id ?? "");
  }

  async addRiffCards(deckId: string, blockIds: string[]): Promise<void> {
    if (!blockIds.length) return;
    await this.t.post("/api/riff/addRiffCards", { deckID: deckId, blockIDs: blockIds });
  }

  async getRiffDecks(): Promise<{ id: string; name: string }[]> {
    const r = await this.t.post("/api/riff/getRiffDecks", {});
    const arr = Array.isArray(r.data) ? (r.data as { id: string; name: string }[]) : [];
    return arr.map((d) => ({ id: d.id, name: d.name }));
  }

  /** 块 → 卡 ID 映射（转卡后的评级入口）
   *  3.8.5 实测：getRiffCardsByBlockIDs 返回 data.blocks[]（riffCardID 字段，索引可能滞后为空）；
   *  回退源 getRiffDueCards(deckID) → data.cards[]（{cardID, blockID}，新卡必在） */
  async getCardIDsByBlockIDs(blockIds: string[], deckId?: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!blockIds.length) return map;
    const want = new Set(blockIds);
    try {
      const r = await this.t.post("/api/riff/getRiffCardsByBlockIDs", { blockIDs: blockIds });
      const blocks = (r.data as { blocks?: { id?: string; riffCardID?: string }[] } | null)?.blocks ?? [];
      for (const b of blocks) {
        if (b.id && b.riffCardID && want.has(b.id)) map.set(b.id, b.riffCardID);
      }
    } catch {
      /* 回退 due 卡 */
    }
    if (map.size < blockIds.length && deckId) {
      const r = await this.t.post("/api/riff/getRiffDueCards", { deckID: deckId, reviewedCards: [] });
      for (const c of (r.data as { cards?: { cardID?: string; blockID?: string }[] } | null)?.cards ?? []) {
        if (c.cardID && c.blockID && want.has(c.blockID) && !map.has(c.blockID)) map.set(c.blockID, c.cardID);
      }
    }
    return map;
  }

  async reviewRiffCard(cardId: string, deckId: string, rating: 0 | 1 | 2 | 3): Promise<void> {
    await this.t.post("/api/riff/reviewRiffCard", { cardID: cardId, deckID: deckId, rating, reviewedCards: [] });
  }
}

const escapeSql = (s: string) => s.replace(/'/g, "''");
