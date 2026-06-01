import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { fetchRustApi, gitRepoUrl } from "@src/api/http/git/client";
import { gitPush } from "@src/api/http/git/operations";
import { getGitRemotes } from "@src/api/http/git/remotes";
import { createPRLocal } from "@src/api/tauri/github";
import {
  SERVICE_AUTH_STORAGE_KEYS,
  getHostedToken,
} from "@src/config/serviceAuth";
import { createLogger } from "@src/hooks/logger";
import { invokeTauri } from "@src/util/platform/tauri/init";

const logger = createLogger("usePrCreation");

function parseRepoFullName(remoteUrl: string): string | null {
  const sshMatch = remoteUrl.match(/git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];
  const httpsMatch = remoteUrl.match(/https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];
  return null;
}

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

    const token = getHostedToken();
    const userId = localStorage.getItem(SERVICE_AUTH_STORAGE_KEYS.userId);
    if (!token || !userId) {
      return { error: t("workItems.errors.notAuthenticated") };
    }

    const targetRepoPath = worktreePath ?? projectRepoPath;
    if (!targetRepoPath) {
      return { error: t("workItems.errors.noRepoPath") };
    }

    try {
      const remotesData = await getGitRemotes({
        repo_id: "default",
        repo_path: targetRepoPath,
      });
      const originRemote = remotesData?.remotes?.find(
        (remote) => remote.name === "origin"
      );
      if (!originRemote?.url) {
        return { error: t("workItems.errors.noOriginRemote") };
      }

      const repoFullName = parseRepoFullName(originRemote.url);
      if (!repoFullName) {
        return {
          error: t("workItems.errors.cannotParseRepoName", {
            url: originRemote.url,
          }),
        };
      }

      await gitPush({
        repo_id: "default",
        repo_path: targetRepoPath,
        remote: "origin",
        branch,
        set_upstream: true,
      });

      let baseBranch = "main";
      try {
        const queryParams = new URLSearchParams({ path: targetRepoPath });
        const branchResp = await fetchRustApi<{ name: string }>(
          `${gitRepoUrl("default")}/default-branch?${queryParams.toString()}`
        );
        if (branchResp.data?.name) {
          baseBranch = branchResp.data.name;
        }
      } catch {
        // Fallback to "main" if detection fails
      }

      const prTitle = workItemName || `[${shortId}] Work item changes`;

      const prResponse = await createPRLocal(
        userId,
        token,
        repoFullName,
        prTitle,
        branch,
        baseBranch
      );

      if (projectSlug && shortId) {
        await invokeTauri("orchestrator_set_pr", {
          projectSlug,
          workItemId: shortId,
          prUrl: prResponse.url,
          prStatus: "open",
        });
      }

      onRefreshWorkItem?.();
      return { url: prResponse.url };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to create PR: ${msg}`);
      return { error: msg };
    }
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
