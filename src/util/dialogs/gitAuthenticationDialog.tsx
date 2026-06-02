import React, { useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import Radio, { type RadioValue } from "@src/components/Radio";
import Modal from "@src/scaffold/ModalSystem";

export interface GitAuthenticationDialogOptions {
  operation: "push" | "pull" | "fetch" | "sync";
  repoPath?: string;
  remote?: string;
}

type GitAuthPersistenceMode = "store" | "once";

export interface GitAuthenticationDialogResult {
  username: string;
  token: string;
  shouldStore: boolean;
}

interface GitAuthenticationDialogProps extends GitAuthenticationDialogOptions {
  onResolve: (result: GitAuthenticationDialogResult | null) => void;
}

const GITHUB_TOKEN_URL = "https://github.com/settings/tokens";

function GitAuthenticationDialog({
  operation,
  repoPath,
  remote,
  onResolve,
}: GitAuthenticationDialogProps) {
  const { t } = useTranslation("common");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [persistenceMode, setPersistenceMode] =
    useState<GitAuthPersistenceMode>("store");
  const [submitted, setSubmitted] = useState(false);

  const canSubmit = username.trim().length > 0 && token.trim().length > 0;

  const operationLabel = useMemo(() => {
    return t(`git.authDialog.operations.${operation}`);
  }, [operation, t]);

  const handleCancel = useCallback(() => {
    onResolve(null);
  }, [onResolve]);

  const handlePersistenceModeChange = useCallback((value: RadioValue) => {
    setPersistenceMode(value === "once" ? "once" : "store");
  }, []);

  const handleSubmit = useCallback(() => {
    setSubmitted(true);
    if (!canSubmit) {
      return;
    }
    onResolve({
      username: username.trim(),
      token: token.trim(),
      shouldStore: persistenceMode === "store",
    });
  }, [canSubmit, onResolve, persistenceMode, token, username]);

  return (
    <Modal
      visible
      title={t("git.authDialog.title")}
      width={460}
      okText={t("actions.continue")}
      cancelText={t("actions.cancel")}
      onOk={handleSubmit}
      onCancel={handleCancel}
      onClose={handleCancel}
      maskClosable={false}
      okButtonProps={{ disabled: submitted && !canSubmit }}
    >
      <div className="flex flex-col gap-4">
        <div className="text-[12px] text-text-3">
          {t("git.authDialog.subtitle", { operation: operationLabel })}
        </div>

        <div className="rounded-xl border border-border-2 bg-fill-1 px-3 py-2.5 text-[12px] leading-5 text-text-2">
          {t("git.authDialog.securityNote")}
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium text-text-2">
            {t("git.authDialog.persistenceLabel")}
          </div>
          <Radio.Group
            value={persistenceMode}
            direction="vertical"
            onChange={handlePersistenceModeChange}
          >
            <Radio value="store">
              {t("git.authDialog.storeForFutureOperations")}
            </Radio>
            <Radio value="once">{t("git.authDialog.useOnce")}</Radio>
          </Radio.Group>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-text-2">
            {t("git.authDialog.usernameLabel")}
          </label>
          <Input
            value={username}
            placeholder="octocat"
            autoFocus
            onChange={setUsername}
            errorMessage={
              submitted && username.trim().length === 0
                ? t("git.authDialog.usernameRequired")
                : undefined
            }
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-text-2">
            {t("git.authDialog.tokenLabel")}
          </label>
          <Input
            value={token}
            type="password"
            placeholder="ghp_..."
            onChange={setToken}
            errorMessage={
              submitted && token.trim().length === 0
                ? t("git.authDialog.tokenRequired")
                : undefined
            }
          />
          <div className="text-[11px] leading-4 text-text-3">
            {t("git.authDialog.tokenHelpPrefix")}
            <button
              type="button"
              className="text-accent-11 underline-offset-2 hover:underline"
              onClick={() => window.open(GITHUB_TOKEN_URL, "_blank")}
            >
              {t("git.authDialog.tokenSettingsLink")}
            </button>
            .
          </div>
        </div>

        {(remote || repoPath) && (
          <div className="bg-fill-0 flex flex-col gap-1 rounded-lg px-3 py-2 text-[11px] text-text-3">
            {remote && <div>{t("git.authDialog.remoteLabel", { remote })}</div>}
            {repoPath && (
              <div className="truncate">
                {t("git.authDialog.repoLabel", { repoPath })}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function showGitAuthenticationDialog(
  options: GitAuthenticationDialogOptions
): Promise<GitAuthenticationDialogResult | null> {
  return new Promise((resolve) => {
    const container = document.createElement("div");
    container.setAttribute("data-git-auth-dialog-root", "true");
    document.body.appendChild(container);

    const root = createRoot(container);

    const cleanup = () => {
      setTimeout(() => {
        root.unmount();
        container.remove();
      }, 0);
    };

    root.render(
      <GitAuthenticationDialog
        {...options}
        onResolve={(result) => {
          resolve(result);
          cleanup();
        }}
      />
    );
  });
}
