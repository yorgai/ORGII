/**
 * useBrowserState Hook
 *
 * Core browser state management logic extracted from BrowserContext.
 * Can be used standalone or with BrowserContext.
 *
 * Manages:
 * - Browser sessions (tabs)
 * - Active session tracking
 * - Adding/closing sessions
 * - Updating session data
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

import type { BrowserSession } from "../types";

// Helper function to extract title from URL
const getTitleFromUrl = (url: string): string => {
  if (!url) return "New Tab";
  try {
    const urlObj = new URL(url);
    return urlObj.hostname || "New Tab";
  } catch {
    return "New Tab";
  }
};

// Default initial state
const getDefaultState = (): {
  sessions: BrowserSession[];
  activeSessionId: string;
} => {
  const defaultSessionId = uuidv4();
  return {
    sessions: [
      {
        id: defaultSessionId,
        title: "New Tab",
        url: "",
        history: [],
        historyIndex: -1,
        isLoading: false,
        error: null,
        incognito: false,
      },
    ],
    activeSessionId: defaultSessionId,
  };
};

export interface UseBrowserStateOptions {
  /** Initial sessions */
  initialSessions?: BrowserSession[];
  /** Initial active session ID */
  initialActiveSessionId?: string;
  /** Callback when sessions change */
  onSessionsChange?: (
    sessions: BrowserSession[],
    activeSessionId: string
  ) => void;
}

export interface UseBrowserStateReturn {
  /** All browser sessions */
  sessions: BrowserSession[];
  /** Currently active session ID */
  activeSessionId: string;
  /** Currently active session object */
  activeSession: BrowserSession | undefined;
  /** Add a new session */
  addSession: (url?: string, incognito?: boolean) => string;
  /** Close a session */
  closeSession: (sessionId: string) => void;
  /** Switch to a session */
  setActiveSession: (sessionId: string) => void;
  /** Update a session */
  updateSession: (sessionId: string, updates: Partial<BrowserSession>) => void;
  /** Force save sessions to storage (optional, for adapters) */
  forceSave?: () => void;
}

/**
 * Core browser state hook
 */
export function useBrowserState(
  options: UseBrowserStateOptions = {}
): UseBrowserStateReturn {
  const { initialSessions, initialActiveSessionId, onSessionsChange } = options;

  // Initialize state
  const [sessions, setSessions] = useState<BrowserSession[]>(() => {
    if (initialSessions && initialSessions.length > 0) {
      return initialSessions;
    }
    return getDefaultState().sessions;
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    if (initialActiveSessionId) {
      return initialActiveSessionId;
    }
    if (initialSessions && initialSessions.length > 0) {
      return initialSessions[0].id;
    }
    return getDefaultState().activeSessionId;
  });

  // Always-current ref so closeSession's setSessions updater can read the
  // latest activeSessionId. Updated in a layout effect so it is always
  // synchronised before any user event handlers run.
  const activeSessionIdRef = useRef(activeSessionId);

  // Keep ref in sync after each render. useLayoutEffect fires synchronously
  // after DOM mutations, before any user interaction, so the ref is always
  // current by the time closeSession runs.
  useLayoutEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // Get active session
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Add a new session
  const addSession = useCallback(
    (url?: string, incognito = false): string => {
      const newSessionId = uuidv4();
      const newSession: BrowserSession = {
        id: newSessionId,
        title: url ? getTitleFromUrl(url) : "New Tab",
        url: url || "",
        history: url ? [url] : [],
        historyIndex: url ? 0 : -1,
        historyEntries: url
          ? [{ url, title: getTitleFromUrl(url), visitedAt: Date.now() }]
          : [],
        isLoading: !!url,
        error: null,
        incognito,
      };

      setSessions((prev) => [...prev, newSession]);
      setActiveSessionId(newSessionId);

      onSessionsChange?.([...sessions, newSession], newSessionId);

      return newSessionId;
    },
    [sessions, onSessionsChange]
  );

  // Close a session
  const closeSession = useCallback(
    (sessionId: string) => {
      setSessions((prev) => {
        const filtered = prev.filter((s) => s.id !== sessionId);

        // Use the ref so we always see the latest activeSessionId even if this
        // updater runs in a batched render where the closure value is stale.
        const currentActiveId = activeSessionIdRef.current;

        if (filtered.length === 0) {
          const newSessionId = uuidv4();
          const newSession: BrowserSession = {
            id: newSessionId,
            title: "New Tab",
            url: "",
            history: [],
            historyIndex: -1,
            historyEntries: [],
            isLoading: false,
            error: null,
            incognito: false,
          };
          setActiveSessionId(newSessionId);
          onSessionsChange?.([newSession], newSessionId);
          return [newSession];
        }

        if (sessionId === currentActiveId) {
          const nextId = filtered[0].id;
          setActiveSessionId(nextId);
          onSessionsChange?.(filtered, nextId);
        } else {
          onSessionsChange?.(filtered, currentActiveId);
        }

        return filtered;
      });
    },
    [onSessionsChange]
  );

  // Switch to a session
  const setActiveSession = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      onSessionsChange?.(sessions, sessionId);
    },
    [sessions, onSessionsChange]
  );

  // Update a specific session
  const updateSession = useCallback(
    (sessionId: string, updates: Partial<BrowserSession>) => {
      setSessions((prev) => {
        const updated = prev.map((s) =>
          s.id === sessionId ? { ...s, ...updates } : s
        );
        onSessionsChange?.(updated, activeSessionId);
        return updated;
      });
    },
    [activeSessionId, onSessionsChange]
  );

  return {
    sessions,
    activeSessionId,
    activeSession,
    addSession,
    closeSession,
    setActiveSession,
    updateSession,
  };
}
