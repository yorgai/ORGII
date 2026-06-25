/**
 * CanvasInlineCard — Agent-generated interactive preview embedded in chat.
 *
 * Renders a card directly in the message stream. Three modes:
 *   html  — static HTML from the agent, sandboxed iframe (security isolation)
 *   url   — external URL, sandboxed iframe with allow-same-origin
 *   a2ui  — incremental JSONL stream rendered as native React components
 *   react — generated React App source rendered inside a sandboxed iframe
 *
 * For a2ui mode the previous iframe + postMessage approach has been replaced
 * with A2UIRenderer, which receives the parsed lines directly as props and
 * re-renders incrementally without any full reload.
 *
 * Security:
 *   - html iframes: sandbox="allow-scripts" only (no allow-same-origin)
 *   - url iframes: allow-same-origin so cross-origin assets load correctly
 *   - a2ui: DOMPurify sanitizes type="html" elements in A2UIRenderer
 */
import { Layout, Monitor } from "lucide-react";
import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import IconButton from "@src/components/IconButton";

import { CanvasErrorBoundary } from "./CanvasErrorBoundary";
import CanvasPreviewSurface, {
  type CanvasPreviewSurfaceHandle,
} from "./CanvasPreviewSurface";
import type { CanvasInlineCardProps } from "./types";
import { useJumpToSimulatorCanvas } from "./useJumpToSimulatorCanvas";

// ─── height steps ─────────────────────────────────────────────────────────────

const HEIGHT_STEPS = [240, 400, 580] as const;

function resolveInitialStep(initialHeight: number): number {
  const idx = HEIGHT_STEPS.findIndex((h) => h >= initialHeight);
  return idx >= 0 ? idx : 0;
}

// ─── streaming cursor ─────────────────────────────────────────────────────────

const StreamingDot: React.FC = () => (
  <span
    aria-hidden
    className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary-6"
  />
);

// ─── loading skeleton ─────────────────────────────────────────────────────────

/**
 * Skeleton placeholder shown while the A2UI stream has not yet produced any
 * parseable elements. Mirrors a plausible canvas card layout: heading bar,
 * content lines, and a chart/table rectangle — all in the card's dark theme
 * using design-system fill tokens.
 */
const CanvasLoadingSkeleton: React.FC = () => (
  <div
    className="flex h-full flex-col gap-3 p-4"
    aria-busy="true"
    aria-label="Loading canvas content"
  >
    {/* Heading bar — ~60% width */}
    <div className="h-4 w-3/5 animate-pulse rounded bg-fill-3" />

    {/* Content lines — varying widths */}
    <div className="flex flex-col gap-2">
      <div className="h-3 w-full animate-pulse rounded bg-fill-3" />
      <div className="h-3 w-[85%] animate-pulse rounded bg-fill-3" />
      <div className="h-3 w-[70%] animate-pulse rounded bg-fill-3" />
    </div>

    {/* Chart / table placeholder rectangle */}
    <div className="mt-1 h-24 w-full animate-pulse rounded-md bg-fill-3" />
  </div>
);

// ─── main component ───────────────────────────────────────────────────────────

const CanvasInlineCard: React.FC<CanvasInlineCardProps> = ({
  mode,
  content,
  url,
  title,
  initialHeight = 280,
  isStreaming = false,
  sessionId,
  onAction,
}) => {
  const { t } = useTranslation("sessions");

  const [heightStep] = useState(() => resolveInitialStep(initialHeight));
  const rendererRef = useRef<CanvasPreviewSurfaceHandle>(null);

  const currentHeight = HEIGHT_STEPS[heightStep % HEIGHT_STEPS.length];

  const simulatorPayload = useMemo(
    () => ({ mode, content, url, title, streaming: isStreaming }),
    [mode, content, url, title, isStreaming]
  );
  const handleJumpToSimulator = useJumpToSimulatorCanvas(
    sessionId,
    simulatorPayload
  );

  const cardTitle =
    title ??
    (mode === "url"
      ? t("canvasCard.titleUrl")
      : mode === "a2ui"
        ? t("canvasCard.titleA2ui")
        : mode === "react"
          ? t("canvasCard.titleReact", "React Artifact")
          : t("canvasCard.titleHtml"));

  const emptyFallback = (
    <div className="flex h-full items-center justify-center">
      <span className="text-xs text-text-4">{t("canvasCard.empty")}</span>
    </div>
  );

  const contentArea = (
    <CanvasPreviewSurface
      ref={rendererRef}
      payload={simulatorPayload}
      variant="inline"
      title={cardTitle}
      loadingFallback={<CanvasLoadingSkeleton />}
      emptyFallback={emptyFallback}
      sessionId={sessionId}
      onAction={onAction}
    />
  );

  return (
    <div className="group/canvas my-2 overflow-hidden rounded-lg border border-border-1 bg-bg-2">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between border-b border-border-1 bg-fill-2 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Layout size={13} className="shrink-0 text-primary-6" />
          <span className="truncate text-xs font-medium text-text-2">
            {cardTitle}
          </span>
          {isStreaming && <StreamingDot />}
          {mode === "url" && url && (
            <span className="max-w-[160px] truncate text-xs text-text-4">
              {url}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/canvas:opacity-100">
          {handleJumpToSimulator && (
            <IconButton
              onClick={handleJumpToSimulator}
              className="text-text-4 hover:bg-fill-3 hover:text-primary-6"
              title={t("canvasCard.viewInSimulator", "View in Simulator")}
            >
              <Monitor size={12} />
            </IconButton>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div
        className="relative w-full overflow-x-auto overflow-y-hidden transition-[height] duration-300 ease-in-out"
        style={{ height: currentHeight }}
      >
        <div className="h-full min-w-full">{contentArea}</div>

        {/* Streaming progress bar — pulsing accent line at bottom edge */}
        {isStreaming && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 animate-pulse bg-primary-6/40"
            aria-hidden
          />
        )}
      </div>
    </div>
  );
};

CanvasInlineCard.displayName = "CanvasInlineCard";

const CanvasInlineCardWithBoundary: React.FC<CanvasInlineCardProps> = (
  props
) => (
  <CanvasErrorBoundary>
    <CanvasInlineCard {...props} />
  </CanvasErrorBoundary>
);
CanvasInlineCardWithBoundary.displayName = "CanvasInlineCardWithBoundary";

export default CanvasInlineCardWithBoundary;
export type { CanvasInlineCardProps } from "./types";
