/**
 * Helpers for CollabSyncEngine.
 *
 * Ported verbatim from the retired useCollaborationMetadataSync hook where
 * noted; engine-only additions (add-only member inference, metadata hashing,
 * segments push planning) live here too. `collabSyncUtils.ts` keeps the
 * cross-feature pure helpers. Two deliberate exceptions to "engine-internal":
 * `importRemoteSession` is THE consolidated teammate-session import (design
 * §7.4 + M5 dedup) and is also consumed by the panel's direct-replay action
 * (useSessionActions); `forkSession` (design §16.11) is its WRITABLE sibling,
 * consumed by the panel's fork-and-continue actions.
 */
import { DISPATCH_CATEGORY } from "@src/api/tauri/session/dispatchTypes";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { createCollabAvatarIdentity } from "@src/store/collaboration/protocol";
import { COLLAB_ROLE } from "@src/store/collaboration/types";
import type {
  CollabChatMessageRecord,
  CollabInviteRecord,
  CollabMemberRecord,
  CollabOrgConnectionState,
  CollabRepoJoinRequestRecord,
  CollabSessionAccessSettings,
  CollabSessionSnapshotRequestRecord,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";
import { upsertSession } from "@src/store/session/sessionAtom/mutations";
import { persistSessions } from "@src/store/session/sessionAtom/persistence";
import type {
  Session,
  SessionForkedFrom,
  SessionImportedFrom,
} from "@src/store/session/sessionAtom/types";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import {
  getEffectiveAccessMode,
  getSessionVisibility,
  sha256Hex,
} from "../collabSyncUtils";
import type {
  CollabSyncBackendClient,
  CollabSyncProfile,
  SessionEventSegmentRecord,
  SessionEventsSegmentInput,
} from "../sync/CollabSyncBackend";

/**
 * Minute bucket for lastActivityAt so ordinary activity-timestamp churn does
 * not defeat the metadata hash gate with a push per touch.
 */
const METADATA_ACTIVITY_BUCKET_MS = 60_000;

export function createImportedSnapshotSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `imported-session-${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}`;
}

/**
 * Deterministic local session id for a teammate-session import, derived from
 * (orgId, sourceSessionId). A FAILED import (durable cache write returned 0)
 * used to mint a fresh random id per retry, leaking one orphaned event-store
 * entry per pull cycle; a deterministic id makes every retry land on the
 * same local id, so an aborted attempt is simply overwritten.
 */
export async function deriveImportedSessionId(
  orgId: string,
  sourceSessionId: string
): Promise<string> {
  const digest = await sha256Hex(`${orgId}:${sourceSessionId}`);
  return `imported-session-${digest.slice(0, 32)}`;
}

export function rewriteEventsForImportedSnapshot(
  events: SessionEvent[],
  localSessionId: string
): SessionEvent[] {
  return events.map((event) => ({ ...event, sessionId: localSessionId }));
}

export function upsertConnectionState(
  current: CollabOrgConnectionState[],
  nextState: CollabOrgConnectionState
): CollabOrgConnectionState[] {
  const existingIndex = current.findIndex(
    (item) => item.orgId === nextState.orgId
  );
  if (existingIndex < 0) return [nextState, ...current];
  const next = [...current];
  next[existingIndex] = nextState;
  return next;
}

/** Merge-upsert for server-authoritative member rows (pull delta). */
export function upsertCollabMember(
  current: CollabMemberRecord[],
  incoming: CollabMemberRecord
): CollabMemberRecord[] {
  const existingIndex = current.findIndex(
    (member) => member.orgId === incoming.orgId && member.id === incoming.id
  );
  if (existingIndex < 0) return [incoming, ...current];
  const next = [...current];
  next[existingIndex] = { ...current[existingIndex], ...incoming };
  return next;
}

/**
 * Add-only variant for INFERRED members (from remote sessions / chat).
 * Inference must never overwrite a known record — the old upsert clobbered
 * an admin role back to MEMBER every cycle (design §9.5, fix M4).
 */
export function addMemberIfUnknown(
  current: CollabMemberRecord[],
  incoming: CollabMemberRecord
): CollabMemberRecord[] {
  const exists = current.some(
    (member) => member.orgId === incoming.orgId && member.id === incoming.id
  );
  if (exists) return current;
  return [incoming, ...current];
}

export function upsertInviteRecord(
  current: CollabInviteRecord[],
  incoming: CollabInviteRecord
): CollabInviteRecord[] {
  const existingIndex = current.findIndex((item) => item.id === incoming.id);
  if (existingIndex < 0) return [incoming, ...current];
  const next = [...current];
  next[existingIndex] = incoming;
  return next;
}

export function upsertRemoteSession(
  current: RemoteTeammateSessionMetadata[],
  incoming: RemoteTeammateSessionMetadata
): RemoteTeammateSessionMetadata[] {
  const existingIndex = current.findIndex(
    (session) => session.id === incoming.id
  );
  if (existingIndex < 0) return [incoming, ...current];
  const next = [...current];
  next[existingIndex] = incoming;
  return next;
}

export function removeRemoteSessionsByIds(
  current: RemoteTeammateSessionMetadata[],
  ids: ReadonlySet<string>
): RemoteTeammateSessionMetadata[] {
  if (ids.size === 0) return current;
  const next = current.filter((session) => !ids.has(session.id));
  return next.length === current.length ? current : next;
}

export function upsertChatMessage(
  current: CollabChatMessageRecord[],
  incoming: CollabChatMessageRecord
): CollabChatMessageRecord[] {
  const existingIndex = current.findIndex(
    (message) => message.id === incoming.id
  );
  if (existingIndex < 0) return [...current, incoming];
  const next = [...current];
  next[existingIndex] = incoming;
  return next;
}

export function upsertSnapshotRequest(
  current: CollabSessionSnapshotRequestRecord[],
  incoming: CollabSessionSnapshotRequestRecord
): CollabSessionSnapshotRequestRecord[] {
  const existingIndex = current.findIndex(
    (request) => request.requestId === incoming.requestId
  );
  if (existingIndex < 0) return [incoming, ...current];
  const next = [...current];
  next[existingIndex] = { ...current[existingIndex], ...incoming };
  return next;
}

export function upsertRepoJoinRequest(
  current: CollabRepoJoinRequestRecord[],
  incoming: CollabRepoJoinRequestRecord
): CollabRepoJoinRequestRecord[] {
  const existingIndex = current.findIndex(
    (request) => request.requestId === incoming.requestId
  );
  if (existingIndex < 0) return [incoming, ...current];
  const next = [...current];
  next[existingIndex] = { ...current[existingIndex], ...incoming };
  return next;
}

/** Legacy (pre-M3) shape: import provenance JSON-encoded in error_message. */
export interface ImportedSessionMetadata {
  originalSessionId?: string;
  orgId?: string;
  ownerMemberId?: string;
  contentHash?: string;
}

/**
 * Legacy fallback only: pre-M3 collab imports stored provenance in
 * `error_message`. New imports carry the first-class `importedFrom` field;
 * this parser exists so those old rows are still FOUND (and upgraded in
 * place on the next import).
 */
export function parseImportedSessionMetadata(
  session: Session
): ImportedSessionMetadata | null {
  if (session.category !== "external_history") return null;
  if (!session.error_message) return null;
  try {
    const parsed = JSON.parse(session.error_message) as ImportedSessionMetadata;
    return parsed;
  } catch {
    return null;
  }
}

export function findImportedSession(
  sessions: Session[],
  orgId: string,
  sourceSessionId: string
): Session | undefined {
  return sessions.find((session) => {
    if (
      session.importedFrom?.orgId === orgId &&
      session.importedFrom.sourceSessionId === sourceSessionId
    ) {
      return true;
    }
    const meta = parseImportedSessionMetadata(session);
    return meta?.orgId === orgId && meta?.originalSessionId === sourceSessionId;
  });
}

// ============================================================================
// Segments push planning (design §7.3)
// ============================================================================

/** displayStatus values after which an event no longer mutates in place. */
const TERMINAL_EVENT_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
]);

/**
 * Frozen line (design §7.2): the frozen region is the longest event PREFIX
 * whose every event carries a terminal displayStatus ("completed"/"failed").
 * The first "running" / "pending" / "awaiting_user" event and everything
 * after it belong to the mutable tail. Events with no displayStatus (should
 * not happen — Rust always stamps it) count as terminal: a later in-place
 * mutation is still caught by the per-event hash chain and only costs an
 * epoch rewrite, whereas treating them as non-terminal would pin the frozen
 * line forever.
 */
export function computeFrozenEventCount(events: SessionEvent[]): number {
  for (let index = 0; index < events.length; index += 1) {
    const status = events[index]?.displayStatus;
    if (typeof status === "string" && !TERMINAL_EVENT_STATUSES.has(status)) {
      return index;
    }
  }
  return events.length;
}

/** Per-segment size budget (design §7.3 step 3a), measured pre-gzip. */
const SEGMENT_MAX_BYTES = 256 * 1024;

/**
 * Greedily pack frozen events into ≤256KB segments (at least one event per
 * segment, so an oversized single event still ships). `startSeq` is the seq
 * of the first produced segment.
 */
export function splitFrozenIntoSegments(
  events: SessionEvent[],
  startSeq: number
): SessionEventsSegmentInput[] {
  const segments: SessionEventsSegmentInput[] = [];
  let current: SessionEvent[] = [];
  let currentBytes = 0;
  for (const event of events) {
    const eventBytes = JSON.stringify(event).length;
    if (current.length > 0 && currentBytes + eventBytes > SEGMENT_MAX_BYTES) {
      segments.push({ seq: startSeq + segments.length, events: current });
      current = [];
      currentBytes = 0;
    }
    current.push(event);
    currentBytes += eventBytes;
  }
  if (current.length > 0) {
    segments.push({ seq: startSeq + segments.length, events: current });
  }
  return segments;
}

/** True for the server's opaque OCC rejection (append/rewrite anchors). */
export function isCollabConflictError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("ORGII_CONFLICT");
}

// ============================================================================
// Consolidated remote-session import (design §7.4, dedups the old M5 copies)
// ============================================================================

/**
 * The segments-fetch capability shared by `importRemoteSession` (read-only
 * replay copy) and `forkSession` (writable relay copy). Both fetch the SAME
 * remote history through `fetchAndAssembleSegments`; they differ only in what
 * kind of local session the assembled events land in.
 */
export interface RemoteSessionFetchOptions {
  client: Pick<CollabSyncBackendClient, "getSessionEventSegments">;
  profile: CollabSyncProfile;
  orgId: string;
  remoteSession: RemoteTeammateSessionMetadata;
  /**
   * Link-share capability (design §6.4): when set, every segments fetch
   * authenticates with the token alone — the caller is typically NOT an org
   * member (guest deep link) and `profile` carries only supabaseUrl+anonKey.
   * `remoteSession` then comes from `resolveSessionShare`, whose projection
   * includes the segments summary this importer diffs against.
   */
  shareToken?: string;
}

export interface ImportRemoteSessionOptions extends RemoteSessionFetchOptions {
  /**
   * Invoked with the local session id BEFORE any event-store write, so the
   * engine can arm its self-import guard (the eventStore write re-enters the
   * push subscription).
   */
  onBeforeWrite?: (localSessionId: string) => void;
}

export interface ImportRemoteSessionResult {
  localSessionId: string;
  /** false ⇒ the local cursor already matched the remote summary. */
  updated: boolean;
}

interface AssembledSegments {
  events: SessionEvent[];
  epoch: number;
  frozenSeq: number;
  frozenCount: number;
  tailHash: string | null;
}

async function fetchAndAssembleSegments(
  options: RemoteSessionFetchOptions,
  afterSeq: number,
  baseFrozenEvents: SessionEvent[],
  expectedEpoch: number | null
): Promise<AssembledSegments | null> {
  const { client, profile, orgId, remoteSession, shareToken } = options;
  const snapshot = await client.getSessionEventSegments({
    ...profile,
    orgId,
    sessionRowId: remoteSession.id,
    afterSeq,
    shareToken,
  });
  if (snapshot.epoch === null || snapshot.count === null) return null;
  // The snapshot is authoritative over the (possibly stale) list summary; a
  // mid-flight epoch change invalidates the incremental base.
  if (expectedEpoch !== null && snapshot.epoch !== expectedEpoch) return null;

  const frozen: SessionEventSegmentRecord[] = snapshot.segments
    .filter((segment) => !segment.isTail)
    .sort((a, b) => a.seq - b.seq);
  // Contiguity (design §7.4): frozen seqs must run afterSeq+1..frozenSeq
  // with no gaps, and the reassembled stream must match the summary count.
  let expectedSeq = afterSeq;
  for (const segment of frozen) {
    if (segment.seq !== expectedSeq + 1) return null;
    expectedSeq = segment.seq;
  }
  if ((snapshot.frozenSeq ?? 0) !== expectedSeq) return null;

  const tailSegment =
    snapshot.segments.find((segment) => segment.isTail) ?? null;
  const tailEvents = tailSegment?.events ?? [];
  const events = [
    ...baseFrozenEvents,
    ...frozen.flatMap((segment) => segment.events),
    ...tailEvents,
  ];
  if (events.length !== snapshot.count) return null;
  return {
    events,
    epoch: snapshot.epoch,
    frozenSeq: snapshot.frozenSeq ?? 0,
    frozenCount: events.length - tailEvents.length,
    tailHash: tailSegment?.segmentHash ?? snapshot.tailHash,
  };
}

/**
 * In-flight dedup for `importRemoteSession`, keyed `${orgId}:${sourceSessionId}`.
 * The engine PullLoop and a panel replay click can race on the same remote
 * session; without dedup both run the fetch + event-store write concurrently
 * (double egress, and interleaved set/saveToCache on the same local id).
 */
const inFlightRemoteSessionImports = new Map<
  string,
  Promise<ImportRemoteSessionResult | null>
>();

/**
 * THE import path for teammate sessions — used by both the engine PullLoop
 * (auto-import) and the panel's direct-replay action. Handles:
 * - cursor comparison against the remote summary (no-op when unchanged),
 * - incremental application (new frozen segments appended to the local
 *   frozen prefix, tail region replaced) with local-count + contiguity
 *   validation, falling back to a full refetch on any mismatch,
 * - persistence (`saveToCache`, fix P7) and the `importedFrom` cursor.
 *
 * Concurrent calls for the same (orgId, sourceSessionId) share one in-flight
 * promise. Returns null when the owner has published no segments and nothing
 * was previously imported (callers may fall back to the snapshot-request
 * flow); THROWS when the durable cache write fails so callers treat the
 * import as retryable rather than silently absent.
 */
export async function importRemoteSession(
  options: ImportRemoteSessionOptions
): Promise<ImportRemoteSessionResult | null> {
  const key = `${options.orgId}:${options.remoteSession.sourceSessionId}`;
  const pending = inFlightRemoteSessionImports.get(key);
  if (pending) return pending;
  const task = importRemoteSessionInner(options).finally(() => {
    inFlightRemoteSessionImports.delete(key);
  });
  inFlightRemoteSessionImports.set(key, task);
  return task;
}

async function importRemoteSessionInner(
  options: ImportRemoteSessionOptions
): Promise<ImportRemoteSessionResult | null> {
  const { orgId, remoteSession, onBeforeWrite } = options;
  const store = getInstrumentedStore();
  const sessions = store.get(sessionsAtom) as Session[];
  const existing = findImportedSession(
    sessions,
    orgId,
    remoteSession.sourceSessionId
  );
  // Legacy (error_message) imports have no usable cursor → full refetch.
  const cursor = existing?.importedFrom ?? null;

  if (
    remoteSession.eventsEpoch === undefined ||
    remoteSession.eventsCount === undefined
  ) {
    // No segments published (or publishing stopped): keep any local copy.
    return existing
      ? { localSessionId: existing.session_id, updated: false }
      : null;
  }

  if (
    existing &&
    cursor &&
    cursor.epoch === remoteSession.eventsEpoch &&
    cursor.seq === (remoteSession.eventsFrozenSeq ?? 0) &&
    cursor.count === remoteSession.eventsCount &&
    (cursor.tailHash ?? null) === (remoteSession.eventsTailHash ?? null)
  ) {
    return { localSessionId: existing.session_id, updated: false };
  }

  let assembled: AssembledSegments | null = null;
  if (
    existing &&
    cursor &&
    cursor.epoch >= 1 &&
    cursor.epoch === remoteSession.eventsEpoch &&
    cursor.frozenCount !== undefined &&
    (remoteSession.eventsFrozenSeq ?? 0) >= cursor.seq
  ) {
    // Incremental: verify the local store still holds exactly what the
    // cursor claims before splicing onto it (design §7.4 last line).
    const localEvents = await eventStoreProxy.getPersistedEvents(
      existing.session_id
    );
    if (localEvents.length === cursor.count) {
      assembled = await fetchAndAssembleSegments(
        options,
        cursor.seq,
        localEvents.slice(0, cursor.frozenCount),
        cursor.epoch
      );
    }
  }
  if (!assembled) {
    // Full refetch: epoch change, missing/legacy cursor, or any validation
    // failure above.
    assembled = await fetchAndAssembleSegments(options, 0, [], null);
  }
  if (!assembled) {
    return existing
      ? { localSessionId: existing.session_id, updated: false }
      : null;
  }

  // Deterministic id (not random): a retry after a failed durable write must
  // reuse the same local id instead of leaking a new orphan per attempt.
  const localSessionId =
    existing?.session_id ??
    (await deriveImportedSessionId(orgId, remoteSession.sourceSessionId));
  onBeforeWrite?.(localSessionId);
  const localEvents = rewriteEventsForImportedSnapshot(
    assembled.events,
    localSessionId
  );
  const now = new Date().toISOString();
  const importedFrom: SessionImportedFrom = {
    orgId,
    sourceSessionId: remoteSession.sourceSessionId,
    ownerMemberId: remoteSession.ownerMemberId,
    ownerDisplayName: remoteSession.ownerDisplayName,
    epoch: assembled.epoch,
    seq: assembled.frozenSeq,
    count: localEvents.length,
    frozenCount: assembled.frozenCount,
    tailHash: assembled.tailHash ?? undefined,
    importedAt: now,
  };
  // Durably cache the events BEFORE persisting the session record + cursor.
  // The cursor claims the import is complete, so if we persisted it first and
  // then the cache write failed (saveToCache swallows errors and returns 0) or
  // the app crashed in between, the next pull would see a matching cursor and
  // never re-fetch — stranding a permanently empty transcript. Ordering the
  // durable write first means a failure just leaves no record and the next
  // pull retries cleanly.
  await eventStoreProxy.set(localEvents, localSessionId);
  const savedCount = await eventStoreProxy.saveToCache(localSessionId);
  if (localEvents.length > 0 && savedCount <= 0) {
    // Cache write failed for a non-empty import — do not persist a "complete"
    // cursor. For a NEW import also drop the just-set events again: with no
    // session record pointing at them they would sit as an orphaned event
    // store entry until the retry overwrites them.
    if (!existing) {
      await eventStoreProxy.clear(localSessionId);
    }
    // Throw (not null): null means "nothing published", which callers treat
    // as final. This failure is transient and must surface as retryable.
    throw new Error(
      `Failed to durably persist imported session ${remoteSession.sourceSessionId} (saveToCache returned ${savedCount})`
    );
  }
  upsertSession({
    session_id: localSessionId,
    status: "completed",
    created_at: existing?.created_at ?? now,
    updated_at: now,
    completed_at: now,
    name: remoteSession.title,
    repoPath: remoteSession.repoPath,
    category: "external_history",
    model: "Collaboration Snapshot",
    agentIconId: "archive",
    agentDisplayName: "Collaboration Snapshot",
    pinned: existing?.pinned ?? false,
    importedFrom,
    // Retire the legacy error_message idiom for collab imports; clears any
    // leftover value on upgraded pre-M3 rows.
    error_message: undefined,
  });
  persistSessions(store.get(sessionsAtom) as Session[]);
  return { localSessionId, updated: true };
}

// ============================================================================
// Fork & continue (design §16.11 — session relay)
// ============================================================================

/**
 * Fresh id for a forked session. The `agentsession-` prefix maps to the
 * `rust_agent` category in `SESSION_PREFIX_REGISTRY` — the SAME runnable
 * category a normal local agent session uses — and is deliberately NOT the
 * `imported-session-` prefix (read-only external history).
 */
export function createForkedSessionId(): string {
  return `agentsession-${crypto.randomUUID()}`;
}

/** Locale-neutral fork marker for the forked session's display name. */
export function buildForkedSessionName(sourceTitle: string): string {
  return `⑂ ${sourceTitle}`;
}

export interface ForkSessionResult {
  localSessionId: string;
  /** Display name persisted on the forked record (source title + ⑂ marker). */
  name: string;
  /** Events inherited from the source (== forkedFrom.atCount). */
  eventCount: number;
}

/**
 * "Fork & continue" (design §16.11): land a replay-capable teammate session's
 * FULL event history as a new WRITABLE local session, so an agent can run on
 * this machine, with this member's key, continuing from the teammate's
 * context. NOT multi-writer — the fork is an ordinary single-writer session
 * that merely records its origin in `forkedFrom`.
 *
 * Shares the exact fetch/assembly path with `importRemoteSession`
 * (`fetchAndAssembleSegments`, always a full refetch from seq 0 — a fork has
 * no incremental cursor to splice onto) and mirrors its durable-write
 * ordering: events are cached BEFORE the session record is persisted, so a
 * failed cache write can never leave a forked record with no events (fix P7's
 * ordering, same rationale as the importer).
 *
 * Unlike an import, the created session:
 * - gets a fresh NORMAL id (`agentsession-*`, category `rust_agent`) so it is
 *   runnable and dispatchable;
 * - sets `forkedFrom` (provenance only) and NOT `importedFrom` — verified
 *   against `isSessionPushAllowed` (collabSyncUtils.ts), which excludes only
 *   `category === "external_history"` and `importedFrom`-bearing sessions:
 *   a fork has neither, so the member's continuation correctly syncs back to
 *   the org under their OWN member id, per their accessMode;
 * - carries `created_at = now`, so the `shareSince` "only new sessions" gate
 *   treats the fork as new work (it is — the inherited history was already
 *   shared by its owner).
 *
 * Permission is the source session's replay visibility (design §16.11): the
 * segments fetch succeeds only under FULL_REPLAY or a replay-level share —
 * enforced server-side, nothing new here. Returns null when the owner has
 * published no segments (metadata-only sessions have nothing to inherit);
 * THROWS on a failed durable write so callers surface it as retryable.
 */
export async function forkSession(
  options: RemoteSessionFetchOptions
): Promise<ForkSessionResult | null> {
  const { orgId, remoteSession } = options;
  if (
    remoteSession.eventsEpoch === undefined ||
    remoteSession.eventsCount === undefined
  ) {
    // No published segments — nothing to inherit (metadata-only session).
    return null;
  }

  // Full fetch from seq 0, same assembly + validation as the importer.
  const assembled = await fetchAndAssembleSegments(options, 0, [], null);
  if (!assembled) return null;

  const localSessionId = createForkedSessionId();
  const localEvents = rewriteEventsForImportedSnapshot(
    assembled.events,
    localSessionId
  );
  const now = new Date().toISOString();

  // Durable events first, session record second (mirror importRemoteSession):
  // if the cache write fails, no record must claim the fork exists.
  await eventStoreProxy.set(localEvents, localSessionId);
  const savedCount = await eventStoreProxy.saveToCache(localSessionId);
  if (localEvents.length > 0 && savedCount <= 0) {
    // Drop the just-set events again — no session record points at them, and
    // a fork id is random, so (unlike the importer's deterministic id) a
    // retry would not overwrite this orphan.
    await eventStoreProxy.clear(localSessionId);
    throw new Error(
      `Failed to durably persist forked session ${remoteSession.sourceSessionId} (saveToCache returned ${savedCount})`
    );
  }

  const forkedFrom: SessionForkedFrom = {
    orgId,
    sourceSessionId: remoteSession.sourceSessionId,
    ownerMemberId: remoteSession.ownerMemberId,
    ownerDisplayName: remoteSession.ownerDisplayName,
    atCount: localEvents.length,
    forkedAt: now,
  };
  const name = buildForkedSessionName(remoteSession.title);
  const store = getInstrumentedStore();
  upsertSession({
    session_id: localSessionId,
    status: "completed",
    created_at: now,
    updated_at: now,
    name,
    repoPath: remoteSession.repoPath,
    branch: remoteSession.branch,
    // Runnable category (NOT "external_history"): the fork must be
    // dispatchable and eligible for collab push as this member's own session.
    category: DISPATCH_CATEGORY.RUST_AGENT,
    pinned: false,
    forkedFrom,
    // Deliberately NO importedFrom: that field marks read-only replay copies
    // and excludes them from push (isSessionPushAllowed).
  });
  persistSessions(store.get(sessionsAtom) as Session[]);
  return { localSessionId, name, eventCount: localEvents.length };
}

export function memberFromRemoteSession(
  session: RemoteTeammateSessionMetadata
): CollabMemberRecord {
  const joinedAt = session.lastActivityAt ?? new Date().toISOString();
  return {
    id: session.ownerMemberId,
    orgId: session.orgId,
    displayName: session.ownerDisplayName,
    avatar: createCollabAvatarIdentity(session.ownerDisplayName),
    role: COLLAB_ROLE.MEMBER,
    identityKind: session.ownerIdentityKind,
    joinedAt,
  };
}

export function memberFromChatMessage(
  message: CollabChatMessageRecord
): CollabMemberRecord {
  return {
    id: message.authorMemberId,
    orgId: message.orgId,
    displayName: message.authorDisplayName,
    avatar: createCollabAvatarIdentity(message.authorDisplayName),
    role: COLLAB_ROLE.MEMBER,
    identityKind: message.authorIdentityKind,
    joinedAt: message.createdAt,
  };
}

/**
 * Stable fingerprint of the metadata fields the wire record carries.
 * Mirrors `toRemoteMetadata` field sourcing; lastActivityAt is bucketed to
 * the minute so the hash gate is not defeated by timestamp churn. The
 * EFFECTIVE access mode is hashed (not the member default) so a per-session
 * override or shareSince change re-publishes exactly the sessions it
 * touches — replayLevel derives from it. The published visibility is hashed
 * too: flipping org ↔ restricted in the share dialog must re-push even when
 * nothing else changed (M4b).
 *
 * `repoPath` is DELIBERATELY excluded: it is not carried on the wire record by
 * `toRemoteMetadata` as a mutable, re-pushable field (the org repo scope, not
 * the local path, governs visibility), so a local path move must not trigger a
 * metadata re-push. The hashed fields mirror `toRemoteMetadata`'s sourcing
 * exactly — nothing more, nothing less.
 */
export function computeSessionMetadataHash(
  session: Session,
  settings: CollabSessionAccessSettings
): string {
  const lastActivityAt = session.updated_at || session.updated_time || "";
  const parsedActivity = Date.parse(lastActivityAt);
  const activityBucket = Number.isFinite(parsedActivity)
    ? Math.floor(parsedActivity / METADATA_ACTIVITY_BUCKET_MS)
    : lastActivityAt;
  return JSON.stringify([
    session.name || session.user_input || session.session_id,
    String(session.status),
    session.branch || session.worktreeBranch || "",
    activityBucket,
    getEffectiveAccessMode(session, settings),
    getSessionVisibility(session, settings),
    // NOTE: repoPath is intentionally NOT hashed — see the docblock above.
  ]);
}
