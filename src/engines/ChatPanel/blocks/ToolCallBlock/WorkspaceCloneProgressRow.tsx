/**
 * WorkspaceCloneProgressRow.
 *
 * Inline GitHub-Desktop-style progress strip rendered inside a
 * `manage_workspace` (`action: "clone"`) tool-call block while the Rust
 * `git clone --progress` stream is in flight.
 *
 * Wire path:
 *   git stderr → repo_service::clone_github_with_progress →
 *   manage_workspace tool callback → bus::broadcast_event(
 *     "agent:workspace_clone_progress") → handleWorkspaceCloneProgress →
 *   window CustomEvent → this component (filtered by toolCallId).
 *
 * The component is intentionally local state only — clone progress is a
 * transient UI signal that does not belong in the EventStore, the
 * persisted transcript, or a jotai atom that other surfaces consume.
 */
import React, { useEffect, useState } from "react";

import {
  AGENT_SIDE_CHANNEL_EVENTS,
  type AgentWorkspaceCloneProgressDetail,
} from "@src/engines/SessionCore/sync/adapters/rustAgent/eventHandlers/fileChangeHandlers";
import { createLogger } from "@src/hooks/logger";

const logger = createLogger("WorkspaceCloneProgressRow");

export interface WorkspaceCloneProgressRowProps {
  /** The tool_call_id the Rust side stamps onto each progress event. */
  toolCallId: string;
  /** The session that owns this tool call (used as an extra filter). */
  sessionId?: string;
}

interface ProgressState {
  phase: string;
  percent: number | null;
  /** Has any update been received yet? Drives the spinner-vs-bar choice. */
  hasUpdate: boolean;
}

const INITIAL_STATE: ProgressState = {
  phase: "Cloning",
  percent: null,
  hasUpdate: false,
};

const WorkspaceCloneProgressRow: React.FC<WorkspaceCloneProgressRowProps> = ({
  toolCallId,
  sessionId,
}) => {
  const [state, setState] = useState<ProgressState>(INITIAL_STATE);

  useEffect(() => {
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent<AgentWorkspaceCloneProgressDetail>)
        .detail;
      if (!detail) return;
      if (detail.toolCallId !== toolCallId) return;
      if (sessionId && detail.sessionId && detail.sessionId !== sessionId)
        return;

      setState((prev) => {
        const next: ProgressState = {
          phase: detail.phase || prev.phase,
          // Keep the last known percent across phase transitions that go
          // through `null` (e.g. "Counting objects: 1234, done." has no
          // percent). The bar feels jumpier if it snaps back to empty.
          percent:
            detail.percent !== null
              ? detail.percent
              : prev.percent !== null && detail.phase === prev.phase
                ? prev.percent
                : detail.percent,
          hasUpdate: true,
        };
        return next;
      });
    };

    window.addEventListener(
      AGENT_SIDE_CHANNEL_EVENTS.WORKSPACE_CLONE_PROGRESS,
      handler as EventListener
    );
    logger.debug(`mounted listener for toolCallId=${toolCallId}`);
    return () => {
      window.removeEventListener(
        AGENT_SIDE_CHANNEL_EVENTS.WORKSPACE_CLONE_PROGRESS,
        handler as EventListener
      );
    };
  }, [toolCallId, sessionId]);

  const hasBoundedPercent =
    state.percent !== null && Number.isFinite(state.percent);
  const ratio = hasBoundedPercent
    ? Math.max(0, Math.min(100, state.percent!)) / 100
    : null;

  return (
    <div
      className="flex flex-col gap-1 px-3 py-2 text-xs text-text-3"
      data-clone-progress={toolCallId}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {hasBoundedPercent ? (
            <span className="shrink-0 font-medium tabular-nums text-text-2">
              {Math.round(state.percent!)}%
            </span>
          ) : (
            <span
              className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary-6"
              aria-hidden="true"
            />
          )}
          <span className="truncate" title={state.phase}>
            {state.phase}
          </span>
        </div>
      </div>
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-fill-2">
        {ratio !== null ? (
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-primary-6 transition-[width] duration-150 ease-out"
            style={{ width: `${ratio * 100}%` }}
          />
        ) : (
          // Indeterminate barber-pole while the first update is in flight
          // or the current phase reports no percent (Counting objects, …).
          // Re-uses the global `progress-slide` keyframe defined in
          // `tailwind.config.js`.
          <div
            className="absolute top-0 h-full w-1/3 animate-progress-slide rounded-full bg-primary-6/70"
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
};

WorkspaceCloneProgressRow.displayName = "WorkspaceCloneProgressRow";

export default WorkspaceCloneProgressRow;
