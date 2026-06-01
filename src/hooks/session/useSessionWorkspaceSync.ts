/**
 * useSessionWorkspaceSync
 *
 * Runtime bridge between the IDE's multi-root workspace
 * (`workspaceFoldersAtom`) and a running agent session's
 * `SessionWorkspace.additional_directories`.
 *
 * Launch-time seeding happens inside `useSessionLaunch` via
 * `SessionLaunchParams.additionalDirectories`. This hook handles the
 * *ongoing* case: once the session is live, folders added to or
 * removed from the IDE workspace are mirrored into the backend
 * session via `agent_session_add_directory` /
 * `agent_session_remove_directory`.
 *
 * Policy:
 *  - On mount / session swap, pull the session's real workspace
 *    snapshot (`agent_session_list_workspaces`) to learn the
 *    `workspaceRoot` and the set of extras the backend already knows
 *    about. This avoids re-issuing `add` for folders that were seeded
 *    at launch time.
 *  - If `workspaceRoot` is not one of the current IDE workspace folders,
 *    the session is treated as detached and no sync runs (matches
 *    launch-time policy in `useSessionLaunch`).
 *  - Only entries we added (scope `"session"`) are eligible for
 *    removal when the user drops a folder from the IDE. Settings /
 *    CLI-arg scoped entries from the backend are left alone.
 */
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import {
  DIRECTORY_SOURCE,
  addSessionDirectory,
  listSessionWorkspace,
  removeSessionDirectory,
} from "@src/api/tauri/agent/sessionWorkspace";
import { workspaceFoldersAtom } from "@src/store/ui/workspaceFoldersAtom";

function normalize(path: string): string {
  return path.replace(/\/+$/, "");
}

interface WorkspaceSnapshot {
  workspaceRoot: string;
  /** Paths currently known to the backend, scoped to `"session"`. */
  managedExtras: Set<string>;
}

export interface UseSessionWorkspaceSyncOptions {
  /** Live session id, or null/undefined to disable the hook. */
  sessionId: string | null | undefined;
  /**
   * Outer gate. Callers typically wire this to "session is running
   * and owned by this view" so detached tabs don't drive sync.
   */
  enabled?: boolean;
}

export function useSessionWorkspaceSync(
  options: UseSessionWorkspaceSyncOptions
): void {
  const { sessionId, enabled = true } = options;
  const workspaceFolders = useAtomValue(workspaceFoldersAtom);

  const snapshotRef = useRef<WorkspaceSnapshot | null>(null);
  const snapshotSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    let cancelled = false;

    void (async () => {
      try {
        if (snapshotSessionIdRef.current !== sessionId) {
          const snapshot = await listSessionWorkspace(sessionId);
          if (cancelled) return;
          snapshotRef.current = {
            workspaceRoot: normalize(snapshot.workspaceRoot),
            managedExtras: new Set(
              snapshot.additionalDirectories
                .filter((entry) => entry.source === DIRECTORY_SOURCE.SESSION)
                .map((entry) => normalize(entry.path))
            ),
          };
          snapshotSessionIdRef.current = sessionId;
        }

        const snap = snapshotRef.current;
        if (!snap) return;

        const workspacePaths = workspaceFolders
          .map((folder) => normalize(folder.path))
          .filter((path) => path.length > 0);

        if (!workspacePaths.includes(snap.workspaceRoot)) return;

        const desiredExtras = new Set(
          workspacePaths.filter((path) => path !== snap.workspaceRoot)
        );
        const managed = snap.managedExtras;

        const toAdd: string[] = [];
        for (const path of desiredExtras) {
          if (!managed.has(path)) toAdd.push(path);
        }
        const toRemove: string[] = [];
        for (const path of managed) {
          if (!desiredExtras.has(path)) toRemove.push(path);
        }

        if (toAdd.length === 0 && toRemove.length === 0) return;

        for (const path of toAdd) {
          try {
            await addSessionDirectory(
              sessionId,
              path,
              DIRECTORY_SOURCE.SESSION
            );
            if (cancelled) return;
            managed.add(path);
          } catch (error) {
            console.error(
              "[useSessionWorkspaceSync] addSessionDirectory failed",
              { sessionId, path, error }
            );
          }
        }
        for (const path of toRemove) {
          try {
            await removeSessionDirectory(sessionId, path);
            if (cancelled) return;
            managed.delete(path);
          } catch (error) {
            console.error(
              "[useSessionWorkspaceSync] removeSessionDirectory failed",
              { sessionId, path, error }
            );
          }
        }
      } catch (error) {
        // "session 'xxx' not found" / "has no runtime" come from
        // `resolve_workspace_state` on the Rust side and mean the
        // session's runtime isn't attached yet (e.g. the caller flipped
        // status to "running" a few ms before `init_session` finished,
        // or the session is historical and `agent_send_message` hasn't
        // re-inited it). Both are transient: the next status-driven
        // re-run, or the post-send re-run, will pick up the snapshot.
        // Don't surface them as errors.
        const message = error instanceof Error ? error.message : String(error);
        const isTransientLifecycle =
          message.includes("not found") || message.includes("no runtime");
        if (isTransientLifecycle) {
          // Intentionally silent — the next status-driven re-run (or the
          // post-send re-run once `init_session` finishes) will retry.
          return;
        }
        console.error("[useSessionWorkspaceSync] workspace snapshot failed", {
          sessionId,
          error,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, sessionId, workspaceFolders]);

  useEffect(() => {
    return () => {
      snapshotRef.current = null;
      snapshotSessionIdRef.current = null;
    };
  }, []);
}
