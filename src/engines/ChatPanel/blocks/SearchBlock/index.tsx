/**
 * Search Block — header-only transparent variant for code search.
 *
 * Grep / symbol search results render as a single header row (icon + lifecycle
 * label + pattern). The result body is not
 * surfaced in chat — users inspect matches in the simulator.
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

export interface SearchBlockProps {
  /** Search pattern/query */
  pattern: string;
  /** Whether currently loading */
  isLoading?: boolean;
  /** Optional event ID for simulator replay */
  eventId?: string;
  /** Optional action name for per-action icon (e.g. "grep", "find_files") */
  action?: string;
  /**
   * Pre-translated header title for the current state. Adapter resolves via
   * `useLifecycleLabels("code_search", action)` and picks running/done/failed.
   */
  title: string;
  showNoMatch?: boolean;
}

const SearchBlock: React.FC<SearchBlockProps> = React.memo(
  ({
    pattern,
    isLoading = false,
    eventId,
    action,
    title,
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

    const toolIcon = getToolIcon("code_search", {
      size: 14,
      className: "text-text-2",
      action,
    });

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
            icon={toolIcon}
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

SearchBlock.displayName = "SearchBlock";

export default SearchBlock;
