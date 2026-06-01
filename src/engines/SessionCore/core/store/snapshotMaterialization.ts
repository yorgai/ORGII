import type { SessionEvent, SimulatorEventPreview } from "../types";
import type {
  DerivedSnapshot,
  NormalizedSnapshotCache,
  Snapshot,
  SnapshotDelta,
  SnapshotPayload,
  StreamingSnapshot,
} from "./EventStoreProxyTypes";

export function isStreamingSnapshot(
  snapshot: Snapshot
): snapshot is StreamingSnapshot {
  return "streaming" in snapshot && snapshot.streaming === true;
}

export function isSnapshotDelta(
  payload: SnapshotPayload
): payload is SnapshotDelta {
  return "snapshotDelta" in payload && payload.snapshotDelta === true;
}

function buildSimulatorEventPreview(
  event: SessionEvent
): SimulatorEventPreview {
  return {
    id: event.id,
    sessionId: event.sessionId,
    createdAt: event.createdAt,
    functionName: event.functionName,
    uiCanonical: event.uiCanonical,
    actionType: event.actionType,
    source: event.source,
    displayText: event.displayText,
    displayStatus: event.displayStatus,
    displayVariant: event.displayVariant,
    activityStatus: event.activityStatus,
    threadId: event.threadId,
    processId: event.processId,
    callId: event.callId,
    filePath: event.filePath,
    command: event.command,
    isDelta: event.isDelta,
    repoId: event.repoId,
    repoPath: event.repoPath,
  };
}

function rebuildSimulatorPreviewIndexes(
  cache: NormalizedSnapshotCache,
  simulatorEvents: SessionEvent[]
): void {
  const eventPreviewById: Record<string, SimulatorEventPreview> = {};
  const createdAtById: Record<string, string> = {};
  const threadIdById: Record<string, string> = {};
  const functionNameById: Record<string, string> = {};
  const displayStatusById: Record<string, string> = {};
  const displayVariantById: Record<string, string> = {};

  for (const event of simulatorEvents) {
    eventPreviewById[event.id] = buildSimulatorEventPreview(event);
    createdAtById[event.id] = event.createdAt;
    if (event.threadId) threadIdById[event.id] = event.threadId;
    functionNameById[event.id] = event.functionName;
    displayStatusById[event.id] = event.displayStatus;
    displayVariantById[event.id] = event.displayVariant;
  }

  cache.eventPreviewById = eventPreviewById;
  cache.createdAtById = createdAtById;
  cache.threadIdById = threadIdById;
  cache.functionNameById = functionNameById;
  cache.displayStatusById = displayStatusById;
  cache.displayVariantById = displayVariantById;
}

export function attachSimulatorPreviewFields<TSnapshot extends Snapshot>(
  snapshot: TSnapshot,
  cache: NormalizedSnapshotCache
): TSnapshot {
  return {
    ...snapshot,
    sortedSimulatorEventIds: cache.sortedSimulatorEventIds,
    eventPreviewById: cache.eventPreviewById,
    createdAtById: cache.createdAtById,
    threadIdById: cache.threadIdById,
    functionNameById: cache.functionNameById,
    displayStatusById: cache.displayStatusById,
    displayVariantById: cache.displayVariantById,
  };
}

export function buildNormalizedCache(
  snapshot: Snapshot
): NormalizedSnapshotCache | null {
  if (!("events" in snapshot)) return null;
  const eventsById = new Map<string, SessionEvent>();
  for (const event of snapshot.events) {
    eventsById.set(event.id, event);
  }
  const cache: NormalizedSnapshotCache = {
    eventsById,
    eventIds: snapshot.events.map((event) => event.id),
    chatEventIds: snapshot.chatEvents.map((event) => event.id),
    messagesEventIds: snapshot.messagesEvents.map((event) => event.id),
    sortedSimulatorEventIds: snapshot.sortedSimulatorEvents.map(
      (event) => event.id
    ),
    eventPreviewById: {},
    createdAtById: {},
    threadIdById: {},
    functionNameById: {},
    displayStatusById: {},
    displayVariantById: {},
  };
  rebuildSimulatorPreviewIndexes(cache, snapshot.sortedSimulatorEvents);
  return cache;
}

function eventsForIds(
  cache: NormalizedSnapshotCache,
  ids: string[]
): SessionEvent[] {
  return ids
    .map((id) => cache.eventsById.get(id))
    .filter((event): event is SessionEvent => Boolean(event));
}

function buildEventIndex(events: SessionEvent[]): Record<string, number> {
  const eventIndex: Record<string, number> = {};
  for (let index = 0; index < events.length; index++) {
    eventIndex[events[index].id] = index;
  }
  return eventIndex;
}

export function materializeSnapshot(
  delta: SnapshotDelta,
  cache: NormalizedSnapshotCache
): DerivedSnapshot {
  const events = eventsForIds(cache, delta.eventIds);
  const sortedSimulatorEvents = eventsForIds(
    cache,
    delta.sortedSimulatorEventIds
  );
  rebuildSimulatorPreviewIndexes(cache, sortedSimulatorEvents);
  return attachSimulatorPreviewFields(
    {
      version: delta.version,
      eventCount: delta.eventCount,
      events,
      chatEvents: eventsForIds(cache, delta.chatEventIds),
      messagesEvents: eventsForIds(cache, delta.messagesEventIds),
      sortedSimulatorEvents,
      lastEvent: delta.lastEventId
        ? (cache.eventsById.get(delta.lastEventId) ?? null)
        : null,
      eventIndex: buildEventIndex(events),
      chatEventCount: delta.chatEventCount,
      hasRunningEvent: delta.hasRunningEvent,
    },
    cache
  );
}

export function materializeStreamingSnapshot(
  snapshot: StreamingSnapshot
): StreamingSnapshot {
  if (snapshot.sortedSimulatorEventIds && snapshot.eventPreviewById) {
    return {
      ...snapshot,
      sortedSimulatorEventIds: snapshot.sortedSimulatorEventIds,
      eventPreviewById: snapshot.eventPreviewById,
      createdAtById: snapshot.createdAtById ?? {},
      threadIdById: snapshot.threadIdById ?? {},
      functionNameById: snapshot.functionNameById ?? {},
      displayStatusById: snapshot.displayStatusById ?? {},
      displayVariantById: snapshot.displayVariantById ?? {},
    };
  }

  const cache: NormalizedSnapshotCache = {
    eventsById: new Map(),
    eventIds: [],
    chatEventIds: snapshot.chatEvents.map((event) => event.id),
    messagesEventIds: [],
    sortedSimulatorEventIds: snapshot.sortedSimulatorEvents.map(
      (event) => event.id
    ),
    eventPreviewById: {},
    createdAtById: {},
    threadIdById: {},
    functionNameById: {},
    displayStatusById: {},
    displayVariantById: {},
  };
  rebuildSimulatorPreviewIndexes(cache, snapshot.sortedSimulatorEvents);
  return attachSimulatorPreviewFields(snapshot, cache);
}
