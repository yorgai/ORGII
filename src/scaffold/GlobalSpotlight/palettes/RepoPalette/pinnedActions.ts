import type { TFunction } from "i18next";

import { ICONS } from "../../config";
import type { SpotlightItem } from "../../types";
import type { RepoPaletteText } from "./types";

interface BuildPinnedRepoActionsArgs {
  isManageMode: boolean;
  selectedCount: number;
  paletteText: RepoPaletteText;
  t: TFunction;
  onOpenLocalWorkspace: () => void;
  onOpenAddMenu: () => void;
  onCreateWorkspace: () => void;
  onBulkDelete: () => void;
  onToggleManageMode: () => void;
}

export function buildPinnedRepoActions({
  isManageMode,
  selectedCount,
  paletteText,
  t,
  onOpenLocalWorkspace,
  onOpenAddMenu,
  onCreateWorkspace,
  onBulkDelete,
  onToggleManageMode,
}: BuildPinnedRepoActionsArgs): SpotlightItem[] {
  const actions: SpotlightItem[] = [];

  if (!isManageMode) {
    actions.push(
      {
        id: "pinned-open-workspace-entry",
        label: paletteText.openFolderLabel,
        icon: ICONS.folder,
        type: "action",
        action: onOpenLocalWorkspace,
      },
      {
        id: "pinned-add-entry",
        label: paletteText.addEntryLabel,
        icon: ICONS.addWorkspace,
        type: "action",
        action: onOpenAddMenu,
      },
      {
        id: "pinned-create-workspace-entry",
        label: t(
          "workspaceForm.createWorkspace",
          "Create Multi-repo Workspace"
        ),
        icon: ICONS.workspace,
        type: "action",
        action: onCreateWorkspace,
      }
    );
  }

  if (isManageMode && selectedCount > 0) {
    actions.push({
      id: "pinned-delete-selected-entry",
      label: t("actions.removeFromOrgiiCount", { count: selectedCount }),
      icon: ICONS.removeRepo,
      type: "action",
      data: { isDanger: true },
      action: onBulkDelete,
    });
  }

  actions.push({
    id: "pinned-manage-entry",
    label: isManageMode
      ? t("actions.done", "Done")
      : t("actions.manage", "Manage"),
    icon: isManageMode ? ICONS.done : ICONS.config,
    type: "action",
    action: onToggleManageMode,
  });

  return actions;
}
