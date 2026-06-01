/**
 * GitHubConnectWebview Component
 *
 * Inline embedded browser for the GitHub App installation flow.
 * Renders only the content — the parent wizard provides the footer.
 *
 * Also used standalone for "manage" flows via initialUrl.
 */
import {
  CheckCircle,
  Globe,
  Loader2,
  MonitorSmartphone,
  ScanSearch,
} from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import InlineAlert from "@src/components/InlineAlert";
import { SPINNER_TOKENS } from "@src/config/spinnerTokens";
import {
  type GitHubConnectResult,
  useGitHubInlineConnect,
} from "@src/hooks/git/useGitHubInlineConnect";
import useInlineWebview from "@src/hooks/platform/useInlineWebview";
import {
  SECTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import {
  SelectionGrid,
  type SelectionGridOption,
} from "@src/scaffold/WizardSystem/primitives";

import GitHubLocalDetect from "./GitHubLocalDetect";

// ============================================
// Props
// ============================================

export interface GitHubConnectWebviewProps {
  /** Called when GitHub connection succeeds — parent should refresh connections */
  onConnected?: (result: GitHubConnectResult) => void;
  /** Called when user closes the webview manually */
  onClose?: () => void;
  /** If provided, skip the connect flow and open this URL directly (e.g. manage page) */
  initialUrl?: string;
  /** Notifies parent when the embedded browser opens/closes (for layout toggling) */
  onBrowserStateChange?: (open: boolean) => void;
  /** Notifies parent when a local credential source is selected (enables Add in footer) */
  onDetectReady?: (ready: boolean) => void;
  /** Passes the selected token string to the parent for storage on Add click */
  onTokenSelect?: (token: string | null) => void;
  /** When true, parent manages padding/scroll — ConnectFlow only emits gaps between sections */
  embedded?: boolean;
}

// ============================================
// Component
// ============================================

const GitHubConnectWebview: React.FC<GitHubConnectWebviewProps> = ({
  onConnected,
  onClose,
  initialUrl,
  onBrowserStateChange,
  onDetectReady,
  onTokenSelect,
  embedded,
}) => {
  if (initialUrl) {
    return <DirectUrlWebview url={initialUrl} onClose={onClose} />;
  }

  return (
    <ConnectFlowWebview
      onConnected={onConnected}
      onClose={onClose}
      onBrowserStateChange={onBrowserStateChange}
      onDetectReady={onDetectReady}
      onTokenSelect={onTokenSelect}
      embedded={embedded}
    />
  );
};

// ============================================
// Direct URL Webview (for manage, etc.)
// ============================================

interface DirectUrlWebviewProps {
  url: string;
  onClose?: () => void;
}

const DirectUrlWebview: React.FC<DirectUrlWebviewProps> = ({
  url,
  onClose,
}) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const handleNavigate = useCallback((navigatedUrl: string) => {
    try {
      const parsed = new URL(navigatedUrl);
      const appOrigin = window.location.origin;
      if (parsed.origin === appOrigin) {
        onCloseRef.current?.();
      }
    } catch {
      // Ignore invalid URLs
    }
  }, []);

  const webview = useInlineWebview({
    containerRef,
    url,
    isActive: true,
    isVisible: true,
    labelPrefix: "github-manage",
    pollInterval: 500,
    onNavigate: handleNavigate,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BrowserBar url={webview.currentUrl} isLoading={webview.isLoading} />
      <div ref={containerRef} className="relative min-h-[300px] flex-1 bg-bg-1">
        {webview.isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Placeholder variant="loading" title={t("common:status.loading")} />
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================
// Connect Flow
// ============================================

type ConnectMethod = "github_app" | "detect_local";

interface ConnectFlowWebviewProps {
  onConnected?: (result: GitHubConnectResult) => void;
  onClose?: () => void;
  onBrowserStateChange?: (open: boolean) => void;
  onDetectReady?: (ready: boolean) => void;
  onTokenSelect?: (token: string | null) => void;
  embedded?: boolean;
}

const ConnectFlowWebview: React.FC<ConnectFlowWebviewProps> = ({
  onConnected,
  onClose,
  onBrowserStateChange,
  onDetectReady,
  onTokenSelect,
  embedded,
}) => {
  const { t } = useTranslation("integrations");
  const [method, setMethod] = useState<ConnectMethod>("github_app");
  const [browserOpen, setBrowserOpen] = useState(false);

  const handleBrowserStateChange = useCallback(
    (open: boolean) => {
      setBrowserOpen(open);
      onBrowserStateChange?.(open);
    },
    [onBrowserStateChange]
  );

  const methodOptions = useMemo<SelectionGridOption<ConnectMethod>[]>(
    () => [
      {
        key: "github_app",
        label: t("git.githubApp"),
        icon: MonitorSmartphone,
      },
      {
        key: "detect_local",
        label: t("git.detectFromSystem"),
        icon: ScanSearch,
      },
    ],
    [t]
  );

  const handleReady = useCallback(
    (token: string | null) => {
      onDetectReady?.(!!token);
      onTokenSelect?.(token);
    },
    [onDetectReady, onTokenSelect]
  );

  const methodSelector = (
    <SectionContainer>
      <SectionRow
        label={t("git.connectMethod")}
        description={t("git.connectMethodDesc")}
        layout="vertical"
      >
        <SelectionGrid
          options={methodOptions}
          selected={method}
          cardVariant="subtle"
          onSelect={setMethod}
        />
      </SectionRow>
    </SectionContainer>
  );

  const containerClass = browserOpen
    ? "flex min-h-0 flex-1 flex-col overflow-hidden"
    : embedded
      ? `flex min-h-0 flex-1 flex-col ${SECTION_GAP_CLASSES}`
      : `flex min-h-0 flex-1 flex-col scrollbar-overlay overflow-y-auto px-4 py-3 ${SECTION_GAP_CLASSES}`;

  return (
    <div className={containerClass}>
      {!browserOpen && methodSelector}

      {method === "detect_local" ? (
        <GitHubLocalDetect onReady={handleReady} />
      ) : (
        <GitHubAppFlow
          onConnected={onConnected}
          onClose={onClose}
          onBrowserStateChange={handleBrowserStateChange}
          browserOpen={browserOpen}
        />
      )}
    </div>
  );
};

// ============================================
// GitHub App Flow (existing webview OAuth)
// ============================================

interface GitHubAppFlowProps {
  onConnected?: (result: GitHubConnectResult) => void;
  onClose?: () => void;
  onBrowserStateChange?: (open: boolean) => void;
  browserOpen: boolean;
}

const GitHubAppFlow: React.FC<GitHubAppFlowProps> = ({
  onConnected,
  onClose,
  onBrowserStateChange,
  browserOpen,
}) => {
  const { t } = useTranslation("integrations");
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSuccess = useCallback(
    (result: GitHubConnectResult) => {
      onConnected?.(result);
    },
    [onConnected]
  );

  const { status, errorMessage, isLoading, currentUrl, startConnect, close } =
    useGitHubInlineConnect({
      containerRef,
      onSuccess: handleSuccess,
    });

  const handleClose = useCallback(() => {
    close();
    onClose?.();
  }, [close, onClose]);

  const isConnected = status === "success";
  const isConnecting = status === "connecting";

  useEffect(() => {
    onBrowserStateChange?.(isConnecting);
  }, [isConnecting, onBrowserStateChange]);

  if (isConnected) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <CheckCircle size={32} className="text-success-6" />
        <p className="text-sm text-text-1">{t("git.connectedSuccessfully")}</p>
        <Button size="default" onClick={handleClose}>
          {t("common:actions.done")}
        </Button>
      </div>
    );
  }

  if (browserOpen) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-fill-2">
        <BrowserBar url={currentUrl} isLoading={isLoading} />
        <div
          ref={containerRef}
          className="relative min-h-[300px] w-full flex-1 overflow-hidden bg-bg-1"
        >
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-bg-1">
              <Placeholder variant="loading" />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <SectionContainer>
        <SectionRow
          label={t("git.connectDescription")}
          description={t("git.connectHint")}
          required
        >
          <Button
            variant="primary"
            size="small"
            onClick={startConnect}
            loading={isLoading}
          >
            {t("keyVault.openBrowser")}
          </Button>
        </SectionRow>
      </SectionContainer>
      {status === "error" && (
        <InlineAlert type="danger" title={t("git.connectionFailed")}>
          {errorMessage || t("git.connectionFailed")}
        </InlineAlert>
      )}
    </>
  );
};

// ============================================
// Browser Bar (URL chrome)
// ============================================

interface BrowserBarProps {
  url: string;
  isLoading: boolean;
}

const BrowserBar: React.FC<BrowserBarProps> = ({ url, isLoading }) => {
  const displayUrl = url || "Loading...";

  return (
    <div className="flex h-9 items-center border-b border-border-2 bg-fill-2 px-3">
      {isLoading ? (
        <Loader2
          size={SPINNER_TOKENS.small}
          className="mr-2 shrink-0 animate-spin text-text-3"
        />
      ) : (
        <Globe size={12} className="mr-2 shrink-0 text-text-3" />
      )}
      <div className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-text-1">
        {displayUrl}
      </div>
    </div>
  );
};

export default GitHubConnectWebview;
