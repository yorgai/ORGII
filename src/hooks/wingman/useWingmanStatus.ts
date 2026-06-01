/**
 * useWingmanStatus
 *
 * Lightweight hook that tracks which session (if any) has an active
 * Wingman background loop. Listens to wingman:started / wingman:stopped.
 */
import { useState } from "react";

import { useTauriListen } from "@src/hooks/platform/useTauriListen";

interface WingmanLifecyclePayload {
  sessionId: string;
}

export function useWingmanStatus() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useTauriListen<WingmanLifecyclePayload>("wingman:started", (payload) => {
    setActiveSessionId(payload.sessionId);
  });

  useTauriListen<WingmanLifecyclePayload>("wingman:stopped", (payload) => {
    setActiveSessionId((prev) => (prev === payload.sessionId ? null : prev));
  });

  return { activeSessionId };
}
