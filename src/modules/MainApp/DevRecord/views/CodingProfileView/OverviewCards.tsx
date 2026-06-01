import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import { STAT_GRID_TOKENS } from "@src/modules/shared/layouts/blocks";

import StatCard, { DiffValue } from "../../components/StatCard";
import type { StatCardDelta } from "../../components/StatCard";
import { STAT_CARD_CONFIG } from "../../statCardConfig";

export interface OverviewDeltas {
  sessions?: StatCardDelta;
  lines?: StatCardDelta;
  filesTouched?: StatCardDelta;
  streak?: StatCardDelta;
}

interface OverviewCardsProps {
  sessionCount: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  totalFilesTouched: number;
  currentStreak: number;
  deltas?: OverviewDeltas;
}

const OverviewCards: React.FC<OverviewCardsProps> = memo(
  ({
    sessionCount,
    totalLinesAdded,
    totalLinesRemoved,
    totalFilesTouched,
    currentStreak,
    deltas,
  }) => {
    const { t } = useTranslation();

    const cfg = STAT_CARD_CONFIG;
    return (
      <div className={STAT_GRID_TOKENS.cols4}>
        <StatCard
          icon={cfg.sessions.icon}
          label={t(cfg.sessions.labelKey)}
          delta={deltas?.sessions}
        >
          {sessionCount.toLocaleString()}
        </StatCard>
        <StatCard
          icon={cfg.linesChanged.icon}
          label={t(cfg.linesChanged.labelKey)}
          delta={deltas?.lines}
        >
          <DiffValue added={totalLinesAdded} removed={totalLinesRemoved} />
        </StatCard>
        <StatCard
          icon={cfg.filesTouched.icon}
          label={t(cfg.filesTouched.labelKey)}
          delta={deltas?.filesTouched}
        >
          {totalFilesTouched.toLocaleString()}
        </StatCard>
        <StatCard
          icon={cfg.streak.icon}
          label={t(cfg.streak.labelKey)}
          delta={deltas?.streak}
        >
          {currentStreak}d
        </StatCard>
      </div>
    );
  }
);

OverviewCards.displayName = "OverviewCards";

export default OverviewCards;
