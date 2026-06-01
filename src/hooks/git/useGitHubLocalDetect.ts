/**
 * useGitHubLocalDetect Hook
 *
 * Detects local GitHub credentials (gh CLI, SSH keys, credential helper)
 * and optionally stores a detected token for use by the app's GitHub API commands.
 */
import { useCallback, useState } from "react";

import {
  type DetectedGitHubCredentials,
  detectGitHubCredentials,
  storeDetectedGitHubToken,
} from "@src/api/tauri/github";

export interface UseGitHubLocalDetectReturn {
  detecting: boolean;
  results: DetectedGitHubCredentials | null;
  detectError: string | null;
  storing: boolean;
  stored: boolean;
  storedUsername: string | null;
  storeError: string | null;
  detect: () => Promise<DetectedGitHubCredentials | null>;
  storeToken: (userId: string, token: string) => Promise<void>;
  reset: () => void;
}

export function useGitHubLocalDetect(): UseGitHubLocalDetectReturn {
  const [detecting, setDetecting] = useState(false);
  const [results, setResults] = useState<DetectedGitHubCredentials | null>(
    null
  );
  const [detectError, setDetectError] = useState<string | null>(null);

  const [storing, setStoring] = useState(false);
  const [stored, setStored] = useState(false);
  const [storedUsername, setStoredUsername] = useState<string | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);

  const detect =
    useCallback(async (): Promise<DetectedGitHubCredentials | null> => {
      setDetecting(true);
      setDetectError(null);
      setResults(null);
      setStored(false);
      setStoredUsername(null);
      setStoreError(null);

      try {
        const detected = await detectGitHubCredentials();
        setResults(detected);
        return detected;
      } catch (err: unknown) {
        setDetectError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setDetecting(false);
      }
    }, []);

  const storeToken = useCallback(async (userId: string, token: string) => {
    setStoring(true);
    setStoreError(null);

    try {
      const result = await storeDetectedGitHubToken(userId, token);
      setStored(true);
      setStoredUsername(result.username);
    } catch (err: unknown) {
      setStoreError(err instanceof Error ? err.message : String(err));
    } finally {
      setStoring(false);
    }
  }, []);

  const reset = useCallback(() => {
    setDetecting(false);
    setResults(null);
    setDetectError(null);
    setStoring(false);
    setStored(false);
    setStoredUsername(null);
    setStoreError(null);
  }, []);

  return {
    detecting,
    results,
    detectError,
    storing,
    stored,
    storedUsername,
    storeError,
    detect,
    storeToken,
    reset,
  };
}
