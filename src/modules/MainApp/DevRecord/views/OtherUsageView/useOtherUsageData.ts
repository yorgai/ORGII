import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getOrgtrackCursorSessions } from "@src/api/tauri/orgtrackHistory";
import type { CursorSession } from "@src/api/tauri/orgtrackHistory/types";

import {
  DATE_RANGE_OPTIONS,
  DEFAULT_RANGE,
  computeDateRange,
  formatModelNameFull,
} from "../CodingProfileView/config";
import type { ProfileDateRange } from "../CodingProfileView/config";
import { useSessionAutoRefresh } from "../CodingProfileView/useSessionAutoRefresh";
import {
  DEFAULT_TAB,
  type ModelStats,
  type OtherUsageTabKey,
  buildModelStats,
} from "./config";

export interface UseOtherUsageDataReturn {
  // Tab state
  activeTab: OtherUsageTabKey;
  visitedTabs: Set<OtherUsageTabKey>;
  handleTabChange: (tab: string) => void;

  // Date range
  range: ProfileDateRange;
  setRange: (range: ProfileDateRange) => void;
  customDates: { startDate: string; endDate: string } | null;
  setCustomDates: (
    dates: { startDate: string; endDate: string } | null
  ) => void;
  dateRange: { startDate: string; endDate: string };

  // Refresh
  refreshCounter: number;
  handleRefreshAction: () => void;
  isInitialLoad: boolean;
  fetchError: string | null;

  // Filter sidebar
  isFilterSidebarVisible: boolean;
  setIsFilterSidebarVisible: (fn: (prev: boolean) => boolean) => void;

  // Model breakdown chart view toggle
  modelBreakdownView: "bar" | "pie";
  setModelBreakdownView: (view: "bar" | "pie") => void;

  // Model filter
  selectedModel: string | null;
  setSelectedModel: (model: string | null) => void;

  // Derived data
  sessions: CursorSession[];
  modelStats: ModelStats[];
  modelChartData: { model: string; tokens: number }[];
  modelNameMap: Map<string, string>;
  sidebarModelStats: { model: string; count: number }[];

  // Reset
  handleFilterReset: () => void;

  // Date range options passthrough
  dateRangeOptions: typeof DATE_RANGE_OPTIONS;
}

export function useOtherUsageData(): UseOtherUsageDataReturn {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<OtherUsageTabKey>(DEFAULT_TAB);
  const [visitedTabs, setVisitedTabs] = useState<Set<OtherUsageTabKey>>(
    () => new Set([DEFAULT_TAB])
  );

  const [range, setRange] = useState<ProfileDateRange>(DEFAULT_RANGE);
  const [customDates, setCustomDates] = useState<{
    startDate: string;
    endDate: string;
  } | null>(null);

  const [refreshCounter, setRefreshCounter] = useState(0);

  const [modelBreakdownView, setModelBreakdownView] = useState<"bar" | "pie">(
    "bar"
  );
  const [isFilterSidebarVisible, setIsFilterSidebarVisible] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const dateRange = useMemo(
    () => computeDateRange(range, customDates ?? undefined),
    [range, customDates]
  );

  const fetcher = useMemo(
    () => () =>
      getOrgtrackCursorSessions(dateRange.startDate, dateRange.endDate),
    [dateRange.startDate, dateRange.endDate]
  );

  const {
    data,
    error: fetchError,
    isInitialLoad,
    triggerRefresh,
  } = useSessionAutoRefresh<CursorSession[]>({
    fetcher,
    countFromData: (sessions) => sessions.length,
    label: t("otherUsage.title"),
    formatSuccess: (label, count) => ({
      title: t("devActivity.refreshSuccess", { count, label }),
      description: t("devActivity.refreshSuccessDescription"),
    }),
    formatError: (label) => ({
      title: t("devActivity.refreshError", { label }),
      description: t("devActivity.refreshErrorDescription"),
    }),
    cacheKey: `ai:${dateRange.startDate}:${dateRange.endDate}`,
  });

  const handleRefreshAction = useCallback(() => {
    triggerRefresh();
    setRefreshCounter((prev) => prev + 1);
  }, [triggerRefresh]);

  const handleTabChange = useCallback((tab: string) => {
    const tabKey = tab as OtherUsageTabKey;
    setActiveTab(tabKey);
    setVisitedTabs((prev) => {
      if (prev.has(tabKey)) return prev;
      const next = new Set(prev);
      next.add(tabKey);
      return next;
    });
  }, []);

  const handleFilterReset = useCallback(() => {
    setRange(DEFAULT_RANGE);
    setCustomDates(null);
    setSelectedModel(null);
  }, []);

  const sessions = useMemo(() => data ?? [], [data]);

  const modelStats = useMemo(
    () => buildModelStats(sessions, formatModelNameFull),
    [sessions]
  );

  const modelChartData = useMemo(
    () =>
      modelStats.slice(0, 8).map((stat) => ({
        model: formatModelNameFull(stat.model),
        tokens: stat.tokensUsed,
      })),
    [modelStats]
  );

  const modelNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const stat of modelStats) {
      map.set(formatModelNameFull(stat.model), stat.model);
    }
    return map;
  }, [modelStats]);

  const sidebarModelStats = useMemo(
    () =>
      modelStats.map((stat) => ({
        model: stat.model,
        count: stat.sessionCount,
      })),
    [modelStats]
  );

  return {
    activeTab,
    visitedTabs,
    handleTabChange,
    range,
    setRange,
    customDates,
    setCustomDates,
    dateRange,
    refreshCounter,
    handleRefreshAction,
    isInitialLoad,
    fetchError,
    isFilterSidebarVisible,
    setIsFilterSidebarVisible,
    modelBreakdownView,
    setModelBreakdownView,
    selectedModel,
    setSelectedModel,
    sessions,
    modelStats,
    modelChartData,
    modelNameMap,
    sidebarModelStats,
    handleFilterReset,
    dateRangeOptions: DATE_RANGE_OPTIONS,
  };
}
