import { invoke as invokeTauri } from "@tauri-apps/api/core";

import type { SessionLaunchParams } from "@src/api/tauri/agent/session";

export const BENCHMARK_KIND = {
  SWE_BENCH_PRO: "swe_bench_pro",
  TERMINAL_BENCH: "terminal_bench",
} as const;

export type BenchmarkKind =
  (typeof BENCHMARK_KIND)[keyof typeof BENCHMARK_KIND];

export const BENCHMARK_EVALUATION_MODE = {
  PATCH_ONLY: "patch_only",
  LOCAL_DOCKER: "local_docker",
  MODAL: "modal",
} as const;

export type BenchmarkEvaluationMode =
  (typeof BENCHMARK_EVALUATION_MODE)[keyof typeof BENCHMARK_EVALUATION_MODE];

export const BENCHMARK_RUN_STATUS = {
  RUNNING: "running",
  PASSED: "passed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  APPLIED: "applied",
} as const;

export type BenchmarkRunStatusValue =
  (typeof BENCHMARK_RUN_STATUS)[keyof typeof BENCHMARK_RUN_STATUS];

export const BENCHMARK_AGENT_BATCH_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  LAUNCHED: "launched",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type BenchmarkAgentBatchStatusValue =
  (typeof BENCHMARK_AGENT_BATCH_STATUS)[keyof typeof BENCHMARK_AGENT_BATCH_STATUS];

export const BENCHMARK_RUN_TYPE = {
  SINGLE: "single",
  BATCH: "batch",
} as const;

export type BenchmarkRunType =
  (typeof BENCHMARK_RUN_TYPE)[keyof typeof BENCHMARK_RUN_TYPE];

export type BenchmarkAgentLaunchSelection = Omit<
  SessionLaunchParams,
  | "content"
  | "name"
  | "background"
  | "images"
  | "ideContext"
  | "workItemId"
  | "agentRole"
>;

export interface BenchmarkAgentBatchItem {
  taskId: string;
  status: BenchmarkAgentBatchStatusValue;
  sessionId?: string | null;
  sessionName?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
  logs: string[];
}

export interface BenchmarkAgentBatchStatus {
  batchId: string;
  benchmarkKind: BenchmarkKind;
  sourcePath: string;
  status: BenchmarkAgentBatchStatusValue;
  totalTasks: number;
  queued: number;
  running: number;
  launched: number;
  failed: number;
  cancelled: number;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  concurrency: number;
  items: BenchmarkAgentBatchItem[];
  error?: string | null;
}

export interface BenchmarkTaskIndexRow {
  benchmarkKind: BenchmarkKind;
  taskId: string;
  title: string;
  sourcePath: string;
  repo?: string | null;
  wordCount: number;
  charCount: number;
  tags: string[];
  difficulty?: string | null;
  metadata: Record<string, unknown>;
}

export interface BenchmarkTaskDetail extends BenchmarkTaskIndexRow {
  instruction: string;
}

export interface BenchmarkPreflightCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string | null;
}

export interface BenchmarkPreflightResult {
  benchmarkKind: BenchmarkKind;
  evaluationMode: BenchmarkEvaluationMode;
  ready: boolean;
  checks: BenchmarkPreflightCheck[];
}

export interface BenchmarkRunPlan {
  runId: string;
  benchmarkKind: BenchmarkKind;
  evaluationMode: BenchmarkEvaluationMode;
  taskId: string;
  sourcePath: string;
  repoPath?: string | null;
  patchPath: string;
  outputDir: string;
  evaluatorScript?: string | null;
  scriptsDir?: string | null;
  worktreePath?: string | null;
  commandPreview: string[];
  preflight: BenchmarkPreflightResult;
}

export interface BenchmarkRunStatus {
  runId: string;
  benchmarkKind: BenchmarkKind;
  evaluationMode: BenchmarkEvaluationMode;
  taskId: string;
  status: BenchmarkRunStatusValue;
  sourcePath: string;
  repoPath?: string | null;
  patchPath: string;
  outputDir: string;
  worktreePath?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  exitCode?: number | null;
  processId?: number | null;
  logs: string[];
  result?: unknown;
  error?: string | null;
}

export interface BenchmarkListTasksRequest {
  kind: BenchmarkKind;
  sourcePath: string;
  query?: string;
  limit?: number;
}

export interface BenchmarkGetTaskRequest {
  kind: BenchmarkKind;
  sourcePath: string;
  taskId: string;
}

export interface BenchmarkPreflightRequest {
  kind: BenchmarkKind;
  sourcePath: string;
  evaluationMode: BenchmarkEvaluationMode;
  taskId?: string;
  repoPath?: string;
}

export interface BenchmarkCreateRunPlanRequest {
  kind: BenchmarkKind;
  sourcePath: string;
  taskId: string;
  patch: string;
  evaluationMode: BenchmarkEvaluationMode;
  repoPath?: string;
}

export interface BenchmarkStartRunRequest {
  kind: BenchmarkKind;
  sourcePath: string;
  taskId: string;
  patch: string;
  evaluationMode: BenchmarkEvaluationMode;
  repoPath?: string;
}

export interface BenchmarkGetRunStatusRequest {
  runId: string;
}

export interface BenchmarkCancelRunRequest {
  runId: string;
}

export interface BenchmarkStartAgentBatchRequest {
  kind: BenchmarkKind;
  sourcePath: string;
  taskIds: string[];
  launch: BenchmarkAgentLaunchSelection;
  concurrency?: number;
}

export interface BenchmarkGetAgentBatchStatusRequest {
  batchId: string;
}

export interface BenchmarkCancelAgentBatchRequest {
  batchId: string;
}

export const benchmarkApi = {
  listTasks(
    request: BenchmarkListTasksRequest
  ): Promise<BenchmarkTaskIndexRow[]> {
    return invokeTauri<BenchmarkTaskIndexRow[]>("benchmark_list_tasks", {
      request,
    });
  },

  getTask(request: BenchmarkGetTaskRequest): Promise<BenchmarkTaskDetail> {
    return invokeTauri<BenchmarkTaskDetail>("benchmark_get_task", { request });
  },

  preflight(
    request: BenchmarkPreflightRequest
  ): Promise<BenchmarkPreflightResult> {
    return invokeTauri<BenchmarkPreflightResult>("benchmark_preflight", {
      request,
    });
  },

  createRunPlan(
    request: BenchmarkCreateRunPlanRequest
  ): Promise<BenchmarkRunPlan> {
    return invokeTauri<BenchmarkRunPlan>("benchmark_create_run_plan", {
      request,
    });
  },

  startRun(request: BenchmarkStartRunRequest): Promise<BenchmarkRunStatus> {
    return invokeTauri<BenchmarkRunStatus>("benchmark_start_run", { request });
  },

  getRunStatus(
    request: BenchmarkGetRunStatusRequest
  ): Promise<BenchmarkRunStatus> {
    return invokeTauri<BenchmarkRunStatus>("benchmark_get_run_status", {
      request,
    });
  },

  cancelRun(request: BenchmarkCancelRunRequest): Promise<BenchmarkRunStatus> {
    return invokeTauri<BenchmarkRunStatus>("benchmark_cancel_run", { request });
  },

  startAgentBatch(
    request: BenchmarkStartAgentBatchRequest
  ): Promise<BenchmarkAgentBatchStatus> {
    return invokeTauri<BenchmarkAgentBatchStatus>(
      "benchmark_start_agent_batch",
      { request }
    );
  },

  getAgentBatchStatus(
    request: BenchmarkGetAgentBatchStatusRequest
  ): Promise<BenchmarkAgentBatchStatus> {
    return invokeTauri<BenchmarkAgentBatchStatus>(
      "benchmark_get_agent_batch_status",
      { request }
    );
  },

  cancelAgentBatch(
    request: BenchmarkCancelAgentBatchRequest
  ): Promise<BenchmarkAgentBatchStatus> {
    return invokeTauri<BenchmarkAgentBatchStatus>(
      "benchmark_cancel_agent_batch",
      { request }
    );
  },
};
