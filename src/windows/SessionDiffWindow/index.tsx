/**
 * SessionDiffWindow
 *
 * Standalone Tauri window that fetches and displays the git diff for a single
 * agent session. Provides a two-column layout: a file tree on the left and
 * a diff viewer on the right.
 *
 * - Clicking a file in the tree scrolls the diff viewer to that file's hunk.
 * - Double-clicking a diff line emits a cross-window Tauri event
 *   (`orgii:open-file-in-editor`) so the main window opens the file at the
 *   matching line number (G5).
 * - When the session is a CLI worktree session (detected by calling
 *   `cli_agent_worktree_diff`), Merge and Discard action buttons are shown in
 *   the header (G4).
 */
import { emit } from "@tauri-apps/api/event";
import { Check, GitMerge, Trash2 } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import type {
  DiffLineType,
  DiffRendererFile,
  DiffRendererLine,
} from "@src/util/diff";
import { parseWorktreeDiff } from "@src/util/diff";
import { isTauriDesktop } from "@src/util/platform/tauri";

interface SessionDiffWindowProps {
  sessionId: string;
  /** Absolute path to the worktree (or repo) root — used to resolve file paths. */
  repoPath?: string;
  /** Whether the session has a worktree (enables Merge/Discard buttons). */
  hasWorktree?: boolean;
  title?: string;
}

type LineType = DiffLineType;
type DiffLine = DiffRendererLine;
type DiffFile = DiffRendererFile;

const LINE_CLASSES: Record<LineType, string> = {
  file: "bg-blue-500/10 text-blue-300",
  hunk: "bg-yellow-500/10 text-yellow-300",
  add: "bg-green-500/10 text-green-300",
  remove: "bg-red-500/10 text-red-300",
  context: "text-text-2",
};

const SessionDiffWindow: React.FC<SessionDiffWindowProps> = ({
  sessionId,
  repoPath,
  hasWorktree = false,
  title,
}) => {
  const { t } = useTranslation("sessions");
  const [rawDiff, setRawDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFileIdx, setSelectedFileIdx] = useState<number>(0);
  const [mergeStatus, setMergeStatus] = useState<
    "idle" | "merging" | "merged" | "error"
  >("idle");
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    let cancelled = false;

    SessionService.sessionDiff(sessionId)
      .then((diff) => {
        if (!cancelled) {
          setRawDiff(diff);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const { lines, files } = useMemo<{ lines: DiffLine[]; files: DiffFile[] }>(
    () => (rawDiff ? parseWorktreeDiff(rawDiff) : { lines: [], files: [] }),
    [rawDiff]
  );

  // Clear stale refs whenever the diff changes so the Map never holds
  // references to unmounted DOM nodes from a previous load.
  useEffect(() => {
    lineRefs.current.clear();
  }, [rawDiff]);

  const isEmpty = !loading && !error && lines.length === 0;

  const handleFileClick = (fileIdx: number) => {
    setSelectedFileIdx(fileIdx);
    const file = files[fileIdx];
    if (!file) return;
    const el = lineRefs.current.get(file.lineIndex);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openLineInEditor = useCallback(
    async (line: DiffLine, fileIdx: number | undefined) => {
      if (!isTauriDesktop()) return;
      const idx = fileIdx ?? selectedFileIdx;
      const file = files[idx];
      if (!file) return;

      const root = repoPath ?? "";
      const absolutePath = root
        ? `${root.replace(/\/+$/, "")}/${file.name.replace(/^\/+/, "")}`
        : file.name;

      await emit("orgii:open-file-in-editor", {
        path: absolutePath,
        line: line.newLine,
      });
    },
    [files, repoPath, selectedFileIdx]
  );

  const handleMerge = useCallback(async () => {
    if (mergeStatus === "merging") return;
    setMergeStatus("merging");
    setMergeError(null);
    try {
      await SessionService.merge({ sessionId, strategy: "auto" });
      setMergeStatus("merged");
    } catch (err) {
      setMergeStatus("error");
      setMergeError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId, mergeStatus]);

  const handleDiscard = useCallback(async () => {
    if (discarding) return;
    const { ask } = await import("@tauri-apps/plugin-dialog");
    const confirmed = await ask(t("opsControl.discard.confirmMessage"), {
      kind: "warning",
      okLabel: t("opsControl.discard.discard"),
      cancelLabel: t("common:actions.cancel"),
    });
    if (!confirmed) return;
    setDiscarding(true);
    try {
      await SessionService.worktreeDiscard(sessionId);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscarding(false);
    }
  }, [sessionId, discarding, t]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-1">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border-2 px-4 py-2">
        <span className="text-[13px] font-medium text-text-1">
          {title ?? t("opsControl.diff.windowTitle")}
        </span>
        <span className="truncate text-[11px] text-text-3">{sessionId}</span>
        {files.length > 0 && (
          <span className="ml-auto shrink-0 text-[11px] text-text-3">
            {files.length} {files.length === 1 ? "file" : "files"} changed
          </span>
        )}

        {/* G4: quick Merge/Discard actions for worktree sessions */}
        {hasWorktree && (
          <div className="ml-2 flex shrink-0 items-center gap-1">
            {mergeStatus === "merged" ? (
              <span className="flex items-center gap-1 text-[12px] text-green-400">
                <Check size={13} strokeWidth={2} />
                {t("opsControl.merge.merged")}
              </span>
            ) : (
              <Button
                size="mini"
                variant="tertiary"
                icon={<GitMerge size={13} strokeWidth={1.75} />}
                onClick={() => void handleMerge()}
                disabled={mergeStatus === "merging"}
              >
                {mergeStatus === "merging"
                  ? t("opsControl.merge.merging")
                  : t("opsControl.merge.merge")}
              </Button>
            )}
            <Button
              size="mini"
              variant="danger"
              appearance="ghost"
              icon={<Trash2 size={13} strokeWidth={1.75} />}
              onClick={() => void handleDiscard()}
              disabled={discarding || mergeStatus === "merged"}
            >
              {discarding
                ? t("opsControl.discard.discarding")
                : t("opsControl.discard.discard")}
            </Button>
          </div>
        )}
      </div>

      {mergeError && (
        <div className="shrink-0 bg-red-500/10 px-4 py-1.5 text-[12px] text-red-400">
          {mergeError}
        </div>
      )}

      {/* Content */}
      {loading && <Placeholder variant="loading" placement="detail-panel" />}

      {error && (
        <div className="flex h-full items-center justify-center">
          <Placeholder
            variant="error"
            placement="detail-panel"
            title={t("opsControl.merge.failedToLoadDiff")}
            subtitle={error}
          />
        </div>
      )}

      {isEmpty && (
        <div className="flex h-full items-center justify-center">
          <Placeholder
            variant="empty"
            placement="detail-panel"
            title={t("opsControl.merge.noChanges")}
          />
        </div>
      )}

      {!loading && !error && lines.length > 0 && (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* File tree sidebar */}
          <div className="scrollbar-overlay flex w-[220px] flex-shrink-0 flex-col overflow-y-auto border-r border-border-2">
            <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-text-3">
              {t("opsControl.diff.filesChanged")}
            </div>
            {files.map((file, idx) => {
              const isSelected = idx === selectedFileIdx;
              return (
                <button
                  key={idx}
                  onClick={() => handleFileClick(idx)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
                    isSelected
                      ? "bg-fill-2 text-text-1"
                      : "text-text-2 hover:bg-fill-1 hover:text-text-1"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="flex shrink-0 gap-1 text-[10px]">
                    {file.addCount > 0 && (
                      <span className="text-green-400">+{file.addCount}</span>
                    )}
                    {file.removeCount > 0 && (
                      <span className="text-red-400">-{file.removeCount}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Diff viewer — double-click any line to open in editor (G5) */}
          <div className="scrollbar-overlay min-w-0 flex-1 overflow-auto">
            <div className="whitespace-pre px-2 py-2 text-[12px] leading-5">
              {lines.map((line, idx) => (
                <div
                  key={idx}
                  ref={(el) => {
                    if (el) lineRefs.current.set(idx, el);
                    else lineRefs.current.delete(idx);
                  }}
                  onDoubleClick={() => {
                    void openLineInEditor(line, line.fileIndex);
                  }}
                  title={
                    line.newLine !== undefined
                      ? `Line ${line.newLine} — double-click to open in editor`
                      : undefined
                  }
                  className={`cursor-default rounded px-2 ${LINE_CLASSES[line.type]} ${
                    line.type !== "file" ? "hover:brightness-110" : ""
                  }`}
                >
                  {line.content || "\u00A0"}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SessionDiffWindow;
