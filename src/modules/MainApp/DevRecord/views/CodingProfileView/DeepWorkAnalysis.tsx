/**
 * DeepWorkAnalysis — Focus session analytics.
 *
 * Categorizes CodingSessions into deep (>=30min), medium (10-30min),
 * and fragmented (<10min). Shows summary stats, distribution bar,
 * best focus hours, and daily trend chart.
 */
import { Brain, Clock, Flame } from "lucide-react";
import React, { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getDevRecordSessions } from "@src/api/tauri/devRecord";
import type { CodingSession } from "@src/api/tauri/devRecord/types";
import {
  CHART_AXIS_TICK,
  CHART_MARGIN,
  ChartTooltip,
} from "@src/components/Chart";
import {
  CollapsibleSection,
  DETAIL_PANEL_TOKENS,
  Placeholder,
  STAT_GRID_TOKENS,
} from "@src/modules/shared/layouts/blocks";

import StatCard from "../../components/StatCard";
import {
  DEEP_WORK_THRESHOLD,
  MEDIUM_FOCUS_THRESHOLD,
  formatDuration,
} from "./config";
import type { FetchResult } from "./config";

interface DeepWorkAnalysisProps {
  startDate: string;
  endDate: string;
  refreshKey: number;
}

type FocusCategory = "deep" | "medium" | "fragmented";

interface FocusCategorized {
  deep: CodingSession[];
  medium: CodingSession[];
  fragmented: CodingSession[];
}

function categorizeSession(session: CodingSession): FocusCategory {
  if (session.durationSeconds >= DEEP_WORK_THRESHOLD) return "deep";
  if (session.durationSeconds >= MEDIUM_FOCUS_THRESHOLD) return "medium";
  return "fragmented";
}

const CATEGORY_COLORS: Record<FocusCategory, string> = {
  deep: "var(--color-primary-6)",
  medium: "#f59e0b",
  fragmented: "var(--color-fill-3)",
};

const DeepWorkAnalysis: React.FC<DeepWorkAnalysisProps> = ({
  startDate,
  endDate,
  refreshKey,
}) => {
  const { t } = useTranslation();
  const fetchKey = `deepwork:${startDate}:${endDate}:${refreshKey}`;

  const [result, setResult] = useState<FetchResult<CodingSession[]> | null>(
    null
  );
  const validResult = result?.key === fetchKey ? result : null;

  useEffect(() => {
    const effectKey = `deepwork:${startDate}:${endDate}:${refreshKey}`;
    let cancelled = false;

    getDevRecordSessions(startDate, endDate)
      .then((data) => {
        if (!cancelled) setResult({ key: effectKey, data, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setResult({
            key: effectKey,
            data: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, refreshKey]);

  const sessions = useMemo(
    () => (validResult ?? result)?.data ?? [],
    [validResult, result]
  );

  const categorized = useMemo<FocusCategorized>(() => {
    const buckets: FocusCategorized = { deep: [], medium: [], fragmented: [] };
    for (const session of sessions) {
      if (session.durationSeconds <= 0) continue;
      buckets[categorizeSession(session)].push(session);
    }
    return buckets;
  }, [sessions]);

  const stats = useMemo(() => {
    const totalSessions =
      categorized.deep.length +
      categorized.medium.length +
      categorized.fragmented.length;
    const deepPercent =
      totalSessions > 0
        ? Math.round((categorized.deep.length / totalSessions) * 100)
        : 0;
    const deepTotalSeconds = categorized.deep.reduce(
      (acc, session) => acc + session.durationSeconds,
      0
    );
    const avgDeepSession =
      categorized.deep.length > 0
        ? Math.round(deepTotalSeconds / categorized.deep.length)
        : 0;

    return { deepPercent, deepTotalSeconds, avgDeepSession, totalSessions };
  }, [categorized]);

  const bestHours = useMemo(() => {
    const hourCounts = new Array<number>(24).fill(0);
    for (const session of categorized.deep) {
      const hour = new Date(session.startTime).getHours();
      hourCounts[hour] += 1;
    }

    const entries = hourCounts
      .map((count, hour) => ({ hour, count }))
      .filter((entry) => entry.count > 0)
      .sort((entryA, entryB) => entryB.count - entryA.count);

    if (entries.length === 0) return null;

    const topHour = entries[0].hour;
    const endHour = (topHour + 2) % 24;
    const formatHour = (hour: number) => {
      if (hour === 0) return "12am";
      if (hour === 12) return "12pm";
      return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
    };
    return `${formatHour(topHour)} – ${formatHour(endHour)}`;
  }, [categorized.deep]);

  const dailyTrendData = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const session of categorized.deep) {
      const date = session.startTime.slice(0, 10);
      byDate.set(date, (byDate.get(date) ?? 0) + session.durationSeconds);
    }

    return Array.from(byDate.entries())
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([date, seconds]) => ({
        date: new Date(date + "T00:00").toLocaleDateString([], {
          month: "short",
          day: "numeric",
        }),
        minutes: Math.round(seconds / 60),
      }));
  }, [categorized.deep]);

  const distributionBar = useMemo(() => {
    if (stats.totalSessions === 0) return null;
    const deepPct = (categorized.deep.length / stats.totalSessions) * 100;
    const medPct = (categorized.medium.length / stats.totalSessions) * 100;
    const fragPct = (categorized.fragmented.length / stats.totalSessions) * 100;
    return { deepPct, medPct, fragPct };
  }, [categorized, stats.totalSessions]);

  if (validResult?.error) {
    return <Placeholder variant="error" title={validResult.error} />;
  }

  if (!validResult && !result) {
    return <Placeholder variant="loading" />;
  }

  if (sessions.length === 0) {
    return <Placeholder variant="empty" title={t("devActivity.noData")} />;
  }

  return (
    <>
      {/* Summary Cards */}
      <div
        className={`${DETAIL_PANEL_TOKENS.sectionGap} ${STAT_GRID_TOKENS.cols3}`}
      >
        <StatCard icon={Brain} label={t("devActivity.deepWorkPercent")}>
          {stats.deepPercent}%
        </StatCard>
        <StatCard icon={Clock} label={t("devActivity.totalDeepTime")}>
          {formatDuration(stats.deepTotalSeconds)}
        </StatCard>
        <StatCard icon={Flame} label={t("devActivity.avgDeepSession")}>
          {stats.avgDeepSession > 0
            ? formatDuration(stats.avgDeepSession)
            : "—"}
        </StatCard>
      </div>

      {/* Distribution Bar */}
      {distributionBar && (
        <CollapsibleSection title={t("devActivity.deepWork")}>
          <div className="rounded-lg bg-fill-2 p-4">
            <div className="flex h-4 w-full overflow-hidden rounded-full">
              {distributionBar.deepPct > 0 && (
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${distributionBar.deepPct}%`,
                    background: CATEGORY_COLORS.deep,
                  }}
                  title={`${t("devActivity.deepSessions")}: ${categorized.deep.length}`}
                />
              )}
              {distributionBar.medPct > 0 && (
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${distributionBar.medPct}%`,
                    background: CATEGORY_COLORS.medium,
                  }}
                  title={`${t("devActivity.mediumSessions")}: ${categorized.medium.length}`}
                />
              )}
              {distributionBar.fragPct > 0 && (
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${distributionBar.fragPct}%`,
                    background: CATEGORY_COLORS.fragmented,
                  }}
                  title={`${t("devActivity.fragmentedSessions")}: ${categorized.fragmented.length}`}
                />
              )}
            </div>
            <div className="mt-2 flex items-center gap-4 text-[11px] text-text-2">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded"
                  style={{ background: CATEGORY_COLORS.deep }}
                />
                {t("devActivity.deepSessions")} ({categorized.deep.length})
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded"
                  style={{ background: CATEGORY_COLORS.medium }}
                />
                {t("devActivity.mediumSessions")} ({categorized.medium.length})
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded"
                  style={{ background: CATEGORY_COLORS.fragmented }}
                />
                {t("devActivity.fragmentedSessions")} (
                {categorized.fragmented.length})
              </span>
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Best Hours */}
      {bestHours && (
        <div
          className={`${DETAIL_PANEL_TOKENS.sectionGap} flex items-center gap-2 text-[12px] text-text-2`}
        >
          <Clock size={13} className="text-text-2" />
          <span>
            {t("devActivity.bestHours")}:{" "}
            <strong className="text-text-1">{bestHours}</strong>
          </span>
        </div>
      )}

      {/* Daily Deep Work Trend */}
      {dailyTrendData.length > 1 && (
        <CollapsibleSection
          title={`${t("devActivity.deepWork")} — ${t("devActivity.productivityTrends")}`}
        >
          <div className="rounded-lg bg-fill-2 p-4">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={dailyTrendData} margin={CHART_MARGIN}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border-1)"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={CHART_AXIS_TICK}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={CHART_AXIS_TICK}
                  allowDecimals={false}
                  unit="m"
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      formatValue={(value) => `${value}m`}
                      formatName={() => t("devActivity.deepWork")}
                    />
                  }
                  cursor={false}
                />
                <Bar
                  dataKey="minutes"
                  fill="var(--color-primary-6)"
                  isAnimationActive={false}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CollapsibleSection>
      )}
    </>
  );
};

export default memo(DeepWorkAnalysis);
