/**
 * SubagentBlock — helper functions and prompt preview sub-component.
 */
import React, { memo, useCallback, useMemo, useState } from "react";

import ExpandOverlay from "@src/components/ExpandOverlay";
import Markdown from "@src/components/MarkDown";
import UserMessageContent from "@src/engines/ChatPanel/ChatHistory/components/UserMessageContent";

import { EVENT_BLOCK_FADE_FROM } from "../primitives";

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

// ============================================
// Prompt Preview
// ============================================

const PROMPT_COLLAPSED_MAX_LINES = 5;
const PROMPT_COLLAPSED_MAX_CHARS = 560;
const PROMPT_COLLAPSED_MAX_HEIGHT = 112;
const PROMPT_EXPANDED_MAX_HEIGHT = "min(320px, 40vh)";

export const SubagentPromptPreview: React.FC<{
  prompt: string;
}> = memo(({ prompt }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const needsExpand = useMemo(() => {
    if (!prompt) return false;
    if (prompt.split("\n").length > PROMPT_COLLAPSED_MAX_LINES) return true;
    return prompt.length > PROMPT_COLLAPSED_MAX_CHARS;
  }, [prompt]);

  const handleToggle = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <div
      className={`allow-select group/expand relative w-full min-w-0 ${needsExpand ? "scrollbar-hide" : ""} ${!isExpanded && needsExpand ? "cursor-pointer" : ""}`}
      style={
        needsExpand
          ? isExpanded
            ? {
                maxHeight: PROMPT_EXPANDED_MAX_HEIGHT,
                overflowY: "auto",
                overflowX: "hidden",
              }
            : {
                maxHeight: PROMPT_COLLAPSED_MAX_HEIGHT,
                overflow: "hidden",
              }
          : undefined
      }
      onClick={!isExpanded && needsExpand ? handleToggle : undefined}
      onKeyDown={
        !isExpanded && needsExpand
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleToggle(event);
              }
            }
          : undefined
      }
      role={!isExpanded && needsExpand ? "button" : undefined}
      tabIndex={!isExpanded && needsExpand ? 0 : undefined}
    >
      <UserMessageContent text={prompt} />

      {needsExpand && (
        <ExpandOverlay
          isExpanded={isExpanded}
          onToggle={handleToggle}
          fadeFrom={EVENT_BLOCK_FADE_FROM}
        />
      )}
    </div>
  );
});
export const SubagentResultPreview: React.FC<{
  content: string;
}> = memo(({ content }) => (
  <div className="chat-text flex flex-col items-start gap-1 self-stretch text-text-1">
    <div className="resultBgc allow-select w-full min-w-0 overflow-visible break-words font-normal">
      <Markdown
        textContent={content}
        useChatCodeBlock={true}
        enableFileNavigation={true}
        skipPreprocess={false}
      />
    </div>
  </div>
));
SubagentResultPreview.displayName = "SubagentResultPreview";

SubagentPromptPreview.displayName = "SubagentPromptPreview";
