/**
 * Collab-aware work item execution lock (design §16.6 / §16.9).
 *
 * Under a collab-synced org the execution lock is arbitrated by the server
 * (`orgii_acquire_work_item_lock` / `orgii_release_work_item_lock`) so two
 * members can never start an agent on the same work item at once. The lock
 * lives at `payload.executionLock.lockedByMemberId` and syncs down into every
 * member's local work-item row, which is how the "start agent" affordance
 * knows to disable (see resolveLockHolder).
 *
 * Resolution mirrors `collabShortId.ts`:
 *   1. project → owning org → collab org whose aliased project org
 *      (`projectOrgId ?? id`) matches;
 *   2. server acquire/release with the member credential;
 *   3. no collab org / no credential ⇒ this is a purely local work item, so
 *      the caller proceeds without a server lock (the local execution_lock
 *      handles single-machine safety).
 *
 * `acquireCollabWorkItemLock` throws on `ORGII_CONFLICT` so the orchestrator
 * can refresh + surface the holder instead of double-starting.
 */
import { projectApi } from "@src/api/http/project";
import { collabOrgsAtom } from "@src/store/collaboration/collabOrgsAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { getSyncProfile } from "./collabSyncUtils";
import { supabaseSyncClient } from "./sync/supabaseSyncClient";

interface ResolvedCollabWorkItem {
  orgId: string;
  workItemId: string;
  profile: NonNullable<ReturnType<typeof getSyncProfile>>;
}

/**
 * Resolve the collab org + server credential for a work item, or null when
 * the work item is not under a collab-synced org (or the credential is
 * missing / the project has not been pushed yet).
 */
async function resolveCollabWorkItem(
  projectSlug: string,
  workItemId: string
): Promise<ResolvedCollabWorkItem | null> {
  const project = await projectApi.readProject(projectSlug);
  const orgs = getInstrumentedStore().get(collabOrgsAtom);
  const collabOrg = orgs.find(
    (org) => (org.projectOrgId ?? org.id) === project.meta.org_id
  );
  if (!collabOrg) return null;
  const profile = getSyncProfile(collabOrg);
  if (!profile) return null;
  return { orgId: collabOrg.id, workItemId, profile };
}

/**
 * Acquire the server execution lock for a collab work item before starting an
 * agent. Resolves to `false` when the work item is not collab-synced (nothing
 * to do — proceed). Rejects on `ORGII_CONFLICT` when another member holds the
 * lock (the caller refreshes + shows the holder). The server forces
 * `lockedByMemberId`; only a hint is passed here.
 */
export async function acquireCollabWorkItemLock(
  projectSlug: string,
  workItemId: string,
  lockPayload: Record<string, unknown> = {}
): Promise<boolean> {
  const resolved = await resolveCollabWorkItem(projectSlug, workItemId);
  if (!resolved) return false;
  await supabaseSyncClient.acquireWorkItemLock({
    ...resolved.profile,
    orgId: resolved.orgId,
    workItemId: resolved.workItemId,
    lockPayload,
  });
  return true;
}

/**
 * Release the server execution lock when a session terminates. Best-effort:
 * a non-collab work item is a no-op, and any failure is swallowed (the row
 * still syncs, and the server-side lock is idempotently overwritten by the
 * next acquirer). Returns whether a release RPC was issued.
 */
export async function releaseCollabWorkItemLock(
  projectSlug: string,
  workItemId: string
): Promise<boolean> {
  try {
    const resolved = await resolveCollabWorkItem(projectSlug, workItemId);
    if (!resolved) return false;
    await supabaseSyncClient.releaseWorkItemLock({
      ...resolved.profile,
      orgId: resolved.orgId,
      workItemId: resolved.workItemId,
    });
    return true;
  } catch {
    // Offline / already released / credential gone: the payload sync path
    // still reconciles the lock; nothing actionable to surface here.
    return false;
  }
}
