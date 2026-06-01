/**
 * SessionSyncProvider — Unified session sync mount point
 *
 * Mounted ONCE in AppLayout (inside ChatProvider) to provide session
 * event sync for ALL session types. Reads the active session ID and
 * delegates to useSessionSync which handles adapter lookup, cache
 * management, and Tauri IPC Channel subscription.
 *
 * All sessions are managed by the Rust backend via Tauri.
 */
import { useAtomValue } from "jotai";
import React from "react";

import { sessionReloadEpochMapAtom } from "@src/engines/SessionCore";
import { activeSessionIdAtom } from "@src/store/session";

import { useSessionSync } from "./useSessionSync";

const SessionSyncProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const activeSessionId = useAtomValue(activeSessionIdAtom);
  const reloadEpochMap = useAtomValue(sessionReloadEpochMapAtom);
  const reloadEpoch = activeSessionId
    ? (reloadEpochMap.get(activeSessionId) ?? 0)
    : 0;

  useSessionSync(activeSessionId ?? null, reloadEpoch);

  return <>{children}</>;
};

export default SessionSyncProvider;
