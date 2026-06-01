/**
 * useAgentLearnings
 *
 * Per-agent L3 learnings (memory) hook driven by `agentId`. Reads and
 * writes `AgentDefinition.learnings` via `rpc.agentDef.get` /
 * `rpc.agentDef.updatePatch` — works uniformly for OS, SDE, Wingman,
 * Workforce Manager, Project Manager, and custom agents.
 *
 * Mirrors Rust `AgentLearningsConfig` field-for-field:
 *   - `enabled` — master switch for L3 memory loading + storage
 *   - `extractMemoriesEnabled` — extract Tier-1 memories from sessions
 *   - `autoDreamEnabled` — schedule autonomous dream consolidation
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { rpc } from "@src/api/tauri/rpc";
import type {
  AgentDefinition,
  AgentLearningsConfig,
} from "@src/modules/MainApp/AgentOrgs/types";

export interface AgentLearningsState {
  loaded: boolean;
  enabled: boolean;
  extractMemoriesEnabled: boolean;
  autoDreamEnabled: boolean;
  setEnabled: (next: boolean) => void;
  setExtractMemoriesEnabled: (next: boolean) => void;
  setAutoDreamEnabled: (next: boolean) => void;
}

const DEFAULT_LEARNINGS: AgentLearningsConfig = {
  enabled: true,
  extractMemoriesEnabled: true,
  autoDreamEnabled: true,
};

export function useAgentLearnings(agentId: string): AgentLearningsState {
  const [loaded, setLoaded] = useState(false);
  const [learnings, setLearnings] =
    useState<AgentLearningsConfig>(DEFAULT_LEARNINGS);

  const agentIdRef = useRef(agentId);
  useEffect(() => {
    agentIdRef.current = agentId;
  }, [agentId]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc.agentDef
      .get({ agentId })
      .then((def) => {
        if (cancelled) return;
        const typed = def as unknown as AgentDefinition;
        setLearnings(typed.learnings ?? DEFAULT_LEARNINGS);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const persist = useCallback((next: AgentLearningsConfig) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      rpc.agentDef
        .updatePatch({
          agentId: agentIdRef.current,
          patch: { learnings: next },
        })
        .catch(() => {
          // Save failure is silent; the next page visit will re-load from backend.
        });
    }, 400);
  }, []);

  const update = useCallback(
    (mutator: (prev: AgentLearningsConfig) => AgentLearningsConfig) => {
      setLearnings((prev) => {
        const next = mutator(prev);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  return {
    loaded,
    enabled: learnings.enabled ?? true,
    extractMemoriesEnabled: learnings.extractMemoriesEnabled ?? true,
    autoDreamEnabled: learnings.autoDreamEnabled ?? true,
    setEnabled: (next) =>
      update((prev) => ({
        ...prev,
        enabled: next,
        // Turning off the master switch also disables all sub-features
        // so the backend state stays consistent with what the UI shows.
        ...(next === false
          ? { extractMemoriesEnabled: false, autoDreamEnabled: false }
          : {}),
      })),
    setExtractMemoriesEnabled: (next) =>
      update((prev) => ({ ...prev, extractMemoriesEnabled: next })),
    setAutoDreamEnabled: (next) =>
      update((prev) => ({ ...prev, autoDreamEnabled: next })),
  };
}
