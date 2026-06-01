/**
 * Git Dialogs
 *
 * Collection of imperative dialogs for git operations.
 * All dialogs use native Tauri system dialogs for consistency.
 *
 * @example
 * ```tsx
 * import {
 *   PullConflictDialog,
 *   PushRejectedDialog,
 *   DetachedHeadDialog,
 *   ProtectedBranchDialog,
 *   LargePushConfirmDialog,
 *   RebaseConflictDialog,
 *   RemoteBranchDeletedDialog,
 * } from "@src/components/GitDialogs";
 *
 * // All dialogs use the same imperative API pattern:
 * const result = await PushRejectedDialog.open({
 *   branchName: "main",
 *   behindCount: 3,
 * });
 * ```
 */

// ============================================
// Dialog Exports
// ============================================

export {
  PullConflictDialog,
  type PullConflictOptions,
  type PullConflictResult,
} from "./PullConflictDialog";

export {
  PushRejectedDialog,
  type PushRejectedOptions,
  type PushRejectedResult,
} from "./PushRejectedDialog";

export {
  DetachedHeadDialog,
  type DetachedHeadOptions,
  type DetachedHeadResult,
} from "./DetachedHeadDialog";

export {
  ProtectedBranchDialog,
  type ProtectedBranchOptions,
  type ProtectedBranchResult,
} from "./ProtectedBranchDialog";

export {
  LargePushConfirmDialog,
  LARGE_PUSH_THRESHOLD,
  type LargePushOptions,
  type LargePushResult,
} from "./LargePushConfirmDialog";

export {
  RebaseConflictDialog,
  type RebaseConflictOptions,
  type RebaseConflictResult,
} from "./RebaseConflictDialog";

export {
  RemoteBranchDeletedDialog,
  type RemoteBranchDeletedOptions,
  type RemoteBranchDeletedResult,
} from "./RemoteBranchDeletedDialog";

export {
  CheckoutConflictDialog,
  type CheckoutConflictOptions,
  type CheckoutConflictResult,
} from "./CheckoutConflictDialog";
