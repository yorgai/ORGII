/**
 * WingmanWindow
 *
 * Rendered inside a dedicated always-on-top Tauri window ("/windows/wingman").
 * Behaves like a Zoom meeting panel — floats above all other apps, stays
 * visible while the user works.
 *
 * Mounts the full ChatView (ChatHistory + InputArea) inside the standard
 * provider stack so the user can see tool progress and send follow-up
 * messages to the Wingman agent without switching to the main window.
 */
import { Airplay } from "lucide-react";
import React, { memo, useState } from "react";

import { ChatProvider } from "@src/contexts/workspace/ChatContext";
import { DataProvider } from "@src/contexts/workspace/DataContext";
import ChatView from "@src/engines/ChatPanel/ChatView";
import SessionSyncProvider from "@src/engines/SessionCore/sync/SessionSyncProvider";
import { useTauriListen } from "@src/hooks/platform/useTauriListen";

import { useWingmanWindowThemeSurface } from "../useWingmanWindowThemeSurface";

// ── Helpers ────────────────────────────────────────────────────────────────

function getParam(key: string): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(key) ?? "";
}

// ── Component ──────────────────────────────────────────────────────────────

const WingmanWindow: React.FC = memo(() => {
  useWingmanWindowThemeSurface();

  const [mission, setMission] = useState(() =>
    decodeURIComponent(getParam("mission") || "")
  );
  const [sessionId, setSessionId] = useState(() => getParam("sessionId"));
  const [caption, setCaption] = useState(() =>
    decodeURIComponent(getParam("caption") || "")
  );
  const [stopped, setStopped] = useState(false);

  useTauriListen<{ sessionId: string }>("wingman:stopped", (payload) => {
    if (payload.sessionId !== sessionId && sessionId) return;
    setStopped(true);
  });

  useTauriListen<{ sessionId: string }>("wingman:started", (payload) => {
    if (payload.sessionId !== sessionId && sessionId) return;
    setStopped(false);
  });

  useTauriListen<{ sessionId: string; mission?: string; caption?: string }>(
    "wingman:window-context",
    (payload) => {
      setSessionId(payload.sessionId);
      if (typeof payload.mission === "string") setMission(payload.mission);
      if (typeof payload.caption === "string") setCaption(payload.caption);
      setStopped(false);
    }
  );

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-bg-1 text-text-1"
      style={{ backgroundColor: "var(--color-bg-1, #ffffff)" }}
    >
      {mission && (
        <div className="shrink-0 border-b border-border-2 px-3 py-2">
          <p className="text-[11px] text-text-3">Mission</p>
          <p className="mt-0.5 line-clamp-2 text-[12px] text-text-1">
            {mission}
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <DataProvider>
          <ChatProvider>
            <SessionSyncProvider>
              {sessionId ? (
                <ChatView sessionId={sessionId} surfaceBgClass="bg-bg-1" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <Airplay
                    size={28}
                    strokeWidth={1.25}
                    className="text-text-3"
                  />
                  <p className="text-[12px] text-text-3">
                    {caption ||
                      (stopped
                        ? "Wingman stopped."
                        : "Watching your screen\u2026")}
                  </p>
                </div>
              )}
            </SessionSyncProvider>
          </ChatProvider>
        </DataProvider>
      </div>
    </div>
  );
});

WingmanWindow.displayName = "WingmanWindow";

export default WingmanWindow;
