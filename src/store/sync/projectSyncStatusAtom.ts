/**
 * Project sync status — live store backed by the Rust worker's
 * `orgii-project-sync-status` Tauri event (Phase 4.6 Track B).
 *
 * Replaces hand-rolled `setInterval(projectSyncApi.status)` polling in
 * the settings panel + status bar with a single push-based listener:
 *
 *   Rust worker
 *     └─► emit("orgii-project-sync-status", SyncStatusEvent)
 *           └─► subscribeSyncStatus  (src/api/http/project/sync.ts)
 *                 └─► applySyncStatusEventAtom
 *                       └─► projectSyncStatusAtom (consumed by UI)
 *
 * The store key is `project_slug` so multiple projects can update
 * independently; entries are upserted, never expired.
 *
 * Mount `useSyncStatusBridge()` ONCE at the app root so the listener
 * lifecycle matches the app lifetime.
 */
import { type PrimitiveAtom, type WritableAtom, atom, useSetAtom } from "jotai";
import { useEffect } from "react";

import {
  type SyncStatusEvent,
  subscribeSyncStatus,
} from "@src/api/http/project/sync";

/**
 * Live `Map<projectSlug, SyncStatusEvent>` of the most recent event
 * the worker emitted for each project. Read by:
 * - the project settings panel (per-slug status row)
 * - the status bar widget (aggregate badge across all slugs)
 *
 * The Map identity is replaced on every write so Jotai's default
 * referential equality triggers re-renders.
 */
export const projectSyncStatusAtom: PrimitiveAtom<
  Map<string, SyncStatusEvent>
> = atom<Map<string, SyncStatusEvent>>(new Map());
projectSyncStatusAtom.debugLabel = "projectSyncStatusAtom";

/**
 * Write-only atom: upserts a single `SyncStatusEvent` into
 * `projectSyncStatusAtom`. Used by the bridge hook so the listener
 * stays decoupled from the consuming components.
 */
export const applySyncStatusEventAtom: WritableAtom<
  null,
  [SyncStatusEvent],
  void
> = atom(null, (get, set, event: SyncStatusEvent) => {
  const current = get(projectSyncStatusAtom);
  const next = new Map(current);
  next.set(event.project_slug, event);
  set(projectSyncStatusAtom, next);
});
applySyncStatusEventAtom.debugLabel = "applySyncStatusEventAtom";

/**
 * Wires `subscribeSyncStatus` into `applySyncStatusEventAtom` for the
 * lifetime of the host component. Mount ONCE at the app root —
 * mounting it more than once would double-process every event.
 */
export function useSyncStatusBridge(): void {
  const apply = useSetAtom(applySyncStatusEventAtom);

  useEffect(() => {
    const unlisten = subscribeSyncStatus((event) => {
      apply(event);
    });
    return () => {
      unlisten();
    };
  }, [apply]);
}
