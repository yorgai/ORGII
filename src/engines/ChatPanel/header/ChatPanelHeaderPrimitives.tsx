import React from "react";

import Switch from "@src/components/Switch";

export const CHAT_PANEL_HEADER_DRAG_STYLE = {
  WebkitAppRegion: "drag",
} as React.CSSProperties;

export const CHAT_PANEL_HEADER_NO_DRAG_STYLE = {
  WebkitAppRegion: "no-drag",
} as React.CSSProperties;

interface ChatPanelHeaderDragSpacerProps {
  className?: string;
}

export function ChatPanelHeaderDragSpacer({
  className = "min-w-0 flex-1",
}: ChatPanelHeaderDragSpacerProps): React.ReactElement {
  return (
    <div
      className={className}
      aria-hidden
      data-tauri-drag-region
      style={CHAT_PANEL_HEADER_DRAG_STYLE}
    />
  );
}

interface ChatPanelHeaderNoDragRegionProps {
  children: React.ReactNode;
  className: string;
}

export function ChatPanelHeaderNoDragRegion({
  children,
  className,
}: ChatPanelHeaderNoDragRegionProps): React.ReactElement {
  return (
    <div className={className} style={CHAT_PANEL_HEADER_NO_DRAG_STYLE}>
      {children}
    </div>
  );
}

interface ChatPanelHeaderTitlePillProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
  testId?: string;
}

export const ChatPanelHeaderTitlePill = React.forwardRef<
  HTMLSpanElement,
  ChatPanelHeaderTitlePillProps
>(function ChatPanelHeaderTitlePill(
  {
    children,
    className = "flex h-7 min-w-0 max-w-full cursor-default items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-medium text-text-1 transition-colors hover:bg-surface-hover",
    testId = "chat-panel-header-title",
    ...props
  },
  ref
): React.ReactElement {
  return (
    <span ref={ref} className={className} {...props}>
      <span className="min-w-0 truncate" data-testid={testId}>
        {children}
      </span>
    </span>
  );
});

interface ChatPanelHeaderAgentSwitchProps {
  checked: boolean;
  label: string;
  onChange: (enabled: boolean) => void;
  dataTestId: string;
}

export function ChatPanelHeaderAgentSwitch({
  checked,
  label,
  onChange,
  dataTestId,
}: ChatPanelHeaderAgentSwitchProps): React.ReactElement {
  return (
    <label className="flex h-7 shrink-0 items-center !gap-1.5 rounded-lg !border-0 !bg-transparent !px-1.5 text-[13px] font-medium !text-text-1 transition-colors hover:!bg-surface-hover">
      <span className="-translate-y-[0.5px]">{label}</span>
      <Switch
        size="small"
        checked={checked}
        onChange={onChange}
        ariaLabel={label}
        dataTestId={dataTestId}
      />
    </label>
  );
}
