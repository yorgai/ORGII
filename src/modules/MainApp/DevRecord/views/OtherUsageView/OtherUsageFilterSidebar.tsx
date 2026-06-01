/**
 * OtherUsageFilterSidebar — Right filter panel for Other Usage.
 *
 * Sections: Date Range, Model.
 * Follows the same layout as UsageHistoryFilterSidebar.
 */
import { BarChart3 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import DatePicker from "@src/components/DatePicker";
import ModelIcon from "@src/components/ModelIcon";
import { HEADER_CLASSES } from "@src/config/workstation/tokens";
import { DETAIL_PANEL_TOKENS } from "@src/modules/shared/layouts/blocks";

import {
  DATE_RANGE_OPTIONS,
  formatModelNameFull,
} from "../CodingProfileView/config";
import type { ProfileDateRange } from "../CodingProfileView/config";

const SECTION_CLASS = "mb-4";
const SECTION_TITLE_CLASS = "mb-2 px-1 text-[12px] font-medium text-text-2";

const ITEM_BASE =
  "flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-[12px] transition-colors";
const ITEM_ACTIVE = `${ITEM_BASE} bg-fill-2 text-text-1`;
const ITEM_INACTIVE = `${ITEM_BASE} text-text-2 hover:bg-fill-2`;

interface ModelStat {
  model: string;
  count: number;
}

interface OtherUsageFilterSidebarProps {
  dateRange: ProfileDateRange;
  onDateRangeChange: (range: ProfileDateRange) => void;
  customStartDate?: string;
  customEndDate?: string;
  onCustomDatesChange?: (startDate: string, endDate: string) => void;

  selectedModel: string | null;
  onModelChange: (model: string | null) => void;
  modelStats: ModelStat[];

  onReset: () => void;
}

const RANGE_PILL_BASE =
  "flex items-center justify-center rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors cursor-pointer";
const RANGE_PILL_ACTIVE = `${RANGE_PILL_BASE} bg-fill-2 text-text-1`;
const RANGE_PILL_INACTIVE = `${RANGE_PILL_BASE} text-text-3 hover:bg-fill-2 hover:text-text-2`;

const OtherUsageFilterSidebar: React.FC<OtherUsageFilterSidebarProps> = ({
  dateRange,
  onDateRangeChange,
  customStartDate,
  customEndDate,
  onCustomDatesChange,
  selectedModel,
  onModelChange,
  modelStats,
  onReset,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex h-full w-[280px] min-w-[250px] max-w-[300px] shrink-0 flex-col border-l border-border-2 bg-bg-2">
      <div className={HEADER_CLASSES.sectionTitle}>
        <span className="text-[13px] font-medium text-text-1">
          {t("common:labels.filters")}
        </span>
        <button
          type="button"
          className="ml-auto rounded px-1.5 py-0.5 text-[12px] text-text-2 transition-colors hover:bg-fill-2 hover:text-text-1"
          onClick={onReset}
        >
          {t("common:actions.reset")}
        </button>
      </div>

      <div className={DETAIL_PANEL_TOKENS.scrollContent}>
        {/* Date Range Filter — 3-column grid */}
        <div className={SECTION_CLASS}>
          <div className={SECTION_TITLE_CLASS}>
            {t("common:filters.dateRange")}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {DATE_RANGE_OPTIONS.filter((opt) => opt.key !== "custom").map(
              (opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={
                    dateRange === opt.key
                      ? RANGE_PILL_ACTIVE
                      : RANGE_PILL_INACTIVE
                  }
                  onClick={() => onDateRangeChange(opt.key as ProfileDateRange)}
                >
                  {opt.label}
                </button>
              )
            )}
            <button
              type="button"
              className={
                dateRange === "custom" ? RANGE_PILL_ACTIVE : RANGE_PILL_INACTIVE
              }
              onClick={() => onDateRangeChange("custom")}
            >
              {t("common:filters.custom")}
            </button>
          </div>

          {dateRange === "custom" && onCustomDatesChange && (
            <div className="mt-2">
              <DatePicker.RangePicker
                value={[
                  customStartDate ? new Date(customStartDate) : null,
                  customEndDate ? new Date(customEndDate) : null,
                ]}
                onChange={(dates) => {
                  if (dates) {
                    const start = dates[0]
                      ? dates[0].toISOString().slice(0, 10)
                      : "";
                    const end = dates[1]
                      ? dates[1].toISOString().slice(0, 10)
                      : "";
                    onCustomDatesChange(start, end);
                  }
                }}
                size="small"
              />
            </div>
          )}
        </div>

        {/* Model Filter */}
        {modelStats.length > 0 && (
          <div className={SECTION_CLASS}>
            <div className={SECTION_TITLE_CLASS}>
              {t("common:filters.model")}
            </div>

            <button
              type="button"
              className={selectedModel === null ? ITEM_ACTIVE : ITEM_INACTIVE}
              onClick={() => onModelChange(null)}
            >
              <div className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded bg-primary-6/20">
                <BarChart3 size={12} className="text-primary-6" />
              </div>
              <span className="min-w-0 flex-1 truncate font-medium">
                {t("common:filters.sourceAll")}
              </span>
              <span className="flex-shrink-0 text-[11px] text-text-2">
                {modelStats.reduce((sum, stat) => sum + stat.count, 0)}
              </span>
            </button>

            {modelStats.map((stat) => {
              const display = formatModelNameFull(stat.model);
              const isActive = selectedModel === stat.model;
              return (
                <button
                  key={stat.model}
                  type="button"
                  className={isActive ? ITEM_ACTIVE : ITEM_INACTIVE}
                  onClick={() => onModelChange(stat.model)}
                >
                  <ModelIcon modelName={stat.model} size="small" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {display}
                  </span>
                  <span className="flex-shrink-0 text-[11px] text-text-2">
                    {stat.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default OtherUsageFilterSidebar;
