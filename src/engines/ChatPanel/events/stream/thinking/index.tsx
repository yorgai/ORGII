/**
 * ThinkingEvent - Universal Component
 *
 * Renders AI thinking/reasoning events across all contexts.
 *
 * Variants:
 * - chat: Uses ThinkingBlock with EventBlockHeader (collapsible, markdown)
 * - simulator: Uses SimulatorMessages app (via registry)
 *
 * @example
 * // From ChatPanel (SessionEvent)
 * <ThinkingEvent event={event} />
 *
 * // From Simulator (spread event format)
 * <ThinkingEvent {...event} mode="simulation" />
 *
 * // Explicit variant
 * <ThinkingEvent {...props} variant="chat" />
 */
import React, { Suspense, lazy, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

import Markdown from "@src/components/MarkDown";
import { getEventIcon } from "@src/config/toolIcons";
import {
  EventBlockHeader,
  EventBlockHeaderIcon,
  EventBlockHeaderInfo,
  EventBlockHeaderTitle,
  getEventBlockContainerClasses,
  getEventBlockContentClasses,
  useEventBlockHeader,
} from "@src/engines/ChatPanel/blocks/primitives";
import { useChatEventReplay } from "@src/engines/ChatPanel/hooks/useChatEventReplay";
import {
  type RawEventInput,
  extractThinkingData,
  useNormalizedEventProps,
} from "@src/engines/SessionCore/rendering/props";
import type { EventVariant } from "@src/engines/SessionCore/rendering/types/universalProps";

const LazySimulatorMessages = lazy(
  () => import("@src/modules/WorkStation/Chat/Communication")
);

// ============================================
// Types
// ============================================

export interface ThinkingEventProps extends RawEventInput {
  /** Force a specific variant (auto-detected if not provided) */
  variant?: EventVariant;
}

// ============================================
// Chat Variant (uses ThinkingBlock styling)
// ============================================

interface ChatVariantProps {
  content?: string;
  duration?: number;
  isLoading: boolean;
  isStreaming?: boolean;
  eventId?: string;
}

function formatThoughtDuration(durationMs: number): string | undefined {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return undefined;

  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds}s`;
}

const ChatVariant: React.FC<ChatVariantProps> = ({
  content,
  duration,
  isLoading,
  isStreaming = false,
  eventId,
}) => {
  const { t } = useTranslation("sessions");
  const {
    isCollapsed: isExpanded,
    isHeaderHovered,
    handleHeaderClick,
    handleHeaderMouseEnter,
    handleHeaderMouseLeave,
    setIsCollapsed,
  } = useEventBlockHeader({
    defaultCollapsed: !isLoading,
    collapseAllValue: false,
  });

  useEffect(() => {
    setIsCollapsed(isLoading);
  }, [isLoading, setIsCollapsed]);

  const durationLabel = !isLoading
    ? formatThoughtDuration(duration ?? 0)
    : undefined;
  const { replayEventById } = useChatEventReplay();
  const handleLocate = useCallback(() => {
    if (eventId) {
      replayEventById(eventId);
    }
  }, [eventId, replayEventById]);

  const hasContent = Boolean(content);

  return (
    <div className={getEventBlockContainerClasses(false)}>
      <EventBlockHeader
        isCollapsed={isExpanded}
        withHover={false}
        onClick={hasContent ? handleHeaderClick : undefined}
        onNavigate={eventId ? handleLocate : undefined}
        onMouseEnter={handleHeaderMouseEnter}
        onMouseLeave={handleHeaderMouseLeave}
      >
        <EventBlockHeaderIcon
          icon={getEventIcon("thinking")}
          isCollapsed={!isExpanded}
          isHeaderHovered={isHeaderHovered}
          onToggle={handleHeaderClick}
          hasContent={hasContent}
          isLoading={isLoading}
        />
        <EventBlockHeaderTitle isLoading={isLoading}>
          {isLoading ? t("tools.thinkingRunning") : t("tools.thinkingDone")}
        </EventBlockHeaderTitle>
        {!isLoading && durationLabel && (
          <EventBlockHeaderInfo>
            {t("tools.thinkingDuration", { duration: durationLabel })}
          </EventBlockHeaderInfo>
        )}
      </EventBlockHeader>

      {isExpanded && (
        <div className="ml-[14px] border-l border-border-1 py-0.5">
          <div
            className={`pl-3 ${getEventBlockContentClasses({ padding: "p-0" })}`}
          >
            <div className="activity-thinking activity-thinking--no-style allow-select">
              <div className="activity-thinking__content allow-select">
                {content ? (
                  <>
                    <Markdown textContent={content} />
                    {isStreaming && (
                      <span className="activity-thinking__cursor" />
                    )}
                  </>
                ) : (
                  <span className="text-text-3">
                    {t("tools.noThoughtPreview")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================
// Main Component
// ============================================

export const ThinkingEvent: React.FC<ThinkingEventProps> = (props) => {
  const normalizedProps = useNormalizedEventProps(props, "thinking");

  if (!normalizedProps) return null;

  const { content, duration } = extractThinkingData(normalizedProps);
  const displayContent = props.streamingContent || content;
  const isLoading = normalizedProps.status === "running";

  if (normalizedProps.variant === "chat") {
    return (
      <ChatVariant
        content={displayContent}
        duration={duration}
        isLoading={isLoading}
        isStreaming={props.isStreaming}
        eventId={normalizedProps.eventId}
      />
    );
  }

  return (
    <Suspense fallback={null}>
      <LazySimulatorMessages
        currentEvent={props}
        mode={(props.mode as "interactive" | "simulation") || "interactive"}
      />
    </Suspense>
  );
};

ThinkingEvent.displayName = "ThinkingEvent";

export default ThinkingEvent;
