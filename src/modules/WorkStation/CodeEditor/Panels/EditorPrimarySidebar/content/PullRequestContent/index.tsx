/**
 * PullRequestContent
 *
 * Shows ALL open pull requests for the repo (GitHub-style list), not just
 * the one for the currently checked-out branch.
 *
 * - The current-branch PR is pinned to the top with a "current branch"
 *   indicator so it is immediately identifiable.
 * - Clicking any PR row expands a detail view (status, title, diff stats,
 *   commit list) inline — the same information the previous single-PR view
 *   showed, now accessible for any PR in the list.
 * - When the repo has no open PRs at all and the current branch is eligible,
 *   the "Create pull request" affordance is still shown.
 */
import { useAtomValue } from "jotai";
import {
  ChevronLeft,
  ExternalLink,
  FileDiff,
  GitBranch,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { OpenPRItem } from "@src/api/tauri/github";
import {
  GitHubReAuthError,
  getPRLocal,
  listPRCommitsLocal,
} from "@src/api/tauri/github";
import { SPINNER_TOKENS } from "@src/config/spinnerTokens";
import { SURFACE_TOKENS } from "@src/config/surfaceTokens";
import {
  HEADER_BUTTON,
  PRIMARY_SIDEBAR_HOVER,
  TYPOGRAPHY,
} from "@src/modules/WorkStation/shared/tokens";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { getPrStatusLabelKey } from "@src/shared/pr/prStatus";
import {
  type NormalizedPullRequest,
  toNormalizedPullRequest,
} from "@src/shared/pr/types";
import {
  workstationAllOpenPrsAtom,
  workstationPrAtom,
  workstationPrCallbackAtom,
} from "@src/store/workstation/codeEditor/workstationPrAtom";
import type { SourceControlHistorySelection } from "@src/store/workstation/tabs";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

import {
  formatStatNumber,
  getPrStatusVariant,
  truncateBranchLabel,
} from "./prCardHelpers";

const ROW_HEIGHT = 36;

interface PrCommit {
  sha: string;
  shortSha: string;
  summary: string;
  authorName: string;
  authorDate: string;
}

function parsePrUrl(
  prUrl: string | undefined
): { repoFullName: string; number: number } | null {
  if (!prUrl) return null;
  const m = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { repoFullName: m[1], number: Number(m[2]) };
}

export interface PullRequestContentProps {
  branchName?: string;
  onHistorySelectionChange?: (selection: SourceControlHistorySelection) => void;
}

// ── PR Detail panel (expanded view for a single selected PR) ──────────────────

interface PrDetailPanelProps {
  pr: OpenPRItem;
  isCurrentBranch: boolean;
  onBack: () => void;
  onHistorySelectionChange?: (selection: SourceControlHistorySelection) => void;
}

const PrDetailPanel: React.FC<PrDetailPanelProps> = ({
  pr,
  isCurrentBranch,
  onBack,
  onHistorySelectionChange,
}) => {
  const { t } = useTranslation("common");
  const parsedPr = useMemo(() => parsePrUrl(pr.url), [pr.url]);

  const [detail, setDetail] = useState<NormalizedPullRequest | null>(null);
  const [commits, setCommits] = useState<PrCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);

  useEffect(() => {
    if (!parsedPr) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const authErrorMsg = t(
      "labels.githubAuthMissing",
      "Connect a GitHub account to view this pull request."
    );

    const load = async () => {
      try {
        const [prJson, commitJson] = await Promise.all([
          getPRLocal(parsedPr.repoFullName, parsedPr.number),
          listPRCommitsLocal(parsedPr.repoFullName, parsedPr.number),
        ]);
        if (cancelled) return;

        setDetail(
          toNormalizedPullRequest(prJson, {
            url: pr.url,
            number: parsedPr.number,
          })
        );

        setCommits(
          commitJson.map((raw): PrCommit => {
            const sha = String(raw["sha"] ?? "");
            const commit = (raw["commit"] ?? {}) as Record<string, unknown>;
            const author = (commit["author"] ?? {}) as Record<string, unknown>;
            const message = String(commit["message"] ?? "");
            return {
              sha,
              shortSha: sha.slice(0, 7),
              summary: message.split("\n")[0] || sha.slice(0, 7),
              authorName: String(author["name"] ?? "Unknown"),
              authorDate: String(author["date"] ?? ""),
            };
          })
        );
      } catch (err) {
        if (cancelled) return;
        if (err instanceof GitHubReAuthError) {
          setError(authErrorMsg);
          setDetail(null);
          setCommits([]);
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedPr, pr.url]);

  const handleCommitSelect = useCallback(
    (commit: PrCommit) => {
      setSelectedSha(commit.sha);
      onHistorySelectionChange?.({
        type: "commit",
        commitSha: commit.sha,
        shortSha: commit.shortSha,
        commitMessage: commit.summary,
      });
    },
    [onHistorySelectionChange]
  );

  const statusKey = detail?.status ?? (pr.draft ? "draft" : "open");
  const statusVariant = getPrStatusVariant(statusKey);
  const prNumber = detail?.number ?? pr.number;
  const prTitle =
    detail?.title || pr.title || t("labels.pullRequest", "Pull request");
  const openLabel = t("actions.openOnGitHub", "Open on GitHub");
  const backLabel = t("actions.back", "Back");

  const header = (
    <div className="flex flex-col gap-2 px-3 pb-3 pt-3">
      {/* Back button row */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          className={`${HEADER_BUTTON.action} -ml-1 flex items-center gap-1`}
          aria-label={backLabel}
          title={backLabel}
        >
          <ChevronLeft size={14} />
          <span className={TYPOGRAPHY.secondary}>
            {t("actions.allPullRequests", "All pull requests")}
          </span>
        </button>
        {isCurrentBranch && (
          <span
            className={`ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 ${TYPOGRAPHY.badge} bg-primary-1 text-primary-6`}
          >
            {t("labels.currentBranch", "current")}
          </span>
        )}
      </div>

      {/* Status + PR number + open-on-GitHub affordance */}
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 capitalize ${TYPOGRAPHY.badge} ${statusVariant.badgeClass}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${statusVariant.dotClass}`}
            aria-hidden
          />
          {t(getPrStatusLabelKey(statusKey), statusKey)}
        </span>
        <span
          className={`${TYPOGRAPHY.secondary} font-medium tabular-nums text-text-3`}
        >
          #{prNumber}
        </span>
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className={`${HEADER_BUTTON.action} ml-auto`}
          aria-label={openLabel}
          title={openLabel}
        >
          <ExternalLink size={14} />
        </a>
      </div>

      {/* Title */}
      <div
        className="line-clamp-2 text-[13px] font-semibold leading-snug text-text-1"
        title={prTitle}
      >
        {prTitle}
      </div>

      {/* Head branch chip */}
      {pr.head_branch && (
        <div
          className="inline-flex max-w-full items-center gap-1 self-start rounded-md bg-fill-2 px-1.5 py-0.5 text-text-2"
          title={pr.head_branch}
        >
          <GitBranch size={12} className="shrink-0 text-text-3" />
          <span className={`truncate font-mono ${TYPOGRAPHY.secondary}`}>
            {truncateBranchLabel(pr.head_branch)}
          </span>
        </div>
      )}

      {/* Diff stats */}
      {detail && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-fill-2 px-1.5 py-0.5 font-medium tabular-nums">
            <span className="text-success-6">
              +{formatStatNumber(detail.additions ?? 0)}
            </span>
            <span className="text-danger-6">
              -{formatStatNumber(detail.deletions ?? 0)}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-text-3">
            <FileDiff size={12} className="shrink-0" />
            <span className="tabular-nums">
              {t("labels.fileCount", { count: detail.changedFiles ?? 0 })}
            </span>
          </span>
        </div>
      )}
    </div>
  );

  let body: React.ReactNode;
  if (loading) {
    body = (
      <Placeholder variant="loading" placement="sidebar" fillParentHeight />
    );
  } else if (error) {
    body = (
      <Placeholder
        variant="error"
        placement="sidebar"
        title={t(
          "labels.failedToLoadPullRequest",
          "Failed to load pull request"
        )}
        subtitle={error}
      />
    );
  } else if (commits.length === 0) {
    body = (
      <Placeholder
        variant="empty"
        placement="sidebar"
        title={t(
          "labels.noCommitsInPullRequest",
          "No commits in this pull request"
        )}
        fillParentHeight
      />
    );
  } else {
    body = (
      <div className="flex flex-col overflow-auto scrollbar-hide">
        {commits.map((commit) => {
          const isSelected = commit.sha === selectedSha;
          return (
            <button
              key={commit.sha}
              type="button"
              onClick={() => handleCommitSelect(commit)}
              className={`flex w-full items-center gap-2 px-3 text-left transition-colors ${
                isSelected ? SURFACE_TOKENS.selected : PRIMARY_SIDEBAR_HOVER.row
              }`}
              style={{ height: `${ROW_HEIGHT}px` }}
              title={`${commit.summary}\n\n${commit.shortSha} by ${commit.authorName}`}
            >
              <span className="font-mono text-[11px] text-text-3">
                {commit.shortSha}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] leading-tight text-text-1">
                  {commit.summary}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-3">
                  <span className="truncate">{commit.authorName}</span>
                  {commit.authorDate && (
                    <span className="flex-shrink-0">
                      {formatRelativeTime(commit.authorDate, "nano")}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="min-h-0 flex-1 border-t border-fill-2">{body}</div>
    </div>
  );
};

// ── PR list row ────────────────────────────────────────────────────────────────

interface PrListRowProps {
  pr: OpenPRItem;
  isCurrentBranch: boolean;
  onClick: (pr: OpenPRItem) => void;
}

const PrListRow: React.FC<PrListRowProps> = ({
  pr,
  isCurrentBranch,
  onClick,
}) => {
  const { t } = useTranslation("common");
  const statusKey = pr.draft ? "draft" : pr.state;
  const statusVariant = getPrStatusVariant(statusKey);

  return (
    <button
      type="button"
      onClick={() => onClick(pr)}
      className={`group flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors ${PRIMARY_SIDEBAR_HOVER.row} ${
        isCurrentBranch ? "border-l-2 border-primary-5 pl-[10px]" : ""
      }`}
    >
      {/* Top row: status dot + number + current-branch badge */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 capitalize ${TYPOGRAPHY.badge} ${statusVariant.badgeClass}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${statusVariant.dotClass}`}
            aria-hidden
          />
          {t(getPrStatusLabelKey(statusKey), statusKey)}
        </span>
        <span className={`${TYPOGRAPHY.secondary} tabular-nums text-text-3`}>
          #{pr.number}
        </span>
        {isCurrentBranch && (
          <span
            className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 ${TYPOGRAPHY.badge} bg-primary-1 text-primary-6`}
          >
            {t("labels.currentBranch", "current")}
          </span>
        )}
      </div>

      {/* Title */}
      <div
        className="truncate text-[12px] leading-snug text-text-1"
        title={pr.title}
      >
        {pr.title}
      </div>

      {/* Branch chip + updated time */}
      <div className="flex min-w-0 items-center gap-1.5">
        <div
          className="inline-flex min-w-0 items-center gap-1 text-text-3"
          title={pr.head_branch}
        >
          <GitBranch size={10} className="shrink-0" />
          <span className={`truncate font-mono ${TYPOGRAPHY.secondary}`}>
            {truncateBranchLabel(pr.head_branch, 40)}
          </span>
        </div>
        {pr.updated_at && (
          <span
            className={`ml-auto shrink-0 ${TYPOGRAPHY.secondary} text-text-3`}
          >
            {formatRelativeTime(pr.updated_at, "nano")}
          </span>
        )}
      </div>
    </button>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────

const PullRequestContent: React.FC<PullRequestContentProps> = ({
  branchName,
  onHistorySelectionChange,
}) => {
  const { t } = useTranslation("common");
  const {
    prUrl,
    readyToCreate,
    isCreating: prCreating,
  } = useAtomValue(workstationPrAtom);
  const { createPr: onCreatePr } = useAtomValue(workstationPrCallbackAtom);
  const allOpenPrs = useAtomValue(workstationAllOpenPrsAtom);

  // Track selected PR as { branchKey, prNumber } so that changing branch
  // naturally resets to "no explicit selection" without a setState-in-effect.
  const [selection, setSelection] = useState<{
    branchKey: string;
    prNumber: number | null;
  }>({ branchKey: branchName ?? "", prNumber: null });
  const [localCreateError, setLocalCreateError] = useState<string | null>(null);

  // Find the current-branch PR from the list
  const currentBranchPrFromList = useMemo(
    () =>
      branchName
        ? (allOpenPrs.find((p) => p.head_branch === branchName) ?? null)
        : null,
    [allOpenPrs, branchName]
  );

  // Parse the atom's prUrl to get number — used as fallback when the current
  // branch PR isn't in the "open" list yet (e.g. it was just created)
  const parsedAtomPr = useMemo(() => parsePrUrl(prUrl), [prUrl]);

  // Build the ordered list: current-branch PR first, then the rest
  const orderedPrs = useMemo(() => {
    if (!currentBranchPrFromList) return allOpenPrs;
    return [
      currentBranchPrFromList,
      ...allOpenPrs.filter((p) => p.number !== currentBranchPrFromList.number),
    ];
  }, [allOpenPrs, currentBranchPrFromList]);

  // Resolve the effective selected PR:
  // - If branch changed (branchKey mismatch), reset to current-branch PR
  // - If an explicit selection was made, use it (looked up from the list)
  // - Otherwise, default to the current-branch PR
  const selectedPr = useMemo<OpenPRItem | null>(() => {
    const branchKey = branchName ?? "";
    if (selection.branchKey !== branchKey) {
      return currentBranchPrFromList;
    }
    if (selection.prNumber !== null) {
      return allOpenPrs.find((p) => p.number === selection.prNumber) ?? null;
    }
    return currentBranchPrFromList;
  }, [selection, branchName, allOpenPrs, currentBranchPrFromList]);

  const handlePrClick = useCallback(
    (pr: OpenPRItem) => {
      setSelection({ branchKey: branchName ?? "", prNumber: pr.number });
    },
    [branchName]
  );

  const handleBack = useCallback(() => {
    setSelection({ branchKey: branchName ?? "", prNumber: null });
  }, [branchName]);

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

  // ── Detail view (single PR expanded) ──────────────────────────────────
  if (selectedPr) {
    return (
      <PrDetailPanel
        pr={selectedPr}
        isCurrentBranch={selectedPr.head_branch === branchName}
        onBack={handleBack}
        onHistorySelectionChange={onHistorySelectionChange}
      />
    );
  }

  // ── Create PR state (branch eligible but no PR in the list yet) ────────
  // Only show "create" when: there's no PR in the all-open list for this
  // branch AND the branch is create-eligible (not default, has upstream, etc.)
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
          onClick={handlePrClick}
        />
      ))}
    </div>
  );
};

PullRequestContent.displayName = "PullRequestContent";

export default memo(PullRequestContent);
