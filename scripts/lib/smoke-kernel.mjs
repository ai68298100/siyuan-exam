// ============================================================
// 冒烟/基准脚本共享件：目标解析 + 共享内核防呆 + 残留清扫
// 背景（docs/25 §2.4）：真机内核常与其他插件和真实数据共用——
// 写型冒烟（建删笔记本/写题块/触发 riff）不应直打在用工作区：
//   - 其他插件的事件监听（打卡桥/雷切等）会对冒烟写入产生真实反应
//   - 并发索引放大"属性滞后重试"的 flakiness
//   - 同步开启的工作区会被测试库的建删反复搅动同步桶
// 三层防护：
//   1) resolveTarget：SIYUAN_BASE_URL / SIYUAN_TOKEN（argv 优先），缺 token 即退出
//   2) sweepOrphans：清扫上次崩溃残留的临时笔记本（前缀注册表匹配）
//   3) guardScratch：目标内核存在非临时笔记本 → 拒跑；SIYUAN_E2E_ALLOW_SHARED=1 显式豁免
// 隔离靶场做法（推荐）：独立 workspace 起第二个思源实例（端口自动顺延），
// 只装被测插件 zip；详见 docs/24 线 A。
// ============================================================

/** 历来所有冒烟临时笔记本前缀（新脚本一律用 lv-exam-smoke-；旧前缀保留供清扫） */
export const SCRATCH_PREFIXES = [
  "lv-exam-smoke-",
  "lv-exam-preflight-",
  "小驴考试-数据冒烟-",
  "小驴考试-性能基准-",
  "冒烟-CSV往返-",
];

export function isScratchName(name) {
  return SCRATCH_PREFIXES.some((p) => name.startsWith(p));
}

/** 目标解析：argv > env > 默认端口；token 缺失即退出（P0-06：不使用默认密钥） */
export function resolveTarget({ baseArg, tokenArg } = {}) {
  const base = String(baseArg ?? process.env.SIYUAN_BASE_URL ?? "http://127.0.0.1:6806").replace(/\/+$/, "");
  const token = tokenArg ?? process.env.SIYUAN_TOKEN ?? "";
  if (!token) {
    console.error("✗ 缺少思源 token：请传入第二个参数或设置 SIYUAN_TOKEN；不会使用默认 token");
    process.exit(1);
  }
  return { base, token };
}

/** 统一 api 调用器（思源返回非 2xx 或 code!==0 时抛错，与各脚本原语义一致） */
export function makeApi(base, token) {
  return async function api(path, body) {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { Authorization: `Token ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
}

/** 思源建库 id 双形态（3.8.5 裸 id / 3.8.6 { notebook: { id } }） */
export function notebookIdOf(data) {
  return data?.notebook?.id ?? data?.notebook ?? data?.id ?? "";
}

async function listNotebooks(api) {
  const r = await api("/api/notebook/lsNotebooks", {});
  if (r.code !== 0) throw new Error(`lsNotebooks code=${r.code} ${r.msg}`);
  return r.data?.notebooks ?? [];
}

/** 清扫上次崩溃残留的临时笔记本（只动前缀注册表内的，绝不碰用户数据） */
export async function sweepOrphans(api) {
  const orphans = (await listNotebooks(api)).filter((n) => isScratchName(n.name));
  for (const n of orphans) {
    try {
      await api("/api/notebook/removeNotebook", { notebook: n.id });
      console.log(`  清扫残留临时库：${n.name}`);
    } catch (e) {
      console.log(`  ⚠ 残留清理失败（不影响本次运行）：${n.name} — ${String(e).slice(0, 60)}`);
    }
  }
}

/** 共享内核防呆：存在任何非冒烟前缀的笔记本即拒跑写型冒烟 */
export async function guardScratch(api, { base } = {}) {
  const notebooks = await listNotebooks(api);
  const foreign = notebooks.filter((n) => !isScratchName(n.name));
  if (!foreign.length) return;
  if (process.env.SIYUAN_E2E_ALLOW_SHARED === "1") {
    console.log(`  ⚠ SIYUAN_E2E_ALLOW_SHARED=1：在共享内核上直跑写型冒烟（${foreign.length} 个既有笔记本），临时库用后即清`);
    return;
  }
  console.error([
    `✗ 目标内核 ${base} 不是隔离靶场：存在 ${foreign.length} 个非冒烟笔记本（如「${foreign[0].name}」）。`,
    "  写型冒烟会建删笔记本并写入题块——与其他插件/真实数据共用的内核不宜直跑：",
    "    ① 推荐：独立 workspace 起第二个思源实例（端口自动顺延，只装被测插件），见 docs/24 线 A；",
    "    ② 或确认风险后设 SIYUAN_E2E_ALLOW_SHARED=1 显式豁免（临时库自清理，脚本崩溃可能残留）。",
  ].join("\n"));
  process.exit(1);
}
