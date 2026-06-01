/**
 * RamHistoryChart — 30-minute rolling RAM usage timeline.
 *
 * Uses Recharts AreaChart to visualize memory over time,
 * with reference lines for min/max and stat badges.
 */
import { ArrowDown, ArrowUp, MemoryStick, TrendingUp } from "lucide-react";
import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import {
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
  CHART_MARGIN,
} from "@src/components/Chart";
import type { RamHistoryStats } from "@src/hooks/perf";

interface ChartDataPoint {
  label: string;
  minutesAgo: number;
  totalMb: number;
}

function formatMemory(megabytes: number): string {
  if (megabytes >= 1024) {
    return (megabytes / 1024).toFixed(2) + " GB";
  }
  return megabytes.toFixed(1) + " MB";
}

interface RamHistoryChartProps {
  stats: RamHistoryStats;
}

const STAT_ITEMS = [
  { key: "current", icon: MemoryStick, color: "text-primary-6" },
  { key: "min", icon: ArrowDown, color: "text-green-500" },
  { key: "max", icon: ArrowUp, color: "text-red-500" },
  { key: "avg", icon: TrendingUp, color: "text-text-2" },
] as const;

const RamHistoryChart: React.FC<RamHistoryChartProps> = ({ stats }) => {
  const { t } = useTranslation("settings");

  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (stats.samples.length === 0) return [];

    const now = stats.samples[stats.samples.length - 1].timestamp;

    return stats.samples.map((sample) => {
      const minutesAgo = (now - sample.timestamp) / 60_000;
      const label =
        minutesAgo < 1
          ? t("monitor.timeNow")
          : t("monitor.timeMinutesShort", {
              count: Math.round(minutesAgo),
            });
      return {
        label,
        minutesAgo: -minutesAgo,
        totalMb: Math.round(sample.totalMb * 10) / 10,
      };
    });
  }, [stats.samples, t]);

  const statValues = useMemo(
    () => ({
      current: formatMemory(stats.currentMb),
      min: formatMemory(stats.minMb),
      max: formatMemory(stats.maxMb),
      avg: formatMemory(stats.avgMb),
    }),
    [stats.currentMb, stats.minMb, stats.maxMb, stats.avgMb]
  );

  const statLabels = useMemo(
    () => ({
      current: t("monitor.ramCurrent"),
      min: t("monitor.ramMin"),
      max: t("monitor.ramMax"),
      avg: t("monitor.ramAvg"),
    }),
    [t]
  );

  const yDomain = useMemo<[number, number]>(() => {
    if (stats.samples.length === 0) return [0, 100];
    const padding = Math.max((stats.maxMb - stats.minMb) * 0.15, 10);
    return [
      Math.max(0, Math.floor(stats.minMb - padding)),
      Math.ceil(stats.maxMb + padding),
    ];
  }, [stats.minMb, stats.maxMb, stats.samples.length]);

  if (stats.samples.length < 2) {
    return (
      <div className="flex h-[180px] items-center justify-center text-xs text-text-3">
        {t("monitor.collectingData")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        {STAT_ITEMS.map(({ key, icon: Icon, color }) => (
          <div key={key} className="flex items-center gap-1.5 text-xs">
            <Icon size={13} className={color} />
            <span className="text-text-2">{statLabels[key]}</span>
            <span className="tabular-nums text-text-1">{statValues[key]}</span>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={chartData} margin={CHART_MARGIN}>
          <defs>
            <linearGradient id="ramGradient" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="var(--color-primary-6)"
                stopOpacity={0.3}
              />
              <stop
                offset="95%"
                stopColor="var(--color-primary-6)"
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={CHART_GRID_STROKE}
            vertical={false}
          />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={CHART_AXIS_TICK}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={CHART_AXIS_TICK}
            domain={yDomain}
            unit=" MB"
            width={65}
          />
          {stats.minMb > 0 && (
            <ReferenceLine
              y={Math.round(stats.minMb * 10) / 10}
              stroke="var(--color-success-6)"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
          )}
          {stats.maxMb > 0 && (
            <ReferenceLine
              y={Math.round(stats.maxMb * 10) / 10}
              stroke="var(--color-danger-6)"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
          )}
          <Area
            type="monotone"
            dataKey="totalMb"
            stroke="var(--color-primary-6)"
            strokeWidth={1.5}
            fill="url(#ramGradient)"
            isAnimationActive={false}
            dot={false}
            activeDot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default memo(RamHistoryChart);
