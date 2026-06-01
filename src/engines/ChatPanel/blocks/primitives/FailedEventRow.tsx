/**
 * FailedEventRow - Inline failed state for chat variant event components
 *
 * Renders a muted row (icon + label) when a tool event has status "failed".
 * The caller provides a fully-formed, tense-aware label (e.g. "Failed to read file.ts").
 */
import React from "react";

import { getToolIcon } from "@src/config/toolIcons";

import { EventBlockHeaderIcon } from "./EventBlockHeaderIcon";
import { SESSION_UI_TOKENS } from "./config";

interface FailedEventRowProps {
  /** Tool name for icon lookup */
  toolName: string;
  /** Fully-formed failed label (e.g. "Failed to read file.ts") */
  label: string;
  /** Optional action name for action-specific icon resolution */
  action?: string;
  detail?: string | null;
  eventId?: string;
}

export const FailedEventRow: React.FC<FailedEventRowProps> = ({
  toolName,
  label,
  action,
  detail,
  eventId,
}) => {
  const icon = getToolIcon(toolName, {
    size: SESSION_UI_TOKENS.ICON.SIZE_SM,
    action,
  });

  const trimmedDetail = detail?.trim();

  return (
    <div
      className={SESSION_UI_TOKENS.ROW.INLINE}
      data-tool-call-event-id={eventId}
      data-tool-call-name={toolName}
    >
      <EventBlockHeaderIcon icon={icon} isFailed />
      <span className={SESSION_UI_TOKENS.TEXT.TERTIARY}>
        {label}
        {trimmedDetail ? `: ${trimmedDetail}` : ""}
      </span>
    </div>
  );
};

FailedEventRow.displayName = "FailedEventRow";

export default FailedEventRow;
