import { invoke } from "@tauri-apps/api/core";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  exchangeClaudeCodeOauthCode,
  startClaudeCodeOauthLogin,
} from "@src/api/services/keyValidation";
import type { ClaudeCodeOauthExchangeResponse } from "@src/api/tauri/rpc/schemas/validation";
import { useTauriListen } from "@src/hooks/platform/useTauriListen";

import { useEmbeddedWebview } from "./useEmbeddedWebview";

interface UseClaudeCodeOAuthCaptureOptions {
  containerRef: RefObject<HTMLDivElement>;
  onTokenCaptured?: (response: ClaudeCodeOauthExchangeResponse) => void;
  debug?: boolean;
}

interface UseClaudeCodeOAuthCaptureReturn {
  isSigningIn: boolean;
  isSignedIn: boolean;
  isWebviewOpen: boolean;
  isWebviewLoading: boolean;
  currentUrl: string;
  authUrl: string | null;
  error: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresIn: number | null;
  startLogin: () => Promise<void>;
  closeWebview: () => Promise<void>;
  reset: () => void;
  updatePosition: () => Promise<void>;
}

const CLAUDE_CODE_OAUTH_COMMANDS = {
  create: "create_claude_code_oauth_webview",
  close: "close_claude_code_oauth_webview",
  updatePosition: "update_inline_webview_position",
  urlChangedEvent: "claude-code-oauth-url-changed",
} as const;

const CLAUDE_CODE_OAUTH_CALLBACK_ORIGIN = "https://platform.claude.com";
const CLAUDE_CODE_OAUTH_CALLBACK_PATH = "/oauth/code/callback";
const E2E_CLAUDE_CODE_OAUTH_URL = "https://claude.ai/oauth/e2e-mock";

function shouldNavigateClaudeCodeNewWindow(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  return [
    "accounts.google.com",
    "github.com",
    "login.microsoftonline.com",
    "workos.com",
    "claude.ai",
    "claude.com",
    "platform.claude.com",
  ].some(
    (domain) =>
      parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
  );
}

function isClaudeCodeOauthE2EMockEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    typeof window !== "undefined" &&
    window.__ORGII_E2E_CLAUDE_OAUTH_MOCK__ === true
  );
}

export function useClaudeCodeOAuthCapture({
  containerRef,
  onTokenCaptured,
  debug = false,
}: UseClaudeCodeOAuthCaptureOptions): UseClaudeCodeOAuthCaptureReturn {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [expectedState, setExpectedState] = useState<string | null>(null);
  const [codeVerifier, setCodeVerifier] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exchangedCodeRef = useRef<string | null>(null);
  const onTokenCapturedRef = useRef(onTokenCaptured);

  useEffect(() => {
    onTokenCapturedRef.current = onTokenCaptured;
  }, [onTokenCaptured]);

  const {
    isOpen: isWebviewOpen,
    isLoading: isWebviewLoading,
    currentUrl,
    label,
    openWebview,
    closeWebview,
    updatePosition,
  } = useEmbeddedWebview({
    labelPrefix: "claude-code-oauth",
    containerRef,
    commands: CLAUDE_CODE_OAUTH_COMMANDS,
    debug,
    ignoreAboutBlank: true,
  });

  useTauriListen<{ url: string; webviewLabel: string }>(
    "claude-code-oauth-navigate-new-window",
    (payload) => {
      if (payload.webviewLabel !== label) return;
      if (!shouldNavigateClaudeCodeNewWindow(payload.url)) return;
      void invoke("navigate_inline_webview", {
        label,
        url: payload.url,
      }).catch(() => undefined);
    }
  );

  const reset = useCallback(() => {
    setIsSigningIn(false);
    setIsSignedIn(false);
    setAuthUrl(null);
    setExpectedState(null);
    setCodeVerifier(null);
    setAccessToken(null);
    setRefreshToken(null);
    setExpiresIn(null);
    setError(null);
    exchangedCodeRef.current = null;
  }, []);

  const startLogin = useCallback(async () => {
    reset();
    if (isClaudeCodeOauthE2EMockEnabled()) {
      setAuthUrl(E2E_CLAUDE_CODE_OAUTH_URL);
      setExpectedState("e2e-state");
      setCodeVerifier("e2e-verifier");
      setIsSigningIn(false);
      return;
    }

    setIsSigningIn(true);
    try {
      const start = await startClaudeCodeOauthLogin();
      setAuthUrl(start.authUrl);
      setExpectedState(start.state);
      setCodeVerifier(start.codeVerifier);
      await openWebview(start.authUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsSigningIn(false);
    }
  }, [openWebview, reset]);

  const parsedCallback = useMemo(() => {
    if (!currentUrl) return null;

    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return null;
    }

    if (
      parsed.origin !== CLAUDE_CODE_OAUTH_CALLBACK_ORIGIN ||
      parsed.pathname !== CLAUDE_CODE_OAUTH_CALLBACK_PATH
    ) {
      return null;
    }

    const code = parsed.searchParams.get("code");
    const state = parsed.searchParams.get("state");
    const oauthError = parsed.searchParams.get("error");
    const oauthErrorDescription = parsed.searchParams.get("error_description");

    return { code, state, oauthError, oauthErrorDescription };
  }, [currentUrl]);

  useEffect(() => {
    if (!parsedCallback) return;

    if (parsedCallback.oauthError) {
      queueMicrotask(() => {
        setError(
          parsedCallback.oauthErrorDescription ?? parsedCallback.oauthError
        );
        setIsSigningIn(false);
      });
      return;
    }

    if (
      !parsedCallback.code ||
      !parsedCallback.state ||
      !expectedState ||
      !codeVerifier
    ) {
      return;
    }

    const callbackCode = parsedCallback.code;
    const callbackState = parsedCallback.state;

    if (exchangedCodeRef.current === callbackCode) return;
    exchangedCodeRef.current = callbackCode;

    let cancelled = false;

    (async () => {
      try {
        const response = await exchangeClaudeCodeOauthCode(
          callbackCode,
          callbackState,
          expectedState,
          codeVerifier
        );
        if (cancelled) return;
        setAccessToken(response.accessToken);
        setRefreshToken(response.refreshToken ?? null);
        setExpiresIn(response.expiresIn ?? null);
        setIsSignedIn(true);
        setIsSigningIn(false);
        setError(null);
        onTokenCapturedRef.current?.(response);
        await closeWebview();
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setIsSigningIn(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [closeWebview, codeVerifier, expectedState, parsedCallback]);

  return {
    isSigningIn,
    isSignedIn,
    isWebviewOpen,
    isWebviewLoading,
    currentUrl,
    authUrl,
    error,
    accessToken,
    refreshToken,
    expiresIn,
    startLogin,
    closeWebview,
    reset,
    updatePosition,
  };
}
