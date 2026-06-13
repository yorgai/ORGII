/**
 * Progressive Diff Computation
 *
 * Thin wrapper around the Rust diff engine. Rust `similar` is fast enough
 * that we no longer need JS-side chunking, progressive rendering, or caching.
 */
import { createLogger } from "@src/hooks/logger";

import { computeDiffAsync } from "./diffUtils";
import type { DiffLine } from "./types";

const log = createLogger("ProgressiveDiff");

interface ProgressiveDiffOptions {
  oldValue: string;
  newValue: string;
  contextLines: number;
  collapseUnchanged: boolean;
  oldStartLine?: number;
  newStartLine?: number;
  onProgress?: (lines: DiffLine[], progress: number) => void;
  onComplete?: (lines: DiffLine[]) => void;
}

/**
 * Compute diff asynchronously via Rust.
 * Returns a cancel function.
 */
export const computeDiffProgressive = (
  options: ProgressiveDiffOptions
): (() => void) => {
  const {
    oldValue,
    newValue,
    contextLines,
    collapseUnchanged,
    oldStartLine = 1,
    newStartLine = 1,
    onProgress,
    onComplete,
  } = options;

  let cancelled = false;

  computeDiffAsync(
    oldValue,
    newValue,
    contextLines,
    collapseUnchanged,
    oldStartLine,
    newStartLine
  )
    .then((result) => {
      if (!cancelled) {
        onProgress?.(result, 1);
        onComplete?.(result);
      }
    })
    .catch((error) => {
      if (!cancelled) {
        log.error("[ProgressiveDiff] Rust diff error:", error);
        onComplete?.([]);
      }
    });

  return () => {
    cancelled = true;
  };
};
