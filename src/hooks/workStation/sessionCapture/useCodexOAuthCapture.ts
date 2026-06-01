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
  exchangeCodexOauthCode,
  startCodexOauthLogin,
} from "@src/api/services/keyValidation";
import type { CodexOauthExchangeResponse } from "@src/api/tauri/rpc/schemas/validation";
import { useTauriListen } from "@src/hooks/platform/useTauriListen";

import { useEmbeddedWebview } from "./useEmbeddedWebview";

interface UseCodexOAuthCaptureOptions {
  containerRef: RefObject<HTMLDivElement>;
  onTokenCaptured?: (response: CodexOauthExchangeResponse) => void;
  debug?: boolean;
}

interface UseCodexOAuthCaptureReturn {
  isSigningIn: boolean;
  isSignedIn: boolean;
  isWebviewOpen: boolean;
  isWebviewLoading: boolean;
  currentUrl: string;
  authUrl: string | null;
  error: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  expiresIn: number | null;
  startLogin: () => Promise<void>;
  closeWebview: () => Promise<void>;
  reset: () => void;
  updatePosition: () => Promise<void>;
}

const CODEX_OAUTH_COMMANDS = {
  create: "create_codex_oauth_webview",
  close: "close_codex_oauth_webview",
  updatePosition: "update_inline_webview_position",
  urlChangedEvent: "codex-oauth-url-changed",
} as const;

const CODEX_OAUTH_CALLBACK_ORIGIN = "http://localhost:1455";
const CODEX_OAUTH_CALLBACK_PATH = "/auth/callback";
const E2E_CODEX_OAUTH_URL = "https://auth.openai.com/oauth/e2e-mock";

function shouldNavigateCodexNewWindow(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  return [
    "auth.openai.com",
    "chatgpt.com",
    "chat.openai.com",
    "openai.com",
    "accounts.google.com",
    "github.com",
    "login.microsoftonline.com",
  ].some(
    (domain) =>
      parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
  );
}

function isCodexOauthE2EMockEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    typeof window !== "undefined" &&
    window.__ORGII_E2E_CODEX_OAUTH_MOCK__ === true
  );
}

export function useCodexOAuthCapture({
  containerRef,
  onTokenCaptured,
  debug = false,
}: UseCodexOAuthCaptureOptions): UseCodexOAuthCaptureReturn {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [expectedState, setExpectedState] = useState<string | null>(null);
  const [codeVerifier, setCodeVerifier] = useState<string | null>(null);
  const [redirectUri, setRedirectUri] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
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
    labelPrefix: "codex-oauth",
    containerRef,
    commands: CODEX_OAUTH_COMMANDS,
    debug,
    ignoreAboutBlank: true,
  });

  useTauriListen<{ url: string; webviewLabel: string }>(
    "codex-oauth-navigate-new-window",
    (payload) => {
      if (payload.webviewLabel !== label) return;
      if (!shouldNavigateCodexNewWindow(payload.url)) return;
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
    setRedirectUri(null);
    setAccessToken(null);
    setRefreshToken(null);
    setIdToken(null);
    setExpiresIn(null);
    setError(null);
    exchangedCodeRef.current = null;
  }, []);

  const startLogin = useCallback(async () => {
    reset();
    if (isCodexOauthE2EMockEnabled()) {
      setAuthUrl(E2E_CODEX_OAUTH_URL);
      setExpectedState("e2e-state");
      setCodeVerifier("e2e-verifier");
      setRedirectUri(
        `${CODEX_OAUTH_CALLBACK_ORIGIN}${CODEX_OAUTH_CALLBACK_PATH}`
      );
      setIsSigningIn(false);
      return;
    }

    setIsSigningIn(true);
    try {
      const start = await startCodexOauthLogin();
      setAuthUrl(start.authUrl);
      setExpectedState(start.state);
      setCodeVerifier(start.codeVerifier);
      setRedirectUri(start.redirectUri);
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
      parsed.origin !== CODEX_OAUTH_CALLBACK_ORIGIN ||
      parsed.pathname !== CODEX_OAUTH_CALLBACK_PATH
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
      !codeVerifier ||
      !redirectUri
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
        const response = await exchangeCodexOauthCode(
          callbackCode,
          callbackState,
          expectedState,
          codeVerifier,
          redirectUri
        );
        if (cancelled) return;
        setAccessToken(response.accessToken);
        setRefreshToken(response.refreshToken);
        setIdToken(response.idToken);
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
  }, [closeWebview, codeVerifier, expectedState, parsedCallback, redirectUri]);

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
    idToken,
    expiresIn,
    startLogin,
    closeWebview,
    reset,
    updatePosition,
  };
}
