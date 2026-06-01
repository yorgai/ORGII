/**
 * GlobalSessionSync Component
 *
 * Invisible component that runs global-level hooks at the Orgii level.
 * Must be rendered inside the provider tree (SessionProvider, ChatProvider, etc.)
 *
 * Session loading is handled by SessionSyncProvider. This component handles:
 * - EventStore → Jotai atom bridge
 * - Background session completion monitoring
 * - Message queue dispatch
 */
import React from "react";

import { useEventStoreBridge } from "@src/engines/SessionCore/core/store/useEventStoreBridge";
import { useQueueDispatch } from "@src/engines/SessionCore/hooks/session/useQueueDispatch";
import { useBackgroundSessionMonitor } from "@src/hooks/cliSession/useBackgroundSessionMonitor";
import { useNativeSessionStatusMonitor } from "@src/hooks/session/useNativeSessionStatusMonitor";

const GlobalSessionSync: React.FC = () => {
  useEventStoreBridge();
  useBackgroundSessionMonitor();
  useNativeSessionStatusMonitor();
  useQueueDispatch();
  return null;
};

export default GlobalSessionSync;
