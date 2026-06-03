/**
 * Creator default exec mode atom
 *
 * Persists the **session creator's default** `AgentExecMode` to localStorage.
 * Primary use: pre-fill the SessionCreator's mode pill when starting a brand
 * new Rust agent session. Once a session exists, its exec mode lives on the
 * session record (`Session.agentExecMode`) and is the single source of truth.
 *
 * Allowed fallback: dispatcher hooks may read this atom ONLY as a last-resort
 * fallback when the session row has no `agentExecMode` set. In-session UI
 * components (ChatPanel `ModePill`, status bars) must read
 * `session.agentExecMode` directly and must NOT fall back to this atom.
 *
 * Legacy value `"explore"` is migrated to `"ask"` on first read so users do
 * not see an orphaned pill.
 *
 * Storage key kept as `orgii:agentExecMode` for backwards-compat with existing
 * user installs.
 */
import { atomWithStorage } from "jotai/utils";

import { normalizeAgentExecMode } from "@src/config/sessionCreatorConfig";
import type { AgentExecMode } from "@src/features/SessionCreator/config";

const STORAGE_KEY = "orgii:agentExecMode";

function migrateLegacyMode(raw: unknown): AgentExecMode {
  if (typeof raw !== "string") return "build";
  if (raw === "explore") return "ask";
  return normalizeAgentExecMode(raw) ?? "build";
}

const storage = {
  getItem(key: string, initialValue: AgentExecMode): AgentExecMode {
    if (typeof window === "undefined") return initialValue;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored == null) return initialValue;
      const parsed = JSON.parse(stored) as unknown;
      return migrateLegacyMode(parsed);
    } catch {
      return initialValue;
    }
  },
  setItem(key: string, value: AgentExecMode) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, JSON.stringify(value));
  },
  removeItem(key: string) {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
  },
};

export const creatorDefaultExecModeAtom = atomWithStorage<AgentExecMode>(
  STORAGE_KEY,
  "build",
  storage
);
