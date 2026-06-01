/**
 * Shared atoms for agent definitions fetched from the Rust backend.
 *
 * Populated by `useAgentDefinitions` on first mount. Consumed directly by
 * any component that needs the agent lists without prop threading.
 *
 * Components that need agent definitions but don't want to mount
 * `useAgentDefinitions` directly should call `useEnsureAgentDefs()` once.
 * It is a no-op after the first successful load.
 */
import { atom } from "jotai";

import type { AgentDefinition } from "../types";

/**
 * Full unfiltered list of agent definitions returned by the Rust backend.
 *
 * Single source of truth shared by every `useAgentDefinitions` instance —
 * derived atoms below project this into the user-visible split. Writing
 * to this atom is the only way a CRUD mutation propagates to every
 * consumer in the tree (without it, hooks mounted in parallel would
 * each keep their own stale local copy).
 */
export const allAgentDefsAtom = atom<AgentDefinition[]>([]);
allAgentDefsAtom.debugLabel = "allAgentDefsAtom";

/**
 * Last fetch error, surfaced to UI for actionable feedback.
 * `null` = never failed (or recovered after a successful refresh).
 */
export const agentDefsLoadErrorAtom = atom<string | null>(null);
agentDefsLoadErrorAtom.debugLabel = "agentDefsLoadErrorAtom";

/** User-visible built-in agents (internal subagents filtered out). */
export const builtInAgentsAtom = atom<AgentDefinition[]>([]);
builtInAgentsAtom.debugLabel = "builtInAgentsAtom";

/** User-created custom agents (CRUD-able). */
export const customAgentsAtom = atom<AgentDefinition[]>([]);
customAgentsAtom.debugLabel = "customAgentsAtom";

/**
 * True once at least one successful fetch has populated the above atoms.
 * Written by `useAgentDefinitions` after a successful fetch.
 * Read by `useEnsureAgentDefs` to skip redundant loads.
 */
export const agentDefsLoadedAtom = atom(false);
agentDefsLoadedAtom.debugLabel = "agentDefsLoadedAtom";
