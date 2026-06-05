/**
 * CodeMirrorDiff Component
 *
 * A wrapper around CodeMirror 6's merge view for displaying diffs.
 * Supports both unified (inline) and split (side-by-side) views.
 *
 * Features:
 * - Unified diff view
 * - Split diff view
 * - Native CodeMirror syntax highlighting via Lezer parsers
 * - Accept/reject changes
 * - Collapse unchanged regions
 *
 * Performance: unified and split editors are each created once and kept alive.
 * Switching viewMode is instant — only CSS visibility changes, no rebuild.
 * Content updates are dispatched into the live editor without recreation.
 */
import { history } from "@codemirror/commands";
import { bracketMatching, indentUnit } from "@codemirror/language";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { EditorState, Extension, StateEffect } from "@codemirror/state";
import {
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from "@codemirror/view";
import { EditorView } from "codemirror";
import React, { useEffect, useRef, useState } from "react";

import { CustomScrollbar } from "@src/components/CustomScrollbar";
import type { GitFileStatus } from "@src/config/gitStatus";
import { useEditorAppearanceSettings } from "@src/hooks/settings";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import {
  codeMirrorCspNonceExtension,
  createCodeMirrorTheme,
  customFoldGutter,
  editorHistoryKeymapExtension,
  findReplaceExtension,
  foldPlaceholderTheme,
  getCodeMirrorTheme,
} from "../config";
import { createCopyFileRefExtension } from "../shared/createCopyFileRefExtension";
import { getLanguageExtension } from "../shared/languageExtensions";
import "./index.scss";

// ============================================
// Types
// ============================================

export interface CodeMirrorDiffProps {
  /** Original content */
  oldValue: string;
  /** Modified content */
  newValue: string;
  /** File path for language detection */
  filePath?: string;
  /** Programming language */
  language?: string;
  /** Container height */
  height?: string;
  /** Diff view mode: unified (inline) or split (side-by-side) */
  viewMode?: "unified" | "split";
  /** Read-only mode */
  readOnly?: boolean;
  /** Show merge controls (accept/reject buttons) */
  mergeControls?: boolean;
  /** Collapse unchanged regions */
  collapseUnchanged?: boolean;
  /** Callback when content changes */
  onChange?: (value: string) => void;
  /** Let the editor grow to its content height instead of scrolling internally. */
  autoHeight?: boolean;
  /** Explicit git status when content alone is not enough to infer diff direction. */
  changeType?: GitFileStatus;
  /** Custom class name */
  className?: string;
}

// ============================================
// Shared merge theme override (stable reference — defined outside component)
// ============================================

const MERGE_THEME_OVERRIDE = EditorView.baseTheme({
  "& .cm-changedLine": {
    backgroundColor: "var(--diff-added-bg)",
  },
  "& .cm-insertedChunk": {
    backgroundColor: "var(--diff-added-chunk)",
  },
  "&.cm-merge-a .cm-changedLine": {
    backgroundColor: "var(--diff-deleted-bg)",
  },
  "& .cm-deletedChunk": {
    backgroundColor: "var(--diff-deleted-chunk)",
  },
  ".cm-collapsedLines": {
    display: "flex",
    alignItems: "center",
    gap: "var(--cm-gutter-padding, 4px)",
    width: "100%",
    background: "var(--color-fill-2)",
    border: "none",
    borderRadius: "0",
    outline: "none",
    boxShadow: "none",
    color: "var(--color-text-3)",
    padding: "var(--cm-gutter-padding, 4px) var(--cm-line-padding-left, 12px)",
    margin: "0",
    cursor: "pointer",
    fontSize: "var(--cm-font-size-small, 12px)",
    "&::before": {
      content: '""',
      display: "inline-block",
      width: "var(--cm-icon-size, 14px)",
      height: "var(--cm-icon-size, 14px)",
      marginInlineEnd: "0",
      backgroundColor: "currentColor",
      maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 15 5 5 5-5'/%3E%3Cpath d='m7 9 5-5 5 5'/%3E%3C/svg%3E")`,
      maskSize: "contain",
      maskRepeat: "no-repeat",
      maskPosition: "center",
      WebkitMaskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 15 5 5 5-5'/%3E%3Cpath d='m7 9 5-5 5 5'/%3E%3C/svg%3E")`,
      WebkitMaskSize: "contain",
      WebkitMaskRepeat: "no-repeat",
      WebkitMaskPosition: "center",
      flexShrink: 0,
    },
    "&::after": {
      content: '""',
      display: "none",
    },
    "&:hover": {
      background: "var(--color-fill-3)",
      color: "var(--color-text-2)",
    },
  },
  "&light .cm-collapsedLines": {
    background: "var(--color-fill-2)",
    color: "var(--color-text-3)",
    border: "none",
    borderRadius: "0",
    outline: "none",
  },
  "&dark .cm-collapsedLines": {
    background: "var(--color-fill-2)",
    color: "var(--color-text-3)",
    border: "none",
    borderRadius: "0",
    outline: "none",
  },
});

const AUTO_HEIGHT_THEME = EditorView.theme({
  "&": {
    height: "auto",
  },
  ".cm-scroller": {
    overflow: "visible",
  },
});

// ============================================
// Main Component
// ============================================

export const CodeMirrorDiff: React.FC<CodeMirrorDiffProps> = ({
  oldValue,
  newValue,
  filePath,
  language,
  height = "100%",
  viewMode = "unified",
  readOnly = true,
  mergeControls = true,
  collapseUnchanged = true,
  onChange,
  autoHeight = false,
  changeType,
  className = "",
}) => {
  const { isDark } = useCurrentTheme();
  const appearanceSettings = useEditorAppearanceSettings();
  const isFullDeletion =
    changeType === "deleted" || (oldValue.length > 0 && newValue.length === 0);
  const unifiedDocumentValue = isFullDeletion ? "" : newValue;
  const unifiedOriginalValue = oldValue;

  // Two separate DOM containers — one per view mode, kept alive simultaneously
  const unifiedContainerRef = useRef<HTMLDivElement>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // Live editor instances
  const unifiedViewRef = useRef<EditorView | null>(null);
  const splitMergeViewRef = useRef<MergeView | null>(null);

  // Scrollbar wiring
  const [unifiedScrollEl, setUnifiedScrollEl] = useState<HTMLElement | null>(
    null
  );
  const [splitScrollEl, setSplitScrollEl] = useState<HTMLElement | null>(null);
  const [unifiedLines, setUnifiedLines] = useState(0);
  const [splitLines, setSplitLines] = useState(0);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Track the content that each live instance was last built with,
  // so we can dispatch updates without a full rebuild.
  const unifiedContentRef = useRef<{
    old: string;
    new: string;
    changeType?: GitFileStatus;
  } | null>(null);
  const splitContentRef = useRef<{ old: string; new: string } | null>(null);

  // ── Stable base extensions (rebuilt only when theme/settings change) ─────

  const buildBaseExtensions = (): Extension[] => {
    const exts: Extension[] = [codeMirrorCspNonceExtension];

    exts.push(getCodeMirrorTheme(isDark));

    if (appearanceSettings.lineNumbers === "on") {
      exts.push(lineNumbers());
    } else if (appearanceSettings.lineNumbers === "relative") {
      exts.push(
        lineNumbers({
          formatNumber: (lineNo: number, state: EditorState) => {
            const cursorLine = state.doc.lineAt(
              state.selection.main.head
            ).number;
            return lineNo === cursorLine
              ? String(lineNo)
              : String(Math.abs(lineNo - cursorLine));
          },
        })
      );
    } else if (appearanceSettings.lineNumbers === "interval") {
      exts.push(
        lineNumbers({
          formatNumber: (lineNo: number) =>
            lineNo === 1 || lineNo % 10 === 0 ? String(lineNo) : "",
        })
      );
    }

    if (appearanceSettings.highlightActiveLine) {
      exts.push(highlightActiveLineGutter());
      exts.push(highlightActiveLine());
    }

    exts.push(customFoldGutter());
    exts.push(foldPlaceholderTheme());
    exts.push(history());
    exts.push(editorHistoryKeymapExtension());
    exts.push(bracketMatching());
    exts.push(EditorView.lineWrapping);

    const tabSizeSpaces = " ".repeat(appearanceSettings.tabSize);
    exts.push(indentUnit.of(tabSizeSpaces));
    exts.push(EditorState.tabSize.of(appearanceSettings.tabSize));

    const langExt = getLanguageExtension(filePath, language);
    if (langExt) exts.push(langExt);

    if (filePath) exts.push(createCopyFileRefExtension(filePath));

    exts.push(findReplaceExtension());

    return exts;
  };

  // ── Unified view lifecycle ────────────────────────────────────────────────

  useEffect(() => {
    if (!unifiedContainerRef.current) return;

    // `unifiedMergeView` binds `original` at creation time. Rebuild when
    // the original side changes; dispatch is only safe for modified content.
    if (unifiedViewRef.current && unifiedContentRef.current) {
      const prev = unifiedContentRef.current;
      if (prev.old !== oldValue || prev.changeType !== changeType) {
        unifiedViewRef.current.destroy();
        unifiedViewRef.current = null;
        unifiedContentRef.current = null;
      } else if (prev.new === newValue) {
        return;
      }
    }

    if (unifiedViewRef.current && unifiedContentRef.current) {
      const view = unifiedViewRef.current;
      const currentDoc = view.state.doc.toString();
      const doc = unifiedDocumentValue;
      if (currentDoc !== doc) {
        view.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: doc },
        });
      }
      unifiedContentRef.current = { old: oldValue, new: newValue, changeType };
      setUnifiedLines(view.state.doc.lines);
      return;
    }

    // First creation
    const container = unifiedContainerRef.current;
    container.innerHTML = "";

    try {
      const baseExts = buildBaseExtensions();
      const themeExt = createCodeMirrorTheme(isDark);

      const deletionColorOverride = EditorView.theme({
        "& .cm-changedLine, & .cm-insertedLine": {
          backgroundColor: "var(--diff-deleted-bg) !important",
        },
        "& .cm-insertedChunk": {
          backgroundColor: "var(--diff-deleted-chunk) !important",
        },
        "& .cm-changedLineGutter::before": {
          backgroundColor: "var(--diff-deleted-color) !important",
        },
      });

      const view = new EditorView({
        doc: unifiedDocumentValue,
        extensions: [
          ...baseExts,
          themeExt,
          MERGE_THEME_OVERRIDE,
          ...(autoHeight ? [AUTO_HEIGHT_THEME] : []),
          ...(isFullDeletion ? [deletionColorOverride] : []),
          unifiedMergeView({
            original: unifiedOriginalValue,
            mergeControls: isFullDeletion ? false : mergeControls,
            highlightChanges: true,
            syntaxHighlightDeletions: true,
            collapseUnchanged: collapseUnchanged
              ? { margin: 3, minSize: 10 }
              : undefined,
          }),
          EditorView.editable.of(isFullDeletion ? false : !readOnly),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && onChangeRef.current && !isFullDeletion) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
        parent: container,
      });

      unifiedViewRef.current = view;
      unifiedContentRef.current = { old: oldValue, new: newValue, changeType };
      setUnifiedScrollEl(view.scrollDOM);
      setUnifiedLines(view.state.doc.lines);
    } catch (err) {
      console.error("[CodeMirrorDiff] Error creating unified view:", err);
    }

    return () => {
      unifiedViewRef.current?.destroy();
      unifiedViewRef.current = null;
      unifiedContentRef.current = null;
    };
    // Rebuild when content, settings, or theme changes.
    // viewMode is intentionally excluded — visibility is handled by CSS only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    oldValue,
    newValue,
    changeType,
    readOnly,
    mergeControls,
    collapseUnchanged,
    autoHeight,
    isDark,
    filePath,
    language,
    appearanceSettings.lineNumbers,
    appearanceSettings.highlightActiveLine,
    appearanceSettings.tabSize,
  ]);

  // ── Split view lifecycle ──────────────────────────────────────────────────

  useEffect(() => {
    if (!splitContainerRef.current) return;

    // If the instance already exists, dispatch content updates
    if (splitMergeViewRef.current && splitContentRef.current) {
      const prev = splitContentRef.current;
      if (prev.old === oldValue && prev.new === newValue) return;

      const mv = splitMergeViewRef.current;

      const oldDoc = mv.a.state.doc.toString();
      if (oldDoc !== oldValue) {
        mv.a.dispatch({
          changes: { from: 0, to: oldDoc.length, insert: oldValue },
        });
      }
      const newDoc = mv.b.state.doc.toString();
      if (newDoc !== newValue) {
        mv.b.dispatch({
          changes: { from: 0, to: newDoc.length, insert: newValue },
        });
      }
      splitContentRef.current = { old: oldValue, new: newValue };
      setSplitLines(mv.b.state.doc.lines);
      return;
    }

    // First creation
    const container = splitContainerRef.current;
    container.innerHTML = "";

    try {
      const baseExts = buildBaseExtensions();
      const themeExt = createCodeMirrorTheme(isDark);
      const splitExts = [
        ...baseExts,
        themeExt,
        MERGE_THEME_OVERRIDE,
        ...(autoHeight ? [AUTO_HEIGHT_THEME] : []),
      ];

      const mergeView = new MergeView({
        a: { doc: oldValue, extensions: splitExts },
        b: { doc: newValue, extensions: splitExts },
        parent: container,
        gutter: true,
        highlightChanges: true,
        collapseUnchanged: collapseUnchanged
          ? { margin: 3, minSize: 10 }
          : undefined,
      });

      splitMergeViewRef.current = mergeView;
      splitContentRef.current = { old: oldValue, new: newValue };
      setSplitScrollEl(mergeView.b.scrollDOM);
      setSplitLines(mergeView.b.state.doc.lines);

      if (onChange && !readOnly) {
        mergeView.b.dispatch({
          effects: [
            StateEffect.appendConfig.of(
              EditorView.updateListener.of((update) => {
                if (update.docChanged) onChange(update.state.doc.toString());
              })
            ),
          ],
        });
      }
    } catch (err) {
      console.error("[CodeMirrorDiff] Error creating split view:", err);
    }

    return () => {
      splitMergeViewRef.current?.destroy();
      splitMergeViewRef.current = null;
      splitContentRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    oldValue,
    newValue,
    readOnly,
    collapseUnchanged,
    autoHeight,
    isDark,
    filePath,
    language,
    appearanceSettings.lineNumbers,
    appearanceSettings.highlightActiveLine,
    appearanceSettings.tabSize,
  ]);

  // ── Render ────────────────────────────────────────────────────────────────

  const unifiedVisible = viewMode === "unified";
  const isUnifiedFullDeletion = isFullDeletion;
  const wrapperStyle: React.CSSProperties = autoHeight
    ? { position: "relative" }
    : { height, position: "relative" };
  const visiblePaneStyle: React.CSSProperties = autoHeight
    ? { position: "relative" }
    : { position: "absolute", inset: 0 };
  const hiddenPaneStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    visibility: "hidden",
    pointerEvents: "none",
  };

  return (
    <div
      className={`codemirror-diff-wrapper ${autoHeight ? "codemirror-diff-wrapper--auto-height" : ""} ${isUnifiedFullDeletion ? "codemirror-diff-wrapper--full-deletion" : ""} ${className}`}
      style={wrapperStyle}
    >
      {/* Unified view — always mounted, hidden when split is active */}
      <div
        ref={unifiedContainerRef}
        className="codemirror-diff codemirror-diff--unified"
        spellCheck={false}
        style={unifiedVisible ? visiblePaneStyle : hiddenPaneStyle}
      />
      {/* Split view — always mounted, hidden when unified is active */}
      <div
        ref={splitContainerRef}
        className="codemirror-diff codemirror-diff--split"
        spellCheck={false}
        style={!unifiedVisible ? visiblePaneStyle : hiddenPaneStyle}
      />
      {!autoHeight && (
        <CustomScrollbar
          scrollElement={unifiedVisible ? unifiedScrollEl : splitScrollEl}
          totalLines={unifiedVisible ? unifiedLines : splitLines}
        />
      )}
    </div>
  );
};

CodeMirrorDiff.displayName = "CodeMirrorDiff";

export default CodeMirrorDiff;
