import {
  gitCheckout,
  gitCreateBranchFromCommit,
  gitMergeAbort,
  gitRebaseAbort,
} from "./gitBranchActions.zod";
import {
  gitAmend,
  gitCherryPickCommit,
  gitResetToRef,
  gitResolveConflict,
  gitRevertCommit,
} from "./gitHistoryActions.zod";
import {
  gitFetch,
  gitPublish,
  gitPull,
  gitPush,
  gitSync,
} from "./gitRemoteActions.zod";
import {
  gitCommit,
  gitDiscard,
  gitDiscardAll,
  gitStage,
  gitUnstage,
} from "./gitStagingActions.zod";
import {
  gitStash,
  gitStashApply,
  gitStashDrop,
  gitStashPop,
} from "./gitStashActions.zod";
import { gitDiff, gitStatus } from "./gitStatusActions.zod";

/**
 * Git Actions - barrel re-export
 *
 * All git actions split by domain:
 * - Status & Diff
 * - Staging & Commit & Discard
 * - Remote (Push/Pull/Fetch/Sync/Publish)
 * - Branch (Checkout/Create/Merge Abort/Rebase Abort)
 * - Stash
 * - History (Amend/Cherry-pick/Revert/Reset/Conflict Resolution)
 */
export {
  formatDiffSummaryForLLM,
  formatStatusForLLM,
  gitDiff,
  gitStatus,
} from "./gitStatusActions.zod";

export {
  gitCommit,
  gitDiscard,
  gitDiscardAll,
  gitStage,
  gitUnstage,
} from "./gitStagingActions.zod";

export {
  gitFetch,
  gitPublish,
  gitPull,
  gitPush,
  gitSync,
} from "./gitRemoteActions.zod";

export {
  gitCheckout,
  gitCreateBranchFromCommit,
  gitMergeAbort,
  gitRebaseAbort,
} from "./gitBranchActions.zod";

export {
  gitStash,
  gitStashApply,
  gitStashDrop,
  gitStashPop,
} from "./gitStashActions.zod";

export {
  gitAmend,
  gitCherryPickCommit,
  gitResolveConflict,
  gitResetToRef,
  gitRevertCommit,
} from "./gitHistoryActions.zod";

export const gitZodActions = [
  gitStatus,
  gitDiff,
  gitStage,
  gitUnstage,
  gitCommit,
  gitPush,
  gitPull,
  gitFetch,
  gitSync,
  gitPublish,
  gitCheckout,
  gitDiscard,
  gitDiscardAll,
  gitStash,
  gitStashPop,
  gitStashApply,
  gitStashDrop,
  gitMergeAbort,
  gitRebaseAbort,
  gitAmend,
  gitCherryPickCommit,
  gitRevertCommit,
  gitResetToRef,
  gitCreateBranchFromCommit,
  gitResolveConflict,
];
