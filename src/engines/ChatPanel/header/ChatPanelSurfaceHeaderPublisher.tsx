import React, { useMemo } from "react";

import Switch from "@src/components/Switch";

import { usePublishChatPanelHeader } from "./usePublishChatPanelHeader";

interface ChatPanelSurfaceHeaderPublisherProps {
  title?: string;
  titleContent?: React.ReactNode;
  enabled: boolean;
  showAgentSwitch?: boolean;
  agentSwitchLabel?: string;
  agentSwitchChecked?: boolean;
  onAgentSwitchChange?: (enabled: boolean) => void;
}

export function ChatPanelSurfaceHeaderPublisher({
  title,
  titleContent,
  enabled,
  showAgentSwitch = false,
  agentSwitchLabel = "Agent",
  agentSwitchChecked = false,
  onAgentSwitchChange,
}: ChatPanelSurfaceHeaderPublisherProps): null {
  const content = useMemo(() => {
    if (!enabled) return null;

    const titleNode = titleContent ?? (
      <span
        className="min-w-0 -translate-y-px truncate"
        data-testid="chat-panel-header-title"
      >
        {title}
      </span>
    );

    return {
      content: (
        <span className="flex min-w-0 max-w-full cursor-default items-center gap-2 rounded-lg px-1.5 text-[13px] font-medium text-text-1 transition-colors hover:bg-surface-hover">
          {titleNode}
          {showAgentSwitch && onAgentSwitchChange ? (
            <>
              <div
                className="h-4 w-px shrink-0 bg-border-2"
                role="separator"
                aria-hidden
              />
              <label className="flex h-7 shrink-0 items-center !gap-1.5 rounded-lg !border-0 !bg-transparent !px-1.5 text-[13px] font-medium !text-text-1 transition-colors hover:!bg-surface-hover">
                <span className="-translate-y-[0.5px]">{agentSwitchLabel}</span>
                <Switch
                  size="small"
                  checked={agentSwitchChecked}
                  onChange={onAgentSwitchChange}
                  ariaLabel={agentSwitchLabel}
                  dataTestId="chat-panel-explore-agent-search-switch"
                />
              </label>
            </>
          ) : null}
        </span>
      ),
    };
  }, [
    agentSwitchChecked,
    agentSwitchLabel,
    enabled,
    onAgentSwitchChange,
    showAgentSwitch,
    title,
    titleContent,
  ]);

  usePublishChatPanelHeader({ content, enabled });
  return null;
}
