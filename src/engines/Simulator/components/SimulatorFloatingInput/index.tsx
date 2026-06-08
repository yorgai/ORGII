/**
 * SimulatorFloatingInput
 *
 * Floating chat composer shown over the simulator when the dock is visible and
 * the sidebar chat panel is hidden. Toggle/collapse is handled externally by
 * the replay-control keyboard button.
 */
import React, { Suspense } from "react";

const LazyInputArea = React.lazy(
  () => import("@src/engines/ChatPanel/InputArea")
);

const INPUT_STACK_BASE = "pointer-events-auto w-full max-w-[450px]";

const INPUT_CARD_CLASS = "w-full drop-shadow-[0_4px_14px_rgba(0,0,0,0.12)]";

export const SimulatorFloatingInput: React.FC = () => {
  return (
    <div className={INPUT_STACK_BASE}>
      <div className={INPUT_CARD_CLASS}>
        <Suspense fallback={null}>
          <LazyInputArea omitChatHeader surfaceBg />
        </Suspense>
      </div>
    </div>
  );
};

SimulatorFloatingInput.displayName = "SimulatorFloatingInput";
export default SimulatorFloatingInput;
