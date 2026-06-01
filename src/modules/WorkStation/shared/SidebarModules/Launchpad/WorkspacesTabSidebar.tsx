/**
 * WorkspacesTabSidebar
 *
 * Tab-specific sidebar for the `launchpad-dashboard` (pinned) and
 * `launchpad-repo` (per-workspace) tab types. Renders Dashboard,
 * multi-repo workspaces, and repos as explorer-style collapsible sections.
 *
 * Clicking the Dashboard row activates the pinned `launchpad-dashboard`
 * tab; clicking a workspace activates that workspace's folders; clicking
 * a repo opens (or focuses) its keyed `launchpad-repo` tab in the main
 * pane.
 *
 * Registered for both launchpad tab types so it shows up whether the
 * dashboard or a workspace detail page is active.
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Code, LayoutDashboard } from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { type WorkspaceRecord, listWorkspaces } from "@src/api/tauri/workspace";
import { TreeRowBase, type TreeRowNode } from "@src/components/TreeRow";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import MultiRepoWorkspaceIcon from "@src/modules/WorkStation/Launchpad/components/MultiRepoWorkspaceIcon";
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
  LAUNCHPAD_DASHBOARD_TAB_ID,
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
const DASHBOARD_NODE_ID = "__workspaces_sidebar_dashboard__";

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

    const isDashboardActive = tab.type === "launchpad-dashboard";
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

    const handleSelectDashboard = useCallback(() => {
      setLayout((prev) => {
        if (!prev) return prev;
        const existing = prev.mainPane?.tabs.find(
          (entry) => entry.id === LAUNCHPAD_DASHBOARD_TAB_ID
        );
        if (!existing) return prev;
        return {
          ...prev,
          mainPane: {
            ...prev.mainPane,
            activeTabId: LAUNCHPAD_DASHBOARD_TAB_ID,
          },
        };
      });
    }, [setLayout]);

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

    const dashboardRow = useMemo(() => {
      const node: TreeRowNode = {
        id: DASHBOARD_NODE_ID,
        name: t("launchpad.dashboard"),
        path: DASHBOARD_NODE_ID,
        type: "file",
        icon: (
          <LayoutDashboard size={NAV_ICON_SIZE} strokeWidth={NAV_ICON_STROKE} />
        ),
      };
      return (
        <TreeRowBase
          key={DASHBOARD_NODE_ID}
          node={node}
          depth={0}
          isSelected={isDashboardActive}
          onClick={handleSelectDashboard}
          dataPath={DASHBOARD_NODE_ID}
        />
      );
    }, [handleSelectDashboard, isDashboardActive, t]);

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
              <MultiRepoWorkspaceIcon
                size={NAV_ICON_SIZE}
                strokeWidth={NAV_ICON_STROKE}
              />
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
                <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-success-6">
                  {t("launchpad.activeBadge")}
                </span>
              )}
            </TreeRowBase>
          );
        }),
      [activeRepoId, handleSelectRepo, repos, selectedRepoId, t]
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
      const sections: PanelSection[] = [
        {
          key: "dashboard",
          title: t("common:selectors.spotlight.groups.workspace"),
          content: <div className="flex flex-col py-1">{dashboardRow}</div>,
          defaultFlexGrow: 0.25,
          autoHeight: true,
          resizable: false,
        },
      ];

      if (orderedWorkspaces.length > 0) {
        sections.push({
          key: "multi-repo-workspaces",
          title: t("launchpad.myMultiRepoWorkspaces"),
          content: (
            <div className="min-h-0 overflow-y-auto py-1">{workspaceRows}</div>
          ),
          defaultFlexGrow: 1,
          resizable: true,
        });
      }

      sections.push({
        key: "repos",
        title: t("launchpad.tabs.myRepos"),
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
      dashboardRow,
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

registerTabSidebar("launchpad-dashboard", {
  component: WorkspacesTabSidebar,
  keepAlive: true,
});
registerTabSidebar("launchpad-repo", {
  component: WorkspacesTabSidebar,
  keepAlive: true,
});

export { WorkspacesTabSidebar };
