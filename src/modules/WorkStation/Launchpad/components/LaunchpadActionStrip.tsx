/**
 * LaunchpadActionStrip
 *
 * Sticky action bar rendered at the bottom of the Launchpad dashboard
 * pane while a workspace card is selected. Provides the five primary
 * verbs we want a user to be able to run against a workspace without
 * having to drill into the repo detail tab first:
 *
 *   - Switch to this repo (sets the global selection + jumps to Editor)
 *   - Start session (sets global selection + opens Agent Station)
 *   - Open details (opens the existing launchpad-repo tab)
 *   - Locate in Finder (reveals the path in the OS file manager)
 *   - Remove (deletes the repo record after a destructive confirmation)
 *
 * The strip owns no selection state of its own — the dashboard passes
 * in the selected repo and a clear callback so we can hide the bar
 * after destructive actions.
 */
import { openPath } from "@tauri-apps/plugin-opener";
import { useSetAtom } from "jotai";
import {
  ArrowLeftRight,
  Expand,
  FolderSearch,
  Play,
  Trash2,
  X,
} from "lucide-react";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { repoApi } from "@src/api/tauri/repo";
import Button from "@src/components/Button";
import Message from "@src/components/Toast";
import { ROUTES } from "@src/config/routes";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { selectedRepoIdAtom } from "@src/store/repo";
import type { Repo } from "@src/store/repo/types";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";
import { getFileManagerRevealLabelKey } from "@src/util/platform/fileManagerLabels";
import { isTauriDesktop } from "@src/util/platform/tauri";

interface LaunchpadActionStripProps {
  repo: Repo;
  onOpenDetails: (repo: Repo) => void;
  onClear: () => void;
}

function dispatchNavigate(path: string) {
  window.dispatchEvent(
    new CustomEvent("action-system-navigate", {
      detail: { path },
    })
  );
}

function stripFileUri(path: string): string {
  return path.replace(/^file:\/\//, "");
}

const LaunchpadActionStrip: React.FC<LaunchpadActionStripProps> = ({
  repo,
  onOpenDetails,
  onClear,
}) => {
  const { t } = useTranslation(["navigation", "common"]);
  const setSelectedRepoId = useSetAtom(selectedRepoIdAtom);
  const { forceRefreshRepos } = useRepoSelection({ autoLoad: false });

  const repoPath = repo.fs_uri ? stripFileUri(repo.fs_uri) : (repo.path ?? "");
  const repoLabel = repo.name || repoPath.split("/").pop() || "Repo";

  const handleSwitch = useCallback(() => {
    setSelectedRepoId(repo.id);
    dispatchNavigate(ROUTES.workStation.base.path);
  }, [repo.id, setSelectedRepoId]);

  const handleStartSession = useCallback(async () => {
    setSelectedRepoId(repo.id);
    const { AppViewService } = await import("@src/services/app/AppViewService");
    await AppViewService.createAgentStationSession();
  }, [repo.id, setSelectedRepoId]);

  const handleOpenDetails = useCallback(() => {
    onOpenDetails(repo);
  }, [onOpenDetails, repo]);

  const handleLocateInFinder = useCallback(async () => {
    if (!repoPath) {
      Message.warning(
        t("common:errors.noLocalPath", {
          defaultValue: "No local path available",
        })
      );
      return;
    }
    if (!isTauriDesktop()) {
      Message.warning(
        t("common:errors.desktopOnly", {
          defaultValue: "This feature is only available in the desktop app",
        })
      );
      return;
    }
    try {
      await openPath(repoPath);
    } catch (error) {
      console.error("Error opening in Finder:", error);
      Message.error(
        t("common:errors.openInFinderFailed", {
          defaultValue: "Failed to open in Finder",
        })
      );
    }
  }, [repoPath, t]);

  const handleRemove = useCallback(async () => {
    const confirmed = await confirmDestructiveAction({
      title: t("common:confirmation.removeTitle", { name: repoLabel }),
      message: t("common:confirmation.removeMessage"),
      okLabel: t("common:actions.remove"),
      cancelLabel: t("common:actions.cancel"),
    });
    if (!confirmed) return;
    try {
      const response = await repoApi.deleteRepo(repo.id);
      if (response?.status !== 0) {
        throw new Error("Failed to remove repo");
      }
      onClear();
      await forceRefreshRepos();
      Message.success(
        t("navigation:launchpad.actions.removeSuccess", {
          defaultValue: "Workspace removed",
        })
      );
    } catch (error) {
      console.error("Error removing repo:", error);
      Message.error(
        error instanceof Error
          ? error.message
          : t("navigation:launchpad.actions.removeFailed", {
              defaultValue: "Failed to remove workspace",
            })
      );
    }
  }, [repo.id, repoLabel, onClear, forceRefreshRepos, t]);

  return (
    <div className="w-fit max-w-full overflow-hidden rounded-full bg-fill-1 px-2 py-1.5">
      <div className="flex max-w-full items-center gap-1.5 overflow-x-auto scrollbar-hide">
        <Button
          variant="secondary"
          size="small"
          shape="round"
          className="shrink-0"
          icon={<ArrowLeftRight size={14} />}
          onClick={handleSwitch}
        >
          {t("navigation:launchpad.actions.switchToRepo", {
            defaultValue: "Open",
          })}
        </Button>
        <Button
          variant="secondary"
          size="small"
          shape="round"
          className="shrink-0"
          icon={<Play size={14} />}
          onClick={handleStartSession}
        >
          {t("navigation:launchpad.actions.startSession", {
            defaultValue: "Start session",
          })}
        </Button>
        <Button
          variant="secondary"
          size="small"
          shape="round"
          className="shrink-0"
          icon={<Expand size={14} />}
          onClick={handleOpenDetails}
        >
          {t("navigation:launchpad.actions.openDetails", {
            defaultValue: "Show details",
          })}
        </Button>
        <Button
          variant="secondary"
          size="small"
          shape="round"
          className="shrink-0"
          icon={<FolderSearch size={14} />}
          onClick={handleLocateInFinder}
        >
          {t(getFileManagerRevealLabelKey())}
        </Button>
        <Button
          variant="secondary"
          size="small"
          shape="round"
          className="shrink-0"
          iconOnly
          icon={<Trash2 size={14} />}
          onClick={handleRemove}
          title={t("navigation:launchpad.actions.remove", {
            defaultValue: "Remove",
          })}
        />
        <Button
          variant="secondary"
          size="small"
          shape="round"
          className="shrink-0"
          iconOnly
          icon={<X size={14} />}
          onClick={onClear}
          title={t("common:actions.close", { defaultValue: "Close" })}
        />
      </div>
    </div>
  );
};

export default LaunchpadActionStrip;
