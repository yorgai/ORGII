/**
 * Glob Block — header-only transparent variant for file pattern search.
 *
 * `find_files` / `glob_file_search` render as one header row. The matched file
 * list is visible in the simulator; chat shows the lifecycle title plus the
 * searched file pattern.
 */
import { SearchX } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import FileTypeIcon from "@src/components/FileTypeIcon";
import { getToolIcon } from "@src/config/toolIcons";

import {
  EVENT_BLOCK_TRANSPARENT_EXPANDED_SHELL_CLASSES,
  EventBlockHeader,
  EventBlockHeaderIcon,
  EventBlockHeaderSubtitle,
  EventBlockHeaderTitle,
  getEventBlockContainerClasses,
} from "../primitives";
import { useBlockHeader } from "../useBlockLocate";

export interface GlobBlockProps {
  /** Glob pattern */
  pattern: string;
  /** Whether currently loading */
  isLoading?: boolean;
  /** Optional event ID for simulator replay */
  eventId?: string;
  /**
   * Pre-translated header title for the current state. Adapter resolves via
   * `useLifecycleLabels("code_search", "find_files")` (or `"glob_file_search"`).
   */
  title: string;
  showNoMatch?: boolean;
}

const GlobBlock: React.FC<GlobBlockProps> = React.memo(
  ({ pattern, isLoading = false, eventId, title, showNoMatch = false }) => {
    const { t } = useTranslation("sessions");
    const {
      isHeaderHovered,
      handleHeaderMouseEnter,
      handleHeaderMouseLeave,
      handleLocate,
    } = useBlockHeader({
      defaultCollapsed: true,
      eventId,
      collapseAllValue: false,
      preserveDefaultOnExpand: true,
    });

    return (
      <div className={getEventBlockContainerClasses(false)}>
        <EventBlockHeader
          isCollapsed
          withHover={false}
          onNavigate={handleLocate}
          onMouseEnter={handleHeaderMouseEnter}
          onMouseLeave={handleHeaderMouseLeave}
        >
          <EventBlockHeaderIcon
            icon={getToolIcon("glob_file_search", {
              size: 14,
              className: "text-text-2",
            })}
            isCollapsed
            isHeaderHovered={isHeaderHovered}
            hasContent={showNoMatch}
            revealChevronOnIconHoverOnly={Boolean(eventId)}
            isLoading={isLoading}
          />
          <EventBlockHeaderTitle isLoading={isLoading}>
            {title}
          </EventBlockHeaderTitle>
          {pattern && (
            <EventBlockHeaderSubtitle
              isLoading={isLoading}
              title={pattern}
              className="text-text-1"
            >
              <FileTypeIcon
                fileName={pattern}
                size="small"
                className="mr-1.5 shrink-0"
              />
              <span className="min-w-0 truncate">{pattern}</span>
            </EventBlockHeaderSubtitle>
          )}
        </EventBlockHeader>
        {showNoMatch && !isLoading && (
          <div className="animate-fade-in overflow-hidden">
            <div className={EVENT_BLOCK_TRANSPARENT_EXPANDED_SHELL_CLASSES}>
              <div className="chat-block-content flex items-center gap-2 px-3 py-2 text-text-3">
                <SearchX size={13} className="shrink-0 text-text-4" />
                <span>{t("tools.noMatch")}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);

GlobBlock.displayName = "GlobBlock";

export default GlobBlock;
