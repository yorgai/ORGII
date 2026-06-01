import { useCallback, useEffect, useMemo, useState } from "react";

import { PROJECT_ORG_SYNC_PROVIDER, projectApi } from "@src/api/http/project";
import type {
  LabelEntry,
  MemberEntry,
  ProjectData,
  ProjectOrg,
} from "@src/api/http/project";
import type { Label } from "@src/types/core/shared";

interface MembersByProject {
  projectSlug: string;
  members: MemberEntry[];
}

interface LabelsByProject {
  projectSlug: string;
  labels: LabelEntry[];
}

function parseGitFolderPath(org: ProjectOrg | null): string {
  if (!org?.sync_config_json) return "";
  const parsed = JSON.parse(org.sync_config_json) as { folder_path?: unknown };
  return typeof parsed.folder_path === "string" ? parsed.folder_path : "";
}

function mergeMembers(projectMembers: MembersByProject[]): MemberEntry[] {
  const memberMap = new Map<string, MemberEntry>();
  for (const entry of projectMembers) {
    for (const member of entry.members) {
      const existing = memberMap.get(member.id);
      if (!existing) {
        memberMap.set(member.id, member);
        continue;
      }
      memberMap.set(member.id, {
        ...existing,
        ...member,
        active: existing.active || member.active,
        last_commit_date:
          (member.last_commit_date ?? "") > (existing.last_commit_date ?? "")
            ? member.last_commit_date
            : existing.last_commit_date,
      });
    }
  }
  return Array.from(memberMap.values()).sort((memberA, memberB) =>
    memberA.name.localeCompare(memberB.name)
  );
}

function mergeLabels(projectLabels: LabelsByProject[]): Label[] {
  const labelMap = new Map<string, Label>();
  for (const entry of projectLabels) {
    for (const label of entry.labels) {
      if (!labelMap.has(label.id)) {
        labelMap.set(label.id, label);
      }
    }
  }
  return Array.from(labelMap.values()).sort((labelA, labelB) =>
    labelA.name.localeCompare(labelB.name)
  );
}

export function useProjectOrgCatalogData(orgId: string) {
  const [org, setOrg] = useState<ProjectOrg | null>(null);
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [membersByProject, setMembersByProject] = useState<MembersByProject[]>(
    []
  );
  const [labelsByProject, setLabelsByProject] = useState<LabelsByProject[]>([]);
  const [folderPath, setFolderPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadOrgCatalog = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [allOrgs, orgProjects] = await Promise.all([
        projectApi.readOrgs(),
        projectApi.readProjects({ orgId }),
      ]);
      const currentOrg = allOrgs.find((entry) => entry.id === orgId);
      if (!currentOrg) {
        throw new Error(`Project org not found: ${orgId}`);
      }
      const [nextMembersByProject, nextLabelsByProject] = await Promise.all([
        Promise.all(
          orgProjects.map(async (project) => ({
            projectSlug: project.slug,
            members: (await projectApi.readMembers(project.slug)).members,
          }))
        ),
        Promise.all(
          orgProjects.map(async (project) => ({
            projectSlug: project.slug,
            labels: (await projectApi.readLabels(project.slug)).labels,
          }))
        ),
      ]);
      setOrg(currentOrg);
      setProjects(orgProjects);
      setMembersByProject(nextMembersByProject);
      setLabelsByProject(nextLabelsByProject);
      setFolderPath(parseGitFolderPath(currentOrg));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadOrgCatalog();
  }, [loadOrgCatalog]);

  const members = useMemo(
    () => mergeMembers(membersByProject),
    [membersByProject]
  );
  const labels = useMemo(() => mergeLabels(labelsByProject), [labelsByProject]);

  const handleUpdateMembers = useCallback(
    async (updatedMembers: MemberEntry[]) => {
      if (projects.length === 0) return;
      await Promise.all(
        projects.map((project) =>
          projectApi.writeMembers(project.slug, { members: updatedMembers })
        )
      );
      setMembersByProject(
        projects.map((project) => ({
          projectSlug: project.slug,
          members: updatedMembers,
        }))
      );
    },
    [projects]
  );

  const handleUpdateLabels = useCallback(
    async (updatedLabels: Label[]) => {
      if (projects.length === 0) return;
      await Promise.all(
        projects.map((project) =>
          projectApi.writeLabels(project.slug, { labels: updatedLabels })
        )
      );
      setLabelsByProject(
        projects.map((project) => ({
          projectSlug: project.slug,
          labels: updatedLabels,
        }))
      );
    },
    [projects]
  );

  const handleConfigureGitFolder = useCallback(async () => {
    const configuredOrg = await projectApi.configureOrgGitFolderSync({
      org_id: orgId,
      folder_path: folderPath.trim(),
    });
    setOrg(configuredOrg);
    setFolderPath(parseGitFolderPath(configuredOrg));
  }, [folderPath, orgId]);

  const handleSyncGitFolder = useCallback(async () => {
    const result = await projectApi.syncOrgGitFolder({ org_id: orgId });
    await loadOrgCatalog();
    return result;
  }, [loadOrgCatalog, orgId]);

  const isGitFolderSynced =
    org?.sync_provider === PROJECT_ORG_SYNC_PROVIDER.GIT_FOLDER;

  return {
    org,
    projects,
    members,
    labels,
    folderPath,
    setFolderPath,
    loading,
    loadError,
    isGitFolderSynced,
    handleUpdateMembers,
    handleUpdateLabels,
    handleConfigureGitFolder,
    handleSyncGitFolder,
    reload: loadOrgCatalog,
  };
}
