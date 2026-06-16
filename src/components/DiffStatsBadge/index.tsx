import { memo } from "react";

import { DIFF_STATS } from "@src/config/workstation/tokens";

type DiffStatsBadgeVariant = "default" | "compact" | "chat";

export interface DiffStatsBadgeProps {
  additions?: number;
  deletions?: number;
  variant?: DiffStatsBadgeVariant;
}

const CONTAINER_CLASSES: Record<DiffStatsBadgeVariant, string> = {
  default: DIFF_STATS.container,
  compact: DIFF_STATS.containerCompact,
  chat: "chat-block-xs flex shrink-0 items-center gap-1 font-mono font-medium leading-none tabular-nums",
};

const VALUE_CLASSES: Record<DiffStatsBadgeVariant, string> = {
  default: "",
  compact: "",
  chat: "inline-flex min-w-[3ch] justify-end",
};

const DiffStatsBadge = memo(function DiffStatsBadge({
  additions = 0,
  deletions = 0,
  variant = "default",
}: DiffStatsBadgeProps) {
  if (additions <= 0 && deletions <= 0) {
    return null;
  }

  return (
    <span className={CONTAINER_CLASSES[variant]}>
      {additions > 0 && (
        <span className={`${VALUE_CLASSES[variant]} ${DIFF_STATS.additions}`}>
          +{additions}
        </span>
      )}
      {deletions > 0 && (
        <span className={`${VALUE_CLASSES[variant]} ${DIFF_STATS.deletions}`}>
          -{deletions}
        </span>
      )}
    </span>
  );
});

export default DiffStatsBadge;
