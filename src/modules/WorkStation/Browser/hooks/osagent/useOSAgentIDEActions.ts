/**
 * useOSAgentIDEActions Hook
 *
 * Bridges global agent GUI-control requests to the frontend ActionSystem.
 *
 * Behaviour today:
 *   - category === "session" → dispatched normally (required for manage_session)
 *   - layer === "gui" → dispatched only while global Agent Control is on
 *   - layer === "action" → rejected when a native backend tool should be used
 *
 * Bridges the OS agent's `ide` tool to the frontend ActionSystem.
 * Listens for `agent-ide-action` CustomEvents (dispatched by the OS agent event handlers),
 * executes the requested action via zodActionRegistry, and reports the result
 * back to the Rust backend via the `agent_ide_action_result` Tauri command.
 *
 * Also ensures that ActionSystem actions are registered (via registerCoreActions)
 * so they're available even if the Workstation editor isn't mounted.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import {
  ACTION_ID,
  initializeServices,
  registerCoreActions,
  zodActionRegistry,
} from "@src/ActionSystem";
import { sendIdeActionResult } from "@src/api/tauri/agent";
import { currentRepoAtom } from "@src/store/repo";
import { guiControlEnabledAtom } from "@src/store/ui/uiAtom";

const GUI_CONTROL_REQUIRED_MESSAGE =
  "Agent Control is off. Toggle Agent Control on to allow GUI automation actions.";

// ============================================
// Types
// ============================================

type IDEActionOperation = "list" | "inspect" | "dispatch";

interface IDEActionDetail {
  correlationId: string;
  action?: string;
  params: Record<string, unknown>;
  operation?: IDEActionOperation;
  sessionId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseIdeActionEnvelope(rawMessage: string): IDEActionDetail | null {
  const parsed = JSON.parse(rawMessage) as unknown;
  if (!isRecord(parsed) || parsed.type !== "agent:ide_action") return null;
  const payload = parsed.payload;
  if (!isRecord(payload)) return null;

  const correlationId = payload.correlationId;
  if (typeof correlationId !== "string" || correlationId.length === 0) {
    return null;
  }

  const operation = payload.operation;
  const action = payload.action;
  const params = payload.params;
  const sessionId = payload.sessionId;

  return {
    correlationId,
    ...(operation === "list" ||
    operation === "inspect" ||
    operation === "dispatch"
      ? { operation }
      : {}),
    ...(typeof action === "string" ? { action } : {}),
    params: isRecord(params) ? params : {},
    ...(typeof sessionId === "string" ? { sessionId } : {}),
  };
}

function dispatchIdeActionDetail(detail: IDEActionDetail): void {
  window.dispatchEvent(
    new CustomEvent("agent-ide-action", {
      detail,
    })
  );
}

function getStringParam(
  params: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = params?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function matchesGuiManifestQuery(
  action: ReturnType<
    typeof zodActionRegistry.getGUIControlManifest
  >["actions"][number],
  query: string
): boolean {
  const haystack = [
    action.id,
    action.category,
    action.description,
    action.longDescription,
    ...(action.tags ?? []),
    ...(action.examples ?? []),
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

// ============================================
// Hook
// ============================================

/**
 * Listens for IDE action requests from the OS agent and dispatches them
 * through the ActionSystem. Reports results back via Tauri command.
 *
 * Must be mounted inside a component tree that has Jotai provider (for repo atom).
 */
export function useOSAgentIDEActions(): void {
  const currentRepo = useAtomValue(currentRepoAtom);
  const guiControlEnabled = useAtomValue(guiControlEnabledAtom);
  const cleanupRef = useRef<(() => void) | null>(null);
  const guiControlEnabledRef = useRef(false);
  const handledCorrelationIdsRef = useRef<Set<string>>(new Set());
  const repoPathRef = useRef<string>("");

  useEffect(() => {
    repoPathRef.current = currentRepo?.path ?? "";
  }, [currentRepo?.path]);

  useEffect(() => {
    guiControlEnabledRef.current = guiControlEnabled;
  }, [guiControlEnabled]);

  useEffect(() => {
    const sessionId = "";
    const channel = new Channel<string>();
    let cancelled = false;
    let channelId: number | null = null;

    channel.onmessage = (rawMessage: string) => {
      if (cancelled) return;
      try {
        const detail = parseIdeActionEnvelope(rawMessage);
        if (detail) dispatchIdeActionDetail(detail);
      } catch {
        return;
      }
    };

    invoke<number>("subscribe_session_events", {
      sessionId,
      onEvent: channel,
    })
      .then((id) => {
        if (cancelled) {
          void invoke("unsubscribe_session_events", {
            sessionId,
            channelId: id,
          });
          return;
        }
        channelId = id;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      channel.onmessage = () => undefined;
      if (channelId !== null) {
        void invoke("unsubscribe_session_events", { sessionId, channelId });
      }
    };
  }, []);

  // Register actions and listen for IDE action events
  useEffect(() => {
    const repoPath = currentRepo?.path ?? "";
    const repoId = currentRepo?.id;

    // Ensure ActionSystem actions are registered (ref counted — safe if
    // Workstation has already registered them). This means IDE actions are
    // available even when the user isn't looking at the Code Editor.
    if (repoPath) {
      initializeServices(repoPath, repoId).catch(() => {
        // Best effort — services may already be initialized
      });
      cleanupRef.current = registerCoreActions(repoPath);
    }

    async function handleIDEAction(evt: Event) {
      const detail = (evt as CustomEvent<IDEActionDetail>).detail;
      if (!detail?.correlationId) return;

      if (handledCorrelationIdsRef.current.has(detail.correlationId)) return;
      handledCorrelationIdsRef.current.add(detail.correlationId);
      if (handledCorrelationIdsRef.current.size > 100) {
        const oldestCorrelationId = handledCorrelationIdsRef.current
          .values()
          .next().value;
        if (oldestCorrelationId)
          handledCorrelationIdsRef.current.delete(oldestCorrelationId);
      }

      const { correlationId, params } = detail;
      const operation = detail.operation ?? "dispatch";
      const action = detail.action ?? getStringParam(params, "action");

      try {
        if (operation === "list") {
          const query = getStringParam(params, "query");
          const inspectResult = await zodActionRegistry.execute(
            ACTION_ID.GUI_INSPECT,
            {
              ...(query ? { query } : {}),
            }
          );
          await sendIdeActionResult(correlationId, {
            success: inspectResult.success,
            message: inspectResult.message ?? "Collected GUI manifest",
            data: inspectResult.data,
          });
          return;
        }

        if (operation === "inspect") {
          const targetAction = action ?? getStringParam(params, "actionId");
          const manifest = zodActionRegistry.getGUIControlManifest();
          const query = getStringParam(params, "query");
          const actions = targetAction
            ? manifest.actions.filter(
                (manifestAction) => manifestAction.id === targetAction
              )
            : query
              ? manifest.actions.filter((manifestAction) =>
                  matchesGuiManifestQuery(manifestAction, query)
                )
              : manifest.actions;

          await sendIdeActionResult(correlationId, {
            success: targetAction ? actions.length === 1 : true,
            message:
              targetAction && actions.length === 0
                ? `Unknown GUI action: ${targetAction}`
                : `Inspected ${actions.length} GUI action${actions.length === 1 ? "" : "s"}`,
            data: { actions },
          });
          return;
        }

        if (!action) {
          await sendIdeActionResult(correlationId, {
            success: false,
            message: "Missing action for GUI dispatch",
          });
          return;
        }

        // Check if actions are registered (registry might be empty if no repo is selected)
        if (!zodActionRegistry.has(action)) {
          // Return a helpful error listing available IDE-exposed actions
          const ideActions = zodActionRegistry.getIDEExposedActions();
          const availableIds = ideActions.map((act) => act.meta.id);
          const message =
            availableIds.length === 0
              ? `No IDE actions are registered. A repo must be selected in the IDE.`
              : `Unknown action: "${action}". Available IDE actions: ${availableIds.slice(0, 20).join(", ")}${availableIds.length > 20 ? ` (and ${availableIds.length - 20} more)` : ""}`;

          await sendIdeActionResult(correlationId, {
            success: false,
            message,
          });
          return;
        }

        // Check layer — reject "action" layer actions that have native
        // backend equivalents (the agent should call the native tool
        // directly instead). Exception: "session" category actions are
        // always allowed (designed for ActionBridge / manage_session).
        const actionLayer = zodActionRegistry.getActionLayer(action);
        const actionObj = zodActionRegistry.get(action);
        const category = actionObj?.meta.category ?? "";

        const isReadOnlyGuiInspect = action === ACTION_ID.GUI_INSPECT;

        // Session actions are backend session control; GUI-layer actions require the explicit global toggle.
        if (
          !isReadOnlyGuiInspect &&
          !guiControlEnabledRef.current &&
          category !== "session"
        ) {
          await sendIdeActionResult(correlationId, {
            success: false,
            message: `${GUI_CONTROL_REQUIRED_MESSAGE} (action="${action}")`,
          });
          return;
        }

        if (actionLayer === "action" && category !== "session") {
          const nativeToolHints: Record<string, string> = {
            git: 'Use the native "git" tool instead',
            search: 'Use the native "code_search" tool instead',
            terminal: 'Use the native "run_shell" tool instead',
            file: 'Use the native "edit_file" or "run_shell" tool instead',
            test: 'Use the native "run_shell" tool to run test commands instead',
          };
          const hint =
            nativeToolHints[category] ?? "Use the corresponding native tool";

          await sendIdeActionResult(correlationId, {
            success: false,
            message: `Action "${action}" has a native backend equivalent and is not available via the ide tool. ${hint}.`,
          });
          return;
        }

        const result = await zodActionRegistry.execute(action, params);

        await sendIdeActionResult(correlationId, {
          success: result.success,
          message:
            result.message ??
            (result.success
              ? `Action "${action}" completed successfully`
              : `Action "${action}" failed`),
          data: result.data,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        await sendIdeActionResult(correlationId, {
          success: false,
          message: `IDE action dispatch error: ${errorMessage}`,
        }).catch(() => {});
      }
    }

    window.addEventListener("agent-ide-action", handleIDEAction);

    return () => {
      window.removeEventListener("agent-ide-action", handleIDEAction);
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [currentRepo?.path, currentRepo?.id]);
}
