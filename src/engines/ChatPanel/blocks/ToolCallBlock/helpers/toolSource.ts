/**
 * toolSource — derive a jump-to-source target (file path + optional line)
 * from a tool call's arguments.
 *
 * Used by ToolResultActions to render an "open source" button only when the
 * tool actually references a concrete file on disk.
 */

/** A resolved jump-to-source target for a tool call. */
export interface ToolSourceTarget {
  path: string;
  /** 1-based line, when the tool args carry one. */
  line?: number;
}

const FILE_PATH_KEYS = [
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
  "path",
  "absolute_path",
  "absolutePath",
] as const;

const LINE_KEYS = [
  "line",
  "line_number",
  "lineNumber",
  "start_line",
  "startLine",
] as const;

function pickString(
  args: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function pickLine(args: Record<string, unknown>): number | undefined {
  for (const key of LINE_KEYS) {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return undefined;
}

/**
 * Extract the source file (and optional line) a tool call points at.
 * Returns `null` when the tool has no file-path argument — search/shell/
 * web tools and the like never produce a jump target.
 */
export function extractToolSource(
  args: Record<string, unknown> | undefined
): ToolSourceTarget | null {
  if (!args) return null;
  const path = pickString(args, FILE_PATH_KEYS);
  if (!path) return null;
  return { path, line: pickLine(args) };
}
