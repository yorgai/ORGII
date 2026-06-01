import { atom } from "jotai";

import { AppType } from "@src/engines/Simulator/types/appTypes";
import {
  simulatorEffectiveDockAppAtom,
  stationModeAtom,
} from "@src/store/ui/simulatorAtom";

export const SHARED_BROWSER_HOST = {
  MY_STATION: "my-station",
  AGENT_STATION: "agent-station",
} as const;

export type SharedBrowserHostId =
  (typeof SHARED_BROWSER_HOST)[keyof typeof SHARED_BROWSER_HOST];

export const SHARED_BROWSER_HOST_SCOPE = {
  MY_STATION: "my-station-browser",
  AGENT_STATION: "agent-station-browser",
} as const;

export type SharedBrowserHostScope =
  (typeof SHARED_BROWSER_HOST_SCOPE)[keyof typeof SHARED_BROWSER_HOST_SCOPE];

export interface SharedBrowserHostRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SharedBrowserHostRecord {
  id: SharedBrowserHostId;
  scope: SharedBrowserHostScope;
  active: boolean;
  rect: SharedBrowserHostRect | null;
}

export type SharedBrowserHostRegistry = Record<
  SharedBrowserHostId,
  SharedBrowserHostRecord
>;

export const EMPTY_SHARED_BROWSER_HOST_REGISTRY: SharedBrowserHostRegistry = {
  [SHARED_BROWSER_HOST.MY_STATION]: {
    id: SHARED_BROWSER_HOST.MY_STATION,
    scope: SHARED_BROWSER_HOST_SCOPE.MY_STATION,
    active: false,
    rect: null,
  },
  [SHARED_BROWSER_HOST.AGENT_STATION]: {
    id: SHARED_BROWSER_HOST.AGENT_STATION,
    scope: SHARED_BROWSER_HOST_SCOPE.AGENT_STATION,
    active: false,
    rect: null,
  },
};

export const sharedBrowserHostRegistryAtom = atom<SharedBrowserHostRegistry>(
  EMPTY_SHARED_BROWSER_HOST_REGISTRY
);
sharedBrowserHostRegistryAtom.debugLabel = "sharedBrowserHostRegistryAtom";

function getRenderableHost(
  host: SharedBrowserHostRecord
): SharedBrowserHostRecord | null {
  return host.active && host.rect ? host : null;
}

export const activeSharedBrowserHostAtom = atom<SharedBrowserHostRecord | null>(
  (get) => {
    const registry = get(sharedBrowserHostRegistryAtom);
    const stationMode = get(stationModeAtom);
    const effectiveDockApp = get(simulatorEffectiveDockAppAtom);

    if (stationMode === "agent-station") {
      if (effectiveDockApp !== AppType.BROWSER) return null;
      return getRenderableHost(registry[SHARED_BROWSER_HOST.AGENT_STATION]);
    }

    return getRenderableHost(registry[SHARED_BROWSER_HOST.MY_STATION]);
  }
);
activeSharedBrowserHostAtom.debugLabel = "activeSharedBrowserHostAtom";
