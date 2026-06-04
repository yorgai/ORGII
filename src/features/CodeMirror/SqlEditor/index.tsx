/**
 * SqlQueryEditor Component
 *
 * SQL query editor with CodeMirror 6 and syntax highlighting.
 * Features:
 * - SQL syntax highlighting via @codemirror/lang-sql
 * - Table/column autocomplete
 * - Format SQL button
 * - Execute with Ctrl+Enter
 * - Query history dropdown
 */
import { SQLite, sql } from "@codemirror/lang-sql";
import { EditorView, keymap } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { AlignLeft, History, Play } from "lucide-react";
import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import { format as formatSql } from "sql-formatter";

import type { TableInfo } from "@src/engines/DatabaseCore";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import {
  BASIC_SETUP_SQL_CONFIG,
  codeMirrorCspNonceExtension,
  createCodeMirrorTheme,
  editorHistoryKeymapExtension,
  getCodeMirrorTheme,
} from "../config";
import "./index.scss";

// ============================================
// Types
// ============================================

export interface SqlQueryEditorProps {
  /** Default SQL query */
  defaultValue?: string;
  /** Callback when query is executed */
  onExecute: (sql: string) => void;
  /** Tables for autocomplete */
  tables?: TableInfo[];
  /** Loading state (query executing) */
  loading?: boolean;
  /** Query history items */
  history?: Array<{ sql: string; timestamp: number }>;
  /** Callback when history item is selected */
  onHistorySelect?: (sql: string) => void;
}

// ============================================
// Component
// ============================================

export const SqlQueryEditor: React.FC<SqlQueryEditorProps> = memo(
  ({
    defaultValue = "",
    onExecute,
    tables = [],
    loading = false,
    history = [],
    onHistorySelect,
  }) => {
    const { isDark } = useCurrentTheme();
    const [value, setValue] = useState(defaultValue);
    const [showHistory, setShowHistory] = useState(false);
    const historyRef = useRef<HTMLDivElement>(null);

    // Build autocomplete schema from tables
    const schema = useMemo(() => {
      const tableSchema: Record<string, string[]> = {};
      tables.forEach((table) => {
        // For now, just add table names without columns
        // Column autocomplete would require fetching schema for each table
        tableSchema[table.name] = [];
      });
      return tableSchema;
    }, [tables]);

    // Handle execute
    const handleExecute = useCallback(() => {
      if (value.trim() && !loading) {
        onExecute(value.trim());
      }
    }, [value, loading, onExecute]);

    // Handle format
    const handleFormat = useCallback(() => {
      try {
        const formatted = formatSql(value, {
          language: "sqlite",
          tabWidth: 2,
          keywordCase: "upper",
        });
        setValue(formatted);
      } catch {
        // If formatting fails, keep original
        console.warn("SQL formatting failed");
      }
    }, [value, setValue]);

    // Handle history selection
    const handleHistoryClick = useCallback(
      (sqlQuery: string) => {
        setValue(sqlQuery);
        setShowHistory(false);
        onHistorySelect?.(sqlQuery);
      },
      [setValue, onHistorySelect]
    );

    // Build extensions
    const extensions = useMemo(() => {
      const exts = [
        codeMirrorCspNonceExtension,
        editorHistoryKeymapExtension(),
        // SQL language with SQLite dialect and table autocomplete
        sql({
          dialect: SQLite,
          schema,
          upperCaseKeywords: true,
        }),
        // Custom theme
        createCodeMirrorTheme(isDark),
        // Execute on Ctrl+Enter
        keymap.of([
          {
            key: "Ctrl-Enter",
            mac: "Cmd-Enter",
            run: () => {
              handleExecute();
              return true;
            },
          },
        ]),
        // Line wrapping for long queries
        EditorView.lineWrapping,
      ];
      return exts;
    }, [isDark, schema, handleExecute]);

    const theme = getCodeMirrorTheme(isDark);

    return (
      <div className="sql-query-editor">
        {/* Toolbar */}
        <div className="sql-query-editor__toolbar">
          <div className="sql-query-editor__toolbar-left">
            {/* Format button */}
            <button
              onClick={handleFormat}
              title="Format SQL (prettify)"
              className="sql-query-editor__btn"
            >
              <AlignLeft size={14} strokeWidth={1.75} />
              <span>Format</span>
            </button>

            {/* History dropdown */}
            {history.length > 0 && (
              <div className="sql-query-editor__history-container">
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  title="Query history"
                  className="sql-query-editor__btn"
                >
                  <History size={14} strokeWidth={1.75} />
                  <span>History</span>
                </button>

                {showHistory && (
                  <div
                    ref={historyRef}
                    className="sql-query-editor__history-dropdown"
                  >
                    {history.slice(0, 10).map((item, index) => (
                      <button
                        key={index}
                        onClick={() => handleHistoryClick(item.sql)}
                        className="sql-query-editor__history-item"
                      >
                        <span className="sql-query-editor__history-sql">
                          {item.sql.slice(0, 60)}
                          {item.sql.length > 60 ? "..." : ""}
                        </span>
                        <span className="sql-query-editor__history-time">
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="sql-query-editor__toolbar-right">
            {/* Execute button */}
            <button
              onClick={handleExecute}
              disabled={loading || !value.trim()}
              title="Execute query (Ctrl+Enter)"
              className="sql-query-editor__btn sql-query-editor__btn--primary"
            >
              <Play size={14} strokeWidth={1.75} />
              <span>{loading ? "Running..." : "Run"}</span>
            </button>
          </div>
        </div>

        {/* Editor */}
        <div className="sql-query-editor__editor">
          <CodeMirror
            value={value}
            onChange={setValue}
            height="100%"
            theme={theme}
            extensions={extensions}
            placeholder="Enter SQL query..."
            basicSetup={BASIC_SETUP_SQL_CONFIG}
          />
        </div>

        {/* Keyboard hint */}
        <div className="absolute bottom-2 right-3 flex items-center gap-1 text-xs text-text-4">
          <span>Press</span>
          <kbd className="rounded bg-fill-2 px-1.5 py-0.5">⌘</kbd>
          <kbd className="rounded bg-fill-2 px-1.5 py-0.5">↵</kbd>
          <span>to run</span>
        </div>
      </div>
    );
  }
);

SqlQueryEditor.displayName = "SqlQueryEditor";

// Re-export QueryResults for consumers who import from SqlEditor
export { QueryResults } from "./QueryResults";
export type { QueryResultsProps } from "./QueryResults";

export default SqlQueryEditor;
