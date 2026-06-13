/**
 * useAgentToolEditor
 *
 * Per-agent tool editor. The per-tool availability state comes from the
 * backend (`agent_def_tool_states`) — capability satisfaction and the
 * excluded/user-allowed precedence are resolved ONLY in Rust, so the
 * Settings UI can never drift from what the session actually enables.
 * This hook edits only the per-tool deltas (`userAllowedTools` /
 * `excludedTools`) and re-fetches the resolved states after each save.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { rpc } from "@src/api/tauri/rpc";
import type { AgentToolStateRow } from "@src/api/tauri/rpc/schemas/agentDef";
import { createLogger } from "@src/hooks/logger";
import type {
  AgentDefinition,
  AgentToolSelection,
  CapabilitySet,
} from "@src/modules/MainApp/AgentOrgs/types";
import type { AgentKind } from "@src/modules/MainApp/Integrations/BuiltInTools/types";

const log = createLogger("useAgentToolEditor");

export type ToolEditorState = "system_pinned" | "enabled" | "disabled";

export interface AgentToolEditorState {
  loaded: boolean;
  builtIn: boolean;
  agentKind: AgentKind;
  capabilities: CapabilitySet;
  /** Allowlist authored by builtin definitions; read-only. `null` = no system restriction. */
  systemRestrictToTools: string[] | null;
  /** User additions on top of system pins. */
  userAllowedTools: Set<string>;
  /** User subtractions. */
  excludedTools: Set<string>;
  /**
   * Backend-resolved availability for a tool, or `undefined` when the
   * backend has no row for it (non-builtin names).
   */
  resolvedToolState: (toolName: string) => AgentToolStateRow | undefined;
  /**
   * Per-tool tri-state for rendering, derived from the backend rows.
   * - `system_pinned` — in the system allowlist.
   * - `enabled`  — effectively reachable at session resolve.
   * - `disabled` — effectively unreachable.
   */
  toolState: (toolName: string) => ToolEditorState;
  setUserAllowed: (toolName: string, allowed: boolean) => void;
  setExcluded: (toolName: string, excluded: boolean) => void;
}

function agentKindForDefinition(def: AgentDefinition): AgentKind {
  if (def.id === "builtin:os") return "os";
  if (def.id === "builtin:sde") return "sde";
  return "custom";
}

function parseTools(def: AgentDefinition): {
  systemRestrictToTools: string[] | null;
  userAllowedTools: string[];
  excludedTools: string[];
} {
  const tools: AgentToolSelection = def.tools ?? {};
  return {
    systemRestrictToTools: Array.isArray(tools.systemRestrictToTools)
      ? tools.systemRestrictToTools
      : null,
    userAllowedTools: Array.isArray(tools.userAllowedTools)
      ? tools.userAllowedTools
      : [],
    excludedTools: Array.isArray(tools.excludedTools)
      ? tools.excludedTools
      : [],
  };
}

export function useAgentToolEditor(agentId: string): AgentToolEditorState {
  const [loaded, setLoaded] = useState(false);
  const [builtIn, setBuiltIn] = useState(false);
  const [agentKind, setAgentKind] = useState<AgentKind>("custom");
  const [capabilities, setCapabilities] = useState<CapabilitySet>({});
  const [systemRestrictToTools, setSystemRestrictToTools] = useState<
    string[] | null
  >(null);
  const [userAllowedTools, setUserAllowedTools] = useState<string[]>([]);
  const [excludedTools, setExcludedTools] = useState<string[]>([]);
  const [resolvedStates, setResolvedStates] = useState<
    Map<string, AgentToolStateRow>
  >(new Map());

  const agentIdRef = useRef(agentId);
  useEffect(() => {
    agentIdRef.current = agentId;
  }, [agentId]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingToolsRef = useRef<{
    agentId: string;
    userAllowedTools: string[];
    excludedTools: string[];
  } | null>(null);

  const fetchResolvedStates = useCallback(async (id: string) => {
    try {
      const rows = await rpc.agentDef.toolStates({ agentId: id });
      setResolvedStates(new Map(rows.map((row) => [row.name, row])));
    } catch (err) {
      log.error("[useAgentToolEditor] toolStates failed:", err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      rpc.agentDef.get({ agentId }),
      rpc.agentDef.toolStates({ agentId }),
    ])
      .then(([def, rows]) => {
        if (cancelled) return;
        const typed = def as unknown as AgentDefinition;
        const parsed = parseTools(typed);
        setBuiltIn(Boolean(typed.builtIn));
        setAgentKind(agentKindForDefinition(typed));
        setCapabilities(typed.capabilities ?? {});
        setSystemRestrictToTools(parsed.systemRestrictToTools);
        setUserAllowedTools(parsed.userAllowedTools);
        setExcludedTools(parsed.excludedTools);
        setResolvedStates(new Map(rows.map((row) => [row.name, row])));
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          log.error("[useAgentToolEditor] load failed:", err);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const flushPendingTools = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingToolsRef.current;
    if (!pending) return;
    pendingToolsRef.current = null;

    rpc.agentDef
      .get({ agentId: pending.agentId })
      .then((def) => {
        const typed = def as unknown as AgentDefinition;
        const existing =
          typed.tools && typeof typed.tools === "object"
            ? { ...(typed.tools as AgentToolSelection) }
            : {};
        return rpc.agentDef.updatePatch({
          agentId: pending.agentId,
          patch: {
            tools: {
              ...existing,
              userAllowedTools: pending.userAllowedTools,
              excludedTools: pending.excludedTools,
            },
          },
        });
      })
      .then(() => fetchResolvedStates(pending.agentId))
      .catch((err: unknown) => {
        log.error("[useAgentToolEditor] persistTools failed:", err);
      });
  }, [fetchResolvedStates]);

  useEffect(() => {
    return () => {
      flushPendingTools();
    };
  }, [flushPendingTools]);

  const persistTools = useCallback(
    (nextUserAllowed: string[], nextExcluded: string[]) => {
      pendingToolsRef.current = {
        agentId: agentIdRef.current,
        userAllowedTools: nextUserAllowed,
        excludedTools: nextExcluded,
      };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flushPendingTools, 400);
    },
    [flushPendingTools]
  );

  const setUserAllowed = useCallback(
    (toolName: string, allowed: boolean) => {
      setUserAllowedTools((prev) => {
        const next = allowed
          ? prev.includes(toolName)
            ? prev
            : [...prev, toolName]
          : prev.filter((name) => name !== toolName);
        persistTools(next, excludedTools);
        return next;
      });
    },
    [excludedTools, persistTools]
  );

  const setExcluded = useCallback(
    (toolName: string, excluded: boolean) => {
      setExcludedTools((prev) => {
        const next = excluded
          ? prev.includes(toolName)
            ? prev
            : [...prev, toolName]
          : prev.filter((name) => name !== toolName);
        persistTools(userAllowedTools, next);
        return next;
      });
    },
    [userAllowedTools, persistTools]
  );

  const userAllowedSet = useMemo(
    () => new Set(userAllowedTools),
    [userAllowedTools]
  );
  const excludedSet = useMemo(() => new Set(excludedTools), [excludedTools]);

  const resolvedToolState = useCallback(
    (toolName: string): AgentToolStateRow | undefined =>
      resolvedStates.get(toolName),
    [resolvedStates]
  );

  // Optimistic deltas: between a local toggle and the post-save refetch,
  // overlay the user's pending intent on top of the last backend rows so
  // the switch responds immediately.
  const toolState = useCallback(
    (toolName: string): ToolEditorState => {
      const row = resolvedStates.get(toolName);
      const pendingExcluded = excludedSet.has(toolName);
      const pendingAllowed = userAllowedSet.has(toolName);
      if (row) {
        if (row.capabilityBlocked && !pendingAllowed) return "disabled";
        if (row.systemPinned) return "system_pinned";
        const baseEnabled = row.enabled;
        if (pendingExcluded && !pendingAllowed) return "disabled";
        if (pendingAllowed) return "enabled";
        return baseEnabled ? "enabled" : "disabled";
      }
      // No backend row (unknown/MCP name): fall back to the deltas.
      if (pendingExcluded && !pendingAllowed) return "disabled";
      return "enabled";
    },
    [resolvedStates, excludedSet, userAllowedSet]
  );

  return {
    loaded,
    builtIn,
    agentKind,
    capabilities,
    systemRestrictToTools,
    userAllowedTools: userAllowedSet,
    excludedTools: excludedSet,
    resolvedToolState,
    toolState,
    setUserAllowed,
    setExcluded,
  };
}
