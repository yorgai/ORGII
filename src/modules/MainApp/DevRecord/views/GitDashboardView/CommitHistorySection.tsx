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

import {
  CHART_AXIS_TICK,
  CHART_MARGIN,
  ChartTooltip,
  MultiLineChart,
} from "@src/components/Chart";
import type { TabPillItem } from "@src/components/TabPill";
import TabPill from "@src/components/TabPill";
import {
  COLLAPSIBLE_SECTION_TOKENS,
  CollapsibleSection,
} from "@src/modules/shared/layouts/blocks";

import CommitDotGraph from "./CommitDotGraph";
import ContributorFilter from "./ContributorFilter";
import HourlyAxisTick from "./HourlyAxisTick";
import { CHART_HEIGHT, OTHER_CHART_COLOR } from "./config";
import type { DotGraphDataResult } from "./dataBuilders";
import type { DailyCommitData, DashboardViewMode } from "./types";

export interface CommitHistorySectionProps {
  viewMode: DashboardViewMode;
  viewModeOptions: TabPillItem[];
  onViewModeChange: (tab: string) => void;
  showAuthorBreakdown: boolean;
  showContributorFilter: boolean;
  allContributorNames: string[];
  selectedContributors: Set<string>;
  onContributorsChange: (selected: Set<string>) => void;
  authorColorMap: Map<string, string>;
  days: number;
  chartData: DailyCommitData[];
  chartDataForRender: DailyCommitData[];
  filteredAuthors: string[];
  chartColorMap: Map<string, string>;
  hasOtherBucket: boolean;
  dotGraphData: DotGraphDataResult | null;
}

export function CommitHistorySection({
  viewMode,
  viewModeOptions,
  onViewModeChange,
  showAuthorBreakdown,
  showContributorFilter,
  allContributorNames,
  selectedContributors,
  onContributorsChange,
  authorColorMap,
  days,
  chartData,
  chartDataForRender,
  filteredAuthors,
  chartColorMap,
  hasOtherBucket,
  dotGraphData,
}: CommitHistorySectionProps) {
  const { t } = useTranslation();

  return (
    <CollapsibleSection
      title={t("gitDashboard.commitActivity")}
      actions={
        <>
          <TabPill
            tabs={viewModeOptions}
            activeTab={viewMode}
            onChange={onViewModeChange}
            variant="pill"
            fillWidth={false}
            size="small"
          />
          {showContributorFilter && (
            <>
              <div className={COLLAPSIBLE_SECTION_TOKENS.separator} />
              <ContributorFilter
                contributors={allContributorNames}
                selected={selectedContributors}
                onSelectionChange={onContributorsChange}
                colorMap={authorColorMap}
              />
            </>
          )}
        </>
      }
    >
      <div className="rounded-lg bg-fill-2 p-4">
        {viewMode === "line" ? (
          <MultiLineChart
            data={chartDataForRender}
            series={showAuthorBreakdown ? filteredAuthors : ["total"]}
            colorMap={chartColorMap}
            height={CHART_HEIGHT}
            showLegend={showAuthorBreakdown && filteredAuthors.length > 0}
          />
        ) : viewMode === "chart" ? (
          <>
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart
                data={chartDataForRender}
                barCategoryGap="8%"
                margin={
                  days <= 3 && days > 1
                    ? { ...CHART_MARGIN, bottom: 24 }
                    : CHART_MARGIN
                }
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border-1)"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={
                    days <= 3 && days > 1 ? (
                      <HourlyAxisTick data={chartData} />
                    ) : (
                      CHART_AXIS_TICK
                    )
                  }
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={CHART_AXIS_TICK}
                  allowDecimals={false}
                  width={30}
                />
                <Tooltip content={<ChartTooltip />} cursor={false} />
                {showAuthorBreakdown ? (
                  filteredAuthors.map((author) => (
                    <Bar
                      key={author}
                      dataKey={author}
                      stackId="commits"
                      fill={chartColorMap.get(author)}
                      isAnimationActive={false}
                    />
                  ))
                ) : (
                  <Bar
                    dataKey="total"
                    fill="var(--color-primary-6)"
                    isAnimationActive={false}
                  />
                )}
                {hasOtherBucket && (
                  <Bar
                    dataKey="Other"
                    name={t("gitDashboard.other")}
                    stackId="commits"
                    fill={OTHER_CHART_COLOR}
                    isAnimationActive={false}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>

            {showAuthorBreakdown && filteredAuthors.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-start gap-2">
                {filteredAuthors.map((author) => (
                  <div key={author} className="flex items-center gap-1.5">
                    <div
                      className="h-2.5 w-2.5 rounded"
                      style={{
                        background: chartColorMap.get(author),
                      }}
                    />
                    <span className="text-[10px] text-text-2">{author}</span>
                  </div>
                ))}
                {hasOtherBucket && (
                  <div className="flex items-center gap-1.5">
                    <div
                      className="h-2.5 w-2.5 rounded"
                      style={{ background: OTHER_CHART_COLOR }}
                    />
                    <span className="text-[10px] text-text-2">
                      {t("gitDashboard.other")}
                    </span>
                  </div>
                )}
              </div>
            )}
          </>
        ) : dotGraphData ? (
          <div className="overflow-x-auto scrollbar-hide">
            <CommitDotGraph data={dotGraphData} />
          </div>
        ) : null}
      </div>
    </CollapsibleSection>
  );
}
