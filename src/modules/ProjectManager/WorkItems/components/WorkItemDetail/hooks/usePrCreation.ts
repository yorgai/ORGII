import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { createPullRequest } from "@src/services/git/operations/createPullRequest";
import { invokeTauri } from "@src/util/platform/tauri/init";

interface UsePrCreationOptions {
  workItemName?: string;
  branch?: string;
  worktreePath: string | null;
  projectRepoPath: string | null;
  projectSlug?: string | null;
  shortId?: string | null;
  onRefreshWorkItem?: () => void;
}

export function usePrCreation(options: UsePrCreationOptions) {
  const {
    workItemName,
    branch,
    worktreePath,
    projectRepoPath,
    projectSlug,
    shortId,
    onRefreshWorkItem,
  } = options;

  const { t } = useTranslation("projects");

  const handleCreatePr = useCallback(async (): Promise<{
    url?: string;
    error?: string;
  }> => {
    if (!branch) {
      return { error: t("workItems.errors.noBranch") };
    }

    const targetRepoPath = worktreePath ?? projectRepoPath;
    if (!targetRepoPath) {
      return { error: t("workItems.errors.noRepoPath") };
    }

    const prTitle = workItemName || `[${shortId}] Work item changes`;
    const result = await createPullRequest({
      repoPath: targetRepoPath,
      branch,
      title: prTitle,
    });

    if (result.error) {
      const message =
        result.error === "not_authenticated"
          ? t("workItems.errors.notAuthenticated")
          : result.error === "no_origin_remote"
            ? t("workItems.errors.noOriginRemote")
            : result.error === "cannot_parse_repo_name"
              ? t("workItems.errors.cannotParseRepoName", { url: "origin" })
              : result.error;
      return { error: message };
    }

    if (projectSlug && shortId && result.url) {
      await invokeTauri("orchestrator_set_pr", {
        projectSlug,
        workItemId: shortId,
        prUrl: result.url,
        prStatus: "open",
      });
    }

    onRefreshWorkItem?.();
    return { url: result.url };
  }, [
    branch,
    workItemName,
    worktreePath,
    projectRepoPath,
    projectSlug,
    shortId,
    onRefreshWorkItem,
    t,
  ]);

  return { handleCreatePr };
}
