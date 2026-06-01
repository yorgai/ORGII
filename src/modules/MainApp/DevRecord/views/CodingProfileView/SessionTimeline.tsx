/**
 * SessionTimeline — Day-by-day visual timeline of coding sessions.
 *
 * Y-axis: dates (one row per day, max 14 days)
 * X-axis: hours 0–24
 * Each session renders as a horizontal bar spanning startTime → endTime.
 * Bar color encodes the IDE source using IDE_COLORS.
 * Sessions spanning midnight are split into two bars.
 */
import React, { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getDevRecordSessions } from "@src/api/tauri/devRecord";
import type { CodingSession } from "@src/api/tauri/devRecord/types";
import {
  CollapsibleSection,
  Placeholder,
} from "@src/modules/shared/layouts/blocks";

import {
  type FetchResult,
  IDE_COLORS,
  formatDuration,
  formatSourceLabel,
} from "./config";

const MAX_TIMELINE_DAYS = 14;
const HOUR_COUNT = 24;
const ROW_HEIGHT = 28;
const LABEL_WIDTH = 64;

interface TimelineBar {
  date: string;
  startHourFrac: number;
  endHourFrac: number;
  source: string;
  workspacePath: string | null;
  durationSeconds: number;
}

function sessionToTimelineBars(session: CodingSession): TimelineBar[] {
  const start = new Date(session.startTime);
  const end = session.endTime
    ? new Date(session.endTime)
    : new Date(start.getTime() + session.durationSeconds * 1000);

  if (end <= start) return [];

  const bars: TimelineBar[] = [];
  const currentDay = new Date(start);
  currentDay.setHours(0, 0, 0, 0);

  while (currentDay <= end) {
    const dayStr = currentDay.toISOString().slice(0, 10);
    const dayStart = currentDay.getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;

    const barStart = Math.max(start.getTime(), dayStart);
    const barEnd = Math.min(end.getTime(), dayEnd);

    if (barEnd > barStart) {
      const startHourFrac = (barStart - dayStart) / (60 * 60 * 1000);
      const endHourFrac = (barEnd - dayStart) / (60 * 60 * 1000);

      bars.push({
        date: dayStr,
        startHourFrac,
        endHourFrac: Math.min(endHourFrac, 24),
        source: session.source,
        workspacePath: session.workspacePath,
        durationSeconds: Math.round((barEnd - barStart) / 1000),
      });
    }

    currentDay.setDate(currentDay.getDate() + 1);
  }

  return bars;
}

function buildSourceColorMap(sources: string[]): Map<string, string> {
  const colorMap = new Map<string, string>();
  for (let idx = 0; idx < sources.length; idx++) {
    colorMap.set(sources[idx], IDE_COLORS[idx % IDE_COLORS.length]);
  }
  return colorMap;
}

const HOUR_TICKS = [0, 4, 8, 12, 16, 20, 24];
const HOUR_TICK_LABELS = ["0", "4", "8", "12", "16", "20", "24"];

interface SessionTimelineProps {
  startDate: string;
  endDate: string;
  refreshKey: number;
}

const SessionTimeline: React.FC<SessionTimelineProps> = ({
  startDate,
  endDate,
  refreshKey,
}) => {
  const { t } = useTranslation();
  const fetchKey = `timeline:${startDate}:${endDate}:${refreshKey}`;

  const [result, setResult] = useState<FetchResult<CodingSession[]> | null>(
    null
  );
  const validResult = result?.key === fetchKey ? result : null;

  useEffect(() => {
    const effectKey = `timeline:${startDate}:${endDate}:${refreshKey}`;
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

  const { dates, barsByDate, sources, sourceColors } = useMemo(() => {
    const allBars: TimelineBar[] = [];
    const sourceSet = new Set<string>();

    for (const session of sessions) {
      const bars = sessionToTimelineBars(session);
      for (const bar of bars) {
        allBars.push(bar);
        sourceSet.add(bar.source);
      }
    }

    const dateSet = new Set(allBars.map((bar) => bar.date));
    const sortedDates = Array.from(dateSet)
      .sort((dateA, dateB) => dateB.localeCompare(dateA))
      .slice(0, MAX_TIMELINE_DAYS);

    const groupedByDate = new Map<string, TimelineBar[]>();
    for (const bar of allBars) {
      if (!sortedDates.includes(bar.date)) continue;
      const existing = groupedByDate.get(bar.date);
      if (existing) {
        existing.push(bar);
      } else {
        groupedByDate.set(bar.date, [bar]);
      }
    }

    const sourceList = Array.from(sourceSet);

    return {
      dates: sortedDates,
      barsByDate: groupedByDate,
      sources: sourceList,
      sourceColors: buildSourceColorMap(sourceList),
    };
  }, [sessions]);

  if (validResult?.error) {
    return <Placeholder variant="error" title={validResult.error} />;
  }

  if (!validResult && !result) {
    return <Placeholder variant="loading" />;
  }

  if (dates.length === 0) return null;

  const gridWidth = `calc(100% - ${LABEL_WIDTH}px)`;

  return (
    <CollapsibleSection title={t("devActivity.sessionTimeline")}>
      <div className="overflow-x-auto rounded-lg bg-fill-2 p-4">
        {/* Hour axis */}
        <div className="flex" style={{ paddingLeft: LABEL_WIDTH }}>
          <div className="relative w-full" style={{ height: 18 }}>
            {HOUR_TICKS.map((hour, idx) => (
              <span
                key={hour}
                className="absolute text-[10px] text-text-2"
                style={{
                  left: `${(hour / HOUR_COUNT) * 100}%`,
                  transform: "translateX(-50%)",
                }}
              >
                {HOUR_TICK_LABELS[idx]}
              </span>
            ))}
          </div>
        </div>

        {/* Day rows */}
        {dates.map((date) => {
          const bars = barsByDate.get(date) ?? [];
          const dateLabel = new Date(date + "T00:00").toLocaleDateString([], {
            month: "short",
            day: "numeric",
            weekday: "short",
          });

          return (
            <div
              key={date}
              className="flex items-center"
              style={{ height: ROW_HEIGHT }}
            >
              <span
                className="shrink-0 text-[10px] tabular-nums text-text-2"
                style={{ width: LABEL_WIDTH }}
              >
                {dateLabel}
              </span>
              <div
                className="relative h-3 rounded-sm"
                style={{
                  width: gridWidth,
                  background: "var(--color-fill-1)",
                }}
              >
                {bars.map((bar, idx) => {
                  const leftPct = (bar.startHourFrac / HOUR_COUNT) * 100;
                  const widthPct =
                    ((bar.endHourFrac - bar.startHourFrac) / HOUR_COUNT) * 100;
                  const color = sourceColors.get(bar.source) ?? IDE_COLORS[0];

                  return (
                    <div
                      key={idx}
                      className="absolute top-0 h-full rounded-sm opacity-80 transition-opacity hover:opacity-100"
                      style={{
                        left: `${leftPct}%`,
                        width: `${Math.max(widthPct, 0.3)}%`,
                        background: color,
                      }}
                      title={[
                        bar.workspacePath ?? "—",
                        formatSourceLabel(bar.source),
                        formatDuration(bar.durationSeconds),
                        `${Math.floor(bar.startHourFrac)}:${String(Math.round((bar.startHourFrac % 1) * 60)).padStart(2, "0")} – ${Math.floor(bar.endHourFrac)}:${String(Math.round((bar.endHourFrac % 1) * 60)).padStart(2, "0")}`,
                      ].join(" · ")}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Source legend */}
        {sources.length > 0 && (
          <div
            className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-text-2"
            style={{ paddingLeft: LABEL_WIDTH }}
          >
            {sources.map((source) => (
              <span key={source} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded"
                  style={{
                    background: sourceColors.get(source) ?? IDE_COLORS[0],
                  }}
                />
                {formatSourceLabel(source)}
              </span>
            ))}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
};

export default memo(SessionTimeline);
