/**
 * Diff Utilities
 *
 * Rust-powered diff, patch, and merge operations via Tauri IPC.
 * Includes lightweight JS parsers for unified diffs:
 *   - `parseUnifiedDiff`  — splits into old/new values
 *   - `parseWorktreeDiff` — structured renderer for SessionDiffWindow
 */

// Rust-powered diff/patch/merge
export {
  computeDiff,
  applyPatch,
  applyFuzzyPatch,
  mergeThreeWay,
  isUnifiedDiff,
  extractDiffFilePath,
  type DiffOptions,
  type DiffResult,
  type DiffStats,
  type PatchResult,
  type FuzzyPatchOptions,
  type FuzzyPatchResult,
  type HunkResult,
  type MergeResult,
} from "@src/api/tauri/diff";

// ── Lightweight JS unified diff parser ──

export interface ParsedDiff {
  oldValue: string;
  newValue: string;
}

const UNIFIED_HUNK_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

/**
 * Split a unified diff string into old/new plain-text values.
 *
 * Gap placeholder lines are inserted between hunks so that absolute line
 * numbers from @@ headers are preserved in the output strings. Without this,
 * multi-hunk diffs produce wrong line offsets when the diff viewer re-computes
 * a diff from the old/new values.
 */
export function parseUnifiedDiff(diffText: string): ParsedDiff {
  const lines = diffText.split("\n");
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let oldCursor = 0;
  let newCursor = 0;
  let seenHunk = false;

  for (const line of lines) {
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      continue;
    }

    const hunkMatch = UNIFIED_HUNK_RE.exec(line);
    if (hunkMatch) {
      const hunkOldStart = Number.parseInt(hunkMatch[1], 10);
      const hunkNewStart = Number.parseInt(hunkMatch[3], 10);
      if (seenHunk) {
        const oldGap = hunkOldStart - oldCursor;
        const newGap = hunkNewStart - newCursor;
        const gapCount = Math.max(oldGap, newGap, 0);
        for (let i = 0; i < gapCount; i++) {
          if (i < oldGap) oldLines.push("");
          if (i < newGap) newLines.push("");
        }
      }
      seenHunk = true;
      oldCursor = hunkOldStart;
      newCursor = hunkNewStart;
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
  };
}

// ── Worktree diff renderer parser ──

export type DiffLineType = "file" | "hunk" | "add" | "remove" | "context";

export interface DiffRendererLine {
  type: DiffLineType;
  content: string;
  /** Index into the parallel `DiffRendererFile[]` array (set on "file" lines). */
  fileIndex?: number;
  /** New-side line number (1-based) derived from the nearest @@ hunk header. */
  newLine?: number;
}

export interface DiffRendererFile {
  /** Display name derived from the `+++ b/…` line, e.g. `"src/foo.ts"`. */
  name: string;
  /** Index in `DiffRendererLine[]` where this file's diff section starts. */
  lineIndex: number;
  addCount: number;
  removeCount: number;
}

export interface ParsedWorktreeDiff {
  lines: DiffRendererLine[];
  files: DiffRendererFile[];
}

/** Classify a single raw unified-diff line into a rendering type. */
export function classifyDiffLine(line: string): DiffLineType {
  if (
    line.startsWith("diff ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ")
  )
    return "file";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  return "context";
}

/**
 * Extract the display filename from a `+++ b/path/to/file` header.
 * Falls back gracefully for non-`b/`-prefixed paths and bare `+++` lines.
 */
export function extractDiffFileName(line: string): string {
  const trimmed = line.trim();
  const withPrefix = /^\+\+\+\s+b\/(.+)$/.exec(trimmed);
  if (withPrefix) return withPrefix[1];
  const bare = /^\+\+\+\s+(.+)$/.exec(trimmed);
  if (bare) return bare[1];
  return trimmed.replace(/^\+\+\+\s+/, "");
}

/**
 * Parse the new-side start line number from a `@@ -old +new @@` hunk header.
 * Returns `undefined` if the line doesn't match the expected format.
 */
export function parseHunkNewStart(line: string): number | undefined {
  const match = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Parse a raw unified diff string into structured lines and a file index.
 *
 * New-side line counters:
 *   - `add`     lines: assigned current counter, then counter++
 *   - `context` lines: assigned current counter, then counter++
 *   - `remove`  lines: assigned current counter (not advancing — the line no
 *               longer exists on the new side, but we store the value so a
 *               double-click navigates to the nearest surrounding context)
 *   - `hunk`    lines: counter reset to the hunk's new-side start
 *   - `file`    lines: counter cleared (file boundary)
 */
export function parseWorktreeDiff(raw: string): ParsedWorktreeDiff {
  const rawLines = raw.split("\n");
  const lines: DiffRendererLine[] = [];
  const files: DiffRendererFile[] = [];

  let currentFile: DiffRendererFile | null = null;
  let currentNewLine: number | undefined;

  for (const rawLine of rawLines) {
    const type = classifyDiffLine(rawLine);
    const entry: DiffRendererLine = { type, content: rawLine };

    if (type === "hunk") {
      currentNewLine = parseHunkNewStart(rawLine);
      entry.newLine = currentNewLine;
    } else if (type === "add" || type === "context") {
      if (currentNewLine !== undefined) {
        entry.newLine = currentNewLine;
        currentNewLine++;
      }
    } else if (type === "remove") {
      if (currentNewLine !== undefined) {
        entry.newLine = currentNewLine;
      }
    } else if (type === "file" && rawLine.startsWith("+++ ")) {
      currentNewLine = undefined;
      if (currentFile) files.push(currentFile);
      currentFile = {
        name: extractDiffFileName(rawLine),
        lineIndex: lines.length,
        addCount: 0,
        removeCount: 0,
      };
      // prospective index: this file will be at files[files.length] after push
      entry.fileIndex = files.length;
    }

    if (currentFile) {
      if (type === "add") currentFile.addCount++;
      else if (type === "remove") currentFile.removeCount++;
    }

    lines.push(entry);
  }

  if (currentFile) files.push(currentFile);

  return { lines, files };
}
