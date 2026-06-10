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

const HUNK_HEADER_REGEX = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

interface HunkInfo {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

/**
 * Parse the @@ hunk header and return the hunk coordinates.
 * Returns null if the line is not a hunk header.
 */
function parseHunkHeader(line: string): HunkInfo | null {
  const m = HUNK_HEADER_REGEX.exec(line);
  if (!m) return null;
  return {
    oldStart: Number.parseInt(m[1], 10),
    oldCount: m[2] !== undefined ? Number.parseInt(m[2], 10) : 1,
    newStart: Number.parseInt(m[3], 10),
    newCount: m[4] !== undefined ? Number.parseInt(m[4], 10) : 1,
  };
}

export const parseUnifiedDiff = (diffText: string): ParsedDiff => {
  const lines = diffText.split("\n");
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let oldStartLine: number | undefined;
  let newStartLine: number | undefined;

  // Track positions so we can insert gap lines between hunks.
  // oldCursor / newCursor track the next expected line number in each stream.
  let oldCursor = 0;
  let newCursor = 0;

  for (const line of lines) {
    const hunk = parseHunkHeader(line);
    if (hunk) {
      if (oldStartLine === undefined) {
        // First hunk — record the overall start lines.
        oldStartLine = hunk.oldStart;
        newStartLine = hunk.newStart;
        oldCursor = hunk.oldStart;
        newCursor = hunk.newStart;
      } else {
        // Subsequent hunk — insert gap placeholder lines so that the Rust
        // diff engine assigns the correct absolute line numbers.
        const oldGap = hunk.oldStart - oldCursor;
        const newGap = hunk.newStart - newCursor;
        const gapCount = Math.max(oldGap, newGap, 0);
        for (let i = 0; i < gapCount; i++) {
          // Empty placeholder lines that bridge the gap between hunks.
          if (i < oldGap) oldLines.push("");
          if (i < newGap) newLines.push("");
        }
        oldCursor = hunk.oldStart;
        newCursor = hunk.newStart;
      }
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
      oldCursor++;
    } else if (line.startsWith("+")) {
      newLines.push(line.substring(1));
      newCursor++;
    } else if (line.startsWith(" ") || line === "") {
      const content = line.startsWith(" ") ? line.substring(1) : line;
      oldLines.push(content);
      newLines.push(content);
      oldCursor++;
      newCursor++;
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
