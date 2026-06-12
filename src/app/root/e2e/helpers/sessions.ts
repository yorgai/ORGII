import { invoke } from "@tauri-apps/api/core";

import { getPendingPlanApproval } from "@src/api/tauri/agent";
import { promptDump } from "@src/api/tauri/agent/promptDump";
import { rpc } from "@src/api/tauri/rpc";
import { normalizeAgentExecMode } from "@src/config/sessionCreatorConfig";
import {
  clearSessionAtom,
  loadSessionAtom,
  sessionIdAtom,
} from "@src/engines/SessionCore";
import { resetTurnLifecycleForTests } from "@src/engines/SessionCore/control/turnLifecycle";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import {
  loadEvents,
  loadInitialTurnWindow,
} from "@src/engines/SessionCore/storage/cacheAdapter";
import { cliAdapter } from "@src/engines/SessionCore/sync/adapters";
import { getAdapterForSession } from "@src/engines/SessionCore/sync/types";
import { reposAtom, selectedRepoIdAtom } from "@src/store/repo/atoms";
import {
  type ContextUsageSnapshot,
  isPendingCancelAtom,
  lastUserMessageAtom,
  restoreToInputAtom,
  sessionContextTokensAtom,
  sessionContextUsageAtom,
  sessionRolledBackAtom,
  sessionRuntimeStatusAtom,
  streamRetryStatusAtom,
  userInitiatedCancelAtom,
} from "@src/store/session/cliSessionStatusAtom";
import {
  pendingPlanApprovalsAtom,
  upsertPendingPlanApproval,
} from "@src/store/session/planApprovalAtom";
import { upsertSession } from "@src/store/session/sessionAtom/mutations";
import type { Session } from "@src/store/session/sessionAtom/types";
import {
  activeSessionIdAtom,
  jumpToSessionAtom,
  openSessionAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session/viewAtom";
import { chatImageAttachmentsAtom } from "@src/store/ui/chatImageAtom";
import {
  CHAT_PANEL_CONTENT_MODE,
  DEFAULT_CHAT_PANEL_CREATE_TARGET,
  chatPanelContentModeAtom,
  chatPanelCreateTargetAtom,
  chatPanelMaximizedAtom,
  chatPanelSelectedWorkItemAtom,
  chatWidthAtom,
} from "@src/store/ui/chatPanelAtom";
import {
  messageQueueAtom,
  queueEditTargetAtom,
  queueFlushRequestAtom,
} from "@src/store/ui/messageQueueAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { workspaceFoldersAtom } from "@src/store/ui/workspaceFoldersAtom";
import { isCliSession } from "@src/util/session/sessionDispatch";

import { asError } from "../result";
import type { E2EStore, Json, Result } from "../types";
import { createInspectChatStateHelper } from "./sessionHelpers/inspectChatState";
import { createSessionSeederHelpers } from "./sessionHelpers/seeders";
import { waitForSessionSurface } from "./sessionHelpers/waitForSessionSurface";

function toStoreSession(record: {
  sessionId: string;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  userInput?: string | null;
  name?: string | null;
  category?: string | null;
  model?: string | null;
  keySource?: string | null;
  accountId?: string | null;
  workspacePath?: string | null;
  worktreePath?: string | null;
  worktreeBranch?: string | null;
  baseBranch?: string | null;
  mergeStatus?: string | null;
  workItemId?: string | null;
  projectSlug?: string | null;
  agentRole?: string | null;
  parentSessionId?: string | null;
  orgMemberId?: string | null;
  agentDefinitionId?: string | null;
  agentDisplayName?: string | null;
  agentExecMode?: string | null;
}): Session {
  return {
    session_id: record.sessionId,
    status: record.status ?? "idle",
    created_at: record.createdAt ?? "",
    updated_at: record.updatedAt ?? "",
    user_input: record.userInput ?? undefined,
    name: record.name ?? undefined,
    category: record.category === "cli_agent" ? "cli_agent" : "rust_agent",
    model: record.model ?? undefined,
    keySource: record.keySource === "hosted_key" ? "hosted_key" : "own_key",
    accountId: record.accountId ?? undefined,
    repoPath: record.workspacePath ?? undefined,
    worktreePath: record.worktreePath ?? undefined,
    worktreeBranch: record.worktreeBranch ?? undefined,
    baseBranch: record.baseBranch ?? undefined,
    mergeStatus:
      record.mergeStatus === "pending" ||
      record.mergeStatus === "merged" ||
      record.mergeStatus === "conflict" ||
      record.mergeStatus === "skipped" ||
      record.mergeStatus === "failed"
        ? record.mergeStatus
        : undefined,
    workItemId: record.workItemId ?? undefined,
    agentRole:
      record.agentRole === "coding" ||
      record.agentRole === "sde" ||
      record.agentRole === "review" ||
      record.agentRole === "orchestrator" ||
      record.agentRole === "custom" ||
      record.agentRole === "sub_agent"
        ? record.agentRole
        : undefined,
    parentSessionId: record.parentSessionId ?? undefined,
    orgMemberId: record.orgMemberId ?? undefined,
    agentDefinitionId: record.agentDefinitionId ?? undefined,
    agentDisplayName: record.agentDisplayName ?? undefined,
    agentExecMode: normalizeAgentExecMode(record.agentExecMode) ?? undefined,
    is_active: true,
  };
}

export function createSessionHelpers(store: E2EStore) {
  const promptDumpHelper = async (sessionId: string) => {
    try {
      if (!sessionId) {
        return {
          ok: false as const,
          error: "promptDump: `sessionId` is required",
        };
      }
      const dump = await promptDump(sessionId);
      return { ok: true as const, dump };
    } catch (err) {
      return asError(err);
    }
  };

  const getActiveSessionId = async (): Promise<
    Result<{ sessionId: string | null }>
  > => {
    try {
      const sessionId = store.get(activeSessionIdAtom);
      return { ok: true, sessionId };
    } catch (err) {
      return asError(err);
    }
  };

  const inspectCliSessionStatus = async (
    sessionId: string
  ): Promise<Result<{ session: Json | null }>> => {
    try {
      if (!sessionId) {
        return {
          ok: false,
          error: "inspectCliSessionStatus: `sessionId` is required",
        };
      }
      const session = (await invoke("cli_agent_status", {
        sessionId,
      })) as Json | null;
      return { ok: true, session };
    } catch (err) {
      return asError(err);
    }
  };

  const inspectCliHistoryMutation = async (
    sessionId: string
  ): Promise<Result<{ mutation: Json | null }>> => {
    try {
      if (!sessionId) {
        return {
          ok: false,
          error: "inspectCliHistoryMutation: `sessionId` is required",
        };
      }
      const mutation = (await invoke("cli_agent_history_mutation", {
        sessionId,
      })) as Json | null;
      return { ok: true, mutation };
    } catch (err) {
      return asError(err);
    }
  };

  const resetToNewSession = async (): Promise<{ ok: true } | Result<never>> => {
    try {
      store.set(clearSessionAtom);
      store.set(activeSessionIdAtom, null);
      store.set(workstationActiveSessionIdAtom, null);
      store.set(stationModeAtom, "my-station");
      store.set(chatPanelContentModeAtom, CHAT_PANEL_CONTENT_MODE.SESSION);
      store.set(chatPanelCreateTargetAtom, DEFAULT_CHAT_PANEL_CREATE_TARGET);
      store.set(chatPanelSelectedWorkItemAtom, null);
      store.set(chatPanelMaximizedAtom, true);
      store.set(chatWidthAtom, 560);
      store.set(sessionIdAtom, null);
      store.set(messageQueueAtom, []);
      store.set(queueEditTargetAtom, null);
      store.set(queueFlushRequestAtom, 0);
      resetTurnLifecycleForTests();
      store.set(chatImageAttachmentsAtom, []);
      store.set(isPendingCancelAtom, false);
      store.set(userInitiatedCancelAtom, false);
      store.set(sessionRuntimeStatusAtom, "idle");
      store.set(sessionContextTokensAtom, 0);
      store.set(sessionContextUsageAtom, null);
      store.set(streamRetryStatusAtom, null);
      store.set(restoreToInputAtom, null);
      store.set(lastUserMessageAtom, null);
      store.set(sessionRolledBackAtom, false);
      const timeoutAt = Date.now() + 20_000;
      while (Date.now() < timeoutAt) {
        const creatorShell = document.querySelector(
          '[data-testid="session-creator-chat-panel"]'
        );
        const chatInput = document.querySelector('[data-testid="chat-input"]');
        const composerEditor = document.querySelector(
          '[contenteditable="true"]'
        );
        if (creatorShell && chatInput && composerEditor) {
          return { ok: true };
        }
        store.set(activeSessionIdAtom, null);
        store.set(workstationActiveSessionIdAtom, null);
        store.set(sessionIdAtom, null);
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      const bodyText = document.body?.textContent?.slice(0, 500) ?? "";
      return {
        ok: false,
        error: `resetToNewSession: SessionCreator did not render after clearing session state; body=${JSON.stringify(bodyText)}`,
      };
    } catch (err) {
      return asError(err);
    }
  };

  const launchSession = async (
    params: Json
  ): Promise<Result<{ result: Json }>> => {
    try {
      const launchParams: Json = {
        category: "rust_agent",
        content: params.prompt ?? params.content ?? "",
        ...params,
      };
      if (typeof launchParams.workspacePath !== "string") {
        const repos = store.get(reposAtom);
        const selectedRepoId = store.get(selectedRepoIdAtom);
        const selectedRepo =
          repos.find((repo) => repo.id === selectedRepoId) ?? repos[0];
        if (selectedRepo?.path) {
          launchParams.workspacePath = selectedRepo.path;
        }
      }
      const workspacePath =
        launchParams.workspacePath ?? launchParams.workspace_path;
      const additionalDirectories =
        launchParams.additionalDirectories ??
        launchParams.additional_directories ??
        (() => {
          if (typeof workspacePath !== "string" || workspacePath.length === 0) {
            return undefined;
          }
          const normalize = (path: string) => path.replace(/\/+$/, "");
          const normalizedProject = normalize(workspacePath);
          const folders = store.get(workspaceFoldersAtom);
          const workspaceIncludesProject = folders.some(
            (folder) => normalize(folder.path) === normalizedProject
          );
          if (!workspaceIncludesProject) return undefined;
          const extras = folders
            .map((folder) => normalize(folder.path))
            .filter((path) => path && path !== normalizedProject);
          return extras.length > 0 ? extras : undefined;
        })();
      const rustParams = {
        ...launchParams,
        workspace_path: workspacePath,
        key_source: launchParams.keySource ?? launchParams.key_source,
        account_id: launchParams.accountId ?? launchParams.account_id,
        native_harness_type:
          launchParams.nativeHarnessType ?? launchParams.native_harness_type,
        hosted_token: launchParams.hostedToken ?? launchParams.hosted_token,
        agent_definition_id:
          launchParams.agentDefinitionId ?? launchParams.agent_definition_id,
        agent_org_id: launchParams.agentOrgId ?? launchParams.agent_org_id,
        work_item_id: launchParams.workItemId ?? launchParams.work_item_id,
        agent_role: launchParams.agentRole ?? launchParams.agent_role,
        worktree_path: launchParams.worktreePath ?? launchParams.worktree_path,
        project_slug: launchParams.projectSlug ?? launchParams.project_slug,
        additionalDirectories,
      };
      const result = (await invoke("session_launch", {
        params: rustParams,
      })) as Json;
      if (result && typeof result === "object") {
        (result as Json).__e2eLaunchParams = {
          workspace_path: rustParams.workspace_path,
          additionalDirectories: rustParams.additionalDirectories,
          workspaceFolders: store.get(workspaceFoldersAtom),
          selectedRepoId: store.get(selectedRepoIdAtom),
        };
      }
      const sessionId =
        typeof result.sessionId === "string"
          ? result.sessionId
          : typeof result.session_id === "string"
            ? result.session_id
            : null;
      if (sessionId) {
        store.set(activeSessionIdAtom, sessionId);
        store.set(workstationActiveSessionIdAtom, sessionId);
        await waitForSessionSurface(sessionId);
      }
      return { ok: true, result };
    } catch (err) {
      return asError(err);
    }
  };

  const openSession = async (
    sessionId: string
  ): Promise<Result<{ sessionId: string }>> => {
    try {
      if (!sessionId) {
        return { ok: false, error: "openSession: `sessionId` is required" };
      }
      const directSession = await rpc.agentSession.getSession({ sessionId });
      if (directSession) {
        upsertSession(toStoreSession(directSession));
      }
      const sessionName =
        typeof directSession?.name === "string"
          ? directSession.name
          : undefined;
      const repoPath =
        typeof directSession?.workspacePath === "string"
          ? directSession.workspacePath
          : undefined;

      store.set(stationModeAtom, "my-station");
      store.set(chatPanelContentModeAtom, CHAT_PANEL_CONTENT_MODE.SESSION);
      store.set(chatPanelCreateTargetAtom, DEFAULT_CHAT_PANEL_CREATE_TARGET);
      store.set(chatPanelSelectedWorkItemAtom, null);
      store.set(chatPanelMaximizedAtom, true);
      store.set(chatWidthAtom, 560);
      store.set(openSessionAtom, { sessionId, sessionName, repoPath });
      store.set(sessionIdAtom, sessionId);
      store.set(sessionRuntimeStatusAtom, "idle");
      await eventStoreProxy.switchSession(sessionId);
      const initialWindow = await loadInitialTurnWindow(sessionId);
      let events =
        initialWindow.turns.length > 0
          ? initialWindow.events
          : await loadEvents(sessionId);
      if (events.length === 0) {
        const adapter = isCliSession(sessionId)
          ? cliAdapter
          : getAdapterForSession(sessionId);
        const controller = new AbortController();
        events = adapter
          ? await adapter.loadHistory(sessionId, controller.signal)
          : [];
      }
      if (events.length > 0) {
        await eventStoreProxy.set(events, sessionId);
      }
      store.set(loadSessionAtom, { sessionId, events, isFromCache: true });
      const pendingPlan = await getPendingPlanApproval(sessionId);
      if (pendingPlan) {
        store.set(pendingPlanApprovalsAtom, (prev) =>
          upsertPendingPlanApproval(prev, pendingPlan)
        );
      }
      store.set(jumpToSessionAtom, sessionId);
      store.set(activeSessionIdAtom, sessionId);
      store.set(workstationActiveSessionIdAtom, sessionId);
      await waitForSessionSurface(sessionId);
      await new Promise((resolve) => window.setTimeout(resolve, 150));
      store.set(activeSessionIdAtom, sessionId);
      store.set(workstationActiveSessionIdAtom, sessionId);
      return { ok: true, sessionId };
    } catch (err) {
      return asError(err);
    }
  };

  const getSessionAggregateRowFromList = async (
    sessionId: string
  ): Promise<Result<{ session: Json | null; diagnostics?: Json }>> => {
    try {
      if (!sessionId) {
        return {
          ok: false,
          error: "getSessionAggregateRowFromList: `sessionId` is required",
        };
      }
      const listed = await rpc.sessionAggregate.list({
        filter: {
          category: "agent",
          limit: 200,
          sortBy: "updated_at",
          sortOrder: "desc",
        },
      });
      const aggregateSession =
        listed.sessions.find((row) => row.sessionId === sessionId) ?? null;
      return {
        ok: true,
        session: aggregateSession as unknown as Json | null,
        diagnostics: {
          source: aggregateSession ? "aggregate" : "missing",
          aggregateCount: listed.sessions.length,
          aggregateSampleIds: listed.sessions
            .slice(0, 10)
            .map((row) => row.sessionId),
        } as unknown as Json,
      };
    } catch (err) {
      return asError(err);
    }
  };

  const getSessionAggregateRow = async (
    sessionId: string
  ): Promise<Result<{ session: Json | null; diagnostics?: Json }>> => {
    try {
      if (!sessionId) {
        return {
          ok: false,
          error: "getSessionAggregateRow: `sessionId` is required",
        };
      }
      const directSession = await rpc.agentSession.getSession({ sessionId });
      if (directSession) {
        return {
          ok: true,
          session: {
            ...directSession,
            category: "rust_agent",
          } as unknown as Json,
          diagnostics: { source: "direct" } as unknown as Json,
        };
      }

      return getSessionAggregateRowFromList(sessionId);
    } catch (err) {
      return asError(err);
    }
  };

  const seedSessionContextUsage = async (
    usage: Json
  ): Promise<Result<{ usedTokens: number }>> => {
    try {
      const usedTokens =
        usage &&
        typeof usage === "object" &&
        typeof usage.usedTokens === "number"
          ? usage.usedTokens
          : null;
      if (usedTokens === null) {
        return {
          ok: false,
          error: "seedSessionContextUsage: `usedTokens` is required",
        };
      }
      store.set(sessionContextTokensAtom, usedTokens);
      store.set(
        sessionContextUsageAtom,
        usage as unknown as ContextUsageSnapshot
      );
      return { ok: true, usedTokens };
    } catch (err) {
      return asError(err);
    }
  };

  const seeders = createSessionSeederHelpers(store);

  return {
    promptDump: promptDumpHelper,
    getActiveSessionId,
    inspectCliSessionStatus,
    inspectCliHistoryMutation,
    resetToNewSession,
    openSession,
    launchSession,
    getSessionAggregateRow,
    getSessionAggregateRowFromList,
    seedSessionContextUsage,
    seedChatEvents: seeders.seedChatEvents,
    seedModeSwitchSession: seeders.seedModeSwitchSession,
    seedPlanCard: seeders.seedPlanCard,
    seedShellProcess: seeders.seedShellProcess,
    seedSubagentJob: seeders.seedSubagentJob,
    debugSeedSubagentJobWire: seeders.debugSeedSubagentJobWire,
    killSubagentJobWire: seeders.killSubagentJobWire,
    inspectChatState: createInspectChatStateHelper(store),
  };
}
