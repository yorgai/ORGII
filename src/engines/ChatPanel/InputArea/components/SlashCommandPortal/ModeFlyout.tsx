/**
 * ModeFlyout — right-side panel listing all available AgentExecModes.
 * Opens when the user hovers/clicks the "Mode >" trigger row in the + menu.
 */
import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import DropdownSelectedCheck from "@src/components/Dropdown/DropdownSelectedCheck";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import type { AgentExecMode } from "@src/config/sessionCreatorConfig";
import { AGENT_EXEC_MODES } from "@src/config/sessionCreatorConfig";

interface ModeFlyoutProps {
  anchorTop: number;
  panelRight: number;
  currentMode: AgentExecMode;
  onSelect: (mode: AgentExecMode) => void;
  onClose: () => void;
  /** Controlled highlight index (keyboard-driven from parent). */
  highlightIndex: number;
  onHighlightChange: (idx: number) => void;
}

const ModeFlyout: React.FC<ModeFlyoutProps> = ({
  anchorTop,
  panelRight,
  currentMode,
  onSelect,
  onClose,
  highlightIndex,
  onHighlightChange,
}) => {
  const { t } = useTranslation("sessions");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      className={`${DROPDOWN_CLASSES.panel} flex flex-col overflow-hidden`}
      style={{
        position: "fixed",
        top: anchorTop,
        left: panelRight + 4,
        minWidth: 180,
        maxWidth: 240,
        zIndex: 99999,
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div
        className={`max-h-[320px] overflow-y-auto ${DROPDOWN_PANEL.paddingClass} scrollbar-hide`}
      >
        {AGENT_EXEC_MODES.map((mode, idx) => {
          const ModeIcon = mode.icon;
          const isActive = idx === highlightIndex;
          const isCurrent = mode.id === currentMode;
          return (
            <div
              key={mode.id}
              data-testid={`slash-command-mode-option-${mode.id}`}
              className={`${DROPDOWN_CLASSES.itemCompact} group cursor-pointer justify-between ${
                isActive ? "bg-fill-2" : "hover:bg-fill-2"
              }`}
              onMouseEnter={() => onHighlightChange(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(mode.id);
              }}
            >
              <div className="flex items-center gap-2">
                <ModeIcon
                  size={14}
                  strokeWidth={1.75}
                  className={isCurrent ? "text-primary-6" : "text-text-2"}
                />
                <span
                  className={`text-[13px] ${
                    isCurrent ? "text-primary-6" : "text-text-1"
                  }`}
                >
                  {t(mode.i18nKey)}
                </span>
              </div>
              {isCurrent && <DropdownSelectedCheck />}
            </div>
          );
        })}
      </div>
    </div>,
    document.body
  );
};

ModeFlyout.displayName = "ModeFlyout";

export default ModeFlyout;
