// ============================================================
// 可复现随机（TODO 65-05 lite）：种子 → 确定性 PRNG → 洗牌/抽样。
// 会话启动时生成 seed 并随 checkpoint 持久化；同 seed + 同候选池 = 同卷序
// （65-05 验收的 lite 面：候选池版本变化/缺题如实反映在队列差异里，
// 本层不承诺两卷等难；复现标识随结算页展示）。
// ============================================================

/** 生成可读的随机种子（会话级；base36 时间戳 + 随机尾） */
export function randomSeedId(): string {
  return `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** FNV-1a：种子字符串 → u32（PRNG 初值） */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32：紧凑确定性 PRNG（返回 [0,1)） */
export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 种子洗牌：Fisher-Yates，同 seed 同数组同结果（不修改原数组） */
export function seededShuffle<T>(arr: readonly T[], seed: string): T[] {
  const out = [...arr];
  const rnd = mulberry32(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 种子抽样：洗牌后取前 n（n 超过池长即全量洗牌序） */
export function seededPickN<T>(arr: readonly T[], n: number, seed: string): T[] {
  return seededShuffle(arr, seed).slice(0, Math.max(0, n));
}
