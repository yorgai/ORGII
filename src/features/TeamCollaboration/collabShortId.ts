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
 * 3. ANY failure (offline, project not pushed yet, missing credential)
 *    falls back to the local counter. A locally allocated id can
 *    collide with another member's offline allocation — the OCC push
 *    then merges the two rows instead of renaming (§16.5's
 *    pending-marker rename flow is deliberately deferred; documented
 *    M6a simplification).
 */
import { projectApi } from "@src/api/http/project";
import { collabOrgsAtom } from "@src/store/collaboration/collabOrgsAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { getSyncProfile } from "./collabSyncUtils";
import { supabaseSyncClient } from "./sync/supabaseSyncClient";

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
        const allocated = await supabaseSyncClient.allocateWorkItemShortId({
          ...profile,
          orgId: collabOrg.id,
          projectId: project.meta.id,
        });
        return allocated.shortId;
      }
    }
  } catch {
    // Offline / project not on the server yet / credential missing:
    // fall through to the local counter (see module doc).
  }
  return projectApi.allocateWorkItemId(projectSlug);
}
