/**
 * ModeSwitchEvent — chat history rendering for suggest_mode_switch events.
 *
 * Layout mirrors ApprovalRequestEvent for semantic + visual consistency:
 * - Pending: shimmer lifecycle title + mode subtitle
 * - Switched: "Switched to {{mode}} Mode" title, no subtitle
 * - Skipped: "Mode change skipped" title, no subtitle
 */
import React from "react";

import { getEventIcon } from "@src/config/toolIcons";
import {
  MODE_LABELS,
  getResolution,
} from "@src/engines/ChatPanel/InputArea/ModeSwitchCard/useModeSwitchActions";
import {
  EventBlockHeader,
  EventBlockHeaderIcon,
  EventBlockHeaderSubtitle,
  EventBlockHeaderTitle,
  getEventBlockContainerClasses,
} from "@src/engines/ChatPanel/blocks/primitives";
import { useBlockHeader } from "@src/engines/ChatPanel/blocks/useBlockLocate";
import {
  type RawEventInput,
  useNormalizedEventProps,
} from "@src/engines/SessionCore/rendering/props";
import {
  useLifecycleLabels,
  useToolLabelText,
} from "@src/engines/SessionCore/rendering/registry";
import type { EventVariant } from "@src/engines/SessionCore/rendering/types/universalProps";

import { AskQuestionHistoryBody } from "../ask-question/AskQuestionHistoryChrome";

// ============================================
// Types
// ============================================

export interface ModeSwitchEventProps extends RawEventInput {
  variant?: EventVariant;
}

type ResolvedStatus = "switched" | "skipped" | "pending";

// ============================================
// Resolved Card (switched or skipped — collapsible, default collapsed)
// ============================================

const ResolvedCard: React.FC<{
  status: "switched" | "skipped";
  targetMode: string;
  reason: string;
  eventId?: string;
}> = ({ status, targetMode, reason, eventId }) => {
  const modeLabel = MODE_LABELS[targetMode] ?? targetMode;
  const isSwitched = status === "switched";
  const hasBody = Boolean(reason);
  const titleText = useToolLabelText("suggest_mode_switch", status, undefined, {
    mode: modeLabel,
  });

  const {
    isCollapsed,
    isHeaderHovered,
    handleHeaderClick,
    handleHeaderMouseEnter,
    handleHeaderMouseLeave,
  } = useBlockHeader({
    defaultCollapsed: true,
    eventId,
    collapseAllValue: true,
  });

  return (
    <div className={getEventBlockContainerClasses(false)}>
      <EventBlockHeader
        isCollapsed={isCollapsed}
        withHover={false}
        onMouseEnter={handleHeaderMouseEnter}
        onMouseLeave={handleHeaderMouseLeave}
      >
        <EventBlockHeaderIcon
          icon={getEventIcon("suggest_mode_switch", {
            status,
            className: isSwitched ? "text-success-6" : "text-text-3",
          })}
          isCollapsed={isCollapsed}
          isHeaderHovered={isHeaderHovered}
          onToggle={hasBody ? handleHeaderClick : undefined}
          hasContent={hasBody}
        />
        <EventBlockHeaderTitle>{titleText}</EventBlockHeaderTitle>
      </EventBlockHeader>

      {hasBody && !isCollapsed && (
        <AskQuestionHistoryBody>
          <p className="chat-block-title leading-[1.5] text-text-2">{reason}</p>
        </AskQuestionHistoryBody>
      )}
    </div>
  );
};

// ============================================
// Pending Card (header-only, shimmer title + mode subtitle)
// ============================================

const PendingCard: React.FC<{
  targetMode: string;
  showActiveEventPainting: boolean;
}> = ({ targetMode, showActiveEventPainting }) => {
  const modeLabel = MODE_LABELS[targetMode] ?? targetMode;
  const labels = useLifecycleLabels("suggest_mode_switch");

  return (
    <div className={getEventBlockContainerClasses(false)}>
      <EventBlockHeader isCollapsed={false} withHover={false}>
        <EventBlockHeaderIcon
          icon={getEventIcon("suggest_mode_switch", {
            className: "text-primary-6",
          })}
          isCollapsed={false}
          isHeaderHovered={false}
          hasContent={false}
        />
        <EventBlockHeaderTitle isLoading={showActiveEventPainting}>
          {labels.running}
        </EventBlockHeaderTitle>
        <EventBlockHeaderSubtitle title={modeLabel}>
          {modeLabel}
        </EventBlockHeaderSubtitle>
      </EventBlockHeader>
    </div>
  );
};

// ============================================
// Main Component
// ============================================

export const ModeSwitchEvent: React.FC<ModeSwitchEventProps> = (props) => {
  const normalizedProps = useNormalizedEventProps(props, "suggest_mode_switch");

  const eventId = normalizedProps?.eventId ?? "";
  const args = normalizedProps?.args ?? {};
  const targetMode = (args.target_mode as string) ?? "plan";
  const reason = (args.reason as string) ?? "";

  const displayStatus = props.event?.displayStatus as string | undefined;
  const result = props.event?.result as Record<string, unknown> | undefined;
  // Authoritative field written by Rust `ModeSwitchManager::respond` via
  // `agent:interaction_finalized` ("switch" or "skip"). The local cache
  // (`getResolution`) covers the optimistic frontend path from the card.
  const resultChoice = result?.choice as string | undefined;

  const cachedResolution = eventId ? getResolution(eventId) : undefined;

  let resolvedStatus: ResolvedStatus = "pending";
  if (cachedResolution) {
    resolvedStatus = cachedResolution;
  } else if (resultChoice === "skip") {
    resolvedStatus = "skipped";
  } else if (resultChoice === "switch") {
    resolvedStatus = "switched";
  } else if (displayStatus === "completed" && !resultChoice) {
    // completed without a choice means the turn ended (timeout / cancel)
    // without the user acting — treat as skipped rather than switched.
    resolvedStatus = "skipped";
  }

  if (resolvedStatus === "pending") {
    return (
      <PendingCard
        targetMode={targetMode}
        showActiveEventPainting={
          normalizedProps?.showActiveEventPainting ?? false
        }
      />
    );
  }

  return (
    <ResolvedCard
      status={resolvedStatus}
      targetMode={targetMode}
      reason={reason}
      eventId={eventId}
    />
  );
};

export default ModeSwitchEvent;
