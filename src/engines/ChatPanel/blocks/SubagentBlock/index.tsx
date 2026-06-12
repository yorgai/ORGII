/**
 * SubagentBlock — session-in-session card for subagent tool calls.
 *
 * The nested subagent activity (events, todos, streaming reasoning) is
 * rendered by the Simulator panel to the right of the chat — this block
 * intentionally does NOT duplicate that timeline inline. The prompt is
 * always shown when available, with its own inline max-height + expand
 * control. The header itself is not collapsible.
 *
 * Visual states:
 *   1. **Running** — infinity icon, shimmer title, Stop button visible.
 *   2. **Success** — infinity icon, prompt preview or summary body.
 *   3. **Failed / cancelled** — infinity icon, error body.
 */
import { Infinity, Square } from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  EVENT_BLOCK_ICON_WRAPPER_CLASSES,
  EVENT_LOADING_SHIMMER_TEXT_CLASSES,
  EventBlockHeader,
  SESSION_UI_TOKENS,
  getEventBlockContainerClasses,
} from "../primitives";
import {
  SubagentPromptPreview,
  extractSummary,
  formatElapsedTime,
} from "./SubagentHelpers";

// ============================================
// Types
// ============================================

export interface SubagentBlockProps {
  description: string;
  subagentType?: string;
  resultContent?: string;
  resultSummary?: string;
  isLoading?: boolean;
  defaultCollapsed?: boolean;
  elapsedMs?: number;
  subagentSessionId?: string;
  prompt?: string;
  status?: "pending" | "running" | "success" | "failed" | "cancelled";
  success?: boolean;
  errorMessage?: string;
  eventId?: string;
}

// ============================================
// Main Component
// ============================================

const SubagentBlock: React.FC<SubagentBlockProps> = memo(
  ({
    description,
    resultContent,
    resultSummary,
    isLoading = false,
    elapsedMs,
    subagentSessionId,
    prompt,
    status,
    success,
    errorMessage,
  }) => {
    const { t } = useTranslation("sessions");
    const { t: tCommon } = useTranslation();

    const hasNestedSession = Boolean(subagentSessionId);
    const hasPrompt = Boolean(prompt && prompt.trim().length > 0);
    const hasErrorMessage = Boolean(
      errorMessage && errorMessage.trim().length > 0
    );
    // `success === false` alone is not a reliable failure signal: the Rust
    // extractor defaults `success` to false whenever the parent tool_call's
    // result is still empty (running, or the brief window between
    // displayStatus flipping to Completed and `recompute_extracted` seeing
    // the merged result). Only treat the run as failed when status is
    // explicitly terminal, or when the extractor also surfaced an
    // errorMessage (which it only populates on confirmed failure).
    const isFailure =
      status === "failed" ||
      status === "cancelled" ||
      (success === false && hasErrorMessage);

    const summary = useMemo(
      () => resultSummary || extractSummary(resultContent || ""),
      [resultSummary, resultContent]
    );

    const timingLabel = elapsedMs ? formatElapsedTime(elapsedMs) : undefined;

    // ── Stop button ──
    const [isStopping, setIsStopping] = useState(false);
    const isActive = status === "running" || status === "pending" || isLoading;
    const effectiveIsStopping = isStopping && isActive;
    const canStop = isActive && hasNestedSession;

    useEffect(() => {
      if (!isLoading) setIsStopping(false);
    }, [isLoading]);

    const handleStop = useCallback(
      async (event: React.MouseEvent) => {
        event.stopPropagation();
        if (!subagentSessionId || effectiveIsStopping) return;
        setIsStopping(true);
        try {
          const { CANCEL_REASON, cancelSession } =
            await import("@src/api/tauri/agent/session");
          await cancelSession(
            subagentSessionId,
            CANCEL_REASON.PROGRAMMATIC_SHUTDOWN
          );
        } catch (err) {
          console.error("Failed to cancel subagent:", err);
          setIsStopping(false);
        }
      },
      [subagentSessionId, effectiveIsStopping]
    );

    // ── Header text ──
    const taskName = description || t("tools.subagentDefaultName");
    const subtitleParts: string[] = [taskName];
    if (timingLabel && !isLoading) subtitleParts.push(timingLabel);
    const subtitle = subtitleParts.join(" · ");

    // ── Header right: stop button ──
    const headerRight = (
      <div className="flex items-center gap-2 pl-2">
        {canStop && (
          <button
            type="button"
            data-testid="subagent-card-stop-button"
            className="flex h-5 w-0 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-none bg-text-2 text-white transition-colors hover:bg-text-1 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 group-hover/chat-block-header:w-5"
            onClick={handleStop}
            disabled={effectiveIsStopping}
            title={tCommon("common:actions.stop")}
            aria-label={tCommon("common:actions.stop")}
          >
            {effectiveIsStopping ? (
              <div className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Square size={10} fill="currentColor" strokeWidth={0} />
            )}
          </button>
        )}
      </div>
    );

    const displayTitle = t("tools.assignedTaskToSubagent");
    const hasBody =
      hasPrompt ||
      (isFailure && hasErrorMessage) ||
      (!isFailure && !isLoading && Boolean(summary)) ||
      (isLoading && !hasPrompt);

    return (
      <div className={getEventBlockContainerClasses(true)}>
        <EventBlockHeader
          isCollapsed={false}
          withHover
          className={
            hasBody
              ? "border-b border-solid border-border-1"
              : "border-b border-solid border-transparent"
          }
          rightContent={headerRight}
        >
          <div className={EVENT_BLOCK_ICON_WRAPPER_CLASSES}>
            <Infinity size={14} strokeWidth={1.75} className="text-text-2" />
          </div>
          <span
            className={`shrink-0 truncate font-medium ${isLoading ? EVENT_LOADING_SHIMMER_TEXT_CLASSES : isFailure ? "text-text-3" : "text-text-1"}`}
            title={displayTitle}
          >
            {displayTitle}
          </span>
          {subtitle && (
            <span
              className={`min-w-0 shrink truncate ${isLoading ? EVENT_LOADING_SHIMMER_TEXT_CLASSES : isFailure ? "text-danger-5" : "text-text-3"}`}
              title={subtitle}
            >
              {subtitle}
            </span>
          )}
        </EventBlockHeader>

        {hasPrompt && (
          <div className="px-3.5 py-2.5">
            <SubagentPromptPreview prompt={prompt as string} />
          </div>
        )}

        {isFailure && hasErrorMessage && (
          <div
            className={`${hasPrompt ? "border-t border-fill-3" : ""} px-3.5 py-2.5 ${SESSION_UI_TOKENS.FONT_SIZE_SM} leading-relaxed text-danger-5`}
          >
            {errorMessage}
          </div>
        )}

        {!hasPrompt && !isFailure && !isLoading && summary && (
          <div
            className={`px-3.5 py-2.5 ${SESSION_UI_TOKENS.FONT_SIZE_SM} leading-relaxed ${SESSION_UI_TOKENS.TEXT.SECONDARY}`}
          >
            {summary}
          </div>
        )}

        {isLoading && !hasPrompt && (
          <div
            className={`px-3.5 py-2.5 ${SESSION_UI_TOKENS.FONT_SIZE_SM} ${EVENT_LOADING_SHIMMER_TEXT_CLASSES}`}
          >
            {t("tools.runningSubagent")}
          </div>
        )}
      </div>
    );
  }
);

SubagentBlock.displayName = "SubagentBlock";

export default SubagentBlock;
