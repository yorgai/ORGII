import {
  ExternalLink,
  GitPullRequest,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";

const PR_STATUS_COLORS: Record<string, string> = {
  open: "bg-success-1 text-success-6",
  merged: "bg-primary-1 text-primary-6",
  closed: "bg-danger-1 text-danger-6",
  draft: "bg-warning-1 text-warning-6",
};

export interface WorkstationPrSectionProps {
  branchName?: string;
  prUrl?: string;
  prStatus?: string;
  isCreating?: boolean;
  errorMessage?: string | null;
  readyToCreate?: boolean;
  autoCreatePr?: boolean;
  eligible?: boolean;
  onCreatePr?: () => Promise<{ url?: string; error?: string }>;
}

const WorkstationPrSection: React.FC<WorkstationPrSectionProps> = ({
  branchName,
  prUrl,
  prStatus,
  isCreating = false,
  errorMessage,
  readyToCreate = false,
  autoCreatePr = false,
  eligible = false,
  onCreatePr,
}) => {
  const { t } = useTranslation();
  const [localError, setLocalError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (!onCreatePr) return;
    setLocalError(null);
    const result = await onCreatePr();
    if (result.error && result.error !== "not_authenticated") {
      setLocalError(result.error);
    }
  }, [onCreatePr]);

  const displayError = errorMessage ?? localError;

  if (prUrl) {
    const statusColor =
      PR_STATUS_COLORS[prStatus ?? ""] ?? "bg-fill-2 text-text-3";
    return (
      <div className="flex-shrink-0 border-b border-border-2 px-3 py-2">
        <div className="rounded-lg bg-fill-2 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-3">
                <GitPullRequest size={12} />
                {t("git.pr.title")}
              </div>
              <a
                href={prUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-6 hover:underline"
              >
                <ExternalLink size={13} />
                <span className="truncate">
                  {prUrl.replace(/^https?:\/\/[^/]+\//, "")}
                </span>
              </a>
              <div className="mt-1 flex items-center gap-2">
                {prStatus && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusColor}`}
                  >
                    {t(`git.pr.status.${prStatus}`, { defaultValue: prStatus })}
                  </span>
                )}
                {branchName && (
                  <code className="text-[11px] text-text-3">{branchName}</code>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isCreating) {
    return (
      <div className="flex-shrink-0 border-b border-border-2 px-3 py-2">
        <div className="rounded-lg bg-fill-2 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-primary-6" />
            <p className="text-sm text-text-2">{t("git.pr.creating")}</p>
          </div>
          {branchName && (
            <code className="mt-1 block text-[11px] text-text-3">
              {branchName}
            </code>
          )}
        </div>
      </div>
    );
  }

  if (displayError) {
    return (
      <div className="flex-shrink-0 border-b border-border-2 px-3 py-2">
        <div className="rounded-lg bg-fill-2 px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-start gap-1.5">
              <TriangleAlert
                size={13}
                className="mt-0.5 shrink-0 text-warning-6"
              />
              <div className="min-w-0">
                <p className="text-[13px] text-text-2">{displayError}</p>
                {branchName && (
                  <code className="mt-0.5 block text-[11px] text-text-3">
                    {branchName}
                  </code>
                )}
              </div>
            </div>
            <Button
              variant="tertiary"
              size="mini"
              shape="round"
              onClick={handleCreate}
              className="shrink-0"
            >
              {t("actions.retry")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (readyToCreate && !autoCreatePr) {
    return (
      <div className="flex-shrink-0 border-b border-border-2 px-3 py-2">
        <div className="rounded-lg bg-fill-2 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm text-text-2">{t("git.pr.readyHint")}</p>
              {branchName && (
                <code className="mt-1 block text-[11px] text-text-3">
                  {branchName}
                </code>
              )}
            </div>
            <Button
              variant="primary"
              appearance="outline"
              size="small"
              icon={<GitPullRequest size={13} />}
              onClick={handleCreate}
              disabled={!onCreatePr}
            >
              {t("git.actions.createPR")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!branchName || !eligible) {
    return null;
  }

  return (
    <div className="flex-shrink-0 border-b border-border-2 px-3 py-2">
      <div className="rounded-lg bg-fill-2 px-3 py-2.5">
        <p className="text-sm text-text-2">{t("git.pr.neutralHint")}</p>
        <code className="mt-1 block text-[11px] text-text-3">{branchName}</code>
      </div>
    </div>
  );
};

export default WorkstationPrSection;
