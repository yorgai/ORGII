/**
 * CodingProfileContent — Standalone Developer Profile view.
 *
 * Tab-based layout:
 *  - Overview cards always visible at top
 *  - TabPill switches between: Activity, Languages, IDE, Cursor
 *  - Each tab lazy-mounts on first visit, stays mounted (CSS hidden) to preserve cache
 *  - Refresh button triggers re-fetch via refreshKey prop
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  getDevRecordSessionCount,
  getDevRecordStreaks,
  getDevRecordSummary,
  importHeartbeats,
} from "@src/api/tauri/devRecord";
import type { DailySummary, StreakInfo } from "@src/api/tauri/devRecord/types";
import type { TabPillItem } from "@src/components/TabPill";
import TabPill from "@src/components/TabPill";
import {
  DETAIL_PANEL_TOKENS,
  InternalHeader,
  Placeholder,
  ScrollFadeContainer,
} from "@src/modules/shared/layouts/blocks";

import DateRangePill from "../../components/DateRangePill";
import { useRegisterRefresh } from "../../hooks/useRegisterRefresh";
import ActiveIdes from "./ActiveIdes";
import DeepWorkAnalysis from "./DeepWorkAnalysis";
import FocusHeatmap from "./FocusHeatmap";
import IdeUsagePie from "./IdeUsagePie";
import LanguageBreakdown from "./LanguageBreakdown";
import OverviewCards from "./OverviewCards";
import type { OverviewDeltas } from "./OverviewCards";
import ProductivityTrends from "./ProductivityTrends";
import SessionTimeline from "./SessionTimeline";
import WorkspaceBreakdown from "./WorkspaceBreakdown";
import {
  DATE_RANGE_OPTIONS,
  DEFAULT_RANGE,
  DEFAULT_TAB,
  PROFILE_TABS,
  computeDateRange,
  computeDeltaPercent,
  computePreviousDateRange,
} from "./config";
import type { ProfileDateRange, ProfileTabKey } from "./config";

interface OverviewData {
  summary: DailySummary[];
  streaks: StreakInfo | null;
  sessionCount: number;
}

const EMPTY_OVERVIEW: OverviewData = {
  summary: [],
  streaks: null,
  sessionCount: 0,
};

const CodingProfileContent: React.FC = () => {
  const { t } = useTranslation();
  const [range, setRange] = useState<ProfileDateRange>(DEFAULT_RANGE);
  const [customDates, setCustomDates] = useState<{
    startDate: string;
    endDate: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTabKey>(DEFAULT_TAB);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [visitedTabs, setVisitedTabs] = useState<Set<ProfileTabKey>>(
    () => new Set([DEFAULT_TAB])
  );

  const dateRange = useMemo(
    () => computeDateRange(range, customDates ?? undefined),
    [range, customDates]
  );

  // --- Overview data (always fetched for cards) ---
  interface OverviewResult {
    key: string;
    data: OverviewData;
    error: string | null;
  }

  const overviewKey = `overview:${dateRange.startDate}:${dateRange.endDate}:${refreshCounter}`;
  const [overviewResult, setOverviewResult] = useState<OverviewResult | null>(
    null
  );
  const validOverview =
    overviewResult?.key === overviewKey ? overviewResult : null;
  const isRefreshing = !validOverview && !!overviewResult;
  const isInitialLoad = !overviewResult;
  const overview = (validOverview ?? overviewResult)?.data ?? EMPTY_OVERVIEW;
  const overviewError = validOverview?.error ?? null;

  useEffect(() => {
    const effectKey = `overview:${dateRange.startDate}:${dateRange.endDate}:${refreshCounter}`;
    let cancelled = false;

    Promise.all([
      getDevRecordSummary(dateRange.startDate, dateRange.endDate),
      getDevRecordStreaks(),
      getDevRecordSessionCount(dateRange.startDate, dateRange.endDate),
    ])
      .then(([summary, streaks, sessionCount]) => {
        if (!cancelled) {
          setOverviewResult({
            key: effectKey,
            data: { summary, streaks, sessionCount },
            error: null,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setOverviewResult({
            key: effectKey,
            data: EMPTY_OVERVIEW,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dateRange.startDate, dateRange.endDate, refreshCounter]);

  // --- Previous period data (for delta indicators) ---
  const prevDateRange = useMemo(
    () => computePreviousDateRange(range, customDates ?? undefined),
    [range, customDates]
  );

  interface PrevPeriodData {
    sessionCount: number;
    totalLinesChanged: number;
    totalFilesTouched: number;
  }

  const [prevPeriod, setPrevPeriod] = useState<PrevPeriodData | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      getDevRecordSummary(prevDateRange.startDate, prevDateRange.endDate),
      getDevRecordSessionCount(prevDateRange.startDate, prevDateRange.endDate),
    ])
      .then(([prevSummary, prevSessionCount]) => {
        if (cancelled) return;
        const totalLines = prevSummary.reduce(
          (acc, row) => acc + row.linesAdded + row.linesRemoved,
          0
        );
        const totalFiles = prevSummary.reduce(
          (acc, row) => acc + row.filesTouched,
          0
        );
        setPrevPeriod({
          sessionCount: prevSessionCount,
          totalLinesChanged: totalLines,
          totalFilesTouched: totalFiles,
        });
      })
      .catch(() => {
        if (!cancelled) setPrevPeriod(null);
      });

    return () => {
      cancelled = true;
    };
  }, [prevDateRange.startDate, prevDateRange.endDate, refreshCounter]);

  const handleRefreshAction = useCallback(async () => {
    await importHeartbeats().catch(() => {});
    setRefreshCounter((prev) => prev + 1);
  }, []);

  useRegisterRefresh(
    "coding-profile",
    handleRefreshAction,
    isInitialLoad || isRefreshing
  );

  // --- Computed totals from summary ---
  const totalLinesAdded = useMemo(
    () => overview.summary.reduce((acc, row) => acc + row.linesAdded, 0),
    [overview.summary]
  );
  const totalLinesRemoved = useMemo(
    () => overview.summary.reduce((acc, row) => acc + row.linesRemoved, 0),
    [overview.summary]
  );
  const totalFilesTouched = useMemo(
    () => overview.summary.reduce((acc, row) => acc + row.filesTouched, 0),
    [overview.summary]
  );

  // --- Deltas ---
  const overviewDeltas = useMemo<OverviewDeltas | undefined>(() => {
    if (!prevPeriod) return undefined;
    const currentLines = totalLinesAdded + totalLinesRemoved;
    return {
      sessions: {
        percent: computeDeltaPercent(
          overview.sessionCount,
          prevPeriod.sessionCount
        ),
      },
      lines: {
        percent: computeDeltaPercent(
          currentLines,
          prevPeriod.totalLinesChanged
        ),
      },
      filesTouched: {
        percent: computeDeltaPercent(
          totalFilesTouched,
          prevPeriod.totalFilesTouched
        ),
      },
    };
  }, [
    prevPeriod,
    overview.sessionCount,
    totalLinesAdded,
    totalLinesRemoved,
    totalFilesTouched,
  ]);

  // --- Tab options ---

  const contentTabOptions = useMemo<TabPillItem[]>(
    () => PROFILE_TABS.map((tab) => ({ key: tab.key, label: t(tab.labelKey) })),
    [t]
  );

  const handleRangeChange = useCallback((tab: string) => {
    setRange(tab as ProfileDateRange);
  }, []);

  const handleCustomDatesChange = useCallback(
    (startDate: string, endDate: string) => {
      setCustomDates({ startDate, endDate });
    },
    []
  );

  const handleTabChange = useCallback((tab: string) => {
    const tabKey = tab as ProfileTabKey;
    setActiveTab(tabKey);
    setVisitedTabs((prev) => {
      if (prev.has(tabKey)) return prev;
      const next = new Set(prev);
      next.add(tabKey);
      return next;
    });
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <InternalHeader
        noPanelHeader
        contentPadding
        className={DETAIL_PANEL_TOKENS.headerWidth}
        actions={
          <DateRangePill
            options={DATE_RANGE_OPTIONS}
            activeKey={range}
            onChange={handleRangeChange}
            onCustomDatesChange={handleCustomDatesChange}
            customStartDate={customDates?.startDate}
            customEndDate={customDates?.endDate}
          />
        }
        tabs={
          <TabPill
            tabs={contentTabOptions}
            activeTab={activeTab}
            onChange={handleTabChange}
            variant="simple"
            fillWidth={false}
            size="large"
          />
        }
      />

      <ScrollFadeContainer className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
        <div className={DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop}>
          {overviewError && (
            <Placeholder
              variant="error"
              placement="detail-panel"
              title={overviewError}
              onRetry={handleRefreshAction}
            />
          )}

          <div>
            {isInitialLoad ? (
              <Placeholder variant="loading" placement="detail-panel" />
            ) : overview.sessionCount === 0 && overview.summary.length === 0 ? (
              <Placeholder
                variant="empty"
                placement="detail-panel"
                title={t("devActivity.noData")}
              />
            ) : (
              <>
                <div className={DETAIL_PANEL_TOKENS.sectionGap}>
                  <OverviewCards
                    sessionCount={overview.sessionCount}
                    totalLinesAdded={totalLinesAdded}
                    totalLinesRemoved={totalLinesRemoved}
                    totalFilesTouched={totalFilesTouched}
                    currentStreak={overview.streaks?.currentStreak ?? 0}
                    deltas={overviewDeltas}
                  />
                </div>
              </>
            )}

            {visitedTabs.has("activity") && (
              <div className={activeTab !== "activity" ? "hidden" : undefined}>
                <FocusHeatmap
                  startDate={dateRange.startDate}
                  endDate={dateRange.endDate}
                  refreshKey={refreshCounter}
                />
                <ProductivityTrends summary={overview.summary} />
              </div>
            )}

            {visitedTabs.has("focus") && (
              <div className={activeTab !== "focus" ? "hidden" : undefined}>
                <DeepWorkAnalysis
                  startDate={dateRange.startDate}
                  endDate={dateRange.endDate}
                  refreshKey={refreshCounter}
                />
                <SessionTimeline
                  startDate={dateRange.startDate}
                  endDate={dateRange.endDate}
                  refreshKey={refreshCounter}
                />
              </div>
            )}

            {visitedTabs.has("languages") && (
              <div className={activeTab !== "languages" ? "hidden" : undefined}>
                <LanguageBreakdown
                  startDate={dateRange.startDate}
                  endDate={dateRange.endDate}
                  refreshKey={refreshCounter}
                />
              </div>
            )}

            {visitedTabs.has("heatmap") && (
              <div className={activeTab !== "heatmap" ? "hidden" : undefined}>
                <WorkspaceBreakdown
                  summary={overview.summary}
                  startDate={dateRange.startDate}
                  endDate={dateRange.endDate}
                  refreshKey={refreshCounter}
                />
              </div>
            )}

            {visitedTabs.has("ide") && (
              <div className={activeTab !== "ide" ? "hidden" : undefined}>
                <IdeUsagePie
                  startDate={dateRange.startDate}
                  endDate={dateRange.endDate}
                  refreshKey={refreshCounter}
                />
                <ActiveIdes refreshKey={refreshCounter} />
              </div>
            )}
          </div>
        </div>
      </ScrollFadeContainer>
    </div>
  );
};

export default memo(CodingProfileContent);
