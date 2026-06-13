import { bucketDurationMs } from "./buckets";
import type { DiagnosticsRuntimeSummary } from "./types";

interface RuntimeCounter {
  total: number;
  failure: number;
  durations: number[];
}

const rpcCounters = new Map<string, RuntimeCounter>();
const httpCounters = new Map<string, RuntimeCounter>();

function getCounter(
  counters: Map<string, RuntimeCounter>,
  operation: string
): RuntimeCounter {
  const existing = counters.get(operation);
  if (existing) return existing;
  const created: RuntimeCounter = { total: 0, failure: 0, durations: [] };
  counters.set(operation, created);
  return created;
}

export function recordDiagnosticsRpc(
  command: string,
  durationMs: number,
  ok: boolean
): void {
  const counter = getCounter(rpcCounters, command);
  counter.total += 1;
  if (!ok) counter.failure += 1;
  counter.durations.push(durationMs);
}

export function recordDiagnosticsHttp(
  target: string,
  durationMs: number,
  ok: boolean
): void {
  const counter = getCounter(httpCounters, target);
  counter.total += 1;
  if (!ok) counter.failure += 1;
  counter.durations.push(durationMs);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function consumeDiagnosticsSummary(
  counters: Map<string, RuntimeCounter>
): DiagnosticsRuntimeSummary {
  let total = 0;
  let failure = 0;
  const byOperation: DiagnosticsRuntimeSummary["byOperation"] = {};

  for (const [operation, counter] of counters) {
    total += counter.total;
    failure += counter.failure;
    byOperation[operation] = {
      total: counter.total,
      success: counter.total - counter.failure,
      failure: counter.failure,
      durationBucket: bucketDurationMs(average(counter.durations)),
    };
  }

  counters.clear();
  return { total, success: total - failure, failure, byOperation };
}

export function consumeRpcDiagnosticsSummary(): DiagnosticsRuntimeSummary {
  return consumeDiagnosticsSummary(rpcCounters);
}

export function consumeHttpDiagnosticsSummary(): DiagnosticsRuntimeSummary {
  return consumeDiagnosticsSummary(httpCounters);
}
