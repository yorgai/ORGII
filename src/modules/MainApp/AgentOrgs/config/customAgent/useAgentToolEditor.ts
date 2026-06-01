/**
 * useAgentToolEditor
 *
 * Per-agent tool editor. Runtime tool availability is the intersection
 * of the agent capability boundary and the explicit allow/deny lists:
 *
 *   - systemRestrictToTools (read-only — system-pinned allowlist)
 *   - userAllowedTools (user additions on top of system pins)
 *   - excludedTools (user subtractions)
 *
 * Capabilities are the coarse runtime boundary on the definition.
 * This hook edits only the per-tool deltas; the backend still enforces
 * capability requirements when the session resolves its tool set.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { rpc } from "@src/api/tauri/rpc";
import type {
  AgentDefinition,
  AgentToolSelection,
  CapabilitySet,
} from "@src/modules/MainApp/AgentOrgs/types";
import type { AgentKind } from "@src/modules/MainApp/Integrations/BuiltInTools/types";

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
   * Per-tool tri-state for rendering.
   * - `system_pinned` — present in the system allowlist; user cannot
   *   remove the pin itself but `excludedTools` still wins.
   * - `enabled`  — currently reachable (in the resolved allow set and
   *   not excluded).
   * - `disabled` — currently unreachable (excluded, or system pinned to
   *   a different set and not user-added).
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

  useEffect(() => {
    let cancelled = false;
    rpc.agentDef
      .get({ agentId })
      .then((def) => {
        if (cancelled) return;
        const typed = def as unknown as AgentDefinition;
        const parsed = parseTools(typed);
        setBuiltIn(Boolean(typed.builtIn));
        setAgentKind(agentKindForDefinition(typed));
        setCapabilities(typed.capabilities ?? {});
        setSystemRestrictToTools(parsed.systemRestrictToTools);
        setUserAllowedTools(parsed.userAllowedTools);
        setExcludedTools(parsed.excludedTools);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error("[useAgentToolEditor] load failed:", err);
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
      .catch((err: unknown) => {
        console.error("[useAgentToolEditor] persistTools failed:", err);
      });
  }, []);

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
  const systemSet = useMemo(
    () => (systemRestrictToTools ? new Set(systemRestrictToTools) : null),
    [systemRestrictToTools]
  );

  const toolState = useCallback(
    (toolName: string): ToolEditorState => {
      if (excludedSet.has(toolName)) return "disabled";
      if (systemSet) {
        if (systemSet.has(toolName)) return "system_pinned";
        if (userAllowedSet.has(toolName)) return "enabled";
        return "disabled";
      }
      return "enabled";
    },
    [excludedSet, systemSet, userAllowedSet]
  );

  return {
    loaded,
    builtIn,
    agentKind,
    capabilities,
    systemRestrictToTools,
    userAllowedTools: userAllowedSet,
    excludedTools: excludedSet,
    toolState,
    setUserAllowed,
    setExcluded,
  };
}
