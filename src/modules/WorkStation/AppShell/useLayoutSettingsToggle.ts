/**
 * useLayoutSettingsToggle
 *
 * Encapsulates the open/close state and trigger ref for the
 * LayoutSettingsDropdown. Shared between KanbanStationTabBar and
 * WorkstationTabBar so neither duplicates the same three declarations.
 */
import { useCallback, useRef, useState } from "react";

export interface UseLayoutSettingsToggleReturn {
  isLayoutSettingsOpen: boolean;
  layoutSettingsTriggerRef: React.RefObject<HTMLSpanElement>;
  handleToggleLayoutSettings: () => void;
  handleCloseLayoutSettings: () => void;
}

export function useLayoutSettingsToggle(): UseLayoutSettingsToggleReturn {
  const layoutSettingsTriggerRef = useRef<HTMLSpanElement>(null);
  const [isLayoutSettingsOpen, setLayoutSettingsOpen] = useState(false);

  const handleToggleLayoutSettings = useCallback(() => {
    setLayoutSettingsOpen((open) => !open);
  }, []);

  const handleCloseLayoutSettings = useCallback(() => {
    setLayoutSettingsOpen(false);
  }, []);

  return {
    isLayoutSettingsOpen,
    layoutSettingsTriggerRef,
    handleToggleLayoutSettings,
    handleCloseLayoutSettings,
  };
}
