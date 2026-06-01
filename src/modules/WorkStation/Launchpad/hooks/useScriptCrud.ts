/**
 * useScriptCrud
 *
 * Merges discovered scripts (from useScriptDiscovery) with user-defined
 * custom scripts stored in .orgii/launchpad-scripts.json.
 *
 * Discovered scripts are read-only; custom scripts support add/edit/delete.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { RepoScript, RepoType, ScriptCategory } from "../types";
import { useScriptDiscovery } from "./useScriptDiscovery";

const CUSTOM_SCRIPTS_FILE = ".orgii/launchpad-scripts.json";

interface CustomScriptEntry {
  name: string;
  command: string;
  category: ScriptCategory;
}

async function loadCustomScripts(
  repoPath: string
): Promise<CustomScriptEntry[]> {
  const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
  const filePath = `${repoPath}/${CUSTOM_SCRIPTS_FILE}`;
  if (!(await exists(filePath))) return [];

  try {
    const raw = await readTextFile(filePath);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as CustomScriptEntry[];
  } catch {
    return [];
  }
}

async function saveCustomScripts(
  repoPath: string,
  scripts: CustomScriptEntry[]
): Promise<void> {
  const { exists, mkdir, writeTextFile } =
    await import("@tauri-apps/plugin-fs");
  const dirPath = `${repoPath}/.orgii`;
  if (!(await exists(dirPath))) {
    await mkdir(dirPath, { recursive: true });
  }
  await writeTextFile(
    `${repoPath}/${CUSTOM_SCRIPTS_FILE}`,
    JSON.stringify(scripts, null, 2)
  );
}

interface ScriptSnapshot {
  key: string;
  custom: CustomScriptEntry[];
}

export function useScriptCrud(
  repoPath: string | undefined,
  repoType: RepoType
) {
  const discovery = useScriptDiscovery(repoPath, repoType);
  const [customSnapshot, setCustomSnapshot] = useState<ScriptSnapshot | null>(
    null
  );
  const [tick, setTick] = useState(0);

  const requestKey = `${repoPath ?? ""}:${tick}`;

  useEffect(() => {
    if (!repoPath) return;

    let cancelled = false;
    const key = `${repoPath}:${tick}`;

    loadCustomScripts(repoPath)
      .then((custom) => {
        if (!cancelled) setCustomSnapshot({ key, custom });
      })
      .catch(() => {
        if (!cancelled) setCustomSnapshot({ key, custom: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath, tick]);

  const customScripts = useMemo(
    () => (customSnapshot?.key === requestKey ? customSnapshot.custom : []),
    [customSnapshot, requestKey]
  );
  const customLoading = repoPath ? customSnapshot?.key !== requestKey : false;

  const allScripts: RepoScript[] = [
    ...discovery.scripts,
    ...customScripts.map(
      (entry): RepoScript => ({
        name: entry.name,
        command: entry.command,
        category: entry.category,
        source: "custom",
      })
    ),
  ];

  const refreshCustom = useCallback(() => {
    setTick((prev) => prev + 1);
  }, []);

  const refreshAll = useCallback(() => {
    discovery.refresh();
    refreshCustom();
  }, [discovery, refreshCustom]);

  const addScript = useCallback(
    async (name: string, command: string, category: ScriptCategory) => {
      if (!repoPath) return;
      const updated = [...customScripts, { name, command, category }];
      await saveCustomScripts(repoPath, updated);
      refreshCustom();
    },
    [repoPath, customScripts, refreshCustom]
  );

  const updateScript = useCallback(
    async (
      oldName: string,
      name: string,
      command: string,
      category: ScriptCategory
    ) => {
      if (!repoPath) return;
      const updated = customScripts.map((entry) =>
        entry.name === oldName ? { name, command, category } : entry
      );
      await saveCustomScripts(repoPath, updated);
      refreshCustom();
    },
    [repoPath, customScripts, refreshCustom]
  );

  const deleteScript = useCallback(
    async (name: string) => {
      if (!repoPath) return;
      const updated = customScripts.filter((entry) => entry.name !== name);
      await saveCustomScripts(repoPath, updated);
      refreshCustom();
    },
    [repoPath, customScripts, refreshCustom]
  );

  const clearCustomScripts = useCallback(async () => {
    if (!repoPath) return;
    const { exists, remove } = await import("@tauri-apps/plugin-fs");
    const filePath = `${repoPath}/${CUSTOM_SCRIPTS_FILE}`;
    if (await exists(filePath)) {
      await remove(filePath);
    }
    refreshCustom();
  }, [repoPath, refreshCustom]);

  return {
    scripts: allScripts,
    discoveredScripts: discovery.scripts,
    customScripts,
    loading: discovery.loading || customLoading,
    refresh: refreshAll,
    addScript,
    updateScript,
    deleteScript,
    clearCustomScripts,
  };
}
