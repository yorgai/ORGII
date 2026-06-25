/**
 * WorktreeListBlock — Header row + expandable list of worktree entries.
 */
import { GitBranch } from "lucide-react";
import React from "react";

import { getToolIcon } from "@src/config/toolIcons";

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

export interface WorktreeInfoRow {
  key: string;
  label: string;
  value: string;
}

export interface WorktreeListBlockProps {
  entries?: WorktreeEntryItem[];
  rows?: WorktreeInfoRow[];
  eventId?: string;
  /**
   * Pre-translated header title. Adapter resolves via
   * `useLifecycleLabels("worktree", action)`.
   */
  title: string;
  action?: string;
  isLoading?: boolean;
  isFailed?: boolean;
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
  entries = [],
  rows = [],
  eventId,
  title,
  action,
  isLoading = false,
  isFailed = false,
}) => {
  const {
    isCollapsed,
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
  const hasRows = rows.length > 0;
  const hasContent = hasEntries || hasRows;

  return (
    <div
      className={getEventBlockContainerClasses(false)}
      data-tool-call-event-id={eventId}
      data-tool-call-name="worktree"
    >
      <EventBlockHeader
        isCollapsed={isCollapsed}
        withHover={false}
        onClick={handleLocate}
        onNavigate={handleLocate}
        onMouseEnter={handleHeaderMouseEnter}
        onMouseLeave={handleHeaderMouseLeave}
        className={eventId ? "cursor-pointer" : undefined}
      >
        <EventBlockHeaderIcon
          icon={getToolIcon("worktree", {
            size: SESSION_UI_TOKENS.ICON.SIZE_SM,
            className: isFailed ? "text-danger-6" : "text-text-2",
          })}
          isCollapsed={isCollapsed}
          isHeaderHovered={isHeaderHovered}
          onToggle={hasContent ? handleHeaderClick : undefined}
          hasContent={hasContent}
          revealChevronOnIconHoverOnly={Boolean(eventId)}
          isLoading={isLoading}
          isFailed={isFailed}
        />
        <EventBlockHeaderTitle isLoading={isLoading}>
          {title}
        </EventBlockHeaderTitle>
        {action && (
          <EventBlockHeaderInfo isLoading={isLoading}>
            {action}
          </EventBlockHeaderInfo>
        )}
        {!action && hasEntries && (
          <EventBlockHeaderInfo>{entries.length}</EventBlockHeaderInfo>
        )}
      </EventBlockHeader>

      {!isCollapsed && hasRows && (
        <EventBlockExpandableStackList
          layout="full"
          items={rows}
          renderItem={(row) => (
            <ComposerStackListRow
              title={row.value}
              leading={null}
              primary={row.label}
              secondary={row.value}
              variant="info"
            />
          )}
          getKey={(row) => row.key}
          visibleCount={VISIBLE_ITEMS}
        />
      )}

      {!isCollapsed && hasEntries && (
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
