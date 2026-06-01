/**
 * useEllipsisMenu Hook
 *
 * Provides menu items and handlers for the ellipsis dropdown
 * Route-aware: different items for different toolbar contexts
 */
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { useAtomValue, useSetAtom } from "jotai";
import type { LucideIcon } from "lucide-react";
import {
  Braces,
  CircleMinus,
  Copy,
  FolderSearch,
  Github,
  Plus,
  RefreshCw,
  SquareArrowOutUpRight,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { repoApi } from "@src/api/tauri/repo";
import { ROUTES } from "@src/config/routes";
import { simulatorEventsAtom } from "@src/engines/SessionCore/derived/simulatorEvents";
import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import { useGitOperations } from "@src/hooks/git/useGitOperations";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { useRepoState } from "@src/hooks/git/useRepoState";
import { createLogger } from "@src/hooks/logger";
import { preferIDEAtom } from "@src/store/config/configAtom";
import { devModeEnabledAtom } from "@src/store/platform/devModeAtom";
import { ellipsisMenuOpenAtom } from "@src/store/ui/overlayAtom";
import { copyText } from "@src/util/data/clipboard";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";
import { showGitActionDialogSafely } from "@src/util/dialogs/gitActionDialog";
import { getFileManagerRevealLabelKey } from "@src/util/platform/fileManagerLabels";
import { isTauriDesktop } from "@src/util/platform/tauri";

const logger = createLogger("EllipsisMenu");

export interface DropdownMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  isDanger?: boolean;
  show?: boolean;
}

export interface UseEllipsisMenuReturn {
  menuItems: DropdownMenuItem[];
}

export interface UseEllipsisMenuOptions {
  /** When true, show simplified menu with just "Add repo" */
  hasNoRepos?: boolean;
  /** Handler to open repo selector for adding repos */
  onOpenRepoSelector?: () => void;
}

export function useEllipsisMenu(
  options: UseEllipsisMenuOptions = {}
): UseEllipsisMenuReturn {
  const { hasNoRepos, onOpenRepoSelector } = options;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const preferredIde = useAtomValue(preferIDEAtom);

  // Read-only repo state
  const { currentRepo } = useRepoState();

  // Get forceRefreshRepos action from main hook (we need this for refresh action)
  // This is the ONLY instance that needs the action, so it's OK to call here
  const { forceRefreshRepos } = useRepoSelection({
    autoLoad: false,
  });

  // Ellipsis menu state (for closing after actions)
  const setEllipsisMenuOpen = useSetAtom(ellipsisMenuOpenAtom);

  // Unified git operations hook - auto-streams to Output panel
  const { fetch: gitFetch } = useGitOperations({
    repoId: currentRepo?.id,
    repoPath: currentRepo?.path || currentRepo?.fs_uri,
  });

  const devModeEnabled = useAtomValue(devModeEnabledAtom);
  const { sessionId } = useSessionId();
  const hasSession = Boolean(sessionId);
  const simulatorEvents = useAtomValue(simulatorEventsAtom);

  const handleCopyEventsJson = useCallback(async () => {
    const payload = JSON.stringify(
      { schemaVersion: 1, events: simulatorEvents },
      null,
      2
    );
    try {
      await copyText(payload);
      showGitActionDialogSafely("Events JSON copied to clipboard", "info");
    } catch {
      showGitActionDialogSafely("Failed to copy events JSON", "error");
    }
  }, [simulatorEvents]);

  const isSettingsRoute = useMemo(
    () => location.pathname.startsWith(ROUTES.app.settings.path),
    [location.pathname]
  );

  // Detect if on editor page route
  const isEditorRoute = useMemo(
    () => location.pathname === ROUTES.workStation.code.path,
    [location.pathname]
  );

  const handleFetchOrigin = useCallback(async () => {
    if (!currentRepo?.id) {
      showGitActionDialogSafely("No repo selected", "warning");
      return;
    }

    // Use unified git operations - auto-streams to Output panel
    const result = await gitFetch({ remote: "origin", prune: true });
    if (result.success) {
      showGitActionDialogSafely("Fetch completed successfully", "info");
    } else {
      showGitActionDialogSafely(`Fetch failed: ${result.errorType}`, "error");
    }
  }, [currentRepo?.id, gitFetch]);

  const handleOpenInPreferredEditor = useCallback(async () => {
    if (!currentRepo?.fs_uri) {
      showGitActionDialogSafely(
        "No local path available for this repo",
        "warning"
      );
      return;
    }

    const ideLower = preferredIde.toLowerCase();
    const fsUri = currentRepo.fs_uri.replace(/^file:\/\//, "");

    if (isTauriDesktop()) {
      try {
        let appName: string;
        if (ideLower === "vscode" || ideLower === "code") {
          appName = "Visual Studio Code";
        } else if (
          ideLower.includes("visual studio code") &&
          ideLower.includes("insiders")
        ) {
          appName = "Visual Studio Code - Insiders";
        } else {
          appName = preferredIde;
        }

        await invoke("open_in_external_ide", {
          appName: appName,
          folderPath: fsUri,
        });

        showGitActionDialogSafely(`Opening in ${appName}`, "info");
      } catch (error) {
        console.error("Error opening external IDE:", error);
        showGitActionDialogSafely("Failed to open in external editor", "error");
      }
    } else {
      const vscodeUrl = `vscode://file${fsUri}`;
      window.location.href = vscodeUrl;
    }
  }, [currentRepo?.fs_uri, preferredIde]);

  const handleViewInGitHub = useCallback(() => {
    if (!currentRepo?.repo_url) {
      showGitActionDialogSafely(
        "No GitHub URL available for this repo",
        "warning"
      );
      return;
    }

    const link = document.createElement("a");
    link.href = currentRepo.repo_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [currentRepo?.repo_url]);

  const handleLocateInFinder = useCallback(async () => {
    if (!currentRepo?.fs_uri) {
      showGitActionDialogSafely(
        "No local path available for this repo",
        "warning"
      );
      return;
    }

    const fsUri = currentRepo.fs_uri.replace(/^file:\/\//, "");

    if (isTauriDesktop()) {
      try {
        await openPath(fsUri);
      } catch (error) {
        console.error("Error opening in Finder:", error);
        showGitActionDialogSafely("Failed to open in Finder", "error");
      }
    } else {
      showGitActionDialogSafely(
        "This feature is only available in the desktop app",
        "warning"
      );
    }
  }, [currentRepo?.fs_uri]);

  const handleCopyLocalPath = useCallback(async () => {
    if (!currentRepo?.fs_uri) {
      showGitActionDialogSafely(
        "No local path available for this repo",
        "warning"
      );
      return;
    }

    const fsUri = currentRepo.fs_uri.replace(/^file:\/\//, "");

    try {
      await copyText(fsUri);
      showGitActionDialogSafely("Path copied to clipboard", "info");
    } catch (error) {
      logger.error("Error copying path:", error);
      showGitActionDialogSafely("Failed to copy path", "error");
    }
  }, [currentRepo?.fs_uri]);

  const handleRemoveRepo = useCallback(() => {
    if (!currentRepo?.id) {
      showGitActionDialogSafely("No repo selected", "warning");
      return;
    }

    // Use native dialog for confirmation
    // On macOS: okLabel=LEFT, cancelLabel=RIGHT (primary)
    (async () => {
      const confirmed = await confirmDestructiveAction({
        title: t("confirmation.removeTitle", { name: currentRepo.name }),
        message: t("confirmation.removeMessage"),
        okLabel: t("actions.remove"),
        cancelLabel: t("actions.cancel"),
      });
      if (!confirmed) return;

      try {
        const response = await repoApi.deleteRepo(currentRepo.id);

        if (response?.status === 0) {
          showGitActionDialogSafely("Repo removed successfully", "info");
          await forceRefreshRepos();

          if (location.pathname === ROUTES.workStation.code.path) {
            navigate(ROUTES.app.home.start.path);
          }
        } else {
          throw new Error("Failed to remove repo");
        }
      } catch (error) {
        console.error("Error removing repo:", error);
        showGitActionDialogSafely(
          error instanceof Error ? error.message : "Failed to remove repo",
          "error"
        );
      }
    })();
  }, [
    currentRepo?.id,
    currentRepo?.name,
    forceRefreshRepos,
    navigate,
    location.pathname,
    t,
  ]);

  // ============================================
  // Menu Items - Route-aware
  // ============================================

  const copyEventsJsonItem: DropdownMenuItem | null = useMemo(
    () =>
      devModeEnabled && hasSession
        ? {
            id: "copy-events-json",
            label: t("ellipsisMenu.copyEventsJson", "Copy Events JSON"),
            icon: Braces,
            onClick: handleCopyEventsJson,
          }
        : null,
    [devModeEnabled, hasSession, t, handleCopyEventsJson]
  );

  const editorMenuItems: DropdownMenuItem[] = useMemo(
    () =>
      [
        {
          id: "fetch-origin",
          label: t("ellipsisMenu.fetchOrigin"),
          icon: RefreshCw,
          onClick: handleFetchOrigin,
        },
        {
          id: "open-ide",
          label: t("ellipsisMenu.openInEditor", { editor: preferredIde }),
          icon: SquareArrowOutUpRight,
          onClick: handleOpenInPreferredEditor,
        },
        {
          id: "view-github",
          label: t("ellipsisMenu.viewInGitHub"),
          icon: Github,
          onClick: handleViewInGitHub,
          show: !!currentRepo?.repo_url,
        },
        {
          id: "locate-finder",
          label: t(getFileManagerRevealLabelKey()),
          icon: FolderSearch,
          onClick: handleLocateInFinder,
        },
        {
          id: "copy-path",
          label: t("ellipsisMenu.copyLocalPath"),
          icon: Copy,
          onClick: handleCopyLocalPath,
        },
        copyEventsJsonItem,
        {
          id: "divider",
          label: "",
          icon: CircleMinus,
          onClick: () => {},
        },
        {
          id: "remove",
          label: t("ellipsisMenu.removeRepo"),
          icon: CircleMinus,
          onClick: handleRemoveRepo,
          isDanger: true,
        },
      ].filter(Boolean) as DropdownMenuItem[],
    [
      t,
      preferredIde,
      currentRepo?.repo_url,
      copyEventsJsonItem,
      handleFetchOrigin,
      handleOpenInPreferredEditor,
      handleViewInGitHub,
      handleLocateInFinder,
      handleCopyLocalPath,
      handleRemoveRepo,
    ]
  );

  const regularMenuItems: DropdownMenuItem[] = useMemo(
    () =>
      [
        {
          id: "fetch-origin",
          label: t("ellipsisMenu.fetchOrigin"),
          icon: RefreshCw,
          onClick: handleFetchOrigin,
        },
        {
          id: "open-ide",
          label: t("ellipsisMenu.openInEditor", { editor: preferredIde }),
          icon: SquareArrowOutUpRight,
          onClick: handleOpenInPreferredEditor,
        },
        {
          id: "view-github",
          label: t("ellipsisMenu.viewInGitHub"),
          icon: Github,
          onClick: handleViewInGitHub,
          show: !!currentRepo?.repo_url,
        },
        {
          id: "locate-finder",
          label: t(getFileManagerRevealLabelKey()),
          icon: FolderSearch,
          onClick: handleLocateInFinder,
        },
        {
          id: "copy-path",
          label: t("ellipsisMenu.copyLocalPath"),
          icon: Copy,
          onClick: handleCopyLocalPath,
        },
        copyEventsJsonItem,
        {
          id: "divider",
          label: "",
          icon: CircleMinus,
          onClick: () => {},
        },
        {
          id: "remove",
          label: t("ellipsisMenu.removeRepo"),
          icon: CircleMinus,
          onClick: handleRemoveRepo,
          isDanger: true,
        },
      ].filter(Boolean) as DropdownMenuItem[],
    [
      t,
      preferredIde,
      currentRepo?.repo_url,
      copyEventsJsonItem,
      handleFetchOrigin,
      handleOpenInPreferredEditor,
      handleViewInGitHub,
      handleLocateInFinder,
      handleCopyLocalPath,
      handleRemoveRepo,
    ]
  );

  const noReposMenuItems: DropdownMenuItem[] = useMemo(
    () => [
      {
        id: "add-workspace",
        label: t("ellipsisMenu.addWorkspace"),
        icon: Plus,
        onClick: () => {
          setEllipsisMenuOpen(false);
          onOpenRepoSelector?.();
        },
      },
    ],
    [t, onOpenRepoSelector, setEllipsisMenuOpen]
  );

  const menuItems: DropdownMenuItem[] = useMemo(() => {
    if (isSettingsRoute) {
      return [];
    }
    if (hasNoRepos) {
      return noReposMenuItems;
    }
    if (isEditorRoute) {
      return editorMenuItems;
    }
    return regularMenuItems;
  }, [
    isSettingsRoute,
    hasNoRepos,
    noReposMenuItems,
    isEditorRoute,
    editorMenuItems,
    regularMenuItems,
  ]);

  return { menuItems };
}
