import type { Webview } from "@tauri-apps/api/webview";
import type { RefObject } from "react";

export interface UseInlineWebviewOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  url: string;
  isActive?: boolean;
  isVisible?: boolean;
  userAgent?: string;
  labelPrefix?: string;
  useExactLabel?: boolean;
  incognito?: boolean;
  createDelay?: number;
  debug?: boolean;
  pollInterval?: number;
  onCreated?: (webview: Webview) => void;
  onDestroyed?: () => void;
  onNavigate?: (url: string) => void;
  onNewWindow?: (url: string) => void;
  onError?: (error: Error) => void;
}

export interface UseInlineWebviewReturn {
  isWebviewAvailable: boolean;
  isWebviewCreated: boolean;
  isLoading: boolean;
  currentUrl: string;
  error: Error | null;
  navigate: (url: string) => Promise<void>;
  reload: () => Promise<void>;
  evaluate: (script: string) => Promise<void>;
  destroy: () => Promise<void>;
  updatePosition: (options?: { force?: boolean }) => Promise<void>;
  pollNow: () => Promise<void>;
  webview: Webview | null;
}
