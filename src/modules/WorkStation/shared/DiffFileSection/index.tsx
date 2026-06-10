import { useSetAtom } from "jotai";
import { ChevronDown, ChevronRight } from "lucide-react";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import FileTypeIcon from "@src/components/FileTypeIcon";
import {
  type GitFileStatus,
  getStatusColor,
  getStatusLetterForFile,
} from "@src/config/gitStatus";
import { CodeMirrorDiff } from "@src/features/CodeMirror";
import { FileHeader } from "@src/modules/WorkStation/shared";
import { DIFF_STATS } from "@src/modules/WorkStation/shared/tokens";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import {
  TextSelectionDropdown,
  useTextSelectionDropdown,
} from "@src/scaffold/ContextMenu/exports";
import { addToAgentAtom } from "@src/store/ui/addToAgentAtom";
import { isBinaryByExtension } from "@src/util/file/binaryDetection";
import {
  getPreviewType,
  supportsSourceControlWorkingCopyPreview,
} from "@src/util/file/previewTypes";

export interface DiffFileSectionData {
  path: string;
  status: GitFileStatus;
  staged: boolean;
  additions?: number;
  deletions?: number;
  oldContent?: string;
  newContent?: string;
  oldStartLine?: number;
  newStartLine?: number;
  isBinary?: boolean;
  /** True when the file was edited but content could not be retrieved (e.g. Cursor IDE blob pruned). */
  isUnavailable?: boolean;
}

export interface DiffFileSectionProps {
  file: DiffFileSectionData;
  defaultExpanded?: boolean;
  repoPath?: string;
  sectionRef?: React.RefObject<HTMLDivElement | null>;
  onFileSelect?: (path: string) => void;
  onRequestContent?: (file: DiffFileSectionData) => void;
  hideDirectory?: boolean;
  showBottomBorder?: boolean;
  dataPath?: string;
  /**
   * When true, renders a flat FileHeader (matching source control style)
   * instead of the collapsible chevron button. Content is always expanded.
   */
  flat?: boolean;
  /**
   * When true, suppresses the bottom padding added by the diff viewer
   * (used in contexts without a bottom panel, e.g. agent station diff).
   */
  noBottomPadding?: boolean;
}

function getDisplayPath(path: string, repoPath?: string): string {
  if (!repoPath || !path.startsWith(repoPath)) return path;
  return path.slice(repoPath.length).replace(/^[/\\]/, "");
}

function getFileNameAndDir(path: string): {
  fileName: string;
  dirPath: string;
} {
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) return { fileName: normalized, dirPath: "" };
  return {
    fileName: normalized.slice(lastSlash + 1) || normalized,
    dirPath: normalized.slice(0, lastSlash),
  };
}

const DiffFileSection: React.FC<DiffFileSectionProps> = ({
  file,
  defaultExpanded = true,
  repoPath,
  sectionRef,
  onFileSelect,
  onRequestContent,
  hideDirectory = false,
  showBottomBorder = true,
  dataPath,
  flat = false,
  noBottomPadding = false,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const containerRef = useRef<HTMLDivElement>(null);
  const setAddToAgent = useSetAtom(addToAgentAtom);

  const { fileName: displayName } = useMemo(
    () => getFileNameAndDir(getDisplayPath(file.path, repoPath)),
    [file.path, repoPath]
  );

  const handleAddToContext = useCallback(
    (text: string, _sessionId: string | null) => {
      setAddToAgent({
        type: "terminal",
        text,
        displayName: displayName || file.path,
      });
    },
    [setAddToAgent, displayName, file.path]
  );

  const {
    visible: dropdownVisible,
    position: dropdownPosition,
    selectedText,
    hideDropdown,
  } = useTextSelectionDropdown({
    source: "terminal",
    containerRef,
    onAddToContext: handleAddToContext,
    enabled: expanded,
  });

  useEffect(() => {
    if (!expanded) return;
    if (file.oldContent !== undefined || file.newContent !== undefined) return;
    onRequestContent?.(file);
  }, [expanded, file, onRequestContent]);

  const statusLetter = getStatusLetterForFile(file.status, file.staged);
  const statusColor = getStatusColor(statusLetter);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const { additions, deletions } = useMemo(() => {
    if (file.additions !== undefined && file.deletions !== undefined) {
      return { additions: file.additions, deletions: file.deletions };
    }
    const oldLines = (file.oldContent || "").split("\n");
    const newLines = (file.newContent || "").split("\n");
    return {
      additions: Math.max(0, newLines.length - oldLines.length),
      deletions: Math.max(0, oldLines.length - newLines.length),
    };
  }, [file]);

  const hasContent =
    !file.isUnavailable &&
    (file.oldContent !== undefined || file.newContent !== undefined);

  const isBinary =
    file.isBinary === true ||
    isBinaryByExtension(file.path) ||
    file.oldContent === "Binary file - content not displayed" ||
    file.newContent === "Binary file - content not displayed";

  const previewType = getPreviewType(file.path);
  const isPreviewable =
    isBinary &&
    previewType !== "binary" &&
    previewType !== "code" &&
    previewType !== "database" &&
    supportsSourceControlWorkingCopyPreview(previewType);

  const displayPath = getDisplayPath(file.path, repoPath);
  const { fileName, dirPath } = getFileNameAndDir(displayPath);

  const diffContent = (
    <div ref={containerRef}>
      {isPreviewable ? (
        <Placeholder
          variant="empty"
          title={t("placeholders.previewNotAvailableInline")}
          className="py-8"
          action={
            onFileSelect
              ? {
                  label: t("actions.openInTab"),
                  onClick: () => onFileSelect(file.path),
                }
              : undefined
          }
        />
      ) : isBinary ? (
        <Placeholder
          variant="empty"
          title={t("placeholders.unsupportedFileType")}
          subtitle={t("placeholders.binaryUnsupportedEncoding")}
        />
      ) : hasContent ? (
        <CodeMirrorDiff
          oldValue={file.oldContent || ""}
          newValue={file.newContent || ""}
          filePath={file.path}
          changeType={file.status}
          oldStartLine={file.oldStartLine}
          newStartLine={file.newStartLine}
          viewMode="unified"
          readOnly={true}
          mergeControls={false}
          collapseUnchanged={true}
          noBottomPadding={noBottomPadding}
          autoHeight
        />
      ) : file.isUnavailable ? (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={t("placeholders.diffContentUnavailable")}
        />
      ) : (
        <Placeholder
          variant="loading"
          placement="detail-panel"
          title={t("placeholders.loadingChanges")}
        />
      )}
    </div>
  );

  if (flat) {
    return (
      <>
        <div
          ref={sectionRef}
          className={showBottomBorder ? "border-b border-border-2" : undefined}
          data-diff-section-path={dataPath}
        >
          <FileHeader
            filePath={file.path}
            repoPath={repoPath}
            additions={additions}
            deletions={deletions}
            publishEnabled={false}
          />
          {diffContent}
        </div>
        <TextSelectionDropdown
          visible={dropdownVisible}
          position={dropdownPosition}
          selectedText={selectedText}
          source="terminal"
          onClose={hideDropdown}
          onAddToContext={handleAddToContext}
        />
      </>
    );
  }

  return (
    <>
      <div
        ref={sectionRef}
        className={showBottomBorder ? "border-b border-border-2" : undefined}
        data-diff-section-path={dataPath}
      >
        <button
          className="sticky top-0 z-10 flex w-full min-w-0 items-center gap-2 bg-[var(--cm-editor-background)] px-3 py-2 text-left hover:bg-fill-2"
          onClick={toggleExpanded}
        >
          {expanded ? (
            <ChevronDown size={14} className="shrink-0 text-text-3" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-text-3" />
          )}
          <FileTypeIcon
            fileName={file.path}
            size="small"
            className="shrink-0 text-text-2"
          />
          <div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
            <span className="shrink-0 text-[13px] font-medium text-text-1">
              {fileName}
            </span>
            {!hideDirectory && dirPath ? (
              <span className="min-w-0 truncate text-[11px] text-text-2">
                {dirPath}
              </span>
            ) : null}
          </div>
          {(additions > 0 || deletions > 0) && (
            <span className={DIFF_STATS.containerCompact}>
              {additions > 0 && (
                <span className={DIFF_STATS.additions}>+{additions}</span>
              )}
              {deletions > 0 && (
                <span className={DIFF_STATS.deletions}>-{deletions}</span>
              )}
            </span>
          )}
          <span className={`shrink-0 text-[11px] font-medium ${statusColor}`}>
            {statusLetter}
          </span>
        </button>

        {expanded && diffContent}
      </div>
      <TextSelectionDropdown
        visible={dropdownVisible}
        position={dropdownPosition}
        selectedText={selectedText}
        source="terminal"
        onClose={hideDropdown}
        onAddToContext={handleAddToContext}
      />
    </>
  );
};

export default memo(DiffFileSection);
