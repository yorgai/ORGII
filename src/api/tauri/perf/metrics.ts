/**
 * Process Metrics API — memory, CPU, and system information.
 * Uses cached system data when called within 1 second of last call.
 */
import { invoke } from "@tauri-apps/api/core";

import type {
  MemoryMetrics,
  ProcessMetrics,
  SystemMemoryMetrics,
} from "./types";

export async function getProcessMetrics(): Promise<ProcessMetrics> {
  return invoke<ProcessMetrics>("get_process_metrics");
}

export async function getMemoryUsage(): Promise<MemoryMetrics> {
  return invoke<MemoryMetrics>("get_memory_usage");
}

export async function getSystemMemory(): Promise<SystemMemoryMetrics> {
  return invoke<SystemMemoryMetrics>("get_system_memory");
}
