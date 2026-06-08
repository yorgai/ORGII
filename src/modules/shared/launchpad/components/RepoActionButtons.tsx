import { openPath } from "@tauri-apps/plugin-opener";
import { useSetAtom } from "jotai";
import {
  Expand,
  FolderOpen,
  FolderSearch,
  MessageCircle,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { repoApi } from "@src/api/tauri/repo";
import Button, { type ButtonProps } from "@src/components/Button";
import Message from "@src/components/Toast";
import { ROUTES } from "@src/config/routes";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { createLogger } from "@src/hooks/logger";
import { useValidatedLastPair } from "@src/hooks/models/useValidatedLastPair";
import { useRepoDetection } from "@src/modules/shared/launchpad/hooks/useRepoDetection";
import { useRepoSetup } from "@src/modules/shared/launchpad/hooks/useRepoSetup";
import { selectedRepoIdAtom } from "@src/store/repo";
import type { Repo } from "@src/store/repo/types";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";
import { getFileManagerRevealLabelKey } from "@src/util/platform/fileManagerLabels";

const logger = createLogger("RepoActionButtons");

interface RepoActionButtonsProps {
  repo: Repo;
  onOpenDetails: (repo: Repo) => void;
  onClear?: () => void;
  shape?: ButtonProps["shape"];
  className?: string;
  showDetails?: boolean;
  showLocate?: boolean;
  showRemove?: boolean;
  showClose?: boolean;
  iconOnlySecondary?: boolean;
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

const RepoActionButtons: React.FC<RepoActionButtonsProps> = ({
  repo,
  onOpenDetails,
  onClear,
  shape = "square",
  className = "",
  showDetails = true,
  showLocate = true,
  showRemove = true,
  showClose = true,
  iconOnlySecondary = false,
}) => {
  const { t } = useTranslation(["navigation", "common"]);
  const setSelectedRepoId = useSetAtom(selectedRepoIdAtom);
  const { forceRefreshRepos } = useRepoSelection({ autoLoad: false });

  const { launching, launchSetup } = useRepoSetup();
  const lastModel = useValidatedLastPair();

  const repoPath = repo.fs_uri ? stripFileUri(repo.fs_uri) : (repo.path ?? "");
  const repoLabel = repo.name || repoPath.split("/").pop() || "Repo";

  const { repoType, repoTypeLabel, configFiles, hasDocker, hasMakefile } =
    useRepoDetection(repoPath || undefined);

  const handleSetupRepo = useCallback(async () => {
    if (!repoPath || launching) return;
    try {
      await launchSetup(
        {
          repoPath,
          repoName: repoLabel,
          repoType,
          repoTypeLabel,
          configFiles,
          hasDocker,
          hasMakefile,
        },
        {
          trusted: false,
          keySource: lastModel?.keySource,
          model: lastModel?.model,
          accountId: lastModel?.selectedAccountId,
          cliAgentType: lastModel?.cliAgentType,
          listingModel: lastModel?.listingModel,
          listingModelType: lastModel?.listingModelType,
          tier: lastModel?.tier,
        }
      );
    } catch (error) {
      logger.error("launching repo setup failed:", error);
      Message.error(
        t("navigation:launchpad.actions.setupFailed", {
          defaultValue: "Failed to start repo setup",
        })
      );
    }
  }, [
    repoPath,
    repoLabel,
    repoType,
    repoTypeLabel,
    configFiles,
    hasDocker,
    hasMakefile,
    launching,
    launchSetup,
    lastModel,
    t,
  ]);

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
    try {
      await openPath(repoPath);
    } catch (error) {
      logger.error("opening repo in file manager failed:", error);
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
      onClear?.();
      await forceRefreshRepos();
      Message.success(
        t("navigation:launchpad.actions.removeSuccess", {
          defaultValue: "Workspace removed",
        })
      );
    } catch (error) {
      logger.error("removing repo failed:", error);
      Message.error(
        error instanceof Error
          ? error.message
          : t("navigation:launchpad.actions.removeFailed", {
              defaultValue: "Failed to remove workspace",
            })
      );
    }
  }, [repo.id, repoLabel, onClear, forceRefreshRepos, t]);

  const secondaryButtonProps = iconOnlySecondary
    ? { iconOnly: true, children: undefined }
    : {};

  return (
    <div className={`flex max-w-full items-center gap-1.5 ${className}`}>
      <Button
        variant="primary"
        size="small"
        shape={shape}
        className="shrink-0"
        icon={<Sparkles size={14} />}
        disabled={!repoPath || launching}
        loading={launching}
        onClick={handleSetupRepo}
      >
        {t("navigation:launchpad.actions.setupRepo", {
          defaultValue: "Setup",
        })}
      </Button>
      <Button
        variant="secondary"
        size="small"
        shape={shape}
        className="shrink-0"
        icon={<FolderOpen size={14} />}
        onClick={handleSwitch}
        title={t("navigation:launchpad.actions.switchToRepo", {
          defaultValue: "Open",
        })}
        {...secondaryButtonProps}
      >
        {iconOnlySecondary
          ? undefined
          : t("navigation:launchpad.actions.switchToRepo", {
              defaultValue: "Open",
            })}
      </Button>
      <Button
        variant="secondary"
        size="small"
        shape={shape}
        className="shrink-0"
        icon={<MessageCircle size={14} />}
        onClick={handleStartSession}
        title={t("navigation:launchpad.actions.startSession", {
          defaultValue: "Start session",
        })}
        {...secondaryButtonProps}
      >
        {iconOnlySecondary
          ? undefined
          : t("navigation:launchpad.actions.startSession", {
              defaultValue: "Start session",
            })}
      </Button>
      {showDetails ? (
        <Button
          variant="secondary"
          size="small"
          shape={shape}
          className="shrink-0"
          icon={<Expand size={14} />}
          onClick={handleOpenDetails}
          title={t("navigation:launchpad.actions.openDetails", {
            defaultValue: "Show details",
          })}
          {...secondaryButtonProps}
        >
          {iconOnlySecondary
            ? undefined
            : t("navigation:launchpad.actions.openDetails", {
                defaultValue: "Show details",
              })}
        </Button>
      ) : null}
      {showLocate ? (
        <Button
          variant="secondary"
          size="small"
          shape={shape}
          className="shrink-0"
          icon={<FolderSearch size={14} />}
          onClick={handleLocateInFinder}
          title={t(getFileManagerRevealLabelKey())}
          {...secondaryButtonProps}
        >
          {iconOnlySecondary ? undefined : t(getFileManagerRevealLabelKey())}
        </Button>
      ) : null}
      {showRemove ? (
        <Button
          variant="secondary"
          size="small"
          shape={shape}
          className="shrink-0"
          iconOnly
          icon={<Trash2 size={14} />}
          onClick={handleRemove}
          title={t("navigation:launchpad.actions.remove", {
            defaultValue: "Remove",
          })}
        />
      ) : null}
      {showClose && onClear ? (
        <Button
          variant="secondary"
          size="small"
          shape={shape}
          className="shrink-0"
          iconOnly
          icon={<X size={14} />}
          onClick={onClear}
          title={t("common:actions.close", { defaultValue: "Close" })}
        />
      ) : null}
    </div>
  );
};

export default RepoActionButtons;
