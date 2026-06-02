/**
 * SettingsSidebar
 *
 * Sidebar for the Settings page. The first level shows app settings plus
 * integration categories. Agent & Org now opens a single table surface; its
 * Agents / Orgs / CLIs switcher lives inside the page, not in a drill-down
 * sidebar level.
 */
import { useAtomValue } from "jotai";
import { Infinity as InfinityIcon, ChevronLeft } from "lucide-react";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import LiquidGlassHoverItem from "@src/components/LiquidGlassHoverItem";
import {
  type CoreSettingsItemSegment,
  type IntegrationsCategorySegment,
  buildAgentOrgsPath,
  buildCoreSettingsItemPath,
  buildIntegrationsPath,
  getSegmentIcon,
  parseCoreSettingsItem,
  parseSettingsTopTab,
} from "@src/config/mainAppPaths";
import { ROUTES } from "@src/config/routes";
import { SIDEBAR_MEMORY_KIND, useSidebarMemoryEntry } from "@src/hooks/perf";
import { APP_SECTIONS } from "@src/modules/MainApp/Settings/config";
import { settingsReturnRouteAtom } from "@src/store/ui/viewModeAtom";

import SidebarBase from "../SidebarBase";
import { SidebarBottomBar, SidebarList } from "../blocks";
import NavigationMenu from "../components/NavigationMenu";
import type { NavigationMenuItem } from "../components/NavigationMenu/config";
import { SidebarRamMonitorButton } from "../connectors/SidebarRamMonitorButton";

interface SettingsRootSectionConfig {
  id: string;
  labelKey: string;
  itemIds: readonly SettingsRootItemSegment[];
}

type SettingsRootItemSegment =
  | IntegrationsCategorySegment
  | typeof AGENT_ORG_ROW_KEY;

const AGENT_ORG_ROW_KEY = "agent-orgs";
const AGENT_ORG_LABEL = "Agent & Org";
const AGENT_ORG_PATH = buildAgentOrgsPath({ tab: "agents" });

function isAgentOrgsRoute(pathname: string): boolean {
  const topTab = parseSettingsTopTab(pathname);
  return topTab === "agent-orgs";
}

const SETTINGS_ROOT_INTEGRATION_KEYS: readonly IntegrationsCategorySegment[] = [
  "models",
  "myRoles",
  "rulesMemoryEvolution",
  "routines",
  "tools",
  "computerUse",
  "externalSkillsets",
  "devtools",
  "connections",
  "git",
  "databases",
];

const SETTINGS_ROOT_LIST_SECTIONS: SettingsRootSectionConfig[] = [
  {
    id: "core",
    labelKey: "coreSidebar.groups.core",
    itemIds: [
      AGENT_ORG_ROW_KEY,
      "models",
      "myRoles",
      "rulesMemoryEvolution",
      "routines",
    ],
  },
  {
    id: "tools",
    labelKey: "coreSidebar.groups.tools",
    itemIds: ["tools", "computerUse", "externalSkillsets", "devtools"],
  },
  {
    id: "connections",
    labelKey: "coreSidebar.groups.connections",
    itemIds: ["connections", "git", "databases"],
  },
];

const SettingsSidebar: React.FC = () => {
  const { t } = useTranslation("navigation");
  const navigate = useNavigate();
  const settingsReturnRoute = useAtomValue(settingsReturnRouteAtom);

  const handleBack = useCallback(() => {
    navigate(settingsReturnRoute || ROUTES.app.home.start.path);
  }, [navigate, settingsReturnRoute]);

  return (
    <SidebarBase>
      <div className="flex h-9 flex-shrink-0 items-end px-3">
        <LiquidGlassHoverItem
          className="flex h-7 items-center gap-2 rounded-lg px-2 font-bold text-text-1"
          onClick={handleBack}
        >
          <ChevronLeft size={14} strokeWidth={2} />
          <span className="text-[13px]">{t("labels.settings")}</span>
        </LiquidGlassHoverItem>
      </div>

      <SettingsRootBody />
      <SidebarBottomBar
        rightActions={<SidebarRamMonitorButton />}
        hideSettings
      />
    </SidebarBase>
  );
};

export default SettingsSidebar;

const SettingsRootBody: React.FC = () => {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();
  const location = useLocation();

  const activeItemId: string = useMemo(() => {
    const topTab = parseSettingsTopTab(location.pathname);
    const fallback = APP_SECTIONS[0].id;
    if (isAgentOrgsRoute(location.pathname)) return AGENT_ORG_ROW_KEY;
    if (topTab === "integrations") {
      const { category } = parseCoreSettingsItem(location.pathname);
      return category ?? fallback;
    }
    if (topTab !== "core-settings") return fallback;
    const { section, category } = parseCoreSettingsItem(location.pathname);
    return section ?? category ?? fallback;
  }, [location.pathname]);

  const appSectionItems = useMemo<NavigationMenuItem[]>(
    () =>
      APP_SECTIONS.map((section) => ({
        id: section.id,
        key: section.id,
        label: t(`settings:sections.${section.labelKey}`),
        icon: section.icon,
        dataTestId: `settings-core-item-${section.id}`,
      })),
    [t]
  );

  const integrationsSections = useMemo(
    () =>
      SETTINGS_ROOT_LIST_SECTIONS.map((section) => ({
        id: section.id,
        title: t(`settings:${section.labelKey}`),
        items: section.itemIds.map<NavigationMenuItem>((id) => {
          if (id === AGENT_ORG_ROW_KEY) {
            return {
              id,
              key: id,
              label: AGENT_ORG_LABEL,
              icon: InfinityIcon,
              dataTestId: "settings-core-item-agent-orgs",
            };
          }

          const icon = getSegmentIcon(id);
          if (!icon) {
            throw new Error(
              `SettingsSidebar: missing segment-registry entry for "${id}"`
            );
          }
          return {
            id,
            key: id,
            label: t(`settings:coreSidebar.items.${id}`),
            icon,
            dataTestId: `settings-core-item-${id}`,
          };
        }),
      })),
    [t]
  );

  const handleItemClick = useCallback(
    (key: string) => {
      if (key === AGENT_ORG_ROW_KEY) {
        navigate(AGENT_ORG_PATH);
        return;
      }
      if ((SETTINGS_ROOT_INTEGRATION_KEYS as readonly string[]).includes(key)) {
        navigate(
          buildIntegrationsPath({
            category: key as IntegrationsCategorySegment,
          })
        );
        return;
      }
      navigate(buildCoreSettingsItemPath(key as CoreSettingsItemSegment));
    },
    [navigate]
  );

  const selectedKeys = useMemo(() => [activeItemId], [activeItemId]);
  const integrationItemCount = integrationsSections.reduce(
    (sum, section) => sum + section.items.length,
    0
  );

  useSidebarMemoryEntry({
    kind: SIDEBAR_MEMORY_KIND.SETTINGS,
    label: "Settings root",
    items: appSectionItems.length + integrationItemCount,
    sections: integrationsSections.length + 1,
    source: { activeItemId, appSectionItems, integrationsSections },
  });

  return (
    <SidebarList>
      <div>
        <NavigationMenu
          items={appSectionItems}
          selectedKeys={selectedKeys}
          onMenuItemClick={handleItemClick}
          verticalGapClassName="gap-px"
        />
      </div>
      {integrationsSections.map((section) => (
        <div key={section.id} className="mt-4">
          <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wider text-text-1">
            {section.title}
          </div>
          <NavigationMenu
            items={section.items}
            selectedKeys={selectedKeys}
            onMenuItemClick={handleItemClick}
          />
        </div>
      ))}
    </SidebarList>
  );
};
