/**
 * ThinkBubble Component
 *
 * Renders an agent "thinking" message bubble with avatar,
 * timestamp, and markdown content. Shows a random placeholder
 * when the thinking content is empty.
 */
import { Sparkle } from "lucide-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import Markdown from "@src/components/MarkDown";
import { SESSION_UI_TOKENS } from "@src/engines/ChatPanel/blocks/primitives/config";
import {
  formatSmartDateTime,
  toIntlLocaleTag,
} from "@src/util/data/formatters/date";

import type { MessageEntry } from "./types";

// ============================================
// Random Empty Thinking Messages
// ============================================

function parseEmptyThinkingMessagesPool(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === "string");
}

function getRandomEmptyThinkingMessage(
  pool: readonly string[],
  seed: string | undefined
): string {
  if (pool.length === 0) {
    return "";
  }
  if (!seed) {
    return pool[0] ?? "";
  }
  let hash = 0;
  for (let index = 0; index < seed.length; index++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }
  const idx = Math.abs(hash) % pool.length;
  return pool[idx] ?? pool[0] ?? "";
}

// ============================================
// ThinkBubble
// ============================================

export const ThinkBubble: React.FC<{
  message: MessageEntry;
  isLatest?: boolean;
  onClick?: () => void;
}> = ({ message, isLatest = false, onClick }) => {
  const { t, i18n } = useTranslation("sessions");

  const emptyThinkingPool = useMemo(() => {
    const raw = t("simulator.replay.messages.think.emptyMessages", {
      returnObjects: true,
    });
    return parseEmptyThinkingMessagesPool(raw);
  }, [t]);

  const displayContent = useMemo(() => {
    if (!message.content || message.content.trim() === "") {
      const picked = getRandomEmptyThinkingMessage(
        emptyThinkingPool,
        message.eventId
      );
      if (picked !== "") {
        return picked;
      }
      return t("simulator.replay.messages.think.labelThought");
    }
    return message.content;
  }, [emptyThinkingPool, message.content, message.eventId, t]);

  const isEmpty = !message.content || message.content.trim() === "";

  return (
    <div className="flex gap-3" onClick={onClick}>
      {/* Avatar */}
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-1">
        <Sparkle size={14} className="text-primary-6" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span
            className={`${SESSION_UI_TOKENS.FONT_SIZE_BASE} font-medium text-text-1`}
          >
            {isLatest
              ? t("simulator.replay.messages.think.labelLatest")
              : t("simulator.replay.messages.think.labelThought")}
          </span>
          <span className="text-[11px] text-text-3">
            {formatSmartDateTime(message.timestamp, {
              yesterdayLabel: t(
                "simulator.replay.messages.bubble.smartDateYesterday"
              ),
              locale: toIntlLocaleTag(i18n.resolvedLanguage),
            })}
          </span>
        </div>
        <div
          className={`inline-block rounded-lg p-3 text-text-1 ${isLatest ? "bg-primary-1" : "bg-fill-2"}`}
        >
          {isEmpty ? (
            <div
              className={`${SESSION_UI_TOKENS.FONT_SIZE_BASE} italic leading-relaxed text-text-3`}
            >
              {displayContent}
            </div>
          ) : (
            <div
              className={`activity-thinking activity-thinking--no-style allow-select ${SESSION_UI_TOKENS.TEXT.BODY_BASE}`}
            >
              <Markdown textContent={displayContent} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
