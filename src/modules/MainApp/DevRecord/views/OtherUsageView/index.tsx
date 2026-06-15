/**
 * OtherUsageView — Other usage analytics dashboard with tabbed layout.
 *
 * Tab-based layout matching Dev Activity's TabPill pattern:
 *  - Overview: model breakdown, lines by model (Cursor session analytics)
 *  - Cursor: Cursor IDE session details
 *  - CLI: Claude Code + other CLI tool sessions
 *
 * Each tab lazy-mounts on first visit, stays mounted (CSS hidden) to preserve cache.
 */
import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { TabPillItem } from "@src/components/TabPill";
import TabPill from "@src/components/TabPill";
import {
  DETAIL_PANEL_TOKENS,
  InternalHeader,
  Placeholder,
  ScrollFadeContainer,
} from "@src/modules/shared/layouts/blocks";

import DateRangePill from "../../components/DateRangePill";
import {
  useRegisterFilterToggle,
  useRegisterRefresh,
} from "../../hooks/useRegisterRefresh";
import type { ProfileDateRange } from "../CodingProfileView/config";
import CliSessionsPanel from "./CliSessionsPanel";
import CursorSessionsPanel from "./CursorSessionsPanel";
import OtherUsageFilterSidebar from "./OtherUsageFilterSidebar";
import OverviewTab from "./OverviewTab";
import { OTHER_USAGE_TABS } from "./config";
import { useOtherUsageData } from "./useOtherUsageData";

const OtherUsageView: React.FC = () => {
  const { t } = useTranslation();
  const state = useOtherUsageData();

  useRegisterRefresh(
    "other-usage",
    state.handleRefreshAction,
    state.isInitialLoad
  );

  const handleToggleFilter = useCallback(() => {
    state.setIsFilterSidebarVisible((prev) => !prev);
  }, [state]);

  useRegisterFilterToggle(
    "other-usage",
    state.isFilterSidebarVisible,
    handleToggleFilter
  );

  const contentTabOptions = useMemo<TabPillItem[]>(
    () =>
      OTHER_USAGE_TABS.map((tab) => ({ key: tab.key, label: t(tab.labelKey) })),
    [t]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <InternalHeader
        noPanelHeader
        contentPadding
        className={DETAIL_PANEL_TOKENS.headerWidth}
        actions={
          !state.isFilterSidebarVisible ? (
            <DateRangePill
              options={state.dateRangeOptions}
              activeKey={state.range}
              onChange={(key) => state.setRange(key as ProfileDateRange)}
              onCustomDatesChange={(startDate, endDate) =>
                state.setCustomDates({ startDate, endDate })
              }
              customStartDate={state.customDates?.startDate}
              customEndDate={state.customDates?.endDate}
            />
          ) : undefined
        }
        tabs={
          <TabPill
            tabs={contentTabOptions}
            activeTab={state.activeTab}
            onChange={state.handleTabChange}
            variant="simple"
            fillWidth={false}
            size="large"
          />
        }
      />

      <div className="flex min-h-0 flex-1">
        <ScrollFadeContainer className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
          <div className={DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop}>
            {state.fetchError && (
              <Placeholder
                variant="error"
                placement="detail-panel"
                title={state.fetchError}
                onRetry={state.handleRefreshAction}
              />
            )}

            {state.visitedTabs.has("overview") && (
              <div
                className={
                  state.activeTab !== "overview" ? "hidden" : undefined
                }
              >
                <OverviewTab
                  sessions={state.sessions}
                  modelStats={state.modelStats}
                  modelChartData={state.modelChartData}
                  modelNameMap={state.modelNameMap}
                  modelBreakdownView={state.modelBreakdownView}
                  onModelBreakdownViewChange={state.setModelBreakdownView}
                  loading={state.isInitialLoad}
                />
              </div>
            )}

            {state.visitedTabs.has("cursor") && (
              <div
                className={state.activeTab !== "cursor" ? "hidden" : undefined}
              >
                <CursorSessionsPanel
                  startDate={state.dateRange.startDate}
                  endDate={state.dateRange.endDate}
                  refreshKey={state.refreshCounter}
                />
              </div>
            )}

            {state.visitedTabs.has("cli") && (
              <div className={state.activeTab !== "cli" ? "hidden" : undefined}>
                <CliSessionsPanel
                  startDate={state.dateRange.startDate}
                  endDate={state.dateRange.endDate}
                  refreshKey={state.refreshCounter}
                />
              </div>
            )}
          </div>
        </ScrollFadeContainer>

        {state.isFilterSidebarVisible && (
          <OtherUsageFilterSidebar
            dateRange={state.range}
            onDateRangeChange={state.setRange}
            customStartDate={state.customDates?.startDate}
            customEndDate={state.customDates?.endDate}
            onCustomDatesChange={(startDate, endDate) =>
              state.setCustomDates({ startDate, endDate })
            }
            selectedModel={state.selectedModel}
            onModelChange={state.setSelectedModel}
            modelStats={state.sidebarModelStats}
            onReset={state.handleFilterReset}
          />
        )}
      </div>
    </div>
  );
};

export default memo(OtherUsageView);
