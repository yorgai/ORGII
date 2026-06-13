/**
 * FailedEventRow - Inline failed state for chat variant event components
 *
 * Renders a muted row (icon + label) when a tool event has status "failed".
 * The caller provides a fully-formed, tense-aware label (e.g. "Failed to read file.ts").
 */
import { X } from "lucide-react";
import React from "react";

import { EventBlockHeaderIcon } from "./EventBlockHeaderIcon";
import {
  EventBlockHeaderSubtitle,
  EventBlockHeaderTitle,
} from "./EventBlockHeaderTextSlots";
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
  /**
   * Optional trailing slot for an inline remediation control (e.g. an
   * "Install" button when an LSP server is missing). Rendered right-aligned
   * after the detail subtitle.
   */
  trailingAction?: React.ReactNode;
}

export const FailedEventRow: React.FC<FailedEventRowProps> = ({
  toolName,
  label,
  detail,
  eventId,
  trailingAction,
}) => {
  const icon = (
    <X size={SESSION_UI_TOKENS.ICON.SIZE_SM} className="text-danger-6" />
  );
  const trimmedDetail = detail?.trim();

  return (
    <div
      className={SESSION_UI_TOKENS.ROW.INLINE}
      data-tool-call-event-id={eventId}
      data-tool-call-name={toolName}
    >
      <EventBlockHeaderIcon icon={icon} hasContent={false} />
      <EventBlockHeaderTitle className="text-danger-6">
        {label}
      </EventBlockHeaderTitle>
      {trimmedDetail && (
        <EventBlockHeaderSubtitle title={trimmedDetail}>
          {trimmedDetail}
        </EventBlockHeaderSubtitle>
      )}
      {trailingAction && (
        <div className="ml-auto shrink-0">{trailingAction}</div>
      )}
    </div>
  );
};

FailedEventRow.displayName = "FailedEventRow";

export default FailedEventRow;
