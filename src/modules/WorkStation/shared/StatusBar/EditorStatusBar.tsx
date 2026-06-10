import { useAtomValue } from "jotai";
import {
  ArrowDown,
  ArrowUp,
  Braces,
  Check,
  CloudUpload,
  Code,
  FolderTree,
  GitBranch,
  GitCommit,
  Loader2,
  RefreshCw,
  Unplug,
  X,
} from "lucide-react";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { SPINNER_TOKENS } from "@src/config/spinnerTokens";
import { useRepoGitInitialization } from "@src/hooks/git";
import { currentRepoAtom } from "@src/store/repo";
import { diagnosticHealthAtom } from "@src/store/workstation/codeEditor/diagnostics";
import {
  indexingProgressAtom,
  isIndexingAtom,
} from "@src/store/workstation/codeEditor/search/indexingProgressAtom";
import { getViewportSize } from "@src/util/ui/window/viewport";

import {
  BaseStatusBar,
  StatusBarButton,
  StatusBarDivider,
  StatusBarSegment,
  StatusBarText,
} from "./StatusBarBase";
import type { EditorStatusBarProps, PanelRow } from "./types";
import {
  countActiveLanguageServiceSources,
  diagnosticSourceStatusLabel,
  diagnosticStatusToUi,
  getLanguageFromPath,
  mergeLspByBaseLanguage,
} from "./utils/statusBarUtils";
import { useEditorStatusBarGit } from "./utils/useEditorStatusBarGit";

export type {
  CommitInfo,
  CursorPosition,
  EditorStatusBarProps,
  LspStatus,
} from "./types";

export const EditorStatusBar: React.FC<EditorStatusBarProps> = memo(
  ({
    cursor,
    filePath,
    totalLines,
    repoName,
    branchName,
    commitInfo,
    lspStatus,
    onRepoClick,
    onBranchClick,
    className = "",
  }) => {
    const { t } = useTranslation();
    const language = getLanguageFromPath(filePath);
    const hasSelection = cursor?.selectedChars && cursor.selectedChars > 0;

    const {
      workspaceLabel,
      workspaceTooltip,
      isMultiRoot,
      aheadCount,
      behindCount,
      needsPublish,
      isSyncBusy,
      isPublishing,
      syncSpinClass,
      handleSyncClick,
      checkoutLoading,
    } = useEditorStatusBarGit({ repoName, branchName });

    const currentRepo = useAtomValue(currentRepoAtom);
    const repoPath = currentRepo?.path ?? currentRepo?.fs_uri;
    const { isGitInitialized } = useRepoGitInitialization(repoPath);
    const showGitControls = isGitInitialized === true;

    const diagnosticHealth = useAtomValue(diagnosticHealthAtom);
    const activeLanguageServiceCount = useMemo(
      () => countActiveLanguageServiceSources(diagnosticHealth),
      [diagnosticHealth]
    );
    const [lspDropdownOpen, setLspDropdownOpen] = useState(false);
    const lspButtonRef = useRef<HTMLDivElement>(null);
    const [lspDropdownPosition, setLspDropdownPosition] = useState<{
      bottom: number;
      right: number;
    } | null>(null);

    const handleToggleLspDropdown = useCallback(() => {
      if (lspDropdownOpen) {
        setLspDropdownOpen(false);
        setLspDropdownPosition(null);
      } else {
        setLspDropdownOpen(true);
        if (lspButtonRef.current) {
          const rect = lspButtonRef.current.getBoundingClientRect();
          const { width: vw, height: vh } = getViewportSize();
          setLspDropdownPosition({
            bottom: vh - rect.top + 4,
            right: vw - rect.right,
          });
        }
      }
    }, [lspDropdownOpen]);

    const handleCloseLspDropdown = useCallback(() => {
      setLspDropdownOpen(false);
      setLspDropdownPosition(null);
    }, []);

    const isIndexingActive = useAtomValue(isIndexingAtom);
    const indexingProgress = useAtomValue(indexingProgressAtom);

    const [hideTimerActive, setHideTimerActive] = useState(false);

    useEffect(() => {
      if (!isIndexingActive) return;
      return () => {
        setHideTimerActive(true);
      };
    }, [isIndexingActive]);

    useEffect(() => {
      if (!hideTimerActive) return;
      const timer = setTimeout(() => setHideTimerActive(false), 10_000);
      return () => clearTimeout(timer);
    }, [hideTimerActive]);

    const showIndexingIndicator = isIndexingActive || hideTimerActive;

    const leftContent = useMemo(
      () => (
        <>
          {repoName && (
            <StatusBarButton onClick={onRepoClick} title={workspaceTooltip}>
              {isMultiRoot ? (
                <FolderTree size={13} className="text-text-1" />
              ) : (
                <Code size={13} className="text-text-1" />
              )}
              <span className="font-medium text-text-1">{workspaceLabel}</span>
            </StatusBarButton>
          )}

          {repoName && isGitInitialized === false && (
            <StatusBarSegment
              className="text-text-2"
              title={t("workstation.notGitInitializedTooltip")}
            >
              <GitBranch size={13} className="text-text-2" />
              <span className="font-medium text-text-2">
                {t("workstation.notGitInitialized")}
              </span>
            </StatusBarSegment>
          )}

          {showGitControls && branchName && (
            <StatusBarButton
              onClick={onBranchClick}
              title={
                checkoutLoading
                  ? t("workstation.branchTooltipSwitching", {
                      branch: branchName,
                    })
                  : t("workstation.branchTooltip", { branch: branchName })
              }
            >
              {checkoutLoading ? (
                <Loader2
                  size={SPINNER_TOKENS.small}
                  className="animate-spin text-text-1"
                />
              ) : (
                <GitBranch size={13} className="text-text-1" />
              )}
              <span className="font-medium text-text-1">{branchName}</span>
            </StatusBarButton>
          )}

          {showGitControls && branchName && (
            <StatusBarButton
              onClick={handleSyncClick}
              disabled={isSyncBusy}
              title={
                needsPublish
                  ? t("workstation.publishBranchToOrigin", {
                      branch: branchName,
                    })
                  : behindCount > 0 || aheadCount > 0
                    ? t("workstation.syncWithRemote", {
                        behind: behindCount,
                        ahead: aheadCount,
                      })
                    : t("workstation.refreshGitStatus")
              }
              className="gap-2"
            >
              {needsPublish && !isPublishing ? (
                <CloudUpload size={13} className="text-text-1" />
              ) : (
                <RefreshCw
                  size={13}
                  className={`text-text-1 ${syncSpinClass ?? ""}`}
                />
              )}
              {needsPublish && !isPublishing && (
                <span className="font-medium text-text-1">
                  {t("git.actions.publish")}
                </span>
              )}
              {isPublishing && (
                <span className="font-medium text-text-1">
                  {t("workstation.publishingBranch")}
                </span>
              )}
              {!needsPublish && (behindCount > 0 || aheadCount > 0) && (
                <>
                  <span className="flex items-center font-medium text-text-1">
                    {behindCount}
                    <ArrowDown size={13} />
                  </span>
                  <span className="flex items-center font-medium text-text-1">
                    {aheadCount}
                    <ArrowUp size={13} />
                  </span>
                </>
              )}
            </StatusBarButton>
          )}

          {showIndexingIndicator && (
            <StatusBarSegment
              className="text-text-1"
              title={
                indexingProgress.status === "embedding"
                  ? indexingProgress.progress > 0
                    ? t("workstation.embeddingProgressWithPercent", {
                        count: indexingProgress.chunksEmbedded,
                        percent: indexingProgress.progress,
                      })
                    : t("workstation.embeddingProgress", {
                        count: indexingProgress.chunksEmbedded,
                      })
                  : indexingProgress.filesTotal > 0
                    ? indexingProgress.currentFile
                      ? t("workstation.indexingProgressWithFile", {
                          processed: indexingProgress.filesProcessed,
                          total: indexingProgress.filesTotal,
                          percent: indexingProgress.progress,
                          file: indexingProgress.currentFile,
                        })
                      : t("workstation.indexingProgress", {
                          processed: indexingProgress.filesProcessed,
                          total: indexingProgress.filesTotal,
                          percent: indexingProgress.progress,
                        })
                    : t("workstation.scanningFiles")
              }
            >
              <FolderTree
                size={13}
                className={isIndexingActive ? "animate-pulse" : ""}
              />
              <span className="font-medium">
                {indexingProgress.status === "embedding"
                  ? indexingProgress.progress > 0
                    ? t("workstation.embeddingShort", {
                        percent: indexingProgress.progress,
                      })
                    : `${t("workstation.embeddingLabel")}...`
                  : indexingProgress.filesTotal > 0
                    ? `${t("labels.indexing")} ${indexingProgress.filesProcessed}/${indexingProgress.filesTotal}`
                    : `${t("labels.indexing")}...`}
              </span>
            </StatusBarSegment>
          )}
        </>
      ),
      [
        repoName,
        branchName,
        isGitInitialized,
        showGitControls,
        checkoutLoading,
        needsPublish,
        isSyncBusy,
        isPublishing,
        behindCount,
        aheadCount,
        onRepoClick,
        onBranchClick,
        handleSyncClick,
        syncSpinClass,
        showIndexingIndicator,
        isIndexingActive,
        indexingProgress.status,
        indexingProgress.filesProcessed,
        indexingProgress.filesTotal,
        indexingProgress.progress,
        indexingProgress.chunksEmbedded,
        indexingProgress.currentFile,
        isMultiRoot,
        workspaceLabel,
        workspaceTooltip,
        t,
      ]
    );

    const rightContent = useMemo(
      () => (
        <>
          {commitInfo && (
            <StatusBarSegment
              title={`${commitInfo.message}\n\n${commitInfo.author} · ${commitInfo.shortSha}`}
              className="text-text-1"
            >
              <GitCommit size={13} />
              <span className="max-w-[200px] truncate">
                {commitInfo.author}
              </span>
              <span className="text-text-3">·</span>
              <span className="text-text-3">{commitInfo.time}</span>
            </StatusBarSegment>
          )}

          {cursor && (
            <StatusBarText className="tabular-nums">
              Ln {cursor.line}, Col {cursor.column}
            </StatusBarText>
          )}

          {hasSelection && (
            <StatusBarText>
              (
              {cursor?.selectedLines && cursor.selectedLines > 1
                ? t("workstation.linesSelected", {
                    count: cursor.selectedLines,
                  })
                : t("workstation.charsSelected", {
                    count: cursor?.selectedChars ?? 0,
                  })}
              )
            </StatusBarText>
          )}

          {totalLines !== undefined && (
            <StatusBarText>
              {t("workstation.nLines", { count: totalLines })}
            </StatusBarText>
          )}

          {filePath && (
            <div ref={lspButtonRef} className="flex h-full">
              <StatusBarButton
                onClick={handleToggleLspDropdown}
                title={t("workstation.languageServices")}
                active={lspDropdownOpen}
              >
                {diagnosticHealth.hasActiveSource ? (
                  <>
                    <Braces size={12} />
                    <span className="inline-flex items-center gap-1">
                      <span>{lspStatus?.language || "LSP"}</span>
                      <StatusBarDivider />
                      <span>{activeLanguageServiceCount}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <Unplug size={12} />
                    <span>LSP</span>
                  </>
                )}
              </StatusBarButton>
            </div>
          )}

          {filePath && <StatusBarText>{language}</StatusBarText>}
        </>
      ),
      [
        t,
        commitInfo,
        cursor,
        hasSelection,
        totalLines,
        lspStatus,
        filePath,
        language,
        handleToggleLspDropdown,
        lspDropdownOpen,
        diagnosticHealth.hasActiveSource,
        activeLanguageServiceCount,
      ]
    );

    const languageServicePanelRows = useMemo(() => {
      const rows: PanelRow[] = [];

      const mergedLsp = mergeLspByBaseLanguage(diagnosticHealth);

      for (const [lang, entry] of mergedLsp) {
        const statusText = diagnosticSourceStatusLabel(entry.status, t);
        rows.push({
          kind: "pair",
          key: `lsp-${lang}`,
          left: "LSP",
          right: `${lang} · ${statusText}`,
          uiStatus: diagnosticStatusToUi(entry.status),
        });
      }

      if (diagnosticHealth.eslint) {
        const statusText = diagnosticSourceStatusLabel(
          diagnosticHealth.eslint.status,
          t
        );
        rows.push({
          kind: "pair",
          key: "eslint",
          left: "ESLint",
          right: statusText,
          uiStatus: diagnosticStatusToUi(diagnosticHealth.eslint.status),
        });
      }

      if (rows.length === 0) {
        rows.push({
          kind: "empty",
          key: "empty",
          message: t("workstation.noLanguageServicesActive"),
        });
      }

      return rows;
    }, [diagnosticHealth, t]);

    return (
      <>
        <BaseStatusBar
          leftContent={leftContent}
          rightContent={rightContent}
          roundedBottom={false}
          className={className}
        />

        {lspDropdownOpen &&
          lspDropdownPosition &&
          createPortal(
            <>
              <div
                className="fixed inset-0 z-[1049]"
                onClick={handleCloseLspDropdown}
              />
              <div
                className={`${DROPDOWN_CLASSES.panel} fixed p-3 ${DROPDOWN_WIDTHS.panelWidthClass}`}
                style={{
                  bottom: lspDropdownPosition.bottom,
                  right: lspDropdownPosition.right,
                }}
              >
                <div className="space-y-2 text-[13px]">
                  {languageServicePanelRows.map((row) =>
                    row.kind === "empty" ? (
                      <div key={row.key} className="font-bold text-text-3">
                        {row.message}
                      </div>
                    ) : (
                      <div
                        key={row.key}
                        className="flex items-center justify-between gap-3"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          {row.uiStatus === "active" ? (
                            <Check
                              size={14}
                              className="shrink-0 text-green-500"
                            />
                          ) : row.uiStatus === "initializing" ? (
                            <Loader2
                              size={12}
                              className="shrink-0 animate-spin text-text-3"
                            />
                          ) : row.uiStatus === "failed" ? (
                            <X size={14} className="shrink-0 text-red-500" />
                          ) : (
                            <span className="w-3.5 shrink-0" aria-hidden />
                          )}
                          <span className="shrink-0 font-bold text-text-3">
                            {row.left}
                          </span>
                        </div>
                        <span className="min-w-0 shrink-0 text-right font-bold text-text-1">
                          {row.right}
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>
            </>,
            document.body
          )}
      </>
    );
  }
);

EditorStatusBar.displayName = "EditorStatusBar";

export default EditorStatusBar;
