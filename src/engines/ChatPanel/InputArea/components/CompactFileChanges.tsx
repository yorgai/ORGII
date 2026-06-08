/**
 * CompactFileChanges
 *
 * Inline collapsible file changes section above InputArea.
 * Shows changed files with diff stats from session events.
 * Includes batch Undo All / Keep All / Review actions when snapshots are available.
 * Per-file reject/accept on hover.
 *
 * Visibility rules:
 * - Hidden when pendingCount === 0 (no active snapshots — covers: no edits yet,
 *   after Undo All, after Keep All, after session re-entry with cleared snapshots)
 * - Hidden when every file has been individually resolved (visibleFiles.length === 0)
 * - Visible only while the agent has pending snapshots in fileReviewMapAtom
 *
 * Data source:
 * - File list: derived from sortedEventsAtom when tool-call events are available.
 * - CLI sessions without file-edit events fall back to backend file-history snapshots.
 * - Snapshot count / earliest hash: fileReviewMapAtom (loaded by useFileReviewSync).
 *
 * State management:
 * - `pendingCount` is the single source of truth for panel visibility.
 * - `resolvedFilePathsAtom` (Jotai): tracks per-file accept/reject, survives component unmount.
 * - Both are reset when sessionId changes (via clearFileReviewAtom).
 */
import { useAtomValue, useSetAtom } from "jotai";
import { Check, Diff, RotateCcw, RotateCw } from "lucide-react";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  resolveReview,
  revertFileReview,
  saveFileResolution,
} from "@src/api/tauri/agent";
import Button from "@src/components/Button";
import {
  CHAT_COMPOSER_STACK_BAR_INNER_PADDING_X_CLASS,
  CHAT_COMPOSER_STACK_BAR_SURFACE_BG_CLASS,
} from "@src/config/composerStackTokens";
import { ROUTES } from "@src/config/routes";
import { useGitStatus } from "@src/contexts/git";
import { useChatSessionId } from "@src/engines/ChatPanel/ChatSessionContext";
import { sessionIdAtom } from "@src/engines/SessionCore";
import { useFileReviewBatchActions } from "@src/hooks/fileReview";
import { createLogger } from "@src/hooks/logger";
import { FileOperationsService } from "@src/services/file/FileOperationsService";
import { EditorTabService } from "@src/services/workStation";
import {
  earliestPendingSnapshotAtom,
  fileReviewWorkspacePathAtom,
  resolveFileAtom,
} from "@src/store/session/fileReviewAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { createSourceControlTab } from "@src/store/workstation/tabs";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

import ComposerStackHeader from "./ComposerStackHeader";
import FileChangeRow from "./FileChangeRow";
import type { FileChangesResult } from "./compactFileChangesHelpers";
import { useCompactFileData } from "./useCompactFileData";

export type {
  FileChangeInfo,
  FileChangesResult,
} from "./compactFileChangesHelpers";

const logger = createLogger("CompactFileChanges");

export interface FileChangeVisibleStats {
  count: number;
  additions: number;
  deletions: number;
}

interface CompactFileChangesProps {
  /** When provided, renders with this static data instead of fetching from the session. */
  initialData?: FileChangesResult;
  /** Called when the user closes the card (header collapse button). */
  onToggle: () => void;
  /** Reports the current visible file stats to the parent (0 when hidden). */
  onVisibleStatsChange?: (stats: FileChangeVisibleStats) => void;
  /** When true, keeps the component mounted (for count tracking) but renders nothing visible. */
  hidden?: boolean;
}

const CompactFileChanges: React.FC<CompactFileChangesProps> = memo(
  ({ initialData, onToggle, onVisibleStatsChange, hidden }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { forceRefresh: refreshGitStatus } = useGitStatus();
    const stationMode = useAtomValue(stationModeAtom);
    const setStationMode = useSetAtom(stationModeAtom);
    const contextSessionId = useChatSessionId();
    const globalSessionId = useAtomValue(sessionIdAtom);
    const sessionId = contextSessionId ?? globalSessionId;
    const earliestSnapshot = useAtomValue(earliestPendingSnapshotAtom);
    const workspacePath = useAtomValue(fileReviewWorkspacePathAtom);
    const dispatchResolveFile = useSetAtom(resolveFileAtom);

    const { pendingCount, redoSnapshotAnchors, onUndoAll, onKeepAll, onRedo } =
      useFileReviewBatchActions(sessionId);
    const [isUndoingAll, setIsUndoingAll] = useState(false);
    const [isRedoing, setIsRedoing] = useState(false);

    const canRedo = redoSnapshotAnchors.length > 0;

    const { allFiles, visibleFiles, hasCompletedFileWriteEvent } =
      useCompactFileData({
        sessionId,
        initialData,
      });

    const hasPendingActions = pendingCount > 0;
    const hasReviewableFileWrite =
      hasCompletedFileWriteEvent || allFiles.length > 0;
    const batchActionsDisabled = hasPendingActions && !hasReviewableFileWrite;

    // ============================================
    // Handlers
    // ============================================

    const handleUndoAll = useCallback(async () => {
      if (batchActionsDisabled) return;
      const confirmed = await confirmDestructiveAction({
        title: t("actions.undoAll"),
        message: t("confirmation.undoAllChanges", { count: pendingCount }),
        okLabel: t("actions.undoAll"),
        cancelLabel: t("actions.cancel"),
      });
      if (!confirmed) return;
      setIsUndoingAll(true);
      try {
        await onUndoAll();
        refreshGitStatus().catch(() => {});
      } finally {
        setIsUndoingAll(false);
      }
    }, [batchActionsDisabled, t, pendingCount, onUndoAll, refreshGitStatus]);

    const handleKeepAll = useCallback(() => {
      if (batchActionsDisabled) return;
      void onKeepAll().catch((error: unknown) => {
        logger.error("Keep all failed:", error);
      });
    }, [batchActionsDisabled, onKeepAll]);

    const handleRedo = useCallback(async () => {
      if (batchActionsDisabled) return;
      const confirmed = await confirmDestructiveAction({
        title: t("actions.redoAll"),
        message: t("confirmation.redoAllChanges"),
        okLabel: t("actions.redoAll"),
        cancelLabel: t("actions.cancel"),
      });
      if (!confirmed) return;
      setIsRedoing(true);
      try {
        await onRedo();
        refreshGitStatus().catch(() => {});
      } finally {
        setIsRedoing(false);
      }
    }, [batchActionsDisabled, t, onRedo, refreshGitStatus]);

    // The Code Editor pins a unified Source Control (`source-control`) tab.
    // In Agent Station mode the simulator renders a lightweight Session Replay
    // IDE — not the full Code Editor — so `setSelectedSimApp(CODE_EDITOR)`
    // would land on the wrong page. Instead, switch to My Station and navigate
    // to the Code Editor route, then open the Source Control tab once the full
    // Code Editor has mounted (deferred to allow React to commit the navigation).
    // In My Station mode the full Code Editor is already visible; just open the
    // tab directly without any routing change.
    const handleReview = useCallback(() => {
      if (batchActionsDisabled) return;
      if (stationMode === "agent-station") {
        setStationMode("my-station");
      }
      navigate(ROUTES.workStation.code.path);
      const fileCount = visibleFiles.length;
      setTimeout(() => {
        EditorTabService.openTab(createSourceControlTab(fileCount));
      }, 0);
    }, [
      batchActionsDisabled,
      stationMode,
      setStationMode,
      navigate,
      visibleFiles.length,
    ]);

    const handleFileClick = useCallback((filePath: string) => {
      FileOperationsService.open(filePath).catch((err: unknown) => {
        logger.warn("Failed to open file:", err);
      });
    }, []);

    const handleFileReject = useCallback(
      async (filePath: string) => {
        if (batchActionsDisabled || !earliestSnapshot || !workspacePath) return;
        if (!sessionId) {
          logger.warn("No sessionId; cannot revert");
          return;
        }
        try {
          const success = await revertFileReview(
            sessionId,
            earliestSnapshot.createdAt,
            filePath,
            workspacePath
          );
          if (!success) {
            logger.warn("Revert returned false for:", filePath);
            return;
          }
          dispatchResolveFile({ path: filePath, resolution: "rejected" });
          refreshGitStatus().catch(() => {});
          saveFileResolution(sessionId, filePath, "rejected").catch(
            (err: unknown) => logger.warn("Persist reject failed:", err)
          );
        } catch (error) {
          logger.error("Revert file failed:", error);
        }
      },
      [
        batchActionsDisabled,
        earliestSnapshot,
        workspacePath,
        sessionId,
        dispatchResolveFile,
        refreshGitStatus,
      ]
    );

    const handleFileAccept = useCallback(
      (filePath: string) => {
        if (batchActionsDisabled) return;
        dispatchResolveFile({ path: filePath, resolution: "accepted" });
        if (sessionId) {
          saveFileResolution(sessionId, filePath, "accepted").catch(
            (err: unknown) => logger.warn("Persist accept failed:", err)
          );
        }
      },
      [batchActionsDisabled, sessionId, dispatchResolveFile]
    );

    // Persist resolution when all files have been individually resolved
    const allResolvedRef = useRef(false);
    useEffect(() => {
      if (
        allFiles.length > 0 &&
        visibleFiles.length === 0 &&
        sessionId &&
        !allResolvedRef.current
      ) {
        allResolvedRef.current = true;
        resolveReview(sessionId).catch((err: unknown) =>
          logger.warn("resolve_review:", err)
        );
      }
      if (visibleFiles.length > 0) {
        allResolvedRef.current = false;
      }
    }, [allFiles.length, visibleFiles.length, sessionId]);

    // ============================================
    // Visibility
    // ============================================

    const shouldShowFileActions = hasPendingActions || canRedo;
    const visibleStatFiles = shouldShowFileActions ? visibleFiles : [];
    const isHidden = !shouldShowFileActions || visibleStatFiles.length === 0;
    const visibleStats = useMemo<FileChangeVisibleStats>(() => {
      if (isHidden) return { count: 0, additions: 0, deletions: 0 };
      return visibleStatFiles.reduce<FileChangeVisibleStats>(
        (stats, file) => ({
          count: stats.count + 1,
          additions: stats.additions + file.additions,
          deletions: stats.deletions + file.deletions,
        }),
        { count: 0, additions: 0, deletions: 0 }
      );
    }, [isHidden, visibleStatFiles]);

    useEffect(() => {
      onVisibleStatsChange?.(visibleStats);
    }, [visibleStats, onVisibleStatsChange]);

    if (isHidden || hidden) {
      return null;
    }

    return (
      <div
        className={`${CHAT_COMPOSER_STACK_BAR_SURFACE_BG_CLASS} overflow-hidden rounded-lg border border-solid border-border-2`}
      >
        <ComposerStackHeader
          icon={<Diff size={14} />}
          label={t("labels.fileCount", { count: visibleFiles.length })}
          actions={
            <span className="flex items-center gap-0.5">
              {hasPendingActions && (
                <Button
                  variant="tertiary"
                  size="mini"
                  icon={<RotateCcw size={11} />}
                  onClick={handleUndoAll}
                  disabled={batchActionsDisabled || isUndoingAll}
                  title={t("actions.undoAll")}
                  data-testid="file-changes-undo-all"
                >
                  {t("actions.undoAll")}
                </Button>
              )}
              <Button
                variant="tertiary"
                size="mini"
                icon={<RotateCw size={11} />}
                onClick={handleRedo}
                disabled={batchActionsDisabled || !canRedo || isRedoing}
                title={t("actions.redoAll")}
                data-testid="file-changes-redo-all"
              >
                {t("actions.redoAll")}
              </Button>
              {hasPendingActions && (
                <Button
                  variant="tertiary"
                  size="mini"
                  icon={<Check size={11} />}
                  onClick={handleKeepAll}
                  disabled={batchActionsDisabled}
                  title={t("actions.keepAll")}
                  data-testid="file-changes-keep-all"
                >
                  {t("actions.keepAll")}
                </Button>
              )}
              {hasPendingActions && (
                <Button
                  variant="tertiary"
                  size="mini"
                  onClick={handleReview}
                  disabled={batchActionsDisabled}
                  data-testid="file-changes-review"
                >
                  {t("actions.review")}
                </Button>
              )}
            </span>
          }
          expanded={true}
          onToggle={onToggle}
        />
        <div
          className={`${CHAT_COMPOSER_STACK_BAR_INNER_PADDING_X_CLASS} max-h-[192px] overflow-y-auto pb-1`}
        >
          {visibleFiles.map((file) => (
            <FileChangeRow
              key={file.path}
              file={file}
              hasPendingActions={hasPendingActions}
              batchActionsDisabled={batchActionsDisabled}
              onFileClick={handleFileClick}
              onFileReject={handleFileReject}
              onFileAccept={handleFileAccept}
            />
          ))}
        </div>
      </div>
    );
  }
);

CompactFileChanges.displayName = "CompactFileChanges";

export default CompactFileChanges;
