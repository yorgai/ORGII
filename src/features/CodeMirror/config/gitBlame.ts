/**
 * CodeMirror Git Blame Extension
 *
 * GitLens-style inline blame annotation on the current cursor line.
 * Shows author, relative time, and commit summary as dimmed text
 * at the end of the active line. Hovering shows full commit details.
 *
 * Uses blame data passed via a ref (fetched by useGitBlame hook)
 * to avoid React re-renders on cursor movement.
 */
import {
  type Extension,
  type Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { RefObject } from "react";

import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

// ============================================
// Types
// ============================================

export interface BlameLineData {
  line_number: number;
  commit_sha: string;
  short_sha: string;
  author: string;
  author_email: string;
  author_time: string;
  summary: string;
}

// ============================================
// Relative Time Formatting
// ============================================

// ============================================
// Blame Widget
// ============================================

/**
 * Inline widget that renders blame annotation text at end of line.
 * Shows: "AuthorName, 3 days ago · commit message..."
 */
class BlameWidget extends WidgetType {
  constructor(private blame: BlameLineData) {
    super();
  }

  toDOM(): HTMLElement {
    const container = document.createElement("span");
    container.className = "cm-git-blame-annotation";

    const relativeTime = formatRelativeTime(this.blame.author_time, "long");
    const summary =
      this.blame.summary.length > 50
        ? this.blame.summary.slice(0, 50) + "..."
        : this.blame.summary;

    container.textContent = `${this.blame.author}, ${relativeTime} \u00B7 ${summary}`;

    // Tooltip with full details
    const fullDate = new Date(this.blame.author_time).toLocaleString();
    container.title = [
      `${this.blame.short_sha} — ${this.blame.summary}`,
      `${this.blame.author} <${this.blame.author_email}>`,
      fullDate,
    ].join("\n");

    return container;
  }

  eq(other: BlameWidget): boolean {
    return (
      this.blame.commit_sha === other.blame.commit_sha &&
      this.blame.line_number === other.blame.line_number
    );
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// ============================================
// Configuration
// ============================================

/** Debounce delay for cursor movement before updating blame widget (ms) */
const CURSOR_DEBOUNCE_MS = 50;

/** Effect to update the blame decoration */
const updateBlameEffect = StateEffect.define<DecorationSet>();

// ============================================
// Extension
// ============================================

/**
 * Creates a git blame inline annotation extension.
 * Shows blame info for the current cursor line as dimmed inline text.
 *
 * @param blameDataRef - Ref containing blame data map (line number -> BlameLineData).
 *   Updated externally by useGitBlame hook; read synchronously by the plugin.
 */
export function gitBlameExtension(
  blameDataRef: RefObject<Map<number, BlameLineData>>
): Extension {
  // StateField to hold the current blame decoration (single widget)
  const blameField = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(decorations, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(updateBlameEffect)) {
          return effect.value;
        }
      }
      // Map decoration positions through document changes to keep them valid.
      // Without this, decorations retain stale positions after file switches,
      // causing "Position X is out of range for changeset of length Y" errors.
      if (transaction.docChanged) {
        return decorations.map(transaction.changes);
      }
      return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  // ViewPlugin that tracks cursor and shows blame for current line
  const blamePlugin = ViewPlugin.fromClass(
    class {
      private debounceTimer: ReturnType<typeof setTimeout> | null = null;
      private currentLine = -1;
      private destroyed = false;

      constructor(private view: EditorView) {
        // Show blame for initial cursor position
        this.scheduleUpdate(10);
      }

      update(update: ViewUpdate) {
        if (this.destroyed) return;

        // Only react to cursor/selection changes
        if (update.selectionSet || update.docChanged) {
          this.scheduleUpdate(CURSOR_DEBOUNCE_MS);
        }
      }

      private scheduleUpdate(delayMs: number) {
        if (this.destroyed) return;

        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          if (!this.destroyed) {
            this.updateBlameDecoration();
          }
        }, delayMs);
      }

      private updateBlameDecoration() {
        if (this.destroyed || !this.view.dom.isConnected) return;

        const head = this.view.state.selection.main.head;
        const lineNumber = this.view.state.doc.lineAt(head).number;

        // Skip if still on the same line
        if (lineNumber === this.currentLine) return;
        this.currentLine = lineNumber;

        const blameMap = blameDataRef.current;
        if (!blameMap || blameMap.size === 0) {
          // Clear any existing decoration
          this.view.dispatch({
            effects: updateBlameEffect.of(Decoration.none),
          });
          return;
        }

        const blameInfo = blameMap.get(lineNumber);
        if (!blameInfo) {
          // No blame for this line (new/uncommitted line)
          this.view.dispatch({
            effects: updateBlameEffect.of(Decoration.none),
          });
          return;
        }

        // Create widget decoration at end of line
        const line = this.view.state.doc.line(lineNumber);
        const widget = new BlameWidget(blameInfo);
        const deco = Decoration.widget({
          widget,
          side: 1, // After line content
        });

        const decorations: Range<Decoration>[] = [deco.range(line.to)];

        this.view.dispatch({
          effects: updateBlameEffect.of(Decoration.set(decorations, true)),
        });
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

  // Theme for blame annotation styling
  const blameTheme = EditorView.baseTheme({
    ".cm-git-blame-annotation": {
      marginLeft: "3ch",
      opacity: "0.45",
      fontStyle: "italic",
      fontSize: "0.9em",
      whiteSpace: "nowrap",
      pointerEvents: "auto",
      cursor: "default",
      userSelect: "none",
    },
  });

  return [blameField, blamePlugin, blameTheme];
}
