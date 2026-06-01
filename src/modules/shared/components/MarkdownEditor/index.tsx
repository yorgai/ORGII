/**
 * MarkdownEditor — reusable Edit / Preview markdown editor.
 *
 * Combines CodeMirror (edit mode) with Markdown renderer (preview mode),
 * an Edit/Preview TabPill, and an optional token estimate footer.
 *
 * Supports two modes:
 * - **Self-contained**: renders its own TabPill header (default).
 * - **Controlled**: parent owns tab state via `activeTab` / `onTabChange`,
 *   and renders the TabPill elsewhere (set `hideHeader`).
 *
 * Footer row: `~N Token` on the left, optional `footerRight` slot on the right.
 *
 * Border styling matches the Textarea component:
 *   default  → border-border-2
 *   hover    → border-border-3
 *   focus    → primary-6 ring (2px box-shadow)
 */
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Markdown from "@src/components/MarkDown";
import TabPill from "@src/components/TabPill";
import { CodeMirrorEditor } from "@src/features/CodeMirror";

import "./index.scss";

export interface MarkdownEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  minHeight?: number;
  maxHeight?: number;
  showTokenCount?: boolean;
  previewEmptyText?: string;
  className?: string;
  dataTestId?: string;
  /** Hide the built-in TabPill header (use with activeTab/onTabChange). */
  hideHeader?: boolean;
  /** Controlled active tab ("edit" | "preview"). */
  activeTab?: string;
  /** Controlled tab change handler. */
  onTabChange?: (tab: string) => void;
  /**
   * Initial tab when uncontrolled. Defaults to `"edit"` (or `"preview"`
   * when `readOnly`). Use `"preview"` for browse-first contexts where
   * existing content should be read before being edited.
   */
  defaultTab?: "edit" | "preview";
  /** Content rendered on the right side of the footer row (e.g. Save button). */
  footerRight?: React.ReactNode;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Returns the tabs array — useful for parents rendering their own TabPill. */
export function useMarkdownEditorTabs() {
  const { t } = useTranslation();
  return useMemo(
    () => [
      { key: "edit", label: t("common:actions.edit") },
      {
        key: "preview",
        label: t("common:common.preview"),
      },
    ],
    [t]
  );
}

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value,
  onChange,
  readOnly = false,
  minHeight = 200,
  maxHeight,
  showTokenCount = true,
  previewEmptyText,
  className,
  dataTestId,
  hideHeader = false,
  activeTab: controlledTab,
  onTabChange,
  defaultTab,
  footerRight,
}) => {
  const { t } = useTranslation();
  const [internalTab, setInternalTab] = useState<string>(() => {
    if (readOnly) return "preview";
    return defaultTab ?? "edit";
  });

  const currentTab = controlledTab ?? internalTab;
  const handleTabChange = onTabChange ?? setInternalTab;

  const tokenCount = useMemo(() => estimateTokens(value), [value]);
  const tabs = useMarkdownEditorTabs();

  const emptyText = previewEmptyText ?? t("common:common.nothingToPreview");

  const contentStyle = {
    minHeight: `${minHeight}px`,
    ...(maxHeight !== undefined
      ? { height: `${maxHeight}px`, maxHeight: `${maxHeight}px` }
      : {}),
  };
  const showFooter = showTokenCount || footerRight;

  return (
    <div
      className={`markdown-editor-root${className ? ` ${className}` : ""}`}
      data-testid={dataTestId}
    >
      {!readOnly && !hideHeader && (
        <div className="mb-2 flex items-center justify-end">
          <TabPill
            tabs={tabs}
            activeTab={currentTab}
            onChange={handleTabChange}
            variant="pill"
            fillWidth={false}
          />
        </div>
      )}

      <div className="markdown-editor-wrapper">
        {currentTab === "edit" && !readOnly ? (
          <div className="markdown-editor-content" style={contentStyle}>
            <CodeMirrorEditor
              value={value}
              onChange={onChange}
              language="markdown"
              height="100%"
              enableMinimap={false}
              enableLinting={false}
              enableDirtyDiff={false}
              enableFindReplace={false}
              enableGoToLine={false}
              registerWithService={false}
            />
          </div>
        ) : (
          <div className="markdown-editor-preview" style={contentStyle}>
            {value.trim() ? (
              <Markdown textContent={value} />
            ) : (
              <span className="text-text-3">{emptyText}</span>
            )}
          </div>
        )}
      </div>

      {showFooter && (
        <div className="mt-2 flex items-center justify-between">
          {showTokenCount ? (
            <span className="text-xs text-text-3">
              ~{tokenCount.toLocaleString()} Token
            </span>
          ) : (
            <span />
          )}
          {footerRight && (
            <div className="flex items-center gap-2">{footerRight}</div>
          )}
        </div>
      )}
    </div>
  );
};

export default MarkdownEditor;
