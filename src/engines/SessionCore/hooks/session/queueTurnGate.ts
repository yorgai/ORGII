const lastObservedWorkingAtBySession = new Map<string, number>();
const lastObservedSettleAtBySession = new Map<string, number>();

const QUEUE_RUNTIME_WORKING_STATUSES = new Set<string>([
  "running",
  "installing",
  "waiting_for_user",
  "waiting_for_funds",
]);

export function isQueueRuntimeStillWorking(
  runtimeStatus: string,
  snapshotActive: boolean
): boolean {
  return QUEUE_RUNTIME_WORKING_STATUSES.has(runtimeStatus) || snapshotActive;
}

export function markQueueTurnWorking(sessionId: string, at = Date.now()): void {
  lastObservedWorkingAtBySession.set(sessionId, at);
}

export function markQueueTurnSettled(sessionId: string, at = Date.now()): void {
  lastObservedSettleAtBySession.set(sessionId, at);
}

export function hasQueueTurnSettledAfter(
  sessionId: string,
  at: number
): boolean {
  const lastSettleAt = lastObservedSettleAtBySession.get(sessionId) ?? 0;
  return lastSettleAt > at;
}

export function hasQueueTurnWorkedThenSettledAfter(
  sessionId: string,
  at: number
): boolean {
  const lastWorkingAt = lastObservedWorkingAtBySession.get(sessionId) ?? 0;
  const lastSettleAt = lastObservedSettleAtBySession.get(sessionId) ?? 0;
  return lastWorkingAt > at && lastSettleAt > lastWorkingAt;
}

interface ShouldQueueAsActiveOptions {
  sessionId: string;
  isActive: boolean;
  runtimeIsWorking: boolean;
  pendingCancel: boolean;
  submitGuardActive: boolean;
  now?: number;
}

export function shouldQueueSubmitAsActiveTurn({
  sessionId,
  isActive,
  runtimeIsWorking,
  pendingCancel,
  submitGuardActive,
}: ShouldQueueAsActiveOptions): boolean {
  if (isActive || runtimeIsWorking || pendingCancel || submitGuardActive) {
    return true;
  }

  const lastWorkingAt = lastObservedWorkingAtBySession.get(sessionId) ?? 0;
  if (lastWorkingAt <= 0) return false;

  const lastSettleAt = lastObservedSettleAtBySession.get(sessionId) ?? 0;
  return lastSettleAt < lastWorkingAt;
}

export function resetQueueTurnGateForTests(): void {
  lastObservedWorkingAtBySession.clear();
  lastObservedSettleAtBySession.clear();
}
