import { rpc } from "@src/api/tauri/rpc";
import { buildAgentOrgsPath } from "@src/config/mainAppPaths";
import { agentOrgsActiveTabAtom } from "@src/modules/MainApp/AgentOrgs/store/agentOrgsActiveTabAtom";
import { router } from "@src/router";
import {
  activeStationChatVisibleAtom,
  chatPanelMaximizedAtom,
} from "@src/store/ui/chatPanelAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  editorPanelPositionPersistAtom,
  workStationEditorSecondaryCollapsedPersistAtom,
} from "@src/store/ui/workStationAtom";
import { dockFilterAtom } from "@src/store/workstation";
import type { AgentConfigTabVariant } from "@src/store/workstation/tabs";
import {
  PROJECT_DETAIL_SURFACE_VIEW,
  createAgentConfigTab,
  createProjectWorkItemsIndexTab,
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

  const openWorkspaceWorkItemsTab = async (): Promise<
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
      const tab = createProjectWorkItemsIndexTab();
      const current = store.get(workstationLayoutAtom);
      const nextLayout = {
        ...current,
        mainPane: openTab({ tabs: [], activeTabId: null }, tab),
      };
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(nextLayout));
      store.set(workstationLayoutAtom, nextLayout);
      void router.navigate("/orgii/workstation/project").catch(() => undefined);
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
      const tab = createProjectWorkItemsTab(
        projectId,
        projectName,
        projectSlug,
        PROJECT_DETAIL_SURFACE_VIEW.WORK_ITEMS
      );
      const current = store.get(workstationLayoutAtom);
      const nextLayout = {
        ...current,
        mainPane: openTab({ tabs: [], activeTabId: null }, tab),
      };
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(nextLayout));
      store.set(workstationLayoutAtom, nextLayout);
      void router.navigate("/orgii/workstation/project").catch(() => undefined);
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
      store.set(chatPanelMaximizedAtom, false);
      store.set(activeStationChatVisibleAtom, "my-station", false);
      store.set(workStationEditorSecondaryCollapsedPersistAtom, false);
      store.set(editorPanelPositionPersistAtom, "bottom");
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
      await router.navigate("/orgii/workstation/code");
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        store.set(chatPanelMaximizedAtom, false);
        store.set(activeStationChatVisibleAtom, "my-station", false);
        if (localStorage.getItem("orgii:chatPanelMaximized") === "false") {
          break;
        }
      }
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  const openOrgTab = async (
    orgId: string,
    displayName?: string
  ): Promise<{ ok: true } | Err> => {
    try {
      await router.navigate(buildAgentOrgsPath({ tab: "orgs" }));
      store.set(stationModeAtom, "my-station");
      store.set(dockFilterAtom, "code");
      store.set(chatPanelMaximizedAtom, false);
      store.set(activeStationChatVisibleAtom, "my-station", false);
      store.set(workStationEditorSecondaryCollapsedPersistAtom, false);
      store.set(editorPanelPositionPersistAtom, "bottom");
      const orgs = await rpc.agentOrgs.orgs.list();
      const orgSnapshot = orgs.find((org) => org.id === orgId);
      const tab = createAgentConfigTab({
        variant: "org",
        entityId: orgId,
        displayName: displayName ?? orgSnapshot?.name ?? orgId,
        entitySnapshot: orgSnapshot,
      });
      const current = store.get(workstationLayoutAtom);
      const nextLayout = {
        ...current,
        mainPane: openTab(
          current?.mainPane ?? { tabs: [], activeTabId: null },
          tab
        ),
      };
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(nextLayout));
      store.set(workstationLayoutAtom, nextLayout);
      store.set(agentOrgsActiveTabAtom, "orgs");
      await router.navigate("/orgii/workstation/code");
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        store.set(chatPanelMaximizedAtom, false);
        store.set(activeStationChatVisibleAtom, "my-station", false);
        if (localStorage.getItem("orgii:chatPanelMaximized") === "false") {
          break;
        }
      }
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  return {
    navigateTo,
    getLocationPathname,
    openWorkspaceWorkItemsTab,
    openProjectWorkItemsTab,
    openAgentTab,
    openOrgTab,
  };
}
