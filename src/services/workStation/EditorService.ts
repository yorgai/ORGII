/**
 * EditorService - Singleton Editor Operations Service
 *
 * Provides CodeMirror editor capabilities shared by both AI and UI.
 * The service stores a reference to the active EditorView and provides
 * methods to manipulate the editor programmatically.
 *
 * Usage:
 *   import { EditorService } from "@src/services/workStation";
 *   EditorService.goToLine(42);
 *
 * Setup in CodeMirrorEditor:
 *   useEffect(() => {
 *     EditorService.setEditorView(view);
 *     return () => EditorService.clearEditorView();
 *   }, [view]);
 */
import {
  redo as codemirrorRedo,
  selectAll as codemirrorSelectAll,
  undo as codemirrorUndo,
} from "@codemirror/commands";
import {
  SearchQuery,
  closeSearchPanel,
  openSearchPanel,
  replaceAll,
  setSearchQuery,
} from "@codemirror/search";
import { EditorView } from "@codemirror/view";

import { openGoToLinePanel } from "@src/features/CodeMirror/config/goToLine";

// ============================================
// Internal State
// ============================================

/** Current active EditorView reference */
let editorView: EditorView | null = null;

// ============================================
// EditorService - Singleton API
// ============================================

export const EditorService = {
  // ============================================
  // EditorView Management
  // ============================================

  /**
   * Set the active EditorView reference
   * Called by CodeMirrorEditor when it mounts/updates
   */
  setEditorView(view: EditorView): void {
    editorView = view;
  },

  /**
   * Clear the EditorView reference
   * Called by CodeMirrorEditor when it unmounts
   */
  clearEditorView(): void {
    editorView = null;
  },

  /**
   * Get the current EditorView (if available)
   */
  getEditorView(): EditorView | null {
    return editorView;
  },

  /**
   * Check if an EditorView is available
   */
  hasEditorView(): boolean {
    return editorView !== null;
  },

  // ============================================
  // Navigation Commands
  // ============================================

  /**
   * Go to a specific line in the editor
   */
  goToLine(line: number): boolean {
    if (!editorView) {
      return false;
    }

    try {
      const doc = editorView.state.doc;
      const lineCount = doc.lines;

      // Clamp line number to valid range
      const targetLine = Math.max(1, Math.min(line, lineCount));
      const lineInfo = doc.line(targetLine);

      // Move cursor to start of line and scroll into view
      editorView.dispatch({
        selection: { anchor: lineInfo.from },
        scrollIntoView: true,
        effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
      });

      // Focus the editor
      editorView.focus();

      return true;
    } catch (_error) {
      return false;
    }
  },

  /**
   * Open the go-to-line panel in the editor
   */
  openGoToLinePanel(): boolean {
    if (!editorView) {
      return false;
    }

    try {
      return openGoToLinePanel(editorView);
    } catch (_error) {
      return false;
    }
  },

  /**
   * Go to a specific position (line and column)
   */
  goToPosition(line: number, column: number = 1): boolean {
    if (!editorView) {
      return false;
    }

    try {
      const doc = editorView.state.doc;
      const lineCount = doc.lines;

      // Clamp line number to valid range
      const targetLine = Math.max(1, Math.min(line, lineCount));
      const lineInfo = doc.line(targetLine);

      // Clamp column to valid range within the line
      const lineLength = lineInfo.to - lineInfo.from;
      const targetColumn = Math.max(1, Math.min(column, lineLength + 1));
      const pos = lineInfo.from + targetColumn - 1;

      editorView.dispatch({
        selection: { anchor: pos },
        scrollIntoView: true,
        effects: EditorView.scrollIntoView(pos, { y: "center" }),
      });

      editorView.focus();

      return true;
    } catch (_error) {
      return false;
    }
  },

  // ============================================
  // Search & Replace Commands
  // ============================================

  /**
   * Open find panel and optionally search for text
   */
  find(
    query?: string,
    options?: { caseSensitive?: boolean; regex?: boolean }
  ): boolean {
    if (!editorView) {
      return false;
    }

    try {
      // Open the search panel
      openSearchPanel(editorView);

      // If query provided, set it
      if (query) {
        editorView.dispatch({
          effects: setSearchQuery.of(
            new SearchQuery({
              search: query,
              caseSensitive: options?.caseSensitive ?? false,
              regexp: options?.regex ?? false,
              replace: "",
            })
          ),
        });
      }

      return true;
    } catch (_error) {
      return false;
    }
  },

  /**
   * Find and replace text
   */
  replace(
    findText: string,
    replaceText: string,
    options?: { all?: boolean; caseSensitive?: boolean; regex?: boolean }
  ): boolean {
    if (!editorView) {
      return false;
    }

    try {
      // Set search query with replacement
      editorView.dispatch({
        effects: setSearchQuery.of(
          new SearchQuery({
            search: findText,
            caseSensitive: options?.caseSensitive ?? false,
            regexp: options?.regex ?? false,
            replace: replaceText,
          })
        ),
      });

      // If replacing all, execute replace all
      if (options?.all) {
        replaceAll(editorView);
      }

      // Open search panel to show replacement UI
      openSearchPanel(editorView);

      return true;
    } catch (_error) {
      return false;
    }
  },

  /**
   * Close the search panel
   */
  closeSearch(): boolean {
    if (!editorView) {
      return false;
    }

    try {
      closeSearchPanel(editorView);
      return true;
    } catch (_error) {
      return false;
    }
  },

  // ============================================
  // History Commands
  // ============================================

  /**
   * Undo last edit
   */
  undo(): boolean {
    if (!editorView) {
      return false;
    }

    try {
      return codemirrorUndo(editorView);
    } catch (_error) {
      return false;
    }
  },

  /**
   * Redo last undone edit
   */
  redo(): boolean {
    if (!editorView) {
      return false;
    }

    try {
      return codemirrorRedo(editorView);
    } catch (_error) {
      return false;
    }
  },

  // ============================================
  // Selection Commands
  // ============================================

  /**
   * Select all text in the editor
   */
  selectAll(): boolean {
    if (!editorView) {
      return false;
    }

    try {
      codemirrorSelectAll(editorView);
      return true;
    } catch (_error) {
      return false;
    }
  },

  /**
   * Get current selection text
   */
  getSelection(): string | null {
    if (!editorView) {
      return null;
    }

    try {
      const selection = editorView.state.selection.main;
      if (selection.empty) {
        return null;
      }
      return editorView.state.sliceDoc(selection.from, selection.to);
    } catch (_error) {
      return null;
    }
  },

  /**
   * Set selection range
   */
  setSelection(from: number, to: number): boolean {
    if (!editorView) {
      return false;
    }

    try {
      const docLength = editorView.state.doc.length;
      const clampedFrom = Math.max(0, Math.min(from, docLength));
      const clampedTo = Math.max(clampedFrom, Math.min(to, docLength));

      editorView.dispatch({
        selection: { anchor: clampedFrom, head: clampedTo },
      });
      return true;
    } catch (_error) {
      return false;
    }
  },

  // ============================================
  // Text Manipulation Commands
  // ============================================

  /**
   * Insert text at cursor position
   */
  insertText(text: string): boolean {
    if (!editorView) {
      return false;
    }

    try {
      const selection = editorView.state.selection.main;
      editorView.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: text,
        },
      });
      return true;
    } catch (_error) {
      return false;
    }
  },

  /**
   * Replace selected text or insert at cursor
   */
  replaceSelection(text: string): boolean {
    return this.insertText(text);
  },

  // ============================================
  // Formatting Commands (stubs for future)
  // ============================================

  /**
   * Format the current document
   * TODO: Requires formatter integration (prettier, etc.)
   */
  async format(): Promise<boolean> {
    // Not yet implemented - needs prettier/formatter integration
    return false;
  },

  // ============================================
  // Folding Commands (stubs for future)
  // ============================================

  /**
   * Fold code at cursor or all
   * TODO: Implement with CodeMirror folding commands
   */
  fold(_all?: boolean): boolean {
    // Not yet implemented
    return false;
  },

  /**
   * Unfold code at cursor or all
   * TODO: Implement with CodeMirror folding commands
   */
  unfold(_all?: boolean): boolean {
    // Not yet implemented
    return false;
  },

  // ============================================
  // Focus & Utility Commands
  // ============================================

  /**
   * Focus the editor
   */
  focus(): boolean {
    if (!editorView) {
      return false;
    }

    try {
      editorView.focus();
      return true;
    } catch (_error) {
      return false;
    }
  },

  /**
   * Get cursor position (line and column)
   */
  getCursorPosition(): { line: number; column: number } | null {
    if (!editorView) {
      return null;
    }

    try {
      const selection = editorView.state.selection.main;
      const doc = editorView.state.doc;
      const line = doc.lineAt(selection.head);
      return {
        line: line.number,
        column: selection.head - line.from + 1,
      };
    } catch (_error) {
      return null;
    }
  },

  /**
   * Get document content
   */
  getContent(): string | null {
    if (!editorView) {
      return null;
    }

    try {
      return editorView.state.doc.toString();
    } catch (_error) {
      return null;
    }
  },

  /**
   * Get total line count
   */
  getLineCount(): number | null {
    if (!editorView) {
      return null;
    }

    return editorView.state.doc.lines;
  },
};

export default EditorService;
