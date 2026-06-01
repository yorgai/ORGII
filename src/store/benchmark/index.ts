import { atom } from "jotai";

import {
  BENCHMARK_EVALUATION_MODE,
  BENCHMARK_KIND,
  type BenchmarkEvaluationMode,
  type BenchmarkPreflightResult,
  type BenchmarkRunPlan,
  type BenchmarkRunStatus,
  type BenchmarkTaskDetail,
  type BenchmarkTaskIndexRow,
} from "@src/api/tauri/benchmark";

export const DEFAULT_SWE_BENCH_PRO_SOURCE =
  "/Users/laptop-h/Documents/GitHub/SWE-bench_Pro-os/helper_code/sweap_eval_full_v2.jsonl";
export const DEFAULT_SWE_BENCH_TARGET_REPO_PATH = "";

export const BENCHMARK_TASK_LIST_LIMIT = 250;

export const benchmarkKindAtom = atom(BENCHMARK_KIND.SWE_BENCH_PRO);
export const benchmarkSourcePathAtom = atom(DEFAULT_SWE_BENCH_PRO_SOURCE);
export const benchmarkEvaluationModeAtom = atom<BenchmarkEvaluationMode>(
  BENCHMARK_EVALUATION_MODE.LOCAL_DOCKER
);
export const benchmarkTargetRepoPathAtom = atom(
  DEFAULT_SWE_BENCH_TARGET_REPO_PATH
);
export const benchmarkTasksAtom = atom<BenchmarkTaskIndexRow[]>([]);
export const benchmarkSelectedTaskIdAtom = atom<string | null>(null);
export const benchmarkSelectedTaskAtom = atom<BenchmarkTaskDetail | null>(null);
export const benchmarkTasksLoadingAtom = atom(false);
export const benchmarkTaskDetailLoadingAtom = atom(false);
export const benchmarkErrorAtom = atom<string | null>(null);
export const benchmarkExpandedReposAtom = atom<Record<string, boolean>>({});
export const benchmarkPatchTextAtom = atom("");
export const benchmarkRunPlanAtom = atom<BenchmarkRunPlan | null>(null);
export const benchmarkRunStatusAtom = atom<BenchmarkRunStatus | null>(null);
export const benchmarkPreflightAtom = atom<BenchmarkPreflightResult | null>(
  null
);
export const benchmarkRunLoadingAtom = atom(false);
export const benchmarkRunErrorAtom = atom<string | null>(null);
