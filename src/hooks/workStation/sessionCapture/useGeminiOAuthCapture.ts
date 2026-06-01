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
  exchangeGeminiOauthCode,
  startGeminiOauthLogin,
} from "@src/api/services/keyValidation";
import type { GeminiOauthExchangeResponse } from "@src/api/tauri/rpc/schemas/validation";
import { useTauriListen } from "@src/hooks/platform/useTauriListen";

import { useEmbeddedWebview } from "./useEmbeddedWebview";

interface UseGeminiOAuthCaptureOptions {
  containerRef: RefObject<HTMLDivElement>;
  onTokenCaptured?: (response: GeminiOauthExchangeResponse) => void;
  debug?: boolean;
}

interface UseGeminiOAuthCaptureReturn {
  isSigningIn: boolean;
  isSignedIn: boolean;
  isWebviewOpen: boolean;
  isWebviewLoading: boolean;
  currentUrl: string;
  authUrl: string | null;
  error: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  projectId: string | null;
  expiresIn: number | null;
  startLogin: () => Promise<void>;
  closeWebview: () => Promise<void>;
  reset: () => void;
  updatePosition: () => Promise<void>;
}

const GEMINI_OAUTH_COMMANDS = {
  create: "create_gemini_oauth_webview",
  close: "close_gemini_oauth_webview",
  updatePosition: "update_inline_webview_position",
  urlChangedEvent: "gemini-oauth-url-changed",
} as const;

const GEMINI_OAUTH_CALLBACK_ORIGIN = "http://127.0.0.1:1456";
const GEMINI_OAUTH_CALLBACK_PATH = "/oauth2callback";
const E2E_GEMINI_OAUTH_URL =
  "https://accounts.google.com/o/oauth2/v2/auth/e2e-mock";

function shouldNavigateGeminiNewWindow(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  return [
    "accounts.google.com",
    "google.com",
    "gstatic.com",
    "cloud.google.com",
    "cloudcode-pa.googleapis.com",
  ].some(
    (domain) =>
      parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
  );
}

function isGeminiOauthE2EMockEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    typeof window !== "undefined" &&
    window.__ORGII_E2E_GEMINI_OAUTH_MOCK__ === true
  );
}

export function useGeminiOAuthCapture({
  containerRef,
  onTokenCaptured,
  debug = false,
}: UseGeminiOAuthCaptureOptions): UseGeminiOAuthCaptureReturn {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [expectedState, setExpectedState] = useState<string | null>(null);
  const [codeVerifier, setCodeVerifier] = useState<string | null>(null);
  const [redirectUri, setRedirectUri] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
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
    labelPrefix: "gemini-oauth",
    containerRef,
    commands: GEMINI_OAUTH_COMMANDS,
    debug,
    ignoreAboutBlank: true,
  });

  useTauriListen<{ url: string; webviewLabel: string }>(
    "gemini-oauth-navigate-new-window",
    (payload) => {
      if (payload.webviewLabel !== label) return;
      if (!shouldNavigateGeminiNewWindow(payload.url)) return;
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
    setProjectId(null);
    setExpiresIn(null);
    setError(null);
    exchangedCodeRef.current = null;
  }, []);

  const startLogin = useCallback(async () => {
    reset();
    if (isGeminiOauthE2EMockEnabled()) {
      setAuthUrl(E2E_GEMINI_OAUTH_URL);
      setExpectedState("e2e-state");
      setCodeVerifier("e2e-verifier");
      setRedirectUri(
        `${GEMINI_OAUTH_CALLBACK_ORIGIN}${GEMINI_OAUTH_CALLBACK_PATH}`
      );
      setIsSigningIn(false);
      return;
    }

    setIsSigningIn(true);
    try {
      const start = await startGeminiOauthLogin();
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
      parsed.origin !== GEMINI_OAUTH_CALLBACK_ORIGIN ||
      parsed.pathname !== GEMINI_OAUTH_CALLBACK_PATH
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

    (async () => {
      try {
        setIsSigningIn(true);
        void closeWebview();
        const response = await exchangeGeminiOauthCode(
          callbackCode,
          callbackState,
          expectedState,
          codeVerifier,
          redirectUri
        );
        setAccessToken(response.accessToken);
        setRefreshToken(response.refreshToken);
        setProjectId(response.projectId);
        setExpiresIn(response.expiresIn ?? null);
        setIsSignedIn(true);
        setIsSigningIn(false);
        setError(null);
        onTokenCapturedRef.current?.(response);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setIsSigningIn(false);
      }
    })();
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
    projectId,
    expiresIn,
    startLogin,
    closeWebview,
    reset,
    updatePosition,
  };
}
