import { ExternalLink, GitMerge, GitPullRequest, XCircle } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import { formatStatNumber } from "@src/shared/pr/formatStatNumber";
import {
  type PrStatusIconName,
  getPrStatusIconName,
  getPrStatusLabelKey,
  getPrStatusVariant,
} from "@src/shared/pr/prStatus";

export interface SessionLinkCardData {
  prUrl: string;
  prStatus: "draft" | "open" | "merged" | "closed";
  repoFullName: string;
  prNumber: number;
  prTitle: string;
  sourceBranch?: string;
  targetBranch?: string;
  filesChanged?: number;
  additions?: number;
  deletions?: number;
}

/** Map the shared semantic icon name onto a lucide glyph. */
function StatusIcon({ name }: { name: PrStatusIconName }): React.ReactElement {
  switch (name) {
    case "merge":
      return <GitMerge size={10} />;
    case "closed":
      return <XCircle size={10} />;
    case "pull-request":
    default:
      return <GitPullRequest size={10} />;
  }
}

interface SessionLinkCardProps {
  card: SessionLinkCardData;
}

const SessionLinkCard: React.FC<SessionLinkCardProps> = ({ card }) => {
  const { t } = useTranslation("common");
  const badgeClassName = getPrStatusVariant(card.prStatus).badgeClass;
  const badgeLabel = t(
    getPrStatusLabelKey(card.prStatus),
    card.prStatus.charAt(0).toUpperCase() + card.prStatus.slice(1)
  );
  const badgeIconName = getPrStatusIconName(card.prStatus);

  return (
    <a
      href={card.prUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="mx-3 my-2 block cursor-pointer rounded-lg border border-fill-4 bg-fill-2 px-3 py-2.5 transition-colors hover:bg-fill-3"
      aria-label={`PR #${card.prNumber}: ${card.prTitle}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeClassName}`}
            >
              <StatusIcon name={badgeIconName} />
              {badgeLabel}
            </span>
            <span className="truncate text-xs text-text-3">
              {card.repoFullName}
            </span>
            <span className="shrink-0 text-xs text-text-4">
              #{card.prNumber}
            </span>
          </div>

          <span className="chat-block-content truncate font-medium text-text-1">
            {card.prTitle}
          </span>

          {(card.sourceBranch ||
            card.filesChanged !== undefined ||
            card.additions !== undefined ||
            card.deletions !== undefined) && (
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-4">
              {card.sourceBranch && (
                <span className="truncate font-mono text-[11px]">
                  {card.sourceBranch}
                  {card.targetBranch && (
                    <span className="text-text-4"> → {card.targetBranch}</span>
                  )}
                </span>
              )}
              {card.filesChanged !== undefined && (
                <>
                  {card.sourceBranch && <span>·</span>}
                  <span className="shrink-0">
                    {formatStatNumber(card.filesChanged)} files
                  </span>
                </>
              )}
              {card.additions !== undefined && (
                <>
                  {(card.sourceBranch || card.filesChanged !== undefined) && (
                    <span>·</span>
                  )}
                  <span className="shrink-0 text-success-6">
                    +{formatStatNumber(card.additions)}
                  </span>
                </>
              )}
              {card.deletions !== undefined && (
                <span className="shrink-0 text-danger-6">
                  -{formatStatNumber(card.deletions)}
                </span>
              )}
            </div>
          )}
        </div>

        <ExternalLink
          size={13}
          className="mt-0.5 shrink-0 text-text-4 transition-colors hover:text-text-2"
          aria-hidden="true"
        />
      </div>
    </a>
  );
};

SessionLinkCard.displayName = "SessionLinkCard";

export default SessionLinkCard;
