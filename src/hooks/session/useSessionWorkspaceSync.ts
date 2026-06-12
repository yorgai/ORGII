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
 *  - The hook exclusively manages entries with
 *    `source === "ideWorkspace"`: adds are tagged with that source and
 *    only entries carrying it are eligible for removal. Agent-granted
 *    (`"session"`, e.g. `/add-dir`) and settings/CLI entries are never
 *    touched — see `computeWorkspaceSyncPlan`.
 *  - On mount / session swap, pull the workspace snapshot
 *    (`agent_session_list_workspaces`) once as a fallback, then keep a
 *    local mirror fresh via the `workspace:changed` Tauri event so
 *    backend-initiated changes (agent `/add-dir`, runtime rebuilds)
 *    flow back without re-polling.
 *  - Sync runs are serialised through a single in-flight queue: a new
 *    trigger during a run coalesces into exactly one trailing run, so
 *    concurrent effect re-runs can never interleave add/remove calls.
 *  - Paths in the snapshot/event are canonicalised by the backend, so
 *    comparison is plain string equality. If the session's
 *    `workspaceRoot` is not among the IDE folders the session is
 *    treated as detached: warn once and skip (matches launch-time
 *    policy in `useSessionLaunch`).
 */
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import {
  DIRECTORY_SOURCE,
  WORKSPACE_CHANGED_EVENT,
  type WorkspaceChangedPayload,
  addSessionDirectory,
  listSessionWorkspace,
  removeSessionDirectory,
} from "@src/api/tauri/agent/sessionWorkspace";
import { useTauriListen } from "@src/hooks/platform/useTauriListen";
import { workspaceFoldersAtom } from "@src/store/ui/workspaceFoldersAtom";

import {
  computeWorkspaceSyncPlan,
  nonIdeManagedPaths,
  trimTrailingSlashes,
} from "./sessionWorkspaceSyncPlan";

interface WorkspaceMirror {
  sessionId: string;
  workspaceRoot: string;
  additionalDirectories: WorkspaceChangedPayload["additionalDirectories"];
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

function isTransientLifecycleError(error: unknown): boolean {
  // "session 'xxx' not found" / "has no runtime" come from
  // `resolve_workspace_state` on the Rust side and mean the session's
  // runtime isn't attached yet (e.g. the caller flipped status to
  // "running" a few ms before `init_session` finished, or the session
  // is historical and `agent_send_message` hasn't re-inited it). Both
  // are transient: the next trigger retries.
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("not found") || message.includes("no runtime");
}

export function useSessionWorkspaceSync(
  options: UseSessionWorkspaceSyncOptions
): void {
  const { sessionId, enabled = true } = options;
  const workspaceFolders = useAtomValue(workspaceFoldersAtom);

  /** Latest IDE folder paths — read inside the queued run, not captured. */
  const ideFoldersRef = useRef<string[]>([]);
  ideFoldersRef.current = workspaceFolders.map((folder) => folder.path);

  /** Local mirror of the backend workspace, keyed by session. */
  const mirrorRef = useRef<WorkspaceMirror | null>(null);
  /**
   * IDE paths whose `add` returned `false` (already present on the
   * backend under a canonical alias, e.g. symlinked IDE path). Skipped
   * on later runs to avoid re-issuing no-op adds; evicted once the
   * path leaves the IDE folder list.
   */
  const suppressedAddsRef = useRef<Set<string>>(new Set());
  /** Change-detection key for the non-IDE-managed debug log. */
  const nonIdeLogKeyRef = useRef<string | null>(null);
  /** Dedup key for the detached-session warning. */
  const detachedWarnKeyRef = useRef<string | null>(null);

  /** Serialisation state: one in-flight run + one coalesced trailing run. */
  const runningRef = useRef(false);
  const pendingRef = useRef(false);
  /** Flipped on unmount / session swap so in-flight runs stop mutating. */
  const generationRef = useRef(0);

  const runSync = useCallback(async (generation: number): Promise<void> => {
    const mirror = mirrorRef.current;
    if (!mirror) return;
    const syncSessionId = mirror.sessionId;

    // Evict suppressed adds for paths no longer in the IDE list so a
    // re-added folder gets a fresh attempt.
    const currentIdePaths = new Set(
      ideFoldersRef.current.map(trimTrailingSlashes)
    );
    for (const path of suppressedAddsRef.current) {
      if (!currentIdePaths.has(path)) suppressedAddsRef.current.delete(path);
    }

    const plan = computeWorkspaceSyncPlan({
      workspaceRoot: mirror.workspaceRoot,
      additionalDirectories: mirror.additionalDirectories,
      ideFolderPaths: ideFoldersRef.current,
      suppressedAdds: suppressedAddsRef.current,
    });

    if (plan.detached) {
      const warnKey = `${syncSessionId}:${mirror.workspaceRoot}`;
      if (detachedWarnKeyRef.current !== warnKey) {
        detachedWarnKeyRef.current = warnKey;
        console.warn(
          "[useSessionWorkspaceSync] session workspaceRoot is not an IDE workspace folder — skipping sync",
          {
            sessionId: syncSessionId,
            workspaceRoot: mirror.workspaceRoot,
            ideFolders: ideFoldersRef.current,
          }
        );
      }
      return;
    }
    detachedWarnKeyRef.current = null;

    for (const path of plan.toAdd) {
      if (generationRef.current !== generation) return;
      try {
        const inserted = await addSessionDirectory(
          syncSessionId,
          path,
          DIRECTORY_SOURCE.IDE_WORKSPACE
        );
        if (generationRef.current !== generation) return;
        if (inserted) {
          // Optimistic mirror update; the `workspace:changed` event
          // will replace it with the canonical backend view.
          mirrorRef.current?.additionalDirectories.push({
            path,
            source: DIRECTORY_SOURCE.IDE_WORKSPACE,
          });
        } else {
          // Already present under a canonical alias or another
          // source — never retry, never manage it.
          suppressedAddsRef.current.add(path);
        }
      } catch (error) {
        if (isTransientLifecycleError(error)) return;
        console.error("[useSessionWorkspaceSync] addSessionDirectory failed", {
          sessionId: syncSessionId,
          path,
          error,
        });
      }
    }

    for (const path of plan.toRemove) {
      if (generationRef.current !== generation) return;
      try {
        await removeSessionDirectory(syncSessionId, path);
        if (generationRef.current !== generation) return;
        const current = mirrorRef.current;
        if (current) {
          current.additionalDirectories = current.additionalDirectories.filter(
            (entry) => entry.path !== path
          );
        }
      } catch (error) {
        if (isTransientLifecycleError(error)) return;
        console.error(
          "[useSessionWorkspaceSync] removeSessionDirectory failed",
          { sessionId: syncSessionId, path, error }
        );
      }
    }
  }, []);

  /**
   * Trigger a sync run. If one is already in flight, coalesce into a
   * single trailing run that starts after the current one finishes.
   */
  const scheduleSync = useCallback((): void => {
    if (runningRef.current) {
      pendingRef.current = true;
      return;
    }
    runningRef.current = true;
    const loop = async (): Promise<void> => {
      try {
        do {
          pendingRef.current = false;
          await runSync(generationRef.current);
        } while (pendingRef.current);
      } finally {
        runningRef.current = false;
      }
    };
    void loop();
  }, [runSync]);

  /** Replace the local mirror and log non-IDE-managed changes. */
  const applyMirror = useCallback((next: WorkspaceMirror): void => {
    mirrorRef.current = next;
    const logKey = nonIdeManagedPaths(next.additionalDirectories).join("\n");
    if (
      nonIdeLogKeyRef.current !== null &&
      nonIdeLogKeyRef.current !== logKey
    ) {
      // Debug breadcrumb for agent/settings-driven workspace changes —
      // intentionally not mirrored into UI state (out of scope for the
      // IDE sync layer).
      // eslint-disable-next-line no-console
      console.info(
        "[useSessionWorkspaceSync] non-IDE-managed workspace entries changed (agent/settings-driven; not mirrored to UI)",
        {
          sessionId: next.sessionId,
          entries: logKey.split("\n").filter(Boolean),
        }
      );
    }
    nonIdeLogKeyRef.current = logKey;
  }, []);

  // Live refresh: the backend emits `workspace:changed` after every
  // add/remove/runtime-rebuild. Keep the mirror fresh and re-plan.
  const handleWorkspaceChanged = useCallback(
    (payload: WorkspaceChangedPayload): void => {
      if (!sessionId || payload.sessionId !== sessionId) return;
      applyMirror({
        sessionId: payload.sessionId,
        workspaceRoot: payload.workspaceRoot,
        additionalDirectories: [...payload.additionalDirectories],
      });
      scheduleSync();
    },
    [sessionId, applyMirror, scheduleSync]
  );

  useTauriListen<WorkspaceChangedPayload>(
    WORKSPACE_CHANGED_EVENT,
    handleWorkspaceChanged,
    { enabled: enabled && !!sessionId }
  );

  // Session lifecycle: reset per-session state and pull the initial
  // snapshot once as a fallback (covers sessions whose backend predates
  // the event, and the gap before the first event arrives).
  useEffect(() => {
    if (!enabled || !sessionId) return;

    generationRef.current += 1;
    const generation = generationRef.current;
    mirrorRef.current = null;
    suppressedAddsRef.current = new Set();
    nonIdeLogKeyRef.current = null;
    detachedWarnKeyRef.current = null;

    void (async () => {
      try {
        const snapshot = await listSessionWorkspace(sessionId);
        if (generationRef.current !== generation) return;
        // An event may have landed while the pull was in flight — the
        // event payload is at least as fresh, so don't clobber it.
        if (mirrorRef.current?.sessionId === sessionId) return;
        applyMirror({
          sessionId,
          workspaceRoot: snapshot.workspaceRoot,
          additionalDirectories: [...snapshot.additionalDirectories],
        });
        scheduleSync();
      } catch (error) {
        if (isTransientLifecycleError(error)) {
          // Intentionally silent — the next status-driven remount (or
          // the first `workspace:changed` event once `init_session`
          // finishes) will populate the mirror.
          return;
        }
        console.error("[useSessionWorkspaceSync] workspace snapshot failed", {
          sessionId,
          error,
        });
      }
    })();

    return () => {
      // Invalidate in-flight runs for this session.
      generationRef.current += 1;
      mirrorRef.current = null;
    };
  }, [enabled, sessionId, applyMirror, scheduleSync]);

  // IDE folder list changed — re-plan against the current mirror.
  useEffect(() => {
    if (!enabled || !sessionId) return;
    if (!mirrorRef.current) return;
    scheduleSync();
  }, [enabled, sessionId, workspaceFolders, scheduleSync]);
}
