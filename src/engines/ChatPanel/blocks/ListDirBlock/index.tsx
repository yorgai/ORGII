/**
 * ListDirBlock — header-only transparent variant for `list_dir`.
 *
 * Renders as a single header row (icon + lifecycle title + directory
 * subtitle), matching the visual shape of `SearchBlock` and `GlobBlock`.
 * The expanded directory listing is reachable in the simulator's Files
 * tab, so chat stays compact for what is usually a high-volume,
 * low-information event.
 */
import { SearchX } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

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

export interface ListDirBlockProps {
  /** Directory path being listed (raw value from the event). */
  dirPath?: string;
  /** Whether the call is still running. */
  isLoading?: boolean;
  /** Optional event ID for simulator replay locate. */
  eventId?: string;
  /**
   * Pre-translated header title for the current state. Adapter resolves via
   * `useLifecycleLabels("list_dir", action)` and picks running / done /
   * failed.
   */
  title: string;
  /** Optional repo-relative target path label for multi-root workspaces. */
  targetPath?: string;
  showNoMatch?: boolean;
}

const ListDirBlock: React.FC<ListDirBlockProps> = React.memo(
  ({
    dirPath,
    isLoading = false,
    eventId,
    title,
    targetPath,
    showNoMatch = false,
  }) => {
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

    // Prefer the formatted repo-relative label; fall back to the raw event
    // path. Hide the subtitle entirely for cwd-only events (`"."`) so the
    // header reads cleanly as "Listed contents".
    const subtitle =
      targetPath || (dirPath && dirPath !== "." ? dirPath : undefined);
    const subtitleTitle = subtitle || undefined;

    return (
      <div className={getEventBlockContainerClasses(false)}>
        <EventBlockHeader
          isCollapsed
          withHover={false}
          onClick={handleLocate}
          onNavigate={handleLocate}
          onMouseEnter={handleHeaderMouseEnter}
          onMouseLeave={handleHeaderMouseLeave}
        >
          <EventBlockHeaderIcon
            icon={getToolIcon("list_dir", {
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
          {subtitle && (
            <EventBlockHeaderSubtitle
              isLoading={isLoading}
              title={subtitleTitle}
              className="text-text-1"
            >
              <span className="min-w-0 truncate">{subtitle}</span>
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

ListDirBlock.displayName = "ListDirBlock";

export default ListDirBlock;
