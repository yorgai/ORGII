import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  Loader2,
  LogIn,
  RefreshCw,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import InlineAlert from "@src/components/InlineAlert";
import { SPINNER_TOKENS } from "@src/config/spinnerTokens";
import { useGeminiOAuthCapture } from "@src/hooks/workStation/sessionCapture";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

export interface GeminiSessionValues {
  accessToken: string;
  refreshToken: string;
  projectId: string;
  expiresIn?: number;
  expiresAt: string;
  availableModels: string[];
  tokenType?: string | null;
  scope?: string | null;
}

export interface GeminiSessionSetupProps {
  onSessionCaptured?: (values: GeminiSessionValues) => void;
  onBrowserStateChange?: (isOpen: boolean) => void;
  debug?: boolean;
  tokenDetected?: boolean;
  tokenError?: string | null;
  onClearTokenError?: () => void;
  closeSignal?: number;
}

const GeminiSessionSetup: React.FC<GeminiSessionSetupProps> = ({
  onSessionCaptured,
  onBrowserStateChange,
  debug = false,
  tokenDetected = false,
  tokenError = null,
  onClearTokenError,
  closeSignal = 0,
}) => {
  const { t } = useTranslation("integrations");
  const [showBrowser, setShowBrowser] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const browserAutoStartedRef = useRef(false);

  const {
    isSigningIn,
    isSignedIn,
    isWebviewOpen,
    isWebviewLoading,
    currentUrl,
    authUrl,
    error,
    accessToken,
    projectId,
    startLogin,
    closeWebview,
    reset,
    updatePosition,
  } = useGeminiOAuthCapture({
    containerRef,
    debug,
    onTokenCaptured: (response) => {
      onSessionCaptured?.({
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        projectId: response.projectId,
        expiresIn: response.expiresIn ?? undefined,
        expiresAt: response.expiresAt,
        availableModels: response.availableModels,
        tokenType: response.tokenType,
        scope: response.scope,
      });
    },
  });

  useEffect(() => {
    onBrowserStateChange?.(showBrowser);
  }, [showBrowser, onBrowserStateChange]);

  useEffect(() => {
    if (!isWebviewOpen && isSignedIn) {
      queueMicrotask(() => setShowBrowser(false));
    }
  }, [isSignedIn, isWebviewOpen]);

  useEffect(() => {
    if (!showBrowser) {
      browserAutoStartedRef.current = false;
      return;
    }
    if (
      browserAutoStartedRef.current ||
      isWebviewOpen ||
      isSigningIn ||
      isSignedIn
    ) {
      return;
    }

    browserAutoStartedRef.current = true;
    const timer = setTimeout(() => {
      void startLogin();
    }, 100);

    return () => clearTimeout(timer);
  }, [isSignedIn, isSigningIn, isWebviewOpen, showBrowser, startLogin]);

  useEffect(() => {
    if (!isWebviewOpen) return;

    let rafId: number | null = null;
    let lastRect = { x: 0, y: 0, width: 0, height: 0 };

    const scheduleUpdate = () => {
      if (rafId !== null) return;

      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!containerRef.current) return;

        const rect = containerRef.current.getBoundingClientRect();
        if (
          rect.left !== lastRect.x ||
          rect.top !== lastRect.y ||
          rect.width !== lastRect.width ||
          rect.height !== lastRect.height
        ) {
          lastRect = {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          };
          void updatePosition();
        }
      });
    };

    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    scheduleUpdate();
    const intervalId = setInterval(scheduleUpdate, 200);

    return () => {
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      clearInterval(intervalId);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isWebviewOpen, updatePosition]);

  const handleCloseBrowser = useCallback(() => {
    void closeWebview();
    setShowBrowser(false);
  }, [closeWebview]);

  useEffect(() => {
    if (closeSignal <= 0 || !showBrowser) return;
    queueMicrotask(() => handleCloseBrowser());
  }, [closeSignal, handleCloseBrowser, showBrowser]);

  const handleRetry = useCallback(() => {
    reset();
    setShowBrowser(true);
    void startLogin();
  }, [reset, startLogin]);

  const hasToken = tokenDetected || isSignedIn || Boolean(accessToken);
  const displayError = error ?? tokenError;
  const currentStep = hasToken ? 2 : 1;

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col"
      data-testid="gemini-session-setup"
    >
      {!showBrowser ? (
        <SectionContainer>
          <SectionRow
            label={
              hasToken
                ? t("keyVault.geminiSignedIn")
                : t("keyVault.geminiSignInTitle")
            }
            description={
              hasToken ? t("keyVault.signedIn") : t("keyVault.geminiSignInDesc")
            }
            required
          >
            <Button
              variant={hasToken ? "success" : "primary"}
              appearance={hasToken ? "outline" : "solid"}
              size="default"
              loading={isSigningIn || isWebviewLoading}
              disabled={isSigningIn || isWebviewLoading}
              onClick={() => setShowBrowser(true)}
              className="h-8 min-h-8"
              data-testid="gemini-oauth-signin"
            >
              {hasToken
                ? `✓ ${t("keyVault.signedIn")}`
                : t("keyVault.signInWithGemini")}
            </Button>
          </SectionRow>
        </SectionContainer>
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden bg-fill-2"
          data-testid="gemini-oauth-browser-shell"
        >
          <div className="flex h-10 items-center border-b border-border-2 bg-fill-2 px-3">
            <div
              className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-text-1"
              data-testid="gemini-oauth-current-url"
            >
              {currentUrl || authUrl || t("keyVault.geminiReadyToSignIn")}
            </div>
            <Button
              variant="tertiary"
              size="mini"
              icon={<RefreshCw size={12} />}
              iconOnly
              onClick={handleRetry}
            />
            <Button
              variant="tertiary"
              size="mini"
              icon={<X size={14} />}
              iconOnly
              onClick={handleCloseBrowser}
              data-testid="gemini-oauth-browser-close"
            />
          </div>

          <div className="flex h-9 items-center justify-between gap-2 border-b border-border-2 bg-fill-2 px-4">
            <div className="flex items-center gap-2">
              <StepIndicator
                step={1}
                currentStep={currentStep}
                label={t("keyVault.loginStep")}
                completed={hasToken}
              />
              <ChevronRight size={14} className="text-text-3" />
              <StepIndicator
                step={2}
                currentStep={currentStep}
                label={t("keyVault.signedIn")}
                completed={hasToken}
              />
            </div>
            {!hasToken && (
              <span className="text-[12px] text-text-2">
                {t("keyVault.geminiBrowserHint")}
              </span>
            )}
          </div>

          <div
            ref={containerRef}
            className="relative min-h-0 w-full flex-1 overflow-hidden bg-bg-1"
            data-testid="gemini-oauth-webview-container"
          >
            {(isSigningIn || isWebviewLoading) && (
              <div className="absolute inset-0 flex items-center justify-center bg-bg-1">
                <Loader2
                  size={SPINNER_TOKENS.default}
                  className="animate-spin text-primary-6"
                />
                <span className="ml-2 text-text-2">
                  {t("keyVault.loadingText")}
                </span>
              </div>
            )}
            {displayError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg-1 p-6 text-center">
                <AlertCircle size={32} className="mb-3 text-danger-6" />
                <div className="mb-2 text-[14px] text-text-2">
                  {t("keyVault.failedToLoadBrowser")}
                </div>
                <div className="mb-4 text-[12px] text-text-3">
                  {displayError}
                </div>
                <Button variant="primary" size="default" onClick={handleRetry}>
                  {t("common:actions.retry")}
                </Button>
              </div>
            )}
            {!isWebviewOpen && !isSigningIn && !displayError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg-1 p-6 text-center">
                {hasToken ? (
                  <CheckCircle size={32} className="mb-3 text-success-6" />
                ) : (
                  <LogIn size={32} className="mb-3 text-text-3" />
                )}
                <div className="mb-2 text-[14px] font-medium text-text-1">
                  {hasToken
                    ? t("keyVault.geminiSignedIn")
                    : t("keyVault.geminiReadyToSignIn")}
                </div>
                <div className="mb-4 max-w-sm text-[12px] text-text-3">
                  {hasToken
                    ? t("keyVault.geminiOAuthHint")
                    : t("keyVault.geminiBrowserHint")}
                </div>
                {!hasToken && (
                  <Button
                    variant="primary"
                    size="default"
                    onClick={handleRetry}
                  >
                    {t("keyVault.signInWithGemini")}
                  </Button>
                )}
              </div>
            )}
          </div>

          {projectId && (
            <InlineAlert type="success">
              {t("keyVault.geminiProjectId", { projectId })}
            </InlineAlert>
          )}
        </div>
      )}

      {hasToken && !showBrowser && (
        <InlineAlert type="success" title={t("keyVault.geminiSignedIn")}>
          <div className="flex items-center gap-2">
            <CheckCircle size={14} />
            <span>{t("keyVault.geminiOAuthHint")}</span>
          </div>
        </InlineAlert>
      )}

      {displayError && !showBrowser && (
        <InlineAlert
          type="danger"
          title={displayError}
          onClose={onClearTokenError}
        >
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5" />
            <span>{t("keyVault.geminiSignInErrorHint")}</span>
          </div>
        </InlineAlert>
      )}
    </div>
  );
};

interface StepIndicatorProps {
  step: number;
  currentStep: number;
  label: string;
  completed: boolean;
}

const StepIndicator: React.FC<StepIndicatorProps> = ({
  step,
  currentStep,
  label,
  completed,
}) => (
  <div className="flex items-center gap-1.5">
    <div
      className={[
        "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium",
        completed
          ? "bg-success/15 text-success"
          : currentStep === step
            ? "bg-accent/15 text-accent"
            : "bg-fill-3 text-text-3",
      ].join(" ")}
    >
      {completed ? <CheckCircle size={12} /> : step}
    </div>
    <span
      className={[
        "text-[12px]",
        completed || currentStep === step ? "text-text-1" : "text-text-3",
      ].join(" ")}
    >
      {label}
    </span>
  </div>
);

export default GeminiSessionSetup;
