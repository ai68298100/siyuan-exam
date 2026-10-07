/** 73-03 读取侧密钥适配：宿主密钥优先，旧设置仅作兼容回退。 */
export const AI_SECRET_NAME = "lv-exam-ai-key";

export type AiKeyHost = {
  getSecret?: (name: string) => unknown;
  settingUtils?: { get?: (key: string) => unknown };
};

export function resolveAiKey(host: AiKeyHost | null | undefined): string {
  let secret: string;
  try {
    secret = String(host?.getSecret?.(AI_SECRET_NAME) ?? "").trim();
  } catch {
    secret = "";
  }
  if (secret) return secret;
  try {
    return String(host?.settingUtils?.get?.("aiKey") ?? "").trim();
  } catch {
    return "";
  }
}
