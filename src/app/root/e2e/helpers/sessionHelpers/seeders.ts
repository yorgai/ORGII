import { loadSessionAtom, sessionIdAtom } from "@src/engines/SessionCore";
import { navigateToEventAtom } from "@src/engines/SessionCore/core/atoms";
import { derivedSnapshotAtom } from "@src/engines/SessionCore/core/atoms/events";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { AppType } from "@src/engines/Simulator/types/appTypes";
import {
  isPendingCancelAtom,
  sessionRuntimeStatusAtom,
} from "@src/store/session/cliSessionStatusAtom";
import {
  pendingPlanApprovalsAtom,
  upsertPendingPlanApproval,
} from "@src/store/session/planApprovalAtom";
import {
  type Session,
  sessionsAtom,
  upsertSession,
} from "@src/store/session/sessionAtom";
import { updateShellProcessAtom } from "@src/store/session/shellProcessAtom";
import {
  activeSessionIdAtom,
  openSessionAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session/viewAtom";
import {
  chatPanelMaximizedAtom,
  chatWidthAtom,
} from "@src/store/ui/chatPanelAtom";
import {
  simulatorFollowAppLockAtom,
  simulatorSelectedAppAtom,
  stationModeAtom,
} from "@src/store/ui/simulatorAtom";

import { asError } from "../../result";
import type { E2EStore, Json, Result } from "../../types";
import { waitForSessionSurface } from "./waitForSessionSurface";

export function createSessionSeederHelpers(store: E2EStore) {
  const seedChatEvents = async (
    sessionId: string,
    events: Json[],
    options?: {
      chatPanelMaximized?: boolean;
      chatWidth?: number;
      currentEventId?: string;
      runtimeStatus?:
        | "idle"
        | "running"
        | "installing"
        | "waiting_for_user"
        | "waiting_for_funds";
      stationMode?: "my-station" | "agent-station";
      selectedApp?: "CODE_EDITOR";
    }
  ): Promise<Result<{ eventCount: number; chatEventCount: number }>> => {
    try {
      if (!sessionId) {
        return { ok: false, error: "seedChatEvents: `sessionId` is required" };
      }
      const sessionEvents = events as unknown as SessionEvent[];
      store.set(stationModeAtom, options?.stationMode ?? "my-station");
      store.set(chatPanelMaximizedAtom, options?.chatPanelMaximized ?? true);
      store.set(chatWidthAtom, options?.chatWidth ?? 560);
      store.set(activeSessionIdAtom, sessionId);
      store.set(workstationActiveSessionIdAtom, sessionId);
      await waitForSessionSurface(sessionId);
      await eventStoreProxy.set(sessionEvents, sessionId);
      store.set(loadSessionAtom, { sessionId, events: sessionEvents });

      await new Promise((resolve) => window.setTimeout(resolve, 100));
      await eventStoreProxy.set(sessionEvents, sessionId);
      store.set(loadSessionAtom, { sessionId, events: sessionEvents });

      const snapshot = await eventStoreProxy.getSnapshot(sessionId);
      store.set(derivedSnapshotAtom, snapshot);
      if (options?.runtimeStatus) {
        store.set(sessionRuntimeStatusAtom, options.runtimeStatus);
      }
      if (options?.selectedApp === "CODE_EDITOR") {
        store.set(simulatorSelectedAppAtom, AppType.CODE_EDITOR);
        store.set(simulatorFollowAppLockAtom, AppType.CODE_EDITOR);
      } else {
        store.set(simulatorSelectedAppAtom, null);
        store.set(simulatorFollowAppLockAtom, null);
      }
      if (options?.currentEventId) {
        store.set(navigateToEventAtom, options.currentEventId);
      }
      return {
        ok: true,
        eventCount: snapshot.eventCount,
        chatEventCount: snapshot.chatEvents.length,
      };
    } catch (err) {
      return asError(err);
    }
  };

  const seedModeSwitchSession = async (input: {
    sessionId?: string;
    repoPath?: string;
    userText: string;
    reason?: string;
    targetMode?: string;
  }): Promise<Result<{ sessionId: string; eventId: string }>> => {
    try {
      const now = new Date().toISOString();
      const sessionId =
        input.sessionId ?? `sdeagent-e2e-mode-switch-${Date.now()}`;
      const switchEventId = `${sessionId}-suggest-mode-switch`;
      const existingSession = store
        .get(sessionsAtom)
        .find((candidate) => candidate.session_id === sessionId);
      const session: Session = existingSession ?? {
        session_id: sessionId,
        status: "idle",
        created_at: now,
        updated_at: now,
        user_input: input.userText,
        name: input.userText.slice(0, 80),
        repoPath: input.repoPath,
        category: "rust_agent",
        agentDefinitionId: "builtin:sde",
        agentDisplayName: "SDE Agent",
        agentExecMode: "build",
        model: "composer-2",
        is_active: true,
      };
      upsertSession(session);
      store.set(stationModeAtom, "my-station");
      store.set(chatPanelMaximizedAtom, true);
      store.set(chatWidthAtom, 560);
      store.set(openSessionAtom, {
        sessionId,
        sessionName: session.name,
        repoPath: input.repoPath,
      });
      store.set(sessionIdAtom, sessionId);
      store.set(sessionRuntimeStatusAtom, "idle");
      store.set(isPendingCancelAtom, false);
      await waitForSessionSurface(sessionId);

      const events: SessionEvent[] = [
        {
          chunk_id: null,
          id: `${sessionId}-user`,
          sessionId,
          createdAt: now,
          functionName: "user_message",
          uiCanonical: "user_message",
          actionType: "raw",
          args: {},
          result: { type: "user", message: input.userText },
          source: "user",
          displayText: input.userText,
          displayStatus: "completed",
          displayVariant: "message",
          activityStatus: "processed",
        },
        {
          chunk_id: null,
          id: switchEventId,
          sessionId,
          createdAt: now,
          functionName: "suggest_mode_switch",
          uiCanonical: "suggest_mode_switch",
          actionType: "tool_call",
          args: {
            target_mode: input.targetMode ?? "plan",
            reason:
              input.reason ??
              "This task should be planned before implementation.",
          },
          result: {},
          source: "assistant",
          displayText: "Switch to Plan mode",
          displayStatus: "awaiting_user",
          displayVariant: "tool_call",
          activityStatus: "pending",
          callId: switchEventId,
        },
      ];
      await eventStoreProxy.set(events, sessionId);
      store.set(loadSessionAtom, { sessionId, events });
      const snapshot = await eventStoreProxy.getSnapshot(sessionId);
      store.set(derivedSnapshotAtom, snapshot);
      await waitForSessionSurface(sessionId);
      return { ok: true, sessionId, eventId: switchEventId };
    } catch (err) {
      return asError(err);
    }
  };

  const seedPlanCard = async (input: {
    sessionId: string;
    title?: string;
    content: string;
  }): Promise<Result<{ planRevisionId: string }>> => {
    try {
      const planRevisionId = `${input.sessionId}-plan-revision`;
      const planId = `${input.sessionId}-plan`;
      const now = new Date().toISOString();
      const existing = await eventStoreProxy.getSnapshot(input.sessionId);
      const events: SessionEvent[] = [
        ...existing.events,
        {
          chunk_id: null,
          id: planRevisionId,
          sessionId: input.sessionId,
          createdAt: now,
          functionName: "plan_approval",
          uiCanonical: "plan_approval",
          actionType: "plan_approval",
          args: {
            title: input.title ?? "E2E Plan",
            content: input.content,
            planId,
            planRevisionId,
            originToolCallId: planRevisionId,
            planEventSource: "e2e",
            planPath: "/tmp/orgii-e2e-plan.md",
          },
          result: {
            status: "pending",
            planId,
            planRevisionId,
            planPath: "/tmp/orgii-e2e-plan.md",
          },
          source: "assistant",
          displayText: input.title ?? "E2E Plan",
          displayStatus: "awaiting_user",
          displayVariant: "tool_call",
          activityStatus: "agent",
          callId: planRevisionId,
        },
      ];
      store.set(pendingPlanApprovalsAtom, (prev) =>
        upsertPendingPlanApproval(prev, {
          sessionId: input.sessionId,
          planPath: "/tmp/orgii-e2e-plan.md",
          planTitle: input.title ?? "E2E Plan",
          planContent: input.content,
          toolCallId: planRevisionId,
          planId,
          planRevisionId,
          originToolCallId: planRevisionId,
        })
      );
      store.set(sessionRuntimeStatusAtom, "idle");
      await eventStoreProxy.set(events, input.sessionId);
      store.set(loadSessionAtom, { sessionId: input.sessionId, events });
      const snapshot = await eventStoreProxy.getSnapshot(input.sessionId);
      store.set(derivedSnapshotAtom, snapshot);
      return { ok: true, planRevisionId };
    } catch (err) {
      return asError(err);
    }
  };

  const seedShellProcess = async (input: {
    sessionId: string;
    pid: number;
    command: string;
    logPath?: string;
    status?: "running" | "background";
  }): Promise<Result<{ sessionId: string; pid: number }>> => {
    try {
      if (!input.sessionId) {
        return {
          ok: false,
          error: "seedShellProcess: `sessionId` is required",
        };
      }
      if (!Number.isFinite(input.pid) || input.pid <= 0) {
        return {
          ok: false,
          error: "seedShellProcess: positive `pid` is required",
        };
      }
      store.set(updateShellProcessAtom, {
        type: "start",
        sessionId: input.sessionId,
        pid: input.pid,
        command: input.command,
        logPath: input.logPath,
      });
      if (input.status === "background") {
        store.set(updateShellProcessAtom, {
          type: "background",
          sessionId: input.sessionId,
          pid: input.pid,
        });
      }
      return { ok: true, sessionId: input.sessionId, pid: input.pid };
    } catch (err) {
      return asError(err);
    }
  };

  return {
    seedChatEvents,
    seedModeSwitchSession,
    seedPlanCard,
    seedShellProcess,
  };
}
