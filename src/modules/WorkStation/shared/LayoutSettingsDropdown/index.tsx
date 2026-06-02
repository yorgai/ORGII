/**
 * LayoutSettingsDropdown Component
 *
 * Quick-access Workstation layout chrome toggles.
 * Internal layout mode only affects Workstation chrome, not the app-wide layout.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { HelpCircle } from "lucide-react";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { getMaterialConfig } from "@src/components/LiquidGlass/config";
import { TUTORIALS_OPEN_EVENT } from "@src/scaffold/Tutorials/tutorialRegistry";
import {
  POPUP_ANIMATION,
  POPUP_SHADOW,
} from "@src/scaffold/shared/popupTokens";
import {
  type ModelPickerStyle,
  activeStationChatVisibleAtom,
  chatTurnPaginationEnabledAtom,
  modelPickerStyleAtom,
} from "@src/store/ui/chatPanelAtom";
import { toolbarDropdownOpenAtom } from "@src/store/ui/overlayAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  sessionChatPositionAtom,
  workStationBottomPanelMaximizedAtom,
  workStationChatPositionAtom,
  workStationDockAutoHideAtom,
  workStationDockAutoHidePersistAtom,
  workStationEditorSecondaryCollapsedAtom,
  workStationEditorSecondaryCollapsedPersistAtom,
  workStationInternalLayoutModeAtom,
  workStationInternalLayoutModePersistAtom,
  workStationLayoutModeAtom,
  workStationLayoutModePersistAtom,
} from "@src/store/ui/workStationAtom";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import {
  LayoutMethodToggleRow,
  SectionLabel,
  SidebarPositionToggleRow,
  SwitchRow,
  TwoOptionToggleRow,
} from "./LayoutDropdownControls";

// ============================================
// Constants
// ============================================

const DROPDOWN_WIDTH = 260;

type ChatPanelPosition = "left" | "right";

// ============================================
// Types
// ============================================

interface LayoutSettingsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

// ============================================
// Component
// ============================================

const LayoutSettingsDropdown: React.FC<LayoutSettingsDropdownProps> = memo(
  ({ isOpen, onClose, triggerRef }) => {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const { isDark } = useCurrentTheme();
    const [position, setPosition] = useState<{ top: number; right: number }>({
      top: 0,
      right: 0,
    });
    // Only render the panel after position has been measured so it never
    // flashes at (top:0, right:0) in the top-right corner on first open.
    const isPositioned = position.top > 0;

    // ---- Visibility atoms ----
    const stationMode = useAtomValue(stationModeAtom);
    const setStationChatVisible = useSetAtom(activeStationChatVisibleAtom);
    const layoutMode = useAtomValue(workStationLayoutModeAtom);

    const bottomPanelCollapsed = useAtomValue(
      workStationEditorSecondaryCollapsedAtom
    );
    const setBottomCollapsed = useSetAtom(
      workStationEditorSecondaryCollapsedPersistAtom
    );
    const [bottomMaximized, setBottomMaximized] = useAtom(
      workStationBottomPanelMaximizedAtom
    );

    const dockAutoHide = useAtomValue(workStationDockAutoHideAtom);
    const setDockAutoHide = useSetAtom(workStationDockAutoHidePersistAtom);

    const setLayoutModePersist = useSetAtom(workStationLayoutModePersistAtom);
    const [chatPosition, setChatPosition] = useAtom(
      workStationChatPositionAtom
    );
    const [agentChatPosition, setAgentChatPosition] = useAtom(
      sessionChatPositionAtom
    );
    const [chatTurnPaginationEnabled, setChatTurnPaginationEnabled] = useAtom(
      chatTurnPaginationEnabledAtom
    );
    const [modelPickerStyle, setModelPickerStyle] =
      useAtom(modelPickerStyleAtom);
    const internalLayoutMode = useAtomValue(workStationInternalLayoutModeAtom);
    const setInternalLayoutMode = useSetAtom(
      workStationInternalLayoutModePersistAtom
    );

    // Sync with toolbar dropdown atom (hides webviews when open).
    // Cleanup resets to false on unmount so a stale open state doesn't
    // permanently hide webviews when the component is destroyed while open.
    const setToolbarDropdownOpen = useSetAtom(toolbarDropdownOpenAtom);
    useEffect(() => {
      setToolbarDropdownOpen(isOpen);
      return () => {
        setToolbarDropdownOpen(false);
      };
    }, [isOpen, setToolbarDropdownOpen]);

    // Position calculation — re-run on open and on window resize so the
    // dropdown doesn't drift after the user resizes the Tauri window while
    // it's open.
    const recalcPosition = useCallback(() => {
      if (isOpen && triggerRef?.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const right = window.innerWidth - rect.right;
        setPosition({ top: rect.bottom + 7, right });
      }
    }, [isOpen, triggerRef]);

    useEffect(() => {
      recalcPosition();
    }, [recalcPosition]);

    useEffect(() => {
      if (!isOpen) return;
      window.addEventListener("resize", recalcPosition);
      return () => window.removeEventListener("resize", recalcPosition);
    }, [isOpen, recalcPosition]);

    // Click outside handler
    useEffect(() => {
      if (!isOpen) return;

      const handleClickOutside = (event: MouseEvent) => {
        if (
          containerRef.current &&
          !containerRef.current.contains(event.target as Node) &&
          (!triggerRef?.current ||
            !triggerRef.current.contains(event.target as Node))
        ) {
          onClose();
        }
      };

      const timeoutId = setTimeout(() => {
        document.addEventListener("mousedown", handleClickOutside);
      }, 0);

      return () => {
        clearTimeout(timeoutId);
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }, [isOpen, onClose, triggerRef]);

    // ESC handler
    useEffect(() => {
      if (!isOpen) return;

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      };

      document.addEventListener("keydown", handleKeyDown, true);
      return () => document.removeEventListener("keydown", handleKeyDown, true);
    }, [isOpen, onClose]);

    const handleStationChatPositionChange = useCallback(
      (value: ChatPanelPosition) => {
        if (stationMode === "my-station" || stationMode === "agent-station") {
          setStationChatVisible(stationMode, true);
        }
        setChatPosition(value);
      },
      [setChatPosition, setStationChatVisible, stationMode]
    );

    const handleAgentChatPositionChange = useCallback(
      (value: ChatPanelPosition) => {
        setAgentChatPosition(value);
      },
      [setAgentChatPosition]
    );

    const handleBottomPanelToggle = useCallback(
      (visible: boolean) => {
        if (bottomMaximized) {
          setBottomMaximized(false);
        }
        setBottomCollapsed(!visible);
      },
      [bottomMaximized, setBottomMaximized, setBottomCollapsed]
    );

    const handleSidebarPositionChange = useCallback(
      (value: "left" | "right") => setLayoutModePersist(value),
      [setLayoutModePersist]
    );

    const handleLayoutMethodChange = useCallback(
      (value: "compact" | "comfort") => {
        setInternalLayoutMode(value);
      },
      [setInternalLayoutMode]
    );

    const handleOpenTutorials = useCallback(() => {
      window.dispatchEvent(new CustomEvent(TUTORIALS_OPEN_EVENT));
      onClose();
    }, [onClose]);

    // Glass style (matching EllipsisDropdown)
    const containerMaterial = useMemo(
      () => getMaterialConfig(isDark, "thick"),
      [isDark]
    );

    const containerGlassStyle = useMemo(() => {
      const borderColor = isDark
        ? "rgba(255, 255, 255, 0.08)"
        : "rgba(255, 255, 255, 0.18)";
      return {
        backdropFilter: `blur(${containerMaterial.blur}px)`,
        WebkitBackdropFilter: `blur(${containerMaterial.blur}px)`,
        background: containerMaterial.background,
        border: `1px solid ${borderColor}`,
        boxShadow: POPUP_SHADOW,
      };
    }, [isDark, containerMaterial]);

    return createPortal(
      <AnimatePresence>
        {isOpen && isPositioned && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-[9998]"
              onClick={onClose}
              style={{ background: "transparent" }}
            />

            {/* Dropdown */}
            <motion.div
              ref={containerRef}
              {...POPUP_ANIMATION}
              className="scrollbar-overlay fixed z-[9999] max-h-[min(72vh,calc(100vh-32px))] overflow-y-auto overflow-x-hidden rounded-[12px]"
              style={{
                top: position.top,
                right: position.right,
                width: DROPDOWN_WIDTH,
                ...containerGlassStyle,
              }}
            >
              <div className="flex flex-col gap-2.5 px-3 pb-2.5 pt-3">
                <SectionLabel>
                  {t("layoutSettings.chatPanelLocation")}
                </SectionLabel>

                <SidebarPositionToggleRow
                  label={t("layoutSettings.myStation")}
                  labelVariant="select"
                  position={chatPosition}
                  leftLabel={t("layoutSettings.left")}
                  rightLabel={t("layoutSettings.right")}
                  onChange={handleStationChatPositionChange}
                />
                <SidebarPositionToggleRow
                  label={t("layoutSettings.agentStation")}
                  labelVariant="select"
                  position={agentChatPosition}
                  leftLabel={t("layoutSettings.left")}
                  rightLabel={t("layoutSettings.right")}
                  onChange={handleAgentChatPositionChange}
                />
              </div>

              <div className="mx-3 border-t border-border-2" />

              <div className="flex flex-col gap-2.5 px-3 py-2.5">
                <SectionLabel>{t("layoutSettings.toolLayout")}</SectionLabel>

                <LayoutMethodToggleRow
                  label={t("layoutSettings.layoutMode")}
                  labelVariant="select"
                  value={internalLayoutMode}
                  compactLabel={t("layoutSettings.compact")}
                  comfortLabel={t("layoutSettings.comfort")}
                  onChange={handleLayoutMethodChange}
                />
                <SidebarPositionToggleRow
                  label={t("layoutSettings.sidebarPosition")}
                  labelVariant="select"
                  position={layoutMode}
                  leftLabel={t("layoutSettings.left")}
                  rightLabel={t("layoutSettings.right")}
                  onChange={handleSidebarPositionChange}
                />
                <SwitchRow
                  label={t("layoutSettings.bottomPanel")}
                  labelVariant="select"
                  checked={!bottomPanelCollapsed}
                  onChange={handleBottomPanelToggle}
                />
                <SwitchRow
                  label={t("layoutSettings.dockAutoHide")}
                  labelVariant="select"
                  checked={dockAutoHide}
                  onChange={setDockAutoHide}
                />
              </div>

              <div className="mx-3 border-t border-border-2" />

              <div className="flex flex-col gap-2.5 px-3 py-2.5">
                <SectionLabel>{t("layoutSettings.newChatPanel")}</SectionLabel>

                <SwitchRow
                  label={t("pagination.title")}
                  labelVariant="select"
                  checked={chatTurnPaginationEnabled}
                  onChange={setChatTurnPaginationEnabled}
                />
                <TwoOptionToggleRow<ModelPickerStyle>
                  label={t("layoutSettings.modelPickerStyle")}
                  labelVariant="select"
                  value={modelPickerStyle}
                  options={[
                    {
                      key: "spotlight",
                      label: t("layoutSettings.modelPickerSpotlight"),
                    },
                    {
                      key: "dropdown",
                      label: t("layoutSettings.modelPickerMenu"),
                    },
                  ]}
                  onChange={setModelPickerStyle}
                />
              </div>

              <div className="mx-3 border-t border-border-2" />

              <div className="px-3 py-2.5">
                <Button
                  size="small"
                  variant="secondary"
                  appearance="outline"
                  long
                  icon={<HelpCircle size={14} />}
                  onClick={handleOpenTutorials}
                >
                  Tutorials
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>,
      document.body
    );
  }
);

LayoutSettingsDropdown.displayName = "LayoutSettingsDropdown";

export default LayoutSettingsDropdown;
