/**
 * ActivityRouter Component
 *
 * Routes a SessionEvent to the appropriate content component based on
 * actionType/functionName. Uses the unified event registry for
 * direct name → component resolution.
 */
import React, { Suspense, memo, useMemo } from "react";

import { AgentMessageBlock } from "@src/engines/ChatPanel/blocks";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  chatRequiresItemIndex,
  chatShowsStatusLine,
  getChatLazyComponent,
} from "@src/engines/SessionCore/rendering/registry/events";
import { getRegistryEventType } from "@src/lib/activityData/activityNormalizers";
import {
  extractTextFromContent,
  isOrchestratorSystemPrompt,
} from "@src/lib/activityData/textExtractors";

import AgentChatItemDefault from "../ChatItems/AgentChatItemDefault";
import AgentErrorChatItem from "../ChatItems/AgentErrorChatItem";
import "./ActivityRouter.scss";
import UserMessageContent from "./components/UserMessageContent";

export type ActivityStatus = "processed" | "pending" | "agent";

export interface ActivityChatItemProps {
  event: SessionEvent;
  itemIndex?: number;
  status?: ActivityStatus;
  /** Pass true when the caller is in live-playback mode (e.g. subagent grid replay). */
  isStreaming?: boolean;
}

// ============================================
// Custom Comparison - Only re-render when data changes
// ============================================

const RESULT_COMPARE_KEYS = [
  "type",
  "message",
  "content",
  "observation",
  "success",
  "error",
  "images",
  "call_id",
  "output",
] as const;

function isResultEqual(
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  for (const key of RESULT_COMPARE_KEYS) {
    if (prev[key] !== next[key]) return false;
  }
  return true;
}

function arePropsEqual(
  prevProps: ActivityChatItemProps,
  nextProps: ActivityChatItemProps
): boolean {
  if (prevProps.itemIndex !== nextProps.itemIndex) return false;
  if (prevProps.status !== nextProps.status) return false;
  if (prevProps.isStreaming !== nextProps.isStreaming) return false;

  const prevEvent = prevProps.event;
  const nextEvent = nextProps.event;

  if (prevEvent.id !== nextEvent.id) return false;
  if (prevEvent.actionType !== nextEvent.actionType) return false;
  if (prevEvent.functionName !== nextEvent.functionName) return false;
  if (prevEvent.uiCanonical !== nextEvent.uiCanonical) return false;
  if (prevEvent.activityStatus !== nextEvent.activityStatus) return false;
  if (prevEvent.displayStatus !== nextEvent.displayStatus) return false;
  if (prevEvent.displayText !== nextEvent.displayText) return false;
  if (prevEvent.displayVariant !== nextEvent.displayVariant) return false;

  if (!isResultEqual(prevEvent.result, nextEvent.result)) {
    return false;
  }

  const prevArgs = prevEvent.args;
  const nextArgs = nextEvent.args;
  if (prevArgs?.streamContent !== nextArgs?.streamContent) return false;
  if (prevArgs?.title !== nextArgs?.title) return false;
  if (prevArgs?.streamOutput !== nextArgs?.streamOutput) return false;
  if (prevArgs?.command !== nextArgs?.command) return false;
  if (prevArgs?.action !== nextArgs?.action) return false;
  if (prevArgs?.subagentSessionId !== nextArgs?.subagentSessionId) return false;

  return true;
}

// ============================================
// Loading Fallback
// ============================================

const ActivityLoadingFallback: React.FC = () => (
  <div className="h-8 animate-pulse rounded bg-fill-2" />
);

function getAssistantMessageContent(event: SessionEvent): string | null {
  const text =
    extractTextFromContent(event.result?.observation) ||
    extractTextFromContent(event.result?.content) ||
    extractTextFromContent(event.displayText);
  return text?.trim() ? text : null;
}

// ============================================
// Error Boundary
// ============================================

interface ErrorBoundaryState {
  hasError: boolean;
}

class ActivityErrorBoundary extends React.Component<
  { children: React.ReactNode; eventType: string },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; eventType: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(
      `[ActivityRouter] Failed to render ${this.props.eventType}:`,
      error,
      errorInfo
    );
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="p-2 text-sm text-red-500">
          Failed to render activity
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================
// Main Component
// ============================================

const ActivityChatItem: React.FC<ActivityChatItemProps> = memo(
  ({ event, itemIndex = 0, status = "agent", isStreaming = false }) => {
    const userMessageText = useMemo((): string | null => {
      const actionType = event.actionType;
      if (actionType !== "raw" && actionType !== "raw_event") return null;
      if (!event.result?.type && !event.result?.message) return null;
      if (event.result?.type !== "user" && !event.result?.message) return null;

      const text =
        extractTextFromContent(event.result?.message) ||
        extractTextFromContent(event.result?.content) ||
        "";

      if (!text) return null;

      if (isOrchestratorSystemPrompt(text)) {
        return null;
      }

      return text;
    }, [event]);

    const userMessageImages = useMemo((): string[] | undefined => {
      if (!event.result?.images) return undefined;
      const images = event.result.images;
      if (Array.isArray(images) && images.length > 0) {
        return images as string[];
      }
      return undefined;
    }, [event.result]);

    const renderContent = () => {
      const actionType = event.actionType;
      const functionName = event.functionName;

      if (
        functionName === "system" &&
        event.displayStatus === "failed" &&
        event.result?.observation
      ) {
        return (
          <AgentErrorChatItem errorMessage={String(event.result.observation)} />
        );
      }

      if (actionType === "raw" || actionType === "raw_event") {
        if (userMessageText) {
          return (
            <UserMessageContent
              text={userMessageText}
              images={userMessageImages}
            />
          );
        }
        if (!functionName) {
          return null;
        }
      }

      const eventType = getRegistryEventType(event);

      if (eventType === "agent_message") {
        const assistantContent = getAssistantMessageContent(event);
        if (assistantContent) {
          return (
            <AgentMessageBlock>
              <AgentChatItemDefault
                itemIndex={itemIndex}
                expand={true}
                finish={!isStreaming}
                streamHtml={isStreaming}
              >
                {assistantContent}
              </AgentChatItemDefault>
            </AgentMessageBlock>
          );
        }
      }

      const EventComponent = getChatLazyComponent(eventType);

      if (EventComponent) {
        const extras: Record<string, unknown> = {};
        if (chatRequiresItemIndex(eventType)) {
          extras.itemIndex = itemIndex;
        }
        if (isStreaming) {
          extras.isStreaming = true;
        }
        return (
          <ActivityErrorBoundary eventType={eventType}>
            <Suspense fallback={<ActivityLoadingFallback />}>
              <EventComponent event={event} variant="chat" {...extras} />
            </Suspense>
          </ActivityErrorBoundary>
        );
      }

      const observation = event.result?.observation;
      if (observation && typeof observation === "string") {
        return (
          <AgentChatItemDefault
            itemIndex={itemIndex}
            expand={true}
            finish={true}
            streamHtml={false}
          >
            {observation}
          </AgentChatItemDefault>
        );
      }

      return null;
    };

    const content = renderContent();
    if (!content) return null;

    const eventType = getRegistryEventType(event);
    const showStatusLine = chatShowsStatusLine(eventType);

    const statusLineClass = showStatusLine
      ? {
          processed: "activity-chat-item--status-processed",
          pending: "activity-chat-item--status-pending",
          agent: "activity-chat-item--status-agent",
        }[status] || "activity-chat-item--status-agent"
      : "";

    return (
      <div className={`activity-chat-item ${statusLineClass}`.trim()}>
        {content}
      </div>
    );
  },
  arePropsEqual
);

ActivityChatItem.displayName = "ActivityChatItem";

export default ActivityChatItem;
