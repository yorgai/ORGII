/**
 * Hook for managing coding agent skills.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { rpc } from "@src/api/tauri/rpc";
import type { DescriptionQuality } from "@src/types/extensions/types";

export interface SkillInfo {
  name: string;
  path: string;
  description: string;
  source: string;
  available: boolean;
  always: boolean;
  enabled: boolean;
  requiredBins: string[];
  requiredEnv: string[];
  estimatedTokens: number;
  fullContentTokens: number;
  descriptionQuality: DescriptionQuality;
  version: string;
}

/**
 * @param workspacePath - Workspace path used by the loader to find skills.
 * @param agentId - Agent definition ID that owns the disabled-skill list.
 *   When omitted, the backend falls back to a builtin (`builtin:sde` if
 *   `workspacePath` is set, otherwise `builtin:os`). Pass this from custom
 *   agent UIs so per-agent toggles do not silently rewrite OS/SDE state.
 */
export function useSkills(workspacePath?: string, agentId?: string) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  // Default false: a fresh mount of this hook should not flash a
  // spinner before the IPC even kicks off. `refresh` raises loading
  // for the actual fetch window; the Placeholder loading variant is
  // debounced to suppress sub-250ms flashes globally.
  const [loading, setLoading] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(() => {
    cancelRef.current?.();
    let cancelled = false;
    cancelRef.current = () => {
      cancelled = true;
    };

    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    rpc.agentOrgs.skills
      .list({ workspacePath, agentId })
      .then((result) => {
        if (!cancelled) setSkills(result);
      })
      .catch(() => {
        // Fetch failure: leave existing skills displayed.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
  }, [workspacePath, agentId]);

  useEffect(() => {
    refresh();
    return () => {
      cancelRef.current?.();
    };
  }, [refresh]);

  const readSkill = useCallback(
    async (name: string) => {
      return rpc.agentOrgs.skills.read({ workspacePath, name });
    },
    [workspacePath]
  );

  const toggleSkill = useCallback(
    async (name: string, enabled: boolean) => {
      // Optimistic update: flip the local state immediately so the
      // Switch responds without waiting for the round-trip IPC.
      setSkills((prev) =>
        prev.map((skill) =>
          skill.name === name ? { ...skill, enabled } : skill
        )
      );
      try {
        await rpc.agentOrgs.skills.toggle({
          workspacePath,
          agentId,
          name,
          enabled,
        });
      } catch (err: unknown) {
        // Roll back on failure and re-sync from backend.
        setSkills((prev) =>
          prev.map((skill) =>
            skill.name === name ? { ...skill, enabled: !enabled } : skill
          )
        );
        refresh();
        throw err;
      }
    },
    [workspacePath, agentId, refresh]
  );

  return { skills, loading, refresh, readSkill, toggleSkill };
}
