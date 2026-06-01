/**
 * useWorkStationPipelineBridge
 *
 * Keeps the live "pipeline" atom (`activeSessionIdAtom`) in sync with
 * WorkStation's remembered selection (`workstationActiveSessionIdAtom`)
 * whenever WorkStation is the visible view.
 *
 * Two scenarios this covers:
 *
 *   1. View transition INTO WorkStation: a secondary surface (kanban
 *      detail panel, project-manager tab, etc.) may have temporarily
 *      claimed the pipeline atom to render some other session's chat.
 *      On return to WorkStation, restore pipeline = memory so the
 *      docked ChatPanel and SessionSyncProvider point at the
 *      session WorkStation actually wants to show.
 *
 *   2. Memory change WHILE the user is in WorkStation: any caller
 *      that writes `workstationActiveSessionIdAtom` directly
 *      (ActionSystem, scripted nav, programmatic open) will have
 *      its change reflected in the live pipeline without needing to
 *      remember to write both atoms.
 *
 * Owner sites (sidebar click, tab change, launch flow) write both
 * atoms eagerly so the chat updates in lockstep with the navigation;
 * this bridge is the safety net for everything else.
 *
 * Extracted into its own hook so it can be unit-tested against a
 * vanilla Jotai store without instantiating the full AppShell tree.
 */
import { useAtomValue, useStore } from "jotai";
import { useEffect } from "react";

import {
  activeSessionIdAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session";

/**
 * Minimal store interface used by `applyWorkStationPipelineBridge` so
 * the same logic can be unit-tested with a vanilla Jotai store.
 */
export interface PipelineBridgeStore {
  get<T>(atom: { read: unknown }): T;
  set<T>(atom: { write: unknown }, value: T): void;
}

/**
 * Pure, sync logic of the bridge — extracted so it can be exercised
 * directly in unit tests against a `createStore()` instance. Returns
 * `true` if the pipeline was updated, `false` if the bridge no-oped.
 */
export function applyWorkStationPipelineBridge(
  isWorkStationViewActive: boolean,
  remembered: string | null,
  store: PipelineBridgeStore
): boolean {
  if (!isWorkStationViewActive) return false;
  const pipeline = store.get<string | null>(activeSessionIdAtom);
  if (remembered === pipeline) return false;
  store.set(activeSessionIdAtom, remembered);
  return true;
}

export function useWorkStationPipelineBridge(
  isWorkStationViewActive: boolean
): void {
  const store = useStore();
  const remembered = useAtomValue(workstationActiveSessionIdAtom);
  useEffect(() => {
    applyWorkStationPipelineBridge(
      isWorkStationViewActive,
      remembered,
      store as unknown as PipelineBridgeStore
    );
  }, [isWorkStationViewActive, remembered, store]);
}
