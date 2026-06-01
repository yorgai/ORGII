/**
 * NewEventDivider
 *
 * Thin primary-6 horizontal rule with a centered label. Subagent panes
 * render one above each turn's last visible event so the user can spot
 * the freshest activity at a glance — same affordance the Communication
 * "MessageViewer" uses, scoped to the chat-event stream instead of
 * the messages stream.
 */
import React, { memo } from "react";

export const NewEventDivider: React.FC<{ label: string }> = memo(
  ({ label }) => (
    <div
      data-testid="chat-history-new-event-divider"
      className="flex items-center gap-3 py-1 text-[11px] font-medium text-primary-6"
    >
      <div className="h-px flex-1 bg-primary-6" />
      <span className="shrink-0">{label}</span>
      <div className="h-px flex-1 bg-primary-6" />
    </div>
  )
);

NewEventDivider.displayName = "NewEventDivider";

export default NewEventDivider;
