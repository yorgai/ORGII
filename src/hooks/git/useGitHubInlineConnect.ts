/**
 * useGitHubInlineConnect — OSS stub.
 *
 * The inline-webview GitHub-App OAuth flow is unavailable in the OSS
 * build; users add a GitHub connection via local PAT/SSH credentials.
 * This stub keeps the export shape stable so callers compile.
 */
import { type RefObject, useCallback } from "react";

export type GitHubConnectStatus = "idle" | "connecting" | "success" | "error";

export interface GitHubConnectResult {
  account?: string;
  reposCount?: string;
  error?: string;
}

export interface UseGitHubInlineConnectOptions {
  containerRef: RefObject<HTMLDivElement>;
  onSuccess?: (result: GitHubConnectResult) => void;
  onError?: (error: string) => void;
}

export interface UseGitHubInlineConnectReturn {
  status: GitHubConnectStatus;
  result: GitHubConnectResult | null;
  errorMessage: string | null;
  isLoading: boolean;
  currentUrl: string;
  startConnect: () => Promise<void>;
  close: () => void;
  reset: () => void;
}

export function useGitHubInlineConnect(
  options: UseGitHubInlineConnectOptions
): UseGitHubInlineConnectReturn {
  const { onError } = options;

  const startConnect = useCallback(async () => {
    const msg =
      "GitHub App OAuth is unavailable in the OSS build. " +
      "Add a local PAT or SSH credential instead.";
    console.warn("[useGitHubInlineConnect] " + msg);
    onError?.(msg);
  }, [onError]);

  const noop = useCallback(() => {
    /* no-op */
  }, []);

  return {
    status: "idle",
    result: null,
    errorMessage: null,
    isLoading: false,
    currentUrl: "",
    startConnect,
    close: noop,
    reset: noop,
  };
}

export default useGitHubInlineConnect;
