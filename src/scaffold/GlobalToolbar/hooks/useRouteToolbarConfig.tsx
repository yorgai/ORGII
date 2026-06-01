/**
 * useRouteToolbarConfig Hook
 *
 * Derives per-route toolbar configuration synchronously from:
 * - Current pathname (via useLocation)
 * - Integrations category atom (for per-tab + button behavior)
 * - Integrations add action atom (callback to dispatch add actions)
 *
 * Replaces the old routeToolbarAtom + useSetRouteToolbar approach which
 * had race conditions with KeepAliveRouteOutlet.
 */
import { useAtomValue, useSetAtom } from "jotai";
import {
  Check,
  Folder,
  Network,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
  UserPlus,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import {
  type AddAction,
  CATEGORY_KEYS,
  type IntegrationCategory,
} from "@src/api/types/integrations";
import {
  WIZARD_IDS,
  buildAgentOrgsPath,
  buildWizardPath,
  parseCoreSettingsItem,
  parseSettingsTopTab,
} from "@src/config/mainAppPaths";
import { ROUTE_PATHS } from "@src/config/routePaths";
import { ROUTES } from "@src/config/routes";
import { useRefreshSpin } from "@src/hooks/ui/useRefreshSpin";
import { appGridEditModeAtom } from "@src/store/ui/appGridAtom";
import {
  devRecordActiveViewAtom,
  devRecordToolbarRegistryAtom,
} from "@src/store/ui/devRecordToolbarAtom";
import {
  dispatchIntegrationsAddAtom,
  integrationsToolbarAtom,
} from "@src/store/ui/integrationsToolbarAtom";
import {
  addWorkspaceInitialStageAtom,
  repoSelectorOpenAtom,
} from "@src/store/ui/overlayAtom";
import type { RouteToolbarConfig } from "@src/store/ui/routeToolbarAtom";
import { settingsToolbarAtom } from "@src/store/ui/settingsToolbarAtom";

import { getPlusConfigForCategory } from "./toolbarPlusConfigs";

function toIntegrationCategory(
  category: string | null | undefined
): IntegrationCategory {
  if (category && (CATEGORY_KEYS as readonly string[]).includes(category)) {
    return category as IntegrationCategory;
  }
  return "models";
}

// ============================================
// Route prefix constants (derived from ROUTES — single source of truth)
// ============================================

// Settings is the unified surface; app settings and Agent Orgs live under
// /orgii/app/settings. The Settings tab flat-merges classic
// app-settings sections and integration categories under one /settings/<id>
// URL — toolbar dispatch picks app vs. integration semantics off the parsed item.
const SETTINGS_PREFIX = ROUTES.app.settings.path;
const DEV_RECORD_PREFIX = ROUTES.app.journey.record.path;
// Market routes (Token Market, Wallet, etc.) all render the OSS placeholder
// `OpenSourceMarketUnavailablePage` and have no per-route toolbar
// contributions in the open-source build.

// ============================================
// Hook
// ============================================

export function useRouteToolbarConfig(): RouteToolbarConfig | null {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation("integrations");

  const noop = useMemo(() => () => {}, []);

  // Settings context
  const settingsToolbar = useAtomValue(settingsToolbarAtom);
  const { spinClass: settingsSpinClass, handleClick: settingsRefreshClick } =
    useRefreshSpin(
      settingsToolbar.onRefresh ?? noop,
      settingsToolbar.loading ?? false
    );

  // Start page controls
  const appGridEditMode = useAtomValue(appGridEditModeAtom);
  const setAppGridEditMode = useSetAtom(appGridEditModeAtom);
  const setRepoSelectorOpen = useSetAtom(repoSelectorOpenAtom);
  const setAddWorkspaceInitialStage = useSetAtom(addWorkspaceInitialStageAtom);

  const openAddWorkspace = useCallback(() => {
    setAddWorkspaceInitialStage("add-workspace-existing");
    setRepoSelectorOpen(true);
  }, [setAddWorkspaceInitialStage, setRepoSelectorOpen]);

  const toggleAppGridEditing = useCallback(() => {
    setAppGridEditMode((current) => !current);
  }, [setAppGridEditMode]);

  const openAgentAdd = useCallback(() => {
    const agentsPath = buildAgentOrgsPath({ tab: "agents" });
    navigate(buildWizardPath(agentsPath, WIZARD_IDS.AGENT_ADD));
  }, [navigate]);

  const openOrgAdd = useCallback(() => {
    const agentsPath = buildAgentOrgsPath({ tab: "agents" });
    navigate(buildWizardPath(agentsPath, WIZARD_IDS.ORG_ADD));
  }, [navigate]);

  // Integrations context (hosted inside the Settings tab when the
  // `<id>` happens to be an integration category). Derived directly
  // from the URL so the toolbar reflects route state without any
  // Jotai plumbing.
  const coreSettingsItem = useMemo(
    () => parseCoreSettingsItem(pathname),
    [pathname]
  );
  const integrationCategory = toIntegrationCategory(coreSettingsItem.category);
  const dispatchAddAction = useSetAtom(dispatchIntegrationsAddAtom);
  const integrationsToolbar = useAtomValue(integrationsToolbarAtom);
  const {
    spinClass: integrationsSpinClass,
    handleClick: integrationsRefreshClick,
  } = useRefreshSpin(
    integrationsToolbar.onRefresh ?? noop,
    integrationsToolbar.loading ?? false
  );

  // Dev Record context
  const devRecordActiveView = useAtomValue(devRecordActiveViewAtom);
  const devRecordRegistry = useAtomValue(devRecordToolbarRegistryAtom);
  const activeToolbarEntry = devRecordRegistry[devRecordActiveView];
  const { spinClass: devRecordSpinClass, handleClick: devRecordRefreshClick } =
    useRefreshSpin(
      activeToolbarEntry?.onRefresh ?? noop,
      activeToolbarEntry?.loading ?? false
    );

  return useMemo(() => {
    // Settings routes dispatch by namespace:
    //   /settings/agent-orgs/*     → AgentOrgs plus-menu
    //   /settings/integrations/*   → Integrations toolbar
    //   /settings/app/* or root    → app-settings toolbar
    if (pathname.startsWith(SETTINGS_PREFIX)) {
      const topTab = parseSettingsTopTab(pathname);

      if (topTab === "agent-orgs") {
        return {
          plusDropdownItems: [
            {
              id: "add-agent",
              label: t("toolbarPlusMenu.addAgent"),
              icon: UserPlus,
              onClick: openAgentAdd,
            },
            {
              id: "add-org",
              label: t("agentOrgs.addOrg"),
              icon: Network,
              onClick: openOrgAdd,
            },
          ],
        };
      }

      // Settings tab — flat-merged app + integrations.
      if (coreSettingsItem.category) {
        // Integrations-category sub-page: plus-menu + refresh button.
        const dispatch = (action: AddAction) => dispatchAddAction(action);

        const plusConfig = getPlusConfigForCategory(
          integrationCategory,
          dispatch,
          t
        );

        const extraButtons = [];

        if (integrationsToolbar.onRefresh) {
          extraButtons.push({
            id: "integrations-refresh",
            icon: RefreshCw,
            onClick: integrationsRefreshClick,
            title: t("common:actions.refresh"),
            iconClassName: integrationsSpinClass,
            disabled: !!integrationsSpinClass,
          });
        }

        extraButtons.push(...(integrationsToolbar.extraButtons ?? []));

        return {
          ...plusConfig,
          extraButtons: extraButtons.length > 0 ? extraButtons : undefined,
        };
      }

      // app-section sub-page or bare /settings landing.
      const extraButtons = [];

      if (settingsToolbar.onRefresh) {
        extraButtons.push({
          id: "settings-refresh",
          icon: RefreshCw,
          onClick: settingsRefreshClick,
          title: t("common:actions.refresh"),
          iconClassName: settingsSpinClass,
          disabled: !!settingsSpinClass,
        });
      }

      return {
        extraButtons: extraButtons.length > 0 ? extraButtons : undefined,
      };
    }

    // Dev Record routes
    if (pathname.startsWith(DEV_RECORD_PREFIX)) {
      const extraButtons = [];

      if (activeToolbarEntry?.onRefresh) {
        extraButtons.push({
          id: "dev-record-refresh",
          icon: RefreshCw,
          onClick: devRecordRefreshClick,
          title: t("common:actions.refresh"),
          iconClassName: devRecordSpinClass,
          disabled: !!devRecordSpinClass,
        });
      }

      if (activeToolbarEntry?.onToggleFilter) {
        extraButtons.push({
          id: "dev-record-filter",
          icon: SlidersHorizontal,
          onClick: activeToolbarEntry.onToggleFilter,
          title: t("common:labels.filters"),
          selected: activeToolbarEntry.filterVisible,
        });
      }

      return {
        extraButtons: extraButtons.length > 0 ? extraButtons : undefined,
      };
    }

    // Start page: ellipsis controls grid editing; + adds workspaces.
    if (pathname.startsWith(ROUTE_PATHS.startPage)) {
      return {
        ellipsisItems: [
          {
            id: "customize-grid",
            label: appGridEditMode
              ? t("common:actions.done")
              : t("navigation:appGrid.customizeGrid"),
            icon: appGridEditMode ? Check : Pencil,
            onClick: toggleAppGridEditing,
          },
        ],
        plusDropdownItems: [
          {
            id: "add-workspace",
            label: t("common:actions.addWorkspace"),
            icon: Folder,
            onClick: openAddWorkspace,
          },
        ],
      };
    }

    return null;
  }, [
    pathname,
    settingsToolbar,
    settingsRefreshClick,
    settingsSpinClass,
    openAgentAdd,
    openOrgAdd,
    coreSettingsItem,
    integrationCategory,
    dispatchAddAction,
    integrationsToolbar,
    integrationsRefreshClick,
    integrationsSpinClass,
    activeToolbarEntry,
    devRecordRefreshClick,
    devRecordSpinClass,
    appGridEditMode,
    openAddWorkspace,
    toggleAppGridEditing,
    t,
  ]);
}
