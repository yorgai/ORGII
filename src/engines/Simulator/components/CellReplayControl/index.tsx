/**
 * CellReplayControl Component
 *
 * Compact replay control bar for individual grid cells.
 * Shows progress, play/pause, and navigation controls.
 */
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import React, { memo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";

import { SURFACE_TOKENS } from "@src/config/surfaceTokens";

import type {
  CellReplayControls,
  CellReplayState,
} from "../../hooks/useCellReplayState";

interface CellReplayControlProps {
  state: CellReplayState;
  controls: CellReplayControls;
  /** Thread/task name to display */
  title?: string;
  /** Compact mode - minimal controls */
  compact?: boolean;
}

const CellReplayControl: React.FC<CellReplayControlProps> = memo(
  ({ state, controls, title, compact = false }) => {
    const { t } = useTranslation("sessions");
    const { currentIndex, isPlaying, totalEvents, progress } = state;
    const { togglePlay, next, prev, goToProgress } = controls;

    const progressBarRef = useRef<HTMLDivElement>(null);

    // Handle progress bar click
    const handleProgressClick = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        if (!progressBarRef.current) return;
        const rect = progressBarRef.current.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const percentage = (clickX / rect.width) * 100;
        goToProgress(Math.max(0, Math.min(100, percentage)));
      },
      [goToProgress]
    );

    // No events - show minimal indicator
    if (totalEvents === 0) {
      return (
        <div className="flex h-6 items-center justify-center text-xs text-text-4">
          {t("simulator.replay.noEvents")}
        </div>
      );
    }

    // Compact mode - just progress bar
    if (compact) {
      return (
        <div className="flex h-5 items-center gap-1 px-1">
          <button
            type="button"
            onClick={togglePlay}
            className={`flex h-4 w-4 items-center justify-center rounded text-text-3 ${SURFACE_TOKENS.hover} hover:text-text-1`}
          >
            {isPlaying ? <Pause size={10} /> : <Play size={10} />}
          </button>
          <div
            ref={progressBarRef}
            className="relative h-1 flex-1 cursor-pointer rounded-full bg-fill-2"
            onClick={handleProgressClick}
          >
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-primary-5 transition-all duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="min-w-[32px] text-right text-[10px] text-text-4">
            {currentIndex + 1}/{totalEvents}
          </span>
        </div>
      );
    }

    // Full mode
    return (
      <div className="flex h-8 items-center gap-2 border-t border-border-2 bg-fill-1 px-2">
        {/* Title */}
        {title && (
          <span className="max-w-[100px] truncate text-xs text-text-3">
            {title}
          </span>
        )}

        {/* Navigation controls */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={prev}
            disabled={currentIndex <= 0}
            className={`flex h-5 w-5 items-center justify-center rounded text-text-3 ${SURFACE_TOKENS.iconButtonHover} hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-30`}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-6 text-white hover:bg-primary-5"
          >
            {isPlaying ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button
            type="button"
            onClick={next}
            disabled={currentIndex >= totalEvents - 1}
            className={`flex h-5 w-5 items-center justify-center rounded text-text-3 ${SURFACE_TOKENS.iconButtonHover} hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-30`}
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Progress bar */}
        <div
          ref={progressBarRef}
          className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-fill-2"
          onClick={handleProgressClick}
        >
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-primary-5 transition-all duration-150"
            style={{ width: `${progress}%` }}
          />
          {/* Current position indicator */}
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary-6 shadow-sm transition-all duration-150"
            style={{ left: `${progress}%` }}
          />
        </div>

        {/* Counter */}
        <span className="min-w-[40px] text-right text-xs text-text-3">
          {currentIndex + 1}/{totalEvents}
        </span>
      </div>
    );
  }
);

CellReplayControl.displayName = "CellReplayControl";

export default CellReplayControl;
