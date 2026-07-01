/**
 * Canvas App
 *
 * Renders agent-generated dynamic UI in a sandboxed iframe (html/url modes)
 * or as native React components (a2ui mode).
 *
 * Listens for canvas events from the backend via WebSocket:
 * - canvas:present     — Show HTML content or URL
 * - canvas:hide        — Hide the canvas
 * - canvas:navigate    — Navigate to a URL
 * - canvas:eval        — Execute JavaScript via A2UIRenderer.evalScript
 * - canvas:a2ui_push   — Push A2UI JSONL content (accumulated incrementally)
 * - canvas:a2ui_reset  — Reset A2UI state
 */
import { ExternalLink, Layout, Maximize2, Minimize2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import A2UIRenderer, {
  type A2UIRendererHandle,
} from "@src/engines/ChatPanel/blocks/CanvasInlineCard/A2UIRenderer";
import {
  buildHtmlDocument,
  buildReactDocument,
} from "@src/engines/ChatPanel/blocks/CanvasInlineCard/canvasBuilder";
import type { SimulatorAppProps } from "@src/engines/Simulator/apps/core/types";
import {
  NoTabsPlaceholder,
  WORK_STATION_PLACEHOLDER_PAGE_BG_CLASS,
  useSimulatorAwaitingAgentCaption,
  useSimulatorPlaceholderActions,
} from "@src/modules/WorkStation/shared";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

// ============================================
// Types
// ============================================

interface CanvasState {
  visible: boolean;
  mode: "html" | "url" | "a2ui" | "react" | "empty";
  url: string | null;
  html: string | null;
  a2uiLines: string[];
  width: number | null;
  height: number | null;
}

const INITIAL_STATE: CanvasState = {
  visible: false,
  mode: "empty",
  url: null,
  html: null,
  a2uiLines: [],
  width: null,
  height: null,
};

// ============================================
// Component
// ============================================

function CanvasApp(props: SimulatorAppProps) {
  const [state, setState] = useState<CanvasState>(INITIAL_STATE);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const a2uiRendererRef = useRef<A2UIRendererHandle>(null);
  const { t } = useTranslation("sessions");
  const { t: tCommon } = useTranslation("common");
  const simulatorPlaceholderActions = useSimulatorPlaceholderActions(
    props.mode ?? "simulation"
  );
  const simulatorAwaitingAgentCaption = useSimulatorAwaitingAgentCaption();

  useEffect(() => {
    let cancelled = false;

    function handleCanvasEvent(
      event: CustomEvent<{ type: string; data: Record<string, unknown> }>
    ) {
      if (cancelled) return;

      const { type, data } = event.detail;

      switch (type) {
        case "canvas:present":
          setState((prev) => ({
            ...prev,
            visible: true,
            mode: data.html
              ? (data.mode as CanvasState["mode"] | undefined) === "react"
                ? "react"
                : "html"
              : data.url
                ? "url"
                : prev.mode,
            url: (data.url as string) || prev.url,
            html: (data.html as string) || prev.html,
            width: (data.width as number) || prev.width,
            height: (data.height as number) || prev.height,
          }));
          break;

        case "canvas:hide":
          setState((prev) => ({ ...prev, visible: false }));
          break;

        case "canvas:navigate":
          setState((prev) => ({
            ...prev,
            visible: true,
            mode: "url",
            url: (data.url as string) || prev.url,
          }));
          break;

        case "canvas:eval":
          if (data.javascript) {
            // For a2ui mode use the renderer's sandboxed eval
            if (a2uiRendererRef.current) {
              a2uiRendererRef.current.evalScript(data.javascript as string);
            } else if (iframeRef.current?.contentWindow) {
              try {
                iframeRef.current.contentWindow.postMessage(
                  { type: "canvas_eval", javascript: data.javascript },
                  "*"
                );
              } catch {
                // Sandboxed iframe may reject postMessage
              }
            }
          }
          break;

        case "canvas:a2ui_push":
          if (data.jsonl) {
            const lines = (data.jsonl as string).split("\n").filter(Boolean);
            setState((prev) => ({
              ...prev,
              visible: true,
              mode: "a2ui",
              a2uiLines: [...prev.a2uiLines, ...lines],
            }));
          }
          break;

        case "canvas:a2ui_reset":
          setState((prev) => ({
            ...prev,
            a2uiLines: [],
            mode: prev.mode === "a2ui" ? "empty" : prev.mode,
          }));
          break;
      }
    }

    window.addEventListener(
      "canvas-event" as keyof WindowEventMap,
      handleCanvasEvent as EventListener
    );

    return () => {
      cancelled = true;
      window.removeEventListener(
        "canvas-event" as keyof WindowEventMap,
        handleCanvasEvent as EventListener
      );
    };
  }, []);

  const handleClose = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  if (!state.visible && state.mode === "empty") {
    return (
      <NoTabsPlaceholder
        icon="canvas"
        caption={simulatorAwaitingAgentCaption}
        actions={simulatorPlaceholderActions}
      />
    );
  }

  const htmlSrcDoc =
    state.mode === "html" && state.html
      ? buildHtmlDocument(state.html)
      : state.mode === "react" && state.html
        ? buildReactDocument(state.html)
        : undefined;

  return (
    <div
      className={`flex h-full flex-col ${
        isFullscreen ? "fixed inset-0 z-50 bg-bg-1" : ""
      }`}
    >
      <div className="flex items-center justify-between border-b border-border-2 bg-workstation-bg px-3 py-1.5">
        <div className="flex items-center gap-2 text-sm text-text-2">
          <Layout className="h-4 w-4" />
          <span>{t("simulator.replay.canvas.toolbarTitle")}</span>
          {state.mode === "url" && state.url && (
            <span className="max-w-[200px] truncate text-xs text-text-3">
              {state.url}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {state.mode === "url" && state.url && (
            <button
              onClick={() => window.open(state.url!, "_blank")}
              className="rounded p-1 text-text-3 hover:bg-fill-2 hover:text-text-1"
              title={t("simulator.replay.canvas.tooltipOpenInBrowser")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={handleToggleFullscreen}
            className="rounded p-1 text-text-3 hover:bg-fill-2 hover:text-text-1"
            title={
              isFullscreen
                ? t("simulator.replay.canvas.tooltipExitFullscreen")
                : t("simulator.replay.canvas.tooltipFullscreen")
            }
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={handleClose}
            className="rounded p-1 text-text-3 hover:bg-fill-2 hover:text-text-1"
            title={t("simulator.replay.canvas.tooltipCloseCanvas")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {state.mode === "url" && state.url ? (
          <iframe
            ref={iframeRef}
            src={state.url}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            title={t("simulator.replay.canvas.iframeTitle")}
          />
        ) : htmlSrcDoc ? (
          <iframe
            ref={iframeRef}
            srcDoc={htmlSrcDoc}
            className="h-full w-full border-0"
            sandbox="allow-scripts"
            title={t("simulator.replay.canvas.iframeTitle")}
          />
        ) : state.mode === "a2ui" && state.a2uiLines.length > 0 ? (
          <A2UIRenderer
            ref={a2uiRendererRef}
            lines={state.a2uiLines}
            className="h-full"
          />
        ) : (
          <Placeholder
            variant="empty"
            placement="detail-panel"
            fillParentHeight
            className={WORK_STATION_PLACEHOLDER_PAGE_BG_CLASS}
            title={tCommon("placeholders.canvasHidden")}
          />
        )}
      </div>
    </div>
  );
}

export default CanvasApp;
