import { useMemo } from "react";

import type { ContainerSummary } from "@src/api/tauri/container";

const COMPOSE_WORKING_DIR_LABEL = "com.docker.compose.project.working_dir";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function isContainerForRepo(
  container: ContainerSummary,
  repoPath: string | undefined
): boolean {
  if (!repoPath) return false;

  const normalizedRepoPath = normalizePath(repoPath);
  const composeWorkingDir =
    container.compose.working_dir ??
    container.labels[COMPOSE_WORKING_DIR_LABEL];

  if (composeWorkingDir) {
    return normalizePath(composeWorkingDir) === normalizedRepoPath;
  }

  return container.mounts.some((mount) => {
    if (!mount.source) return false;
    const normalizedSource = normalizePath(mount.source);
    return (
      normalizedSource === normalizedRepoPath ||
      normalizedSource.startsWith(`${normalizedRepoPath}/`)
    );
  });
}

export function useRepoContainers(
  containers: ContainerSummary[],
  repoPath: string | undefined
) {
  return useMemo(
    () =>
      containers.filter((container) => isContainerForRepo(container, repoPath)),
    [containers, repoPath]
  );
}
