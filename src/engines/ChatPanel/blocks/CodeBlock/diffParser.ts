/**
 * Unified diff parser for CodeBlock.
 * Extracts old/new values from unified diff text.
 */

export interface ParsedDiff {
  oldValue: string;
  newValue: string;
  oldStartLine?: number;
  newStartLine?: number;
}

const HUNK_HEADER_REGEX = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/;

export const parseUnifiedDiff = (diffText: string): ParsedDiff => {
  const lines = diffText.split("\n");
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let oldStartLine: number | undefined;
  let newStartLine: number | undefined;

  for (const line of lines) {
    const hunkMatch = HUNK_HEADER_REGEX.exec(line);
    if (hunkMatch) {
      oldStartLine ??= Number.parseInt(hunkMatch[1], 10);
      newStartLine ??= Number.parseInt(hunkMatch[2], 10);
      continue;
    }

    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      continue;
    }

    if (line.startsWith("-")) {
      oldLines.push(line.substring(1));
    } else if (line.startsWith("+")) {
      newLines.push(line.substring(1));
    } else if (line.startsWith(" ") || line === "") {
      const content = line.startsWith(" ") ? line.substring(1) : line;
      oldLines.push(content);
      newLines.push(content);
    }
  }

  return {
    oldValue: oldLines.join("\n"),
    newValue: newLines.join("\n"),
    oldStartLine,
    newStartLine,
  };
};

const DIFF_HEADER_PREFIXES = ["@@", "diff ", "index ", "---", "+++"] as const;

function isDiffHeader(line: string): boolean {
  return DIFF_HEADER_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/**
 * Truncates a unified diff string to at most `visibleLines` displayable lines
 * (header lines — @@, diff, index, ---, +++ — are not counted toward the
 * limit and are always preserved so the truncated string remains parseable).
 *
 * Returns the truncated unified diff string. Callers should pass the result
 * to `parseUnifiedDiff` when they need old/new values.
 */
export function truncateDiff(
  unifiedDiff: string,
  visibleLines: number
): string {
  const lines = unifiedDiff.split("\n");
  const result: string[] = [];
  let displayableCount = 0;

  for (const line of lines) {
    if (isDiffHeader(line)) {
      result.push(line);
      continue;
    }

    if (displayableCount >= visibleLines) {
      break;
    }

    result.push(line);
    displayableCount++;
  }

  return result.join("\n");
}

/** Default number of lines to show before "Show more" */
export const DEFAULT_VISIBLE_LINES = 15;

/** Threshold for virtual scrolling (only for expanded large files) */
export const VIRTUAL_SCROLL_THRESHOLD = 100;

/** Line height for virtual scrolling */
export const VIRTUAL_LINE_HEIGHT = 18;
