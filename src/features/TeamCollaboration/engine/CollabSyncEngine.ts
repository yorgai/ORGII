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
  collabPublishedSessionKeysAtom,
  collabRepoJoinRequestsAtom,
  collabSessionAccessSettingsAtom,
  collabSessionPushCursorsAtom,
  collabSessionSnapshotRequestsAtom,
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
  CollabSessionAccessSettings,
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
import { ProjectSyncChannel } from "./ProjectSyncChannel";
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
  upsertConnectionState,
  upsertInviteRecord,
  upsertRemoteSession,
  upsertRepoJoinRequest,
  upsertSnapshotRequest,
} from "./collabSyncEngineHelpers";
import { tauriProjectSyncBridge } from "./projectSyncBridge";

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
const SERVER_NEWER_MESSAGE =
  "This org's Supabase schema is newer than this app. Update ORGII to the latest version to keep syncing.";

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

/**
 * Identity of one pull cycle. `state` doubles as the per-org invalidation
 * token: reconcile() deletes (and on rejoin re-creates) the OrgPullState, so
 * a mid-flight cycle whose captured state no longer matches the map is for
 * an org that left — every write block checks this before touching atoms,
 * otherwise a slow pull would resurrect purged org data and advance a stale
 * delta cursor.
 */
interface OrgPullCycle {
  orgId: string;
  generation: number;
  state: OrgPullState;
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
  /** Project/work-item sync (design §16.8), one shared channel instance. */
  private readonly projectSyncChannel = new ProjectSyncChannel({
    client: supabaseSyncClient,
    bridge: tauriProjectSyncBridge,
  });
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
  /**
   * `${orgId}:${sessionId}` keys whose push was cancelled by a tombstone. An
   * in-flight segments push that completes after the sweep removed the
   * session must not write its cursor back (that would re-anchor a session
   * the owner just unshared/deleted). Cleared when the session becomes
   * push-eligible again under CURRENT settings.
   */
  private readonly cancelledPushSessionKeys = new Set<string>();
  /** Local ids the engine itself imported; never eligible for push. */
  private readonly importedLocalSessionIds = new Set<string>();
  /** Per-session consecutive push failures → bounded retry backoff. */
  private readonly pushRetryCounts = new Map<string, number>();
  /**
   * Orgs whose PERSISTED published-session keys were already diffed against
   * sessionsAtom this run (deleted-while-closed tombstones fire once).
   */
  private readonly publishedKeysDiffedThisRun = new Set<string>();
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
    this.cancelledPushSessionKeys.clear();
    this.importedLocalSessionIds.clear();
    this.pushRetryCounts.clear();
    this.publishedKeysDiffedThisRun.clear();
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
      // Deleting the state invalidates any in-flight cycle for this org
      // (every write block compares its captured state against the map) —
      // a mid-flight pull for a left org must not resurrect purged atoms
      // or advance its stale delta cursor.
      this.pullStates.delete(orgId);
      this.purgeOrgPushState(orgId);
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
      // the old per-cycle metadata push from the pull loop), and re-arm the
      // segments push for any session whose persisted history moved on
      // while the engine was not running (a crash between event write and
      // push previously stalled until the next local event).
      void this.runMetadataSweep();
      void this.resumePendingSegmentPushes();
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

  /**
   * Drop every in-memory push gate scoped to an org that left. Stale
   * entries would otherwise suppress the fresh publish / tombstone pass a
   * rejoin needs (the persisted atoms — cursors, published keys — are the
   * leave-org flow's cleanup, not reconcile's). verify/gc markers reset too
   * so a rejoin against a different Supabase project re-verifies setup.
   */
  private purgeOrgPushState(orgId: string): void {
    const orgPrefix = `${orgId}:`;
    for (const key of [...this.lastPushedMetadataHashes.keys()]) {
      if (key.startsWith(orgPrefix)) this.lastPushedMetadataHashes.delete(key);
    }
    for (const key of [...this.knownRemovedSessionKeys]) {
      if (key.startsWith(orgPrefix)) this.knownRemovedSessionKeys.delete(key);
    }
    for (const key of [...this.cancelledPushSessionKeys]) {
      if (key.startsWith(orgPrefix)) this.cancelledPushSessionKeys.delete(key);
    }
    this.publishedKeysDiffedThisRun.delete(orgId);
    this.verifiedOrgIds.delete(orgId);
    this.gcTriggeredOrgIds.delete(orgId);
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

  /**
   * True once this cycle's writes must stop: the engine stopped (generation
   * bump) or reconcile() dropped/re-created the org's pull state (org left —
   * per-org invalidation, so one org leaving never stalls the others).
   */
  private isCycleStale(cycle: OrgPullCycle): boolean {
    return (
      !this.started ||
      this.generation !== cycle.generation ||
      this.pullStates.get(cycle.orgId) !== cycle.state
    );
  }

  private async runPullCycle(orgId: string): Promise<void> {
    const state = this.pullStates.get(orgId);
    if (!state || state.running || !this.store) return;
    const cycle: OrgPullCycle = { orgId, generation: this.generation, state };
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
      await this.syncConnection(connection, cycle);
      if (this.isCycleStale(cycle)) return;
      state.errorCount = 0;
    } catch (error) {
      if (this.isCycleStale(cycle)) return;
      state.errorCount += 1;
      this.setConnectionStatus(
        orgId,
        COLLAB_CONNECTION_STATUS.ERROR,
        toErrorMessage(error)
      );
    } finally {
      state.running = false;
    }
    if (this.isCycleStale(cycle)) return;
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
    cycle: OrgPullCycle
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
      if (this.isCycleStale(cycle)) return;
      if (!result.ok) {
        // A server schema NEWER than this client isn't a missing-setup
        // problem — re-running the (older) setup SQL would be wrong. Tell the
        // user to upgrade the app instead.
        throw new Error(
          result.serverNewer ? SERVER_NEWER_MESSAGE : SETUP_MISSING_MESSAGE
        );
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
    if (this.isCycleStale(cycle)) return;

    store.set(collabMembersAtom, (current) =>
      state.members.reduce(upsertCollabMember, current)
    );
    store.set(collabInvitesAtom, (current) =>
      state.invites.reduce(upsertInviteRecord, current)
    );

    // Projects / work items land as NATIVE local rows (design §16.2/§16.8):
    // the delta is applied into SQLite (per-field merged, echo-free) and the
    // org's orgii_collab outbox is drained/pushed/acked — the old jsonb
    // mirror atoms are retired. Channel errors surface like any other pull
    // failure (connection ERROR + backoff).
    await this.projectSyncChannel.sync({
      org,
      profile,
      state,
    });
    if (this.isCycleStale(cycle)) return;

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
    const localMemberId = connection.member.id;
    store.set(collabSessionSnapshotRequestsAtom, (current) =>
      state.snapshotRequests.reduce((next, request) => {
        // For OUR OWN requests the local "completed" status is the IMPORTED
        // marker, written by processSnapshotWork only after the payload's
        // durable event write. The server's "completed" merely means the
        // payload is available — copying it here would pre-mark the request
        // and permanently skip the import (and a failed import must keep
        // its previous status so it retries next cycle).
        const status =
          request.requesterMemberId === localMemberId &&
          request.status === "completed"
            ? (next.find((item) => item.requestId === request.requestId)
                ?.status ?? "sent")
            : request.status;
        return upsertSnapshotRequest(next, {
          requestId: request.requestId,
          orgId: request.orgId,
          requesterMemberId: request.requesterMemberId,
          ownerMemberId: request.ownerMemberId,
          sourceSessionId: request.sourceSessionId,
          createdAt: request.createdAt,
          status,
          error: request.error,
        });
      }, current)
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

    const importsOk = await this.importRemoteSessionEvents(
      connection,
      inScopeSessions,
      cycle
    );
    if (this.isCycleStale(cycle)) return;

    const snapshotsOk = await this.processSnapshotWork(
      connection,
      state,
      cycle
    );
    if (this.isCycleStale(cycle)) return;

    if (!importsOk || !snapshotsOk) {
      // A failed import already reported ERROR for this org. Do NOT flip it
      // back to CONNECTED in the same cycle, and do NOT advance the delta
      // cursor: advancing would push the failed session/request out of the
      // delta window forever, so the import would never retry.
      return;
    }

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
  /**
   * Returns false when any import failed: the caller must then hold the
   * delta cursor (so the failed session stays in the next delta window and
   * retries) and must not overwrite the ERROR status with CONNECTED.
   */
  private async importRemoteSessionEvents(
    connection: ActiveCollabConnection,
    inScopeSessions: RemoteTeammateSessionMetadata[],
    cycle: OrgPullCycle
  ): Promise<boolean> {
    const { org, member, profile } = connection;
    if (!this.store) return true;
    let allImportsSucceeded = true;
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
        if (this.isCycleStale(cycle)) return false;
      } catch (error) {
        if (this.isCycleStale(cycle)) return false;
        allImportsSucceeded = false;
        this.setConnectionStatus(
          org.id,
          COLLAB_CONNECTION_STATUS.ERROR,
          `Failed to import session ${remoteSession.sourceSessionId}: ${toErrorMessage(error)}`
        );
      }
    }
    return allImportsSucceeded;
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
    cycle: OrgPullCycle
  ): Promise<boolean> {
    const { org, member, settings, profile } = connection;
    const store = this.store;
    if (!store) return true;
    let allSnapshotsSucceeded = true;

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
      if (this.isCycleStale(cycle)) return false;
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
          if (this.isCycleStale(cycle)) return false;
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
          if (this.isCycleStale(cycle)) return false;
          continue;
        }
        // Full PERSISTED history — never the windowed in-memory view: for a
        // cold (non-resident) session `getEvents` returns [], which would
        // publish an empty transcript the requester permanently marks
        // completed.
        const events = await eventStoreProxy.getPersistedEvents(
          sourceSession.session_id
        );
        if (this.isCycleStale(cycle)) return false;
        // A session whose metadata shows any activity must have events; an
        // empty read is a failed/unavailable local cache, not an empty
        // session. Deny (the requester can re-request) instead of shipping
        // an empty transcript.
        const historyExpected =
          Boolean(sourceSession.user_input) ||
          sourceSession.status !== "pending";
        if (events.length === 0 && historyExpected) {
          await supabaseSyncClient.denySessionSnapshot({
            ...profile,
            orgId: org.id,
            requestId: request.requestId,
            reason: "Session history is unavailable on the owner device",
          });
          if (this.isCycleStale(cycle)) return false;
          continue;
        }
        await supabaseSyncClient.publishSessionSnapshot({
          ...profile,
          requestId: request.requestId,
          orgId: org.id,
          sourceSessionId: sourceSession.session_id,
          session: metadata,
          events,
        });
        if (this.isCycleStale(cycle)) return false;
      }

      // REQUESTER side: import completed snapshot payloads exactly once
      // (the pull application keeps our local status at "sent" until this
      // import succeeds — see syncConnection).
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
        // Durable event write FIRST (mirrors importRemoteSession): if the
        // session record + "completed" marker were persisted before the
        // cache write and that write failed, the request would be marked
        // done forever over a permanently empty transcript.
        await eventStoreProxy.set(localEvents, localSessionId);
        const savedCount = await eventStoreProxy.saveToCache(localSessionId);
        if (this.isCycleStale(cycle)) return false;
        if (localEvents.length > 0 && savedCount <= 0) {
          // Drop the orphaned in-memory events and leave the request status
          // untouched — the held delta cursor re-delivers it next cycle.
          await eventStoreProxy.clear(localSessionId);
          if (this.isCycleStale(cycle)) return false;
          allSnapshotsSucceeded = false;
          this.setConnectionStatus(
            org.id,
            COLLAB_CONNECTION_STATUS.ERROR,
            `Failed to persist snapshot for session ${request.sourceSessionId}`
          );
          continue;
        }
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
    return allSnapshotsSucceeded;
  }

  // ===========================================================================
  // PushQueue — events blobs (eventStoreProxy-driven)
  // ===========================================================================

  private schedulePush(
    sessionId: string,
    delayMs: number = PUSH_DEBOUNCE_MS
  ): void {
    const existing = this.pushDebounceTimers.get(sessionId);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pushDebounceTimers.delete(sessionId);
      void this.flushSessionPush(sessionId);
    }, delayMs);
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
    let pushFailed = false;
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
        // Eligible again under CURRENT settings — any cancellation left by
        // an earlier tombstone is obsolete (pushes for one session are
        // serialized, so this cannot race an in-flight cancelled push).
        this.cancelledPushSessionKeys.delete(`${org.id}:${sessionId}`);
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
          pushFailed = true;
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
      if (this.started && this.generation === generation) {
        if (this.dirtyPushSessionIds.delete(sessionId)) {
          void this.pushSessionEvents(sessionId);
        } else if (pushFailed) {
          // A failed segments push used to wait for the NEXT local event to
          // retry — a completed session that failed its last push never
          // reached the server. Re-arm with bounded backoff instead.
          const retries = this.pushRetryCounts.get(sessionId) ?? 0;
          this.pushRetryCounts.set(sessionId, retries + 1);
          this.schedulePush(
            sessionId,
            ERROR_BACKOFF_STEPS_MS[
              Math.min(retries, ERROR_BACKOFF_STEPS_MS.length - 1)
            ]
          );
        } else {
          this.pushRetryCounts.delete(sessionId);
        }
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
        // Re-resolve against CURRENT atoms: the persisted read + hashing
        // above are awaits, and the session may have been unshared (or the
        // org left) in the meantime — never publish metadata built from a
        // stale connection snapshot.
        const target = this.resolveEligiblePushTarget(org.id, sessionId);
        if (!target) return false;
        await this.upsertSessionMetadataFor(target.connection, target.session);
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
          // A tombstone that landed while the append was in flight already
          // purged the cursor — writing it back would re-anchor a session
          // the owner just removed.
          if (this.isPushCancelled(org.id, sessionId)) return false;
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
   *
   * SECURITY: this path runs after server round trips (the OCC re-anchor of
   * a rejected append lands here), so the settings captured by the caller
   * can be stale — an owner who just unshared the session (accessMode OFF /
   * override off / session deleted) must not have it silently republished
   * with the pre-unshare settings, and the sweep's known-removed gate would
   * block the self-healing tombstone afterwards. Eligibility is therefore
   * re-resolved against the CURRENT atoms before every write, and the
   * metadata upsert is built from the fresh settings.
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

    let target = this.resolveEligiblePushTarget(org.id, sessionId);
    if (!target) return false;

    let epoch = plan.newEpoch;
    let reanchored = epoch === null;
    if (epoch === null) {
      epoch = (await this.readServerEpoch(connection, sessionRowId)) + 1;
      if (this.generation !== plan.generation) return false;
      // The probe was a round trip — re-check before writing anything.
      target = this.resolveEligiblePushTarget(org.id, sessionId);
      if (!target) return false;
    }

    await this.upsertSessionMetadataFor(target.connection, target.session);
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
        if (this.isPushCancelled(org.id, sessionId)) return false;
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
        target = this.resolveEligiblePushTarget(org.id, sessionId);
        if (!target) return false;
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

  /**
   * Re-resolve one (org, session) push target against the CURRENT atoms:
   * returns the fresh connection (fresh settings!) and the fresh session
   * record, or null when the push must abort — org gone, session deleted,
   * no longer push-allowed, no longer effective FULL_REPLAY, or cancelled
   * by a tombstone. Used wherever a push resumes after an await.
   */
  private resolveEligiblePushTarget(
    orgId: string,
    sessionId: string
  ): { connection: ActiveCollabConnection; session: Session } | null {
    const store = this.store;
    if (!store || !this.started) return null;
    if (this.isPushCancelled(orgId, sessionId)) return null;
    const connection = this.getActiveConnections().find(
      ({ org }) => org.id === orgId
    );
    if (!connection) return null;
    const session = store
      .get(sessionsAtom)
      .find((candidate) => candidate.session_id === sessionId);
    if (!session) return null;
    if (!isSessionPushAllowed(session, connection.org, connection.settings)) {
      return null;
    }
    if (
      getEffectiveAccessMode(session, connection.settings) !==
      COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY
    ) {
      return null;
    }
    return { connection, session };
  }

  private isPushCancelled(orgId: string, sessionId: string): boolean {
    return (
      this.cancelledPushSessionKeys.has(`${orgId}:${sessionId}`) ||
      !this.pullStates.has(orgId)
    );
  }

  /**
   * Tombstone-side cancellation (sweep → push): mark any in-flight push for
   * this (org, session) as cancelled so its completion cannot write a cursor
   * back, and kill the pending debounce timer unless another org still
   * legitimately pushes this session.
   */
  private cancelSessionPush(orgId: string, sessionId: string): void {
    this.cancelledPushSessionKeys.add(`${orgId}:${sessionId}`);
    const session = this.store
      ?.get(sessionsAtom)
      .find((candidate) => candidate.session_id === sessionId);
    const eligibleElsewhere =
      session !== undefined &&
      this.getActiveConnections().some(
        ({ org, settings }) =>
          org.id !== orgId &&
          isSessionPushAllowed(session, org, settings) &&
          getEffectiveAccessMode(session, settings) ===
            COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY
      );
    if (eligibleElsewhere) return;
    const timer = this.pushDebounceTimers.get(sessionId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pushDebounceTimers.delete(sessionId);
    }
    this.pushRetryCounts.delete(sessionId);
  }

  /**
   * First attach after start: any session whose persisted event count no
   * longer matches its persisted push cursor has server-invisible history
   * (the app stopped between the event write and the push) — re-arm it.
   */
  private async resumePendingSegmentPushes(): Promise<void> {
    const store = this.store;
    if (!store) return;
    const generation = this.generation;
    const cursors = store.get(collabSessionPushCursorsAtom);
    const persistedCounts = new Map<string, number>();
    for (const cursor of Object.values(cursors)) {
      if (this.importedLocalSessionIds.has(cursor.sessionId)) continue;
      const session = store
        .get(sessionsAtom)
        .find((candidate) => candidate.session_id === cursor.sessionId);
      // Gone sessions are the metadata sweep's tombstone job, not a push.
      if (!session) continue;
      let count = persistedCounts.get(cursor.sessionId);
      if (count === undefined) {
        count = (await eventStoreProxy.getPersistedEvents(cursor.sessionId))
          .length;
        if (this.generation !== generation || !this.started) return;
        persistedCounts.set(cursor.sessionId, count);
      }
      if (count !== cursor.pushedCount) this.schedulePush(cursor.sessionId);
    }
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
    this.recordPublishedSessionKey(
      `${connection.org.id}:${session.session_id}`
    );
  }

  /**
   * Persisted publish evidence (survives restart): written on successful
   * upsertSessionMetadata, pruned when the tombstone is sent. First-publish
   * timestamp only — repeat publishes do not churn the storage write.
   */
  private recordPublishedSessionKey(cacheKey: string): void {
    this.store?.set(collabPublishedSessionKeysAtom, (current) =>
      cacheKey in current
        ? current
        : { ...current, [cacheKey]: new Date().toISOString() }
    );
  }

  private prunePublishedSessionKey(cacheKey: string): void {
    this.store?.set(collabPublishedSessionKeysAtom, (current) => {
      if (!(cacheKey in current)) return current;
      const { [cacheKey]: _removed, ...rest } = current;
      return rest;
    });
  }

  /**
   * Evidence that (org, session) metadata ever reached the server: the
   * in-memory hash gate, a persisted segments push cursor, or the persisted
   * published-keys set. A tombstone without evidence is a no-op RPC a
   * never-published OFF session would otherwise emit on every start.
   */
  private hasPublishEvidence(orgId: string, sessionId: string): boolean {
    const cacheKey = `${orgId}:${sessionId}`;
    if (this.lastPushedMetadataHashes.has(cacheKey)) return true;
    if (this.getPushCursor(orgId, sessionId) !== undefined) return true;
    const store = this.store;
    return (
      store !== null && cacheKey in store.get(collabPublishedSessionKeysAtom)
    );
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
        const currentKeys = new Set<string>();
        try {
          for (const session of store.get(sessionsAtom)) {
            if (this.generation !== generation) return;
            // Org dropped mid-sweep (reconcile ran during an await) — stop
            // writing on its behalf.
            if (!this.pullStates.has(org.id)) break;
            const cacheKey = `${org.id}:${session.session_id}`;
            currentKeys.add(cacheKey);
            if (isSessionPushAllowed(session, org, settings)) {
              // Back in scope → future tombstones must fire again, and any
              // tombstone-cancelled push is obsolete.
              this.knownRemovedSessionKeys.delete(cacheKey);
              this.cancelledPushSessionKeys.delete(cacheKey);
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
              this.recordPublishedSessionKey(cacheKey);
              pushedAnything = true;
            } else {
              // Exactly ONE tombstone per session leaving scope / turning
              // OFF — the known-removed set is what kills the old 5s
              // remove storm (a hash gate can't cover the remove side).
              if (this.knownRemovedSessionKeys.has(cacheKey)) continue;
              // Evidence gate: a session that never reached the server has
              // nothing to remove — a never-published OFF session must not
              // emit a tombstone RPC on every engine start.
              if (!this.hasPublishEvidence(org.id, session.session_id)) {
                this.knownRemovedSessionKeys.add(cacheKey);
                continue;
              }
              // Cancel BEFORE the remove RPC: an in-flight segments push
              // completing during/after it must not re-anchor the session.
              this.cancelSessionPush(org.id, session.session_id);
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
              this.prunePublishedSessionKey(cacheKey);
              pushedAnything = true;
            }
          }

          // Sessions we previously published that are GONE from sessionsAtom
          // (the owner deleted them locally) must be tombstoned too — the loop
          // above only sees sessions that still exist, so without this a
          // deleted session's remote metadata + segments would stay visible
          // and importable to teammates forever. The candidate set is the
          // in-memory hash gate UNION (once per org per run) the PERSISTED
          // published keys, so sessions deleted while the app was closed are
          // caught on the first sweep after a restart.
          const orgPrefix = `${org.id}:`;
          const publishedKeyCandidates = new Set(
            [...this.lastPushedMetadataHashes.keys()].filter((cacheKey) =>
              cacheKey.startsWith(orgPrefix)
            )
          );
          const diffPersistedKeys = !this.publishedKeysDiffedThisRun.has(
            org.id
          );
          if (diffPersistedKeys) {
            for (const cacheKey of Object.keys(
              store.get(collabPublishedSessionKeysAtom)
            )) {
              if (cacheKey.startsWith(orgPrefix)) {
                publishedKeyCandidates.add(cacheKey);
              }
            }
          }
          for (const cacheKey of publishedKeyCandidates) {
            if (this.generation !== generation) return;
            if (!this.pullStates.has(org.id)) break;
            if (currentKeys.has(cacheKey)) continue;
            if (this.knownRemovedSessionKeys.has(cacheKey)) continue;
            const sessionId = cacheKey.slice(orgPrefix.length);
            this.cancelSessionPush(org.id, sessionId);
            await supabaseSyncClient.removeSessionMetadata({
              ...profile,
              orgId: org.id,
              ownerMemberId: member.id,
              sourceSessionId: sessionId,
            });
            this.knownRemovedSessionKeys.add(cacheKey);
            this.lastPushedMetadataHashes.delete(cacheKey);
            this.deletePushCursor(org.id, sessionId);
            this.prunePublishedSessionKey(cacheKey);
            pushedAnything = true;
          }
          // Only mark the persisted diff done when it completed without
          // throwing — a failed tombstone RPC must retry on the next sweep.
          if (diffPersistedKeys) this.publishedKeysDiffedThisRun.add(org.id);
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
