/**
 * CodeMirror Dirty Diff Gutter
 *
 * VS Code-style change indicators in the gutter showing
 * added/modified/deleted lines compared to original content.
 * Uses Rust backend via Tauri invoke for fast diff computation.
 */
import {
  Extension,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  EditorView,
  GutterMarker,
  ViewPlugin,
  ViewUpdate,
  gutter,
} from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";

// ============================================
// Types
// ============================================

/**
 * Line change type for dirty diff
 */
export type DiffLineType = "added" | "modified" | "deleted";

/**
 * Result from Rust dirty diff computation
 */
interface DirtyDiffMarker {
  line: number;
  type: DiffLineType;
}

interface DirtyDiffResult {
  markers: DirtyDiffMarker[];
  processing_time_us: number;
}

// ============================================
// Rust Backend
// ============================================

/**
 * Compute dirty diff markers using Rust backend.
 * This is 10-50x faster than JavaScript and runs in a separate thread.
 */
async function computeDirtyDiffRust(
  original: string,
  current: string
): Promise<Map<number, DiffLineType>> {
  try {
    const result = await invoke<DirtyDiffResult>("compute_dirty_diff_markers", {
      original,
      current,
    });

    const changes = new Map<number, DiffLineType>();
    for (const marker of result.markers) {
      changes.set(marker.line, marker.type);
    }
    return changes;
  } catch (error) {
    console.warn(
      "[DirtyDiff] Rust computation failed, returning empty:",
      error
    );
    return new Map();
  }
}

// ============================================
// Gutter Markers
// ============================================

/**
 * Gutter marker implementation
 */
class DiffGutterMarker extends GutterMarker {
  constructor(readonly type: DiffLineType) {
    super();
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("div");
    marker.className = `cm-dirty-diff-marker cm-dirty-diff-${this.type}`;
    // Inline styles for reliability - CSS can override via !important if needed
    // Use CSS variables with fallbacks for colors
    const colorVar =
      this.type === "added"
        ? "var(--diff-added-color, #2EA043)"
        : this.type === "modified"
          ? "var(--diff-modified-color, #0078D4)"
          : "var(--diff-deleted-color, #F85149)";
    marker.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: var(--diff-gutter-bar-width, 2px);
      height: 100%;
      background-color: ${colorVar};
    `;
    return marker;
  }

  eq(other: DiffGutterMarker): boolean {
    return this.type === other.type;
  }
}

// Singleton marker instances for reuse
const addedMarker = new DiffGutterMarker("added");
const modifiedMarker = new DiffGutterMarker("modified");
const deletedMarker = new DiffGutterMarker("deleted");

// ============================================
// Configuration
// ============================================

/**
 * Debounce delay for dirty diff computation (ms).
 * With Rust backend, we can use a shorter delay since computation is fast.
 */
const DIRTY_DIFF_DEBOUNCE_MS = 150;

/**
 * Effect to update dirty diff markers asynchronously
 */
const updateDirtyDiffEffect = StateEffect.define<RangeSet<GutterMarker>>();

/**
 * Build RangeSet of markers from change map
 */
function buildMarkerRangeSet(
  changes: Map<number, DiffLineType>,
  doc: { lines: number; line: (n: number) => { from: number } }
): RangeSet<GutterMarker> {
  if (changes.size === 0) {
    return RangeSet.empty;
  }

  const builder = new RangeSetBuilder<GutterMarker>();

  // Add markers for each changed line (must be in order)
  const sortedLines = Array.from(changes.entries()).sort(
    (left, right) => left[0] - right[0]
  );

  for (const [lineNum, type] of sortedLines) {
    if (lineNum >= 1 && lineNum <= doc.lines) {
      const line = doc.line(lineNum);
      const marker =
        type === "added"
          ? addedMarker
          : type === "modified"
            ? modifiedMarker
            : deletedMarker;
      builder.add(line.from, line.from, marker);
    }
  }

  return builder.finish();
}

// ============================================
// Extension
// ============================================

/**
 * Creates a dirty diff gutter extension.
 * Shows colored markers in the gutter for added/modified/deleted lines.
 *
 * Uses Rust backend for diff computation via Tauri invoke.
 * This is 10-50x faster than JavaScript and runs in a separate thread,
 * completely non-blocking to the UI.
 *
 * @param originalRef - A ref object containing the original content to compare against
 * @param isDeletedFile - If true, marks all lines as deleted (for viewing deleted files)
 */
export function dirtyDiffGutter(
  originalRef: { current: string },
  isDeletedFile = false
): Extension {
  // StateField to store computed markers
  // create() returns EMPTY markers - ViewPlugin computes async via Rust
  const dirtyDiffField = StateField.define<RangeSet<GutterMarker>>({
    create(_state) {
      return RangeSet.empty;
    },
    update(markers, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(updateDirtyDiffEffect)) {
          return effect.value;
        }
      }
      // Map marker positions through document changes to keep them valid.
      // Without this, markers retain stale positions after file switches,
      // causing "Position X is out of range for changeset of length Y" errors.
      if (transaction.docChanged) {
        return markers.map(transaction.changes);
      }
      return markers;
    },
  });

  // ViewPlugin for async diff computation via Rust
  const dirtyDiffPlugin = ViewPlugin.fromClass(
    class {
      private debounceTimer: ReturnType<typeof setTimeout> | null = null;
      private isComputing = false;
      private pendingUpdate = false;
      private destroyed = false;

      constructor(private view: EditorView) {
        // Schedule initial computation
        this.scheduleComputation(50);
      }

      update(update: ViewUpdate) {
        if (this.destroyed || !update.docChanged) return;

        if (this.isComputing) {
          this.pendingUpdate = true;
          return;
        }

        this.scheduleComputation(DIRTY_DIFF_DEBOUNCE_MS);
      }

      private scheduleComputation(delayMs: number) {
        if (this.destroyed) return;

        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          if (!this.destroyed) {
            this.computeAndApply();
          }
        }, delayMs);
      }

      private async computeAndApply() {
        if (this.destroyed || this.isComputing) {
          if (!this.destroyed) this.pendingUpdate = true;
          return;
        }

        this.isComputing = true;
        this.pendingUpdate = false;

        try {
          // Early exit if view is no longer valid
          if (this.destroyed || !this.view.dom.isConnected) {
            return;
          }

          const original = originalRef.current;
          const current = this.view.state.doc.toString();

          let markers: RangeSet<GutterMarker>;

          // Special case: deleted file - mark all lines red
          if (isDeletedFile) {
            const builder = new RangeSetBuilder<GutterMarker>();
            for (
              let lineNum = 1;
              lineNum <= this.view.state.doc.lines;
              lineNum++
            ) {
              const line = this.view.state.doc.line(lineNum);
              builder.add(line.from, line.from, deletedMarker);
            }
            markers = builder.finish();
          }
          // Fast path: identical content - no markers
          else if (original === current) {
            markers = RangeSet.empty;
          }
          // Normal case: compute diff via Rust
          else {
            const changes = await computeDirtyDiffRust(original, current);

            // Check again after async - view might have been destroyed
            if (this.destroyed || !this.view.dom.isConnected) {
              return;
            }

            markers = buildMarkerRangeSet(changes, this.view.state.doc);
          }

          // Apply markers (check view still valid after async)
          if (!this.destroyed && this.view.dom.isConnected) {
            this.view.dispatch({
              effects: updateDirtyDiffEffect.of(markers),
            });
          }
        } catch (error) {
          // Only log if not destroyed (expected when switching files)
          if (!this.destroyed) {
            console.warn("[DirtyDiff] Computation error:", error);
          }
        } finally {
          this.isComputing = false;

          if (!this.destroyed && this.pendingUpdate) {
            this.pendingUpdate = false;
            this.scheduleComputation(DIRTY_DIFF_DEBOUNCE_MS);
          }
        }
      }

      destroy() {
        this.destroyed = true;
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }
      }
    }
  );

  // Gutter that reads from StateField
  const diffGutter = gutter({
    class: "cm-dirty-diff-gutter",
    markers: (view) => view.state.field(dirtyDiffField),
  });

  // Theme for gutter styling
  const gutterTheme = EditorView.baseTheme({
    ".cm-dirty-diff-gutter": {
      width: "var(--diff-gutter-width, 4px)",
      minWidth: "var(--diff-gutter-width, 4px)",
      maxWidth: "var(--diff-gutter-width, 4px)",
    },
    ".cm-dirty-diff-gutter .cm-gutterElement": {
      position: "relative",
      padding: "0",
    },
  });

  return [dirtyDiffField, dirtyDiffPlugin, diffGutter, gutterTheme];
}
