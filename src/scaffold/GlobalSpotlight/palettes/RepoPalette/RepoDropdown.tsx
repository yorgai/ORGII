/**
 * RepoDropdown
 *
 * Anchored, compact variant of `RepoPalette` for the core switch path
 * (pick a repo / workspace). Add-source / Manage / multi-root flows are
 * intentionally absent — those remain in the Spotlight variant because
 * they include nested modal stages that don't fit a 320px anchored panel.
 *
 * Chosen by `general.modelPickerStyle === "dropdown"`. Falls through to
 * `RepoPalette` (Spotlight) otherwise.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { Check, Search } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { repoApi } from "@src/api/tauri/repo";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import {
  isSystemHomeRepoItem,
  isSystemPathRepoItem,
} from "@src/features/SessionCreator/utils/systemPathSource";
import {
  type UseDropdownListNavigationReturn,
  useDropdownEngine,
} from "@src/hooks/dropdown";
import { useTauriSelectAllShortcut } from "@src/hooks/keyboard";
import { REPO_KIND } from "@src/store/repo";
import {
  isMultiRootWorkspaceAtom,
  setWorkspaceFoldersAtom,
} from "@src/store/ui/workspaceFoldersAtom";
import { getViewportSize } from "@src/util/ui/window/viewport";

import { ICONS } from "../../config";
import {
  type WorkspaceSwitchEntry,
  useSharedRepoList,
  useWorkspaceSwitch,
} from "../../hooks";
import { useWorkspaceForm } from "../../hooks/forms";
import type { RepoItem, SpotlightItem } from "../../types";
import { buildOpenPathItem } from "./pathActionItem";
import { importWorkspacePath } from "./pathImport";

const LIST_MAX_HEIGHT = 360;
const VIEWPORT_MARGIN = 12;
const MIN_DROPDOWN_WIDTH = 320;

type DropdownRepoItem =
  | { kind: "repo"; repo: RepoItem }
  | { kind: "workspace"; entry: WorkspaceSwitchEntry }
  | { kind: "openPath"; item: SpotlightItem };

type RepoDropdownSectionKey =
  | "openPath"
  | "current"
  | "multiRepoWorkspace"
  | "system"
  | "workspace"
  | "repo";

interface RepoDropdownSection {
  key: RepoDropdownSectionKey;
  label: string | null;
  items: DropdownRepoItem[];
}

interface RepoRowProps {
  repo: RepoItem;
  isCurrent: boolean;
  keyboardProps: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
}

interface OpenPathRowProps {
  item: SpotlightItem;
  keyboardProps: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
}

interface WorkspaceRowProps {
  entry: WorkspaceSwitchEntry;
  keyboardProps: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
}

const RepoRow: React.FC<RepoRowProps> = ({
  repo,
  isCurrent,
  keyboardProps,
}) => {
  const isSystemPath = isSystemPathRepoItem(repo);
  const Icon = isSystemHomeRepoItem(repo)
    ? ICONS.home
    : isSystemPath
      ? ICONS.folder
      : ICONS.repo;
  const shouldShowDescription = Boolean(repo.description && !isSystemPath);

  return (
    <button
      type="button"
      data-testid={`repo-dropdown-row-${repo.id}`}
      {...keyboardProps}
      className={`${DROPDOWN_CLASSES.item} ${
        isCurrent ? DROPDOWN_CLASSES.itemSelected : DROPDOWN_CLASSES.itemHover
      } w-full justify-start`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {isCurrent ? (
          <Check size={DROPDOWN_ITEM.iconSize} className="text-primary-6" />
        ) : (
          <Icon size={DROPDOWN_ITEM.iconSize} />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <span className="truncate">{repo.name}</span>
        {shouldShowDescription && (
          <span className="truncate text-[11px] text-text-3">
            {repo.description}
          </span>
        )}
      </div>
    </button>
  );
};

const WorkspaceRow: React.FC<WorkspaceRowProps> = ({
  entry,
  keyboardProps,
}) => {
  const { workspace, isActive } = entry;

  return (
    <button
      type="button"
      data-testid={`repo-dropdown-workspace-row-${workspace.workspaceId}`}
      {...keyboardProps}
      className={`${DROPDOWN_CLASSES.item} ${
        isActive ? DROPDOWN_CLASSES.itemSelected : DROPDOWN_CLASSES.itemHover
      } w-full justify-start`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {isActive ? (
          <Check size={DROPDOWN_ITEM.iconSize} className="text-primary-6" />
        ) : (
          <ICONS.workspace size={DROPDOWN_ITEM.iconSize} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">
        {workspace.name}
      </span>
    </button>
  );
};

const OpenPathRow: React.FC<OpenPathRowProps> = ({ item, keyboardProps }) => {
  const Icon = typeof item.icon === "string" ? ICONS.folder : item.icon;

  return (
    <button
      type="button"
      data-testid="repo-dropdown-open-path-row"
      {...keyboardProps}
      className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full justify-start`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {Icon && <Icon size={DROPDOWN_ITEM.iconSize} />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <span className="truncate">{item.label}</span>
        {item.desc && (
          <span className="truncate text-[11px] text-text-3">{item.desc}</span>
        )}
      </div>
    </button>
  );
};

export interface RepoDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (repoId: string, repo: RepoItem) => void;
  currentRepoId?: string;
  /** Element the dropdown is anchored to. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Optional first-class system path source rows. */
  leadingRepos?: readonly RepoItem[];
}

export const RepoDropdown: React.FC<RepoDropdownProps> = ({
  isOpen,
  onClose,
  onSelect,
  currentRepoId,
  anchorRef,
  leadingRepos = [],
}) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const tauriSelectAll = useTauriSelectAllShortcut();

  const [searchQuery, setSearchQuery] = useState("");
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen && searchQuery) setSearchQuery("");
  }

  const workspaceForm = useWorkspaceForm({
    onSuccess: async (workspaceId?: string) => {
      if (!workspaceId) return;
      const result = await repoApi.getRepoById(workspaceId);
      const repo = result.data;
      onSelect(repo.repo_id, {
        id: repo.repo_id,
        name: repo.name,
        fs_uri: repo.path,
        kind: repo.kind,
      });
      onClose();
    },
  });

  const { repos, filteredRepos, repoLoading } = useSharedRepoList({
    enabled: isOpen,
    currentRepoId,
    searchQuery,
  });

  const isMultiRoot = useAtomValue(isMultiRootWorkspaceAtom);
  const dispatchSetFolders = useSetAtom(setWorkspaceFoldersAtom);

  const { workspaces, activateWorkspace } = useWorkspaceSwitch({
    repos,
    onActivate: onClose,
  });

  // Filter multi-repo workspaces by the same query as repos. Match against
  // workspace name and member folder names so users can find a workspace by
  // any of its repos.
  const filteredWorkspaces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return workspaces;
    return workspaces.filter((entry) => {
      if (entry.workspace.name.toLowerCase().includes(query)) return true;
      return entry.folderNames.some((name) =>
        name.toLowerCase().includes(query)
      );
    });
  }, [workspaces, searchQuery]);
  const invalidPathTitle = t("selectors.repo.pathImport.invalidTitle");
  const invalidPathMessage = useCallback(
    (path: string) => t("selectors.repo.pathImport.invalidMessage", { path }),
    [t]
  );

  const openPathItem = useMemo(
    () =>
      buildOpenPathItem({
        searchQuery,
        addLabel: t("selectors.repo.pathImport.addLabel"),
        onOpenPath: (candidatePath) => {
          void importWorkspacePath({
            candidatePath,
            invalidPathTitle,
            invalidPathMessage,
            onImportWorkspace: workspaceForm.handleImportWorkspace,
          });
        },
      }),
    [
      workspaceForm.handleImportWorkspace,
      invalidPathMessage,
      invalidPathTitle,
      searchQuery,
      t,
    ]
  );

  const sections = useMemo<RepoDropdownSection[]>(() => {
    const allRepos = [...leadingRepos, ...filteredRepos];
    const currentItems: DropdownRepoItem[] = [];
    const systemItems: DropdownRepoItem[] = [];
    const folderWorkspaceItems: DropdownRepoItem[] = [];
    const repoItems: DropdownRepoItem[] = [];

    for (const repo of allRepos) {
      const item: DropdownRepoItem = { kind: "repo", repo };
      if (repo.id === currentRepoId) {
        currentItems.push(item);
      } else if (isSystemPathRepoItem(repo)) {
        systemItems.push(item);
      } else if (repo.kind === REPO_KIND.FOLDER) {
        folderWorkspaceItems.push(item);
      } else {
        repoItems.push(item);
      }
    }

    // Active multi-repo workspace is the "current" selection; sits with the
    // current repo. Inactive workspaces get their own section above repos so
    // they are easy to spot.
    const activeWorkspaceItems: DropdownRepoItem[] = [];
    const inactiveWorkspaceItems: DropdownRepoItem[] = [];
    for (const entry of filteredWorkspaces) {
      const item: DropdownRepoItem = { kind: "workspace", entry };
      if (entry.isActive) {
        activeWorkspaceItems.push(item);
      } else {
        inactiveWorkspaceItems.push(item);
      }
    }

    const nextSections: RepoDropdownSection[] = [];
    if (searchQuery.trim() && openPathItem) {
      nextSections.push({
        key: "openPath",
        label: null,
        items: [{ kind: "openPath", item: openPathItem }],
      });
    }
    if (activeWorkspaceItems.length > 0 || currentItems.length > 0) {
      nextSections.push({
        key: "current",
        label: t("selectors.repo.sections.current"),
        items: [...activeWorkspaceItems, ...currentItems],
      });
    }
    if (inactiveWorkspaceItems.length > 0) {
      nextSections.push({
        key: "multiRepoWorkspace",
        label: t("workspaceForm.multiRepoWorkspace", "Multi-Repo Workspace"),
        items: inactiveWorkspaceItems,
      });
    }
    if (systemItems.length > 0) {
      nextSections.push({
        key: "system",
        label: t("selectors.repo.sections.systemPaths"),
        items: systemItems,
      });
    }
    if (folderWorkspaceItems.length > 0) {
      nextSections.push({
        key: "workspace",
        label: t("selectors.repo.sections.workspace"),
        items: folderWorkspaceItems,
      });
    }
    if (repoItems.length > 0) {
      nextSections.push({
        key: "repo",
        label: t("selectors.repo.sections.repo"),
        items: repoItems,
      });
    }
    return nextSections;
  }, [
    filteredRepos,
    filteredWorkspaces,
    currentRepoId,
    leadingRepos,
    openPathItem,
    searchQuery,
    t,
  ]);

  const dropdownItems = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections]
  );

  const handleSelect = useCallback(
    (item: DropdownRepoItem) => {
      if (item.kind === "openPath") {
        item.item.action?.();
        return;
      }

      if (item.kind === "workspace") {
        activateWorkspace(item.entry.workspace);
        return;
      }

      if (isMultiRoot) {
        dispatchSetFolders([], null);
      }
      onSelect(item.repo.id, item.repo);
      onClose();
    },
    [isMultiRoot, dispatchSetFolders, onSelect, onClose, activateWorkspace]
  );

  const { isPositioned, panelRef, panelPosition, keyboard } = useDropdownEngine<
    HTMLElement,
    DropdownRepoItem
  >({
    open: isOpen,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    anchorRef,
    placement: "bottom",
    gap: DROPDOWN_PANEL.triggerGap,
    listNavigation: {
      items: dropdownItems,
      onSelect: handleSelect,
      initialSelectedIndex: -1,
    },
  });

  useEffect(() => {
    if (!isOpen || !isPositioned) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, isPositioned]);

  if (!isOpen || !isPositioned) return null;

  const width = Math.max(MIN_DROPDOWN_WIDTH, panelPosition.width);
  const { width: vw } = getViewportSize();
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(panelPosition.left, vw - VIEWPORT_MARGIN - width)
  );

  return createPortal(
    <div
      ref={panelRef}
      className={`${DROPDOWN_CLASSES.panel} fixed flex flex-col`}
      style={{
        top: panelPosition.top,
        bottom: panelPosition.bottom,
        left,
        width,
      }}
    >
      <div className={DROPDOWN_CLASSES.searchContainer}>
        <Search
          size={DROPDOWN_ITEM.iconSize}
          className="shrink-0 text-text-3"
        />
        <input
          ref={inputRef}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={tauriSelectAll}
          placeholder={t("selectors.spotlight.placeholders.workspace")}
          className={DROPDOWN_CLASSES.searchInput}
        />
      </div>

      <div
        className={DROPDOWN_CLASSES.optionsContainerOverlay}
        style={{ maxHeight: LIST_MAX_HEIGHT }}
      >
        {repoLoading && dropdownItems.length === 0 ? (
          <div className={DROPDOWN_CLASSES.listMessage}>
            {t("status.loading")}
          </div>
        ) : dropdownItems.length === 0 ? (
          <div className={DROPDOWN_CLASSES.listMessage}>
            {t("selectors.modelSelector.noResults")}
          </div>
        ) : (
          sections.map((section) => (
            <React.Fragment key={section.key}>
              {section.label && (
                <div className={DROPDOWN_CLASSES.sectionLabel}>
                  {section.label}
                </div>
              )}
              {section.items.map((item) => {
                const index = dropdownItems.indexOf(item);
                if (item.kind === "openPath") {
                  return (
                    <OpenPathRow
                      key={item.item.id}
                      item={item.item}
                      keyboardProps={keyboard.getItemProps(index)}
                    />
                  );
                }
                if (item.kind === "workspace") {
                  return (
                    <WorkspaceRow
                      key={`workspace-${item.entry.workspace.workspaceId}`}
                      entry={item.entry}
                      keyboardProps={keyboard.getItemProps(index)}
                    />
                  );
                }
                return (
                  <RepoRow
                    key={item.repo.id}
                    repo={item.repo}
                    isCurrent={item.repo.id === currentRepoId}
                    keyboardProps={keyboard.getItemProps(index)}
                  />
                );
              })}
            </React.Fragment>
          ))
        )}
      </div>
    </div>,
    document.body
  );
};

RepoDropdown.displayName = "RepoDropdown";
