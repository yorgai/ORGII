/**
 * CanvasInlineCard — Agent-generated interactive preview embedded in chat.
 *
 * Renders a card directly in the message stream. Three modes:
 *   html  — sanitized HTML rendered in Shadow DOM
 *   url   — external URL shown as an open action, not embedded
 *   a2ui  — incremental JSONL stream rendered as native React components
 *   react — script source is not executed inline; use a2ui for native rendering
 *
 * For a2ui mode the previous iframe + postMessage approach has been replaced
 * with A2UIRenderer, which receives the parsed lines directly as props and
 * re-renders incrementally without any full reload.
 *
 * Security:
 *   - html path: DOMPurify + Shadow DOM, no scripts/events
 *   - url/react: not embedded in chat to avoid iframe/runtime overhead
 *   - a2ui: DOMPurify sanitizes type="html" elements in A2UIRenderer
 */
import DOMPurify from "dompurify";
import { Layout, Monitor } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";

import {
  EventBlockHeader,
  EventBlockHeaderIcon,
  EventBlockHeaderSubtitle,
  EventBlockHeaderTitle,
  getEventBlockContainerClasses,
} from "../primitives";
import { useBlockHeader } from "../useBlockLocate";
import A2UIRenderer, { type A2UIRendererHandle } from "./A2UIRenderer";
import { CanvasErrorBoundary } from "./CanvasErrorBoundary";
import type { CanvasInlineCardProps } from "./types";

// ─── height steps ─────────────────────────────────────────────────────────────

const HEIGHT_STEPS = [240, 400, 580] as const;

function resolveInitialStep(initialHeight: number): number {
  const idx = HEIGHT_STEPS.findIndex((h) => h >= initialHeight);
  return idx >= 0 ? idx : 0;
}

// ─── A2UI JSONL splitter ──────────────────────────────────────────────────────

/**
 * Split a JSONL content string into individual element strings.
 *
 * Naïve `content.split("\n")` corrupts elements whose string fields contain
 * real newlines (e.g. `{"type":"code","content":"a\nb\nc"}`): the inner
 * newlines get treated as element separators, shredding one valid JSON record
 * into many invalid fragments. The a2ui core then throws
 * "Cannot create component el-N without a type".
 *
 * Strategy: walk physical lines, accumulating into a buffer. After each line
 * is appended, try `JSON.parse(buffer)`. On success → emit + reset. On
 * failure → keep accumulating, re-attaching the `\n` so multi-line string
 * values survive intact. Lines that never parse (truly malformed input) are
 * dropped at end-of-input.
 */
function splitA2UIContent(content: string): string[] {
  const result: string[] = [];
  const physicalLines = content.split("\n");
  let buffer = "";
  for (const line of physicalLines) {
    buffer = buffer.length === 0 ? line : `${buffer}\n${line}`;
    const trimmed = buffer.trim();
    if (trimmed.length === 0) {
      buffer = "";
      continue;
    }
    try {
      JSON.parse(trimmed);
      result.push(trimmed);
      buffer = "";
    } catch {
      // Incomplete JSON — keep accumulating across physical newlines.
    }
  }
  // Discard any trailing partial buffer (mid-stream chunk, not yet closed).
  return result;
}

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

// ─── static HTML lightweight renderer ─────────────────────────────────────────

const STATIC_HTML_STYLES = `
  :host{display:block;height:100%;min-width:0;overflow:hidden;background:var(--color-bg-1);color:var(--color-text-1);font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;}
  *,*::before,*::after{box-sizing:border-box;}
  a{color:var(--color-primary-6);text-decoration:none;}
  a:hover{text-decoration:underline;}
  pre,code{font-family:monospace;background:var(--color-fill-2);padding:2px 5px;border-radius:4px;font-size:.875em;}
  pre{padding:12px 16px;overflow-x:auto;border-radius:6px;border:1px solid var(--color-border-1);}
  pre code{background:none;padding:0;}
  img{max-width:100%;height:auto;border-radius:4px;}
  ::-webkit-scrollbar{width:6px;height:6px;}
  ::-webkit-scrollbar-track{background:transparent;}
  ::-webkit-scrollbar-thumb{background:var(--color-fill-4);border-radius:3px;}
`;

const STATIC_HTML_CONTAINMENT_STYLES = `
  :host{contain:layout paint style;isolation:isolate;}
  .canvas-static-html{position:relative;height:100%;min-width:0;max-width:100%;overflow:auto;contain:layout paint style;isolation:isolate;}
  .canvas-static-html *{max-width:100%;}
`;

function extractStaticHtmlBody(content: string): string {
  const bodyMatch = content.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch?.[1] ?? content;
}

function extractStaticHtmlStyles(content: string): string {
  return Array.from(content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    .map((match) => match[1].replace(/<\/style/gi, ""))
    .join("\n");
}

const StaticHtmlCanvas: React.FC<{ content: string }> = ({ content }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const safeContent = useMemo(() => {
    return DOMPurify.sanitize(extractStaticHtmlBody(content), {
      FORBID_TAGS: [
        "script",
        "iframe",
        "object",
        "embed",
        "link",
        "meta",
        "base",
        "style",
      ],
      FORBID_ATTR: ["srcdoc"],
    });
  }, [content]);
  const styles = useMemo(() => extractStaticHtmlStyles(content), [content]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${STATIC_HTML_STYLES}</style><style>${styles}</style><style>${STATIC_HTML_CONTAINMENT_STYLES}</style><div class="canvas-static-html">${safeContent}</div>`;
  }, [safeContent, styles]);

  return (
    <div ref={hostRef} className="h-full min-w-0 max-w-full overflow-hidden" />
  );
};

const NonEmbeddedCanvasNotice: React.FC<{
  title: string;
  description: string;
  action?: React.ReactNode;
}> = ({ title, description, action }) => (
  <div className="flex h-full items-center justify-center p-4">
    <div className="flex max-w-sm flex-col items-center gap-3 text-center">
      <Layout size={24} strokeWidth={1.5} className="text-text-4" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-text-2">{title}</div>
        <div className="text-xs leading-5 text-text-4">{description}</div>
      </div>
      {action}
    </div>
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
  eventId,
  sessionId,
  onAction,
}) => {
  const { t } = useTranslation("sessions");

  const [heightStep] = useState(() => resolveInitialStep(initialHeight));
  const rendererRef = useRef<A2UIRendererHandle>(null);
  const {
    isCollapsed,
    isHeaderHovered,
    handleHeaderClick,
    handleLocate,
    handleHeaderMouseEnter,
    handleHeaderMouseLeave,
  } = useBlockHeader({
    defaultCollapsed: false,
    eventId,
    collapseAllValue: true,
  });

  const currentHeight = HEIGHT_STEPS[heightStep % HEIGHT_STEPS.length];

  // Split A2UI content into individual JSONL elements — React state update on
  // each streaming chunk causes A2UIRenderer to diff only new elements.
  //
  // We can't naïvely split on "\n": elements like `code` carry multi-line
  // content whose real newlines must not be treated as JSONL separators
  // (otherwise the element JSON gets shredded and the a2ui core throws
  // "Cannot create component el-N without a type"). Instead, scan
  // line-by-line and only emit a JSONL element once the accumulated buffer
  // parses as a complete JSON value.
  const a2uiLines = useMemo(() => {
    if (mode !== "a2ui" || !content) return [];
    return splitA2UIContent(content);
  }, [mode, content]);
  const cardTitle =
    title ??
    (mode === "url"
      ? t("canvasCard.titleUrl")
      : mode === "a2ui"
        ? t("canvasCard.titleA2ui")
        : mode === "react"
          ? t("canvasCard.titleReact", "React Preview")
          : t("canvasCard.titleHtml"));

  const headerSubtitle = isStreaming
    ? t("canvasCard.streaming", "streaming")
    : mode === "url" && url
      ? url
      : undefined;

  // ── render content area ───────────────────────────────────────────────────

  let contentArea: React.ReactNode;

  if (mode === "url" && url) {
    contentArea = (
      <NonEmbeddedCanvasNotice
        title={t("canvasCard.openUrlTitle", "Preview not embedded")}
        description={t(
          "canvasCard.openUrlDescription",
          "External URLs are not embedded in chat to avoid iframe memory overhead."
        )}
        action={
          <Button
            variant="secondary"
            size="small"
            onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
            icon={<Monitor size={14} />}
          >
            {t("canvasCard.openExternal", "Open in Browser")}
          </Button>
        }
      />
    );
  } else if (mode === "html" && content) {
    contentArea = <StaticHtmlCanvas content={content} />;
  } else if (mode === "react" && content) {
    contentArea = (
      <NonEmbeddedCanvasNotice
        title={t("canvasCard.reactDisabledTitle", "React preview disabled")}
        description={t(
          "canvasCard.reactDisabledDescription",
          "Agent JavaScript is not executed inside chat. Use A2UI for native interactive previews."
        )}
      />
    );
  } else if (mode === "a2ui" && isStreaming && a2uiLines.length === 0) {
    // Full skeleton: stream started but no JSONL elements parsed yet.
    contentArea = <CanvasLoadingSkeleton />;
  } else if (mode === "a2ui" && a2uiLines.length > 0) {
    contentArea = (
      <A2UIRenderer
        ref={rendererRef}
        lines={a2uiLines}
        isStreaming={isStreaming}
        onAction={onAction}
        sessionId={sessionId}
        className="h-full"
      />
    );
  } else {
    contentArea = (
      <div className="flex h-full items-center justify-center">
        <span className="text-xs text-text-4">{t("canvasCard.empty")}</span>
      </div>
    );
  }

  return (
    <div className={`group/canvas ${getEventBlockContainerClasses()}`}>
      <EventBlockHeader
        isCollapsed={isCollapsed}
        className={
          isCollapsed
            ? "border-b border-solid border-transparent"
            : "border-b border-solid border-border-1"
        }
        onClick={handleHeaderClick}
        onNavigate={eventId ? handleLocate : undefined}
        onMouseEnter={handleHeaderMouseEnter}
        onMouseLeave={handleHeaderMouseLeave}
        withHover
      >
        <EventBlockHeaderIcon
          icon={<Layout size={14} className="text-primary-6" />}
          isCollapsed={isCollapsed}
          isHeaderHovered={isHeaderHovered}
          onToggle={handleHeaderClick}
          hasContent
        />
        <EventBlockHeaderTitle>{cardTitle}</EventBlockHeaderTitle>
        {headerSubtitle && (
          <EventBlockHeaderSubtitle title={headerSubtitle}>
            {headerSubtitle}
          </EventBlockHeaderSubtitle>
        )}
      </EventBlockHeader>

      {!isCollapsed && (
        <div
          className="relative w-full overflow-hidden transition-[height] duration-300 ease-in-out"
          style={{ height: currentHeight }}
        >
          <div className="h-full min-w-0 max-w-full">{contentArea}</div>

          {/* Streaming progress bar — pulsing accent line at bottom edge */}
          {isStreaming && (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 animate-pulse bg-primary-6/40"
              aria-hidden
            />
          )}
        </div>
      )}
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
