/**
 * ChatBubble Component
 *
 * Renders user and agent chat message events inside the Communication simulator.
 */
import { Bot, ChevronDown, ChevronRight, Terminal, User } from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AgentOrgRunMemberView } from "@src/api/tauri/agent";
import {
  ChatBubbleAvatar,
  ChatBubbleBody,
  ChatBubbleHeader,
  ChatBubbleLayout,
} from "@src/components/ChatBubble";
import { ChatImageThumbnailRow } from "@src/components/ChatImageThumbnail";
import Markdown from "@src/components/MarkDown";
import { TerminalOutput } from "@src/components/TerminalDisplay";
import { PILL_REGEX, PILL_TYPES, type PillType } from "@src/config/pillTokens";
import UserMessageContent from "@src/engines/ChatPanel/ChatHistory/components/UserMessageContent";
import ChatItemWrap from "@src/engines/ChatPanel/ChatHistory/renderers/ChatItemWrap";
import { SESSION_UI_TOKENS } from "@src/engines/ChatPanel/blocks/primitives/config";
import {
  formatSmartDateTime,
  toIntlLocaleTag,
} from "@src/util/data/formatters/date";

import { resolveSenderName } from "./AgentEventBubbles";
import { TodoView } from "./TodoView";
import type { MessageEntry } from "./types";

interface TerminalPillData {
  displayName: string;
  terminalText: string;
}

const TERMINAL_PREVIEW_MAX_HEIGHT = 160;
const AVATAR_ICON_SIZE = 14;

const ReplayMarkdown: React.FC<{ content: string }> = memo(({ content }) => (
  <Markdown
    textContent={content}
    useChatCodeBlock={true}
    enableFileNavigation={true}
    skipPreprocess={false}
  />
));
ReplayMarkdown.displayName = "ReplayMarkdown";

function extractCodeBlock(text: string): string | undefined {
  const match = text.match(/```\n?([\s\S]*?)```/);
  return match?.[1]?.trim() || undefined;
}

function parseTerminalPills(content: string): TerminalPillData[] {
  const terminalPills: TerminalPillData[] = [];
  const codeBlockContent = extractCodeBlock(content);

  for (const match of content.matchAll(PILL_REGEX)) {
    const pillType = match[2] as PillType;
    if (pillType !== "terminal" || !PILL_TYPES.has(pillType)) continue;

    const displayName = match[1].trim();
    const rawPath = match[3];
    let terminalText: string | undefined;

    if (rawPath.includes("::")) {
      const encoded = rawPath.slice(rawPath.indexOf("::") + 2);
      try {
        terminalText = decodeURIComponent(atob(encoded));
      } catch {
        terminalText = undefined;
      }
    }
    if (!terminalText && codeBlockContent) {
      terminalText = codeBlockContent;
    }
    if (terminalText) {
      terminalPills.push({ displayName, terminalText });
    }
  }

  return terminalPills;
}

const TerminalContextCard: React.FC<{ pill: TerminalPillData }> = memo(
  ({ pill }) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const toggle = useCallback((event: React.MouseEvent) => {
      event.stopPropagation();
      setIsExpanded((prev) => !prev);
    }, []);

    return (
      <div className="overflow-hidden rounded-lg bg-fill-2 text-left">
        <button
          type="button"
          onClick={toggle}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        >
          <Terminal size={13} className="shrink-0 text-primary-6" />
          <span className="flex-1 truncate text-[12px] font-medium text-text-1">
            {pill.displayName}
          </span>
          {isExpanded ? (
            <ChevronDown size={11} className="shrink-0 text-text-3" />
          ) : (
            <ChevronRight size={11} className="shrink-0 text-text-3" />
          )}
        </button>
        {isExpanded && (
          <div
            className="relative rounded-b-lg bg-bg-3"
            style={{
              boxShadow:
                "inset 0 6px 8px -6px rgba(0,0,0,0.4), inset 0 -6px 8px -6px rgba(0,0,0,0.4)",
            }}
          >
            <TerminalOutput
              output={pill.terminalText}
              maxHeight={TERMINAL_PREVIEW_MAX_HEIGHT}
              showLoading={false}
              className="scrollbar-hide"
            />
          </div>
        )}
      </div>
    );
  }
);
TerminalContextCard.displayName = "TerminalContextCard";

const UserBubbleContent: React.FC<{
  content: string;
  images?: string[];
}> = memo(({ content, images }) => {
  const terminalPills = useMemo(() => parseTerminalPills(content), [content]);

  // Strip terminal pill tokens before passing to UserMessageContent.
  // TerminalContextCard renders the expandable card below; if we also pass the
  // raw terminal token to UserMessageContent it would render a second inline
  // badge for the same pill.
  const strippedContent = useMemo(
    () =>
      content
        .replace(PILL_REGEX, (match, _name, pillType: string) =>
          pillType === "terminal" ? "" : match
        )
        .trim(),
    [content]
  );

  const hasImages = !!images && images.length > 0;
  const hasContent = strippedContent !== "";

  if (!hasContent && !hasImages && terminalPills.length === 0) return null;

  return (
    <div className="flex flex-col items-start gap-1.5 text-left">
      {hasImages && <ChatImageThumbnailRow images={images} />}
      {hasContent && (
        <div className="inline-block rounded-lg bg-primary-1 p-3">
          <UserMessageContent text={strippedContent} />
        </div>
      )}
      {terminalPills.map((pill, index) => (
        <TerminalContextCard key={`${pill.displayName}-${index}`} pill={pill} />
      ))}
    </div>
  );
});
UserBubbleContent.displayName = "UserBubbleContent";

interface AgentFramedBubbleProps {
  message: MessageEntry;
  onClick?: () => void;
  /** Skip bordered/padded body — for cards that bring their own container chrome. */
  unframed?: boolean;
  /**
   * Active org-run member roster. Used to resolve the bubble header
   * label from `event.sessionId` so multi-agent surfaces show the
   * subagent's real name (e.g. "Planner") instead of the generic
   * "Agent" fallback.
   */
  orgMembers?: ReadonlyArray<AgentOrgRunMemberView>;
  children: React.ReactNode;
}

const AgentFramedBubble: React.FC<AgentFramedBubbleProps> = ({
  message,
  onClick,
  unframed = false,
  orgMembers,
  children,
}) => {
  const { t, i18n } = useTranslation(["common", "projects"]);
  const senderName = useMemo(
    () =>
      resolveSenderName(
        message.event,
        orgMembers,
        t("terminology.agent", { ns: "common" })
      ),
    [message.event, orgMembers, t]
  );

  return (
    <ChatItemWrap variant="text" className="w-full min-w-0 overflow-hidden">
      <ChatBubbleLayout
        align="left"
        onClick={onClick}
        interactive={false}
        avatar={
          <ChatBubbleAvatar
            className="h-8 w-8 bg-fill-2"
            icon={<Bot size={AVATAR_ICON_SIZE} className="text-primary-6" />}
          />
        }
      >
        <ChatBubbleHeader
          senderName={senderName}
          timestamp={formatSmartDateTime(message.timestamp, {
            yesterdayLabel: t("relativeDate.yesterday"),
            locale: toIntlLocaleTag(i18n.resolvedLanguage),
          })}
          align="left"
        />
        {unframed ? (
          children
        ) : (
          <ChatBubbleBody
            variant="agent"
            className="border border-border-2 bg-transparent px-3 py-2.5"
          >
            {children}
          </ChatBubbleBody>
        )}
      </ChatBubbleLayout>
    </ChatItemWrap>
  );
};

export const TodoBubble: React.FC<{
  message: MessageEntry;
  onClick?: () => void;
  orgMembers?: ReadonlyArray<AgentOrgRunMemberView>;
}> = memo(({ message, onClick, orgMembers }) => (
  <AgentFramedBubble
    message={message}
    onClick={onClick}
    orgMembers={orgMembers}
  >
    <TodoView message={message} className="p-0" />
  </AgentFramedBubble>
));
TodoBubble.displayName = "TodoBubble";

export const InteractionBubble: React.FC<{
  message: MessageEntry;
  onClick?: () => void;
  orgMembers?: ReadonlyArray<AgentOrgRunMemberView>;
  children: React.ReactNode;
}> = memo(({ message, onClick, orgMembers, children }) => (
  <AgentFramedBubble
    message={message}
    onClick={onClick}
    orgMembers={orgMembers}
  >
    {children}
  </AgentFramedBubble>
));
InteractionBubble.displayName = "InteractionBubble";

export const PlanBubble: React.FC<{
  message: MessageEntry;
  onClick?: () => void;
  orgMembers?: ReadonlyArray<AgentOrgRunMemberView>;
  children: React.ReactNode;
}> = memo(({ message, onClick, orgMembers, children }) => (
  <AgentFramedBubble
    message={message}
    onClick={onClick}
    unframed
    orgMembers={orgMembers}
  >
    {children}
  </AgentFramedBubble>
));
PlanBubble.displayName = "PlanBubble";

export const ChatBubble: React.FC<{
  message: MessageEntry;
  index: number;
  isLatest?: boolean;
  onClick?: () => void;
  /**
   * Active org-run member roster. Used to resolve a subagent display
   * name (e.g. "Planner") from `event.sessionId` on multi-agent
   * surfaces. Falls back to the generic "Agent" label when omitted or
   * the session is not in the roster.
   */
  orgMembers?: ReadonlyArray<AgentOrgRunMemberView>;
}> = memo(({ message, index, isLatest = false, onClick, orgMembers }) => {
  const { t, i18n } = useTranslation(["common", "projects"]);
  const isUser = message.sender === "user";
  const agentSenderName = useMemo(
    () =>
      resolveSenderName(
        message.event,
        orgMembers,
        t("terminology.agent", { ns: "common" })
      ),
    [message.event, orgMembers, t]
  );

  const rawContent =
    typeof message.content === "string"
      ? message.content
      : String(message.content ?? "");
  const userImages = useMemo<string[] | undefined>(() => {
    if (!isUser) return undefined;
    const result = message.event.result as { images?: unknown } | undefined;
    const raw = result?.images;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.filter((ref): ref is string => typeof ref === "string");
    }
    return undefined;
  }, [isUser, message.event.result]);
  const hasUserImages = !!userImages && userImages.length > 0;
  if (isUser && !rawContent.trim() && !hasUserImages) {
    return null;
  }

  return (
    <ChatItemWrap
      variant={isUser ? "default" : "text"}
      className={`w-full min-w-0 ${isUser ? "" : "overflow-hidden"}`}
      dataAttr={isUser ? { "data-replay-user-msg": index } : undefined}
    >
      <ChatBubbleLayout
        align="left"
        onClick={onClick}
        interactive={false}
        avatar={
          <ChatBubbleAvatar
            className={`h-8 w-8 ${isUser ? "bg-primary-1" : "bg-fill-2"}`}
            icon={
              isUser ? (
                <User size={AVATAR_ICON_SIZE} className="text-primary-6" />
              ) : (
                <Bot size={AVATAR_ICON_SIZE} className="text-primary-6" />
              )
            }
          />
        }
      >
        <ChatBubbleHeader
          senderName={isUser ? t("terminology.you") : agentSenderName}
          timestamp={formatSmartDateTime(message.timestamp, {
            yesterdayLabel: t("relativeDate.yesterday"),
            locale: toIntlLocaleTag(i18n.resolvedLanguage),
          })}
          align="left"
        />
        {isUser ? (
          <UserBubbleContent content={rawContent} images={userImages} />
        ) : (
          <div
            className={`inline-block min-w-0 max-w-full overflow-hidden rounded-lg p-3 text-left text-text-1 ${
              isLatest ? "bg-fill-2" : "bg-fill-1"
            }`}
          >
            <div className={`min-w-0 ${SESSION_UI_TOKENS.TEXT.BODY_BASE}`}>
              <ReplayMarkdown content={message.content} />
            </div>
          </div>
        )}
      </ChatBubbleLayout>
    </ChatItemWrap>
  );
});
ChatBubble.displayName = "ChatBubble";
