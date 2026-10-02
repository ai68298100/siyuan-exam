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
}

export type ErrKind = "retryable" | "fatal";
export class KernelError extends Error {
  constructor(readonly kind: ErrKind, readonly endpoint: string, msg: string, readonly cause?: unknown) {
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
  (url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
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
      try {
        const res = await this.fetchImpl(this.baseUrl + endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Token ${this.token}`,
          },
          body: JSON.stringify(payload ?? {}),
        });
        clearTimeout(timer);
        const text = await res.text();
        if (!res.ok) throw new KernelError("fatal", endpoint, `HTTP ${res.status}`);
        let body: { code: number; msg: string; data: unknown };
        try { body = JSON.parse(text); } catch { throw new KernelError("fatal", endpoint, "非 JSON 响应"); }
        if (body.code !== 0) throw new KernelError("fatal", endpoint, body.msg || `code ${body.code}`);
        return body;
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        const kind = e instanceof KernelError ? e.kind : classify(e);
        if (kind === "fatal" || attempt === this.retries) {
          throw e instanceof KernelError ? e : new KernelError(kind, endpoint, e instanceof Error ? e.message : String(e), e);
        }
        await sleep(300 * (attempt + 1));
      }
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
    } catch { return r; }
    try { await this.renderMarkdown("x"); r.md2html = true; } catch { /* md2html 不可用 */ }
    try { await this.t.post("/api/query/sql", { stmt: "SELECT 1" }); r.query = true; } catch { /* SQL 不可用 */ }
    try { await this.t.post("/api/riff/getRiffDecks", {}); r.riff = true; } catch { /* riff 不可用 */ }
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

  /** 从本机绝对路径导入 .sy.zip（Electron 前端；browser 前端不可用） */
  async importSy(zipAbsPath: string): Promise<void> {
    await this.t.post("/api/import/importSY", { path: zipAbsPath });
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
    return String((r.data as Record<string, unknown>)?.notebook ?? "");
  }

  async createDocWithMd(notebook: string, hpath: string, markdown: string): Promise<string> {
    const r = await this.t.post("/api/filetree/createDocWithMd", { notebook, path: hpath, markdown });
    return String(r.data ?? "");
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
        dataType: "markdown", data: md, parentID: parentId,
      });
      const opsArr = Array.isArray(r.data) ? (r.data as { doOperations?: { id?: string }[] }[]) : [];
      const ops = opsArr[0]?.doOperations ?? [];
      ops.forEach((op, j) => {
        if (slice[j]) out.push({ qid: slice[j].id, blockId: String(op.id ?? "") });
      });
    }
    return out;
  }

  /** 题库内检索：custom-exam-* 属性驱动（2026-10-02 实测前缀约定）；带 root_id 供文档跳转 */
  async listQuestions(notebook: string): Promise<(Question & { blockId: string; rootId: string })[]> {
    const rows = await this.sql<Record<string, string>>(
      `SELECT b.id AS blockId, b.root_id AS rootId, b.content AS content,
              a.name AS attrName, a.value AS attrValue
       FROM attributes a JOIN blocks b ON a.block_id = b.id
       WHERE b.root_id IN (SELECT id FROM blocks WHERE box='${escapeSql(notebook)}' AND type='d')
         AND a.name LIKE 'custom-exam-%'`,
    );
    const byBlock = new Map<string, { attrs: Record<string, string>; content: string; rootId: string }>();
    for (const row of rows) {
      const e = byBlock.get(row.blockId) ?? { attrs: {}, content: row.content ?? "", rootId: row.rootId ?? "" };
      e.attrs[row.attrName] = row.attrValue ?? "";
      byBlock.set(row.blockId, e);
    }
    const out: (Question & { blockId: string; rootId: string })[] = [];
    for (const [blockId, e] of byBlock) {
      const q = questionFromBlock({ attrs: e.attrs, text: e.content });
      if (q) out.push({ ...q, blockId, rootId: e.rootId });
    }
    return out;
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
    } catch { /* 回退 due 卡 */ }
    if (map.size < blockIds.length && deckId) {
      const r = await this.t.post("/api/riff/getRiffDueCards", { deckID: deckId, reviewedCards: [] });
      for (const c of ((r.data as { cards?: { cardID?: string; blockID?: string }[] } | null)?.cards ?? [])) {
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
