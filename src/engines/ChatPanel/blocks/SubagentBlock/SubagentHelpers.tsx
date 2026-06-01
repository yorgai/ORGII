/**
 * SubagentBlock — helper functions and sub-components.
 *
 * Extracted from index.tsx to keep the main component under 300 lines.
 */
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import ExpandOverlay from "@src/components/ExpandOverlay";
import UserMessageContent from "@src/engines/ChatPanel/ChatHistory/components/UserMessageContent";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { SESSION_UI_TOKENS } from "../primitives";
import SubagentTodoPinBar, { deriveLatestTodos } from "./SubagentTodoPinBar";

// ============================================
// Helpers
// ============================================

export function extractSummary(content: string): string {
  if (!content) return "";
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,4}\s/.test(trimmed)) continue;
    if (trimmed.startsWith("|")) continue;
    if (/^[-*]\s/.test(trimmed)) continue;
    return trimmed.length > 120 ? trimmed.slice(0, 120) + "..." : trimmed;
  }
  return lines[0].trim();
}

export function formatElapsedTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

const MAX_REASONING_LINES = 4;

function tailLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(-maxLines).join("\n");
}

export function derivePeekFromEvents(events: SessionEvent[]): string {
  for (let idx = events.length - 1; idx >= 0; idx--) {
    const event = events[idx];
    if (
      event.actionType === "assistant" ||
      event.actionType === "llm_thinking" ||
      event.displayVariant === "message" ||
      event.displayVariant === "thinking"
    ) {
      const text =
        (typeof event.result?.content === "string" &&
          (event.result.content as string)) ||
        (typeof event.result?.observation === "string" &&
          (event.result.observation as string)) ||
        event.displayText ||
        "";
      if (text.trim().length > 0) return text;
    }
  }
  for (let idx = events.length - 1; idx >= 0; idx--) {
    const event = events[idx];
    if (
      (event.actionType === "tool_call" ||
        event.actionType === "tool_result") &&
      event.displayText
    ) {
      return event.displayText;
    }
  }
  return "";
}

// ============================================
// Streaming Reasoning Text (collapsed peek)
// ============================================

export const StreamingReasoning: React.FC<{ text: string }> = memo(
  ({ text }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const visible = tailLines(text.trimEnd(), MAX_REASONING_LINES);

    useEffect(() => {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, [visible]);

    return (
      <div
        ref={containerRef}
        className={`max-h-[4.5rem] overflow-y-hidden px-3.5 pb-2 ${SESSION_UI_TOKENS.FONT_SIZE_XS} leading-relaxed text-text-3/80`}
      >
        <span className="whitespace-pre-wrap break-words">{visible}</span>
      </div>
    );
  }
);
StreamingReasoning.displayName = "StreamingReasoning";

// ============================================
// Pinned Prompt
// ============================================

const PROMPT_MAX_LINES = 4;
const PROMPT_MAX_CHARS = 280;

export const PinnedPrompt: React.FC<{
  prompt: string;
  hasTodosAttached?: boolean;
}> = memo(({ prompt, hasTodosAttached = false }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const needsTruncation = useMemo(() => {
    if (!prompt) return false;
    if (prompt.split("\n").length > PROMPT_MAX_LINES) return true;
    return prompt.length > PROMPT_MAX_CHARS;
  }, [prompt]);

  const handleToggle = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    setIsExpanded((prev) => !prev);
  }, []);

  const borderRadius = hasTodosAttached
    ? "rounded-t-lg rounded-b-none"
    : "rounded-lg";

  return (
    <div
      className={`group relative flex min-w-0 max-w-full flex-1 flex-col gap-[6px] ${borderRadius} border border-solid border-border-2 bg-bg-2 px-3 py-2`}
    >
      <div className="relative w-full min-w-0 overflow-hidden">
        <div
          className={`allow-select ${isExpanded && needsTruncation ? "scrollbar-hide" : ""} ${!isExpanded && needsTruncation ? "cursor-pointer" : ""}`}
          style={
            !isExpanded && needsTruncation
              ? { maxHeight: 92, overflow: "hidden" }
              : isExpanded && needsTruncation
                ? {
                    maxHeight: "50vh",
                    overflowY: "auto",
                    overflowX: "hidden",
                  }
                : undefined
          }
          onClick={!isExpanded && needsTruncation ? handleToggle : undefined}
          onKeyDown={
            !isExpanded && needsTruncation
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleToggle(event);
                  }
                }
              : undefined
          }
          role={!isExpanded && needsTruncation ? "button" : undefined}
          tabIndex={!isExpanded && needsTruncation ? 0 : undefined}
        >
          <UserMessageContent text={prompt} />

          {isExpanded && needsTruncation && (
            <ExpandOverlay isExpanded onToggle={handleToggle} />
          )}
        </div>
      </div>
    </div>
  );
});
PinnedPrompt.displayName = "PinnedPrompt";

// ============================================
// Prompt + attached todo bar
// ============================================

export const PromptWithTodos: React.FC<{
  prompt: string;
  events: SessionEvent[];
}> = memo(({ prompt, events }) => {
  const todos = useMemo(() => deriveLatestTodos(events), [events]);
  const hasTodos = todos.length > 0;

  return (
    <div className="px-3.5 pt-2.5">
      <PinnedPrompt prompt={prompt} hasTodosAttached={hasTodos} />
      {hasTodos && <SubagentTodoPinBar events={events} attached />}
    </div>
  );
});
PromptWithTodos.displayName = "PromptWithTodos";
