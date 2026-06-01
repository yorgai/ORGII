/**
 * GitFileDiffSplit
 *
 * Reusable two-column "git changes" detail layout:
 *
 *   ┌─ headerSlot (caller-supplied) ─────────────────────────────┐
 *   ├─ GitFileList ─┬─ FileHeader + CodeMirrorDiff (selected) ───┤
 *   │  src/foo.ts   │ <selected file diff>                       │
 *   │  src/bar.ts   │                                            │
 *   │   …           │                                            │
 *   ├─ fileListFooterSlot (optional, pinned under the file list)─┤
 *   └────────────────────────────────────────────────────────────┘
 *
 * Used by:
 *   - GitCommitDetailContent (Code Editor git history) → `headerSlot` is the
 *     commit breadcrumb, `fetchFileDiff` reads parent_sha vs commit_sha.
 *
 * Selection persistence is intentionally pushed onto callers via
 * `selectedFilePath` + `onSelectFile` so each surface can store the selection
 * wherever it makes sense (e.g. commit-detail keeps it locally).
 *
 * `fetchFileDiff` lets callers keep their own ref-pair semantics (commit vs
 * working tree) and decide whether to batch-load or fetch on demand.
 */
import { useAtom } from "jotai";
import { ChevronRight } from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { CodeMirrorDiff } from "@src/features/CodeMirror";
import FileHeader from "@src/modules/shared/components/FileHeader";
import type { DiffViewMode } from "@src/modules/shared/components/FileHeader";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { VerticalResizeHandle, useColumnResize } from "@src/scaffold/Resize";
import type { GitFile } from "@src/types/git/types";

import GitFileList from "../GitFileList";
import {
  GIT_FILE_LIST_MAX_WIDTH,
  GIT_FILE_LIST_MIN_WIDTH,
  gitFileListWidthAtom,
} from "../GitFileList/widthAtom";

// ============================================================================
// Types
// ============================================================================

/**
 * One file's diff payload, returned by `fetchFileDiff`.
 *
 * Callers decide whether `oldContent`/`newContent` are pulled from a batch
 * fetch made earlier or fetched on demand here. Returning `null` means the
 * fetch failed for that file; the surface renders an error placeholder.
 */
export interface GitFileDiffContent {
  oldContent: string;
  newContent: string;
  isBinary: boolean;
}

export type FileListLoadState = "loading" | "ready" | "error" | "no-files";

export interface GitFileDiffSplitProps {
  /**
   * Files to render in the left column. Pass an empty array to surface the
   * "no changes" placeholder; pass `loadState: "loading"` to surface the
   * loading placeholder while the file list is being fetched.
   */
  files: GitFile[];
  /** File-list load state. Drives top-level loading / error / empty placeholders. */
  loadState: FileListLoadState;
  /** Error message rendered with the loadState === "error" placeholder. */
  loadError?: string | null;
  /** Optional retry handler for the error placeholder. */
  onRetryLoad?: () => void;
  /**
   * Currently selected file path (id). Caller manages the source of truth so
   * selection survives tab switches and remounts.
   */
  selectedFilePath: string | null;
  /** Called when the user clicks a row in the file list. */
  onSelectFile: (filePath: string) => void;
  /**
   * Caller-supplied diff fetcher. Returning `null` triggers an error
   * placeholder for that file.
   */
  fetchFileDiff: (
    file: GitFile,
    signal: AbortSignal
  ) => Promise<GitFileDiffContent | null>;
  /** Repo root path — used by FileHeader breadcrumb dropdowns. */
  repoPath: string;
  /** Optional content rendered above the split (commit info / commit box). */
  headerSlot?: React.ReactNode;
  /**
   * Optional content pinned to the bottom of the left (file list) column —
   * intended for action surfaces like the commit textarea + buttons that
   * should sit next to the file selection rather than floating above the
   * diff.
   */
  fileListFooterSlot?: React.ReactNode;
  /** Optional title for the file list section header (defaults to "Changed files"). */
  fileListTitle?: string;
  /** Empty-state title when `files` is empty and loadState === "no-files". */
  emptyTitle?: string;
  /** Empty-state subtitle. */
  emptySubtitle?: string;
  /** Forwarded to FileHeader.onFileSelect (e.g. open a tab on breadcrumb click). */
  onFileHeaderSelect?: (filePath: string) => void;
}

// ============================================================================
// Component
// ============================================================================

const GitFileDiffSplit: React.FC<GitFileDiffSplitProps> = ({
  files,
  loadState,
  loadError,
  onRetryLoad,
  selectedFilePath,
  onSelectFile,
  fetchFileDiff,
  repoPath,
  headerSlot,
  fileListFooterSlot,
  fileListTitle,
  emptyTitle,
  emptySubtitle,
  onFileHeaderSelect,
}) => {
  const { t } = useTranslation();

  const [fileListCollapsed, setFileListCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<DiffViewMode>("unified");
  const [fileListWidth, setFileListWidth] = useAtom(gitFileListWidthAtom);
  const { columnRef: fileListRef, handleMouseDown: handleFileListResize } =
    useColumnResize({
      width: fileListWidth,
      setWidth: setFileListWidth,
      min: GIT_FILE_LIST_MIN_WIDTH,
      max: GIT_FILE_LIST_MAX_WIDTH,
    });

  // ── Per-selection diff content fetch ────────────────────────────────────
  const [oldContent, setOldContent] = useState<string>("");
  const [newContent, setNewContent] = useState<string>("");
  const [isBinary, setIsBinary] = useState(false);
  const [fileLoadState, setFileLoadState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileReloadKey, setFileReloadKey] = useState(0);

  const reloadFile = useCallback(() => {
    setFileReloadKey((k) => k + 1);
  }, []);

  const selectedFile = useMemo(() => {
    if (!selectedFilePath) return null;
    return files.find((file) => file.path === selectedFilePath) ?? null;
  }, [files, selectedFilePath]);

  // GitFileList uses `file.id` for selection highlighting; translate back.
  const selectedFileId = selectedFile?.id ?? null;

  useEffect(() => {
    if (!selectedFile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFileLoadState("idle");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFileError(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOldContent("");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNewContent("");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsBinary(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFileLoadState("loading");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFileError(null);

    fetchFileDiff(selectedFile, controller.signal)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setFileLoadState("error");
          setFileError(selectedFile.path);
          return;
        }
        setOldContent(result.oldContent);
        setNewContent(result.newContent);
        setIsBinary(result.isBinary);
        setFileLoadState("ready");
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        setFileLoadState("error");
        setFileError(err instanceof Error ? err.message : selectedFile.path);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedFile, fetchFileDiff, fileReloadKey]);

  const handleFileSelectInList = useCallback(
    (fileId: string) => {
      // GitFileList passes `file.id` (which may be a composite key like
      // `repoId:path-index`). We resolve back to `file.path` so that
      // `selectedFilePath` always holds a plain path, matching the lookup
      // in `selectedFile` (`files.find(f => f.path === selectedFilePath)`).
      const matched = files.find((f) => f.id === fileId);
      onSelectFile(matched ? matched.path : fileId);
    },
    [files, onSelectFile]
  );

  const toggleFileList = useCallback(() => {
    setFileListCollapsed((prev) => !prev);
  }, []);

  // ── Top-level placeholders ─────────────────────────────────────────────
  if (loadState === "loading") {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {headerSlot}
        <Placeholder
          variant="loading"
          placement="detail-panel"
          fillParentHeight
        />
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {headerSlot}
        <Placeholder
          variant="error"
          placement="detail-panel"
          title={t("placeholders.failedToLoad")}
          subtitle={loadError ?? undefined}
          onRetry={onRetryLoad}
          fillParentHeight
        />
      </div>
    );
  }

  if (loadState === "no-files" || files.length === 0) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {headerSlot}
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={emptyTitle ?? t("placeholders.noChanges")}
          subtitle={emptySubtitle}
          fillParentHeight
        />
      </div>
    );
  }

  // ── Ready: split layout ────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {headerSlot}

      <div className="flex min-h-0 flex-1">
        {/* Left: file list (with optional footer slot pinned at bottom) */}
        {!fileListCollapsed && (
          <>
            <div
              ref={fileListRef}
              className="flex flex-shrink-0 flex-col overflow-hidden"
              style={{ width: `${fileListWidth}px` }}
            >
              <div className="min-h-0 flex-1 overflow-hidden">
                <GitFileList
                  files={files}
                  selectedFileId={selectedFileId}
                  onFileSelect={handleFileSelectInList}
                  title={fileListTitle}
                />
              </div>
              {fileListFooterSlot && (
                <div className="shrink-0 border-t border-border-2">
                  {fileListFooterSlot}
                </div>
              )}
            </div>
            <VerticalResizeHandle onMouseDown={handleFileListResize} />
          </>
        )}

        {/* Collapse toggle (when the list is hidden) */}
        {fileListCollapsed && (
          <button
            className="flex w-6 flex-shrink-0 items-center justify-center border-r border-border-2 hover:bg-fill-3"
            onClick={toggleFileList}
            title={t("tooltips.showFileList")}
          >
            <ChevronRight size={14} className="text-text-3" />
          </button>
        )}

        {/* Right: selected file diff */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {selectedFile ? (
            <>
              <FileHeader
                filePath={selectedFile.path}
                repoPath={repoPath}
                additions={selectedFile.additions}
                deletions={selectedFile.deletions}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                loading={fileLoadState === "loading"}
                onFileSelect={onFileHeaderSelect}
              />
              <div className="relative min-h-0 flex-1">
                {fileLoadState === "loading" ? (
                  <Placeholder
                    variant="loading"
                    placement="detail-panel"
                    fillParentHeight
                  />
                ) : fileLoadState === "error" ? (
                  <Placeholder
                    variant="error"
                    placement="detail-panel"
                    title={t("placeholders.failedToLoad")}
                    subtitle={fileError ?? selectedFile.path}
                    onRetry={reloadFile}
                    fillParentHeight
                  />
                ) : isBinary ? (
                  <Placeholder
                    variant="empty"
                    placement="detail-panel"
                    title={t("placeholders.unsupportedFileType")}
                    subtitle={t("placeholders.binaryUnsupportedEncoding")}
                    fillParentHeight
                  />
                ) : (
                  <CodeMirrorDiff
                    oldValue={oldContent}
                    newValue={newContent}
                    filePath={selectedFile.path}
                    changeType={selectedFile.status}
                    height="100%"
                    viewMode={viewMode}
                    readOnly={true}
                    mergeControls={false}
                    collapseUnchanged={true}
                  />
                )}
              </div>
            </>
          ) : (
            <Placeholder
              variant="empty"
              placement="detail-panel"
              title={t("placeholders.selectFileToViewChanges")}
              fillParentHeight
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default memo(GitFileDiffSplit);
