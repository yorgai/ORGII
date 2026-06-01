/**
 * useCellReplayState Hook
 *
 * Manages replay state for each grid cell in the video-editor clip model.
 *
 * ## Modes
 *
 * 1. **Synced** (default when `externalCursorMs` is provided): the cell
 *    follows the main replay cursor. The current event is resolved via a
 *    binary-search by timestamp against the cell's event list.
 *
 * 2. **Independent** (when the user manually interacts with the cell, or
 *    when no external cursor is provided): the cell uses its own local
 *    `currentIndex` and runs its own auto-play timer.
 *
 * Implementation is split across:
 * - cellReplayTypes.ts — shared types and findIndexAtTime utility
 * - useCellPersistence.ts — per-cell persisted state via cellReplayStatesAtom
 * - useCellPlayback.ts — auto-play timer and global replay sync
 */
import { useAtomValue } from "jotai";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  simulatorAutoScrollAtom,
  simulatorPlaybackSpeedAtom,
} from "@src/store/ui/simulatorAtom";

import type {
  CellReplayControls,
  CellReplayState,
  UseCellReplayStateOptions,
  UseCellReplayStateReturn,
} from "./cellReplayTypes";
import { findIndexAtTime } from "./cellReplayTypes";
import { useCellPersistence } from "./useCellPersistence";
import { useCellPlayback } from "./useCellPlayback";

// Re-export types for existing consumers
export type {
  CellReplayState,
  CellReplayControls,
  UseCellReplayStateOptions,
  UseCellReplayStateReturn,
};

export function useCellReplayState(
  options: UseCellReplayStateOptions
): UseCellReplayStateReturn {
  const {
    events,
    autoPlayInterval = 1500,
    startAtEnd = true,
    cellId = "unknown",
    externalCursorMs = null,
  } = options;

  // ── Persistence ──────────────────────────────────────────────────────
  const { persistedState, hasUserOverride, patchCellState } =
    useCellPersistence(cellId);

  const isSyncMode = externalCursorMs != null && !hasUserOverride;

  // ── Local state ──────────────────────────────────────────────────────
  const [currentIndex, setCurrentIndexLocal] = useState(() => {
    if (persistedState?.currentIndex !== undefined) {
      return Math.min(
        persistedState.currentIndex,
        Math.max(0, events.length - 1)
      );
    }
    return startAtEnd && events.length > 0 ? events.length - 1 : 0;
  });
  const [isPlaying, setIsPlayingLocal] = useState(
    () => persistedState?.isPlaying ?? false
  );
  const [localPlaybackSpeed, setLocalPlaybackSpeed] = useState(1);

  // Read global speed before passing to playback hook
  const globalPlaybackSpeed = useAtomValue(simulatorPlaybackSpeedAtom);
  const playbackSpeed =
    localPlaybackSpeed !== 1 ? localPlaybackSpeed : globalPlaybackSpeed;

  // ── Playback timer + global sync ─────────────────────────────────────
  useCellPlayback({
    events,
    autoPlayInterval,
    isPlaying,
    isSyncMode,
    playbackSpeed,
    setCurrentIndexLocal,
    setIsPlayingLocal,
    patchCellState,
    setLocalPlaybackSpeed,
  });

  const autoScroll = useAtomValue(simulatorAutoScrollAtom);

  // ── Persistent index wrapper ─────────────────────────────────────────
  const setCurrentIndex = useCallback(
    (
      updater: number | ((prev: number) => number),
      markOverride: boolean = true
    ) => {
      setCurrentIndexLocal((prev) => {
        const newValue =
          typeof updater === "function" ? updater(prev) : updater;
        patchCellState({
          currentIndex: newValue,
          isPlaying,
          ...(markOverride ? { hasUserOverride: true } : {}),
        });
        return newValue;
      });
    },
    [patchCellState, isPlaying]
  );

  const setIsPlaying = useCallback(
    (value: boolean, markOverride: boolean = true) => {
      setIsPlayingLocal(value);
      patchCellState({
        currentIndex,
        isPlaying: value,
        ...(markOverride ? { hasUserOverride: true } : {}),
      });
    },
    [patchCellState, currentIndex]
  );

  // ── Follow mode ──────────────────────────────────────────────────────
  const prevEventsLengthRef = useRef(events.length);
  const setCurrentIndexLocalRef = useRef(setCurrentIndexLocal);
  const setIsPlayingLocalRef = useRef(setIsPlayingLocal);
  useLayoutEffect(() => {
    setCurrentIndexLocalRef.current = setCurrentIndexLocal;
    setIsPlayingLocalRef.current = setIsPlayingLocal;
  }, [setCurrentIndexLocal, setIsPlayingLocal]);

  useEffect(() => {
    const prevLen = prevEventsLengthRef.current;
    prevEventsLengthRef.current = events.length;

    if (events.length === prevLen) return;
    if (events.length === 0) {
      queueMicrotask(() => {
        setCurrentIndexLocal(0);
        setIsPlayingLocal(false);
      });
    } else if (events.length > prevLen && !isPlaying) {
      const newLen = events.length;
      queueMicrotask(() => setCurrentIndexLocal(newLen - 1));
    } else if (startAtEnd && !persistedState && prevLen === 0) {
      const newLen = events.length;
      queueMicrotask(() => setCurrentIndexLocal(newLen - 1));
    }
  }, [events.length, isPlaying, startAtEnd, persistedState]);

  // ── Mode-aware index ─────────────────────────────────────────────────
  const safeIndex = useMemo(() => {
    if (events.length === 0) return -1;
    if (isSyncMode && externalCursorMs != null) {
      const idx = findIndexAtTime(events, externalCursorMs);
      return Math.max(0, idx);
    }
    return Math.max(0, Math.min(currentIndex, events.length - 1));
  }, [currentIndex, events, externalCursorMs, isSyncMode]);

  const currentEvent = useMemo(() => {
    if (safeIndex < 0 || safeIndex >= events.length) return null;
    return events[safeIndex];
  }, [events, safeIndex]);

  const progress = useMemo(() => {
    if (events.length <= 1) return 100;
    return (safeIndex / (events.length - 1)) * 100;
  }, [safeIndex, events.length]);

  // ── Controls ─────────────────────────────────────────────────────────
  const play = useCallback(() => {
    const startFrom = isSyncMode
      ? safeIndex
      : currentIndex >= events.length - 1
        ? 0
        : currentIndex;
    setCurrentIndex(startFrom);
    setIsPlaying(true);
  }, [
    isSyncMode,
    safeIndex,
    currentIndex,
    events.length,
    setCurrentIndex,
    setIsPlaying,
  ]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, [setIsPlaying]);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  const next = useCallback(() => {
    const base = isSyncMode ? safeIndex : currentIndex;
    setCurrentIndex(Math.min(base + 1, events.length - 1));
  }, [isSyncMode, safeIndex, currentIndex, events.length, setCurrentIndex]);

  const prev = useCallback(() => {
    const base = isSyncMode ? safeIndex : currentIndex;
    setCurrentIndex(Math.max(base - 1, 0));
  }, [isSyncMode, safeIndex, currentIndex, setCurrentIndex]);

  const goToIndex = useCallback(
    (index: number) => {
      setCurrentIndex(Math.max(0, Math.min(index, events.length - 1)));
    },
    [events.length, setCurrentIndex]
  );

  const goToProgress = useCallback(
    (progressValue: number) => {
      if (events.length <= 1) return;
      const index = Math.round((progressValue / 100) * (events.length - 1));
      goToIndex(index);
    },
    [events.length, goToIndex]
  );

  const setSpeed = useCallback((speed: number) => {
    setLocalPlaybackSpeed(speed);
  }, []);

  const reset = useCallback(() => {
    setCurrentIndex(0);
    setIsPlaying(false);
  }, [setCurrentIndex, setIsPlaying]);

  const goToEnd = useCallback(() => {
    setCurrentIndex(events.length - 1);
    setIsPlaying(false);
  }, [events.length, setCurrentIndex, setIsPlaying]);

  const syncToMain = useCallback(() => {
    setIsPlayingLocal(false);
    patchCellState({ isPlaying: false, hasUserOverride: false });
  }, [patchCellState]);

  // ── Return ───────────────────────────────────────────────────────────
  const state: CellReplayState = useMemo(
    () => ({
      currentIndex: safeIndex,
      isPlaying,
      playbackSpeed,
      currentEvent,
      totalEvents: events.length,
      progress,
      autoScroll,
      isDetached: hasUserOverride,
    }),
    [
      safeIndex,
      isPlaying,
      playbackSpeed,
      currentEvent,
      events.length,
      progress,
      autoScroll,
      hasUserOverride,
    ]
  );

  const controls: CellReplayControls = useMemo(
    () => ({
      play,
      pause,
      togglePlay,
      next,
      prev,
      goToIndex,
      goToProgress,
      setSpeed,
      reset,
      goToEnd,
      syncToMain,
    }),
    [
      play,
      pause,
      togglePlay,
      next,
      prev,
      goToIndex,
      goToProgress,
      setSpeed,
      reset,
      goToEnd,
      syncToMain,
    ]
  );

  return { state, controls };
}
