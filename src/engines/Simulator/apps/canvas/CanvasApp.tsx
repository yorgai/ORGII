/**
 * CanvasApp — Simulator panel for render_inline_canvas events.
 *
 * Layout follows the Browser SessionReplay pattern:
 *   SimulatorReplayChrome  → outer tab-bar chrome
 *   WorkStationShell       → primary sidebar (canvas list) + main content
 *   usePublishWorkstationTabHeader → Canvas/Source tab switcher in the 40px header strip
 *
 * Data source: useSimulatorAppState (appEvents filtered to render_inline_canvas).
 * canvasPreviewAtom is used only for "jump from chat" auto-selection.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { Layout, RefreshCw } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import IconButton from "@src/components/IconButton";
import TabPill from "@src/components/TabPill";
import { SIMULATOR_PRIMARY_SIDEBAR } from "@src/config/simulatorPrimarySidebar";
import {
  buildA2UIDocument,
  buildHtmlDocument,
} from "@src/engines/ChatPanel/blocks/CanvasInlineCard/canvasBuilder";
import type { CanvasInlineMode } from "@src/engines/ChatPanel/blocks/CanvasInlineCard/types";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { usePublishWorkstationTabHeader } from "@src/hooks/workStation";
import { SessionReplayCodeMirrorViewer } from "@src/modules/WorkStation/CodeEditor/SessionReplay/CodePanel/SessionReplayCodeMirrorViewer";
import {
  NoDragRegion,
  SimulatorReplayChrome,
  WorkStationShell,
  buildPrimarySidebarConfig,
} from "@src/modules/WorkStation/shared";
import { canvasPreviewAtom } from "@src/store/session/canvasPreviewAtom";
import {
  simulatorPrimarySidebarCollapsedAtom,
  simulatorPrimarySidebarPositionAtom,
  simulatorPrimarySidebarWidthAtom,
  simulatorPrimarySidebarWidthPersistAtom,
} from "@src/store/ui/simulatorAtom";

import type { SimulatorAppProps } from "../core/types";
import { useSimulatorAppState } from "../core/useSimulatorAppState";
import { CANVAS_APP_CONFIG } from "./canvasConfig";

// ─── types ────────────────────────────────────────────────────────────────────

type ViewTab = "canvas" | "source";

interface CanvasPayload {
  mode: CanvasInlineMode;
  content?: string;
  url?: string;
  title?: string;
  streaming?: boolean;
}

function extractPayload(event: SessionEvent): CanvasPayload | null {
  const args = event.args as Record<string, unknown> | undefined;
  if (!args) return null;
  const mode = (args.mode as CanvasInlineMode | undefined) ?? "html";
  return {
    mode,
    content: args.content as string | undefined,
    url: args.url as string | undefined,
    title: args.title as string | undefined,
    streaming: false,
  };
}

function getDefaultTitle(
  payload: CanvasPayload,
  t: (key: string, fallback: string) => string
): string {
  if (payload.title) return payload.title;
  if (payload.mode === "url") return t("canvasCard.titleUrl", "Web Page");
  if (payload.mode === "a2ui") return t("canvasCard.titleA2ui", "Agent UI");
  return t("canvasCard.titleHtml", "Agent Preview");
}

// ─── sidebar item ──────────────────────────────────────────────────────────────

interface SidebarItemProps {
  event: SessionEvent;
  isSelected: boolean;
  onSelect: () => void;
  t: (key: string, fallback: string) => string;
}

const SidebarItem: React.FC<SidebarItemProps> = ({
  event,
  isSelected,
  onSelect,
  t,
}) => {
  const payload = extractPayload(event);
  const title = payload ? getDefaultTitle(payload, t) : event.functionName;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left transition-colors",
        isSelected
          ? "bg-fill-3 text-text-1"
          : "text-text-2 hover:bg-fill-2 hover:text-text-1",
      ].join(" ")}
    >
      <Layout
        size={12}
        className={
          isSelected ? "shrink-0 text-primary-6" : "shrink-0 text-text-4"
        }
      />
      <span className="min-w-0 flex-1 truncate text-xs">{title}</span>
    </button>
  );
};

// ─── canvas sidebar content ────────────────────────────────────────────────────

interface CanvasSidebarProps {
  appEvents: SessionEvent[];
  selectedEventId: string | null;
  onSelect: (id: string) => void;
  t: (key: string, fallback: string) => string;
}

const CanvasSidebar: React.FC<CanvasSidebarProps> = ({
  appEvents,
  selectedEventId,
  onSelect,
  t,
}) => (
  <div className="flex h-full flex-col overflow-hidden">
    <div className="shrink-0 px-3 pb-1.5 pt-3">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">
        {t("canvasApp.sidebarTitle", "Canvases")}
      </span>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
      {appEvents.length === 0 ? (
        <p className="px-2 py-2 text-xs text-text-4">
          {t("canvasApp.noCanvases", "No canvases yet")}
        </p>
      ) : (
        appEvents.map((ev) => (
          <SidebarItem
            key={ev.id}
            event={ev}
            isSelected={ev.id === selectedEventId}
            onSelect={() => onSelect(ev.id)}
            t={t}
          />
        ))
      )}
    </div>
  </div>
);

// ─── iframe viewer ─────────────────────────────────────────────────────────────

interface CanvasIframeProps {
  payload: CanvasPayload;
  reloadKey: number;
  title: string;
}

const CanvasIframe: React.FC<CanvasIframeProps> = ({
  payload,
  reloadKey,
  title,
}) => {
  const { t } = useTranslation("sessions");
  const htmlIframeRef = useRef<HTMLIFrameElement>(null);

  const a2uiLines = useMemo(() => {
    if (payload.mode !== "a2ui" || !payload.content) return [];
    return payload.content.split("\n").filter(Boolean);
  }, [payload.mode, payload.content]);

  // Guard with content truthiness: buildHtmlDocument("") produces a blank
  // dark-background iframe that looks empty — fall through to the status
  // message instead when there is no real content yet.
  const srcDoc = useMemo(() => {
    if (payload.mode === "html" && payload.content)
      return buildHtmlDocument(payload.content);
    if (payload.mode === "a2ui" && a2uiLines.length > 0)
      return buildA2UIDocument(a2uiLines);
    return undefined;
  }, [payload.mode, payload.content, a2uiLines]);

  const prevA2UICountRef = useRef(0);
  useEffect(() => {
    if (payload.mode !== "a2ui") return;
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
        // Sandboxed iframes may reject postMessage in some environments
      }
    }
  }, [payload.mode, a2uiLines]);

  useEffect(() => {
    prevA2UICountRef.current = 0;
  }, [reloadKey]);

  if (payload.mode === "url" && payload.url) {
    return (
      <iframe
        key={`url-${reloadKey}`}
        src={payload.url}
        className="h-full w-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms"
        title={title}
      />
    );
  }

  if (srcDoc) {
    return (
      <iframe
        key={`doc-${reloadKey}`}
        ref={htmlIframeRef}
        srcDoc={srcDoc}
        className="h-full w-full border-0"
        sandbox="allow-scripts"
        title={title}
      />
    );
  }

  return (
    <div className="flex h-full items-center justify-center">
      <span className="text-xs text-text-4">
        {payload.streaming
          ? t("canvasCard.waiting", "Waiting for content…")
          : t("canvasCard.empty", "No content")}
      </span>
    </div>
  );
};

// ─── tab header content (published to SimulatorWorkstationTabHeader) ───────────

interface CanvasTabHeaderProps {
  tab: ViewTab;
  onSetTab: (tab: ViewTab) => void;
  title: string;
  isStreaming: boolean;
  onReload: () => void;
}

const CanvasTabHeader: React.FC<CanvasTabHeaderProps> = ({
  tab,
  onSetTab,
  title,
  isStreaming,
  onReload,
}) => {
  const { t } = useTranslation("sessions");

  return (
    <NoDragRegion className="flex min-w-0 flex-1 items-center gap-2 px-2">
      <Layout size={13} className="shrink-0 text-primary-6" />
      <span className="min-w-0 truncate text-xs font-medium text-text-2">
        {title}
      </span>
      {isStreaming && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary-6"
        />
      )}

      <div className="ml-auto flex items-center gap-1">
        <TabPill
          variant="pill"
          size="mini"
          fillWidth={false}
          tabs={["canvas", "source"]}
          activeTab={tab}
          onChange={(key) => onSetTab(key as ViewTab)}
        />
        {tab === "canvas" && !isStreaming && (
          <IconButton
            onClick={onReload}
            className="text-text-4 hover:bg-fill-3 hover:text-text-2"
            title={t("canvasCard.reload", "Reload")}
          >
            <RefreshCw size={12} />
          </IconButton>
        )}
      </div>
    </NoDragRegion>
  );
};

// ─── main component ────────────────────────────────────────────────────────────

const CanvasApp: React.FC<SimulatorAppProps> = () => {
  const { t } = useTranslation("sessions");

  const { appEvents } = useSimulatorAppState({
    config: CANVAS_APP_CONFIG as never,
  });

  const canvasPreviewEntry = useAtomValue(canvasPreviewAtom);

  // ── sidebar atoms ────────────────────────────────────────────────────────
  const primarySidebarCollapsed = useAtomValue(
    simulatorPrimarySidebarCollapsedAtom
  );
  const primarySidebarPosition = useAtomValue(
    simulatorPrimarySidebarPositionAtom
  );
  const primarySidebarWidth = useAtomValue(simulatorPrimarySidebarWidthAtom);
  const setPrimarySidebarWidthPersist = useSetAtom(
    simulatorPrimarySidebarWidthPersistAtom
  );

  const handlePrimarySidebarWidthChange = useCallback(
    (width: number) => {
      setPrimarySidebarWidthPersist(width);
    },
    [setPrimarySidebarWidthPersist]
  );

  // ── selection state ──────────────────────────────────────────────────────

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const prevEventCountRef = useRef(0);

  // Auto-advance to the latest event when a new one arrives
  useEffect(() => {
    if (appEvents.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedEventId(null);
      prevEventCountRef.current = 0;
      return;
    }
    if (appEvents.length > prevEventCountRef.current) {
      prevEventCountRef.current = appEvents.length;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedEventId(appEvents[appEvents.length - 1].id);
    }
  }, [appEvents]);

  // Jump to matching event when canvasPreviewAtom changes (chat card click)
  useEffect(() => {
    if (!canvasPreviewEntry) return;
    const preview = canvasPreviewEntry.payload;
    const match = appEvents.find((ev) => {
      const args = ev.args as Record<string, unknown> | undefined;
      if (!args) return false;
      return (
        args.mode === preview.mode &&
        (preview.title ? args.title === preview.title : true)
      );
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (match) setSelectedEventId(match.id);
  }, [canvasPreviewEntry, appEvents]);

  const selectedEvent = useMemo(
    () => appEvents.find((ev) => ev.id === selectedEventId) ?? null,
    [appEvents, selectedEventId]
  );

  const selectedPayload = useMemo(
    () => (selectedEvent ? extractPayload(selectedEvent) : null),
    [selectedEvent]
  );

  // ── tab + reload state ───────────────────────────────────────────────────

  const [activeTab, setActiveTab] = useState<ViewTab>("canvas");
  const [reloadKey, setReloadKey] = useState(0);

  // Reset reload key and tab when selection changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReloadKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTab("canvas");
  }, [selectedEventId]);

  const handleReload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  const cardTitle = selectedPayload
    ? getDefaultTitle(selectedPayload, t)
    : t("canvasCard.titleHtml", "Agent Preview");

  // ── publish to SimulatorWorkstationTabHeader ─────────────────────────────

  const headerContent = useMemo(
    () =>
      appEvents.length > 0 && selectedPayload ? (
        <CanvasTabHeader
          tab={activeTab}
          onSetTab={setActiveTab}
          title={cardTitle}
          isStreaming={selectedPayload.streaming ?? false}
          onReload={handleReload}
        />
      ) : null,
    [appEvents.length, selectedPayload, activeTab, cardTitle, handleReload]
  );

  usePublishWorkstationTabHeader({
    host: "simulator",
    content: headerContent,
    enabled: appEvents.length > 0 && selectedPayload !== null,
  });

  // ── primary sidebar config ───────────────────────────────────────────────

  const primarySidebarConfig = useMemo(
    () =>
      buildPrimarySidebarConfig({
        content: (
          <CanvasSidebar
            appEvents={appEvents}
            selectedEventId={selectedEventId}
            onSelect={setSelectedEventId}
            t={t}
          />
        ),
        collapsed: primarySidebarCollapsed,
        size: primarySidebarWidth,
        onSizeChange: handlePrimarySidebarWidthChange,
        minSize: SIMULATOR_PRIMARY_SIDEBAR.minWidth,
        maxSize: SIMULATOR_PRIMARY_SIDEBAR.maxWidth,
        resetSize: SIMULATOR_PRIMARY_SIDEBAR.defaultWidth,
      }),
    [
      appEvents,
      selectedEventId,
      primarySidebarCollapsed,
      primarySidebarWidth,
      handlePrimarySidebarWidthChange,
      t,
    ]
  );

  // ── empty state ──────────────────────────────────────────────────────────

  if (appEvents.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg-2">
        <div className="flex flex-col items-center gap-3 text-center">
          <Layout size={28} className="text-text-4" />
          <p className="text-sm text-text-4">
            {t("canvasApp.empty", "No canvas rendered yet")}
          </p>
        </div>
      </div>
    );
  }

  // ── main content area ────────────────────────────────────────────────────

  const mainContent = (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {!selectedPayload ? (
        <div className="flex h-full items-center justify-center">
          <span className="text-xs text-text-4">
            {t("canvasCard.empty", "No content")}
          </span>
        </div>
      ) : activeTab === "canvas" ? (
        <>
          <CanvasIframe
            payload={selectedPayload}
            reloadKey={reloadKey}
            title={cardTitle}
          />
          {selectedPayload.streaming && (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 animate-pulse bg-primary-6/40"
              aria-hidden
            />
          )}
        </>
      ) : (
        <SessionReplayCodeMirrorViewer
          content={
            selectedPayload.mode === "url"
              ? (selectedPayload.url ?? "")
              : (selectedPayload.content ?? "")
          }
          language={selectedPayload.mode === "url" ? "plaintext" : "html"}
          filePath={selectedPayload.mode === "html" ? "canvas.html" : undefined}
        />
      )}
    </div>
  );

  return (
    <SimulatorReplayChrome
      tabs={[]}
      activeEventId={selectedEventId ?? ""}
      onTabClick={() => {}}
    >
      <div className="flex min-h-0 flex-1">
        <WorkStationShell
          primarySidebarConfig={primarySidebarConfig}
          content={mainContent}
          statusBar={null}
          layoutMode={primarySidebarPosition === "right" ? "right" : "left"}
          appClassName="canvas-app"
        />
      </div>
    </SimulatorReplayChrome>
  );
};

CanvasApp.displayName = "CanvasApp";
export default CanvasApp;
