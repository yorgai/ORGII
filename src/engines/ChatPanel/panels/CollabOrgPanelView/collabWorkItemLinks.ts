/**
 * Pure resolution helpers for M6b (design §16.7 / §16.6).
 *
 * These close the loop between a shared work item's `linkedSessions` and the
 * shared session records the engine pulls into `remoteTeammateSessionsAtom`,
 * and they render the server-arbitrated execution lock's holder. Kept free of
 * React / atoms / IO so they are unit-testable in the node vitest env.
 */
import type { EnrichedWorkItem, LinkedSession } from "@src/api/http/project";
import type {
  CollabMemberRecord,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";

/**
 * How a work item's linked session can be consumed from the collab panel
 * (design §16.7):
 * - `replay`: a shared session record exists AND carries published event
 *   segments (`eventsEpoch` defined) → the SAME `importRemoteSession` path the
 *   engine / SessionsSection use can replay the full conversation;
 * - `metadata`: a shared record exists but only listing-level (no segments) —
 *   the owner shared metadata only or has not published a replay;
 * - `none`: no shared record for this session id in this org — either the
 *   owner never shared it or it is not visible to the current member.
 */
export const LINKED_SESSION_RESOLUTION = {
  REPLAY: "replay",
  METADATA: "metadata",
  NONE: "none",
} as const;

export type LinkedSessionResolutionKind =
  (typeof LINKED_SESSION_RESOLUTION)[keyof typeof LINKED_SESSION_RESOLUTION];

export interface ResolvedLinkedSession {
  linked: LinkedSession;
  kind: LinkedSessionResolutionKind;
  /**
   * The matching shared session record, when one exists (kind !== 'none').
   * The replay action feeds this straight into `importRemoteSession`.
   */
  remoteSession?: RemoteTeammateSessionMetadata;
  /** Owner display name — from the shared record when present. */
  ownerDisplayName?: string;
}

/**
 * Match a work item's linked session to a shared session record.
 *
 * The link key is design §16.7's invariant: `linkedSession.session_id` is the
 * owner's local session id, which equals the shared record's
 * `sourceSessionId`. Records are scoped to the org first (a member may be in
 * several orgs and two orgs can carry the same source id) and tombstoned
 * records (`deletedAt`) are ignored.
 */
export function resolveLinkedSession(
  linked: LinkedSession,
  orgId: string,
  remoteSessions: RemoteTeammateSessionMetadata[]
): ResolvedLinkedSession {
  const remoteSession = remoteSessions.find(
    (session) =>
      session.orgId === orgId &&
      session.sourceSessionId === linked.session_id &&
      !session.deletedAt
  );

  if (!remoteSession) {
    return { linked, kind: LINKED_SESSION_RESOLUTION.NONE };
  }

  // Replay-capable only when the owner has actually published segments
  // (`eventsEpoch` defined ⇒ the segments summary is populated). A share
  // granted at metadata level, or a still-metadata-only session, has no
  // segments and stays in the muted "metadata" state.
  const kind =
    remoteSession.eventsEpoch !== undefined
      ? LINKED_SESSION_RESOLUTION.REPLAY
      : LINKED_SESSION_RESOLUTION.METADATA;

  return {
    linked,
    kind,
    remoteSession,
    ownerDisplayName: remoteSession.ownerDisplayName,
  };
}

/** Resolve every linked session of a work item, preserving order. */
export function resolveWorkItemLinkedSessions(
  workItem: Pick<EnrichedWorkItem, "linkedSessions">,
  orgId: string,
  remoteSessions: RemoteTeammateSessionMetadata[]
): ResolvedLinkedSession[] {
  return (workItem.linkedSessions ?? []).map((linked) =>
    resolveLinkedSession(linked, orgId, remoteSessions)
  );
}

/**
 * Execution-lock holder display (design §16.6). The server forces
 * `payload.executionLock.lockedByMemberId` to the acquiring member; it syncs
 * down into the work item's `executionLock`. Returns:
 * - `heldByOther: true` only when the lock is held by a DIFFERENT member than
 *   the current one → the "start agent" affordance must disable and show the
 *   holder instead of double-starting;
 * - `holderName`: resolved from `members`, falling back to the raw id.
 *
 * A lock with no `lockedByMemberId` is a purely local (non-collab) lock and is
 * never treated as "held by another member".
 */
export interface LockHolderDisplay {
  heldByOther: boolean;
  holderMemberId: string | null;
  holderName: string | null;
}

export function resolveLockHolder(
  lockedByMemberId: string | undefined | null,
  currentMemberId: string | undefined | null,
  members: CollabMemberRecord[]
): LockHolderDisplay {
  if (!lockedByMemberId) {
    return { heldByOther: false, holderMemberId: null, holderName: null };
  }
  const heldByOther = lockedByMemberId !== currentMemberId;
  const holder = members.find((member) => member.id === lockedByMemberId);
  return {
    heldByOther,
    holderMemberId: lockedByMemberId,
    holderName: holder?.displayName ?? lockedByMemberId,
  };
}
