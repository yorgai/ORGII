/**
 * WorkspacesTabSidebar
 *
 * Tab-specific sidebar for `launchpad-repo` tabs. Renders multi-repo
 * workspaces and repos as explorer-style collapsible sections.
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Check, Code, FolderTree } from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { type WorkspaceRecord, listWorkspaces } from "@src/api/tauri/workspace";
import { TreeRowBase, type TreeRowNode } from "@src/components/TreeRow";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { selectedRepoIdAtom } from "@src/store/repo";
import type { Repo } from "@src/store/repo/types";
import {
  activeWorkspaceIdAtom,
  activeWorkspaceNameAtom,
  savedWorkspacesAtom,
  setWorkspaceFoldersAtom,
} from "@src/store/ui/workspaceFoldersAtom";
import {
  createLaunchpadRepoTab,
  openTab as openTabMutation,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";
import type { WorkspaceFolder } from "@src/types/workspace";

import {
  type PanelSection,
  PrimarySidebarLayoutWithSections,
  type PrimarySidebarTab,
} from "../../PrimarySidebarLayout";
import {
  type TabSidebarComponent,
  type TabSidebarProps,
  registerTabSidebar,
} from "../registry";

const NAV_ICON_SIZE = 14;
const NAV_ICON_STROKE = 1.75;
function repoDisplayName(repo: Repo): string {
  return repo.name || repo.path?.split("/").pop() || "Repo";
}

function normalizeFsPath(path: string | undefined): string {
  if (!path) return "";
  const stripped = path.startsWith("file://")
    ? path.replace("file://", "")
    : path;
  return stripped.replace(/\/+$/, "");
}

function buildWorkspaceRepoNameResolver(repos: Repo[]) {
  const byId = new Map<string, string>();
  const byPath = new Map<string, string>();
  for (const repo of repos) {
    const name = repoDisplayName(repo);
    byId.set(repo.id, name);
    const normalized = normalizeFsPath(repo.path);
    if (normalized) byPath.set(normalized, name);
  }
  return (folder: WorkspaceRecord["folders"][number]): string => {
    if (folder.repoId) {
      const hit = byId.get(folder.repoId);
      if (hit) return hit;
    }
    return byPath.get(normalizeFsPath(folder.folderPath)) ?? folder.folderName;
  };
}

const WorkspacesTabSidebar: TabSidebarComponent = memo(
  ({ tab }: TabSidebarProps) => {
    const { t } = useTranslation(["navigation", "common"]);
    const { repos, repoLoading } = useRepoSelection({ autoLoad: true });
    const activeRepoId = useAtomValue(selectedRepoIdAtom);
    const setLayout = useSetAtom(workstationLayoutAtom);

    const [savedWorkspaces, setSavedWorkspaces] = useAtom(savedWorkspacesAtom);
    const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom);
    const dispatchSetFolders = useSetAtom(setWorkspaceFoldersAtom);
    const setActiveWorkspaceName = useSetAtom(activeWorkspaceNameAtom);

    const selectedRepoId = useMemo<string | null>(() => {
      if (tab.type !== "launchpad-repo") return null;
      const repoId = (tab.data as { repoId?: unknown } | undefined)?.repoId;
      return typeof repoId === "string" ? repoId : null;
    }, [tab]);

    // Lazy-load saved workspaces once if not yet hydrated. RepoLoader
    // normally seeds this on startup, but the sidebar may mount in a
    // window where the loader hasn't run yet.
    React.useEffect(() => {
      if (savedWorkspaces.length > 0) return;
      let cancelled = false;
      listWorkspaces()
        .then((rows) => {
          if (!cancelled) setSavedWorkspaces(rows);
        })
        .catch(() => {
          // Non-fatal; sidebar still renders repos.
        });
      return () => {
        cancelled = true;
      };
    }, [savedWorkspaces.length, setSavedWorkspaces]);

    const resolveWorkspaceRepoName = useMemo(
      () => buildWorkspaceRepoNameResolver(repos),
      [repos]
    );

    const handleSelectRepo = useCallback(
      (repo: Repo) => {
        const repoTab = createLaunchpadRepoTab({
          repoId: repo.id,
          repoName: repoDisplayName(repo),
          repoPath: repo.path ?? "",
        });
        setLayout((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            mainPane: openTabMutation(prev.mainPane, repoTab),
          };
        });
      },
      [setLayout]
    );

    const handleSelectWorkspace = useCallback(
      (ws: WorkspaceRecord) => {
        const folders: WorkspaceFolder[] = ws.folders.map((folder) => ({
          id: crypto.randomUUID(),
          name: resolveWorkspaceRepoName(folder),
          path: folder.folderPath,
          uri: `file://${folder.folderPath}`,
          isPrimary: folder.isPrimary,
          repoId: folder.repoId ?? undefined,
          kind:
            folder.kind === "folder" ? ("folder" as const) : ("git" as const),
        }));
        dispatchSetFolders(folders, ws.workspaceId);
        setActiveWorkspaceName(ws.name);
      },
      [dispatchSetFolders, resolveWorkspaceRepoName, setActiveWorkspaceName]
    );

    const orderedWorkspaces = useMemo(
      () =>
        [...savedWorkspaces].sort((workspaceA, workspaceB) => {
          if (workspaceA.workspaceId === activeWorkspaceId) return -1;
          if (workspaceB.workspaceId === activeWorkspaceId) return 1;
          return 0;
        }),
      [savedWorkspaces, activeWorkspaceId]
    );

    const workspaceRows = useMemo(
      () =>
        orderedWorkspaces.map((ws) => {
          const repoCount = ws.folders.length;
          const memberNames = ws.folders.map(resolveWorkspaceRepoName);
          const isActive = ws.workspaceId === activeWorkspaceId;
          const node: TreeRowNode = {
            id: `workspace-${ws.workspaceId}`,
            name: ws.name,
            path: ws.workspaceId,
            type: "file",
            icon: (
              <FolderTree size={NAV_ICON_SIZE} strokeWidth={NAV_ICON_STROKE} />
            ),
          };
          return (
            <TreeRowBase
              key={node.id}
              node={node}
              depth={0}
              isSelected={isActive}
              onClick={() => handleSelectWorkspace(ws)}
              dataPath={node.path}
            >
              <span
                className="ml-auto shrink-0 text-[11px] text-text-3"
                title={`${repoCount} repo${repoCount !== 1 ? "s" : ""}: ${memberNames.join(", ")}`}
              >
                {repoCount}
              </span>
            </TreeRowBase>
          );
        }),
      [
        orderedWorkspaces,
        activeWorkspaceId,
        handleSelectWorkspace,
        resolveWorkspaceRepoName,
      ]
    );

    const repoRows = useMemo(
      () =>
        repos.map((repo) => {
          const isSelected = repo.id === selectedRepoId;
          const isActive = repo.id === activeRepoId;
          const node: TreeRowNode = {
            id: repo.id,
            name: repoDisplayName(repo),
            path: repo.path ?? repo.id,
            type: "file",
            icon: <Code size={NAV_ICON_SIZE} strokeWidth={NAV_ICON_STROKE} />,
          };
          return (
            <TreeRowBase
              key={repo.id}
              node={node}
              depth={0}
              isSelected={isSelected}
              onClick={() => handleSelectRepo(repo)}
              dataPath={node.path}
            >
              {isActive && (
                <Check
                  size={NAV_ICON_SIZE}
                  strokeWidth={NAV_ICON_STROKE}
                  className="ml-auto shrink-0 text-primary-6"
                />
              )}
            </TreeRowBase>
          );
        }),
      [activeRepoId, handleSelectRepo, repos, selectedRepoId]
    );

    const emptyWorkspacesContent = useMemo(
      () => (
        <Placeholder
          variant="empty"
          placement="sidebar"
          title={t("launchpad.emptyWorkspaces")}
          fillParentHeight
        />
      ),
      [t]
    );

    const sidebarSections = useMemo<PanelSection[]>(() => {
      const sections: PanelSection[] = [];

      if (orderedWorkspaces.length > 0) {
        sections.push({
          key: "multi-repo-workspaces",
          title: t("common:selectors.repo.sections.workspace"),
          content: (
            <div className="min-h-0 overflow-y-auto py-1">{workspaceRows}</div>
          ),
          defaultFlexGrow: 1,
          resizable: true,
        });
      }

      sections.push({
        key: "repos",
        title: t("common:selectors.repo.sections.repo"),
        content:
          repos.length > 0 ? (
            <div className="min-h-0 overflow-y-auto py-1">{repoRows}</div>
          ) : repoLoading ? (
            <div className="min-h-0" />
          ) : (
            emptyWorkspacesContent
          ),
        defaultFlexGrow: 2,
        defaultCollapsed: orderedWorkspaces.length > 0 && repos.length === 0,
        resizable: true,
      });

      return sections;
    }, [
      emptyWorkspacesContent,
      orderedWorkspaces.length,
      repoLoading,
      repoRows,
      repos.length,
      t,
      workspaceRows,
    ]);

    const sidebarTab = useMemo<PrimarySidebarTab>(
      () => ({
        key: "workspaces",
        label: t("launchpad.workspaces"),
        sections: sidebarSections,
      }),
      [t, sidebarSections]
    );

    const tabs = useMemo(() => [sidebarTab], [sidebarTab]);
    const [activeSidebarTabKey] = useState(sidebarTab.key);
    const handleSidebarTabChange = useCallback(() => {
      // Single-tab layout; nothing to do.
    }, []);

    return (
      <PrimarySidebarLayoutWithSections
        tabs={tabs}
        activeTab={activeSidebarTabKey}
        onTabChange={handleSidebarTabChange}
        hideTabs
      />
    );
  }
);

WorkspacesTabSidebar.displayName = "WorkspacesTabSidebar";

registerTabSidebar("launchpad-repo", {
  component: WorkspacesTabSidebar,
  keepAlive: true,
});

export { WorkspacesTabSidebar };
