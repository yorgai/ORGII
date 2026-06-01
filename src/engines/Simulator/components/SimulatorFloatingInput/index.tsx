/**
 * SimulatorFloatingInput
 *
 * Floating chat composer shown over the simulator when the dock is visible
 * and the sidebar chat panel is hidden. Two visual states:
 *
 *   collapsed — round keyboard button (easy tap target)
 *   expanded  — chevron dismiss + full InputArea card with drop-shadow
 *
 * Positioning is handled by the parent (absolute inset-0).
 */
import { ChevronDown, Keyboard } from "lucide-react";
import React, { Suspense } from "react";
import { useTranslation } from "react-i18next";

import { SURFACE_TOKENS } from "@src/config/surfaceTokens";

const LazyInputArea = React.lazy(
  () => import("@src/engines/ChatPanel/InputArea")
);

const FLOATING_INPUT_STACK_BASE =
  "pointer-events-auto flex w-full max-w-[450px] flex-col gap-1.5";

const FLOATING_INPUT_SHADOW =
  "w-full drop-shadow-[0_4px_14px_rgba(0,0,0,0.12)]";

const FLOATING_SCROLL_NAV_ICON_BUTTON = `flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full border border-solid border-border-2 bg-bg-1 transition-all ${SURFACE_TOKENS.hover}`;

const KEYBOARD_EXPAND_BUTTON = `flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-solid border-border-2 bg-bg-1 transition-all ${SURFACE_TOKENS.hover}`;

interface SimulatorFloatingInputProps {
  collapsed: boolean;
  alignClass: string;
  onCollapse: () => void;
  onExpand: () => void;
}

export const SimulatorFloatingInput: React.FC<SimulatorFloatingInputProps> = ({
  collapsed,
  alignClass,
  onCollapse,
  onExpand,
}) => {
  const { t } = useTranslation("sessions");

  if (collapsed) {
    return (
      <div className="pointer-events-auto">
        <button
          type="button"
          className={KEYBOARD_EXPAND_BUTTON}
          onClick={onExpand}
          aria-label={t("simulator.replay.dockShowChatInput")}
          title={t("simulator.replay.dockShowChatInput")}
        >
          <Keyboard size={20} className="text-text-2" strokeWidth={1.75} />
        </button>
      </div>
    );
  }

  return (
    <div className={`${FLOATING_INPUT_STACK_BASE} ${alignClass}`}>
      <button
        type="button"
        className={FLOATING_SCROLL_NAV_ICON_BUTTON}
        onClick={onCollapse}
        aria-label={t("simulator.replay.dockHideChatInput")}
        title={t("simulator.replay.dockHideChatInput")}
      >
        <ChevronDown size={12} className="text-text-2" strokeWidth={2} />
      </button>
      <div className={FLOATING_INPUT_SHADOW}>
        <Suspense fallback={null}>
          <LazyInputArea omitChatHeader surfaceBg />
        </Suspense>
      </div>
    </div>
  );
};

SimulatorFloatingInput.displayName = "SimulatorFloatingInput";
export default SimulatorFloatingInput;
