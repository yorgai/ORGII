/**
 * Typed local reads for the collab org panel (design §16.2).
 *
 * Shared projects / work items are NATIVE rows in the local project
 * store (synced there by the engine's ProjectSyncChannel), so the
 * Projects / WorkItems tabs read them through projectApi scoped by the
 * aliased project org — `org.projectOrgId ?? org.id` (the §16.2 keying
 * fix: the two ids can differ when the alias matched an existing local
 * org by name). Replaces the retired jsonb mirror
 * (collabProjectsAtom / collabWorkItemsAtom / useLocalOrgMetadata).
 *
 * Display-only in M6a; M6b adds actions + links into ProjectManager.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { projectApi } from "@src/api/http/project";
import type { EnrichedWorkItem, ProjectData } from "@src/api/http/project";
import { useProjectDataChanged } from "@src/hooks/project/useProjectDataChanged";
import type { CollabOrgRecord } from "@src/store/collaboration/types";

export interface OrgLocalEntities {
  orgProjects: ProjectData[];
  orgWorkItems: EnrichedWorkItem[];
  localMetadataError: string | null;
}

export function useOrgLocalEntities(
  org: CollabOrgRecord | undefined
): OrgLocalEntities {
  const projectOrgId = org ? (org.projectOrgId ?? org.id) : undefined;
  const [orgProjects, setOrgProjects] = useState<ProjectData[]>([]);
  const [orgWorkItems, setOrgWorkItems] = useState<EnrichedWorkItem[]>([]);
  const [localMetadataError, setLocalMetadataError] = useState<string | null>(
    null
  );
  const generationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = ++generationRef.current;
    // No org (panel shows its not-found state) → keep whatever is
    // rendered; every setState below happens after an await, so the
    // effect never mutates state synchronously.
    if (!projectOrgId) return;
    try {
      const projects = await projectApi.readProjects({ orgId: projectOrgId });
      const workItemGroups = await Promise.all(
        projects.map((project) =>
          projectApi.readWorkItemsEnriched(project.slug, {
            orgId: projectOrgId,
          })
        )
      );
      if (generationRef.current !== generation) return;
      setOrgProjects(projects);
      setOrgWorkItems(
        workItemGroups.flat().filter((workItem) => !workItem.deletedAt)
      );
      setLocalMetadataError(null);
    } catch (error) {
      if (generationRef.current !== generation) return;
      setLocalMetadataError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }, [projectOrgId]);

  useEffect(() => {
    // queueMicrotask to satisfy react-hooks/set-state-in-effect (repo
    // idiom, see usePlanningIndicator); load only sets state after awaits.
    queueMicrotask(() => void load());
  }, [load]);

  // Refresh whenever anything (including the sync engine's remote apply)
  // touches the local project store.
  useProjectDataChanged(
    useCallback(() => {
      void load();
    }, [load])
  );

  return { orgProjects, orgWorkItems, localMetadataError };
}
