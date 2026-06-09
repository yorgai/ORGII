/**
 * PullRequestContent
 *
 * Sidebar-only PR list. Always shows the full list of open PRs — no
 * inline detail panel. Clicking a row fires `onHistorySelectionChange`
 * with `type: "pr"`, which moves PR context into the top header bar.
 *
 * Stats (additions/deletions/file count) and timestamps are tucked into a
 * hover tooltip on an info icon so the row stays compact.
 */
import { useAtomValue } from "jotai";
import { Info, Loader2, TriangleAlert } from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { OpenPRItem } from "@src/api/tauri/github";
import Tooltip from "@src/components/Tooltip";
import { SPINNER_TOKENS } from "@src/config/spinnerTokens";
import { SURFACE_TOKENS } from "@src/config/surfaceTokens";
import {
  PRIMARY_SIDEBAR_HOVER,
  TYPOGRAPHY,
} from "@src/modules/WorkStation/shared/tokens";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { getPrStatusLabelKey } from "@src/shared/pr/prStatus";
import {
  workstationAllOpenPrsAtom,
  workstationPrAtom,
  workstationPrCallbackAtom,
} from "@src/store/workstation/codeEditor/workstationPrAtom";
import type { SourceControlHistorySelection } from "@src/store/workstation/tabs";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

import { getPrStatusVariant, truncateBranchLabel } from "./prCardHelpers";

export interface PullRequestContentProps {
  branchName?: string;
  onHistorySelectionChange?: (selection: SourceControlHistorySelection) => void;
  filterQuery?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePrUrl(
  prUrl: string | undefined
): { repoFullName: string; number: number } | null {
  if (!prUrl) return null;
  const m = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { repoFullName: m[1], number: Number(m[2]) };
}

// ── PR list row ────────────────────────────────────────────────────────────────

interface PrListRowProps {
  pr: OpenPRItem;
  isCurrentBranch: boolean;
  isSelected: boolean;
  onClick: (pr: OpenPRItem) => void;
}

const PrListRow: React.FC<PrListRowProps> = ({
  pr,
  isCurrentBranch,
  isSelected,
  onClick,
}) => {
  const { t } = useTranslation("common");
  const statusKey = pr.draft ? "draft" : pr.state;
  const statusVariant = getPrStatusVariant(statusKey);

  const tooltipContent = (
    <div className="flex flex-col gap-1 py-0.5">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-text-3">{t("labels.status", "Status")}</span>
        <span className="capitalize text-text-2">
          {t(getPrStatusLabelKey(statusKey), statusKey)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-text-3">{t("labels.number", "Number")}</span>
        <span className="tabular-nums text-text-2">#{pr.number}</span>
      </div>
      {pr.head_branch && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-text-3">{t("labels.branch", "Branch")}</span>
          <span className="font-mono text-text-2">
            {truncateBranchLabel(pr.head_branch, 40)}
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-text-3">{t("labels.updated", "Updated")}</span>
        <span className="text-text-2">
          {pr.updated_at ? formatRelativeTime(pr.updated_at, "nano") : "—"}
        </span>
      </div>
    </div>
  );

  return (
    <button
      type="button"
      onClick={() => onClick(pr)}
      className={`group flex w-full items-center gap-1.5 px-3 py-1.5 text-left transition-colors ${
        isSelected ? SURFACE_TOKENS.selected : PRIMARY_SIDEBAR_HOVER.row
      } ${isCurrentBranch ? "border-l-2 border-primary-5 pl-[10px]" : ""}`}
    >
      {/* Status dot */}
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusVariant.dotClass}`}
        aria-hidden
      />

      {/* PR title */}
      <span
        className="min-w-0 flex-1 truncate text-[12px] leading-snug text-text-1"
        title={pr.title}
      >
        {pr.title}
      </span>

      {/* Info icon — stopPropagation on the wrapper div so the button's onClick doesn't fire */}
      <div
        className="ml-auto shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <Tooltip
          content={tooltipContent}
          position="bottom-end"
          smartPlacement
          panelStyle
          mouseEnterDelay={200}
        >
          <span className="flex cursor-default items-center">
            <Info size={12} className="text-text-3" />
          </span>
        </Tooltip>
      </div>
    </button>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────

const PullRequestContent: React.FC<PullRequestContentProps> = ({
  branchName,
  onHistorySelectionChange,
  filterQuery = "",
}) => {
  const { t } = useTranslation("common");
  const {
    prUrl,
    readyToCreate,
    isCreating: prCreating,
  } = useAtomValue(workstationPrAtom);
  const { createPr: onCreatePr } = useAtomValue(workstationPrCallbackAtom);
  const allOpenPrs = useAtomValue(workstationAllOpenPrsAtom);

  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);
  const [localCreateError, setLocalCreateError] = useState<string | null>(null);

  const currentBranchPrFromList = useMemo(
    () =>
      branchName
        ? (allOpenPrs.find((p) => p.head_branch === branchName) ?? null)
        : null,
    [allOpenPrs, branchName]
  );

  const parsedAtomPr = useMemo(() => parsePrUrl(prUrl), [prUrl]);

  const orderedPrs = useMemo(() => {
    const sorted = currentBranchPrFromList
      ? [
          currentBranchPrFromList,
          ...allOpenPrs.filter(
            (p) => p.number !== currentBranchPrFromList.number
          ),
        ]
      : allOpenPrs;
    if (!filterQuery.trim()) return sorted;
    const q = filterQuery.trim().toLowerCase();
    return sorted.filter((p) => p.title.toLowerCase().includes(q));
  }, [allOpenPrs, currentBranchPrFromList, filterQuery]);

  const handlePrClick = useCallback(
    (pr: OpenPRItem) => {
      setSelectedPrNumber(pr.number);
      const statusKey = pr.draft ? "draft" : pr.state;
      onHistorySelectionChange?.({
        type: "pr",
        prNumber: pr.number,
        prTitle: pr.title,
        prUrl: pr.url,
        prStatus: statusKey,
        headBranch: pr.head_branch,
      });
    },
    [onHistorySelectionChange]
  );

  const handleCreate = useCallback(async () => {
    if (!onCreatePr || prCreating) return;
    setLocalCreateError(null);
    try {
      const result = await onCreatePr();
      if (result.error && result.error !== "not_authenticated") {
        setLocalCreateError(result.error);
      }
    } catch (err) {
      setLocalCreateError(err instanceof Error ? err.message : String(err));
    }
  }, [onCreatePr, prCreating]);

  // ── Create PR state ────────────────────────────────────────────────────
  const hasCurrentBranchPr = !!currentBranchPrFromList || !!parsedAtomPr;

  if (!hasCurrentBranchPr && readyToCreate) {
    return (
      <div className="flex h-full flex-col gap-3 p-3">
        <div>
          <p className={`${TYPOGRAPHY.secondary} text-text-2`}>
            {t(
              "labels.noPullRequestForBranch",
              "There is no pull request for this branch yet."
            )}
          </p>
          {branchName && (
            <code
              className={`mt-1 block truncate ${TYPOGRAPHY.secondary} text-text-3`}
            >
              {branchName}
            </code>
          )}
        </div>
        {prCreating ? (
          <div
            className={`flex items-center gap-2 ${TYPOGRAPHY.secondary} text-text-3`}
          >
            <Loader2
              size={SPINNER_TOKENS.default}
              className="animate-spin text-text-3"
            />
            <span>{t("labels.creatingPullRequest", "Creating…")}</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleCreate}
            disabled={!onCreatePr}
            className="flex h-7 items-center justify-center rounded-md bg-primary-6 px-2.5 text-[12px] font-medium text-white transition-colors hover:bg-primary-7 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("actions.createPullRequest", "Create pull request")}
          </button>
        )}
        {localCreateError && (
          <div className="flex items-start gap-1.5 rounded-md bg-fill-2 px-2 py-1.5">
            <TriangleAlert
              size={12}
              className="mt-0.5 shrink-0 text-warning-6"
            />
            <p className={`min-w-0 flex-1 ${TYPOGRAPHY.secondary} text-text-2`}>
              {localCreateError}
            </p>
          </div>
        )}

        {/* Still show other repo PRs below the create section if they exist */}
        {orderedPrs.length > 0 && (
          <div className="mt-1 flex flex-col border-t border-fill-2 pt-2">
            <p className={`mb-1 px-0 ${TYPOGRAPHY.secondary} text-text-3`}>
              {t("labels.otherOpenPullRequests", "Other open pull requests")}
            </p>
            {orderedPrs.map((pr) => (
              <PrListRow
                key={pr.number}
                pr={pr}
                isCurrentBranch={pr.head_branch === branchName}
                isSelected={pr.number === selectedPrNumber}
                onClick={handlePrClick}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Full PR list view ──────────────────────────────────────────────────
  if (orderedPrs.length === 0) {
    return (
      <Placeholder
        variant="empty"
        placement="sidebar"
        title={t("labels.noPullRequest", "No pull request")}
        fillParentHeight
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto scrollbar-hide">
      {orderedPrs.map((pr) => (
        <PrListRow
          key={pr.number}
          pr={pr}
          isCurrentBranch={pr.head_branch === branchName}
          isSelected={pr.number === selectedPrNumber}
          onClick={handlePrClick}
        />
      ))}
    </div>
  );
};

PullRequestContent.displayName = "PullRequestContent";

export default memo(PullRequestContent);
