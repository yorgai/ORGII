/**
 * FloatingReplayContainer Component
 *
 * Floating status bar pill for replay controls (play/pause, prev/next, speed).
 * The progress slider is now handled by MusicPlayerReplayBar on the dock border.
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Keyboard } from "lucide-react";
import React, { memo, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  currentSimulatorEventIndexAtom,
  navigateNextSimulatorEventAtom,
  simulatorEventCountAtom,
} from "@src/engines/SessionCore";
import { chatVisibleAtom } from "@src/store/ui/chatPanelAtom";
import {
  type SimulatorPlaybackSpeed,
  simulatorInlineChatInputCollapsedAtom,
  simulatorPlaybackSpeedAtom,
  simulatorSessionPlaybackPlayingAtom,
} from "@src/store/ui/simulatorAtom";

import SimulatorStatusBar from "../SimulatorStatusBar";

const AUTOPLAY_BASE_INTERVAL_MS = 2000;

/**
 * `simulatorSessionPlaybackPlayingAtom` is the single source of truth for
 * autoplay. This component both reads from it (to drive the `setInterval`
 * stepping the cursor) and writes to it (via the Play/Pause button). Do NOT
 * add a local `isReplaying` mirror — it desyncs from the atom when external
 * callers write.
 */
const FloatingReplayContainer: React.FC = memo(() => {
  const { t } = useTranslation("sessions");
  const [isReplaying, setIsReplaying] = useAtom(
    simulatorSessionPlaybackPlayingAtom
  );
  const navigateNext = useSetAtom(navigateNextSimulatorEventAtom);
  const currentIndex = useAtomValue(currentSimulatorEventIndexAtom);
  const eventCount = useAtomValue(simulatorEventCountAtom);
  const chatVisible = useAtomValue(chatVisibleAtom);
  const simulatorInputCollapsed = useAtomValue(
    simulatorInlineChatInputCollapsedAtom
  );
  const setSimulatorInlineChatCollapsed = useSetAtom(
    simulatorInlineChatInputCollapsedAtom
  );

  const [playbackSpeed, setPlaybackSpeedAtom] = useAtom(
    simulatorPlaybackSpeedAtom
  );

  const setPlaybackSpeed = useCallback(
    (speed: number) => {
      setPlaybackSpeedAtom(speed as SimulatorPlaybackSpeed);
    },
    [setPlaybackSpeedAtom]
  );

  // Keep refs in sync so the interval callback always sees the latest values
  const currentIndexRef = useRef(currentIndex);
  const eventCountRef = useRef(eventCount);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);
  useEffect(() => {
    eventCountRef.current = eventCount;
  }, [eventCount]);

  const handlePlayPause = useCallback(() => {
    setIsReplaying((prev) => !prev);
  }, [setIsReplaying]);

  // Drive event stepping while playing; auto-stops when last event is reached
  useEffect(() => {
    if (!isReplaying || eventCount === 0) return;

    // If already at the end when play is pressed, stop immediately via next tick
    if (currentIndexRef.current >= eventCountRef.current - 1) {
      const timerId = setTimeout(() => setIsReplaying(false), 0);
      return () => clearTimeout(timerId);
    }

    const interval = AUTOPLAY_BASE_INTERVAL_MS / playbackSpeed;
    const timerId = setInterval(() => {
      if (currentIndexRef.current >= eventCountRef.current - 1) {
        setIsReplaying(false);
        return;
      }
      navigateNext();
    }, interval);

    return () => clearInterval(timerId);
  }, [isReplaying, playbackSpeed, eventCount, navigateNext, setIsReplaying]);

  // Ensure autoplay halts when the container unmounts (e.g. session switch).
  useEffect(() => {
    return () => {
      setIsReplaying(false);
    };
  }, [setIsReplaying]);

  return (
    <div className="pointer-events-none absolute bottom-2 left-0 right-0 z-30 flex flex-col items-center gap-2 px-2">
      <div className="pointer-events-auto flex w-max max-w-full items-center gap-1.5">
        <SimulatorStatusBar
          isReplaying={isReplaying}
          onPlayPause={handlePlayPause}
          playbackSpeed={playbackSpeed}
          onPlaybackSpeedChange={setPlaybackSpeed}
        />
        {!chatVisible ? (
          <Button
            variant="secondary"
            size="default"
            shape="circle"
            iconOnly
            icon={
              <Keyboard
                size={16}
                strokeWidth={1.75}
                className={
                  simulatorInputCollapsed ? undefined : "text-primary-6"
                }
              />
            }
            className="shadow-md"
            onClick={() =>
              setSimulatorInlineChatCollapsed(!simulatorInputCollapsed)
            }
            aria-label={t("simulator.replay.dockShowChatInput")}
            title={t("simulator.replay.dockShowChatInput")}
          />
        ) : null}
      </div>
    </div>
  );
});

FloatingReplayContainer.displayName = "FloatingReplayContainer";

export default FloatingReplayContainer;
