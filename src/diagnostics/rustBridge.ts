import { invoke } from "@tauri-apps/api/core";

import { createLogger } from "@src/hooks/logger";

import type {
  DiagnosticsServiceConfig,
  DiagnosticsUsageSnapshot,
} from "./types";

const logger = createLogger("Diagnostics");

let rustDiagnosticsAvailable: boolean | undefined;

function isMissingDiagnosticsCommand(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("diagnostics_start") ||
    message.includes("diagnostics_configure") ||
    message.includes("diagnostics_flush_now") ||
    message.includes("diagnostics_record_usage_snapshot") ||
    message.includes("Command") ||
    message.includes("not found") ||
    message.includes("unknown")
  );
}

async function invokeDiagnosticsCommand(
  command: string,
  payload?: Record<string, unknown>
): Promise<boolean> {
  if (rustDiagnosticsAvailable === false) return false;

  try {
    await invoke(command, payload ?? {});
    rustDiagnosticsAvailable = true;
    return true;
  } catch (error) {
    if (isMissingDiagnosticsCommand(error)) {
      rustDiagnosticsAvailable = false;
      logger.debug("Rust Diagnostics command unavailable", command);
      return false;
    }

    throw error;
  }
}

export function resetRustDiagnosticsAvailability(): void {
  rustDiagnosticsAvailable = undefined;
}

export async function diagnosticsStart(
  config: DiagnosticsServiceConfig
): Promise<boolean> {
  return invokeDiagnosticsCommand("diagnostics_start", { config });
}

export async function diagnosticsConfigure(
  config: DiagnosticsServiceConfig
): Promise<boolean> {
  return invokeDiagnosticsCommand("diagnostics_configure", { config });
}

export async function diagnosticsRecordUsageSnapshot(
  snapshot: DiagnosticsUsageSnapshot
): Promise<boolean> {
  return invokeDiagnosticsCommand("diagnostics_record_usage_snapshot", {
    snapshot,
  });
}

export async function diagnosticsFlushNow(): Promise<boolean> {
  return invokeDiagnosticsCommand("diagnostics_flush_now");
}
