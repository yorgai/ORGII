import { buildAgentOrgsPath } from "@src/config/mainAppPaths";
import { agentOrgsActiveTabAtom } from "@src/modules/MainApp/AgentOrgs/store/agentOrgsActiveTabAtom";
import { router } from "@src/router";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanelAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { dockFilterAtom } from "@src/store/workstation";
import type { AgentConfigTabVariant } from "@src/store/workstation/tabs";
import {
  PROJECT_DETAIL_SURFACE_VIEW,
  createProjectWorkItemsTab,
  openTab,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";
import { LAYOUT_STORAGE_KEY } from "@src/store/workstation/tabs/storage";
import { getRustAgentType } from "@src/util/session/sessionDispatch";
import { openAgentConfigInWorkStation } from "@src/util/ui/openAgentConfigInWorkStation";

import { asError } from "../result";
import type { E2EStore, Err } from "../types";

export function createNavigationHelpers(store: E2EStore) {
  const navigateTo = async (path: string): Promise<{ ok: true } | Err> => {
    try {
      await router.navigate(path);
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  const getLocationPathname = (): string => window.location.pathname;

  const openProjectWorkItemsTab = async (
    projectId: string,
    projectName: string,
    projectSlug?: string
  ): Promise<
    | {
        ok: true;
        activeTabId: string | null;
        tabIds: string[];
        pathname: string;
      }
    | Err
  > => {
    try {
      store.set(stationModeAtom, "my-station");
      store.set(dockFilterAtom, "project");
      store.set(chatPanelMaximizedAtom, false);
      await router.navigate("/orgii/workstation/project");
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
      const tab = createProjectWorkItemsTab(
        projectId,
        projectName,
        projectSlug,
        PROJECT_DETAIL_SURFACE_VIEW.WORK_ITEMS
      );
      const current = store.get(workstationLayoutAtom);
      const currentPane = current?.mainPane ?? {
        tabs: [],
        activeTabId: null,
      };
      const retainedTabs = currentPane.tabs.filter(
        (tabItem) =>
          tabItem.type !== "project-workitems" &&
          tabItem.type !== "project-linear-projects" &&
          tabItem.type !== "project-linear-work-items"
      );
      const nextLayout = {
        ...current,
        mainPane: openTab(
          { tabs: retainedTabs, activeTabId: currentPane.activeTabId },
          tab
        ),
      };
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(nextLayout));
      store.set(workstationLayoutAtom, nextLayout);
      const layout = store.get(workstationLayoutAtom);
      return {
        ok: true,
        activeTabId: layout?.mainPane?.activeTabId ?? null,
        tabIds: layout?.mainPane?.tabs.map((tabItem) => tabItem.id) ?? [],
        pathname: window.location.pathname,
      };
    } catch (err) {
      return asError(err);
    }
  };

  const openAgentTab = async (
    agentId: string,
    tab: string
  ): Promise<{ ok: true } | Err> => {
    try {
      await router.navigate(buildAgentOrgsPath({ tab: "agents" }));
      const rustAgentType = getRustAgentType(agentId);
      const variant: AgentConfigTabVariant =
        rustAgentType === "os"
          ? "builtin-os"
          : rustAgentType === "sde"
            ? "builtin-sde"
            : rustAgentType === "wingman"
              ? "wingman"
              : "custom";
      openAgentConfigInWorkStation({
        variant,
        entityId: agentId,
        displayName: agentId,
      });
      store.set(agentOrgsActiveTabAtom, tab);
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  return {
    navigateTo,
    getLocationPathname,
    openProjectWorkItemsTab,
    openAgentTab,
  };
}
