/**
 * WorktreeListBlock — Header row + expandable list of worktree entries.
 */
import { GitBranch } from "lucide-react";
import React from "react";

import { getToolIcon } from "@src/config/toolIcons";
import type { ToolUsageMetadata } from "@src/engines/SessionCore/core/types";

import ToolUsageBadge from "../ToolCallBlock/ToolUsageBadge";
import {
  ComposerStackListRow,
  EventBlockExpandableStackList,
  EventBlockHeader,
  EventBlockHeaderIcon,
  EventBlockHeaderInfo,
  EventBlockHeaderTitle,
  SESSION_UI_TOKENS,
  getEventBlockContainerClasses,
} from "../primitives";
import { useBlockHeader } from "../useBlockLocate";

export interface WorktreeEntryItem {
  path: string;
  branch: string;
}

export interface WorktreeListBlockProps {
  entries: WorktreeEntryItem[];
  eventId?: string;
  /**
   * Pre-translated header title. Adapter resolves via
   * `useLifecycleLabels("worktree", "list")`.
   */
  title: string;
  toolUsage?: ToolUsageMetadata;
}

const VISIBLE_ITEMS = 6;

const renderWorktreeRow = (entry: WorktreeEntryItem) => (
  <ComposerStackListRow
    title={entry.path}
    leading={<GitBranch size={14} className="shrink-0 text-primary-6" />}
    primary={entry.branch}
  />
);

const getWorktreeKey = (entry: WorktreeEntryItem) => entry.path;

export const WorktreeListBlock: React.FC<WorktreeListBlockProps> = ({
  entries,
  eventId,
  title,
  toolUsage,
}) => {
  const {
    isCollapsed: isExpanded,
    isHeaderHovered,
    handleHeaderClick,
    handleHeaderMouseEnter,
    handleHeaderMouseLeave,
    handleLocate,
  } = useBlockHeader({
    defaultCollapsed: false,
    eventId,
    collapseAllValue: false,
  });

  const hasEntries = entries.length > 0;

  return (
    <div className={getEventBlockContainerClasses(false)}>
      <EventBlockHeader
        isCollapsed={!isExpanded}
        withHover={false}
        onClick={handleLocate}
        onNavigate={handleLocate}
        onMouseEnter={handleHeaderMouseEnter}
        onMouseLeave={handleHeaderMouseLeave}
        className={eventId ? "cursor-pointer" : undefined}
        rightContent={
          toolUsage ? <ToolUsageBadge usage={toolUsage} /> : undefined
        }
      >
        <EventBlockHeaderIcon
          icon={getToolIcon("worktree", {
            size: SESSION_UI_TOKENS.ICON.SIZE_SM,
            className: "text-text-2",
          })}
          isCollapsed={!isExpanded}
          isHeaderHovered={isHeaderHovered}
          onToggle={hasEntries ? handleHeaderClick : undefined}
          hasContent={hasEntries}
          revealChevronOnIconHoverOnly={Boolean(eventId)}
        />
        <EventBlockHeaderTitle>{title}</EventBlockHeaderTitle>
        {hasEntries && (
          <EventBlockHeaderInfo>{entries.length}</EventBlockHeaderInfo>
        )}
      </EventBlockHeader>

      {isExpanded && hasEntries && (
        <EventBlockExpandableStackList
          layout="full"
          items={entries}
          renderItem={renderWorktreeRow}
          getKey={getWorktreeKey}
          visibleCount={VISIBLE_ITEMS}
        />
      )}
    </div>
  );
};

WorktreeListBlock.displayName = "WorktreeListBlock";

export default WorktreeListBlock;
