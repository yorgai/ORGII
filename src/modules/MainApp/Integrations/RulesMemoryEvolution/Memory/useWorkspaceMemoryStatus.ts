/**
 * useWorkspaceMemoryStatus Hook
 *
 * Fetches L2 workspace memory status (file count, consolidation state)
 * from the Rust backend. Returns null while loading or if no workspace
 * is available.
 *
 * Scope semantics:
 *   - `"workspace"`: the user's currently-active workspace folder
 *     (`activeFolderAtom`). Always points at a real workspace once one
 *     is selected; there is no fallback to the personal workspace.
 *   - `"personal"`: the OS Agent's personal workspace
 *     (`~/.orgii/personal/workspace/`) regardless of the active folder.
 */
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";

import { rpc } from "@src/api/tauri/rpc";
import type { WorkspaceMemoryStatus } from "@src/api/tauri/rpc/schemas/workspaceMemory";
import { activeFolderAtom } from "@src/store/workspace/derived";

export type WorkspaceMemoryScope = "workspace" | "personal";

interface ResolvedWorkspace {
  path: string | null;
}

function useWorkspacePath(scope: WorkspaceMemoryScope): ResolvedWorkspace {
  const activeFolder = useAtomValue(activeFolderAtom);
  const [personalWs, setPersonalWs] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (scope !== "personal") return undefined;
    rpc.agentOrgs.memory
      .personalWorkspace()
      .then((path) => {
        if (!cancelled) setPersonalWs(path);
      })
      .catch((err: unknown) => {
        console.warn(
          "[useWorkspaceMemoryStatus] project_personal_workspace failed:",
          err
        );
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  if (scope === "personal") return { path: personalWs };
  return { path: activeFolder?.path ?? null };
}

function fetchStatus(
  workspace: string,
  onResult: (result: WorkspaceMemoryStatus) => void,
  onDone: () => void,
  signal: { cancelled: boolean }
): void {
  rpc.workspaceMemory
    .status({ workspace })
    .then((result: WorkspaceMemoryStatus) => {
      if (!signal.cancelled) onResult(result);
    })
    .catch((err: unknown) => {
      console.warn("[WorkspaceMemoryStatus] fetch failed:", err);
    })
    .finally(() => {
      if (!signal.cancelled) onDone();
    });
}

export function useWorkspaceMemoryStatus(
  scope: WorkspaceMemoryScope = "workspace"
) {
  const { path: workspace } = useWorkspacePath(scope);
  const [status, setStatus] = useState<WorkspaceMemoryStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!workspace) return;
    setLoading(true);
    const signal = { cancelled: false };
    fetchStatus(workspace, setStatus, () => setLoading(false), signal);
  }, [workspace]);

  useEffect(() => {
    if (!workspace) return;
    const signal = { cancelled: false };
    const timer = setTimeout(() => {
      setLoading(true);
      fetchStatus(workspace, setStatus, () => setLoading(false), signal);
    }, 0);
    return () => {
      signal.cancelled = true;
      clearTimeout(timer);
    };
  }, [workspace]);

  return { status, loading, workspace, refresh };
}
