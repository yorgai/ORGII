/**
 * ModePill Component
 *
 * Compact mode selector pill for ORGII `AgentExecMode` sessions.
 *
 * Three usage modes — they map to different sources of truth:
 *  1. Controlled (`value` prop) — caller owns the value, used for the
 *     SessionCreator preview where the user is configuring a session
 *     that doesn't exist yet.
 *  2. SessionCreator default (`forceVisible`, no sessionId) — reads /
 *     writes `creatorDefaultExecModeAtom` (the localStorage-backed
 *     default for *new* sessions).
 *  3. In-session (sessionId present, not controlled, not forceVisible)
 *     — reads / writes the per-session row via `useSessionExecModeField`.
 *     Falls back to the creator default *only* when the session has
 *     never been patched (`agentExecMode === undefined`), then promotes
 *     the next user click into a real `session_patch` so subsequent
 *     reads come from the row instead of the global atom.
 */
import { useAtomValue, useSetAtom } from "jotai";
import React, { memo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { DropdownItem, DropdownPanel } from "@src/components/Dropdown/exports";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import SelectorPill from "@src/components/SelectorPill";
import {
  AGENT_EXEC_MODES,
  type AgentExecMode,
} from "@src/config/sessionCreatorConfig";
import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import { useDropdownEngine } from "@src/hooks/dropdown";
import { useSessionExecModeField } from "@src/hooks/session/useSessionPatch";
import { creatorDefaultExecModeAtom } from "@src/store/session/creatorDefaultExecModeAtom";
import {
  isAgentSession,
  isCliSession,
  isWingmanSession,
} from "@src/util/session/sessionDispatch";

export interface ModePillProps {
  /** Show pill regardless of active session (for session creator) */
  forceVisible?: boolean;
  /** Called after mode changes — use to sync external state (e.g. advancedConfig.flow) */
  onModeChange?: (mode: AgentExecMode) => void;
  /** Controlled mode value — when provided, bypasses both atoms */
  value?: AgentExecMode;
  /** Dropdown placement direction */
  placement?: "top" | "bottom";
}

const ModePill: React.FC<ModePillProps> = memo(
  ({ forceVisible = false, onModeChange, value, placement = "top" }) => {
    const { t } = useTranslation("sessions");
    const { sessionId } = useSessionId();

    const isControlled = value !== undefined;
    // In-session reads use the session row; creator-default reads use
    // the localStorage atom. We always subscribe to *both* so the
    // hooks order is stable across renders, then pick the right value
    // below based on the current usage mode.
    const creatorDefault = useAtomValue(creatorDefaultExecModeAtom);
    const setCreatorDefault = useSetAtom(creatorDefaultExecModeAtom);
    const { agentExecMode: sessionMode, setMode: setSessionMode } =
      useSessionExecModeField(sessionId ?? "");

    const isInSessionMode =
      !isControlled && !forceVisible && Boolean(sessionId);
    const mode: AgentExecMode = isControlled
      ? (value as AgentExecMode)
      : isInSessionMode
        ? ((sessionMode as AgentExecMode | undefined) ?? creatorDefault)
        : creatorDefault;

    const currentOption =
      AGENT_EXEC_MODES.find((opt) => opt.id === mode) ?? AGENT_EXEC_MODES[0];
    const CurrentIcon = currentOption.icon;
    const currentLabel = t(currentOption.i18nKey);

    const {
      isOpen,
      isPositioned,
      toggle,
      close,
      triggerRef,
      panelRef,
      panelPosition,
    } = useDropdownEngine<HTMLButtonElement>({
      gap: 6,
      align: "left",
      placement,
    });

    const handleSelect = useCallback(
      (selected: AgentExecMode) => {
        if (!isControlled) {
          if (isInSessionMode) {
            // Fire-and-forget: useSessionExecModeField does the
            // optimistic store write before awaiting the RPC, so the
            // pill repaints with the new value on the same frame.
            // Errors are surfaced via the hook's own state; we
            // intentionally don't await here so the dropdown closes
            // without waiting on IPC.
            void setSessionMode(selected);
          } else {
            setCreatorDefault(selected);
          }
        }
        onModeChange?.(selected);
        close();
      },
      [
        isControlled,
        isInSessionMode,
        setSessionMode,
        setCreatorDefault,
        onModeChange,
        close,
      ]
    );

    const isVisible =
      forceVisible ||
      (sessionId && (isAgentSession(sessionId) || isCliSession(sessionId)));
    if (!isVisible || (sessionId && isWingmanSession(sessionId))) return null;

    return (
      <div className="relative">
        <SelectorPill
          ref={triggerRef}
          icon={
            <CurrentIcon size={14} strokeWidth={1.75} className="text-text-1" />
          }
          label={currentLabel}
          tooltip={t("creator.switchMode")}
          tooltipFramed
          tooltipPosition="top"
          active={isOpen}
          dataTestId="agent-exec-mode-pill"
          onClick={toggle}
          className="h-[28px] text-[13px]"
          size="sm"
        />

        {isOpen &&
          isPositioned &&
          createPortal(
            <DropdownPanel
              ref={panelRef}
              className={`fixed ${DROPDOWN_WIDTHS.menuClass}`}
              style={{
                ...(panelPosition.top !== undefined
                  ? { top: panelPosition.top }
                  : { bottom: panelPosition.bottom }),
                left: panelPosition.left,
              }}
            >
              <div className={DROPDOWN_CLASSES.itemsColumnPadded}>
                {AGENT_EXEC_MODES.map((option) => {
                  const Icon = option.icon;
                  const isSelected = mode === option.id;
                  return (
                    <DropdownItem
                      key={option.id}
                      icon={
                        <Icon
                          size={DROPDOWN_ITEM.iconSize}
                          strokeWidth={1.75}
                        />
                      }
                      selected={isSelected}
                      showCheckmark
                      dataTestId={`agent-exec-mode-option-${option.id}`}
                      onClick={() => handleSelect(option.id)}
                    >
                      {t(option.i18nKey)}
                    </DropdownItem>
                  );
                })}
              </div>
            </DropdownPanel>,
            document.body
          )}
      </div>
    );
  }
);

ModePill.displayName = "ModePill";

export default ModePill;
