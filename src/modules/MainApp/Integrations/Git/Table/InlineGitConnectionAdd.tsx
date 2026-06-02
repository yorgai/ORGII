import { ArrowUpRight, Plus, RefreshCw } from "lucide-react";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { gitApi } from "@src/api/http/git";
import {
  LOCAL_GITHUB_TOKEN_USER_ID,
  storeDetectedGitHubToken,
} from "@src/api/tauri/github";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import { useGitHubLocalDetect } from "@src/hooks/git/useGitHubLocalDetect";
import { useRefreshSpin } from "@src/hooks/ui";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import { getRepoContext } from "@src/services/git/operations/types";
import { openExternalLink } from "@src/util/platform/ipcRenderer";

const GITHUB_TOKEN_URL = "https://github.com/settings/tokens";
export const LOCAL_GIT_AUTH_KIND_STORAGE_KEY = "orgii:git:localAuthKind";
export const LOCAL_GIT_AUTH_VALUE_STORAGE_KEY = "orgii:git:localAuthValue";
export const LOCAL_GIT_HIDDEN_SSH_STORAGE_KEY = "orgii:git:hiddenSshRemote";

type AutoDetectStatus =
  | "idle"
  | "tokenSaved"
  | "sshSwitched"
  | "alreadySsh"
  | "notFound";

function githubHttpsToSsh(remoteUrl: string): string | null {
  const match = remoteUrl.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i
  );
  if (!match) return null;
  return `git@github.com:${match[1]}/${match[2]}.git`;
}

function isGithubSshRemote(remoteUrl: string): boolean {
  return /^git@github\.com:[^/]+\/[^/]+(?:\.git)?$/i.test(remoteUrl.trim());
}

export function maskGitHubToken(token: string): string {
  const trimmedToken = token.trim();
  if (trimmedToken.length <= 10) return "ghp_…";
  return `${trimmedToken.slice(0, 4)}…${trimmedToken.slice(-4)}`;
}

export type LocalGitAuthKind = "token" | "ssh";

interface InlineGitConnectionAddProps {
  onAfterOpen?: () => void | Promise<void>;
  onConfigured?: (kind: LocalGitAuthKind, value?: string) => void;
}

const InlineGitConnectionAdd: React.FC<InlineGitConnectionAddProps> = ({
  onAfterOpen,
  onConfigured,
}) => {
  const { t } = useTranslation("integrations");
  const { t: tCommon } = useTranslation("common");
  const { detecting, detectError, detect } = useGitHubLocalDetect();
  const [manualToken, setManualToken] = useState("");
  const [tokenFormOpen, setTokenFormOpen] = useState(false);
  const [savingManualToken, setSavingManualToken] = useState(false);
  const [autoStatus, setAutoStatus] = useState<AutoDetectStatus>("idle");
  const [autoError, setAutoError] = useState<string | null>(null);

  const handleStoreToken = useCallback(
    async (token: string) => {
      await storeDetectedGitHubToken(LOCAL_GITHUB_TOKEN_USER_ID, token);
      const maskedToken = maskGitHubToken(token);
      localStorage.setItem(LOCAL_GIT_AUTH_KIND_STORAGE_KEY, "token");
      localStorage.setItem(LOCAL_GIT_AUTH_VALUE_STORAGE_KEY, maskedToken);
      onConfigured?.("token", maskedToken);
      await onAfterOpen?.();
    },
    [onAfterOpen, onConfigured]
  );

  const handleSaveManualToken = useCallback(async () => {
    const tokenToStore = manualToken.trim();
    if (!tokenToStore) return;
    setSavingManualToken(true);
    setAutoError(null);
    try {
      await handleStoreToken(tokenToStore);
      setManualToken("");
      setTokenFormOpen(false);
      setAutoStatus("tokenSaved");
    } catch (error) {
      setAutoError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingManualToken(false);
    }
  }, [handleStoreToken, manualToken]);

  const switchGithubHttpsRemoteToSsh = useCallback(async (): Promise<{
    status: "already" | "switched";
    value: string;
  } | null> => {
    const repo = getRepoContext();
    if (!repo) return null;

    const remotesData = await gitApi.getGitRemotes({
      repo_id: repo.repoId,
      repo_path: repo.repoPath,
    });
    const remote = remotesData?.remotes.find(
      (candidateRemote) => candidateRemote.name === "origin"
    );
    if (!remote) return null;
    const remoteUrl = remote.push_url ?? remote.fetch_url ?? remote.url;
    if (!remoteUrl) return null;
    if (isGithubSshRemote(remoteUrl)) {
      return { status: "already", value: remoteUrl };
    }

    const sshUrl = githubHttpsToSsh(remoteUrl);
    if (!sshUrl) return null;

    const updatedRemote = await gitApi.updateGitRemote({
      repo_id: repo.repoId,
      repo_path: repo.repoPath,
      remote_name: remote.name,
      url: sshUrl,
    });
    if (!updatedRemote) return null;
    return { status: "switched", value: sshUrl };
  }, []);

  const handleAutoDetect = useCallback(async () => {
    setAutoStatus("idle");
    setAutoError(null);
    try {
      const detected = await detect();
      if (!detected) return;

      const detectedToken =
        detected.gh_cli?.token ?? detected.credential_helper?.token ?? null;
      if (detectedToken) {
        await handleStoreToken(detectedToken);
        setAutoStatus("tokenSaved");
        return;
      }

      if (detected.ssh_keys.length > 0) {
        const sshRemote = await switchGithubHttpsRemoteToSsh();
        if (sshRemote?.status === "already") {
          localStorage.removeItem(LOCAL_GIT_HIDDEN_SSH_STORAGE_KEY);
          localStorage.setItem(LOCAL_GIT_AUTH_KIND_STORAGE_KEY, "ssh");
          localStorage.setItem(
            LOCAL_GIT_AUTH_VALUE_STORAGE_KEY,
            sshRemote.value
          );
          onConfigured?.("ssh", sshRemote.value);
          await onAfterOpen?.();
          setAutoStatus("alreadySsh");
        } else if (sshRemote) {
          localStorage.removeItem(LOCAL_GIT_HIDDEN_SSH_STORAGE_KEY);
          localStorage.setItem(LOCAL_GIT_AUTH_KIND_STORAGE_KEY, "ssh");
          localStorage.setItem(
            LOCAL_GIT_AUTH_VALUE_STORAGE_KEY,
            sshRemote.value
          );
          onConfigured?.("ssh", sshRemote.value);
          await onAfterOpen?.();
          setAutoStatus("sshSwitched");
        } else {
          setAutoStatus("notFound");
        }
        return;
      }

      setAutoStatus("notFound");
    } catch (error) {
      setAutoError(error instanceof Error ? error.message : String(error));
    }
  }, [
    detect,
    handleStoreToken,
    onAfterOpen,
    onConfigured,
    switchGithubHttpsRemoteToSsh,
  ]);

  const { spinClass, handleClick: handleDetectClick } = useRefreshSpin(
    () => void handleAutoDetect(),
    detecting
  );

  const statusText =
    autoStatus === "tokenSaved"
      ? t("git.autoDetectTokenSaved")
      : autoStatus === "sshSwitched"
        ? t("git.autoDetectSshSwitched")
        : autoStatus === "alreadySsh"
          ? t("git.autoDetectAlreadySsh")
          : autoStatus === "notFound"
            ? t("git.autoDetectNotFound")
            : null;

  return (
    <div className="flex flex-col gap-3">
      <SectionContainer>
        <SectionRow
          label={t("git.autoDetect")}
          description={t("git.detectFromSystemDesc")}
        >
          <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
            {statusText && (
              <span className="min-w-0 truncate text-[12px] text-text-3">
                {statusText}
              </span>
            )}
            <Button
              variant="secondary"
              size="default"
              icon={<RefreshCw size={14} className={spinClass} />}
              loading={detecting}
              loadingSpinIcon
              onClick={handleDetectClick}
            >
              {t("keyVault.detect")}
            </Button>
          </div>
        </SectionRow>

        {(detectError || autoError) && (
          <SectionRow showHeader={false} className="pt-0">
            <div className="rounded border border-solid border-danger-3 bg-danger-1 px-3 py-2 text-[12px] text-danger-6">
              {detectError || autoError}
            </div>
          </SectionRow>
        )}
      </SectionContainer>

      <SectionContainer>
        <SectionRow
          label={t("git.manuallyAddToken")}
          description={t("git.manualTokenDesc")}
        >
          {!tokenFormOpen && (
            <Button
              variant="secondary"
              size="default"
              icon={<Plus size={14} />}
              onClick={() => setTokenFormOpen(true)}
            >
              {tCommon("actions.add")}
            </Button>
          )}
        </SectionRow>

        {tokenFormOpen && (
          <>
            <SectionRow showHeader={false} className="pt-0">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Input
                  value={manualToken}
                  type="password"
                  size="default"
                  placeholder="ghp_..."
                  onChange={setManualToken}
                  style={{ flex: 1 }}
                />
                <Button
                  variant="secondary"
                  size="default"
                  onClick={() => {
                    setManualToken("");
                    setTokenFormOpen(false);
                  }}
                >
                  {tCommon("actions.cancel")}
                </Button>
                <Button
                  variant="primary"
                  size="default"
                  disabled={!manualToken.trim()}
                  loading={savingManualToken}
                  onClick={() => void handleSaveManualToken()}
                >
                  {tCommon("actions.save")}
                </Button>
              </div>
            </SectionRow>
            <SectionRow
              label={t("git.noTokenYet")}
              description={t("git.createTokenDesc")}
              className="pt-0"
            >
              <Button
                variant="secondary"
                size="default"
                icon={<ArrowUpRight size={14} />}
                iconPosition="right"
                onClick={() => void openExternalLink(GITHUB_TOKEN_URL)}
              >
                {tCommon("actions.add")}
              </Button>
            </SectionRow>
          </>
        )}
      </SectionContainer>
    </div>
  );
};

export default InlineGitConnectionAdd;
