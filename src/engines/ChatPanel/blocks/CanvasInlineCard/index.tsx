/**
 * CanvasInlineCard — Agent-generated interactive preview embedded in chat.
 *
 * Renders a sandboxed iframe directly in the message stream. Three modes:
 *   html  — static HTML from the agent (e.g. a report, a chart)
 *   url   — external URL (e.g. a web page the agent navigated to)
 *   a2ui  — incremental JSONL stream; elements are appended as they arrive
 *
 * Unlike the WorkStation Canvas tab (full-height simulator surface), this
 * card is compact, collapsible, and lives inline between chat messages.
 *
 * Security: html/a2ui iframes use sandbox="allow-scripts" only (no
 * allow-same-origin). URL iframes add allow-same-origin so cross-origin
 * resources load correctly, but form submission and popups are still gated.
 */
import { Layout, Monitor } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import IconButton from "@src/components/IconButton";

import { CanvasErrorBoundary } from "./CanvasErrorBoundary";
import { buildA2UIDocument, buildHtmlDocument } from "./canvasBuilder";
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

// ─── main component ───────────────────────────────────────────────────────────

const CanvasInlineCard: React.FC<CanvasInlineCardProps> = ({
  mode,
  content,
  url,
  title,
  initialHeight = 280,
  isStreaming = false,
  sessionId,
}) => {
  const { t } = useTranslation("sessions");

  const [heightStep] = useState(() => resolveInitialStep(initialHeight));

  // Separate refs for each iframe variant to avoid targeting the wrong window
  const htmlIframeRef = useRef<HTMLIFrameElement>(null);

  const currentHeight = HEIGHT_STEPS[heightStep % HEIGHT_STEPS.length];

  // Split A2UI content into individual lines once per content update
  const a2uiLines = useMemo(() => {
    if (mode !== "a2ui" || !content) return [];
    return content.split("\n").filter(Boolean);
  }, [mode, content]);

  // Full document for html/a2ui modes — used both as srcDoc initial load
  // and as fallback when postMessage incremental push is unavailable.
  // Guard with content truthiness: empty string produces a blank dark iframe,
  // which should fall through to the "Waiting / No content" fallback instead.
  const srcDoc = useMemo(() => {
    if (mode === "html" && content) return buildHtmlDocument(content);
    if (mode === "a2ui" && a2uiLines.length > 0)
      return buildA2UIDocument(a2uiLines);
    return undefined;
  }, [mode, content, a2uiLines]);

  // For A2UI: push only newly-arrived lines via postMessage to avoid a full
  // iframe reload on every streaming chunk.
  const prevA2UICountRef = useRef(0);
  useEffect(() => {
    if (mode !== "a2ui") return;
    const prev = prevA2UICountRef.current;
    const current = a2uiLines.length;
    if (current <= prev) return;

    prevA2UICountRef.current = current;

    const newLines = a2uiLines.slice(prev);
    const iframe = htmlIframeRef.current;
    if (iframe?.contentWindow) {
      try {
        iframe.contentWindow.postMessage(
          { type: "a2ui_push", lines: newLines },
          "*"
        );
      } catch {
        // Sandboxed iframes reject postMessage in some older browsers — the
        // full document is already set via srcDoc, so the content is not lost.
      }
    }
  }, [mode, a2uiLines]);

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
        : t("canvasCard.titleHtml"));

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

      {/* ── iframe ── */}
      <div
        className="relative w-full overflow-hidden transition-[height] duration-300 ease-in-out"
        style={{ height: currentHeight }}
      >
        {mode === "url" && url ? (
          // URL mode: separate ref, allow-same-origin so cross-origin assets load
          <iframe
            src={url}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms"
            title={cardTitle}
          />
        ) : srcDoc ? (
          // html / a2ui: injected srcDoc, no allow-same-origin
          <iframe
            ref={htmlIframeRef}
            srcDoc={srcDoc}
            className="h-full w-full border-0"
            sandbox="allow-scripts"
            title={cardTitle}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-xs text-text-4">
              {isStreaming ? t("canvasCard.waiting") : t("canvasCard.empty")}
            </span>
          </div>
        )}

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
