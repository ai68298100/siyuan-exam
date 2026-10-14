/**
 * Turn block kramdown into bounded AI material. The source remains Markdown so
 * lists and inline structure survive, while host-only block wrappers/IAL are
 * removed from the text shown to the user.
 */
export const DEFAULT_BLOCK_SOURCE_LIMIT = 24_000;

function cleanBlockMarkdown(source: string): string {
  return String(source ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^\{\{\{(?:row|col)\s*$/gm, "")
    .replace(/^\}\}\}\s*$/gm, "")
    .replace(/^\{:\s*[^\n]*\}\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface BlockSourceResult {
  text: string;
  blocks: number;
  truncated: boolean;
}

export function combineBlockSources(sources: string[], maxChars = DEFAULT_BLOCK_SOURCE_LIMIT): BlockSourceResult {
  const limit = Math.max(1, Math.floor(maxChars));
  const parts = sources.map(cleanBlockMarkdown).filter(Boolean);
  const combined = parts.join("\n\n").trim();
  if (!combined) return { text: "", blocks: 0, truncated: false };
  if (combined.length <= limit) return { text: combined, blocks: parts.length, truncated: false };
  return { text: combined.slice(0, limit).trimEnd(), blocks: parts.length, truncated: true };
}
