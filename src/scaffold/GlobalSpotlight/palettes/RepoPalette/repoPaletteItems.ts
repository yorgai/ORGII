import type React from "react";

import type { RepoItem, SpotlightItem } from "../../types";
import {
  buildRepoSpotlightItems,
  sortRepoItemsSelectedFirst,
} from "../adapters";
import {
  REPO_PALETTE_SECTION_KEY,
  type RepoPaletteSectionKey,
  type RepoPaletteText,
} from "./types";

function buildSectionHeader(
  key: RepoPaletteSectionKey,
  label: string
): SpotlightItem {
  return {
    id: `__header_repo_${key}__`,
    label,
    desc: "",
    icon: "",
    type: "option",
    data: { isHeader: true },
    action: () => {},
  };
}

function appendSection(
  target: SpotlightItem[],
  key: RepoPaletteSectionKey,
  label: string,
  sectionItems: SpotlightItem[]
) {
  if (sectionItems.length === 0) return;
  target.push(buildSectionHeader(key, label), ...sectionItems);
}

interface BuildSectionedRepoItemsArgs {
  addMenuActive: boolean;
  sectionedAddItems: SpotlightItem[];
  workspaceItems: SpotlightItem[];
  openPathItem: SpotlightItem | null;
  filteredRepos: RepoItem[];
  currentRepoId?: string;
  isMultiRoot: boolean;
  isManageMode: boolean;
  leadingRepo?: RepoItem;
  selectedIds: Set<string>;
  searchQuery: string;
  paletteText: RepoPaletteText;
  onRepoAction: (repo: RepoItem) => void;
  onLeadingRepoAction: (repo: RepoItem) => void;
  toggleSelection: (id: string) => void;
  renderRepoTrashAction?: (repo: RepoItem) => React.ReactNode;
}

export function buildSectionedRepoItems({
  addMenuActive,
  sectionedAddItems,
  workspaceItems,
  openPathItem,
  filteredRepos,
  currentRepoId,
  isMultiRoot,
  isManageMode,
  leadingRepo,
  selectedIds,
  searchQuery,
  paletteText,
  onRepoAction,
  onLeadingRepoAction,
  toggleSelection,
  renderRepoTrashAction,
}: BuildSectionedRepoItemsArgs): SpotlightItem[] {
  if (addMenuActive) {
    return sectionedAddItems;
  }

  const repoItems = sortRepoItemsSelectedFirst(
    buildRepoSpotlightItems(filteredRepos, {
      currentRepoId: isMultiRoot ? undefined : currentRepoId,
      onAction: onRepoAction,
      manageAction: isManageMode ? renderRepoTrashAction : undefined,
      getSelectionState: isManageMode
        ? (repo) => ({
            checked: selectedIds.has(repo.id),
            onToggle: () => toggleSelection(repo.id),
          })
        : undefined,
    })
  );

  const leadingRepoItems =
    leadingRepo && !isManageMode
      ? buildRepoSpotlightItems([leadingRepo], {
          currentRepoId,
          onAction: onLeadingRepoAction,
        })
      : [];

  const sourceItems = [...leadingRepoItems, ...repoItems];

  const currentItems = [...workspaceItems, ...sourceItems].filter(
    (item) => item.data?.isCurrentSelection
  );
  const currentIds = new Set(currentItems.map((item) => item.id));
  const regularSystemPathItems = leadingRepoItems.filter(
    (item) => !currentIds.has(item.id)
  );
  const regularRepoItems = repoItems.filter((item) => !currentIds.has(item.id));
  const regularWorkspaceItems = workspaceItems.filter(
    (item) => !currentIds.has(item.id)
  );
  const sectionedItems: SpotlightItem[] = [];

  if (searchQuery.trim() && openPathItem) {
    sectionedItems.push(openPathItem);
  }

  appendSection(
    sectionedItems,
    REPO_PALETTE_SECTION_KEY.CURRENT,
    paletteText.sectionCurrentLabel,
    currentItems
  );
  appendSection(
    sectionedItems,
    REPO_PALETTE_SECTION_KEY.SYSTEM_PATH,
    paletteText.sectionSystemPathsLabel,
    regularSystemPathItems
  );
  appendSection(
    sectionedItems,
    REPO_PALETTE_SECTION_KEY.REPO,
    paletteText.sectionRepoLabel,
    regularRepoItems
  );
  appendSection(
    sectionedItems,
    REPO_PALETTE_SECTION_KEY.MULTI_REPO_WORKSPACE,
    paletteText.sectionMultiRepoWorkspaceLabel,
    regularWorkspaceItems
  );

  return sectionedItems;
}

export function buildSectionedAddItems(
  addWorkspaceItems: SpotlightItem[],
  sectionWorkspaceLabel: string
): SpotlightItem[] {
  if (addWorkspaceItems.length === 0) return [];
  return [
    {
      id: "__header_workspace__",
      label: sectionWorkspaceLabel,
      desc: "",
      icon: "",
      type: "option",
      data: { isHeader: true },
      action: () => {},
    },
    ...addWorkspaceItems,
  ];
}
