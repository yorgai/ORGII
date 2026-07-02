/**
 * Fork-relay completion layer (design §16.11, "fork & continue").
 *
 * `collabSyncEngineHelpers.forkSession` lands a teammate's replayable history
 * as a writable local session (fresh `agentsession-*` id, `forkedFrom`
 * provenance, events durably cached). That record alone is not yet a working
 * relay — two gaps remain, both closed here:
 *
 * 1. **Dispatchability + durability.** The Rust side has no builtin prefix
 *    mapping for `agentsession-*` (agent-core `BUILTIN_PREFIX_REGISTRY` knows
 *    only `osagent-`/`sdeagent-`/`wingman-`), so the lazy `init_session` on
 *    the first `agent_send_message` can resolve an agent definition ONLY from
 *    a persisted `agent_sessions.agent_definition_id`. Without a backend row
 *    the first send fails ("no persisted agent_definition_id and no builtin
 *    prefix mapping"), and the TS-only session row is wiped by the next full
 *    `loadSessions()` list replace. `forkTeammateSession` therefore registers
 *    a real `agent_sessions` row via the existing `agent_save_session`
 *    command (definition `builtin:sde`, the fork's workspace path) — making
 *    the fork runnable and list-refresh-proof with zero Rust changes.
 *
 * 2. **LLM context continuity.** The agent's conversation context is rebuilt
 *    from `agent_messages` (`load_llm_history`), NOT from the display event
 *    cache the fork inherited — a fork starts with an empty message table, so
 *    without help the agent is blind to the teammate's context ("agent 在我的
 *    机器上用我的 key 从对方的上下文接着跑" would be false). There is no
 *    Tauri command to seed `agent_messages`, so the handoff rides the FIRST
 *    message instead: `buildPendingForkHandoff` wraps the user's first send
 *    with a bounded digest of the inherited events (same technique as the
 *    proven `externalHistoryFork.ts` Codex handoff), while `displayText`
 *    keeps the user's own words in the transcript. The handoff is one-shot
 *    and durable across restarts (localStorage registry), consumed by
 *    `markForkHandoffConsumed` only after the send succeeds.
 *
 * The registry doubles as durable provenance: backend list reloads rebuild
 * `Session` rows from Rust (which does not know `forkedFrom`), so
 * `getSessionForkedFrom` falls back to the registry when the row field is
 * gone — "⑂ taken over from @owner" survives reloads.
 */
import { z } from "zod/v4";

import { saveSession } from "@src/api/tauri/agent";
import type { SessionMeta } from "@src/api/tauri/agent";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import type {
  Session,
  SessionForkedFrom,
} from "@src/store/session/sessionAtom/types";
import { BUILTIN_SDE_DEF_ID } from "@src/util/session/sessionDispatch";

import type {
  ForkSessionResult,
  RemoteSessionFetchOptions,
} from "./engine/collabSyncEngineHelpers";
import { forkSession } from "./engine/collabSyncEngineHelpers";

export type { ForkSessionResult, RemoteSessionFetchOptions };

// ============================================================================
// Durable fork-relay registry (provenance + one-shot handoff marker)
// ============================================================================

const FORK_RELAY_STORAGE_KEY = "orgii:collabForkRelay:v1";

/** Registry size cap — evicts the oldest fork (by forkedAt) past this. */
const MAX_REGISTRY_ENTRIES = 100;

const SessionForkedFromSchema = z.object({
  orgId: z.string(),
  sourceSessionId: z.string(),
  ownerMemberId: z.string(),
  ownerDisplayName: z.string(),
  atCount: z.number(),
  forkedAt: z.string(),
}) satisfies z.ZodType<SessionForkedFrom>;

const ForkRelayEntrySchema = z.object({
  forkedFrom: SessionForkedFromSchema,
  /** True until the first successful message send consumes the handoff. */
  handoffPending: z.boolean(),
});

type ForkRelayEntry = z.output<typeof ForkRelayEntrySchema>;

const ForkRelayRegistrySchema = z.record(z.string(), ForkRelayEntrySchema);

type ForkRelayRegistry = z.output<typeof ForkRelayRegistrySchema>;

function readRegistry(): ForkRelayRegistry {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(FORK_RELAY_STORAGE_KEY);
    if (!raw) return {};
    return ForkRelayRegistrySchema.parse(JSON.parse(raw));
  } catch {
    // Corrupt / legacy payload: fork provenance is a convenience, never a
    // reason to break the fork flow itself.
    return {};
  }
}

function writeRegistry(registry: ForkRelayRegistry): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(FORK_RELAY_STORAGE_KEY, JSON.stringify(registry));
  } catch {
    // Quota exceeded — same silent posture as the session list persistence.
  }
}

function writeRegistryEntry(sessionId: string, entry: ForkRelayEntry): void {
  const registry = readRegistry();
  registry[sessionId] = entry;
  const ids = Object.keys(registry);
  if (ids.length > MAX_REGISTRY_ENTRIES) {
    const oldestFirst = ids.sort((left, right) =>
      registry[left].forkedFrom.forkedAt.localeCompare(
        registry[right].forkedFrom.forkedAt
      )
    );
    for (const id of oldestFirst.slice(0, ids.length - MAX_REGISTRY_ENTRIES)) {
      delete registry[id];
    }
  }
  writeRegistry(registry);
}

/**
 * Fork provenance for a session row — the read API for "⑂ taken over from
 * @owner" badges. Prefers the live `Session.forkedFrom` field and falls back
 * to the durable registry (list reloads rebuild rows from the backend, which
 * does not know the field).
 */
export function getSessionForkedFrom(
  session: Pick<Session, "session_id" | "forkedFrom">
): SessionForkedFrom | undefined {
  return session.forkedFrom ?? readRegistry()[session.session_id]?.forkedFrom;
}

// ============================================================================
// The full fork action (engine fork + backend registration + relay arming)
// ============================================================================

/**
 * THE fork-and-continue action for the collab panel (design §16.11). Wraps
 * the engine-level `forkSession` (which lands the events + TS session record)
 * and completes the relay:
 *
 * 1. registers the real `agent_sessions` backend row (`agent_save_session`)
 *    so the fork is dispatchable (definition resolution) and survives full
 *    session-list reloads;
 * 2. records durable provenance and arms the one-shot first-send handoff.
 *
 * Returns null exactly when `forkSession` does (no published segments);
 * THROWS when the backend registration fails — the fork would look fine in
 * the list but break on the first send, so the caller must surface it as a
 * failed (retryable) fork instead.
 */
export async function forkTeammateSession(
  options: RemoteSessionFetchOptions
): Promise<ForkSessionResult | null> {
  const result = await forkSession(options);
  if (!result) return null;

  const { orgId, remoteSession } = options;
  const now = new Date().toISOString();

  // UnifiedSessionRecord requires `session_type`; SessionMeta's zod input
  // schema passes unknown keys through (catchall), so the extra field
  // reaches the Rust record intact. "sde" = coding session (session_type
  // module in agent-core), matching the builtin:sde definition below.
  const backendRecord = {
    sessionId: result.localSessionId,
    name: result.name,
    status: "completed",
    createdAt: now,
    updatedAt: now,
    workspacePath: remoteSession.repoPath,
    // agentsession-* has no builtin prefix mapping in agent-core, so the
    // persisted definition id is THE thing that makes the lazy init_session
    // on the first agent_send_message resolve an agent (see module doc).
    agentDefinitionId: BUILTIN_SDE_DEF_ID,
    sessionType: "sde",
  } as SessionMeta;
  await saveSession(backendRecord);

  writeRegistryEntry(result.localSessionId, {
    forkedFrom: {
      orgId,
      sourceSessionId: remoteSession.sourceSessionId,
      ownerMemberId: remoteSession.ownerMemberId,
      ownerDisplayName: remoteSession.ownerDisplayName,
      atCount: result.eventCount,
      forkedAt: now,
    },
    handoffPending: true,
  });

  return result;
}

// ============================================================================
// First-send handoff (LLM context continuity)
// ============================================================================

const MAX_HANDOFF_ITEMS = 80;
const MAX_ITEM_TEXT_LENGTH = 1200;

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const parts = value.map(textValue).filter(Boolean);
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      textValue(record.text) ??
      textValue(record.content) ??
      textValue(record.message) ??
      textValue(record.output) ??
      textValue(record.observation) ??
      textValue(record.summary)
    );
  }
  return undefined;
}

function truncateText(text: string): string {
  return text.length > MAX_ITEM_TEXT_LENGTH
    ? `${text.slice(0, MAX_ITEM_TEXT_LENGTH)}…`
    : text;
}

function eventToHandoffItem(event: SessionEvent): string | undefined {
  const actionType = event.actionType ?? "";
  // Thinking is the owner's model-internal state — never part of a handoff
  // (same rule as the Codex external-history fork).
  if (actionType.includes("thinking") || actionType.includes("reasoning")) {
    return undefined;
  }

  const primary =
    (event.displayText || "").trim() ||
    textValue(event.result) ||
    textValue(event.args);

  if (event.source === "user") {
    return primary ? `User: ${truncateText(primary)}` : undefined;
  }
  if (actionType === "tool_call" || actionType.includes("tool")) {
    const lines = [
      "[Inherited session action]",
      `Tool: ${event.functionName || "unknown_tool"}`,
    ];
    const argsText = textValue(event.args);
    const resultText = textValue(event.result);
    if (argsText) lines.push(`Input: ${truncateText(argsText)}`);
    if (resultText)
      lines.push(`Result at that time: ${truncateText(resultText)}`);
    return lines.join("\n");
  }
  return primary ? `Assistant: ${truncateText(primary)}` : undefined;
}

/** Exported for tests; assembles the wrapped first-send content. */
export function buildForkHandoffPrompt(
  events: SessionEvent[],
  forkedFrom: SessionForkedFrom,
  userText: string
): string {
  const items = events
    .map(eventToHandoffItem)
    .filter((item): item is string => Boolean(item))
    .slice(-MAX_HANDOFF_ITEMS);

  return [
    "You are taking over a teammate's shared ORGII session and continuing it as your own session.",
    `Original owner: ${forkedFrom.ownerDisplayName}. The transcript below is the inherited history (${forkedFrom.atCount} events) from their machine, provided as read-only context.`,
    "Do not treat inherited tool calls as tools you executed or as current workspace state. Results may be stale; verify files, commands, and outcomes against the current workspace before relying on them.",
    "Thinking/reasoning items were intentionally omitted.",
    "",
    "## Inherited session context",
    items.length > 0
      ? items.join("\n\n")
      : "No usable transcript items were found.",
    "",
    "## Continuation request",
    userText,
  ].join("\n");
}

export interface ForkHandoffContent {
  /** Wire content for the LLM: handoff digest + the user's message. */
  content: string;
  /** What the transcript should show — the user's own words. */
  displayText: string;
}

/**
 * When `sessionId` is a fork whose handoff has not been consumed yet, build
 * the wrapped first-send content from the inherited events (bounded digest).
 * Pure read — call `markForkHandoffConsumed` after the send SUCCEEDS so a
 * failed send retries with the handoff intact. Returns null for every
 * non-fork session and for forks that already relayed their context.
 */
export async function buildPendingForkHandoff(
  sessionId: string,
  userText: string
): Promise<ForkHandoffContent | null> {
  const entry = readRegistry()[sessionId];
  if (!entry?.handoffPending) return null;

  const events = await eventStoreProxy.getPersistedEvents(sessionId);
  // Slice to the fork point: by first-send time the composer may already have
  // appended the new user's own message to the store — inherited history is
  // exactly the first `atCount` events.
  const inherited = events.slice(0, entry.forkedFrom.atCount);
  return {
    content: buildForkHandoffPrompt(inherited, entry.forkedFrom, userText),
    displayText: userText,
  };
}

/** Consume the one-shot handoff after the wrapped send succeeded. */
export function markForkHandoffConsumed(sessionId: string): void {
  const registry = readRegistry();
  const entry = registry[sessionId];
  if (!entry?.handoffPending) return;
  registry[sessionId] = { ...entry, handoffPending: false };
  writeRegistry(registry);
}

export const __FORK_RELAY_INTERNALS = {
  FORK_RELAY_STORAGE_KEY,
  MAX_REGISTRY_ENTRIES,
  MAX_HANDOFF_ITEMS,
  MAX_ITEM_TEXT_LENGTH,
};
