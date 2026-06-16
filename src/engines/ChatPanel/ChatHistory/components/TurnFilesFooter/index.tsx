/**
 * TurnFilesFooter
 *
 * The per-round file list shown at the bottom of each chat turn, styled
 * after Cursor's "N Files Changed" card: a header with the file count and a
 * "Review" affordance, a few rows by default, and a "Show N more" expander.
 *
 * Files come from the DB-materialized turn index
 * (`session_turns.modified_files_json`) — pure display, no aggregation here.
 * Renders nothing when the round touched no files.
 */
import { useSetAtom } from "jotai";
import { MoreHorizontal } from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  CHAT_COMPOSER_STACK_BAR_INNER_PADDING_X_CLASS,
  CHAT_COMPOSER_STACK_BAR_SURFACE_BG_CLASS,
  COMPOSER_STACK_ROW_BASE,
  COMPOSER_STACK_ROW_HOVER,
} from "@src/config/composerStackTokens";
import FileChangeRow from "@src/engines/ChatPanel/InputArea/components/FileChangeRow";
import { replayModeAtom } from "@src/engines/SessionCore";
import type { TurnModifiedFile } from "@src/engines/SessionCore/storage/sqliteCache";
import { AppType } from "@src/engines/Simulator/types/appTypes";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanelAtom";
import {
  STATION_MODE,
  bumpSimulatorDiffRefreshNonceAtom,
  simulatorDiffScopeRequestAtom,
  simulatorSelectedAppAtom,
  stationModeAtom,
} from "@src/store/ui/simulatorAtom";

import { mapTurnModifiedFilesToFileChanges } from "./turnFilesMapping";

/** Rows shown before the "Show N more" expander (matches Cursor's card). */
const DEFAULT_VISIBLE_ROWS = 4;

/** Monotonic counter so each open bumps the scope `nonce` (re-focus on re-click). */
let diffScopeNonce = 0;

export interface TurnFilesFooterProps {
  modifiedFiles: readonly TurnModifiedFile[] | undefined;
  /** The round's session — scopes the Diff filter to this session. */
  sessionId?: string | null;
  /** The round's turn id — carried on the scope request for traceability. */
  turnId?: string | null;
}

const TurnFilesFooter: React.FC<TurnFilesFooterProps> = memo(
  ({ modifiedFiles, sessionId, turnId }) => {
    const { t } = useTranslation("sessions");
    const [expanded, setExpanded] = useState(false);

    const setStationMode = useSetAtom(stationModeAtom);
    const setSelectedSimulatorApp = useSetAtom(simulatorSelectedAppAtom);
    const setReplayMode = useSetAtom(replayModeAtom);
    const setChatPanelMaximized = useSetAtom(chatPanelMaximizedAtom);
    const setDiffScope = useSetAtom(simulatorDiffScopeRequestAtom);
    const refreshDiff = useSetAtom(bumpSimulatorDiffRefreshNonceAtom);

    const files = useMemo(
      () => mapTurnModifiedFilesToFileChanges(modifiedFiles),
      [modifiedFiles]
    );

    // Mirror ChatView's `openAgentStationDiff` so the card can route to the
    // Agent Station Diff app without prop-threading a callback down here, but
    // first publish a per-round scope so the Diff app narrows to just this
    // round's files. `selectedPath` (a clicked row) is scrolled into view.
    const openDiff = useCallback(
      (selectedPath?: string | null) => {
        setDiffScope({
          sessionId: sessionId ?? null,
          turnId: turnId ?? null,
          filePaths: files.map((file) => file.path),
          selectedPath: selectedPath ?? null,
          nonce: ++diffScopeNonce,
        });
        // Force the Diff app to re-read its canonical diffs so a file edited
        // in this round shows its latest content, not a stale cached diff.
        refreshDiff();
        setChatPanelMaximized(false);
        setStationMode(STATION_MODE.AGENT_STATION);
        setSelectedSimulatorApp(AppType.DIFF);
        setReplayMode("replay");
      },
      [
        files,
        sessionId,
        turnId,
        setDiffScope,
        refreshDiff,
        setChatPanelMaximized,
        setReplayMode,
        setSelectedSimulatorApp,
        setStationMode,
      ]
    );

    const handleReviewClick = useCallback(() => openDiff(), [openDiff]);

    const visibleFiles = expanded
      ? files
      : files.slice(0, DEFAULT_VISIBLE_ROWS);
    const hiddenCount = files.length - visibleFiles.length;

    if (files.length === 0) return null;

    return (
      <div className="px-3 pt-2">
        <div
          className={`${CHAT_COMPOSER_STACK_BAR_SURFACE_BG_CLASS} overflow-hidden rounded-lg border border-solid border-border-2`}
        >
          <div className="flex h-8 items-center justify-between gap-2 px-2.5">
            <span className="min-w-0 truncate text-[13px] font-medium text-text-2">
              {t("chat.turnFiles.filesChangedCount", {
                count: files.length,
                defaultValue: "{{count}} Files Changed",
              })}
            </span>
            <button
              onClick={handleReviewClick}
              className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-medium text-text-3 transition-colors hover:text-text-1"
            >
              {t("chat.turnFiles.review", { defaultValue: "Review" })}
            </button>
          </div>

          <div
            className={`${CHAT_COMPOSER_STACK_BAR_INNER_PADDING_X_CLASS} max-h-[280px] overflow-y-auto pb-1`}
          >
            {visibleFiles.map((file) => (
              <FileChangeRow
                key={file.path}
                file={file}
                onFileClick={openDiff}
              />
            ))}

            {(hiddenCount > 0 || expanded) &&
              files.length > DEFAULT_VISIBLE_ROWS && (
                <button
                  onClick={() => setExpanded((prev) => !prev)}
                  className={`${COMPOSER_STACK_ROW_BASE} ${COMPOSER_STACK_ROW_HOVER} w-full cursor-pointer border-0 bg-transparent text-left text-text-3`}
                >
                  <MoreHorizontal size={14} className="shrink-0" />
                  <span className="chat-block-title truncate">
                    {expanded
                      ? t("chat.turnFiles.showLess", {
                          defaultValue: "Show less",
                        })
                      : t("chat.turnFiles.showMore", {
                          count: hiddenCount,
                          defaultValue: "Show {{count}} more",
                        })}
                  </span>
                </button>
              )}
          </div>
        </div>
      </div>
    );
  }
);

TurnFilesFooter.displayName = "TurnFilesFooter";

export default TurnFilesFooter;
