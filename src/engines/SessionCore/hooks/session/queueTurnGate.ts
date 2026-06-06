const lastObservedWorkingAtBySession = new Map<string, number>();
const lastObservedSettleAtBySession = new Map<string, number>();

export const SUBMIT_ACTIVE_GRACE_MS = 2_500;

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
  now = Date.now(),
}: ShouldQueueAsActiveOptions): boolean {
  if (isActive || runtimeIsWorking || pendingCancel || submitGuardActive) {
    return true;
  }

  const lastWorkingAt = lastObservedWorkingAtBySession.get(sessionId) ?? 0;
  if (lastWorkingAt <= 0 || now - lastWorkingAt >= SUBMIT_ACTIVE_GRACE_MS) {
    return false;
  }

  const lastSettleAt = lastObservedSettleAtBySession.get(sessionId) ?? 0;
  return lastSettleAt < lastWorkingAt;
}

export function resetQueueTurnGateForTests(): void {
  lastObservedWorkingAtBySession.clear();
  lastObservedSettleAtBySession.clear();
}
