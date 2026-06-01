import type { MutableRefObject } from "react";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { SessionAdapter, SessionEventHandler } from "./types";

export interface PartialRecoveryResult {
  found: boolean;
  recoveredEvents: SessionEvent[];
}

export type CheckAndRecoverSession = (
  sessionId: string
) => Promise<PartialRecoveryResult>;

export interface SessionSyncRefs {
  adapterRef: MutableRefObject<SessionAdapter | null>;
  handlerRef: MutableRefObject<SessionEventHandler | null>;
  prevSessionIdRef: MutableRefObject<string | null>;
  prevReloadEpochRef: MutableRefObject<number>;
  liveSessionIdRef: MutableRefObject<string | null>;
  checkAndRecoverRef: MutableRefObject<CheckAndRecoverSession>;
}
