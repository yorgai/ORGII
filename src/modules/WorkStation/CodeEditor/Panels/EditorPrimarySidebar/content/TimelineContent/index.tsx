/**
 * TimelineContent Component
 *
 * Displays Git commit history for the currently selected file.
 * Similar to VSCode's Timeline view in the left sidebar.
 */
import React, { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { SURFACE_TOKENS } from "@src/config/surfaceTokens";
import { useFileHistory } from "@src/hooks/git/useFileHistory";
import { getBasename } from "@src/modules/WorkStation/CodeEditor/SessionReplay/CodePanel/pathUtils";
import {
  HEADER_BUTTON,
  PRIMARY_SIDEBAR_HOVER,
} from "@src/modules/WorkStation/shared/tokens";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

import { TIMELINE_CONSTANTS, TIMELINE_ICONS } from "./config";
import type { TimelineCommitInfo, TimelineContentProps } from "./types";

// ============================================
// Timeline Entry Component
// ============================================

interface TimelineEntryProps {
  commitSha: string;
  shortSha: string;
  message: string;
  author: string;
  timestamp: string;
  isSelected?: boolean;
  onClick: () => void;
}

const TimelineEntry: React.FC<TimelineEntryProps> = memo(
  ({
    shortSha,
    message,
    author,
    timestamp,
    isSelected = false,
    onClick,
    commitSha: _commitSha,
  }) => {
    const { t } = useTranslation();
    const CommitIcon = TIMELINE_ICONS.commit;
    const OpenIcon = TIMELINE_ICONS.openDiff;

    return (
      <div
        className={`group/timeline-item flex cursor-pointer items-start gap-1.5 px-4 py-1.5 pr-3 transition-colors ${
          isSelected
            ? `${SURFACE_TOKENS.selected} ${PRIMARY_SIDEBAR_HOVER.selectedRow}`
            : PRIMARY_SIDEBAR_HOVER.row
        }`}
        onClick={onClick}
      >
        {/* Git commit icon - aligned with header chevron */}
        <div className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          <CommitIcon size={14} className="text-text-3" />
        </div>

        {/* Commit info - two lines only */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Line 1: Commit message */}
          <div
            className={`truncate text-[13px] ${isSelected ? "font-medium text-text-1" : "text-text-2"}`}
            title={message}
          >
            {message}
          </div>

          {/* Line 2: time · name · id */}
          <div className="truncate text-[11px] text-text-3">
            {formatRelativeTime(timestamp, "compact")} · {author} · {shortSha}
          </div>
        </div>

        {/* Open diff button - show only on hover, doesn't take space when hidden */}
        <button
          className={`${HEADER_BUTTON.actionTreeRow} hidden flex-shrink-0 group-hover/timeline-item:flex`}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          title={t("tooltips.openDiff")}
        >
          <OpenIcon size={14} />
        </button>
      </div>
    );
  }
);

TimelineEntry.displayName = "TimelineEntry";

// ============================================
// Main Component
// ============================================

export const TimelineContent: React.FC<TimelineContentProps> = memo(
  ({
    repoId,
    filePath,
    selectedCommitSha,
    onCommitClick,
    loading: _parentLoading = false,
  }) => {
    const { t } = useTranslation();
    // Convert absolute file path to relative path (Git API expects relative paths)
    const relativeFilePath = React.useMemo(() => {
      if (!filePath || !repoId) return null;

      // If filePath starts with repoId, remove it to get relative path
      if (filePath.startsWith(repoId)) {
        const relative = filePath.slice(repoId.length);
        return relative.startsWith("/") ? relative.slice(1) : relative;
      }

      // If already relative, use as-is
      return filePath;
    }, [filePath, repoId]);

    // Fetch file history
    const { commits, loading, error } = useFileHistory({
      repoId,
      filePath: relativeFilePath,
      limit: TIMELINE_CONSTANTS.MAX_COMMITS,
      autoLoad: true,
    });

    // Handle commit click (use original absolute path for opening diff)
    const handleCommitClick = useCallback(
      (commitInfo: TimelineCommitInfo) => {
        if (filePath && onCommitClick) {
          onCommitClick(commitInfo.sha, filePath, commitInfo);
        }
      },
      [filePath, onCommitClick]
    );

    // Empty state - no file selected
    if (!filePath || !relativeFilePath) {
      return (
        <Placeholder
          variant="empty"
          title={t("placeholders.selectFileToViewChanges")}
        />
      );
    }

    // Loading state
    if (loading) {
      return (
        <Placeholder
          variant="loading"
          title={t("placeholders.loadingHistory")}
        />
      );
    }

    // Error state
    if (error) {
      return (
        <Placeholder
          variant="error"
          title={t("placeholders.failedToLoadHistory")}
          subtitle={error}
        />
      );
    }

    // No commits found
    if (commits.length === 0) {
      return (
        <Placeholder
          variant="empty"
          title={t("placeholders.noGitHistory")}
          subtitle={`${getBasename(filePath)} is not tracked by Git`}
        />
      );
    }

    // Render timeline entries
    return (
      <div className="h-full overflow-y-auto pb-2 scrollbar-hide">
        {commits.map((commit) => {
          // Extract only the first SHA if multiple are concatenated (backend bug workaround)
          const cleanSha = commit.sha.split(/[\s\n]/)[0];
          const isSelected = selectedCommitSha === cleanSha;

          const commitInfo: TimelineCommitInfo = {
            sha: cleanSha,
            shortSha: commit.short_sha,
            message: commit.summary,
            author: commit.author.name,
            timestamp: commit.author.date,
          };

          return (
            <TimelineEntry
              key={cleanSha}
              commitSha={cleanSha}
              shortSha={commit.short_sha}
              message={commit.summary}
              author={commit.author.name}
              timestamp={commit.author.date}
              isSelected={isSelected}
              onClick={() => handleCommitClick(commitInfo)}
            />
          );
        })}
      </div>
    );
  }
);

TimelineContent.displayName = "TimelineContent";

export default TimelineContent;
