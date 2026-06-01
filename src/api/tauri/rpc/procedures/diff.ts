import { defineProcedure } from "../invoke";
import * as schemas from "../schemas";
import { snakeToCamel } from "../transforms";

export const diff = {
  computeDiff: defineProcedure("compute_diff")
    .input(schemas.diff.ComputeDiffInput)
    .output(schemas.diff.DiffResultSchema)
    .transform(snakeToCamel)
    .build(),

  applyPatch: defineProcedure("apply_patch")
    .input(schemas.diff.ApplyPatchInput)
    .output(schemas.diff.PatchResultSchema)
    .transform(snakeToCamel)
    .build(),

  applyFuzzyPatch: defineProcedure("apply_fuzzy_patch")
    .input(schemas.diff.ApplyFuzzyPatchInput)
    .output(schemas.diff.FuzzyPatchResultSchema)
    .transform(snakeToCamel)
    .build(),

  mergeThreeWay: defineProcedure("merge_three_way")
    .input(schemas.diff.MergeThreeWayInput)
    .output(schemas.diff.MergeResultSchema)
    .transform(snakeToCamel)
    .build(),
} as const;
