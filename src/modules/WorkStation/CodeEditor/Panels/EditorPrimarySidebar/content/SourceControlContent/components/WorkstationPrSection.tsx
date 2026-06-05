import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitPullRequest,
  TriangleAlert,
} from "lucide-react";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";

const PR_STATUS_COLORS: Record<string, string> = {
  open: "bg-success-1 text-success-6",
  merged: "bg-primary-1 text-primary-6",
  closed: "bg-fill-3 text-text-3",
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
  const [collapsed, setCollapsed] = useState(false);
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
  const isInactive = prStatus === "closed" || prStatus === "merged";
  const hasActivePr = !!prUrl && !isInactive;

  if (!eligible && !prUrl && !isCreating && !displayError) return null;

  return (
    <div className="flex-shrink-0 border-b border-border-2">
      {/* Section header — matches SectionHeader style */}
      <div
        className="group/pr-header flex h-[28px] w-full cursor-pointer items-center gap-1.5 px-3 hover:bg-fill-1"
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setCollapsed((c) => !c);
        }}
      >
        {collapsed ? (
          <ChevronRight size={14} className="shrink-0 text-text-3" />
        ) : (
          <ChevronDown size={14} className="shrink-0 text-text-3" />
        )}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 leading-none">
          <GitPullRequest size={12} className="shrink-0 text-text-3" />
          <span className="truncate text-[11px] font-medium uppercase leading-none text-text-2">
            {t("git.pr.title")}
          </span>
        </div>

        {/* Right-side: status badge + create button */}
        <div
          className="flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {prUrl && prStatus && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${PR_STATUS_COLORS[prStatus] ?? "bg-fill-2 text-text-3"}`}
            >
              {t(`git.pr.status.${prStatus}`, { defaultValue: prStatus })}
            </span>
          )}
          {isCreating ? (
            <Button
              variant="primary"
              appearance="outline"
              size="mini"
              shape="round"
              loading
              loadingSpinIcon
              icon={<GitPullRequest size={11} />}
              disabled
            >
              {t("git.pr.creating")}
            </Button>
          ) : (
            readyToCreate && (
              <Button
                variant="primary"
                appearance="outline"
                size="mini"
                shape="round"
                icon={<GitPullRequest size={11} />}
                onClick={handleCreate}
                disabled={!onCreatePr}
              >
                {t("git.actions.createPR")}
              </Button>
            )
          )}
        </div>
      </div>

      {/* Collapsible body */}
      {!collapsed && (
        <div className="px-3 pb-2 pt-1">
          {/* Existing PR link */}
          {prUrl && (
            <a
              href={prUrl}
              target="_blank"
              rel="noreferrer"
              className="group/pr-link flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-text-2 hover:bg-fill-2"
            >
              <ExternalLink
                size={12}
                className="shrink-0 text-text-3 group-hover/pr-link:text-primary-6"
              />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium group-hover/pr-link:text-primary-6">
                {prUrl.replace(/^https?:\/\/[^/]+\//, "")}
              </span>
            </a>
          )}

          {/* Branch name */}
          {branchName && (
            <div className="flex items-center gap-1 px-2 pb-0.5 pt-0">
              <code className="text-[11px] text-text-3">{branchName}</code>
            </div>
          )}

          {/* Error */}
          {displayError && (
            <div className="mt-1.5 flex items-start gap-1.5 rounded-md bg-fill-2 px-2 py-1.5">
              <TriangleAlert
                size={12}
                className="mt-0.5 shrink-0 text-warning-6"
              />
              <p className="min-w-0 flex-1 text-[12px] text-text-2">
                {displayError}
              </p>
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
          )}

          {/* Ready hint when no PR yet */}
          {readyToCreate && !prUrl && !isCreating && !displayError && (
            <p className="px-2 pt-0.5 text-[12px] text-text-3">
              {autoCreatePr ? t("git.pr.autoCreating") : t("git.pr.readyHint")}
            </p>
          )}

          {/* Not eligible hint */}
          {!eligible && !prUrl && !isCreating && !displayError && (
            <p className="px-2 pt-0.5 text-[12px] text-text-3">
              {t("git.pr.neutralHint")}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkstationPrSection;
