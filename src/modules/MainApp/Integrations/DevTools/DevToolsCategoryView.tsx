import React, { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import TabPill from "@src/components/TabPill";
import {
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  InternalHeader,
  Placeholder,
  ScrollPreservation,
} from "@src/modules/shared/layouts/blocks";

import { ThirdPartyDisclaimer } from "../Tables/TrademarkDisclaimer";

const LanguageServersPage = lazy(() => import("./LanguageServersPage"));
const LintToolsPage = lazy(() => import("./LintToolsPage"));
const DependenciesPage = lazy(() => import("./DependenciesPage"));

const DEVTOOLS_TAB_KEYS = {
  LSP: "lsp",
  LINT: "lint",
  DEPS: "deps",
} as const;

type DevToolsTab = (typeof DEVTOOLS_TAB_KEYS)[keyof typeof DEVTOOLS_TAB_KEYS];

interface DevToolsCategoryViewProps {
  initialTab?: DevToolsTab;
}

const DevToolsCategoryView: React.FC<DevToolsCategoryViewProps> = ({
  initialTab,
}) => {
  const { t } = useTranslation("integrations");
  const [activeTab, setActiveTab] = useState<DevToolsTab>(
    initialTab ?? DEVTOOLS_TAB_KEYS.LSP
  );

  const depsRefreshRef = React.useRef<(() => Promise<void>) | null>(null);

  const handleTabChange = useCallback((key: string) => {
    setActiveTab(key as DevToolsTab);
  }, []);

  const tabs = useMemo(
    () => [
      { key: DEVTOOLS_TAB_KEYS.LSP, label: "LSP" },
      { key: DEVTOOLS_TAB_KEYS.LINT, label: "Lint" },
      {
        key: DEVTOOLS_TAB_KEYS.DEPS,
        label: t("settings:dependencies.dependenciesAndPackages"),
      },
    ],
    [t]
  );

  return (
    <DetailPanelContainer>
      <InternalHeader
        noPanelHeader
        contentPadding
        className={DETAIL_PANEL_TOKENS.headerWidth}
        tabs={
          <TabPill
            tabs={tabs}
            activeTab={activeTab}
            onChange={handleTabChange}
            variant="simple"
            fillWidth={false}
            size="large"
          />
        }
      />
      <ScrollPreservation className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
        <div className={DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop}>
          <div className="flex flex-col gap-3">
            <Suspense
              fallback={
                <Placeholder variant="loading" placement="detail-panel" />
              }
            >
              {activeTab === DEVTOOLS_TAB_KEYS.LSP && <LanguageServersPage />}
              {activeTab === DEVTOOLS_TAB_KEYS.LINT && <LintToolsPage />}
              {activeTab === DEVTOOLS_TAB_KEYS.DEPS && (
                <DependenciesPage refreshRef={depsRefreshRef} />
              )}
            </Suspense>
            <ThirdPartyDisclaimer />
          </div>
        </div>
      </ScrollPreservation>
    </DetailPanelContainer>
  );
};

export { DEVTOOLS_TAB_KEYS };
export type { DevToolsTab };
export default DevToolsCategoryView;
