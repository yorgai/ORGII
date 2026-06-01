/**
 * useAgentConfig Hook
 *
 * Handles business logic for Agent appearance settings.
 * Persists through `chatAppearancePersistAtom`, which writes to
 * `settings.jsonc` via the central settings system (not localStorage).
 */
import { useAtom } from "jotai";
import { useCallback } from "react";

import {
  ChatAppearanceSettings,
  chatAppearancePersistAtom,
} from "@src/store/config/configAtom";

// ============================================
// Hook Return Interface
// ============================================

export interface UseAgentConfigReturn {
  /** Chat appearance settings */
  chatAppearance: ChatAppearanceSettings;
  /** Update chat appearance (persists to settings.jsonc). */
  updateChatAppearance: (updates: Partial<ChatAppearanceSettings>) => void;
}

// ============================================
// Hook Implementation
// ============================================

/**
 * Hook for managing Agent appearance configuration. Settings are
 * automatically persisted to `settings.jsonc` via `chatAppearancePersistAtom`.
 */
export function useAgentConfig(): UseAgentConfigReturn {
  // Global state with persistence
  const [chatAppearance, setChatAppearance] = useAtom(
    chatAppearancePersistAtom
  );

  // ============================================
  // Update Functions
  // ============================================

  const updateChatAppearance = useCallback(
    (updates: Partial<ChatAppearanceSettings>) => {
      setChatAppearance(updates);
    },
    [setChatAppearance]
  );

  // ============================================
  // Return Values
  // ============================================

  return {
    chatAppearance,
    updateChatAppearance,
  };
}

export default useAgentConfig;
