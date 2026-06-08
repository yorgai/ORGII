const lastObservedWorkingAtBySession = new Map<string, number>();
const lastObservedSettleAtBySession = new Map<string, number>();
const lastObservedTerminalAtBySession = new Map<string, number>();
const releasedTurnIdsBySession = new Map<string, Map<string, number>>();
const terminalTurnIdsBySession = new Map<string, Map<string, number>>();
const pendingTurnTerminalEventsBySession = new Map<
  string,
  Array<{ at: number; status: string }>
>();

export const PENDING_RUST_ACTIVE_TURN_ID = "__pending_rust_active_turn__";

const QUEUE_RUNTIME_WORKING_STATUSES = new Set<string>([
  "running",
  "installing",
  "waiting_for_user",
  "waiting_for_funds",
]);

const QUEUE_RELEASING_TURN_STATUSES = new Set<string>(["completed", "failed"]);

function isQueueReleasingTurnStatus(status: string): boolean {
  return QUEUE_RELEASING_TURN_STATUSES.has(status);
}

export function isQueueRuntimeStillWorking(runtimeStatus: string): boolean {
  return QUEUE_RUNTIME_WORKING_STATUSES.has(runtimeStatus);
}

export function markQueueTurnWorking(sessionId: string, at = Date.now()): void {
  lastObservedWorkingAtBySession.set(sessionId, at);
}

export function markQueueTurnSettled(
  sessionId: string,
  at = Date.now(),
  turnId?: string,
  turnStatus = "completed"
): void {
  lastObservedTerminalAtBySession.set(sessionId, at);
  if (turnId) {
    const terminalEvents =
      pendingTurnTerminalEventsBySession.get(sessionId) ?? [];
    terminalEvents.push({ at, status: turnStatus });
    while (terminalEvents.length > 50) terminalEvents.shift();
    pendingTurnTerminalEventsBySession.set(sessionId, terminalEvents);

    let terminalTurns = terminalTurnIdsBySession.get(sessionId);
    if (!terminalTurns) {
      terminalTurns = new Map<string, number>();
      terminalTurnIdsBySession.set(sessionId, terminalTurns);
    }
    terminalTurns.set(turnId, at);
  }

  if (!isQueueReleasingTurnStatus(turnStatus)) return;
  lastObservedSettleAtBySession.set(sessionId, at);
  if (!turnId) return;
  let releasedTurns = releasedTurnIdsBySession.get(sessionId);
  if (!releasedTurns) {
    releasedTurns = new Map<string, number>();
    releasedTurnIdsBySession.set(sessionId, releasedTurns);
  }
  releasedTurns.set(turnId, at);
}

export function hasQueueTurnSettledAfter(
  sessionId: string,
  at: number,
  turnId?: string
): boolean {
  if (turnId === PENDING_RUST_ACTIVE_TURN_ID) {
    const terminalEvent = pendingTurnTerminalEventsBySession
      .get(sessionId)
      ?.find((event) => event.at > at);
    return terminalEvent
      ? isQueueReleasingTurnStatus(terminalEvent.status)
      : false;
  }

  if (turnId) {
    const releasedAt =
      releasedTurnIdsBySession.get(sessionId)?.get(turnId) ?? 0;
    return releasedAt > at;
  }
  const lastSettleAt = lastObservedSettleAtBySession.get(sessionId) ?? 0;
  return lastSettleAt > at;
}

export function hasQueueTurnTerminatedAfter(
  sessionId: string,
  at: number,
  turnId?: string
): boolean {
  if (turnId === PENDING_RUST_ACTIVE_TURN_ID) {
    return Boolean(
      pendingTurnTerminalEventsBySession
        .get(sessionId)
        ?.some((event) => event.at > at)
    );
  }

  if (turnId) {
    const terminalAt =
      terminalTurnIdsBySession.get(sessionId)?.get(turnId) ?? 0;
    return terminalAt > at;
  }

  const lastTerminalAt = lastObservedTerminalAtBySession.get(sessionId) ?? 0;
  return lastTerminalAt > at;
}

export function hasQueueTurnWorkedThenSettledAfter(
  sessionId: string,
  at: number
): boolean {
  const lastWorkingAt = lastObservedWorkingAtBySession.get(sessionId) ?? 0;
  const lastSettleAt = lastObservedSettleAtBySession.get(sessionId) ?? 0;
  return lastWorkingAt > at && lastSettleAt > lastWorkingAt;
}

export function hasObservedUnsettledQueueTurn(sessionId: string): boolean {
  const lastWorkingAt = lastObservedWorkingAtBySession.get(sessionId) ?? 0;
  const lastSettleAt = lastObservedSettleAtBySession.get(sessionId) ?? 0;
  return lastWorkingAt > lastSettleAt;
}

interface ShouldQueueAsActiveOptions {
  sessionId: string;
  isActive: boolean;
  runtimeIsWorking: boolean;
  pendingCancel: boolean;
  now?: number;
}

export function shouldQueueSubmitAsActiveTurn({
  isActive,
  runtimeIsWorking,
  pendingCancel,
}: ShouldQueueAsActiveOptions): boolean {
  if (isActive || runtimeIsWorking || pendingCancel) {
    return true;
  }

  return false;
}

export function resetQueueTurnGateForTests(): void {
  lastObservedWorkingAtBySession.clear();
  lastObservedSettleAtBySession.clear();
  lastObservedTerminalAtBySession.clear();
  releasedTurnIdsBySession.clear();
  terminalTurnIdsBySession.clear();
  pendingTurnTerminalEventsBySession.clear();
}
