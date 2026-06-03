import type { ComponentType, ReactNode } from "react";

export interface ChatPanelRegionNotice {
  key: string;
  title: string;
  body: string;
}

/**
 * Props for the main ChatPanel component
 */
export interface ChatPanelProps {
  /** Whether to use external width management */
  useExternalWidth?: boolean;
  /** Session sidebar width for layout calculations */
  sessionSidebarWidth?: number;
  /**
   * Whether ChatPanel is embedded inside another container.
   * When true, removes external border radius for seamless integration.
   */
  embedded?: boolean;
  /**
   * Whether the docked chat surface is active for the current station.
   * When false, the panel shell may stay mounted for layout persistence,
   * but it must not mount ChatView/SessionCreator or claim session sync.
   */
  active?: boolean;
  /**
   * Position of the chat panel.
   * Affects drag handle position, border side, and header ordering.
   * @default "right"
   */
  position?: "left" | "right";
  /**
   * Slot for session creator UI rendered when no session is active.
   * Injected by the parent to avoid ChatPanel depending on SessionCreator.
   */
  sessionCreatorSlot?: ComponentType<{
    className?: string;
    variant?: "default" | "fullScreen";
    centerFullScreenContent?: boolean;
    footerSlot?: ReactNode;
    onRegionNoticeChange?: (notice: ChatPanelRegionNotice | null) => void;
    hidePresenceButton?: boolean;
    batchStartMode?: boolean;
  }>;
}
