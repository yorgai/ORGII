/**
 * Hook for installed skills management.
 *
 * Combines:
 * - Local installed list via skills_list
 * - Toggle via skills_toggle
 * - Detail fetch/update for already-installed skills
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";

import { useMounted } from "@src/hooks/lifecycle/useMounted";
import {
  installedSkillsAtom,
  installedSkillsLoadingAtom,
} from "@src/store/skills/installedSkillsAtom";
import type {
  HubInstallResult,
  HubSkillDetail,
  InstalledSkill,
  SkillUpdateInfo,
} from "@src/types/extensions";

interface UseSkillsHubOptions {
  /** When false, skips the initial installed-skills fetch (no Tauri IPC on mount). */
  enabled?: boolean;
}

export function useSkillsHub({ enabled = true }: UseSkillsHubOptions = {}) {
  const [installedSkills, setInstalledSkills] = useAtom(installedSkillsAtom);
  const [installedLoading, setInstalledLoading] = useAtom(
    installedSkillsLoadingAtom
  );

  const [skillDetail, setSkillDetail] = useState<HubSkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [updates, setUpdates] = useState<SkillUpdateInfo[]>([]);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  const mountedRef = useMounted();

  const listInstalledSkills = useCallback(async () => {
    return invoke<InstalledSkill[]>("skills_list", {
      workspacePath: null,
    });
  }, []);

  const refreshInstalled = useCallback(async () => {
    setInstalledLoading(true);
    try {
      const result = await listInstalledSkills();
      setInstalledSkills(result);
    } catch (err) {
      console.error("[SkillsHub] Failed to list installed skills:", err);
    } finally {
      setInstalledLoading(false);
    }
  }, [listInstalledSkills, setInstalledSkills, setInstalledLoading]);

  const refreshInstalledAfterDelete = useCallback(
    async (deletedName: string) => {
      const retryDelaysMs = [100, 300, 700];
      for (const delayMs of retryDelaysMs) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        const result = await listInstalledSkills();
        if (!result.some((skill) => skill.name === deletedName)) {
          setInstalledSkills(result);
          return;
        }
      }
      setInstalledSkills((current) =>
        current.filter((skill) => skill.name !== deletedName)
      );
    },
    [listInstalledSkills, setInstalledSkills]
  );

  useEffect(() => {
    if (!enabled) {
      setInstalledLoading(false);
      return;
    }
    let cancelled = false;

    const load = async () => {
      setInstalledLoading(true);
      try {
        const result = await listInstalledSkills();
        if (!cancelled) setInstalledSkills(result);
      } catch (err) {
        if (!cancelled)
          console.error("[SkillsHub] Failed to list installed skills:", err);
      } finally {
        if (!cancelled) setInstalledLoading(false);
      }
    };
    load();

    return () => {
      cancelled = true;
    };
  }, [enabled, listInstalledSkills, setInstalledLoading, setInstalledSkills]);

  const fetchDetail = useCallback(async (slug: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setSkillDetail(null);

    let hasCached = false;

    // 1. Try loading cached detail first for instant display
    try {
      const cached = await invoke<HubSkillDetail | null>(
        "skills_hub_detail_cache_read",
        { name: slug }
      );
      if (cached) {
        setSkillDetail(cached);
        setDetailLoading(false);
        hasCached = true;
      }
    } catch {
      // Cache miss is fine, continue to network
    }

    // 2. Fetch fresh detail from network (background refresh if cached)
    try {
      const detail = await invoke<HubSkillDetail>("skills_hub_detail", {
        slug,
      });
      setSkillDetail(detail);

      // 3. Persist to cache for offline access
      invoke("skills_hub_detail_cache_write", {
        name: slug,
        detail,
      }).catch(() => {
        // Cache write failure is non-critical
      });
    } catch (err) {
      if (!hasCached) {
        setDetailError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const clearDetail = useCallback(() => {
    setSkillDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  const uninstall = useCallback(
    async (name: string) => {
      let previousSkills: InstalledSkill[] | null = null;
      setInstalledSkills((current) => {
        previousSkills = current;
        return current.filter((skill) => skill.name !== name);
      });

      try {
        await invoke("skills_hub_uninstall", { name });
        await refreshInstalledAfterDelete(name);
      } catch (error) {
        if (previousSkills) {
          setInstalledSkills(previousSkills);
        }
        throw error;
      }
    },
    [refreshInstalledAfterDelete, setInstalledSkills]
  );

  const readSkill = useCallback(async (name: string): Promise<string> => {
    return invoke<string>("skills_read", { workspacePath: null, name });
  }, []);

  const toggleSkill = useCallback(
    async (name: string, enabled: boolean) => {
      await invoke("skills_toggle", { workspacePath: null, name, enabled });
      await refreshInstalled();
    },
    [refreshInstalled]
  );

  const checkUpdates = useCallback(async () => {
    setUpdatesLoading(true);
    try {
      const result = await invoke<SkillUpdateInfo[]>("skills_check_updates");
      if (mountedRef.current) setUpdates(result);
    } catch (err) {
      if (mountedRef.current)
        console.error("[SkillsHub] Failed to check updates:", err);
    } finally {
      if (mountedRef.current) setUpdatesLoading(false);
    }
  }, [mountedRef]);

  const updateSkill = useCallback(
    async (slug: string): Promise<boolean> => {
      setUpdating(slug);
      try {
        await invoke<HubInstallResult>("skills_hub_update", { slug });
        if (mountedRef.current) {
          setUpdates((prev) => prev.filter((upd) => upd.slug !== slug));
          await refreshInstalled();
        }
        return true;
      } catch (err) {
        if (mountedRef.current)
          console.error("[SkillsHub] Failed to update skill:", err);
        return false;
      } finally {
        if (mountedRef.current) setUpdating(null);
      }
    },
    [refreshInstalled, mountedRef]
  );

  return {
    installedSkills,
    installedLoading,
    refreshInstalled,
    toggleSkill,
    uninstall,
    readSkill,
    skillDetail,
    detailLoading,
    detailError,
    fetchDetail,
    clearDetail,
    updates,
    updatesLoading,
    checkUpdates,
    updateSkill,
    updating,
  };
}
