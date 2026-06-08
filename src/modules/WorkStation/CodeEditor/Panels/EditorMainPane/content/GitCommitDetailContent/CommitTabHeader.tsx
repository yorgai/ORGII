import { ChevronRight } from "lucide-react";
import React, { useMemo } from "react";

import type { CommitDiffResult } from "@src/api/http/git/types";
import { usePublishWorkstationTabHeader } from "@src/hooks/workStation";
import { DIFF_STATS } from "@src/modules/WorkStation/shared/tokens";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

interface CommitTabHeaderProps {
  shortSha: string;
  commitMessage: string;
  commitDiff: CommitDiffResult | null;
  enabled: boolean;
}

/**
 * Publishes the commit breadcrumb (shortSha › message [author + stats]) into
 * the global Workstation tab-header strip. Renders nothing visible — output is
 * injected via `usePublishWorkstationTabHeader`.
 */
export const CommitTabHeader: React.FC<CommitTabHeaderProps> = ({
  shortSha,
  commitMessage,
  commitDiff,
  enabled,
}) => {
  const content = useMemo(
    () => (
      <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-3">
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-[1px] overflow-x-auto scrollbar-hide">
          <span className="inline-flex flex-shrink-0 whitespace-nowrap text-[12px] text-text-2">
            {shortSha}
          </span>
          <ChevronRight
            size={14}
            strokeWidth={1.75}
            className="flex-shrink-0 text-fill-4"
          />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-1">
            {commitMessage}
          </span>
        </div>
        {(commitDiff?.author || commitDiff?.stats) && (
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
              <span className={DIFF_STATS.container}>
                <span className={DIFF_STATS.additions}>
                  +{commitDiff.stats.insertions}
                </span>
                <span className={DIFF_STATS.deletions}>
                  -{commitDiff.stats.deletions}
                </span>
              </span>
            )}
          </div>
        )}
      </div>
    ),
    [shortSha, commitMessage, commitDiff]
  );

  usePublishWorkstationTabHeader({ host: "code", content, enabled });

  return null;
};
