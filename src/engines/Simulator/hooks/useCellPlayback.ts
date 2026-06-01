/**
 * useCellPlayback Hook
 *
 * Manages auto-play timer and global replay state synchronization for a
 * single grid cell. Separated from useCellReplayState for maintainability.
 */
import { useAtomValue } from "jotai";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";

import type { SessionEvent } from "@src/engines/SessionCore";
import {
  type CellReplayPersistState,
  globalReplayStateAtom,
} from "@src/store/ui/simulatorAtom";

export interface UseCellPlaybackOptions {
  events: SessionEvent[];
  autoPlayInterval: number;
  isPlaying: boolean;
  isSyncMode: boolean;
  playbackSpeed: number;
  setCurrentIndexLocal: Dispatch<SetStateAction<number>>;
  setIsPlayingLocal: Dispatch<SetStateAction<boolean>>;
  patchCellState: (patch: Partial<CellReplayPersistState>) => void;
  setLocalPlaybackSpeed: Dispatch<SetStateAction<number>>;
}

/**
 * Runs the auto-play timer and responds to global replay commands.
 */
export function useCellPlayback({
  events,
  autoPlayInterval,
  isPlaying,
  isSyncMode,
  playbackSpeed,
  setCurrentIndexLocal,
  setIsPlayingLocal,
  patchCellState,
  setLocalPlaybackSpeed,
}: UseCellPlaybackOptions): void {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-play timer — only in independent mode
  useEffect(() => {
    if (isSyncMode) return;
    if (isPlaying && events.length > 0) {
      timerRef.current = setInterval(() => {
        setCurrentIndexLocal((prev) => {
          const nextIndex = prev + 1;
          if (nextIndex >= events.length) {
            setIsPlayingLocal(false);
            patchCellState({ currentIndex: prev, isPlaying: false });
            return prev;
          }
          patchCellState({ currentIndex: nextIndex, isPlaying: true });
          return nextIndex;
        });
      }, autoPlayInterval / playbackSpeed);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [
    isPlaying,
    isSyncMode,
    events.length,
    autoPlayInterval,
    playbackSpeed,
    patchCellState,
    setCurrentIndexLocal,
    setIsPlayingLocal,
  ]);

  // Global replay state synchronization
  const globalReplayState = useAtomValue(globalReplayStateAtom);
  const lastGlobalTriggerRef = useRef(0);

  const setCurrentIndexLocalCb = useCallback(
    (val: number) => setCurrentIndexLocal(val),
    [setCurrentIndexLocal]
  );
  const setIsPlayingLocalCb = useCallback(
    (val: boolean) => setIsPlayingLocal(val),
    [setIsPlayingLocal]
  );

  useEffect(() => {
    if (globalReplayState.triggerTime > lastGlobalTriggerRef.current) {
      lastGlobalTriggerRef.current = globalReplayState.triggerTime;

      queueMicrotask(() => {
        if (globalReplayState.isPlaying) {
          setCurrentIndexLocalCb(0);
          setIsPlayingLocalCb(true);
          setLocalPlaybackSpeed(globalReplayState.speed);
          patchCellState({
            currentIndex: 0,
            isPlaying: true,
            hasUserOverride: true,
          });
        } else {
          setCurrentIndexLocalCb(0);
          setIsPlayingLocalCb(false);
          patchCellState({
            currentIndex: 0,
            isPlaying: false,
            hasUserOverride: true,
          });
        }
      });
    }
  }, [
    globalReplayState,
    patchCellState,
    setCurrentIndexLocalCb,
    setIsPlayingLocalCb,
    setLocalPlaybackSpeed,
  ]);
}
