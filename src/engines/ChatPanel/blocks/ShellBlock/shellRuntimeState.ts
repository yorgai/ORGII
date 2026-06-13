import type { EventStatus } from "@src/engines/SessionCore/rendering/types/universalProps";

export const TERMINAL_FOREGROUND_WAIT_THRESHOLD_MS = 10_000;

type ShellProcessStatus = "running" | "background" | "exited" | "killed";

interface ShellRuntimeStateInput {
  status: EventStatus;
  showActiveEventPainting?: boolean;
  timestamp?: string;
  nowMs: number;
  shellProcessStatus?: ShellProcessStatus;
  exitCode?: number;
}

export interface ShellRuntimeDisplayState {
  isForegroundRunning: boolean;
  isLongForegroundWait: boolean;
  isLoading: boolean;
}

function getEventAgeMs(
  timestamp: string | undefined,
  nowMs: number
): number | null {
  if (!timestamp) return null;
  const createdAtMs = new Date(timestamp).getTime();
  if (Number.isNaN(createdAtMs)) return null;
  return Math.max(0, nowMs - createdAtMs);
}

export function resolveShellRuntimeDisplayState(
  input: ShellRuntimeStateInput
): ShellRuntimeDisplayState {
  const isTerminalStatus =
    input.status === "success" ||
    input.status === "failed" ||
    input.status === "cancelled";
  const isProcessSettled =
    input.shellProcessStatus === "exited" ||
    input.shellProcessStatus === "killed";
  const isProcessBackgrounded = input.shellProcessStatus === "background";
  const hasExitSignal = input.exitCode !== undefined || isProcessSettled;
  const isForegroundRunning =
    !isTerminalStatus &&
    !isProcessBackgrounded &&
    !hasExitSignal &&
    (input.shellProcessStatus === "running" ||
      input.status === "running" ||
      input.status === "pending");

  const ageMs = getEventAgeMs(input.timestamp, input.nowMs);
  const isLongForegroundWait =
    isForegroundRunning &&
    ageMs !== null &&
    ageMs >= TERMINAL_FOREGROUND_WAIT_THRESHOLD_MS;
  const isLoading =
    isForegroundRunning &&
    (input.showActiveEventPainting === true ||
      input.shellProcessStatus === "running" ||
      isLongForegroundWait);

  return {
    isForegroundRunning,
    isLongForegroundWait,
    isLoading,
  };
}
