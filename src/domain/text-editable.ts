/**
 * src/domain/text-editable.ts — テキスト編集 API の対象判定（要件 8.3 / 9.2）
 */

/** 表示名の拡張子がソース・マークアップ系として編集対象となり得るか（UTF-8 本文保存 API 用） */
export function displayNameLooksTextEditable(displayName: string): boolean {
  const lower = displayName.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = lower.slice(dot);
  const textLike = new Set([
    ".txt",
    ".md",
    ".csv",
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".mjs",
    ".cjs",
    ".jsx",
    ".json",
    ".py",
    ".html",
    ".htm",
    ".css",
    ".xml",
    ".yaml",
    ".yml",
    ".sh",
    ".bash",
    ".env",
    ".gitignore",
    ".sql",
    ".vue",
    ".svelte",
  ]);
  return textLike.has(ext);
}

export function fileAllowsUtf8TextBody(opts: {
  displayName: string;
  contentType: string | null;
}): boolean {
  const ct = opts.contentType?.toLowerCase().trim() ?? "";
  if (ct.startsWith("text/")) return true;
  return displayNameLooksTextEditable(opts.displayName);
}
