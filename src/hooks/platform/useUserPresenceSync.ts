/**
 * User Presence Sync Hook
 *
 * Pushes the fully-resolved presence wire snapshot (mode + label +
 * guidance + behavior policy numbers) to the Rust backend whenever it
 * changes, and once on startup. The backend's global presence state
 * drives runtime enforcement that must work even when no message is in
 * flight:
 *   - re-arming auto-resolve deadlines on pending questions / plans,
 *   - starting/stopping the goal continuation loop.
 *
 * The per-message `IdeContext.userPresence` wire snapshot (collected in
 * AdeContextCollector) continues to feed prompt building.
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtomValue } from "jotai";
import { useEffect } from "react";

import { createLogger } from "@src/hooks/logger";
import { userPresenceWireAtom } from "@src/store/user/userPresenceAtom";

const log = createLogger("UserPresenceSync");

export function useUserPresenceSync() {
  const wire = useAtomValue(userPresenceWireAtom);

  useEffect(() => {
    if (!wire) return;
    invoke("set_user_presence", { presence: wire }).catch((error) => {
      log.error("[UserPresenceSync] Failed to push presence:", error);
    });
  }, [wire]);
}
