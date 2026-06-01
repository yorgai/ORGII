/**
 * useOSAgentIDEActions Hook
 *
 * ⚠️ GUI DISPATCH PARTIALLY DISABLED ⚠️
 * The `control_orgii` / GUI tool is unregistered on the Rust side for now
 * (agent uses native tools + Simulator for observation). However this hook
 * must stay mounted because the `manage_session` Rust tool routes through
 * the ActionBridge for `session.*` zod actions (create / list / intervene).
 *
 * Behaviour today:
 *   - category === "session" → dispatched normally (required for manage_session)
 *   - everything else → rejected with a clear error back to the agent
 *
 * When re-enabling GUI dispatch for cowork / voice mode:
 *   1. Set `GUI_DISPATCH_DISABLED` below to `false`.
 *   2. Re-enable the Rust `control_orgii` / gui tool registration in
 *      `src-tauri/src/agent_core/core/tools/registration/web.rs`.
 *   3. Add a per-agent UI knob for `executionMode` if WorkStation
 *      dispatch needs to be user-toggleable. The Rust
 *      `ResolvedAgent.execution_mode` field is still consumed by
 *      `ActionRouter` even without UI exposure.
 *
 * Original behaviour:
 * Bridges the OS agent's `ide` tool to the frontend ActionSystem.
 * Listens for `agent-ide-action` CustomEvents (dispatched by the OS agent event handlers),
 * executes the requested action via zodActionRegistry, and reports the result
 * back to the Rust backend via the `agent_ide_action_result` Tauri command.
 *
 * Also ensures that ActionSystem actions are registered (via registerCoreActions)
 * so they're available even if the Workstation editor isn't mounted.
 */
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import { sendIdeActionResult } from "@src/api/tauri/agent";
import {
  AI_VISUALIZER_CONFIG,
  getGlobalVisualizer,
} from "@src/components/AIActionVisualizer";
import {
  initializeServices,
  registerCoreActions,
  zodActionRegistry,
} from "@src/modules/WorkStation/ActionSystem";
import { currentRepoAtom } from "@src/store/repo";

/**
 * Feature flag: when true, only `session` category zod actions are dispatched.
 * All other IDE action requests return an error so the agent doesn't hang.
 * Flip to `false` to re-enable cowork / voice mode's live GUI control.
 */
const GUI_DISPATCH_DISABLED = true;

// ============================================
// Types
// ============================================

interface IDEActionDetail {
  correlationId: string;
  action: string;
  params: Record<string, unknown>;
  sessionId?: string;
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
  const cleanupRef = useRef<(() => void) | null>(null);
  const repoPathRef = useRef<string>("");

  useEffect(() => {
    repoPathRef.current = currentRepo?.path ?? "";
  }, [currentRepo?.path]);

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
      if (!detail?.correlationId || !detail?.action) return;

      const { correlationId, action, params } = detail;

      try {
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

        // GUI dispatch gate — while disabled, only `session` category actions
        // (needed by manage_session) are permitted. Everything else fails
        // loudly so the agent learns not to use GUI dispatch right now.
        if (GUI_DISPATCH_DISABLED && category !== "session") {
          await sendIdeActionResult(correlationId, {
            success: false,
            message: `GUI dispatch is temporarily disabled. Use the corresponding native Rust tool instead. (action="${action}")`,
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

        // ── AI cursor visualization (non-blocking) ──
        // Show the AI cursor for dispatch actions so the user can follow
        // what the agent is doing. Fire-and-forget; doesn't block execution.
        const visualizer = getGlobalVisualizer();
        if (visualizer) {
          const zodAction = zodActionRegistry.get(action);
          const description = zodAction?.meta.description ?? action;
          visualizer.show({
            actionType: action,
            payload: params,
            description,
          });
        }

        // Execute the action through the ActionSystem (Zod-validated)
        const result = await zodActionRegistry.execute(action, params);

        // Hide visualization after action completes
        if (visualizer) {
          setTimeout(() => {
            visualizer.hide();
          }, AI_VISUALIZER_CONFIG.highlightLingerDuration);
        }

        await sendIdeActionResult(correlationId, {
          success: result.success,
          message:
            result.message ??
            (result.success
              ? `Action "${action}" completed successfully`
              : `Action "${action}" failed`),
        });
      } catch (error) {
        const errorVisualizer = getGlobalVisualizer();
        if (errorVisualizer) {
          errorVisualizer.hide();
        }

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
