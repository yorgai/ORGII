import { ChevronRight } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Placeholder } from "@src/modules/shared/layouts/blocks";

import { useSessionMessages } from "./hooks/useSessionMessages";
import { STATUS_I18N_KEYS } from "./types";
import { formatMessageLine } from "./utils";

interface SessionOutputPreviewProps {
  sessionId: string;
  isRunning: boolean;
  onSessionComplete?: () => void;
  onStatusChange?: (status: string) => void;
  onSubAgentChange?: () => void;
  defaultCollapsed?: boolean;
}

const SessionOutputPreview: React.FC<SessionOutputPreviewProps> = ({
  sessionId,
  isRunning,
  onSessionComplete,
  onStatusChange,
  onSubAgentChange,
  defaultCollapsed = false,
}) => {
  const { t } = useTranslation("projects");
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, loading, sessionStatus, isTerminalStatus } =
    useSessionMessages({
      sessionId,
      isRunning,
      onSessionComplete,
      onStatusChange,
      onSubAgentChange,
    });

  useEffect(() => {
    if (collapsed) return;
    const el = scrollRef.current;
    if (!el) return;
    const rafId = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(rafId);
  }, [messages, collapsed]);

  if (loading && messages.length === 0) {
    return (
      <div className="rounded-md bg-fill-1 p-3">
        <Placeholder variant="loading" placement="sidebar" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="rounded-md bg-fill-1 px-3 py-2">
        <span className="text-xs text-text-4">
          {t("workItems.agentWorkflow.noOutputYet")}
        </span>
      </div>
    );
  }

  return (
    <div>
      <button
        className="flex w-full items-center gap-1 rounded-t-md bg-fill-1 px-3 py-1.5 text-xs font-medium text-text-2 transition-colors hover:bg-fill-2"
        onClick={() => setCollapsed(!collapsed)}
      >
        <ChevronRight
          size={12}
          className={`transition-transform ${collapsed ? "" : "rotate-90"}`}
        />
        {t("workItems.agentWorkflow.sessionOutput")}
        {sessionStatus && isTerminalStatus(sessionStatus) && (
          <span className="ml-1 rounded bg-fill-2 px-1.5 py-0.5 text-[10px] text-text-3">
            {t(STATUS_I18N_KEYS[sessionStatus] ?? sessionStatus)}
          </span>
        )}
        <span className="ml-auto text-text-4">{messages.length}</span>
      </button>

      {!collapsed && (
        <div
          ref={scrollRef}
          className="max-h-[300px] overflow-y-auto rounded-b-md border border-t-0 border-border-2 bg-fill-1"
        >
          {messages.map((msg) => {
            const { icon, label, detail, isSubAgent } = formatMessageLine(
              msg,
              t
            );
            return (
              <div
                key={msg.id}
                className="flex items-start gap-2 border-b border-border-1 px-3 py-1.5 last:border-b-0"
              >
                <span className="mt-0.5 shrink-0 text-text-3">{icon}</span>
                <div className="min-w-0 flex-1">
                  <span
                    className={`text-xs font-medium ${isSubAgent ? "text-primary-6" : "text-text-2"}`}
                  >
                    {label}
                  </span>
                  {detail && (
                    <span className="ml-1.5 text-xs text-text-4">{detail}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SessionOutputPreview;
