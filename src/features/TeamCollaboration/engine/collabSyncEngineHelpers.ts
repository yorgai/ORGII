/**
 * Helpers for CollabSyncEngine.
 *
 * Ported verbatim from the retired useCollaborationMetadataSync hook where
 * noted; engine-only additions (add-only member inference, metadata hashing,
 * segments push planning) live here too. `collabSyncUtils.ts` keeps the
 * cross-feature pure helpers. One deliberate exception to "engine-internal":
 * `importRemoteSession` is THE consolidated teammate-session import (design
 * §7.4 + M5 dedup) and is also consumed by the panel's direct-replay action
 * (useSessionActions).
 */
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
  SessionImportedFrom,
} from "@src/store/session/sessionAtom/types";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

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

function getMetadataId(record: Record<string, unknown>): string | null {
  const id = record.id;
  return typeof id === "string" && id.trim() ? id : null;
}

export function upsertCollabMetadataRecord<
  TRecord extends Record<string, unknown>,
>(current: TRecord[], incoming: TRecord): TRecord[] {
  const incomingId = getMetadataId(incoming);
  if (!incomingId) return [incoming, ...current];
  const existingIndex = current.findIndex(
    (record) => getMetadataId(record) === incomingId
  );
  if (existingIndex < 0) return [incoming, ...current];
  const next = [...current];
  next[existingIndex] = { ...current[existingIndex], ...incoming };
  return next;
}

export function withOrgId<TRecord extends Record<string, unknown>>(
  orgId: string,
  record: TRecord
): TRecord {
  return { ...record, orgId };
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

export interface ImportRemoteSessionOptions {
  client: Pick<CollabSyncBackendClient, "getSessionEventSegments">;
  profile: CollabSyncProfile;
  orgId: string;
  remoteSession: RemoteTeammateSessionMetadata;
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
  options: ImportRemoteSessionOptions,
  afterSeq: number,
  baseFrozenEvents: SessionEvent[],
  expectedEpoch: number | null
): Promise<AssembledSegments | null> {
  const { client, profile, orgId, remoteSession } = options;
  const snapshot = await client.getSessionEventSegments({
    ...profile,
    orgId,
    sessionRowId: remoteSession.id,
    afterSeq,
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
 * THE import path for teammate sessions — used by both the engine PullLoop
 * (auto-import) and the panel's direct-replay action. Handles:
 * - cursor comparison against the remote summary (no-op when unchanged),
 * - incremental application (new frozen segments appended to the local
 *   frozen prefix, tail region replaced) with local-count + contiguity
 *   validation, falling back to a full refetch on any mismatch,
 * - persistence (`saveToCache`, fix P7) and the `importedFrom` cursor.
 *
 * Returns null when the owner has published no segments and nothing was
 * previously imported (callers may fall back to the snapshot-request flow).
 */
export async function importRemoteSession(
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

  const localSessionId =
    existing?.session_id ?? createImportedSnapshotSessionId();
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
  await eventStoreProxy.set(localEvents, localSessionId);
  // Imports must survive restart (fix P7).
  await eventStoreProxy.saveToCache(localSessionId);
  return { localSessionId, updated: true };
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
 * the minute so the hash gate is not defeated by timestamp churn.
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
    settings.accessMode,
  ]);
}
