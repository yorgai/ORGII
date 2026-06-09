import { ExternalLink, GitBranch } from "lucide-react";
import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { GitCommitInfo } from "@src/api/http/git/types";
import type { ExtractedGitArtifactData } from "@src/engines/SessionCore/core/types";
import GitCommitRow from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/GitHistoryContent/GitCommitRow";
import { truncateBranchLabel } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/PullRequestContent/prCardHelpers";
import {
  HEADER_BUTTON,
  TYPOGRAPHY,
} from "@src/modules/WorkStation/shared/tokens";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { getPrStatusLabelKey } from "@src/shared/pr/prStatus";

export type SubmissionArtifact = ExtractedGitArtifactData & {
  repoId?: string;
  repoPath?: string;
};

export type SubmissionCommit = Pick<
  GitCommitInfo,
  "sha" | "short_sha" | "summary"
> & {
  author?: GitCommitInfo["author"] | null;
  repoId?: string;
  repoPath?: string;
};

export interface PullRequestSubmission {
  key: string;
  url?: string;
  repoFullName?: string;
  prNumber?: number;
  prTitle?: string;
  sourceBranch?: string;
  targetBranch?: string;
}

export interface SubmissionsData {
  commits: SubmissionCommit[];
  pullRequests: PullRequestSubmission[];
}

interface SubmissionCommitsContentProps {
  commits: SubmissionCommit[];
  selectedCommitSha: string | null;
  onCommitSelect: (commit: SubmissionCommit) => void;
  emptyLabel: string;
}

interface SubmissionPullRequestsContentProps {
  pullRequests: PullRequestSubmission[];
  emptyLabel: string;
}

function extractCommitSha(artifact: SubmissionArtifact): string {
  if (artifact.sha) return artifact.sha.trim();
  const match = artifact.url?.match(
    /github\.com\/[^/]+\/[^/]+\/commit\/([a-f0-9]{7,40})/i
  );
  return match?.[1] ?? "";
}

function commitFromArtifact(
  artifact: SubmissionArtifact
): SubmissionCommit | null {
  const sha = extractCommitSha(artifact);
  const shortSha = artifact.shortSha ?? sha.slice(0, 7);
  if (!sha && !shortSha) return null;
  return {
    sha: sha || shortSha,
    short_sha: shortSha || sha.slice(0, 7),
    summary: artifact.subject ?? shortSha ?? sha,
    author: null,
    repoId: artifact.repoId,
    repoPath: artifact.repoPath,
  };
}

function getSubmissionDedupeKey(artifact: SubmissionArtifact): string | null {
  if (artifact.url) return `${artifact.kind}:url:${artifact.url}`;
  if (artifact.kind === "commit" && artifact.sha)
    return `commit:sha:${artifact.sha}`;
  if (
    artifact.kind === "pullRequest" &&
    artifact.repoFullName &&
    artifact.prNumber
  ) {
    return `pullRequest:${artifact.repoFullName}#${artifact.prNumber}`;
  }
  return null;
}

export function deriveSubmissionsData(
  artifacts: readonly SubmissionArtifact[]
): SubmissionsData {
  const seenKeys = new Set<string>();
  const commits: SubmissionCommit[] = [];
  const pullRequests: PullRequestSubmission[] = [];

  for (const artifact of artifacts) {
    const key = getSubmissionDedupeKey(artifact);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);

    if (artifact.kind === "commit") {
      const commit = commitFromArtifact(artifact);
      if (commit) commits.push(commit);
      continue;
    }

    pullRequests.push({
      key,
      url: artifact.url,
      repoFullName: artifact.repoFullName,
      prNumber: artifact.prNumber,
      prTitle: artifact.prTitle,
      sourceBranch: artifact.sourceBranch,
      targetBranch: artifact.targetBranch,
    });
  }

  return { commits, pullRequests };
}

const PullRequestSubmissionRow: React.FC<{
  pullRequest: PullRequestSubmission;
}> = memo(({ pullRequest }) => {
  const { t } = useTranslation("common");
  const title = pullRequest.prTitle || t("labels.pullRequest", "Pull request");
  const numberLabel = pullRequest.prNumber ? `#${pullRequest.prNumber}` : null;
  const branchLabel = pullRequest.sourceBranch
    ? pullRequest.targetBranch
      ? `${pullRequest.sourceBranch} → ${pullRequest.targetBranch}`
      : pullRequest.sourceBranch
    : null;
  const statusKey = "open";

  return (
    <div className="border-b border-fill-2 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-success-7 inline-flex shrink-0 items-center gap-1 rounded-full bg-success-2 px-2 py-0.5 text-[11px] font-medium capitalize">
          <span className="h-1.5 w-1.5 rounded-full bg-success-6" aria-hidden />
          {t(getPrStatusLabelKey(statusKey), statusKey)}
        </span>
        {numberLabel && (
          <span
            className={`${TYPOGRAPHY.secondary} font-medium tabular-nums text-text-3`}
          >
            {numberLabel}
          </span>
        )}
        {pullRequest.url && (
          <a
            href={pullRequest.url}
            target="_blank"
            rel="noreferrer"
            className={`${HEADER_BUTTON.action} ml-auto`}
            aria-label={t("actions.openOnGitHub", "Open on GitHub")}
            title={t("actions.openOnGitHub", "Open on GitHub")}
          >
            <ExternalLink size={14} />
          </a>
        )}
      </div>
      <div
        className="mt-1 line-clamp-2 text-[12px] font-medium leading-snug text-text-1"
        title={title}
      >
        {title}
      </div>
      {(branchLabel || pullRequest.repoFullName) && (
        <div className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-text-3">
          <GitBranch size={12} className="shrink-0" />
          <span className="truncate">
            {branchLabel
              ? truncateBranchLabel(branchLabel)
              : pullRequest.repoFullName}
          </span>
        </div>
      )}
    </div>
  );
});

PullRequestSubmissionRow.displayName = "PullRequestSubmissionRow";

export const SubmissionCommitsContent: React.FC<SubmissionCommitsContentProps> =
  memo(({ commits, selectedCommitSha, onCommitSelect, emptyLabel }) => {
    const handleCommitSelect = useCallback(
      (commit: SubmissionCommit) => {
        onCommitSelect(commit);
      },
      [onCommitSelect]
    );

    const commitRows = useMemo(
      () =>
        commits.map((commit) => (
          <GitCommitRow
            key={commit.sha}
            commit={commit}
            isSelected={commit.sha === selectedCommitSha}
            onSelect={handleCommitSelect}
            showGraphPlaceholder
          />
        )),
      [commits, handleCommitSelect, selectedCommitSha]
    );

    if (commits.length === 0) {
      return (
        <Placeholder
          variant="empty"
          placement="sidebar"
          title={emptyLabel}
          fillParentHeight
        />
      );
    }

    return <div className="overflow-auto scrollbar-hide">{commitRows}</div>;
  });

SubmissionCommitsContent.displayName = "SubmissionCommitsContent";

export const SubmissionPullRequestsContent: React.FC<SubmissionPullRequestsContentProps> =
  memo(({ pullRequests, emptyLabel }) => {
    if (pullRequests.length === 0) {
      return (
        <Placeholder
          variant="empty"
          placement="sidebar"
          title={emptyLabel}
          fillParentHeight
        />
      );
    }

    return (
      <div className="overflow-auto scrollbar-hide">
        {pullRequests.map((pullRequest) => (
          <PullRequestSubmissionRow
            key={pullRequest.key}
            pullRequest={pullRequest}
          />
        ))}
      </div>
    );
  });

SubmissionPullRequestsContent.displayName = "SubmissionPullRequestsContent";
