import { Code, FolderTree } from "lucide-react";
import React from "react";

import type { WorkspaceRecord } from "@src/api/tauri/workspace";
import type { CliAgentType } from "@src/api/types/keys";
import ModelIcon from "@src/components/ModelIcon";
import { resolveAgentIcon } from "@src/config/agentIcons";
import type { AvailableAgent } from "@src/config/cliAgents";
import type { KeyVaultAccount } from "@src/hooks/keyVault/types";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";
import { rustBuiltInVariantsFromDefinitions } from "@src/modules/WorkStation/Launchpad/hooks/useLaunchpadAgentCatalog";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { Repo } from "@src/store/repo";
import { getRustAgentType } from "@src/util/session/sessionDispatch";

export const FOLDERS_WORKSPACES_SECTION_ID = "separator-folders-workspaces";
export const FOLDERS_REPOS_SECTION_ID = "separator-folders-repos";
export const FOLDERS_ADD_WORKSPACE_ITEM_ID = "folders-add-workspace";
export const FOLDERS_CREATE_WORKSPACE_ITEM_ID = "folders-create-workspace";
export const FOLDERS_DASHBOARD_ITEM_ID = "folders-dashboard";
const FOLDERS_MY_KEYS_SECTION_ID = "separator-folders-my-keys";
const FOLDERS_MY_AGENTS_SECTION_ID = "separator-folders-my-agents";
export const FOLDERS_WORKSPACE_ITEM_PREFIX = "folders-workspace:";
export const FOLDERS_REPO_ITEM_PREFIX = "folders-repo:";
const FOLDERS_KEY_ITEM_PREFIX = "folders-key:";
const FOLDERS_AGENT_ITEM_PREFIX = "folders-agent:";
export interface FolderTarget {
  kind: "workspace" | "repo";
  id: string;
}

interface BuildFoldersSidebarMenuItemsParams {
  savedWorkspaces: readonly WorkspaceRecord[];
  repos: readonly Repo[];
  localAccounts: readonly KeyVaultAccount[];
  installedCliAgents: readonly AvailableAgent[];
  builtInRustAgents: readonly AgentDefinition[];
  customRustAgents: readonly AgentDefinition[];
  multiRepoWorkspaceCountLabel: (count: number) => string;
  repoCountLabel: (count: number) => string;
  myKeysLabel: string;
  myAgentsLabel: string;
}

export function getFolderItemId(target: FolderTarget): string {
  return target.kind === "workspace"
    ? `${FOLDERS_WORKSPACE_ITEM_PREFIX}${target.id}`
    : `${FOLDERS_REPO_ITEM_PREFIX}${target.id}`;
}

export function getRepoDisplayName(repo: Repo): string {
  return repo.name || repo.path?.split("/").pop() || "Repo";
}

function normalizeFsPath(path: string | undefined): string {
  if (!path) return "";
  const stripped = path.startsWith("file://")
    ? path.replace("file://", "")
    : path;
  return stripped.replace(/\/+$/, "");
}

export function buildWorkspaceRepoNameResolver(repos: readonly Repo[]) {
  const byId = new Map<string, string>();
  const byPath = new Map<string, string>();
  for (const repo of repos) {
    const name = getRepoDisplayName(repo);
    byId.set(repo.id, name);
    const normalizedPath = normalizeFsPath(repo.path ?? repo.fs_uri);
    if (normalizedPath) byPath.set(normalizedPath, name);
  }
  return (folder: WorkspaceRecord["folders"][number]): string => {
    if (folder.repoId) {
      const idMatch = byId.get(folder.repoId);
      if (idMatch) return idMatch;
    }
    return byPath.get(normalizeFsPath(folder.folderPath)) ?? folder.folderName;
  };
}

function getWorkspaceFolderCountLabel(count: number): string {
  return `${count} ${count === 1 ? "repo" : "repos"}`;
}

function createFolderMenuItem({
  target,
  savedWorkspaces,
  repos,
}: {
  target: FolderTarget;
  savedWorkspaces: readonly WorkspaceRecord[];
  repos: readonly Repo[];
}): NavigationMenuItem | null {
  const itemId = getFolderItemId(target);
  if (target.kind === "workspace") {
    const workspace = savedWorkspaces.find(
      (candidate) => candidate.workspaceId === target.id
    );
    if (!workspace) return null;
    return {
      id: itemId,
      key: itemId,
      label: workspace.name,
      icon: FolderTree,
      iconName: "folder-tree",
      shortcut: getWorkspaceFolderCountLabel(workspace.folders.length),
      showMoreActions: true,
    };
  }

  const repo = repos.find((candidate) => candidate.id === target.id);
  if (!repo) return null;
  return {
    id: itemId,
    key: itemId,
    label: getRepoDisplayName(repo),
    icon: Code,
    iconName: "code",
    showMoreActions: true,
  };
}

function buildFoldersKeyMenuItems(
  localAccounts: readonly KeyVaultAccount[]
): NavigationMenuItem[] {
  return localAccounts.map((account) => ({
    id: `${FOLDERS_KEY_ITEM_PREFIX}${account.id}`,
    key: `${FOLDERS_KEY_ITEM_PREFIX}${account.id}`,
    label: account.name,
    iconElement: (
      <ModelIcon
        agentType={account.modelType}
        size={16}
        className="shrink-0 text-text-2"
      />
    ),
    disabled: true,
  }));
}

function buildFoldersAgentMenuItems({
  installedCliAgents,
  builtInRustAgents,
  customRustAgents,
}: Pick<
  BuildFoldersSidebarMenuItemsParams,
  "installedCliAgents" | "builtInRustAgents" | "customRustAgents"
>): NavigationMenuItem[] {
  const cliItems = installedCliAgents
    .slice()
    .sort((agentA, agentB) => Number(agentB.popular) - Number(agentA.popular))
    .map((agent) => ({
      id: `${FOLDERS_AGENT_ITEM_PREFIX}cli:${agent.name}`,
      key: `${FOLDERS_AGENT_ITEM_PREFIX}cli:${agent.name}`,
      label: agent.displayName,
      iconElement: (
        <ModelIcon
          agentType={agent.name as CliAgentType}
          size={16}
          className="shrink-0 text-text-2"
        />
      ),
      disabled: true,
    }));

  const rustBuiltInVariants = rustBuiltInVariantsFromDefinitions([
    ...builtInRustAgents,
  ]);
  const rustItems = rustBuiltInVariants.map((rustType) => {
    const definition = builtInRustAgents.find(
      (definitionItem) => getRustAgentType(definitionItem.id) === rustType
    );
    const IconComponent = resolveAgentIcon(definition?.iconId);
    const label = definition?.name ?? rustType;
    return {
      id: `${FOLDERS_AGENT_ITEM_PREFIX}rust:${rustType}`,
      key: `${FOLDERS_AGENT_ITEM_PREFIX}rust:${rustType}`,
      label,
      iconElement: (
        <IconComponent size={16} strokeWidth={1.75} className="text-text-2" />
      ),
      disabled: true,
    };
  });

  const customItems = customRustAgents.map((definition) => {
    const IconComponent = resolveAgentIcon(definition.iconId);
    return {
      id: `${FOLDERS_AGENT_ITEM_PREFIX}custom:${definition.id}`,
      key: `${FOLDERS_AGENT_ITEM_PREFIX}custom:${definition.id}`,
      label: definition.name,
      iconElement: (
        <IconComponent size={16} strokeWidth={1.75} className="text-text-2" />
      ),
      disabled: true,
    };
  });

  return [...rustItems, ...customItems, ...cliItems];
}

export function buildFoldersSidebarMenuItems({
  savedWorkspaces,
  repos,
  localAccounts,
  installedCliAgents,
  builtInRustAgents,
  customRustAgents,
  multiRepoWorkspaceCountLabel,
  repoCountLabel,
  myKeysLabel,
  myAgentsLabel,
}: BuildFoldersSidebarMenuItemsParams): NavigationMenuItem[] {
  const items: NavigationMenuItem[] = [];

  const workspaceItems = savedWorkspaces
    .map((workspace) =>
      createFolderMenuItem({
        target: { kind: "workspace", id: workspace.workspaceId },
        savedWorkspaces,
        repos,
      })
    )
    .filter((item): item is NavigationMenuItem => Boolean(item));

  items.push({
    id: FOLDERS_WORKSPACES_SECTION_ID,
    key: FOLDERS_WORKSPACES_SECTION_ID,
    label: multiRepoWorkspaceCountLabel(workspaceItems.length),
  });
  items.push(...workspaceItems);

  const repoItems = repos
    .map((repo) =>
      createFolderMenuItem({
        target: { kind: "repo", id: repo.id },
        savedWorkspaces,
        repos,
      })
    )
    .filter((item): item is NavigationMenuItem => Boolean(item));

  items.push({
    id: FOLDERS_REPOS_SECTION_ID,
    key: FOLDERS_REPOS_SECTION_ID,
    label: repoCountLabel(repoItems.length),
  });
  items.push(...repoItems);

  items.push({
    id: FOLDERS_MY_KEYS_SECTION_ID,
    key: FOLDERS_MY_KEYS_SECTION_ID,
    label: myKeysLabel,
  });
  items.push(...buildFoldersKeyMenuItems(localAccounts));

  items.push({
    id: FOLDERS_MY_AGENTS_SECTION_ID,
    key: FOLDERS_MY_AGENTS_SECTION_ID,
    label: myAgentsLabel,
  });
  items.push(
    ...buildFoldersAgentMenuItems({
      installedCliAgents,
      builtInRustAgents,
      customRustAgents,
    })
  );

  return items;
}
