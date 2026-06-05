import { ExternalLink, TriangleAlert } from "lucide-react";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { CollapsibleSection } from "@src/modules/WorkStation/shared/PrimarySidebarLayout/CollapsibleSection";
import {
  PRIMARY_SIDEBAR_HOVER,
  TYPOGRAPHY,
} from "@src/modules/WorkStation/shared/tokens";

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
    if (isCreating || !onCreatePr) return;
    setLocalError(null);
    const result = await onCreatePr();
    if (result.error && result.error !== "not_authenticated") {
      setLocalError(result.error);
    }
  }, [isCreating, onCreatePr]);

  const displayError = errorMessage ?? localError;

  if (!eligible && !prUrl && !isCreating && !displayError) return null;

  // Header title: section name + status badge
  const titleNode = (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span
        className={`truncate uppercase text-text-2 ${TYPOGRAPHY.sectionTitle}`}
      >
        {t("git.pr.title")}
      </span>
      {prUrl && prStatus && (
        <span
          className={`ml-1 rounded px-1.5 py-0.5 ${TYPOGRAPHY.badge} ${PR_STATUS_COLORS[prStatus] ?? "bg-fill-2 text-text-3"}`}
        >
          {t(`git.pr.status.${prStatus}`, { defaultValue: prStatus })}
        </span>
      )}
    </div>
  );

  return (
    <CollapsibleSection
      title={titleNode}
      collapsed={collapsed}
      onCollapseChange={setCollapsed}
      autoHeight
      resizable={false}
      isLast
      hideSeparator
    >
      <div className="pb-2 pt-0.5">
        {/* PR link */}
        {prUrl && (
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            className={`group/pr-link flex items-center gap-2 px-3 py-1 ${PRIMARY_SIDEBAR_HOVER.row}`}
          >
            <ExternalLink
              size={12}
              className="shrink-0 text-text-3 transition-colors group-hover/pr-link:text-primary-6"
            />
            <span
              className={`min-w-0 flex-1 truncate ${TYPOGRAPHY.secondary} font-medium text-text-2 transition-colors group-hover/pr-link:text-primary-6`}
            >
              {prUrl.replace(/^https?:\/\/[^/]+\//, "")}
            </span>
          </a>
        )}

        {/* Branch */}
        {branchName && (
          <div className="px-3 py-0.5">
            <code className={`${TYPOGRAPHY.secondary} text-text-3`}>
              {branchName}
            </code>
          </div>
        )}

        {/* Error */}
        {displayError && (
          <div className="mx-3 mt-1 flex items-start gap-1.5 rounded-md bg-fill-2 px-2 py-1.5">
            <TriangleAlert
              size={12}
              className="mt-0.5 shrink-0 text-warning-6"
            />
            <p className={`min-w-0 flex-1 ${TYPOGRAPHY.secondary} text-text-2`}>
              {displayError}
            </p>
            <button
              className={`${SECTION_ACTION_BUTTON.base} ${SECTION_ACTION_BUTTON.withLabel} shrink-0`}
              onClick={handleCreate}
            >
              {t("actions.retry")}
            </button>
          </div>
        )}

        {/* Hint text */}
        {!prUrl && !isCreating && !displayError && (
          <p className={`px-3 py-0.5 ${TYPOGRAPHY.secondary} text-text-3`}>
            {readyToCreate
              ? autoCreatePr
                ? t("git.pr.autoCreating")
                : t("git.pr.readyHint")
              : t("git.pr.neutralHint")}
          </p>
        )}
      </div>
    </CollapsibleSection>
  );
};

export default WorkstationPrSection;
