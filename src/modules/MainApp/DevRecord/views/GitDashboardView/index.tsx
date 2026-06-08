import React, {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import type { GitCommitInfo } from "@src/api/http/git/types";
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
import { CommitHistorySection } from "./CommitHistorySection";
import { DESELECT_ALL_SENTINEL } from "./ContributorFilter";
import { ContributorStatsSection } from "./ContributorStatsSection";
import DailyTimeline from "./DailyTimeline";
import { TeamSummaryStatsSection } from "./TeamSummaryStatsSection";
import {
  STATS_CONCURRENCY,
  buildStatsEntry,
  commitPools,
  fetchCommitsForRange,
  getGitCommitDiff,
  getPoolKey,
  isMergeCommit,
} from "./commitPool";
import {
  AUTHOR_BREAKDOWN_THRESHOLD,
  DATE_RANGE_OPTIONS,
  MAX_CHART_AUTHORS,
  getContributorColor,
} from "./config";
import {
  buildChartData,
  buildContributorStats,
  buildDotGraphData,
  buildTeamStats,
} from "./dataBuilders";
import * as statsCache from "./statsCache";
import type {
  CommitStatsEntry,
  DashboardTab,
  DashboardViewMode,
  DateRange,
} from "./types";
import { DATE_RANGE_DAYS } from "./types";

const STATS_UI_FLUSH_SIZE = 75;

interface GitDashboardContentProps {
  repoPath: string;
  repoId: string;
}

const GitDashboardContent: React.FC<GitDashboardContentProps> = ({
  repoPath,
  repoId,
}) => {
  const { t } = useTranslation();
  const [dateRange, setDateRange] = useState<DateRange>("24h");
  const [customDates, setCustomDates] = useState<{
    startDate: string;
    endDate: string;
  } | null>(null);
  const [viewMode, setViewMode] = useState<DashboardViewMode>("chart");
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>("statistics");
  const [commits, setCommits] = useState<GitCommitInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [currentStatsMap, setCurrentStatsMap] = useState<
    Map<string, CommitStatsEntry>
  >(new Map());
  const [statsLoading, setStatsLoading] = useState(false);
  const [excludeRenames, setExcludeRenames] = useState(false);
  const [selectedContributors, setSelectedContributors] = useState<Set<string>>(
    new Set()
  );
  const [retryCount, setRetryCount] = useState(0);

  const handleRefresh = useCallback(() => {
    const poolKey = getPoolKey(repoPath, repoId);
    commitPools.delete(poolKey);
    setRetryCount((prev) => prev + 1);
  }, [repoPath, repoId]);

  useRegisterRefresh("git-dashboard", handleRefresh, loading);

  const days = useMemo(() => {
    if (dateRange === "custom" && customDates) {
      const startMs = new Date(customDates.startDate).getTime();
      const endMs = new Date(customDates.endDate).getTime();
      return Math.max(1, Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24)));
    }
    return DATE_RANGE_DAYS[dateRange];
  }, [dateRange, customDates]);

  const viewModeOptions = useMemo<TabPillItem[]>(
    () => [
      { key: "chart", label: t("gitDashboard.viewChart") },
      { key: "line", label: t("otherUsage.viewLine") },
      { key: "dots", label: t("gitDashboard.viewDots") },
    ],
    [t]
  );

  const dashboardTabOptions = useMemo<TabPillItem[]>(
    () => [
      { key: "statistics", label: t("gitDashboard.tabStatistics") },
      { key: "activities", label: t("gitDashboard.tabActivities") },
    ],
    [t]
  );

  const handleDashboardTabChange = useCallback((tab: string) => {
    setDashboardTab(tab as DashboardTab);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const poolKey = getPoolKey(repoPath, repoId);
      const existingPool = commitPools.get(poolKey);
      const canServeFromPool = existingPool && existingPool.maxDays >= days;

      if (!canServeFromPool) {
        setLoading(true);
      }
      setError(null);

      const fetched = await fetchCommitsForRange(
        repoPath,
        repoId,
        days,
        (partial) => {
          if (!cancelled) {
            startTransition(() => {
              setCommits(partial);
              setLoading(false);
            });
          }
        }
      );
      if (cancelled) return;
      setCommits(fetched);
      setLoading(false);

      if (fetched.length === 0) {
        setCurrentStatsMap(new Map());
        setStatsLoading(false);
        return;
      }

      await statsCache.ensureLoaded();
      if (cancelled) return;

      const initialMap = new Map<string, CommitStatsEntry>();
      const uncachedShas: string[] = [];

      for (const commit of fetched) {
        if (isMergeCommit(commit)) continue;
        const cached = statsCache.get(commit.sha);
        if (cached) {
          initialMap.set(commit.sha, cached);
        } else {
          uncachedShas.push(commit.sha);
        }
      }

      setCurrentStatsMap(initialMap);

      if (uncachedShas.length === 0) {
        setStatsLoading(false);
        return;
      }

      setStatsLoading(true);

      let pendingFlush: [string, CommitStatsEntry][] = [];
      const PARALLEL_BATCHES = 3;
      const stride = STATS_CONCURRENCY * PARALLEL_BATCHES;

      for (let i = 0; i < uncachedShas.length; i += stride) {
        if (cancelled) break;

        const batchPromises: Promise<
          PromiseSettledResult<Awaited<ReturnType<typeof getGitCommitDiff>>>[]
        >[] = [];
        for (let b = 0; b < PARALLEL_BATCHES; b++) {
          const offset = i + b * STATS_CONCURRENCY;
          if (offset >= uncachedShas.length) break;
          const batch = uncachedShas.slice(offset, offset + STATS_CONCURRENCY);
          batchPromises.push(
            Promise.allSettled(
              batch.map((sha) =>
                getGitCommitDiff({
                  repo_id: repoId,
                  repo_path: repoPath,
                  commit_sha: sha,
                  context_lines: 0,
                })
              )
            )
          );
        }

        const batchResults = await Promise.all(batchPromises);

        for (const responses of batchResults) {
          for (const response of responses) {
            if (response.status === "fulfilled" && response.value) {
              const entry = buildStatsEntry(response.value);
              pendingFlush.push([response.value.commit_sha, entry]);
              statsCache.set(response.value.commit_sha, entry);
            }
          }
        }

        const isLastBatch = i + stride >= uncachedShas.length;
        if (
          !cancelled &&
          pendingFlush.length > 0 &&
          (pendingFlush.length >= STATS_UI_FLUSH_SIZE || isLastBatch)
        ) {
          const toFlush = pendingFlush;
          pendingFlush = [];
          startTransition(() => {
            setCurrentStatsMap((prev) => {
              const next = new Map(prev);
              for (const [sha, entry] of toFlush) {
                next.set(sha, entry);
              }
              return next;
            });
          });
        }
      }

      if (!cancelled) {
        startTransition(() => {
          setStatsLoading(false);
        });
      }
      statsCache.scheduleSave();
    };

    run().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Failed to load data");
        setLoading(false);
        setStatsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [repoPath, repoId, days, retryCount]);

  const chartResult = useMemo(
    () =>
      viewMode === "chart" || viewMode === "line"
        ? buildChartData(commits, days)
        : null,
    [commits, days, viewMode]
  );

  const dotGraphData = useMemo(
    () => (viewMode === "dots" ? buildDotGraphData(commits, days) : null),
    [commits, days, viewMode]
  );

  const authors = useMemo(() => chartResult?.authors ?? [], [chartResult]);
  const chartData = useMemo(() => chartResult?.chartData ?? [], [chartResult]);

  const contributorStats = useMemo(
    () => buildContributorStats(commits, currentStatsMap),
    [commits, currentStatsMap]
  );

  const chartColorMap = useMemo(() => {
    const map = new Map<string, string>();
    authors.forEach((author, index) => {
      map.set(author, getContributorColor(index));
    });
    return map;
  }, [authors]);

  const authorColorMap = useMemo(() => {
    if (chartColorMap.size > 0) return chartColorMap;
    const map = new Map<string, string>();
    contributorStats.forEach((entry, index) => {
      map.set(entry.name, getContributorColor(index));
    });
    return map;
  }, [chartColorMap, contributorStats]);

  const allContributorNames = useMemo(
    () => contributorStats.map((entry) => entry.name),
    [contributorStats]
  );

  const isDeselectAll =
    selectedContributors.size === 1 &&
    selectedContributors.has(DESELECT_ALL_SENTINEL);
  const hasContributorFilter = selectedContributors.size > 0 && !isDeselectAll;
  const showAuthorBreakdown = authors.length <= AUTHOR_BREAKDOWN_THRESHOLD;

  const topChartAuthors = useMemo(() => {
    if (authors.length <= MAX_CHART_AUTHORS) return authors;

    const authorCounts = new Map<string, number>();
    for (const commit of commits) {
      const name = commit.author?.name ?? "Unknown";
      authorCounts.set(name, (authorCounts.get(name) ?? 0) + 1);
    }

    const topNames = new Set(
      [...authorCounts.entries()]
        .sort((entryA, entryB) => entryB[1] - entryA[1])
        .slice(0, MAX_CHART_AUTHORS)
        .map(([name]) => name)
    );

    return authors.filter((author) => topNames.has(author));
  }, [commits, authors]);

  const hasOtherBucket =
    showAuthorBreakdown &&
    authors.length > MAX_CHART_AUTHORS &&
    !hasContributorFilter &&
    !isDeselectAll;

  const chartDataForRender = useMemo(() => {
    if (!hasOtherBucket) return chartData;
    const topSet = new Set(topChartAuthors);
    return chartData.map((row) => {
      let otherCount = 0;
      for (const author of authors) {
        if (!topSet.has(author)) {
          otherCount += (row[author] as number | undefined) ?? 0;
        }
      }
      if (otherCount === 0) return row;
      return { ...row, Other: otherCount };
    });
  }, [chartData, authors, topChartAuthors, hasOtherBucket]);

  const filteredAuthors = useMemo(
    () =>
      isDeselectAll
        ? []
        : hasContributorFilter
          ? authors.filter((author) => selectedContributors.has(author))
          : topChartAuthors,
    [
      authors,
      topChartAuthors,
      selectedContributors,
      hasContributorFilter,
      isDeselectAll,
    ]
  );

  const filteredContributorStats = useMemo(
    () =>
      isDeselectAll
        ? []
        : hasContributorFilter
          ? contributorStats.filter((entry) =>
              selectedContributors.has(entry.name)
            )
          : contributorStats,
    [
      contributorStats,
      selectedContributors,
      hasContributorFilter,
      isDeselectAll,
    ]
  );

  const teamStats = useMemo(
    () => buildTeamStats(currentStatsMap),
    [currentStatsMap]
  );

  const handleDateRangeChange = useCallback((tab: string) => {
    setDateRange(tab as DateRange);
  }, []);

  const handleCustomDatesChange = useCallback(
    (startDate: string, endDate: string) => {
      setCustomDates({ startDate, endDate });
    },
    []
  );

  const handleViewModeChange = useCallback((tab: string) => {
    setViewMode(tab as DashboardViewMode);
  }, []);

  const handleToggleRenames = useCallback(() => {
    setExcludeRenames((prev) => !prev);
  }, []);

  const summaryMetrics = excludeRenames ? teamStats.contentOnly : teamStats.all;

  const showContributorFilter =
    showAuthorBreakdown && contributorStats.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <InternalHeader
        noPanelHeader
        contentPadding
        className={DETAIL_PANEL_TOKENS.headerWidth}
        actions={
          <DateRangePill
            options={DATE_RANGE_OPTIONS}
            activeKey={dateRange}
            onChange={handleDateRangeChange}
            onCustomDatesChange={handleCustomDatesChange}
            customStartDate={customDates?.startDate}
            customEndDate={customDates?.endDate}
          />
        }
        tabs={
          <TabPill
            tabs={dashboardTabOptions}
            activeTab={dashboardTab}
            onChange={handleDashboardTabChange}
            variant="simple"
            fillWidth={false}
            size="large"
          />
        }
      />

      <ScrollFadeContainer className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
        <div className={DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop}>
          {error && (
            <Placeholder
              variant="error"
              placement="detail-panel"
              title={error}
              onRetry={handleRefresh}
            />
          )}

          {loading && !error ? (
            <Placeholder variant="loading" placement="detail-panel" />
          ) : !error ? (
            <>
              <TeamSummaryStatsSection
                commitsCount={commits.length}
                contributorCount={contributorStats.length}
                metrics={summaryMetrics}
                statsLoading={statsLoading}
                excludeRenames={excludeRenames}
                showRenameToggle={currentStatsMap.size > 0}
                onToggleRenames={handleToggleRenames}
              />

              <div
                className={dashboardTab !== "statistics" ? "hidden" : undefined}
              >
                <CommitHistorySection
                  viewMode={viewMode}
                  viewModeOptions={viewModeOptions}
                  onViewModeChange={handleViewModeChange}
                  showAuthorBreakdown={showAuthorBreakdown}
                  showContributorFilter={showContributorFilter}
                  allContributorNames={allContributorNames}
                  selectedContributors={selectedContributors}
                  onContributorsChange={setSelectedContributors}
                  authorColorMap={authorColorMap}
                  days={days}
                  chartData={chartData}
                  chartDataForRender={chartDataForRender}
                  filteredAuthors={filteredAuthors}
                  chartColorMap={chartColorMap}
                  hasOtherBucket={hasOtherBucket}
                  dotGraphData={dotGraphData}
                />

                <ContributorStatsSection
                  rows={filteredContributorStats}
                  authorColorMap={authorColorMap}
                  excludeRenames={excludeRenames}
                />
              </div>

              <div
                className={dashboardTab !== "activities" ? "hidden" : undefined}
              >
                <DailyTimeline commits={commits} statsMap={currentStatsMap} />
              </div>
            </>
          ) : null}
        </div>
      </ScrollFadeContainer>
    </div>
  );
};

export default memo(GitDashboardContent);
