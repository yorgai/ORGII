import { ROUTES } from "@src/config/routes";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

const getStore = () => getInstrumentedStore();

function dispatchNavigate(path: string) {
  window.dispatchEvent(
    new CustomEvent("action-system-navigate", {
      detail: { path },
    })
  );
}

export const AppViewService = {
  async toggleSidebar(): Promise<boolean> {
    const { sidebarCollapsedAtom } = await import("@src/store/ui/sidebarAtom");
    const store = getStore();
    const current = store.get(sidebarCollapsedAtom);
    store.set(sidebarCollapsedAtom, !current);
    return true;
  },

  async openSettings(): Promise<boolean> {
    dispatchNavigate(ROUTES.app.settings.path);
    return true;
  },

  async createAgentStationSession(): Promise<boolean> {
    const [
      { clearSessionAtom },
      { activeSessionIdAtom, workstationActiveSessionIdAtom },
      { stationModeAtom },
    ] = await Promise.all([
      import("@src/engines/SessionCore/core/atoms"),
      import("@src/store/session"),
      import("@src/store/ui/simulatorAtom"),
    ]);

    const store = getStore();
    store.set(clearSessionAtom);
    // Preserve WorkStation tabs/layout when opening a fresh Agent Station session.
    store.set(activeSessionIdAtom, null);
    store.set(workstationActiveSessionIdAtom, null);
    store.set(stationModeAtom, "agent-station");
    dispatchNavigate(ROUTES.workStation.base.path);
    return true;
  },
};

export default AppViewService;
