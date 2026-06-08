/**
 * PullRequestContent
 *
 * Sidebar view shown when the user toggles the workstation Pull-request
 * icon next to Git History. Lists the PR's commits (same row style as
 * GitHistoryContent) so the existing GitCommitDetailContent renders the
 * file changes when a commit is selected.
 *
 * If no PR exists yet for the current branch but the repo is PR-eligible,
 * shows a "Create pull request" button instead.
 */
import { useAtomValue } from "jotai";
import { ExternalLink, Loader2, TriangleAlert } from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  GitHubReAuthError,
  getPRLocal,
  listPRCommitsLocal,
} from "@src/api/tauri/github";
import { SPINNER_TOKENS } from "@src/config/spinnerTokens";
import { SURFACE_TOKENS } from "@src/config/surfaceTokens";
import {
  PRIMARY_SIDEBAR_HOVER,
  TYPOGRAPHY,
} from "@src/modules/WorkStation/shared/tokens";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import {
  workstationPrAtom,
  workstationPrCallbackAtom,
} from "@src/store/workstation/codeEditor/workstationPrAtom";
import type { SourceControlHistorySelection } from "@src/store/workstation/tabs";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

const PR_STATUS_COLORS: Record<string, string> = {
  open: "bg-success-1 text-success-6",
  merged: "bg-primary-1 text-primary-6",
  closed: "bg-fill-3 text-text-3",
  draft: "bg-warning-1 text-warning-6",
};

const ROW_HEIGHT = 36;

interface PrCommit {
  sha: string;
  shortSha: string;
  summary: string;
  authorName: string;
  authorDate: string;
}

interface PrDetail {
  title: string;
  body: string;
  state: string;
  merged: boolean;
  number: number;
  htmlUrl: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

/** Parse `https://github.com/owner/repo/pull/123` → {full: "owner/repo", number: 123}. */
function parsePrUrl(
  prUrl: string | undefined
): { repoFullName: string; number: number } | null {
  if (!prUrl) return null;
  const m = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { repoFullName: m[1], number: Number(m[2]) };
}

function normalizeStatus(detail: PrDetail | null): string {
  if (!detail) return "open";
  if (detail.merged) return "merged";
  return detail.state || "open";
}

export interface PullRequestContentProps {
  branchName?: string;
  onHistorySelectionChange?: (selection: SourceControlHistorySelection) => void;
}

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
  const prEligible = readyToCreate;

  const [detail, setDetail] = useState<PrDetail | null>(null);
  const [commits, setCommits] = useState<PrCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [localCreateError, setLocalCreateError] = useState<string | null>(null);

  const parsedPr = useMemo(() => parsePrUrl(prUrl), [prUrl]);

  useEffect(() => {
    if (!parsedPr) {
      setDetail(null);
      setCommits([]);
      setError(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [prJson, commitJson] = await Promise.all([
          getPRLocal(parsedPr.repoFullName, parsedPr.number),
          listPRCommitsLocal(parsedPr.repoFullName, parsedPr.number),
        ]);
        if (cancelled) return;

        setDetail({
          title: String(prJson["title"] ?? ""),
          body: String(prJson["body"] ?? ""),
          state: String(prJson["state"] ?? "open"),
          merged: Boolean(prJson["merged"]),
          number: Number(prJson["number"] ?? parsedPr.number),
          htmlUrl: String(prJson["html_url"] ?? prUrl ?? ""),
          additions: Number(prJson["additions"] ?? 0),
          deletions: Number(prJson["deletions"] ?? 0),
          changedFiles: Number(prJson["changed_files"] ?? 0),
        });

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
          setError(
            t(
              "labels.githubAuthMissing",
              "Connect a GitHub account to view this pull request."
            )
          );
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
  }, [parsedPr, prUrl, t]);

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

  const handleCreate = useCallback(async () => {
    if (!onCreatePr || prCreating) return;
    setLocalCreateError(null);
    const result = await onCreatePr();
    if (result.error && result.error !== "not_authenticated") {
      setLocalCreateError(result.error);
    }
  }, [onCreatePr, prCreating]);

  // ── Empty / create-PR state ─────────────────────────────────────────
  if (!parsedPr) {
    const displayError = localCreateError;
    if (!prEligible && !displayError) {
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
        {displayError && (
          <div className="flex items-start gap-1.5 rounded-md bg-fill-2 px-2 py-1.5">
            <TriangleAlert
              size={12}
              className="mt-0.5 shrink-0 text-warning-6"
            />
            <p className={`min-w-0 flex-1 ${TYPOGRAPHY.secondary} text-text-2`}>
              {displayError}
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Header (always shown when a PR exists) ──────────────────────────
  const statusKey = normalizeStatus(detail);
  const statusClass = PR_STATUS_COLORS[statusKey] ?? "bg-fill-2 text-text-3";

  const header = (
    <div className="flex flex-col gap-1.5 px-3 pb-2 pt-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 ${TYPOGRAPHY.badge} ${statusClass}`}
        >
          {t(`labels.prStatus.${statusKey}`, statusKey)}
        </span>
        <span className={`${TYPOGRAPHY.secondary} text-text-3`}>
          #{detail?.number ?? parsedPr.number}
        </span>
        <a
          href={detail?.htmlUrl ?? prUrl ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center text-text-3 transition-colors hover:text-primary-6"
          title={t("actions.openInBrowser", "Open in browser")}
        >
          <ExternalLink size={12} />
        </a>
      </div>
      <div className="min-w-0 text-[13px] font-medium leading-tight text-text-1">
        {detail?.title || t("labels.pullRequest", "Pull request")}
      </div>
      {branchName && (
        <code
          className={`truncate ${TYPOGRAPHY.secondary} text-text-3`}
          title={branchName}
        >
          {branchName}
        </code>
      )}
      {detail && (
        <div className={`flex gap-2 ${TYPOGRAPHY.secondary} text-text-3`}>
          <span className="text-success-6">+{detail.additions}</span>
          <span className="text-danger-6">−{detail.deletions}</span>
          <span>
            {t("labels.filesChanged", "{{count}} files", {
              count: detail.changedFiles,
            })}
          </span>
        </div>
      )}
    </div>
  );

  // ── Body ────────────────────────────────────────────────────────────
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

PullRequestContent.displayName = "PullRequestContent";

export default memo(PullRequestContent);
