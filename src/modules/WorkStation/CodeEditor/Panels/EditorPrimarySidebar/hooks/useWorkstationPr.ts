import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchRustApi, gitRepoUrl } from "@src/api/http/git/client";
import { getGitRemotes } from "@src/api/http/git/remotes";
import { findPullRequestLocal } from "@src/api/tauri/github";
import {
  SERVICE_AUTH_STORAGE_KEYS,
  getHostedToken,
} from "@src/config/serviceAuth";
import { createLogger } from "@src/hooks/logger";
import {
  createPullRequest,
  parseGithubRepoFullName,
} from "@src/services/git/operations/createPullRequest";
import { gitAutoCreatePrAtom } from "@src/store/ui/editorSettingsAtom";

import {
  formatWorkstationPrTitle,
  getStoredWorkstationPr,
  isWorkstationPrEligible,
  normalizePullRequestStatus,
  setStoredWorkstationPr,
  shouldAutoCreateWorkstationPr,
} from "./workstationPrHelpers";

const logger = createLogger("useWorkstationPr");

export interface UseWorkstationPrOptions {
  repoPath: string;
  repoId?: string;
  branchName?: string;
  hasUpstream: boolean;
  ahead: number;
  uncommittedCount: number;
  commitMessage?: string;
}

type BranchPrState = {
  url: string;
  status?: string;
};

export function useWorkstationPr(options: UseWorkstationPrOptions) {
  const {
    repoPath,
    repoId = "default",
    branchName,
    hasUpstream,
    ahead,
    uncommittedCount,
    commitMessage,
  } = options;

  const { t } = useTranslation();
  const autoCreatePr = useAtomValue(gitAutoCreatePrAtom);
  const branchKey = branchName ?? "";

  const [remotePrByBranch, setRemotePrByBranch] = useState<
    Record<string, BranchPrState>
  >({});
  const [errorByBranch, setErrorByBranch] = useState<
    Record<string, string | null>
  >({});
  const [creatingByBranch, setCreatingByBranch] = useState<
    Record<string, boolean>
  >({});
  const [defaultBranch, setDefaultBranch] = useState("main");
  const autoTriggeredRef = useRef(false);
  const handleCreatePrRef = useRef<
    () => Promise<{ url?: string; error?: string }>
  >(async () => ({}));

  const storedPr = useMemo(() => {
    if (!repoPath || !branchName) return null;
    return getStoredWorkstationPr(repoPath, branchName);
  }, [repoPath, branchName]);

  const remotePr = branchKey ? remotePrByBranch[branchKey] : undefined;
  const prUrl = remotePr?.url ?? storedPr?.url;
  const prStatus = remotePr?.status ?? storedPr?.status;
  const errorMessage = branchKey ? (errorByBranch[branchKey] ?? null) : null;
  const isCreating = branchKey ? (creatingByBranch[branchKey] ?? false) : false;

  useEffect(() => {
    let cancelled = false;
    if (!repoPath) return;

    fetchRustApi<{ name: string }>(
      `${gitRepoUrl(repoId)}/default-branch?${new URLSearchParams({ path: repoPath }).toString()}`
    )
      .then((resp) => {
        if (!cancelled && resp.data?.name) {
          setDefaultBranch(resp.data.name);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDefaultBranch("main");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath, repoId]);

  useEffect(() => {
    autoTriggeredRef.current = false;
  }, [branchKey]);

  useEffect(() => {
    if (!repoPath || !branchName) return;

    let cancelled = false;

    void (async () => {
      const token = getHostedToken();
      const userId = localStorage.getItem(SERVICE_AUTH_STORAGE_KEYS.userId);
      if (!token || !userId) return;

      try {
        const remotesData = await getGitRemotes({
          repo_id: repoId,
          repo_path: repoPath,
        });
        const originRemote = remotesData?.remotes?.find(
          (remote) => remote.name === "origin"
        );
        if (!originRemote?.url) return;

        const repoFullName = parseGithubRepoFullName(originRemote.url);
        if (!repoFullName) return;

        const existing = await findPullRequestLocal(
          userId,
          token,
          repoFullName,
          branchName
        );
        if (cancelled || !existing?.url) return;

        const status = normalizePullRequestStatus(existing.state);
        setRemotePrByBranch((current) => ({
          ...current,
          [branchName]: { url: existing.url, status },
        }));
        setStoredWorkstationPr(repoPath, branchName, {
          url: existing.url,
          status,
        });
      } catch (error) {
        logger.debug(
          `Failed to refresh PR for ${branchName}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repoPath, repoId, branchName]);

  const eligible = useMemo(
    () =>
      isWorkstationPrEligible({
        branch: branchName,
        defaultBranch,
        hasUpstream,
        ahead,
        uncommittedCount,
      }),
    [branchName, defaultBranch, hasUpstream, ahead, uncommittedCount]
  );

  const handleCreatePr = useCallback(async (): Promise<{
    url?: string;
    error?: string;
  }> => {
    if (!branchName) {
      return { error: t("git.pr.noBranch") };
    }
    if (!repoPath) {
      return { error: t("git.pr.noRepoPath") };
    }

    setCreatingByBranch((current) => ({ ...current, [branchName]: true }));
    setErrorByBranch((current) => ({ ...current, [branchName]: null }));

    const title = formatWorkstationPrTitle(branchName, commitMessage);
    const result = await createPullRequest({
      repoPath,
      branch: branchName,
      title,
      repoId,
      pushBeforeCreate: true,
    });

    if (result.error) {
      const message =
        result.error === "not_authenticated"
          ? t("git.pr.notAuthenticated")
          : result.error === "no_origin_remote"
            ? t("git.pr.noOriginRemote")
            : result.error === "cannot_parse_repo_name"
              ? t("git.pr.cannotParseRepoName")
              : result.error;
      setErrorByBranch((current) => ({ ...current, [branchName]: message }));
      setCreatingByBranch((current) => ({ ...current, [branchName]: false }));
      return { error: message };
    }

    if (result.url) {
      setRemotePrByBranch((current) => ({
        ...current,
        [branchName]: { url: result.url!, status: "open" },
      }));
      setStoredWorkstationPr(repoPath, branchName, {
        url: result.url,
        status: "open",
      });
    }

    setCreatingByBranch((current) => ({ ...current, [branchName]: false }));
    return { url: result.url };
  }, [branchName, repoPath, commitMessage, repoId, t]);

  const readyToCreate = eligible && !prUrl;

  useEffect(() => {
    handleCreatePrRef.current = handleCreatePr;
  });

  useEffect(() => {
    if (
      shouldAutoCreateWorkstationPr({
        autoCreatePr,
        eligible,
        prUrl,
        isCreating,
      }) &&
      !autoTriggeredRef.current
    ) {
      autoTriggeredRef.current = true;
      const timer = setTimeout(() => {
        void handleCreatePrRef.current();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [autoCreatePr, eligible, prUrl, isCreating]);

  useEffect(() => {
    if (!readyToCreate) {
      autoTriggeredRef.current = false;
    }
  }, [readyToCreate]);

  return {
    prUrl,
    prStatus,
    isCreating,
    errorMessage,
    eligible,
    readyToCreate,
    autoCreatePr,
    handleCreatePr,
  };
}
