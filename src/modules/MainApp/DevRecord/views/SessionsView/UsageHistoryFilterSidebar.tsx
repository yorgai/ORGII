/**
 * UsageHistoryFilterSidebar — Right filter panel for Usage History.
 *
 * Follows the same pattern as FilterSidebar in Models Properties.
 * Provides source filter (All/Local/Pooling), provider list,
 * and a reset button.
 */
import { BarChart3 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import { formatAgentType } from "@src/assets/providers";
import DatePicker from "@src/components/DatePicker";
import ModelIcon from "@src/components/ModelIcon";
import { HEADER_CLASSES } from "@src/config/workstation/tokens";
import { DETAIL_PANEL_TOKENS } from "@src/modules/shared/layouts/blocks";

import {
  DATE_RANGE_OPTIONS,
  DEFAULT_RANGE,
  type ProfileDateRange,
} from "../CodingProfileView/config";
import {
  USAGE_SOURCE,
  type UsageHistoryFilters,
  type UsageSource,
} from "./utils";

type UsageHistoryFilterVariant = "sidebar" | "inline";

interface UsageHistoryFilterSidebarProps {
  filters: UsageHistoryFilters;
  onChange: (filters: UsageHistoryFilters) => void;
  providers: string[];
  providerStats: Record<
    string,
    { totalSpend: number; totalTokens: number; usageCount: number }
  >;
  variant?: UsageHistoryFilterVariant;
  hideSourceFilter?: boolean;
  onDateRangeChange?: (range: ProfileDateRange) => void;
  customStartDate?: string;
  customEndDate?: string;
  onCustomDatesChange?: (startDate: string, endDate: string) => void;
}

const RANGE_PILL_BASE =
  "flex items-center justify-center rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors cursor-pointer";
const RANGE_PILL_ACTIVE = `${RANGE_PILL_BASE} bg-fill-2 text-text-1`;
const RANGE_PILL_INACTIVE = `${RANGE_PILL_BASE} text-text-3 hover:bg-fill-2 hover:text-text-2`;

const SECTION_CLASS = "mb-4";
const SECTION_TITLE_CLASS = "mb-2 px-1 text-[12px] font-medium text-text-2";

const SOURCE_OPTIONS: { value: "all" | UsageSource; labelKey: string }[] = [
  { value: "all", labelKey: "common:filters.sourceAll" },
  { value: USAGE_SOURCE.LOCAL, labelKey: "common:filters.myKeys" },
  { value: USAGE_SOURCE.POOLING, labelKey: "common:filters.hostedKeys" },
];

const UsageHistoryFilterSidebar: React.FC<UsageHistoryFilterSidebarProps> = ({
  filters,
  onChange,
  providers,
  providerStats,
  variant = "sidebar",
  hideSourceFilter = false,
  onDateRangeChange,
  customStartDate,
  customEndDate,
  onCustomDatesChange,
}) => {
  const { t } = useTranslation();

  const handleReset = () => {
    onChange({
      source: "all",
      selectedProvider: null,
      dateRange: DEFAULT_RANGE,
    });
    onDateRangeChange?.(DEFAULT_RANGE);
  };

  const isInline = variant === "inline";
  const wrapperClass = isInline
    ? "flex w-full flex-col rounded-lg bg-fill-2 p-4"
    : "flex h-full w-[280px] min-w-[250px] max-w-[300px] shrink-0 flex-col border-l border-border-2 bg-bg-2";

  return (
    <div className={wrapperClass}>
      <div className={HEADER_CLASSES.sectionTitle}>
        <span className="text-[13px] font-medium text-text-1">
          {t("common:labels.filters")}
        </span>
        <button
          type="button"
          className="ml-auto rounded px-1.5 py-0.5 text-[12px] text-text-2 transition-colors hover:bg-fill-2 hover:text-text-1"
          onClick={handleReset}
        >
          {t("common:actions.reset")}
        </button>
      </div>

      <div
        className={
          isInline ? "flex flex-col" : DETAIL_PANEL_TOKENS.scrollContent
        }
      >
        {/* Date Range Filter — 3-column grid */}
        {onDateRangeChange && (
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
                      filters.dateRange === opt.key
                        ? RANGE_PILL_ACTIVE
                        : RANGE_PILL_INACTIVE
                    }
                    onClick={() =>
                      onDateRangeChange(opt.key as ProfileDateRange)
                    }
                  >
                    {opt.label}
                  </button>
                )
              )}
              <button
                type="button"
                className={
                  filters.dateRange === "custom"
                    ? RANGE_PILL_ACTIVE
                    : RANGE_PILL_INACTIVE
                }
                onClick={() => onDateRangeChange("custom")}
              >
                {t("common:filters.custom")}
              </button>
            </div>

            {filters.dateRange === "custom" && onCustomDatesChange && (
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
        )}

        {/* Source Filter */}
        {!hideSourceFilter && (
          <div className={SECTION_CLASS}>
            <div className={SECTION_TITLE_CLASS}>
              {t("common:filters.source")}
            </div>
            {SOURCE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[12px] text-text-2 hover:bg-fill-2"
              >
                <input
                  type="radio"
                  name="source"
                  checked={filters.source === opt.value}
                  onChange={() =>
                    onChange({
                      ...filters,
                      source: opt.value,
                      selectedProvider: null,
                    })
                  }
                  className="h-3.5 w-3.5 border-border-2 text-primary-6 accent-[var(--color-primary-6)]"
                />
                <span>{t(opt.labelKey)}</span>
              </label>
            ))}
          </div>
        )}

        {/* Provider List */}
        <div className={SECTION_CLASS}>
          <div className={SECTION_TITLE_CLASS}>
            {t("market:models.providers")}
          </div>

          {/* All Models */}
          <button
            type="button"
            className={`flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-[12px] transition-colors ${
              filters.selectedProvider === null
                ? "bg-fill-2 text-text-1"
                : "text-text-2 hover:bg-fill-2"
            }`}
            onClick={() => onChange({ ...filters, selectedProvider: null })}
          >
            <div className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded bg-primary-6/20">
              <BarChart3 size={12} className="text-primary-6" />
            </div>
            <span className="min-w-0 flex-1 truncate font-medium">
              {t("market:usageHistory.allModels")}
            </span>
            <span className="flex-shrink-0 text-[11px] text-text-2">
              {providerStats["all"]?.usageCount || 0}{" "}
              {t("market:usageHistory.uses")}
            </span>
          </button>

          {providers.map((provider) => {
            const stats = providerStats[provider];
            const isActive = filters.selectedProvider === provider;
            return (
              <button
                key={provider}
                type="button"
                className={`flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-[12px] transition-colors ${
                  isActive
                    ? "bg-fill-2 text-text-1"
                    : "text-text-2 hover:bg-fill-2"
                }`}
                onClick={() =>
                  onChange({ ...filters, selectedProvider: provider })
                }
              >
                <ModelIcon
                  agentType={provider}
                  size={18}
                  className="flex-shrink-0"
                />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {formatAgentType(provider)}
                </span>
                <span className="flex-shrink-0 text-[11px] text-text-2">
                  {stats?.usageCount || 0} {t("market:usageHistory.uses")}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default UsageHistoryFilterSidebar;
