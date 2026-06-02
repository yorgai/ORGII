/**
 * AgentMessageEvent - Universal Component
 *
 * Renders AI agent message events across all contexts.
 *
 * Variants:
 * - chat: Uses AgentChatItemDefault (markdown rendering, expandable)
 * - simulator: Uses SimulatorMessages (full app with chat/think/todo tabs)
 *
 * Note: This was previously called AssistantEvent. The ui_canonical in Rust
 * is now `agent_message` to better reflect the actual purpose.
 */
import { useAtomValue } from "jotai";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import Markdown from "@src/components/MarkDown";
import { getEventIcon } from "@src/config/toolIcons";
import AgentChatItemDefault from "@src/engines/ChatPanel/ChatItems/AgentChatItemDefault";
import { AgentMessageBlock } from "@src/engines/ChatPanel/blocks";
import CanvasInlineCard from "@src/engines/ChatPanel/blocks/CanvasInlineCard";
import { useCanvasPreviewForSession } from "@src/engines/ChatPanel/blocks/CanvasInlineCard/useCanvasPreviewForSession";
import MessageReferenceCards from "@src/engines/ChatPanel/blocks/MessageReferenceCards";
import {
  EventBlockHeader,
  EventBlockHeaderIcon,
  EventBlockHeaderTitle,
  getEventBlockContainerClasses,
  getEventBlockContentClasses,
  useEventBlockHeader,
} from "@src/engines/ChatPanel/blocks/primitives";
import { streamingDeltaContentAtom } from "@src/engines/SessionCore";
import { sessionIdAtom } from "@src/engines/SessionCore/core/atoms";
import {
  type RawEventInput,
  useNormalizedEventProps,
} from "@src/engines/SessionCore/rendering/props";
import type { EventVariant } from "@src/engines/SessionCore/rendering/types/universalProps";
import {
  extractThinkContent,
  stripThinkTags,
} from "@src/engines/SessionCore/sync/adapters/shared/streamingParsers";
import { SimulatorMessages } from "@src/modules/WorkStation/Chat/Communication";

// ============================================
// Types
// ============================================

export interface AgentMessageEventProps extends RawEventInput {
  variant?: EventVariant;
}

// ============================================
// Inline thinking block (for historical <think> tags)
// ============================================

const InlineThinkingBlock: React.FC<{ content: string }> = ({ content }) => {
  const { t } = useTranslation("sessions");
  const {
    isCollapsed: isExpanded,
    isHeaderHovered,
    handleHeaderClick,
    handleHeaderMouseEnter,
    handleHeaderMouseLeave,
  } = useEventBlockHeader({ defaultCollapsed: true, collapseAllValue: false });

  return (
    <div className={getEventBlockContainerClasses(false)}>
      <EventBlockHeader
        isCollapsed={isExpanded}
        withHover={false}
        onMouseEnter={handleHeaderMouseEnter}
        onMouseLeave={handleHeaderMouseLeave}
      >
        <EventBlockHeaderIcon
          icon={getEventIcon("agent_message")}
          isCollapsed={!isExpanded}
          isHeaderHovered={isHeaderHovered}
          onToggle={handleHeaderClick}
          hasContent
        />
        <EventBlockHeaderTitle>{t("chat.thought")}</EventBlockHeaderTitle>
      </EventBlockHeader>

      {isExpanded && (
        <div className={getEventBlockContentClasses({ padding: "p-0" })}>
          <div className="activity-thinking activity-thinking--no-style allow-select">
            <div className="activity-thinking__content allow-select">
              <Markdown textContent={content} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================
// Chat Variant
// ============================================

interface ChatVariantProps {
  content?: string;
  thinkingContent?: string | null;
  itemIndex?: number;
  isStreaming?: boolean;
  sessionId?: string | null;
}

const ChatVariant: React.FC<ChatVariantProps> = ({
  content,
  thinkingContent,
  itemIndex = 0,
  isStreaming = false,
  sessionId,
}) => {
  const { payload: canvasPayload, dismiss: dismissCanvas } =
    useCanvasPreviewForSession(sessionId);

  if (!content && !thinkingContent && !isStreaming && !canvasPayload)
    return null;

  // When the model wraps its entire reply in <think>...</think> with no
  // text outside, `content` is empty after stripping but `thinkingContent`
  // is populated. In that case we render only the inline thinking block
  // and skip the empty assistant bubble — otherwise the user sees a blank
  // chat row with no testid content.
  const hasVisibleContent = Boolean(content) || isStreaming;

  return (
    <>
      {thinkingContent && <InlineThinkingBlock content={thinkingContent} />}
      {hasVisibleContent && (
        <AgentMessageBlock>
          <AgentChatItemDefault
            itemIndex={itemIndex}
            expand={true}
            finish={!isStreaming}
            streamHtml={isStreaming}
          >
            {content || ""}
          </AgentChatItemDefault>
          <MessageReferenceCards
            content={content || ""}
            enabled={!isStreaming}
          />
        </AgentMessageBlock>
      )}
      {canvasPayload && (
        <div className="px-2">
          <CanvasInlineCard
            mode={canvasPayload.mode}
            content={canvasPayload.content}
            url={canvasPayload.url}
            title={canvasPayload.title}
            isStreaming={canvasPayload.streaming ?? isStreaming}
            onClose={dismissCanvas}
          />
        </div>
      )}
    </>
  );
};

// ============================================
// Simulator Variant
// ============================================

interface SimulatorVariantProps {
  event: RawEventInput;
  mode?: "interactive" | "simulation";
}

const SimulatorVariant: React.FC<SimulatorVariantProps> = ({
  event,
  mode = "interactive",
}) => {
  // Extract the sessionId from the event so the notification bar in
  // SimulatorMessages uses the correct session rather than the global atom.
  const eventSessionId =
    (event as { event?: { sessionId?: string } })?.event?.sessionId ?? null;
  return (
    <SimulatorMessages
      currentEvent={event}
      mode={mode}
      sessionId={eventSessionId}
    />
  );
};

// ============================================
// Main Component
// ============================================

function extractText(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.content === "string") return obj.content;
  }
  return undefined;
}

function hasUnloadedTurnPayload(value: RawEventInput | undefined): boolean {
  const rawResult = value?.event?.result ?? value?.result;
  if (!rawResult || typeof rawResult !== "object") return false;
  const result = rawResult as Record<string, unknown>;
  const unloadedTurn = result.unloadedTurn;
  if (!unloadedTurn || typeof unloadedTurn !== "object") return false;
  const turnId = (unloadedTurn as Record<string, unknown>).turnId;
  return typeof turnId === "string" && turnId.length > 0;
}

export const AgentMessageEvent: React.FC<AgentMessageEventProps> = (props) => {
  const normalizedProps = useNormalizedEventProps(props, "agent_message");
  const sessionId = useAtomValue(sessionIdAtom);
  const streamingMap = useAtomValue(streamingDeltaContentAtom);
  const directStreamContent = sessionId
    ? (streamingMap.get(sessionId) ?? null)
    : null;

  const rawContent = useMemo(() => {
    if (props.isStreaming && directStreamContent) return directStreamContent;
    return (
      props.streamingContent ||
      extractText(normalizedProps?.result?.observation) ||
      extractText(normalizedProps?.result?.content) ||
      extractText(props.event?.result?.observation) ||
      extractText(props.event?.result?.content) ||
      extractText(props.event?.displayText) ||
      extractText(normalizedProps?.args?.task_description) ||
      undefined
    );
  }, [
    normalizedProps,
    props.streamingContent,
    props.event?.result?.observation,
    props.event?.result?.content,
    props.event?.displayText,
    props.isStreaming,
    directStreamContent,
  ]);

  const content = rawContent ? stripThinkTags(rawContent) : undefined;
  const thinkingContent = useMemo(
    () => (rawContent ? extractThinkContent(rawContent) : null),
    [rawContent]
  );

  const variant = normalizedProps?.variant ?? props.variant;

  if (!normalizedProps && variant !== "chat") return null;

  if (variant === "chat") {
    if (hasUnloadedTurnPayload(props)) return null;

    return (
      <ChatVariant
        content={content}
        thinkingContent={thinkingContent}
        itemIndex={props.itemIndex}
        isStreaming={props.isStreaming}
        sessionId={sessionId}
      />
    );
  }

  return (
    <SimulatorVariant
      event={props}
      mode={(props.mode as "interactive" | "simulation") || "interactive"}
    />
  );
};

AgentMessageEvent.displayName = "AgentMessageEvent";

export default AgentMessageEvent;
