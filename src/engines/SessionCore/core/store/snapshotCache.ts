import type {
  DerivedSnapshot,
  NormalizedSnapshotCache,
  Snapshot,
  SnapshotPayload,
} from "./EventStoreProxyTypes";
import {
  attachSimulatorPreviewFields,
  buildNormalizedCache,
  isSnapshotDelta,
  isStreamingSnapshot,
  materializeSnapshot,
  materializeStreamingSnapshot,
} from "./snapshotMaterialization";

export async function resolveSnapshotPayload(
  sessionId: string,
  payload: SnapshotPayload,
  latestSnapshots: Map<string, Snapshot>,
  normalizedSnapshots: Map<string, NormalizedSnapshotCache>,
  fetchSnapshot: (sessionId: string) => Promise<DerivedSnapshot>
): Promise<Snapshot> {
  if (!isSnapshotDelta(payload)) return payload;

  const previous = latestSnapshots.get(sessionId);
  const cache = normalizedSnapshots.get(sessionId);
  if (!previous || !cache || previous.version !== payload.baseVersion) {
    return fetchSnapshot(sessionId);
  }

  for (const removedId of payload.removedIds) {
    cache.eventsById.delete(removedId);
  }
  for (const event of payload.upserts) {
    cache.eventsById.set(event.id, event);
  }
  cache.eventIds = payload.eventIds;
  cache.chatEventIds = payload.chatEventIds;
  cache.messagesEventIds = payload.messagesEventIds;
  cache.sortedSimulatorEventIds = payload.sortedSimulatorEventIds;
  return materializeSnapshot(payload, cache);
}

export function rememberSnapshot(
  sessionId: string,
  snapshot: Snapshot,
  latestSnapshots: Map<string, Snapshot>,
  normalizedSnapshots: Map<string, NormalizedSnapshotCache>,
  maxSnapshots: number
): Snapshot {
  // Reject version regressions: a late-arriving older snapshot (e.g. a slow
  // getSnapshot() resolving after a newer push was already remembered) must
  // not clobber the newer cache state. Keep and return the cached snapshot.
  const cached = latestSnapshots.get(sessionId);
  if (cached && snapshot.version < cached.version) {
    return cached;
  }

  const normalized = buildNormalizedCache(snapshot);
  const snapshotToStore = normalized
    ? attachSimulatorPreviewFields(snapshot as DerivedSnapshot, normalized)
    : isStreamingSnapshot(snapshot)
      ? materializeStreamingSnapshot(snapshot)
      : snapshot;

  if (normalized) {
    normalizedSnapshots.delete(sessionId);
    normalizedSnapshots.set(sessionId, normalized);
  }

  latestSnapshots.delete(sessionId);
  latestSnapshots.set(sessionId, snapshotToStore);

  if (latestSnapshots.size > maxSnapshots) {
    const oldest = latestSnapshots.keys().next().value;
    if (oldest !== undefined) {
      latestSnapshots.delete(oldest);
      normalizedSnapshots.delete(oldest);
    }
  }

  return snapshotToStore;
}
