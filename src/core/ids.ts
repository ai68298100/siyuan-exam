// 稳定 ID 生成（renderer 与 node 共用；无 crypto 依赖要求）
const ALPHABET = "0123456789abcdef";
let counter = 0;

function rand(n: number): string {
  const g = globalThis.crypto;
  if (!g?.getRandomValues) {
    throw new Error("[lv-exam] WebCrypto 不可用：无法生成安全随机 ID");
  }
  const buf = new Uint8Array(n);
  g.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < n; i++) out += ALPHABET[buf[i] % 16];
  return out;
}

/** 题目稳定 ID：q-xxxxxxxx（导入时生成，块移动/重命名不变） */
export const newQuestionId = () => `q-${rand(8)}`;

/** 会话 ID：s-时间戳-序号 */
export const newSessionId = () => `s-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** 事件 ID：e-时间戳-随机（幂等回放键；同一事件重放不重复计数） */
export const newEventId = () => `e-${Date.now().toString(36)}-${rand(8)}`;

/** 设备 ID：生成一次持久化（d-xxxxxx） */
export const newDeviceId = () => `d-${rand(6)}`;

/** 导入批次 ID：b-yyyyMMdd-xxxx */
export const newBatchId = () => {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `b-${ymd}-${rand(4)}`;
};
