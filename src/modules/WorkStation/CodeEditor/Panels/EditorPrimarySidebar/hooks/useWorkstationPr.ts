import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { fetchRustApi, gitRepoUrl } from "@src/api/http/git/client";
import { getGitRemotes } from "@src/api/http/git/remotes";
import {
  LOCAL_GITHUB_TOKEN_USER_ID,
  findPullRequestLocal,
  getGitHubGitCredentialForRemote,
} from "@src/api/tauri/github";
import { Message } from "@src/components/Message";
import { buildIntegrationsPath } from "@src/config/mainAppPaths/integrations";
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
  workstationPrAtom,
  workstationPrCallbackAtom,
} from "@src/store/workstation/codeEditor/workstationPrAtom";

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
  const navigate = useNavigate();
  const autoCreatePr = useAtomValue(gitAutoCreatePrAtom);
  const setWorkstationPrAtom = useSetAtom(workstationPrAtom);
  const setWorkstationPrCallbackAtom = useSetAtom(workstationPrCallbackAtom);
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
      try {
        const remotesData = await getGitRemotes({
          repo_id: repoId,
          repo_path: repoPath,
        });
        const originRemote = remotesData?.remotes?.find(
          (remote) => remote.name === "origin"
        );
        if (!originRemote?.url) return;

        const hostedToken = getHostedToken();
        const hostedUserId = localStorage.getItem(
          SERVICE_AUTH_STORAGE_KEYS.userId
        );

        let userId: string | null = null;
        let token: string | null = null;

        if (hostedToken && hostedUserId) {
          userId = hostedUserId;
          token = hostedToken;
        } else {
          try {
            const credential = await getGitHubGitCredentialForRemote(
              LOCAL_GITHUB_TOKEN_USER_ID,
              originRemote.url
            );
            if (credential) {
              userId = LOCAL_GITHUB_TOKEN_USER_ID;
              token = credential.token;
            }
          } catch {
            // no local credential available
          }
        }

        if (!userId || !token) return;

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
    if (isCreating) return {};
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
      if (result.error === "not_authenticated") {
        setCreatingByBranch((current) => ({ ...current, [branchName]: false }));
        navigate(buildIntegrationsPath({ category: "git" }));
        Message.info({
          id: "github-auth-required",
          title: t("git.pr.authRequired.title"),
          content: t("git.pr.authRequired.description"),
          duration: 8000,
          closable: true,
        });
        return { error: result.error };
      }

      const message =
        result.error === "no_origin_remote"
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
  }, [isCreating, branchName, repoPath, commitMessage, repoId, t, navigate]);

  const prIsActive = !!prUrl && prStatus !== "closed" && prStatus !== "merged";
  const readyToCreate = eligible && !prIsActive;

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

  useEffect(() => {
    setWorkstationPrAtom({ readyToCreate, prUrl, isCreating });
  }, [readyToCreate, prUrl, isCreating, setWorkstationPrAtom]);

  useEffect(() => {
    setWorkstationPrCallbackAtom({ createPr: handleCreatePr });
  }, [handleCreatePr, setWorkstationPrCallbackAtom]);

  useEffect(() => {
    return () => {
      setWorkstationPrAtom({
        readyToCreate: false,
        prUrl: undefined,
        isCreating: false,
      });
      setWorkstationPrCallbackAtom({ createPr: null });
    };
  }, [setWorkstationPrAtom, setWorkstationPrCallbackAtom]);

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
