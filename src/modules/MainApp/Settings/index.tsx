/**
 * Settings Page
 *
 * App settings: left panel section list, right panel active section (or subpage).
 */
import { ResponsiveContainer } from "@/src/modules/shared/layouts/NarrowPlaceholder";
import {
  DETAIL_PANEL_TOKENS,
  InternalHeader,
  Placeholder,
  ScrollFadeContainer,
} from "@/src/modules/shared/layouts/blocks";
import { useAtomValue, useSetAtom } from "jotai";
import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import Message from "@src/components/Message";
import TabPill, { type TabPillItem } from "@src/components/TabPill";
import {
  type SettingsSectionSegment,
  type SettingsSubpageSegment,
  buildSettingsPath,
  getDefaultSettingsSectionTab,
  parseCoreSettingsItem,
  parseSettingsPath,
  parseSettingsSectionTab,
} from "@src/config/mainAppPaths";
import { assertSettingsUiParity } from "@src/config/settingsSchema/assertSettingsUiParity";
import { getSettingsSectionById } from "@src/config/settingsUiManifest";
import {
  REFRESH_COOLDOWN_MS,
  monitorRefreshTriggerAtom,
  monitorScanningAtom,
} from "@src/store";
import { settingsToolbarAtom } from "@src/store/ui/settingsToolbarAtom";

import { APP_SECTIONS, SECTION_IDS, SECTION_TAB_META } from "./config";
import SettingsSectionRenderer from "./renderer/SettingsSectionRenderer";

// Lazy load the JSON editor (only needed when toggling)
const SettingsJsonEditor = lazy(
  () => import("./components/SettingsJsonEditor")
);

// Only lazy load subpages since they're optional navigation
const EditorAppearancePage = lazy(
  () => import("./subpages/EditorAppearancePage/index")
);
type SettingsViewMode = "gui" | "json";

const Settings: React.FC = () => {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();
  const location = useLocation();

  // The Settings module renders under several router paths whose param
  // names differ (`:section` for the legacy app-settings shape, `:item`
  // for the unified core-settings shape). Parsing the pathname directly
  // makes the module independent of the router param naming.
  const parsedPath = useMemo(
    () => parseSettingsPath(location.pathname),
    [location.pathname]
  );

  const subpage: SettingsSubpageSegment | null = parsedPath.subpage;
  const currentSections = APP_SECTIONS;

  // Active section from URL, defaulting to first valid section.
  const activeSection = useMemo(() => {
    const fromUrl = parsedPath.section;
    if (fromUrl && currentSections.some((section) => section.id === fromUrl)) {
      return fromUrl;
    }
    return currentSections[0]?.id ?? SECTION_IDS.GENERAL;
  }, [parsedPath.section, currentSections]);

  const activeSectionDefinition = useMemo(
    () => getSettingsSectionById(activeSection),
    [activeSection]
  );
  const activeSectionTitle = activeSectionDefinition
    ? t(activeSectionDefinition.headingTitleKey)
    : "";

  const activeSectionTabs = useMemo<TabPillItem[]>(() => {
    const meta = SECTION_TAB_META[activeSection];
    if (meta) {
      return meta.map(({ key, labelKey }) => ({ key, label: t(labelKey) }));
    }
    return [{ key: activeSection, label: activeSectionTitle }];
  }, [activeSection, activeSectionTitle, t]);

  // Active tab comes from the URL — `/settings/<section>/<tab>`.
  // Falls back to the section's default tab when the `<tab>` segment is
  // missing or unrecognised.
  const activeSectionTab = useMemo(() => {
    const { tab } = parseSettingsSectionTab(location.pathname);
    if (tab) return tab;
    const defaultTab = getDefaultSettingsSectionTab(
      activeSection as SettingsSectionSegment
    );
    return defaultTab ?? activeSection;
  }, [location.pathname, activeSection]);

  const handleSectionTabChange = useCallback(
    (key: string) => {
      navigate(
        buildSettingsPath({
          section: activeSection as SettingsSectionSegment,
          tab: key,
        })
      );
    },
    [activeSection, navigate]
  );

  const [viewMode, _setViewMode] = useState<SettingsViewMode>("gui");

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      assertSettingsUiParity();
    }
  }, []);

  // Canonicalize legacy and bogus URLs in a single pass:
  //   - `/.../notifications` and `/.../shortcuts` (formerly standalone
  //     sections) → `/general/<that-tab>`
  //   - unknown `<id>` tails → first app-settings section
  //   - bare landings (`/settings`, `/core-settings`, …) → no-op
  useEffect(() => {
    const { section: sectionTab, tab } = parseSettingsSectionTab(
      location.pathname
    );
    const { section, category } = parseCoreSettingsItem(location.pathname);

    // Rewrite legacy `/notifications` and `/shortcuts` tails to the
    // canonical `/general/<tab>` URL.
    const parts = location.pathname
      .split("/")
      .filter((segment) => segment.length > 0);
    const tail = parts[parts.length - 1];
    if (
      sectionTab === "general" &&
      tab &&
      (tail === "notifications" || tail === "shortcuts")
    ) {
      navigate(buildSettingsPath({ section: "general", tab }), {
        replace: true,
      });
      return;
    }

    // Rewrite legacy `/code-search-indexing` (formerly a standalone
    // section) and the phantom `/workspace` segment to the canonical
    // `/editor/index` URL.
    if (
      sectionTab === "editor" &&
      tab === "index" &&
      (tail === "code-search-indexing" || tail === "workspace")
    ) {
      navigate(buildSettingsPath({ section: "editor", tab: "index" }), {
        replace: true,
      });
      return;
    }

    if (section || category) return;

    const isBareLanding =
      tail === undefined ||
      tail === "settings" ||
      tail === "core-settings" ||
      tail === "app-settings" ||
      tail === "integrations";
    if (isBareLanding) return;

    navigate(
      buildSettingsPath({
        section: (currentSections[0]?.id ??
          SECTION_IDS.GENERAL) as SettingsSectionSegment,
      }),
      { replace: true }
    );
  }, [currentSections, navigate, location.pathname]);

  // Render subpage content based on current subpage
  const renderSubpageContent = () => {
    switch (subpage) {
      case "editor-appearance":
        return <EditorAppearancePage />;
      default:
        return null;
    }
  };

  const lastRefreshTimeRef = useRef<number>(0);
  const setMonitorTrigger = useSetAtom(monitorRefreshTriggerAtom);
  const isMonitorScanning = useAtomValue(monitorScanningAtom);

  const showMonitorRefresh =
    activeSection === SECTION_IDS.MONITOR && viewMode === "gui";

  const handleMonitorRefresh = useCallback(() => {
    const now = Date.now();
    if (now - lastRefreshTimeRef.current < REFRESH_COOLDOWN_MS) {
      Message.info(t("common:refreshToast.cooldown"));
      return;
    }
    lastRefreshTimeRef.current = now;
    setMonitorTrigger((prev) => prev + 1);
  }, [setMonitorTrigger, t]);

  // Publish refresh state to toolbar atom (consumed by useRouteToolbarConfig)
  const setToolbarEntry = useSetAtom(settingsToolbarAtom);
  useEffect(() => {
    setToolbarEntry(
      showMonitorRefresh
        ? { onRefresh: handleMonitorRefresh, loading: isMonitorScanning }
        : {}
    );
  }, [
    showMonitorRefresh,
    handleMonitorRefresh,
    isMonitorScanning,
    setToolbarEntry,
  ]);

  const mainContent = (
    <ResponsiveContainer className="h-full">
      {viewMode === "json" ? (
        <div className="h-full">
          <Suspense
            fallback={
              <Placeholder variant="loading" placement="detail-panel" />
            }
          >
            <SettingsJsonEditor />
          </Suspense>
        </div>
      ) : (
        <div className="flex h-full flex-col overflow-hidden">
          <InternalHeader
            noPanelHeader
            contentPadding
            className={DETAIL_PANEL_TOKENS.headerWidth}
            tabs={
              <TabPill
                tabs={activeSectionTabs}
                activeTab={activeSectionTab}
                onChange={handleSectionTabChange}
                variant="simple"
                fillWidth={false}
                size="large"
              />
            }
          />
          <ScrollFadeContainer
            className={`scroll-fade-at-top ${DETAIL_PANEL_TOKENS.scrollContentNoTop}`}
          >
            <div className={DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop}>
              <SettingsSectionRenderer
                sectionId={activeSection}
                activeTab={activeSectionTab}
              />
            </div>
          </ScrollFadeContainer>
        </div>
      )}
    </ResponsiveContainer>
  );

  if (subpage) {
    return (
      <div className="settings-page h-full overflow-hidden">
        <Suspense
          fallback={<Placeholder variant="loading" placement="detail-panel" />}
        >
          {renderSubpageContent()}
        </Suspense>
      </div>
    );
  }

  return (
    <div className="settings-page h-full overflow-hidden">{mainContent}</div>
  );
};

export default Settings;
