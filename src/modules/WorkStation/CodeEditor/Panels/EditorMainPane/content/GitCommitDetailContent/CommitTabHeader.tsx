import React, { memo, useMemo } from "react";

import type { CommitDiffResult } from "@src/api/http/git/types";
import DiffStatsBadge from "@src/components/DiffStatsBadge";
import { FileHeader } from "@src/modules/WorkStation/shared";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

interface CommitTabHeaderProps {
  shortSha: string;
  commitMessage: string;
  commitDiff: CommitDiffResult | null;
  publishToWorkstationHeader: boolean;
}

/**
 * Renders the commit breadcrumb (shortSha › message [author + stats]) either
 * inline as a 40px file bar or in the global Workstation tab-header strip.
 */
export const CommitTabHeader: React.FC<CommitTabHeaderProps> = memo(
  function CommitTabHeader({
    shortSha,
    commitMessage,
    commitDiff,
    publishToWorkstationHeader,
  }) {
    const extraActions = useMemo(
      () =>
        commitDiff?.author || commitDiff?.stats ? (
          <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">
            {commitDiff?.author && (
              <span className="flex-shrink-0 text-[12px] text-text-2">
                {commitDiff.author.name}
              </span>
            )}
            {commitDiff?.author?.date && (
              <span className="flex-shrink-0 text-[12px] text-text-3">
                {formatRelativeTime(commitDiff.author.date, "nano")}
              </span>
            )}
            {commitDiff?.stats && (
              <DiffStatsBadge
                additions={commitDiff.stats.insertions}
                deletions={commitDiff.stats.deletions}
              />
            )}
          </div>
        ) : null,
      [commitDiff]
    );

    return (
      <FileHeader
        filePath={`${shortSha}/${commitMessage}`}
        useFileTypeIcon={false}
        disableNavigation
        plainTitle={false}
        extraActions={extraActions}
        publishToHost={publishToWorkstationHeader ? "code" : undefined}
      />
    );
  }
);
