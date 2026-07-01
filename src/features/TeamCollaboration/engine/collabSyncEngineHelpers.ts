/**
 * Pure helpers for CollabSyncEngine.
 *
 * Ported verbatim from the retired useCollaborationMetadataSync hook where
 * noted; engine-only additions (add-only member inference, metadata hashing)
 * live here too. `collabSyncUtils.ts` keeps the cross-feature pure helpers —
 * everything in this file is engine-internal.
 */
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
import type { Session } from "@src/store/session/sessionAtom/types";

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

export interface ImportedSessionMetadata {
  originalSessionId?: string;
  orgId?: string;
  ownerMemberId?: string;
  contentHash?: string;
}

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
    const meta = parseImportedSessionMetadata(session);
    return meta?.orgId === orgId && meta?.originalSessionId === sourceSessionId;
  });
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
