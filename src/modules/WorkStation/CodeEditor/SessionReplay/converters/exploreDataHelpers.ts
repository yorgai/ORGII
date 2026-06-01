/**
 * exploreDataHelpers
 *
 * Primitive utilities and text-parsing helpers for the explore converter.
 * No dependencies on SessionEvent or domain types — all pure functions.
 */
import type { SearchResult } from "../types";

// ============================================
// Primitive Helpers
// ============================================

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseJsonLike(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "[" && trimmed[0] !== "{")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

export function firstString(
  record: Record<string, unknown>,
  keys: string[]
): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

export function firstNumber(
  record: Record<string, unknown>,
  keys: string[]
): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

export function extractStringArrayFromSource(source: unknown): string[] {
  if (
    Array.isArray(source) &&
    source.length > 0 &&
    typeof source[0] === "string"
  ) {
    return (source as string[]).filter((file) => typeof file === "string");
  }
  return [];
}

// ============================================
// Text Block Extraction
// ============================================

export function extractTextBlocks(source: unknown): string[] {
  const parsed = parseJsonLike(source);
  if (typeof parsed === "string") return parsed.trim() ? [parsed] : [];
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => extractTextBlocks(item));
  }
  const record = asRecord(parsed);
  if (!record) return [];

  const directText = firstString(record, [
    "text",
    "content",
    "observation",
    "message",
    "output",
    "result",
  ]);
  const nestedText = [
    record.content,
    record.observation,
    record.message,
    record.output,
    record.result,
  ].flatMap((value) =>
    typeof value === "string" ? [] : extractTextBlocks(value)
  );
  return directText ? [directText, ...nestedText] : nestedText;
}

export function extractFilesFromSource(source: unknown): string[] {
  const parsed = parseJsonLike(source);
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => {
      if (typeof item === "string") return item.trim() ? [item.trim()] : [];
      const record = asRecord(item);
      if (!record) return [];
      const path = firstString(record, [
        "relPath",
        "name",
        "file",
        "file_path",
        "path",
        "uri",
      ]);
      return path ? [path] : extractFilesFromSource(record.files);
    });
  }
  if (typeof parsed === "string") return parseTextSearchResults(parsed).files;
  const record = asRecord(parsed);
  if (!record) return [];
  return [
    record.files,
    record.directories,
    record.matches,
    record.topFiles,
    record.content,
    record.items,
  ].flatMap((value) => extractFilesFromSource(value));
}

export function extractTextFromResult(result: Record<string, unknown>): string {
  const output = asRecord(result.output);
  const success = output ? asRecord(output.success) : null;
  const message = asRecord(result.message);
  return [
    success?.content,
    output?.content,
    result.content,
    result.observation,
    result.message,
    message?.content,
    typeof result.output === "string" ? result.output : undefined,
  ]
    .flatMap((value) => extractTextBlocks(value))
    .join("\n");
}

// ============================================
// Structured Search Row Extraction
// ============================================

export function extractSearchRowsFromSource(source: unknown): SearchResult[] {
  const parsed = parseJsonLike(source);
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => extractSearchRowsFromSource(item));
  }

  const record = asRecord(parsed);
  if (!record) {
    return typeof parsed === "string"
      ? parseTextSearchResults(parsed).results
      : [];
  }

  const file = firstString(record, [
    "file",
    "name",
    "file_path",
    "path",
    "uri",
  ]);
  if (file) {
    const matchCount = firstNumber(record, [
      "matchCount",
      "match_count",
      "matches",
    ]);
    return [
      {
        file,
        line: firstNumber(record, ["line", "lineNumber", "line_number"]),
        content:
          firstString(record, [
            "content",
            "match",
            "text",
            "preview",
            "lineText",
            "line_text",
          ]) ||
          (matchCount > 0 ? `${matchCount} matches` : "") ||
          extractTextBlocks(record).join("\n"),
      },
    ];
  }

  return [
    record.results,
    record.matches,
    record.topFiles,
    record.content,
    record.items,
  ].flatMap((value) => extractSearchRowsFromSource(value));
}

// ============================================
// Text Search Result Parsing
// ============================================

function isSearchOutputPath(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^no (matches|files|results) found\.?$/i.test(trimmed)) return false;
  if (/^(grep|glob|find_files|code_search)$/i.test(trimmed)) return false;
  if (trimmed.includes("/")) return true;
  if (trimmed.startsWith(".")) return true;
  if (/^[^\s]+\.[A-Za-z0-9][^\s]*$/.test(trimmed)) return true;
  return /^\w:[\\/]/.test(trimmed);
}

export function parseTextSearchResults(textContent: string): {
  results: SearchResult[];
  files: string[];
} {
  const lines = textContent.split("\n").filter((line) => line.trim());
  const results: SearchResult[] = [];
  const files: string[] = [];
  for (const line of lines) {
    const grepMatch = line.match(/^(.+?):(\d+):(.*)$/);
    if (grepMatch) {
      results.push({
        file: grepMatch[1],
        line: parseInt(grepMatch[2], 10),
        content: grepMatch[3],
      });
    } else if (isSearchOutputPath(line)) {
      files.push(line.trim());
    }
  }
  return { results, files };
}
