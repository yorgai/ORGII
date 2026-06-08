import { documentDir, homeDir } from "@tauri-apps/api/path";
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";

import {
  createSystemDocumentsRepoItem,
  createSystemHomeRepoItem,
  createSystemPathRepoItem,
} from "@src/features/SessionCreator/utils/systemPathSource";
import { cachedReposAtom, reposAtom } from "@src/store/repo";
import { savedWorkspacesAtom } from "@src/store/ui/workspaceFoldersAtom";

function normalizePath(path: string | undefined): string {
  if (!path) return "";
  const trimmedPath = path.trim();
  const withoutFileScheme = trimmedPath.startsWith("file://")
    ? trimmedPath.replace("file://", "")
    : trimmedPath;
  return withoutFileScheme.replace(/\/+$/, "");
}

function getPathLabel(path: string): string {
  const normalizedPath = normalizePath(path);
  return normalizedPath.split("/").filter(Boolean).at(-1) ?? normalizedPath;
}

export function useSystemPathRepoItems(
  enabled: boolean,
  t: TFunction
): readonly ReturnType<typeof createSystemPathRepoItem>[] {
  const cachedRepos = useAtomValue(cachedReposAtom);
  const addedRepos = useAtomValue(reposAtom);
  const savedWorkspaces = useAtomValue(savedWorkspacesAtom);
  const [standardPaths, setStandardPaths] = useState<{
    home: string;
    documents: string;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    Promise.all([homeDir(), documentDir()]).then(
      ([homePath, documentsPath]) => {
        if (cancelled) return;
        setStandardPaths({
          home: normalizePath(homePath),
          documents: normalizePath(documentsPath),
        });
      }
    );

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return useMemo(() => {
    if (!enabled) return [];

    const items: ReturnType<typeof createSystemPathRepoItem>[] = [];
    const seenPaths = new Set<string>();
    const addedPaths = new Set<string>();

    for (const repo of addedRepos) {
      const path = normalizePath(repo.path || repo.fs_uri);
      if (path) addedPaths.add(path);
    }

    for (const workspace of savedWorkspaces) {
      for (const folder of workspace.folders) {
        const path = normalizePath(folder.folderPath);
        if (path) addedPaths.add(path);
      }
    }

    if (standardPaths) {
      items.push(createSystemHomeRepoItem(t, standardPaths.home));
      seenPaths.add(standardPaths.home);

      if (standardPaths.documents !== standardPaths.home) {
        items.push(createSystemDocumentsRepoItem(t, standardPaths.documents));
        seenPaths.add(standardPaths.documents);
      }
    } else {
      items.push(createSystemHomeRepoItem(t));
      items.push(createSystemDocumentsRepoItem(t));
    }

    for (const repo of cachedRepos) {
      const path = normalizePath(repo.path);
      if (!path || seenPaths.has(path) || addedPaths.has(path)) continue;

      items.push(
        createSystemPathRepoItem({
          idSuffix: `recent:${encodeURIComponent(path)}`,
          name: repo.name || getPathLabel(path),
          description: path,
          path,
        })
      );
      seenPaths.add(path);
    }

    return items;
  }, [addedRepos, cachedRepos, enabled, savedWorkspaces, standardPaths, t]);
}
