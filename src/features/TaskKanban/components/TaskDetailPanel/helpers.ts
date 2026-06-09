import type { TFunction } from "i18next";

import type { SessionMergeParams } from "@src/engines/SessionCore/services/types";

export type MergeStrategy = NonNullable<SessionMergeParams["strategy"]>;

export const MERGE_STRATEGY_OPTIONS: readonly MergeStrategy[] = [
  "auto",
  "ff",
  "leave",
] as const;

export function isMergeSettledStatus(mergeStatus: string | undefined): boolean {
  return mergeStatus === "merged" || mergeStatus === "skipped";
}

export function isMergeRetryStatus(mergeStatus: string | undefined): boolean {
  return mergeStatus === "conflict" || mergeStatus === "failed";
}

export function getMergeStrategyLabel(
  strategy: MergeStrategy,
  t: TFunction<"sessions">
): string {
  switch (strategy) {
    case "auto":
      return t("opsControl.merge.strategyAuto");
    case "ff":
      return t("opsControl.merge.strategyFf");
    case "leave":
      return t("opsControl.merge.strategyLeave");
  }
}

export function getMergeFailureMessage(
  result: { conflicts: string[]; error?: string | null },
  t: TFunction<"sessions">
): string {
  return result.conflicts.length > 0
    ? t("opsControl.merge.conflictsIn", {
        files: result.conflicts.join(", "),
      })
    : (result.error ?? t("opsControl.merge.failed"));
}

export function isDirtyRepoMergeError(message: string): boolean {
  return (
    message.includes("uncommitted changes") ||
    message.includes("working directory") ||
    message.includes("Commit or stash")
  );
}

export function buildDiscardConfirmationMessage(
  t: TFunction<"sessions">
): string {
  return `${t("opsControl.merge.discardConfirmTitle")}\n\n${t(
    "opsControl.merge.discardConfirmMessage"
  )}`;
}
