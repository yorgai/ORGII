/**
 * HomeSidebar
 *
 * Home navigation sidebar with Home/Workstation tabs.
 * Swaps to second-level sidebars when on focused app pages.
 *
 * Tab Behavior: Uses "reuse" mode - clicking sidebar items updates the
 * existing main tab instead of creating new tabs.
 */
import { MenuItem, Menu as TauriMenu } from "@tauri-apps/api/menu";
import i18next from "i18next";
import { useAtom, useSetAtom } from "jotai";
import {
  ArrowUpRight,
  ChartNoAxesGantt,
  FolderGit2,
  House,
  SquareMousePointer,
} from "lucide-react";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { getSegmentIcon } from "@src/config/mainAppPaths";
import { ROUTES } from "@src/config/routes";
import { useRouteLabel } from "@src/hooks/i18n";
import { SIDEBAR_MEMORY_KIND, useSidebarMemoryEntry } from "@src/hooks/perf";
import { devRecordActiveViewAtom } from "@src/store/ui/devRecordToolbarAtom";
import { homeTabAtom } from "@src/store/ui/homeTabAtom";
import { openExternalLink } from "@src/util/platform/ipcRenderer";

import SidebarBottomBar from "../blocks/SidebarBottomBar";
import type { NavigationMenuItem } from "../components/NavigationMenu/config";
import { SidebarRamMonitorButton } from "../connectors/SidebarRamMonitorButton";
import { routeToMenuItem } from "../utils/menuFromRoutes";
import DevRecordSidebar from "./DevRecordSidebar";
import EconomySidebar from "./EconomySidebar";
import NavigationSidebar from "./NavigationSidebar";
import SettingsSidebar from "./SettingsSidebar";

// ============================================
// Helpers
// ============================================

const HOME_SIDEBAR_ICON_NAME = {
  homeTab: "house",
  workstationTab: "square-mouse-pointer",
  economy: "badge-cent",
} as const;

const MARKET_ROOT_PATH = ROUTES.app.market.tokenMarket.path.slice(
  0,
  ROUTES.app.market.tokenMarket.path.lastIndexOf("/")
);

const ORGII_GITHUB_URL = "https://github.com/yorg-ai/orgii";
const GITHUB_MENU_ITEM_KEY = "external-github";

// ============================================
// Component
// ============================================

const HomeSidebar: React.FC = () => {
  const { t } = useTranslation("navigation");
  const { getTranslatedRouteLabel } = useRouteLabel();
  const navigate = useNavigate();
  const location = useLocation();
  const setActiveMenuTab = useSetAtom(homeTabAtom);
  const [activeDevRecordView, setActiveDevRecordView] = useAtom(
    devRecordActiveViewAtom
  );

  const isOnDevRecord = location.pathname.startsWith(
    ROUTES.app.journey.record.path
  );
  // Unified settings surface covers all /settings namespaces;
  // SettingsSidebar owns the nested settings levels.
  const isOnSettings = location.pathname.startsWith(ROUTES.app.settings.path);
  const isOnEconomy = location.pathname.startsWith(MARKET_ROOT_PATH);

  // Tabs with translated labels
  const tabs = useMemo(
    () => [
      {
        key: "build",
        label: t("sidebar.tabs.build"),
        icon: House,
        iconName: HOME_SIDEBAR_ICON_NAME.homeTab,
      },
      {
        key: "workstation",
        label: t("sidebar.tabs.workstation"),
        icon: SquareMousePointer,
        iconName: HOME_SIDEBAR_ICON_NAME.workstationTab,
      },
    ],
    [t]
  );

  // Build menu items — labels from route config via useRouteLabel (same as PageBreadcrumb)
  const buildMenuItems = useMemo(
    (): NavigationMenuItem[] => [
      routeToMenuItem(ROUTES.app.home.start, {
        label: getTranslatedRouteLabel(ROUTES.app.home.start),
      }),
      routeToMenuItem(ROUTES.app.home.inbox, {
        label: getTranslatedRouteLabel(ROUTES.app.home.inbox),
      }),
      routeToMenuItem(ROUTES.app.ideas.area, {
        label: getTranslatedRouteLabel(ROUTES.app.ideas.area),
      }),
      routeToMenuItem(ROUTES.app.journey.record, {
        label: getTranslatedRouteLabel(ROUTES.app.journey.record),
      }),
      routeToMenuItem(ROUTES.app.market.tokenMarket, {
        icon: getSegmentIcon("market") ?? undefined,
        iconName: HOME_SIDEBAR_ICON_NAME.economy,
        label: t("sidebar.groups.economy"),
      }),
      {
        id: GITHUB_MENU_ITEM_KEY,
        key: GITHUB_MENU_ITEM_KEY,
        label: t("sidebar.groups.openSource"),
        icon: FolderGit2,
        iconName: "folder-git-2",
        trailingElement: <ArrowUpRight size={13} strokeWidth={2} />,
      },
      routeToMenuItem(ROUTES.app.home.changelog, {
        label: t("routes.changelog"),
        icon: ChartNoAxesGantt,
        iconName: "chart-no-axes-gantt",
      }),
    ],
    [t, getTranslatedRouteLabel]
  );

  // Compute selected key - handle nested routes
  const selectedKey = useMemo(() => {
    const pathname = location.pathname;
    const allPaths = [
      ROUTES.app.market.tokenMarket.path,
      ROUTES.app.market.agentApps.path,
      ROUTES.app.market.serviceMarket.path,
      ROUTES.app.market.profile.path,
      ROUTES.app.market.wallet.path,
      ROUTES.app.journey.record.path,
      ROUTES.app.ideas.area.path,
      ROUTES.app.home.inbox.path,
      ROUTES.app.home.changelog.path,
    ];
    for (const path of allPaths) {
      if (pathname.startsWith(path)) {
        return path;
      }
    }
    return pathname;
  }, [location.pathname]);

  useSidebarMemoryEntry({
    kind: SIDEBAR_MEMORY_KIND.START_PAGE,
    label: "Start page",
    items: buildMenuItems.length,
    tabs: tabs.length,
    source: { buildMenuItems, selectedKey, tabs },
    enabled: !isOnDevRecord && !isOnSettings && !isOnEconomy,
  });

  const handleMenuTabChange = useCallback(
    (key: string) => {
      const nextTab = key as "build" | "workstation";
      setActiveMenuTab(nextTab);
      if (nextTab === "build") {
        navigate(ROUTES.app.home.start.path, { replace: false });
        return;
      }
      navigate(ROUTES.workStation.base.path, { replace: false });
    },
    [navigate, setActiveMenuTab]
  );

  const handleMenuItemClick = useCallback(
    (key: string, item: NavigationMenuItem) => {
      if (key === GITHUB_MENU_ITEM_KEY) {
        void openExternalLink(ORGII_GITHUB_URL);
        return;
      }

      if (item.routePath) {
        navigate(item.routePath, { replace: false });
      }
    },
    [navigate]
  );

  const handleMenuItemContextMenu = useCallback(
    async (e: React.MouseEvent, key: string, item: NavigationMenuItem) => {
      e.preventDefault();
      e.stopPropagation();
      if (!item.routePath && key !== GITHUB_MENU_ITEM_KEY) return;

      const t = i18next.t.bind(i18next);

      const openItem = await MenuItem.new({
        text: t("actions.open"),
        action: () => {
          if (key === GITHUB_MENU_ITEM_KEY) {
            void openExternalLink(ORGII_GITHUB_URL);
            return;
          }

          if (!item.routePath) return;
          navigate(item.routePath, { replace: false });
        },
      });

      const menu = await TauriMenu.new({
        items: [openItem],
      });

      await menu.popup();
    },
    [navigate]
  );

  if (isOnDevRecord) {
    return (
      <DevRecordSidebar
        activeView={activeDevRecordView}
        onViewChange={setActiveDevRecordView}
      />
    );
  }

  if (isOnSettings) {
    return <SettingsSidebar />;
  }

  if (isOnEconomy) {
    return <EconomySidebar />;
  }

  return (
    <NavigationSidebar
      items={tabs}
      activeKey="build"
      onChange={handleMenuTabChange}
      menuItems={buildMenuItems}
      selectedKey={selectedKey}
      onMenuItemClick={handleMenuItemClick}
      onMenuItemContextMenu={handleMenuItemContextMenu}
      defaultOpenKeys={["workspace"]}
      enableHoverIconAnimation
      bottomContent={
        <SidebarBottomBar rightActions={<SidebarRamMonitorButton />} />
      }
    />
  );
};

export default HomeSidebar;
