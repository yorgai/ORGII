/**
 * CollabSyncEngine — collaboration sync as a plain-TS service (design §9).
 *
 * Owns the whole sync pipeline outside React so it can be unit-tested with a
 * mocked backend and never torn down by hook dependency churn (fix M1):
 *
 * - PullLoop: one setTimeout chain per org (never setInterval), staggered
 *   start, adaptive cadence (5s focused/active, 60s idle), per-org error
 *   backoff 5s→15s→60s, verifySetup once per org per engine start (fix M2).
 *   Pull application is read-only + import; ported 1:1 from the retired
 *   useCollaborationMetadataSync hook.
 * - PushQueue: event-driven writes — eventStoreProxy blob pushes with
 *   per-session debounce + serialization (dirty re-run instead of the old
 *   silent drop), and sessionsAtom-driven metadata pushes gated by a
 *   metadata hash + known-removed tombstone set (fix P1, no per-cycle
 *   push/remove storms).
 *
 * The engine must not call React hooks; UI intents (open imported session)
 * are parked in `collabPendingOpenSessionAtom` and consumed by
 * `useCollabSyncEngine`. All state access goes through the jotai store
 * passed to `start()` (vanilla store; collab atoms use `getOnInit: true`).
 */
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  collabChatMessagesAtom,
  collabConnectionStatesAtom,
  collabInvitesAtom,
  collabLastSyncTimestampsAtom,
  collabMembersAtom,
  collabOrgsAtom,
  collabPendingOpenSessionAtom,
  collabProjectsAtom,
  collabRepoJoinRequestsAtom,
  collabSessionAccessSettingsAtom,
  collabSessionPushCursorsAtom,
  collabSessionSnapshotRequestsAtom,
  collabWorkItemsAtom,
  remoteTeammateSessionsAtom,
} from "@src/store/collaboration/collabOrgsAtom";
import type { CollabSessionPushCursor } from "@src/store/collaboration/collabOrgsAtom";
import {
  COLLAB_CONNECTION_STATUS,
  COLLAB_ROLE,
  COLLAB_SESSION_ACCESS_MODE,
} from "@src/store/collaboration/types";
import type {
  CollabMemberRecord,
  CollabOrgConnectionState,
  CollabOrgRecord,
  CollabProjectMetadataRecord,
  CollabSessionAccessSettings,
  CollabWorkItemMetadataRecord,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";
import { upsertSession } from "@src/store/session/sessionAtom/mutations";
import { persistSessions } from "@src/store/session/sessionAtom/persistence";
import type { Session } from "@src/store/session/sessionAtom/types";
import type { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import type { SupabaseSyncProfile } from "../collabSyncUtils";
import {
  createDefaultAccessSettings,
  getEffectiveAccessMode,
  getSyncProfile,
  isRemoteSessionEventsPublishAllowed,
  isRemoteSessionInOrgScope,
  isSessionPushAllowed,
  sha256Hex,
  stableStringify,
  toRemoteMetadata,
} from "../collabSyncUtils";
import type { CollabOrgState } from "../sync/CollabSyncBackend";
import { computeSegmentHash } from "../sync/collabGzip";
import { supabaseSyncClient } from "../sync/supabaseSyncClient";
import {
  addMemberIfUnknown,
  computeFrozenEventCount,
  computeSessionMetadataHash,
  createImportedSnapshotSessionId,
  importRemoteSession,
  isCollabConflictError,
  memberFromChatMessage,
  memberFromRemoteSession,
  removeRemoteSessionsByIds,
  rewriteEventsForImportedSnapshot,
  splitFrozenIntoSegments,
  upsertChatMessage,
  upsertCollabMember,
  upsertCollabMetadataRecord,
  upsertConnectionState,
  upsertInviteRecord,
  upsertRemoteSession,
  upsertRepoJoinRequest,
  upsertSnapshotRequest,
  withOrgId,
} from "./collabSyncEngineHelpers";

type CollabStore = ReturnType<typeof getInstrumentedStore>;

const ACTIVE_PULL_INTERVAL_MS = 5_000;
const IDLE_PULL_INTERVAL_MS = 60_000;
const ACTIVITY_WINDOW_MS = 5 * 60_000;
const ERROR_BACKOFF_STEPS_MS = [5_000, 15_000, 60_000] as const;
const PULL_STAGGER_MS = 250;
const PUSH_DEBOUNCE_MS = 3_000;
/** Delta cursor safety overlap; every consumer must stay idempotent (§9.4). */
const CURSOR_OVERLAP_MS = 2_000;
/**
 * after_seq probe that excludes every frozen segment (int4 max) — used to
 * read just the server summary when re-anchoring after an OCC rejection.
 */
const REANCHOR_PROBE_AFTER_SEQ = 2_147_483_647;

const SETUP_MISSING_MESSAGE =
  "Supabase setup is missing or outdated. Copy the setup SQL, run it in the Supabase SQL Editor, then retry.";

interface ActiveCollabConnection {
  org: CollabOrgRecord;
  member: CollabMemberRecord;
  settings: CollabSessionAccessSettings;
  profile: SupabaseSyncProfile;
}

interface OrgPullState {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  errorCount: number;
  /** requestPullNow arrived while a cycle was running → re-pull right after. */
  pullAgainImmediately: boolean;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CollabSyncEngine {
  private store: CollabStore | null = null;
  private started = false;
  /** Bumped on stop(); in-flight async work checks it before writing. */
  private generation = 0;
  private lastActivityAt = 0;

  // --- PullLoop state -------------------------------------------------------
  private readonly pullStates = new Map<string, OrgPullState>();
  private readonly verifiedOrgIds = new Set<string>();
  /** Segments retention sweep fired once per admin org per engine start (§7.5). */
  private readonly gcTriggeredOrgIds = new Set<string>();
  private atomUnsubscribers: Array<() => void> = [];

  // --- PushQueue state ------------------------------------------------------
  private eventStoreUnsubscribe: (() => void) | null = null;
  private sessionsUnsubscribe: (() => void) | null = null;
  private readonly pushDebounceTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly inFlightPushSessionIds = new Set<string>();
  private readonly dirtyPushSessionIds = new Set<string>();
  /** `${orgId}:${sessionId}` → metadata hash of the last pushed metadata. */
  private readonly lastPushedMetadataHashes = new Map<string, string>();
  /** `${orgId}:${sessionId}` keys already tombstoned — exactly one remove. */
  private readonly knownRemovedSessionKeys = new Set<string>();
  /** Local ids the engine itself imported; never eligible for push. */
  private readonly importedLocalSessionIds = new Set<string>();
  private metadataSweepTimer: ReturnType<typeof setTimeout> | null = null;
  private metadataSweepRunning = false;
  private metadataSweepDirty = false;

  private readonly handleWindowFocus = (): void => {
    this.notifyActivity();
    this.requestPullNow();
  };

  /** Idempotent: subsequent calls while running are no-ops. */
  start(store: CollabStore): void {
    if (this.started) return;
    this.started = true;
    this.store = store;
    if (typeof window !== "undefined") {
      window.addEventListener("focus", this.handleWindowFocus);
    }
    // Connection inputs (orgs / members / access settings) drive both loop
    // membership and push eligibility — reconcile on every change.
    for (const inputAtom of [
      collabOrgsAtom,
      collabMembersAtom,
      collabSessionAccessSettingsAtom,
    ] as const) {
      this.atomUnsubscribers.push(store.sub(inputAtom, () => this.reconcile()));
    }
    this.reconcile();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.generation += 1;
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", this.handleWindowFocus);
    }
    for (const unsubscribe of this.atomUnsubscribers) unsubscribe();
    this.atomUnsubscribers = [];
    this.teardownPushSubscriptions();
    for (const state of this.pullStates.values()) {
      if (state.timer !== null) clearTimeout(state.timer);
    }
    this.pullStates.clear();
    this.verifiedOrgIds.clear();
    this.gcTriggeredOrgIds.clear();
    this.inFlightPushSessionIds.clear();
    this.dirtyPushSessionIds.clear();
    this.lastPushedMetadataHashes.clear();
    this.knownRemovedSessionKeys.clear();
    this.importedLocalSessionIds.clear();
    this.metadataSweepRunning = false;
    this.metadataSweepDirty = false;
    this.lastActivityAt = 0;
    this.store = null;
  }

  /**
   * Pull immediately (all orgs when orgId is omitted). Doubles as the seam
   * for Supabase Realtime wake-ups (§9.6): a broadcast ping maps to
   * `requestPullNow(orgId)` and polling relaxes to the 60s floor.
   */
  requestPullNow(orgId?: string): void {
    if (!this.started) return;
    const targets = orgId ? [orgId] : [...this.pullStates.keys()];
    for (const targetOrgId of targets) {
      const state = this.pullStates.get(targetOrgId);
      if (!state) continue;
      if (state.running) {
        state.pullAgainImmediately = true;
        continue;
      }
      this.schedulePull(targetOrgId, 0);
    }
  }

  /** Local-activity signal for the adaptive cadence (focus, event writes). */
  notifyActivity(): void {
    this.lastActivityAt = Date.now();
  }

  // ===========================================================================
  // Connection reconciliation
  // ===========================================================================

  private getActiveConnections(): ActiveCollabConnection[] {
    const store = this.store;
    if (!store) return [];
    const orgs = store.get(collabOrgsAtom);
    const members = store.get(collabMembersAtom);
    const accessSettingsList = store.get(collabSessionAccessSettingsAtom);
    return orgs.flatMap((org) => {
      const profile = getSyncProfile(org);
      if (!profile) return [];
      const member = members.find(
        (candidate) =>
          candidate.orgId === org.id &&
          candidate.id === org.localMemberId &&
          !candidate.removedAt
      );
      if (!member) return [];
      const settings =
        accessSettingsList.find(
          (candidate) =>
            candidate.orgId === org.id && candidate.memberId === member.id
        ) ?? createDefaultAccessSettings(org.id, member.id);
      return [{ org, member, settings, profile }];
    });
  }

  private reconcile(): void {
    if (!this.started || !this.store) return;
    const connections = this.getActiveConnections();
    const activeOrgIds = new Set(connections.map(({ org }) => org.id));

    for (const [orgId, state] of this.pullStates) {
      if (activeOrgIds.has(orgId)) continue;
      if (state.timer !== null) clearTimeout(state.timer);
      this.pullStates.delete(orgId);
    }

    let staggerIndex = 0;
    for (const connection of connections) {
      if (this.pullStates.has(connection.org.id)) continue;
      this.pullStates.set(connection.org.id, {
        timer: null,
        running: false,
        errorCount: 0,
        pullAgainImmediately: false,
      });
      // Stagger initial pulls so multi-org clients don't burst in lockstep.
      this.schedulePull(connection.org.id, staggerIndex * PULL_STAGGER_MS);
      staggerIndex += 1;
    }

    if (connections.length === 0) {
      // Zero-subscription idle: no orgs (or none connectable) costs nothing —
      // no event stream subscription, no timers.
      this.teardownPushSubscriptions();
      return;
    }

    if (!this.eventStoreUnsubscribe) {
      this.eventStoreUnsubscribe = eventStoreProxy.subscribe(
        (_snapshot, sessionId) => {
          this.notifyActivity();
          this.schedulePush(sessionId);
        }
      );
    }
    if (!this.sessionsUnsubscribe) {
      this.sessionsUnsubscribe = this.store.sub(sessionsAtom, () =>
        this.scheduleMetadataSweep()
      );
      // First attach: publish current metadata immediately (this replaces
      // the old per-cycle metadata push from the pull loop).
      void this.runMetadataSweep();
    } else {
      // Settings / scope changes can flip eligibility → tombstone or
      // (re-)publish exactly once via the hash / known-removed gates.
      this.scheduleMetadataSweep();
    }
  }

  private teardownPushSubscriptions(): void {
    if (this.eventStoreUnsubscribe) {
      this.eventStoreUnsubscribe();
      this.eventStoreUnsubscribe = null;
    }
    if (this.sessionsUnsubscribe) {
      this.sessionsUnsubscribe();
      this.sessionsUnsubscribe = null;
    }
    for (const timer of this.pushDebounceTimers.values()) clearTimeout(timer);
    this.pushDebounceTimers.clear();
    if (this.metadataSweepTimer !== null) {
      clearTimeout(this.metadataSweepTimer);
      this.metadataSweepTimer = null;
    }
    this.metadataSweepDirty = false;
  }

  // ===========================================================================
  // PullLoop
  // ===========================================================================

  private isRecentlyActive(): boolean {
    if (typeof document !== "undefined" && document.hasFocus()) return true;
    return Date.now() - this.lastActivityAt < ACTIVITY_WINDOW_MS;
  }

  private computeNextPullDelay(state: OrgPullState): number {
    if (state.errorCount > 0) {
      const stepIndex = Math.min(
        state.errorCount,
        ERROR_BACKOFF_STEPS_MS.length
      );
      return ERROR_BACKOFF_STEPS_MS[stepIndex - 1];
    }
    return this.isRecentlyActive()
      ? ACTIVE_PULL_INTERVAL_MS
      : IDLE_PULL_INTERVAL_MS;
  }

  private schedulePull(orgId: string, delayMs: number): void {
    if (!this.started) return;
    const state = this.pullStates.get(orgId);
    if (!state) return;
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      void this.runPullCycle(orgId);
    }, delayMs);
  }

  private async runPullCycle(orgId: string): Promise<void> {
    const generation = this.generation;
    const state = this.pullStates.get(orgId);
    if (!state || state.running || !this.store) return;
    const connection = this.getActiveConnections().find(
      ({ org }) => org.id === orgId
    );
    if (!connection) {
      // Org vanished between scheduling and firing; reconcile() owns cleanup.
      this.pullStates.delete(orgId);
      return;
    }
    state.running = true;
    try {
      await this.syncConnection(connection, generation);
      if (this.generation !== generation) return;
      state.errorCount = 0;
    } catch (error) {
      if (this.generation !== generation) return;
      state.errorCount += 1;
      this.setConnectionStatus(
        orgId,
        COLLAB_CONNECTION_STATUS.ERROR,
        toErrorMessage(error)
      );
    } finally {
      state.running = false;
    }
    if (this.generation !== generation || !this.pullStates.has(orgId)) return;
    if (state.pullAgainImmediately) {
      state.pullAgainImmediately = false;
      this.schedulePull(orgId, 0);
      return;
    }
    this.schedulePull(orgId, this.computeNextPullDelay(state));
  }

  /**
   * One pull cycle for one org. Read-only application of the server delta
   * plus events-blob import — ported 1:1 from useCollaborationMetadataSync.
   */
  private async syncConnection(
    connection: ActiveCollabConnection,
    generation: number
  ): Promise<void> {
    const { org, profile } = connection;
    const store = this.store;
    if (!store) return;

    this.setConnectionStatus(org.id, COLLAB_CONNECTION_STATUS.CONNECTING);

    // Once per org per engine start (fix M2) — success is cached; failures
    // surface as ERROR and retry under the pull-loop error backoff, never
    // per 5s cycle.
    if (!this.verifiedOrgIds.has(org.id)) {
      const result = await supabaseSyncClient.verifySetup(profile);
      if (this.generation !== generation) return;
      if (!result.ok) {
        throw new Error(SETUP_MISSING_MESSAGE);
      }
      this.verifiedOrgIds.add(org.id);
    }

    // Segments retention sweep (§7.5, server default 90 days): fired by any
    // admin client, once per org per engine start; failures are non-fatal.
    if (
      !this.gcTriggeredOrgIds.has(org.id) &&
      connection.member.role === COLLAB_ROLE.ADMIN
    ) {
      this.gcTriggeredOrgIds.add(org.id);
      supabaseSyncClient
        .gcSessionEventSegments({ ...profile, orgId: org.id })
        .catch(() => {
          // Best-effort: retried on the next engine start.
        });
    }

    const sinceTimestamp = store.get(collabLastSyncTimestampsAtom)[org.id];
    const state = await supabaseSyncClient.listOrgState({
      ...profile,
      orgId: org.id,
      sinceTimestamp,
    });
    if (this.generation !== generation) return;

    store.set(collabMembersAtom, (current) =>
      state.members.reduce(upsertCollabMember, current)
    );
    store.set(collabInvitesAtom, (current) =>
      state.invites.reduce(upsertInviteRecord, current)
    );
    store.set(collabProjectsAtom, (current) =>
      state.projects
        .map((project) =>
          withOrgId<CollabProjectMetadataRecord>(org.id, project)
        )
        .reduce(upsertCollabMetadataRecord, current)
    );
    store.set(collabWorkItemsAtom, (current) =>
      state.workItems
        .map((workItem) =>
          withOrgId<CollabWorkItemMetadataRecord>(org.id, workItem)
        )
        .reduce(upsertCollabMetadataRecord, current)
    );

    // Tombstoned sessions bypass the scope filter: removals must propagate
    // even when the org repo scopes no longer cover the session.
    const tombstonedSessionIds = new Set(
      state.sessions
        .filter((session) => session.deletedAt)
        .map((session) => session.id)
    );
    const inScopeSessions = state.sessions.filter(
      (session) => !session.deletedAt && isRemoteSessionInOrgScope(session, org)
    );
    store.set(remoteTeammateSessionsAtom, (current) =>
      inScopeSessions.reduce(
        upsertRemoteSession,
        removeRemoteSessionsByIds(current, tombstonedSessionIds)
      )
    );
    store.set(collabChatMessagesAtom, (current) =>
      state.chatMessages.reduce(upsertChatMessage, current)
    );
    store.set(collabSessionSnapshotRequestsAtom, (current) =>
      state.snapshotRequests.reduce(
        (next, request) =>
          upsertSnapshotRequest(next, {
            requestId: request.requestId,
            orgId: request.orgId,
            requesterMemberId: request.requesterMemberId,
            ownerMemberId: request.ownerMemberId,
            sourceSessionId: request.sourceSessionId,
            createdAt: request.createdAt,
            status: request.status,
            error: request.error,
          }),
        current
      )
    );
    store.set(collabRepoJoinRequestsAtom, (current) =>
      state.repoJoinRequests.reduce(upsertRepoJoinRequest, current)
    );

    // Member inference is add-only: unknown members are backfilled from
    // remote sessions / chat, known records are never overwritten (fix M4).
    const inferredMembers = [
      ...store.get(remoteTeammateSessionsAtom).map(memberFromRemoteSession),
      ...store.get(collabChatMessagesAtom).map(memberFromChatMessage),
    ];
    if (inferredMembers.length > 0) {
      store.set(collabMembersAtom, (current) =>
        inferredMembers.reduce(addMemberIfUnknown, current)
      );
    }

    await this.importRemoteSessionEvents(
      connection,
      inScopeSessions,
      generation
    );
    if (this.generation !== generation) return;

    await this.processSnapshotWork(connection, state, generation);
    if (this.generation !== generation) return;

    this.setConnectionStatus(org.id, COLLAB_CONNECTION_STATUS.CONNECTED);
    // Anchor the delta cursor on the server clock (minus a safety window) so
    // client clock skew cannot skip rows; fall back to client time when the
    // server predates serverTime.
    const syncCompletedAt = state.serverTime
      ? new Date(
          new Date(state.serverTime).getTime() - CURSOR_OVERLAP_MS
        ).toISOString()
      : new Date().toISOString();
    store.set(collabLastSyncTimestampsAtom, (current) => ({
      ...current,
      [org.id]: syncCompletedAt,
    }));
  }

  /**
   * Auto-import teammate event segments referenced by pulled metadata
   * (design §7.4). All diffing (cursor vs summary, incremental vs full
   * refetch, persistence) lives in the shared `importRemoteSession` — the
   * same function backs the panel's direct-replay action.
   */
  private async importRemoteSessionEvents(
    connection: ActiveCollabConnection,
    inScopeSessions: RemoteTeammateSessionMetadata[],
    generation: number
  ): Promise<void> {
    const { org, member, profile } = connection;
    if (!this.store) return;
    for (const remoteSession of inScopeSessions) {
      if (remoteSession.ownerMemberId === member.id) continue;
      if (remoteSession.eventsEpoch === undefined) continue;
      try {
        await importRemoteSession({
          client: supabaseSyncClient,
          profile,
          orgId: org.id,
          remoteSession,
          // Self-import guard: the import's eventStoreProxy.set re-enters
          // the PushQueue subscription — these ids must never round-trip
          // back out.
          onBeforeWrite: (localSessionId) =>
            this.importedLocalSessionIds.add(localSessionId),
        });
        if (this.generation !== generation) return;
      } catch (error) {
        if (this.generation !== generation) return;
        this.setConnectionStatus(
          org.id,
          COLLAB_CONNECTION_STATUS.ERROR,
          `Failed to import session ${remoteSession.sourceSessionId}: ${toErrorMessage(error)}`
        );
      }
    }
  }

  /**
   * PushQueue territory (§9.2): the legacy snapshot request / publish / deny
   * flows are reactive WRITE tasks, not pull application. They stay driven
   * by pull results for now so the loop function itself remains read-only
   * and all writes are centralized here.
   */
  private async processSnapshotWork(
    connection: ActiveCollabConnection,
    serverState: CollabOrgState,
    generation: number
  ): Promise<void> {
    const { org, member, settings, profile } = connection;
    const store = this.store;
    if (!store) return;

    // REQUESTER side: send locally created pending snapshot requests.
    for (const request of store.get(collabSessionSnapshotRequestsAtom)) {
      if (
        request.orgId !== org.id ||
        request.requesterMemberId !== member.id ||
        request.status !== "pending"
      ) {
        continue;
      }
      await supabaseSyncClient.requestSessionSnapshot({
        ...profile,
        requestId: request.requestId,
        orgId: request.orgId,
        requesterMemberId: request.requesterMemberId,
        ownerMemberId: request.ownerMemberId,
        sourceSessionId: request.sourceSessionId,
      });
      if (this.generation !== generation) return;
      store.set(collabSessionSnapshotRequestsAtom, (current) =>
        current.map((item) =>
          item.requestId === request.requestId
            ? { ...item, status: "sent" }
            : item
        )
      );
    }

    for (const request of serverState.snapshotRequests) {
      // OWNER side: publish the snapshot, or deny when unavailable / not
      // allowed by the owner's access settings.
      if (request.ownerMemberId === member.id && request.status === "pending") {
        const sourceSession = store
          .get(sessionsAtom)
          .find((session) => session.session_id === request.sourceSessionId);
        if (!sourceSession) {
          await supabaseSyncClient.denySessionSnapshot({
            ...profile,
            orgId: org.id,
            requestId: request.requestId,
            reason: "Session is unavailable on the owner device",
          });
          if (this.generation !== generation) return;
          continue;
        }
        const metadata = toRemoteMetadata(sourceSession, org, member, settings);
        if (!isRemoteSessionEventsPublishAllowed(metadata, org, settings)) {
          await supabaseSyncClient.denySessionSnapshot({
            ...profile,
            orgId: org.id,
            requestId: request.requestId,
            reason: "Session replay is not allowed by owner settings",
          });
          if (this.generation !== generation) return;
          continue;
        }
        const events = await eventStoreProxy.getEvents(
          sourceSession.session_id
        );
        if (this.generation !== generation) return;
        await supabaseSyncClient.publishSessionSnapshot({
          ...profile,
          requestId: request.requestId,
          orgId: org.id,
          sourceSessionId: sourceSession.session_id,
          session: metadata,
          events,
        });
        if (this.generation !== generation) return;
      }

      // REQUESTER side: import completed snapshot payloads exactly once.
      if (
        request.requesterMemberId === member.id &&
        request.status === "completed" &&
        request.session &&
        request.events &&
        store
          .get(collabSessionSnapshotRequestsAtom)
          .find((item) => item.requestId === request.requestId)?.status !==
          "completed"
      ) {
        const localSessionId = createImportedSnapshotSessionId();
        this.importedLocalSessionIds.add(localSessionId);
        const localEvents = rewriteEventsForImportedSnapshot(
          request.events,
          localSessionId
        );
        const now = new Date().toISOString();
        upsertSession({
          session_id: localSessionId,
          status: "completed",
          created_at: now,
          updated_at: now,
          completed_at: now,
          name: request.session.title,
          repoPath: request.session.repoPath,
          category: "external_history",
          model: "Collaboration Snapshot",
          agentIconId: "archive",
          agentDisplayName: "Collaboration Snapshot",
          pinned: false,
          // epoch 0 marks a legacy snapshot import (no segments cursor):
          // if the owner later publishes segments, the epoch mismatch
          // forces a clean full refetch.
          importedFrom: {
            orgId: request.orgId,
            sourceSessionId: request.sourceSessionId,
            ownerMemberId: request.session.ownerMemberId,
            ownerDisplayName: request.session.ownerDisplayName,
            epoch: 0,
            seq: 0,
            count: localEvents.length,
            frozenCount: 0,
            importedAt: now,
          },
        });
        persistSessions(store.get(sessionsAtom));
        await eventStoreProxy.set(localEvents, localSessionId);
        await eventStoreProxy.saveToCache(localSessionId);
        if (this.generation !== generation) return;
        store.set(collabSessionSnapshotRequestsAtom, (current) =>
          current.map((item) =>
            item.requestId === request.requestId
              ? { ...item, status: "completed", error: undefined }
              : item
          )
        );
        // openSession bridge: the engine cannot call React hooks — park the
        // intent for useCollabSyncEngine to consume.
        store.set(collabPendingOpenSessionAtom, {
          sessionId: localSessionId,
          title: request.session.title,
          repoPath: request.session.repoPath,
        });
      }
    }
  }

  // ===========================================================================
  // PushQueue — events blobs (eventStoreProxy-driven)
  // ===========================================================================

  private schedulePush(sessionId: string): void {
    const existing = this.pushDebounceTimers.get(sessionId);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pushDebounceTimers.delete(sessionId);
      void this.flushSessionPush(sessionId);
    }, PUSH_DEBOUNCE_MS);
    this.pushDebounceTimers.set(sessionId, timer);
  }

  private async flushSessionPush(sessionId: string): Promise<void> {
    // Per-session serialization: a flush landing while a push is in flight
    // marks the session dirty and re-runs right after — the old hook
    // silently dropped it (useCollaborationSessionPush.ts:113).
    if (this.inFlightPushSessionIds.has(sessionId)) {
      this.dirtyPushSessionIds.add(sessionId);
      return;
    }
    await this.pushSessionEvents(sessionId);
  }

  private async pushSessionEvents(sessionId: string): Promise<void> {
    const store = this.store;
    if (!store || !this.started) return;
    const generation = this.generation;
    this.inFlightPushSessionIds.add(sessionId);
    try {
      if (this.importedLocalSessionIds.has(sessionId)) return;
      const session = store
        .get(sessionsAtom)
        .find((candidate) => candidate.session_id === sessionId);
      if (!session) return;

      const pushedOrgIds: string[] = [];
      for (const connection of this.getActiveConnections()) {
        const { org, settings } = connection;
        if (!isSessionPushAllowed(session, org, settings)) continue;
        // Segments travel only at effective FULL_REPLAY (design §6.3):
        // override > shareSince gate > member default.
        if (
          getEffectiveAccessMode(session, settings) !==
          COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY
        ) {
          continue;
        }
        try {
          const pushed = await this.pushSessionEventSegments(
            connection,
            session,
            generation
          );
          if (this.generation !== generation) return;
          if (pushed) pushedOrgIds.push(org.id);
        } catch (error) {
          if (this.generation !== generation) return;
          this.setConnectionStatus(
            org.id,
            COLLAB_CONNECTION_STATUS.ERROR,
            `Failed to push session ${sessionId}: ${toErrorMessage(error)}`
          );
        }
      }
      // Our own push is the freshest signal the server has news for us.
      for (const orgId of pushedOrgIds) this.requestPullNow(orgId);
    } finally {
      this.inFlightPushSessionIds.delete(sessionId);
      if (
        this.dirtyPushSessionIds.delete(sessionId) &&
        this.started &&
        this.generation === generation
      ) {
        void this.pushSessionEvents(sessionId);
      }
    }
  }

  // --- Segments push protocol (design §7.3) ---------------------------------

  private getPushCursor(
    orgId: string,
    sessionId: string
  ): CollabSessionPushCursor | undefined {
    return this.store?.get(collabSessionPushCursorsAtom)[
      `${orgId}:${sessionId}`
    ];
  }

  private setPushCursor(cursor: CollabSessionPushCursor): void {
    this.store?.set(collabSessionPushCursorsAtom, (current) => ({
      ...current,
      [`${cursor.orgId}:${cursor.sessionId}`]: cursor,
    }));
  }

  private deletePushCursor(orgId: string, sessionId: string): void {
    const key = `${orgId}:${sessionId}`;
    this.store?.set(collabSessionPushCursorsAtom, (current) => {
      if (!(key in current)) return current;
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  }

  private async computeFrozenChainHash(
    perEventHashes: string[],
    frozenEventCount: number
  ): Promise<string> {
    return sha256Hex(perEventHashes.slice(0, frozenEventCount).join("\n"));
  }

  /**
   * One session × one org segments push. Returns true when the server was
   * written.
   *
   * Source of truth is the PERSISTED event history (never the windowed
   * in-memory view). Steady state replaces only the tail; a frozen-line
   * advance appends new frozen segments; a mutated frozen region (per-event
   * hash chain mismatch) or an OCC rejection re-anchors via an epoch-bumped
   * full rewrite.
   */
  private async pushSessionEventSegments(
    connection: ActiveCollabConnection,
    session: Session,
    generation: number
  ): Promise<boolean> {
    const { org } = connection;
    const sessionId = session.session_id;

    const events = await eventStoreProxy.getPersistedEvents(sessionId);
    if (this.generation !== generation) return false;
    const cursor = this.getPushCursor(org.id, sessionId);
    if (!cursor && events.length === 0) return false;
    if (cursor && events.length < cursor.pushedCount) {
      // Truncated-read guard (§7.3 step 1): a view shorter than what we
      // already pushed means an incomplete cache read, not a shorter
      // session — never rewrite (that would destroy the remote copy).
      console.warn(
        `[CollabSyncEngine] persisted read for ${sessionId} returned ` +
          `${events.length} events but the push cursor covers ` +
          `${cursor.pushedCount}; aborting push`
      );
      return false;
    }

    const perEventHashes = await Promise.all(
      events.map((event) => sha256Hex(stableStringify(event)))
    );
    const frozenEventCount = computeFrozenEventCount(events);
    const tailEvents = events.slice(frozenEventCount);
    const tailHash =
      tailEvents.length > 0 ? await computeSegmentHash(tailEvents) : null;
    const frozenChainHash = await this.computeFrozenChainHash(
      perEventHashes,
      frozenEventCount
    );
    if (this.generation !== generation) return false;

    if (cursor) {
      let frozenIntact = frozenEventCount >= cursor.frozenEventCount;
      if (frozenIntact && cursor.frozenEventCount > 0) {
        const chainAtCursor =
          cursor.frozenEventCount === frozenEventCount
            ? frozenChainHash
            : await this.computeFrozenChainHash(
                perEventHashes,
                cursor.frozenEventCount
              );
        frozenIntact = chainAtCursor === cursor.frozenChainHash;
      }

      if (frozenIntact) {
        const newFrozenEvents = events.slice(
          cursor.frozenEventCount,
          frozenEventCount
        );
        if (
          newFrozenEvents.length === 0 &&
          tailHash === cursor.tailHash &&
          events.length === cursor.pushedCount
        ) {
          return false; // Nothing changed since the last push.
        }
        await this.upsertSessionMetadataFor(connection, session);
        if (this.generation !== generation) return false;
        const frozenSegments = splitFrozenIntoSegments(
          newFrozenEvents,
          cursor.frozenSeq + 1
        );
        try {
          await supabaseSyncClient.appendSessionEvents({
            ...connection.profile,
            orgId: org.id,
            sessionRowId: this.sessionRowId(connection, sessionId),
            expectedEpoch: cursor.epoch,
            expectedFrozenSeq: cursor.frozenSeq,
            frozenSegments,
            tail: tailEvents.length > 0 ? tailEvents : null,
            totalCount: events.length,
          });
          if (this.generation !== generation) return false;
          this.setPushCursor({
            orgId: org.id,
            sessionId,
            epoch: cursor.epoch,
            frozenSeq: cursor.frozenSeq + frozenSegments.length,
            pushedCount: events.length,
            frozenEventCount,
            frozenChainHash,
            tailHash,
          });
          return true;
        } catch (error) {
          if (this.generation !== generation) return false;
          if (!isCollabConflictError(error)) throw error;
          // OCC rejection (concurrent device / lost server state): fall
          // through to the re-anchoring rewrite below.
          return this.rewriteSessionSegments(connection, session, {
            events,
            frozenEventCount,
            frozenChainHash,
            tailEvents,
            tailHash,
            newEpoch: null,
            generation,
          });
        }
      }

      // Frozen region mutated in place (rare: patchByIds on old events) →
      // epoch+1 full rewrite (§7.3 step 3c).
      return this.rewriteSessionSegments(connection, session, {
        events,
        frozenEventCount,
        frozenChainHash,
        tailEvents,
        tailHash,
        newEpoch: cursor.epoch + 1,
        generation,
      });
    }

    // No cursor (first push / reinstall): optimistic epoch-1 anchor; if the
    // server already holds state the OCC check bounces us into re-anchor.
    return this.rewriteSessionSegments(connection, session, {
      events,
      frozenEventCount,
      frozenChainHash,
      tailEvents,
      tailHash,
      newEpoch: 1,
      generation,
    });
  }

  /**
   * Epoch-bumped full rewrite. `newEpoch: null` (and any ORGII_CONFLICT on
   * a concrete epoch) re-anchors on the server summary — epoch = server + 1
   * — exactly once; a second conflict surfaces as an error and retries on
   * the next flush.
   */
  private async rewriteSessionSegments(
    connection: ActiveCollabConnection,
    session: Session,
    plan: {
      events: SessionEvent[];
      frozenEventCount: number;
      frozenChainHash: string;
      tailEvents: SessionEvent[];
      tailHash: string | null;
      newEpoch: number | null;
      generation: number;
    }
  ): Promise<boolean> {
    const { org, profile } = connection;
    const sessionId = session.session_id;
    const sessionRowId = this.sessionRowId(connection, sessionId);

    let epoch = plan.newEpoch;
    let reanchored = epoch === null;
    if (epoch === null) {
      epoch = (await this.readServerEpoch(connection, sessionRowId)) + 1;
      if (this.generation !== plan.generation) return false;
    }

    await this.upsertSessionMetadataFor(connection, session);
    if (this.generation !== plan.generation) return false;

    const frozenSegments = splitFrozenIntoSegments(
      plan.events.slice(0, plan.frozenEventCount),
      1
    );

    for (;;) {
      try {
        await supabaseSyncClient.rewriteSessionEvents({
          ...profile,
          orgId: org.id,
          sessionRowId,
          newEpoch: epoch,
          frozenSegments,
          tail: plan.tailEvents.length > 0 ? plan.tailEvents : null,
          totalCount: plan.events.length,
        });
        if (this.generation !== plan.generation) return false;
        this.setPushCursor({
          orgId: org.id,
          sessionId,
          epoch,
          frozenSeq: frozenSegments.length,
          pushedCount: plan.events.length,
          frozenEventCount: plan.frozenEventCount,
          frozenChainHash: plan.frozenChainHash,
          tailHash: plan.tailHash,
        });
        return true;
      } catch (error) {
        if (this.generation !== plan.generation) return false;
        if (!isCollabConflictError(error) || reanchored) throw error;
        reanchored = true;
        epoch = (await this.readServerEpoch(connection, sessionRowId)) + 1;
        if (this.generation !== plan.generation) return false;
      }
    }
  }

  private async readServerEpoch(
    connection: ActiveCollabConnection,
    sessionRowId: string
  ): Promise<number> {
    const summary = await supabaseSyncClient.getSessionEventSegments({
      ...connection.profile,
      orgId: connection.org.id,
      sessionRowId,
      afterSeq: REANCHOR_PROBE_AFTER_SEQ,
    });
    return summary.epoch ?? 0;
  }

  private sessionRowId(
    connection: ActiveCollabConnection,
    sessionId: string
  ): string {
    return `${connection.org.id}:${connection.member.id}:${sessionId}`;
  }

  private async upsertSessionMetadataFor(
    connection: ActiveCollabConnection,
    session: Session
  ): Promise<void> {
    // The sessions row must exist (owner-scoped) before any segments RPC;
    // this also refreshes updated_at so consumers see the delta.
    await supabaseSyncClient.upsertSessionMetadata({
      ...connection.profile,
      session: toRemoteMetadata(
        session,
        connection.org,
        connection.member,
        connection.settings
      ),
    });
  }

  // ===========================================================================
  // PushQueue — session metadata (sessionsAtom-driven, fix P1)
  // ===========================================================================

  private scheduleMetadataSweep(): void {
    if (this.metadataSweepTimer !== null) clearTimeout(this.metadataSweepTimer);
    this.metadataSweepTimer = setTimeout(() => {
      this.metadataSweepTimer = null;
      void this.runMetadataSweep();
    }, PUSH_DEBOUNCE_MS);
  }

  private async runMetadataSweep(): Promise<void> {
    if (this.metadataSweepRunning) {
      this.metadataSweepDirty = true;
      return;
    }
    const store = this.store;
    if (!store || !this.started) return;
    const generation = this.generation;
    this.metadataSweepRunning = true;
    try {
      for (const {
        org,
        member,
        settings,
        profile,
      } of this.getActiveConnections()) {
        let pushedAnything = false;
        try {
          for (const session of store.get(sessionsAtom)) {
            if (this.generation !== generation) return;
            const cacheKey = `${org.id}:${session.session_id}`;
            if (isSessionPushAllowed(session, org, settings)) {
              // Back in scope → future tombstones must fire again.
              this.knownRemovedSessionKeys.delete(cacheKey);
              const metadataHash = computeSessionMetadataHash(
                session,
                settings
              );
              if (
                this.lastPushedMetadataHashes.get(cacheKey) === metadataHash
              ) {
                continue;
              }
              await supabaseSyncClient.upsertSessionMetadata({
                ...profile,
                session: toRemoteMetadata(session, org, member, settings),
              });
              this.lastPushedMetadataHashes.set(cacheKey, metadataHash);
              pushedAnything = true;
            } else {
              // Exactly ONE tombstone per session leaving scope / turning
              // OFF — the known-removed set is what kills the old 5s
              // remove storm (a hash gate can't cover the remove side).
              if (this.knownRemovedSessionKeys.has(cacheKey)) continue;
              await supabaseSyncClient.removeSessionMetadata({
                ...profile,
                orgId: org.id,
                ownerMemberId: member.id,
                sourceSessionId: session.session_id,
              });
              this.knownRemovedSessionKeys.add(cacheKey);
              this.lastPushedMetadataHashes.delete(cacheKey);
              // The tombstone purged the server segments; a stale cursor
              // would only bounce off OCC when the session re-enters scope.
              this.deletePushCursor(org.id, session.session_id);
              pushedAnything = true;
            }
          }
        } catch (error) {
          if (this.generation !== generation) return;
          this.setConnectionStatus(
            org.id,
            COLLAB_CONNECTION_STATUS.ERROR,
            toErrorMessage(error)
          );
        }
        if (this.generation !== generation) return;
        if (pushedAnything) this.requestPullNow(org.id);
      }
    } finally {
      this.metadataSweepRunning = false;
      if (
        this.metadataSweepDirty &&
        this.started &&
        this.generation === generation
      ) {
        this.metadataSweepDirty = false;
        this.scheduleMetadataSweep();
      }
    }
  }

  // ===========================================================================
  // Shared
  // ===========================================================================

  private setConnectionStatus(
    orgId: string,
    status: CollabOrgConnectionState["status"],
    error?: string
  ): void {
    const store = this.store;
    if (!store) return;
    store.set(collabConnectionStatesAtom, (current) =>
      upsertConnectionState(current, {
        orgId,
        status,
        error,
        updatedAt: new Date().toISOString(),
      })
    );
  }
}

/** App-wide singleton; `useCollabSyncEngine` starts it idempotently. */
export const collabSyncEngine = new CollabSyncEngine();
