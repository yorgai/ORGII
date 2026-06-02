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
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import { isSystemPathRepoItem } from "@src/features/SessionCreator/utils/systemPathSource";
import {
  type UseDropdownListNavigationReturn,
  useDropdownEngine,
} from "@src/hooks/dropdown";
import { useTauriSelectAllShortcut } from "@src/hooks/keyboard";
import {
  isMultiRootWorkspaceAtom,
  setWorkspaceFoldersAtom,
} from "@src/store/ui/workspaceFoldersAtom";

import { ICONS } from "../../config";
import { useSharedRepoList } from "../../hooks";
import { useWorkspaceForm } from "../../hooks/forms";
import type { RepoItem, SpotlightItem } from "../../types";
import { buildOpenPathItem } from "./pathActionItem";
import { importWorkspacePath } from "./pathImport";

const LIST_MAX_HEIGHT = 360;
const VIEWPORT_MARGIN = 12;
const MIN_DROPDOWN_WIDTH = 320;

type DropdownRepoItem =
  | { kind: "repo"; repo: RepoItem }
  | { kind: "openPath"; item: SpotlightItem };

interface RepoRowProps {
  repo: RepoItem;
  isCurrent: boolean;
  keyboardProps: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
}

interface OpenPathRowProps {
  item: SpotlightItem;
  keyboardProps: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
}

const RepoRow: React.FC<RepoRowProps> = ({
  repo,
  isCurrent,
  keyboardProps,
}) => {
  const isSystemPath = isSystemPathRepoItem(repo);
  const Icon = isSystemPath ? ICONS.home : ICONS.repo;
  const shouldShowDescription = Boolean(repo.description && !isSystemPath);

  return (
    <button
      type="button"
      data-testid={`repo-dropdown-row-${repo.id}`}
      {...keyboardProps}
      className={`${DROPDOWN_CLASSES.itemCompact} ${
        isCurrent ? DROPDOWN_CLASSES.itemSelected : DROPDOWN_CLASSES.itemHover
      } w-full justify-start`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <Icon size={16} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <span className="truncate">{repo.name}</span>
        {shouldShowDescription && (
          <span className="truncate text-[11px] text-text-3">
            {repo.description}
          </span>
        )}
      </div>
      {isCurrent && (
        <Check size={14} className="ml-2 shrink-0 text-primary-6" />
      )}
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
      className={`${DROPDOWN_CLASSES.itemCompact} ${DROPDOWN_CLASSES.itemHover} w-full justify-start`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {Icon && <Icon size={16} />}
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
  /** Optional first-class system path source row. */
  leadingRepo?: RepoItem;
}

export const RepoDropdown: React.FC<RepoDropdownProps> = ({
  isOpen,
  onClose,
  onSelect,
  currentRepoId,
  anchorRef,
  leadingRepo,
}) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const tauriSelectAll = useTauriSelectAllShortcut();

  const [searchQuery, setSearchQuery] = useState("");

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

  const { filteredRepos, repoLoading } = useSharedRepoList({
    enabled: isOpen,
    currentRepoId,
    searchQuery,
  });

  const isMultiRoot = useAtomValue(isMultiRootWorkspaceAtom);
  const dispatchSetFolders = useSetAtom(setWorkspaceFoldersAtom);
  const invalidPathTitle = t("selectors.repo.pathImport.invalidTitle");
  const invalidPathMessage = useCallback(
    (path: string) => t("selectors.repo.pathImport.invalidMessage", { path }),
    [t]
  );

  const openPathItem = useMemo(
    () =>
      buildOpenPathItem({
        searchQuery,
        matchCount: filteredRepos.length,
        openLabel: t("actions.openFolder"),
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
      filteredRepos.length,
      invalidPathMessage,
      invalidPathTitle,
      searchQuery,
      t,
    ]
  );

  // Sort selected to top, like the Spotlight variant.
  const sortedRepos = useMemo(() => {
    const repos = [...filteredRepos].sort((repoA, repoB) => {
      if (repoA.id === currentRepoId) return -1;
      if (repoB.id === currentRepoId) return 1;
      return 0;
    });
    return leadingRepo ? [leadingRepo, ...repos] : repos;
  }, [filteredRepos, currentRepoId, leadingRepo]);

  const dropdownItems = useMemo<DropdownRepoItem[]>(() => {
    const repoItems = sortedRepos.map((repo) => ({
      kind: "repo" as const,
      repo,
    }));
    return openPathItem
      ? [{ kind: "openPath" as const, item: openPathItem }, ...repoItems]
      : repoItems;
  }, [openPathItem, sortedRepos]);

  const handleSelect = useCallback(
    (item: DropdownRepoItem) => {
      if (item.kind === "openPath") {
        item.item.action?.();
        return;
      }

      if (isMultiRoot) {
        dispatchSetFolders([], null);
      }
      onSelect(item.repo.id, item.repo);
      onClose();
    },
    [isMultiRoot, dispatchSetFolders, onSelect, onClose]
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
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      setSearchQuery("");
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  if (!isOpen || !isPositioned) return null;

  const width = Math.max(MIN_DROPDOWN_WIDTH, panelPosition.width);
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(panelPosition.left, window.innerWidth - VIEWPORT_MARGIN - width)
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
      <div className={DROPDOWN_CLASSES.searchContainerCompact}>
        <Search size={14} className="shrink-0 text-text-3" />
        <input
          ref={inputRef}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={tauriSelectAll}
          placeholder={t("selectors.spotlight.placeholders.workspace")}
          className={DROPDOWN_CLASSES.searchInputCompact}
        />
      </div>

      <div
        className={`scrollbar-overlay flex flex-col overflow-y-auto ${DROPDOWN_PANEL.paddingClass} ${DROPDOWN_PANEL.itemsGapClass}`}
        style={{ maxHeight: LIST_MAX_HEIGHT }}
      >
        {repoLoading && dropdownItems.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] text-text-3">
            {t("status.loading")}
          </div>
        ) : dropdownItems.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] text-text-3">
            {t("selectors.modelSelector.noResults")}
          </div>
        ) : (
          dropdownItems.map((item, index) =>
            item.kind === "openPath" ? (
              <OpenPathRow
                key={item.item.id}
                item={item.item}
                keyboardProps={keyboard.getItemProps(index)}
              />
            ) : (
              <RepoRow
                key={item.repo.id}
                repo={item.repo}
                isCurrent={item.repo.id === currentRepoId}
                keyboardProps={keyboard.getItemProps(index)}
              />
            )
          )
        )}
      </div>
    </div>,
    document.body
  );
};

RepoDropdown.displayName = "RepoDropdown";
