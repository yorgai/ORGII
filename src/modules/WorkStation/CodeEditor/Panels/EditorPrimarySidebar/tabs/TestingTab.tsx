/**
 * TestingTab Configuration
 *
 * Defines the Testing tab structure with test explorer section.
 */
import { Filter as FilterIcon, Play, RefreshCw, Square } from "lucide-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useTestRunner } from "@src/hooks/testRunner";
import { useRefreshSpin } from "@src/hooks/ui";
import type { PrimarySidebarTab } from "@src/modules/WorkStation/shared";
import { getFrameworkLabel } from "@src/types/testing";

import { ICON_CONFIG, PANEL_CONSTANTS } from "../config";

export interface TestingTabConfigProps {
  testingPanelContent: React.ReactNode;
  repoPath: string;
  isActive: boolean;
  showFilter: boolean;
  onToggleFilter: () => void;
}

export function useTestingTabConfig({
  testingPanelContent,
  repoPath,
  isActive,
  showFilter,
  onToggleFilter,
}: TestingTabConfigProps): PrimarySidebarTab {
  const { t } = useTranslation();

  // Destructure icon components
  const TestingIcon = ICON_CONFIG.testing;

  // Get test runner state for actions
  const {
    framework,
    isRunning,
    isDiscovering,
    runAllTests,
    stopTests,
    discoverTests,
  } = useTestRunner({ repoPath, autoDiscover: true, isActive });

  // Get framework label (or "N/A" if no framework)
  const frameworkLabel =
    framework !== "unknown" ? getFrameworkLabel(framework) : "N/A";

  const { spinClass: refreshSpinClass, handleClick: handleRefreshClick } =
    useRefreshSpin(discoverTests, isDiscovering);

  return useMemo(
    () => ({
      key: "testing",
      label: t("tabs.testing"),
      icon: <TestingIcon size={PANEL_CONSTANTS.TAB_ICON_SIZE} />,
      sections: [
        {
          key: "test-explorer",
          title: (
            <>
              {t("labels.testExplorer")}
              <span className="ml-2 text-[11px] font-normal normal-case text-text-3">
                {frameworkLabel}
              </span>
            </>
          ),
          content: testingPanelContent,
          defaultFlexGrow: 1,
          resizable: false,
          actions: [
            {
              key: "filter-tests",
              icon: (
                <FilterIcon
                  size={14}
                  className={showFilter ? "text-primary-6" : ""}
                />
              ),
              tooltip: t("actions.filter"),
              onClick: onToggleFilter,
            },
            {
              key: "refresh-tests",
              icon: <RefreshCw size={14} className={refreshSpinClass} />,
              tooltip: "Refresh Tests",
              onClick: handleRefreshClick,
            },
            {
              key: "run-stop-tests",
              icon: isRunning ? <Square size={14} /> : <Play size={14} />,
              tooltip: isRunning ? "Stop Tests" : "Run All Tests",
              onClick: () => {
                if (isRunning) {
                  stopTests();
                } else {
                  runAllTests();
                }
              },
            },
          ],
        },
      ],
    }),
    [
      testingPanelContent,
      TestingIcon,
      frameworkLabel,
      refreshSpinClass,
      handleRefreshClick,
      showFilter,
      onToggleFilter,
      isRunning,
      runAllTests,
      stopTests,
      t,
    ]
  );
}
