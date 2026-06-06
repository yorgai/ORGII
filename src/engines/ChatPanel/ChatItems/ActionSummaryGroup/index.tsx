/**
 * ActionSummaryGroup Component
 *
 * Displays a collapsible group of consecutive exploration tool calls
 * (read, search, glob, list) using StackedBlock.
 *
 * Each event renders via the same registry event component used by
 * ActivityRouter — no manual data extraction or per-category block
 * construction. Loading / failed / completed states are handled by
 * each event component natively.
 */
import { Waypoints } from "lucide-react";
import React, { Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { StackedBlock } from "@src/engines/ChatPanel/blocks/primitives";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { getChatLazyComponent } from "@src/engines/SessionCore/rendering/registry/events";
import { getRegistryEventType } from "@src/lib/activityData/activityNormalizers";

import type { ActionSummaryCategory } from "../../ChatHistory/chatItemPipeline/classifiers";
import type { ActionSummaryEntry } from "../../ChatHistory/chatItemPipeline/types";

// ============================================
// Types
// ============================================

export interface ActionSummaryGroupProps {
  entries: ActionSummaryEntry[];
  items?: { category: ActionSummaryCategory; event: SessionEvent }[];
  closedByBoundary?: boolean;
}

interface CategorizedEvent {
  category: ActionSummaryCategory;
  event: SessionEvent;
  isLastItem?: boolean;
}

// ============================================
// Activity Block — renders via the registry
// ============================================

const ActivityBlockFallback: React.FC = () => (
  <div className="h-6 animate-pulse rounded bg-fill-2" />
);

function ActivityBlock({ event }: { event: SessionEvent }) {
  const renderEvent = () => {
    const eventType = getRegistryEventType(
      event as unknown as Record<string, unknown>
    );
    const EventComponent = getChatLazyComponent(eventType);
    return <EventComponent event={event} />;
  };

  return (
    <Suspense fallback={<ActivityBlockFallback />}>{renderEvent()}</Suspense>
  );
}

function suppressLoadingForNonLastRunningEvent(
  event: SessionEvent,
  isLastItem: boolean
): SessionEvent {
  if (isLastItem || event.displayStatus !== "running") return event;

  return {
    ...event,
    displayStatus: "completed",
    activityStatus: "processed",
    isDelta: false,
  };
}

// ============================================
// Header Label Builder
// ============================================

function buildGroupSummary(
  entries: ActionSummaryEntry[],
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const parts: string[] = [];
  for (const entry of entries) {
    const count = entry.events.length;
    switch (entry.category) {
      case "read":
        parts.push(t("tools.exploreSummary.read", { count }));
        break;
      case "search":
        parts.push(t("tools.exploreSummary.search", { count }));
        break;
      case "glob":
        parts.push(t("tools.exploreSummary.glob", { count }));
        break;
      case "list":
        parts.push(t("tools.exploreSummary.ls", { count }));
        break;
      case "lsp":
        parts.push(t("tools.exploreSummary.lsp", { count }));
        break;
    }
  }
  return parts.join(", ");
}

// ============================================
// Render Item — delegates to registry component
// ============================================

function renderEventBlock(
  { event, isLastItem }: CategorizedEvent,
  _index: number
): React.ReactNode {
  const renderedEvent = suppressLoadingForNonLastRunningEvent(
    event,
    isLastItem === true
  );
  return <ActivityBlock event={renderedEvent} />;
}

// ============================================
// Component
// ============================================

const ActionSummaryGroup: React.FC<ActionSummaryGroupProps> = ({
  entries,
  items,
  closedByBoundary = true,
}) => {
  const { t } = useTranslation("sessions");

  const totalCount = useMemo(
    () => entries.reduce((sum, entry) => sum + entry.events.length, 0),
    [entries]
  );

  const groupSummary = useMemo(
    () => buildGroupSummary(entries, t),
    [entries, t]
  );

  const orderedItems: CategorizedEvent[] = useMemo(() => {
    const baseItems =
      items && items.length > 0
        ? items
        : entries.flatMap((entry) =>
            entry.events.map((event) => ({
              category: entry.category,
              event,
            }))
          );

    return baseItems.map((item, index) => ({
      ...item,
      isLastItem: index === baseItems.length - 1,
    }));
  }, [items, entries]);

  if (totalCount === 0) return null;

  const firstEvent = orderedItems[0]?.event;
  const toolName =
    firstEvent?.functionName ||
    firstEvent?.uiCanonical ||
    firstEvent?.actionType;

  return (
    <div
      data-tool-call-event-id={firstEvent?.id}
      data-tool-call-name={toolName}
    >
      <StackedBlock
        items={orderedItems}
        icon={<Waypoints size={14} className="text-text-2" />}
        label={t("tools.explore")}
        groupSummary={groupSummary}
        defaultCollapsed={closedByBoundary}
        collapseWhen={closedByBoundary}
        eventId={firstEvent?.id}
        renderItem={renderEventBlock}
      />
    </div>
  );
};

export default ActionSummaryGroup;
