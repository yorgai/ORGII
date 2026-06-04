import { useSetAtom } from "jotai";
import { useEffect } from "react";

import type {
  DevRecordToolbarEntry,
  DevRecordView,
} from "@src/store/ui/devRecordToolbarAtom";
import { devRecordToolbarRegistryAtom } from "@src/store/ui/devRecordToolbarAtom";

/**
 * Registers toolbar actions (refresh, filter toggle) for a DevRecord
 * sub-view into the shared registry atom, so route-local headers can use them.
 */
export function useRegisterRefresh(
  viewKey: DevRecordView,
  onRefresh: () => void,
  loading: boolean
): void {
  const setRegistry = useSetAtom(devRecordToolbarRegistryAtom);

  useEffect(() => {
    setRegistry((prev) => ({
      ...prev,
      [viewKey]: { ...prev[viewKey], onRefresh, loading },
    }));
  }, [viewKey, onRefresh, loading, setRegistry]);
}

/**
 * Registers a filter sidebar toggle for a DevRecord sub-view.
 */
export function useRegisterFilterToggle(
  viewKey: DevRecordView,
  filterVisible: boolean,
  onToggleFilter: () => void
): void {
  const setRegistry = useSetAtom(devRecordToolbarRegistryAtom);

  useEffect(() => {
    setRegistry((prev) => {
      const existing: DevRecordToolbarEntry = prev[viewKey] ?? {};
      return {
        ...prev,
        [viewKey]: { ...existing, filterVisible, onToggleFilter },
      };
    });
  }, [viewKey, filterVisible, onToggleFilter, setRegistry]);
}
