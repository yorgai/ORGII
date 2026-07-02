/**
 * Collab-aware work item short-id allocation (design §16.5).
 *
 * Under a collab-synced org the per-project counter lives on the
 * server (`orgii_allocate_work_item_short_id`) so two members can never
 * mint the same `PREFIX-n`. Resolution:
 *
 * 1. project → owning org → collab org whose aliased project org
 *    (`projectOrgId ?? id`) matches;
 * 2. server allocation with the member credential;
 * 3. fall back to the local counter ONLY when the work item is provably
 *    not collab-synced (no matching collab org) or the server cannot be
 *    reached / the credential is missing. A locally allocated id can
 *    then collide with another member's offline allocation — the OCC
 *    push merges the two rows instead of renaming (§16.5's
 *    pending-marker rename flow is deliberately deferred; documented
 *    M6a simplification). This residual is confined to the offline /
 *    missing-credential window and is logged, never silent.
 *
 * EVERY work-item creation path must allocate through
 * `allocateCollabAwareWorkItemId` — calling `projectApi.allocateWorkItemId`
 * directly under a collab-synced org reintroduces the short-id collision
 * that merges two members' distinct work items.
 */
import { projectApi } from "@src/api/http/project";
import { createLogger } from "@src/hooks/logger";
import {
  collabMembersAtom,
  collabOrgsAtom,
} from "@src/store/collaboration/collabOrgsAtom";
import { COLLAB_ROLE } from "@src/store/collaboration/types";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { getSyncProfile } from "./collabSyncUtils";
import { supabaseSyncClient } from "./sync/supabaseSyncClient";

const logger = createLogger("collabShortId");

export async function allocateCollabAwareWorkItemId(
  projectSlug: string
): Promise<string> {
  try {
    const project = await projectApi.readProject(projectSlug);
    const orgs = getInstrumentedStore().get(collabOrgsAtom);
    const collabOrg = orgs.find(
      (org) => (org.projectOrgId ?? org.id) === project.meta.org_id
    );
    if (collabOrg) {
      const profile = getSyncProfile(collabOrg);
      if (profile) {
        try {
          const allocated = await supabaseSyncClient.allocateWorkItemShortId({
            ...profile,
            orgId: collabOrg.id,
            projectId: project.meta.id,
          });
          return allocated.shortId;
        } catch (error) {
          // Server unreachable / project not pushed yet: the documented
          // offline residual — the local id can collide and be merged by
          // the OCC push (see module doc).
          logger.warn(
            `server short-id allocation failed for ${projectSlug}; falling back to the local counter`,
            error
          );
        }
      } else {
        logger.warn(
          `collab org ${collabOrg.id} has no usable credential; allocating ${projectSlug} short id locally`
        );
      }
    }
  } catch (error) {
    // readProject failed: we cannot even resolve the owning org, so the
    // local counter is the only option left.
    logger.warn(
      `could not resolve collab org for ${projectSlug}; falling back to the local counter`,
      error
    );
  }
  return projectApi.allocateWorkItemId(projectSlug);
}

/**
 * Client gate for project deletion under a collab-synced org (design §16.9):
 * the server RPC only accepts project DELETE tombstones from admins, so a
 * non-admin member's local delete would be silently reverted on the next
 * pull. Returns `false` ONLY when the org is collab-synced and the local
 * member's role is provably not admin; purely local orgs (or unknown
 * membership) stay deletable.
 *
 * Delete affordances (ProjectManager project list, WorkItemsSettings danger
 * zone) should hide/disable the action when this returns `false`.
 */
export function canDeleteProjectUnderOrg(
  projectOrgId: string | null | undefined
): boolean {
  if (!projectOrgId) return true;
  const store = getInstrumentedStore();
  const orgs = store.get(collabOrgsAtom);
  const collabOrg = orgs.find(
    (org) => (org.projectOrgId ?? org.id) === projectOrgId
  );
  if (!collabOrg) return true;
  const members = store.get(collabMembersAtom);
  const localMember = members.find(
    (member) =>
      member.orgId === collabOrg.id && member.id === collabOrg.localMemberId
  );
  return localMember?.role === COLLAB_ROLE.ADMIN;
}
