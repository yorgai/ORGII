/**
 * PullRequestContent
 *
 * Sidebar PR list using TreeRowBase rows grouped under a collapsible
 * "OPEN" section header (same pattern as IssuesContent).
 * Clicking a row fires `onHistorySelectionChange` with `type: "pr"`.
 */
import { useAtomValue } from "jotai";
import {
  ChevronDown,
  ChevronRight,
  GitPullRequest,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { OpenPRItem } from "@src/api/tauri/github";
import Tooltip from "@src/components/Tooltip";
import { TreeRowBase, type TreeRowNode } from "@src/components/TreeRow";
import { SPINNER_TOKENS } from "@src/config/spinnerTokens";
import { TYPOGRAPHY } from "@src/modules/WorkStation/shared/tokens";
import {
  COUNT_BADGE,
  getCountBadgeSizeClass,
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

// ── PR tree row ───────────────────────────────────────────────────────────────

interface PrRowProps {
  pr: OpenPRItem;
  depth?: number;
  isCurrentBranch: boolean;
  isSelected: boolean;
  onClick: (pr: OpenPRItem) => void;
}

const PrRow: React.FC<PrRowProps> = memo(
  ({ pr, depth = 1, isCurrentBranch, isSelected, onClick }) => {
    const { t } = useTranslation("common");
    const statusKey = pr.draft ? "draft" : pr.state;
    const statusVariant = getPrStatusVariant(statusKey);

    const handleDragStart = useCallback(
      (event: React.DragEvent<HTMLElement>) => {
        const prPayload = {
          prNumber: pr.number,
          prTitle: pr.title,
          prUrl: pr.url,
          prStatus: statusKey,
          sourceBranch: pr.head_branch,
          targetBranch: pr.base_branch,
        };
        event.dataTransfer.setData(
          "application/x-orgii-pr-reference",
          JSON.stringify(prPayload)
        );
        window.__orgiiLastPrDrag = { ...prPayload, timestamp: Date.now() };
        event.dataTransfer.effectAllowed = "copy";
      },
      [pr, statusKey]
    );

    const node: TreeRowNode = useMemo(
      () => ({
        id: String(pr.number),
        name: pr.title,
        path: pr.url,
        type: "file",
        icon: (
          <span className={statusVariant.dotClass.replace("bg-", "text-")}>
            <GitPullRequest size={14} strokeWidth={1.75} />
          </span>
        ),
      }),
      [pr.number, pr.title, pr.url, statusVariant.dotClass]
    );

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
      <Tooltip
        content={tooltipContent}
        position="bottom-end"
        smartPlacement
        panelStyle
        mouseEnterDelay={200}
      >
        <TreeRowBase
          node={node}
          depth={depth}
          isSelected={isSelected}
          onClick={() => onClick(pr)}
          showIndentGuides={false}
          draggable
          onDragStart={handleDragStart}
          className={
            isCurrentBranch
              ? "border-l-2 border-primary-5 !pl-[calc(theme(spacing.3)+2px+theme(spacing.4))]"
              : undefined
          }
        >
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <span className="min-w-[28px] text-right text-[11px] tabular-nums text-text-3">
              #{pr.number}
            </span>
          </span>
        </TreeRowBase>
      </Tooltip>
    );
  }
);
PrRow.displayName = "PrRow";

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
  const [openCollapsed, setOpenCollapsed] = useState(false);

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

  const openSectionNode: TreeRowNode = {
    id: "open-prs",
    name: "Open",
    path: "open-prs",
    type: "directory",
    expanded: !openCollapsed,
    icon: (
      <div className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
        {openCollapsed ? (
          <ChevronRight size={14} className="text-text-3" />
        ) : (
          <ChevronDown size={14} className="text-text-3" />
        )}
      </div>
    ),
  };

  const hasCurrentBranchPr = !!currentBranchPrFromList || !!parsedAtomPr;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Create PR section */}
      {!hasCurrentBranchPr && readyToCreate && (
        <div className="flex flex-col gap-3 border-b border-border-2 p-3">
          <div>
            <p className={`${TYPOGRAPHY.secondary} text-text-2`}>
              {t(
                "labels.noPullRequestForBranch",
                "There is no pull request for this branch yet"
              )}
            </p>
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
              <p
                className={`min-w-0 flex-1 ${TYPOGRAPHY.secondary} text-text-2`}
              >
                {localCreateError}
              </p>
            </div>
          )}
        </div>
      )}

      {/* PR tree list */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {/* Open section header */}
        <TreeRowBase
          node={openSectionNode}
          depth={0}
          onClick={() => setOpenCollapsed((prev) => !prev)}
          showIndentGuides={false}
          className="[&_.min-w-0]:text-[11px] [&_.min-w-0]:font-medium [&_.min-w-0]:uppercase [&_.min-w-0]:text-text-2"
        >
          <span
            className={`${COUNT_BADGE.base} ${getCountBadgeSizeClass(orderedPrs.length)} ${COUNT_BADGE.primary}`}
          >
            {orderedPrs.length}
          </span>
        </TreeRowBase>

        {!openCollapsed &&
          (orderedPrs.length === 0 ? (
            <Placeholder
              variant="empty"
              placement="sidebar"
              title={t("labels.noPullRequest", "No pull request")}
            />
          ) : (
            orderedPrs.map((pr) => (
              <PrRow
                key={pr.number}
                pr={pr}
                depth={1}
                isCurrentBranch={pr.head_branch === branchName}
                isSelected={pr.number === selectedPrNumber}
                onClick={handlePrClick}
              />
            ))
          ))}
      </div>
    </div>
  );
};

PullRequestContent.displayName = "PullRequestContent";

export default memo(PullRequestContent);
