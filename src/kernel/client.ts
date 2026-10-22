// ============================================================
// KernelApiClient：内核 HTTP 统一收口（docs/03 决策 #1、26.1）
// - 传输层可替换（renderer=petal fetchSync；测试=mock transport）
// - 统一超时 / 有限重试 / 错误二分类（retryable | fatal）
// - 启动能力探测（md2html / query / riff / 属性），失败降级为明确能力位
// ============================================================
import type { Question } from "../core/types";
import { questionToMarkdown, questionFromBlock } from "../core/blockTemplate";

export interface KernelTransport {
  post(endpoint: string, payload: unknown, options?: RequestOptions): Promise<{ code: number; msg: string; data: unknown }>;
  /** multipart 文件上传（importSY 等；38-05 实测：JSON path 形态返回 -1）。可选：测试桩可不实现 */
  postForm?(endpoint: string, file: Blob, filename: string, options?: RequestOptions): Promise<{ code: number; msg: string; data: unknown }>;
}

/** 请求策略由服务层统一传递给传输层。
 * retryable=false 用于写请求：网络错误不能安全判断服务端是否已落库，自动重试可能造成重复数据。
 */
export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  retryable?: boolean;
}

/** Per-call controls for reads. requestKey groups changing reads for the same view;
 * a newer payload under that key aborts and invalidates the older response. */
export interface KernelReadOptions {
  requestKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
}

export type ErrKind = "retryable" | "fatal";
export type KernelErrorCategory = "network" | "cancelled" | "auth" | "permission" | "validation" | "not-found" | "server" | "unknown";

function categoryForCode(code: number | undefined, kind: ErrKind, message = ""): KernelErrorCategory {
  if (kind === "retryable") return /abort|cancel/i.test(message) ? "cancelled" : "network";
  if (code === -401 || code === 401) return "auth";
  if (code === -403 || code === 403) return "permission";
  if (code === -404 || code === 404) return "not-found";
  if (code === 400 || code === 422) return "validation";
  if (typeof code === "number" && code >= 500) return "server";
  return "unknown";
}

export class KernelError extends Error {
  constructor(
    readonly kind: ErrKind,
    readonly endpoint: string,
    msg: string,
    readonly cause?: unknown,
    readonly code?: number,
    readonly category: KernelErrorCategory = categoryForCode(code, kind, msg),
  ) {
    super(`[${endpoint}] ${msg} (${kind})`);
  }
}

const RETRIABLE_HOST = /ECONN|ETIMEDOUT|timeout|abort|network|fetch failed|failed to fetch|connection reset|socket/i;

function classify(e: unknown): ErrKind {
  const msg = e instanceof Error ? e.message : String(e);
  return RETRIABLE_HOST.test(msg) ? "retryable" : "fatal";
}

/** 718：退避上限（防止内核给出异常大的 Retry-After 导致长时间挂起） */
export const RETRY_AFTER_MAX_MS = 60_000;

/**
 * 718：解析 HTTP `Retry-After` 头。内核限流时应优先遵循服务端给出的等待时间，
 * 而不是固定猜测。支持两种合法形式：秒数（`Retry-After: 30`）与 HTTP-date。
 * 非法值返回 null，由调用方回退到本地退避。
 */
export function parseRetryAfterMs(headerValue: string | null | undefined, now: () => number = Date.now): number | null {
  if (headerValue == null) return null;
  const raw = String(headerValue).trim();
  if (!raw) return null;
  // 秒数形式（整数或小数；负值非法，直接拒绝）
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.min(seconds * 1000, RETRY_AFTER_MAX_MS);
  }
  // HTTP-date 形式（RFC 7231）：解析为绝对时刻，与当前时间差即等待时长
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  const delta = at - now();
  if (delta <= 0) return 0; // 已过期：立即重试，不再等待
  return Math.min(delta, RETRY_AFTER_MAX_MS);
}

/**
 * 718：计算第 `attempt` 次失败后的重试等待时长（毫秒）。
 * 优先级：服务端 `Retry-After` > 本地线性退避（429 起步 1s，其余 300ms）。
 * `headerMs` 为 0（服务端明示可立即重试）时按 0 处理，不叠加本地退避。
 */
export function computeRetryDelayMs(
  attempt: number,
  opts: { status?: number; headerMs?: number | null } = {},
): number {
  if (opts.headerMs != null) return Math.max(0, opts.headerMs);
  const base = opts.status === 429 ? 1000 : 300;
  return base * (attempt + 1);
}


const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
  const timer = setTimeout(done, ms);
  function done() {
    signal?.removeEventListener("abort", abort);
    resolve();
  }
  function abort() {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    reject(new DOMException("Aborted", "AbortError"));
  }
  signal?.addEventListener("abort", abort, { once: true });
});

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
  ): Promise<{ ok: boolean; status: number; text(): Promise<string>; headers?: { get(name: string): string | null } }>;
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

  async post(endpoint: string, payload: unknown, options: RequestOptions = {}) {
    let lastErr: unknown;
    const retries = options.retryable === false ? 0 : Math.min(3, Math.max(0, options.retries ?? this.retries));
    const timeoutMs = Math.max(1, options.timeoutMs ?? this.timeoutMs);
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (options.signal?.aborted) throw new KernelError("retryable", endpoint, "请求已取消", options.signal.reason);
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let retryDelay: number | undefined;
      let failureStatus: number | undefined;
      let failureHeaderMs: number | null | undefined;
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
          // 429 限流（3.8.6 真机发现）：归 retryable 走退避重试；优先遵循服务端 Retry-After
          if (res.status === 429) {
            failureStatus = res.status;
            failureHeaderMs = parseRetryAfterMs(res.headers?.get("Retry-After"));
            throw new KernelError("retryable", endpoint, "HTTP 429 限流，稍后重试", undefined, res.status);
          }
          throw new KernelError("fatal", endpoint, `HTTP ${res.status}`, undefined, res.status);
        }
        let body: { code: number; msg: string; data: unknown };
        try {
          body = JSON.parse(text);
        } catch {
          throw new KernelError("fatal", endpoint, "非 JSON 响应");
        }
        if (body.code !== 0) throw new KernelError("fatal", endpoint, body.msg || `code ${body.code}`, undefined, body.code);
        return body;
      } catch (e) {
        lastErr = e;
        const kind = e instanceof KernelError ? e.kind : classify(e);
        if (e instanceof KernelError && kind === "fatal") {
          // The transport is reachable even when this endpoint rejects the
          // operation (auth, permission, validation or missing resource).
          // Keep the failure category intact without reporting the whole
          // kernel as offline to UI consumers.
        }
        // 外层请求被取消时，禁止重试；这也是 latest-wins 丢弃旧请求的终止路径。
        if (options.signal?.aborted || kind === "fatal" || attempt === retries) {
          throw e instanceof KernelError
            ? e
            : new KernelError(kind, endpoint, e instanceof Error ? e.message : String(e), e);
        }
        retryDelay = computeRetryDelayMs(attempt, { status: failureStatus, headerMs: failureHeaderMs });
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      }
      if (retryDelay !== undefined) await sleep(retryDelay, options.signal);
    }
    throw lastErr;
  }

  /** multipart 文件上传（importSY 契约，38-05 真机实测：JSON path 形态返回 -1）。
   *  浏览器 FormData 自动带 boundary，不可手工设 Content-Type */
  async postForm(endpoint: string, file: Blob, filename: string, options: RequestOptions = {}) {
    const fd = new FormData();
    fd.append("file", file, filename);
    let lastErr: unknown;
    const retries = options.retryable === false ? 0 : Math.min(3, Math.max(0, options.retries ?? this.retries));
    const timeoutMs = Math.max(1, options.timeoutMs ?? this.timeoutMs);
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (options.signal?.aborted) throw new KernelError("retryable", endpoint, "请求已取消", options.signal.reason);
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let retryDelay: number | undefined;
      let failureStatus: number | undefined;
      let failureHeaderMs: number | null | undefined;
      try {
        const res = await this.fetchImpl(this.baseUrl + endpoint, {
          method: "POST",
          headers: { Authorization: `Token ${this.token}` },
          body: fd,
          signal: ctrl.signal,
        });
        const text = await res.text();
        if (!res.ok) {
          if (res.status === 429) {
            failureStatus = res.status;
            failureHeaderMs = parseRetryAfterMs(res.headers?.get("Retry-After"));
            throw new KernelError("retryable", endpoint, "HTTP 429 限流，稍后重试", undefined, res.status);
          }
          throw new KernelError("fatal", endpoint, `HTTP ${res.status}`, undefined, res.status);
        }
        let body: { code: number; msg: string; data: unknown };
        try {
          body = JSON.parse(text);
        } catch {
          throw new KernelError("fatal", endpoint, "非 JSON 响应");
        }
        if (body.code !== 0) throw new KernelError("fatal", endpoint, body.msg || `code ${body.code}`, undefined, body.code);
        return body;
      } catch (e) {
        lastErr = e;
        const kind = e instanceof KernelError ? e.kind : classify(e);
        if (options.signal?.aborted || kind === "fatal" || attempt === retries) {
          throw e instanceof KernelError
            ? e
            : new KernelError(kind, endpoint, e instanceof Error ? e.message : String(e), e);
        }
        retryDelay = computeRetryDelayMs(attempt, { status: failureStatus, headerMs: failureHeaderMs });
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      }
      if (retryDelay !== undefined) await sleep(retryDelay, options.signal);
    }
    throw lastErr;
  }
}

export class KernelApiClient {
  private readonly pendingReads = new Map<string, { signature: string; controller: AbortController; promise: Promise<{ code: number; msg: string; data: unknown }> }>();

  constructor(private readonly t: KernelTransport) {}

  /** All reads go through one request policy: identical in-flight reads coalesce,
   * and callers can assign a resource key so newer parameters supersede older work. */
  private readPost(endpoint: string, payload: unknown, options: KernelReadOptions = {}) {
    const signature = `${endpoint}:${stableJson(payload)}`;
    const key = options.requestKey ?? signature;
    const current = this.pendingReads.get(key);
    if (current?.signature === signature && !options.signal) return current.promise;
    current?.controller.abort("superseded by a newer read");

    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });

    const pending = {} as { signature: string; controller: AbortController; promise: Promise<{ code: number; msg: string; data: unknown }> };
    pending.signature = signature;
    pending.controller = controller;
    pending.promise = (async () => {
      try {
        const result = await this.t.post(endpoint, payload, {
          signal: controller.signal,
          timeoutMs: options.timeoutMs,
          retries: options.retries,
          retryable: true,
        });
        // Custom transports used in the host and tests may ignore AbortSignal. Do
        // not let their late response escape after this request was superseded.
        if (controller.signal.aborted) {
          throw new KernelError("retryable", endpoint, "请求已取消", controller.signal.reason);
        }
        return result;
      } finally {
        options.signal?.removeEventListener("abort", abort);
        if (this.pendingReads.get(key) === pending) this.pendingReads.delete(key);
      }
    })();
    this.pendingReads.set(key, pending);
    return pending.promise;
  }

  /** All mutations disable transport retries: a lost response cannot tell us
   * whether Siyuan already committed the write. Retrying could duplicate it. */
  private writePost(endpoint: string, payload: unknown) {
    return this.t.post(endpoint, payload, { retries: 0, retryable: false });
  }

  /** 启动探测：任何一项失败只置位 false，不抛出（离线降级的依据） */
  async probe(): Promise<ProbeResult> {
    const r: ProbeResult = { kernelOk: false, version: "", md2html: false, query: false, riff: false };
    try {
      const v = await this.readPost("/api/system/version", {});
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
      await this.readPost("/api/query/sql", { stmt: "SELECT 1" });
      r.query = true;
    } catch {
      /* SQL 不可用 */
    }
    try {
      await this.readPost("/api/riff/getRiffDecks", {});
      r.riff = true;
    } catch {
      /* riff 不可用 */
    }
    return r;
  }

  /** 思源内置 AI（/api/ai/chatGPT 单轮 msg 语义；端点 2026-10-02 实测存在） */
  async aiChat(msg: string): Promise<unknown> {
    const r = await this.writePost("/api/ai/chatGPT", { msg });
    return r.data;
  }

  async getNotebookConf(notebookId: string): Promise<{ name: string; dailyNoteSavePath: string }> {
    const r = await this.readPost("/api/notebook/getNotebookConf", { notebook: notebookId }, { requestKey: `notebook-conf:${notebookId}` });
    const d = (r.data as Record<string, unknown>) ?? {};
    const conf = (d.conf as Record<string, string>) ?? {};
    return { name: String(d.name ?? ""), dailyNoteSavePath: String(conf.dailyNoteSavePath ?? "") };
  }

  /** 笔记本导出 .sy.zip（题库包分享；返回工作区相对路径，如 /export/X.sy.zip） */
  async exportNotebookSy(notebookId: string): Promise<{ zipPath: string }> {
    const r = await this.writePost("/api/export/exportNotebookSY", { id: notebookId });
    const zip = String((r.data as Record<string, unknown>)?.zip ?? "");
    if (!zip) throw new KernelError("fatal", "exportNotebookSY", "响应缺少 zip 路径");
    return { zipPath: zip };
  }

  /** 原生包导入（38-05 真机契约）：importSY 要求 multipart/form-data 文件上传，
   *  JSON {path} 绝对路径形态返回 -1（2026-10-04 实测）——旧实现已废弃。
   *  导入的笔记本按包内名称落库（同名自动避让），需调用方随后 lsNotebooks 登记 */
  async importSyUpload(file: Blob, filename = "bank.sy.zip"): Promise<void> {
    if (!this.t.postForm) throw new KernelError("fatal", "/api/import/importSY", "传输层不支持 multipart 上传");
    await this.t.postForm("/api/import/importSY", file, filename, { retries: 0, retryable: false });
  }

  /** 笔记本清单（38-06 lite：导入后发现/登记新库；closed 笔记本不返回） */
  async listNotebooks(): Promise<{ id: string; name: string }[]> {
    const r = await this.readPost("/api/notebook/lsNotebooks", {}, { requestKey: "notebook-list" });
    const notebooks = (r.data as { notebooks?: { id: string; name: string; closed?: boolean }[] } | null)?.notebooks ?? [];
    return notebooks.filter((n) => !n.closed).map((n) => ({ id: n.id, name: n.name }));
  }

  /** 文档导出 Markdown（AI 出题"当前文档"输入源；2026-10-02 实测返回 hPath+content，content 带 YAML 头需剥离） */
  async exportDocMarkdown(docId: string): Promise<{ title: string; content: string }> {
    const r = await this.readPost("/api/export/exportMdContent", { id: docId }, { requestKey: `doc-markdown:${docId}` });
    const d = (r.data ?? {}) as { hPath?: string; content?: string };
    const raw = String(d.content ?? "");
    const content = raw.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
    return { title: (d.hPath ?? "").split("/").pop() ?? "", content };
  }

  async renderMarkdown(markdown: string): Promise<string> {
    const r = await this.readPost("/api/lute/md2html", { markdown, mode: "" });
    return String((r.data as Record<string, unknown>)?.html ?? "");
  }

  async sql<T = Record<string, unknown>>(stmt: string, options: KernelReadOptions = {}): Promise<T[]> {
    const r = await this.readPost("/api/query/sql", { stmt }, options);
    return (r.data as T[]) ?? [];
  }

  /**
   * 分页取全量（3.8.6 靶场实测：无 LIMIT 的查询默认只返回 64 行且 truncated:true，
   * 请求级 limit 字段无效；SQL 文本级 LIMIT 可解除）。stmt 不得自带 LIMIT/OFFSET。
   * 行数少于页大小即停；超过 maxRows 视为内核异常行为而截停，避免死循环。
   */
  async sqlPaged<T = Record<string, unknown>>(stmt: string, pageSize = 1000, options: KernelReadOptions = {}): Promise<T[]> {
    const maxRows = 1_000_000;
    const size = Math.max(1, pageSize); // 防调用方传 0/负数导致死循环
    const all: T[] = [];
    for (let offset = 0; offset < maxRows; offset += size) {
      const rows = await this.sql<T>(`${stmt} LIMIT ${size} OFFSET ${offset}`, options);
      all.push(...rows);
      if (rows.length < size) return all;
    }
    return all;
  }

  async createNotebook(name: string): Promise<string> {
    const r = await this.writePost("/api/notebook/createNotebook", { name });
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
    const r = await this.writePost("/api/filetree/createDocWithMd", { notebook, path: hpath, markdown });
    return String(r.data ?? "");
  }

  /** 写入工作区文件（120-02 资料登记：/api/file/putFile，file=base64；目录不存在自动创建） */
  async putFile(path: string, base64: string): Promise<void> {
    await this.writePost("/api/file/putFile", { path, file: base64, isDir: false, mtime: Math.floor(Date.now() / 1000) });
  }

  /** 删除工作区文件（资料移除时的可选清理；调用方自担确认） */
  async removeFile(path: string): Promise<void> {
    await this.writePost("/api/file/removeFile", { path });
  }

  async appendBlock(parentId: string, markdown: string): Promise<string[]> {
    // 3.8.5 实测：insertBlock 必须带 dataType
    const r = await this.writePost("/api/block/insertBlock", { dataType: "markdown", data: markdown, parentID: parentId });
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
      const r = await this.writePost("/api/block/insertBlock", {
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
    // 每题 ≥6 行 custom-exam-* 属性，3.8.6 默认 64 行截断会在约 10 题处静默丢题——必须分页
    const rows = await this.sqlPaged<Record<string, string>>(
      `SELECT b.id AS blockId, b.root_id AS rootId, b.content AS content, b.markdown AS markdown, b.hpath AS hpath,
              a.name AS attrName, a.value AS attrValue
       FROM attributes a JOIN blocks b ON a.block_id = b.id
       WHERE b.root_id IN (SELECT id FROM blocks WHERE box='${escapeSql(notebook)}' AND type='d')
         AND a.name LIKE 'custom-exam-%' ORDER BY b.id, a.name`,
      1000,
      { requestKey: `questions:${notebook}` },
    );
    const byBlock = new Map<string, { attrs: Record<string, string>; content: string; markdown: string; rootId: string; hpath: string }>();
    for (const row of rows) {
      const e =
        byBlock.get(row.blockId) ??
        { attrs: {}, content: row.content ?? "", markdown: row.markdown ?? "", rootId: row.rootId ?? "", hpath: row.hpath ?? "" };
      e.attrs[row.attrName] = row.attrValue ?? "";
      byBlock.set(row.blockId, e);
    }
    const out: (Question & { blockId: string; rootId: string; hpath: string })[] = [];
    for (const [blockId, e] of byBlock) {
      // content 是搜索摘要，会把超级块的题干、列表、解析压成一行。
      // 优先使用完整 markdown；旧索引缺失时读取 kramdown，不能把摘要当题面。
      let text = e.markdown || e.content;
      let q = questionFromBlock({ attrs: e.attrs, text });
      if (!q) continue;
      if (!e.markdown && (!e.content.includes("\n") || (q && (q.type === "single" || q.type === "multiple") && !q.options.length))) {
        text = await this.getBlockKramdown(blockId);
        if (!text) throw new KernelError("fatal", "block/getBlockKramdown", "未读取到完整题目内容，请重新读取题库。");
        q = questionFromBlock({ attrs: e.attrs, text });
      }
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
    // ORDER BY 补 id 破平局：OFFSET 分页需要全序，同名标题的 hpath 可能重复
    const docRows = await this.sqlPaged<Record<string, string>>(
      `SELECT id, content, hpath FROM blocks WHERE box='${box}' AND type='d' ORDER BY hpath, id`,
      1000,
      { requestKey: `doc-tree:${notebook}` },
    );
    const hRows = await this.sqlPaged<Record<string, string>>(
      `SELECT id, content, hpath, subtype FROM blocks WHERE box='${box}' AND type='h' ORDER BY hpath, id`,
      1000,
      { requestKey: `doc-tree:${notebook}` },
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
    const r = await this.readPost("/api/attr/getBlockAttrs", { id: blockId }, { requestKey: `block-attrs:${blockId}` });
    return (r.data as Record<string, string>) ?? {};
  }

  /** 块 kramdown 原文（query_embed 的 SQL 只存于此；3.8.5 实测 content 为空） */
  async getBlockKramdown(blockId: string): Promise<string> {
    const r = await this.readPost("/api/block/getBlockKramdown", { id: blockId }, { requestKey: `block-kramdown:${blockId}` });
    return String((r.data as { kramdown?: string } | null)?.kramdown ?? "");
  }

  /** 收藏切换（custom-exam-fav 属性；attributes 表只索引 custom- 前缀，3.8.5 实测） */
  async setExamFav(blockId: string, on: boolean): Promise<void> {
    await this.writePost("/api/attr/setBlockAttrs", { id: blockId, attrs: { "custom-exam-fav": on ? "1" : "" } });
  }

  /** 批量编辑写属性（43-06）：exam-* 裸名 → custom-exam-* 全名；空值写 ""（内核语义=清除） */
  async setExamAttrs(blockId: string, attrs: Record<string, string>): Promise<void> {
    const full: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) full[`custom-${k.startsWith("exam-") ? k : `exam-${k}`}`] = v;
    await this.writePost("/api/attr/setBlockAttrs", { id: blockId, attrs: full });
  }

  /** 删除单个块（12 组批次回滚用；真实宿主行为待 preflight/冒烟复核） */
  async removeBlock(blockId: string): Promise<void> {
    await this.writePost("/api/block/deleteBlock", { id: blockId });
  }

  async deleteBlock(blockId: string): Promise<void> {
    await this.removeBlock(blockId);
  }

  /** 整块替换（题目编辑 43-01 lite）：超级块 markdown 全量重写，exam-id IAL 不变即身份不变；
   *  写后读回核验由调用方（app.updateQuestionContent）负责 */
  async updateBlock(blockId: string, markdown: string): Promise<void> {
    await this.writePost("/api/block/updateBlock", { dataType: "markdown", data: markdown, id: blockId });
  }

  async getDueCards(deckId: string): Promise<unknown[]> {
    // 3.8.5 实测：data 为 { cards: [...], unreviewedCount } 包裹对象
    const r = await this.readPost("/api/riff/getRiffDueCards", { deckID: deckId, reviewedCards: [] }, { requestKey: `riff-due:${deckId}` });
    const cards = (r.data as { cards?: unknown[] } | null)?.cards;
    return Array.isArray(cards) ? cards : [];
  }

  async createRiffDeck(name: string): Promise<string> {
    // 3.8.5 实测：data 为 { id, name, size, ... } 对象（旧版为裸 id 字符串，双形态兼容）
    const r = await this.writePost("/api/riff/createRiffDeck", { name });
    const d = r.data as unknown;
    return typeof d === "string" ? d : String((d as { id?: string } | null)?.id ?? "");
  }

  async addRiffCards(deckId: string, blockIds: string[]): Promise<void> {
    if (!blockIds.length) return;
    await this.writePost("/api/riff/addRiffCards", { deckID: deckId, blockIDs: blockIds });
  }

  async getRiffDecks(): Promise<{ id: string; name: string }[]> {
    const r = await this.readPost("/api/riff/getRiffDecks", {}, { requestKey: "riff-decks" });
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
      const r = await this.readPost("/api/riff/getRiffCardsByBlockIDs", { blockIDs: blockIds });
      const blocks = (r.data as { blocks?: { id?: string; riffCardID?: string }[] } | null)?.blocks ?? [];
      for (const b of blocks) {
        if (b.id && b.riffCardID && want.has(b.id)) map.set(b.id, b.riffCardID);
      }
    } catch {
      /* 回退 due 卡 */
    }
    if (map.size < blockIds.length && deckId) {
      const r = await this.readPost("/api/riff/getRiffDueCards", { deckID: deckId, reviewedCards: [] }, { requestKey: `riff-due:${deckId}` });
      for (const c of (r.data as { cards?: { cardID?: string; blockID?: string }[] } | null)?.cards ?? []) {
        if (c.cardID && c.blockID && want.has(c.blockID) && !map.has(c.blockID)) map.set(c.blockID, c.cardID);
      }
    }
    return map;
  }

  /** 39-01：rating 取值与 github.com/siyuan-note/riff 的 Rating 常量对齐（Again=1…Easy=4）。
   *  收窄为 1|2|3|4，使越界值在类型层即被拒绝，而不是发到内核再以不存在的键索引调度表。 */
  async reviewRiffCard(cardId: string, deckId: string, rating: 1 | 2 | 3 | 4): Promise<void> {
    await this.writePost("/api/riff/reviewRiffCard", { cardID: cardId, deckID: deckId, rating, reviewedCards: [] });
  }

  /** 思源原生图片 OCR（/api/asset/ocr） */
  async assetOcr(path: string): Promise<{ text: string; ocrJSON: Array<Record<string, string> | null> | null }> {
    const r = await this.readPost("/api/asset/ocr", { path });
    const data = (r.data as { text?: string; ocrJSON?: Array<Record<string, string> | null> }) ?? {};
    return {
      text: data.text ?? "",
      ocrJSON: data.ocrJSON ?? null,
    };
  }

  /** 获取思源已缓存的图片 OCR 文本（/api/asset/getImageOCRText） */
  async getImageOcrText(path: string): Promise<string> {
    const r = await this.readPost("/api/asset/getImageOCRText", { path });
    return String((r.data as { text?: string })?.text ?? "");
  }

  /** 更新保存图片的 OCR 文本缓存（/api/asset/setImageOCRText） */
  async setImageOcrText(path: string, text: string): Promise<void> {
    await this.writePost("/api/asset/setImageOCRText", { path, text });
  }
}

const escapeSql = (s: string) => s.replace(/'/g, "''");

let invalidReadSignature = 0;
function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    });
  } catch {
    // Request payloads are JSON data by contract. Keep request tracking from
    // crashing first so HttpTransport can report the original serialization error.
    return `unserializable:${++invalidReadSignature}`;
  }
}
