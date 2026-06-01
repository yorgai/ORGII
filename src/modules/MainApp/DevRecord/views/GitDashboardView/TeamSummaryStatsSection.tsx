import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DETAIL_PANEL_TOKENS,
  STAT_GRID_TOKENS,
} from "@src/modules/shared/layouts/blocks";

import StatCard, { DiffValue } from "../../components/StatCard";
import { STAT_CARD_CONFIG } from "../../statCardConfig";
import type { ChangeMetrics } from "./types";

export interface TeamSummaryStatsSectionProps {
  commitsCount: number;
  contributorCount: number;
  metrics: ChangeMetrics;
  statsLoading: boolean;
  excludeRenames: boolean;
  showRenameToggle: boolean;
  onToggleRenames: () => void;
}

export function TeamSummaryStatsSection({
  commitsCount,
  contributorCount,
  metrics,
  statsLoading,
  excludeRenames,
  showRenameToggle,
  onToggleRenames,
}: TeamSummaryStatsSectionProps) {
  const { t } = useTranslation();

  return (
    <div className={DETAIL_PANEL_TOKENS.sectionGap}>
      <div className={STAT_GRID_TOKENS.cols4}>
        <StatCard
          icon={STAT_CARD_CONFIG.commits.icon}
          label={t(STAT_CARD_CONFIG.commits.labelKey)}
        >
          {commitsCount.toLocaleString()}
        </StatCard>
        <StatCard
          icon={STAT_CARD_CONFIG.contributors.icon}
          label={t(STAT_CARD_CONFIG.contributors.labelKey)}
        >
          {contributorCount.toLocaleString()}
        </StatCard>
        <StatCard
          icon={STAT_CARD_CONFIG.filesChanged.icon}
          label={t(STAT_CARD_CONFIG.filesChanged.labelKey)}
        >
          {metrics.filesChanged.toLocaleString()}
          {statsLoading && (
            <Loader2 size={12} className="shrink-0 animate-spin text-text-2" />
          )}
        </StatCard>
        <StatCard
          icon={STAT_CARD_CONFIG.linesChanged.icon}
          label={t(STAT_CARD_CONFIG.linesChanged.labelKey)}
        >
          <DiffValue
            added={metrics.additions}
            removed={metrics.deletions}
            loading={statsLoading}
          />
        </StatCard>
      </div>

      {showRenameToggle && (
        <button
          type="button"
          onClick={onToggleRenames}
          className="mt-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-text-2 transition-colors hover:bg-fill-2 hover:text-text-1"
        >
          <span
            className={`inline-block h-2.5 w-2.5 rounded-sm border ${
              excludeRenames
                ? "border-primary-6 bg-primary-6"
                : "border-border-2 bg-transparent"
            }`}
          />
          {t("gitDashboard.excludeRenames")}
        </button>
      )}
    </div>
  );
}
