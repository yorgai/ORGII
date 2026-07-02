import type { CheckoutErrorType } from "@src/api/http/git/branchOps";

export interface CheckoutBlockedOptions {
  branchName: string;
  errorType: Exclude<CheckoutErrorType, "uncommitted_changes"> | "none";
  message?: string;
}

function checkoutBlockedTitle(
  errorType: CheckoutBlockedOptions["errorType"]
): string {
  switch (errorType) {
    case "worktree_branch_in_use":
      return "Branch Already Open in Another Worktree";
    case "merge_in_progress":
      return "Finish the Merge First";
    case "rebase_in_progress":
      return "Finish the Rebase First";
    case "cherry_pick_in_progress":
      return "Finish the Cherry-pick First";
    case "branch_not_found":
      return "Branch Not Found";
    default:
      return "Cannot Switch Branch";
  }
}

function checkoutBlockedMessage(options: CheckoutBlockedOptions): string {
  const message = options.message?.trim();
  switch (options.errorType) {
    case "worktree_branch_in_use":
      return [
        `Cannot switch to "${options.branchName}" because Git says that branch is already checked out in another worktree.`,
        "",
        "Open that worktree from Source Control, or choose a different branch for this workspace.",
        message ? `Git said: ${message}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    case "merge_in_progress":
      return [
        `Cannot switch to "${options.branchName}" while a merge is in progress.`,
        "",
        "Resolve the merge, then continue or abort it before switching branches.",
        message ? `Git said: ${message}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    case "rebase_in_progress":
      return [
        `Cannot switch to "${options.branchName}" while a rebase is in progress.`,
        "",
        "Continue or abort the rebase before switching branches.",
        message ? `Git said: ${message}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    case "cherry_pick_in_progress":
      return [
        `Cannot switch to "${options.branchName}" while a cherry-pick is in progress.`,
        "",
        "Continue or abort the cherry-pick before switching branches.",
        message ? `Git said: ${message}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    case "branch_not_found":
      return (
        message ||
        `Branch "${options.branchName}" was not found. Fetch remote branches, then try again.`
      );
    default:
      return message || `Cannot switch to "${options.branchName}".`;
  }
}

class CheckoutBlockedDialogManager {
  public async open(options: CheckoutBlockedOptions): Promise<void> {
    const { message } = await import("@tauri-apps/plugin-dialog");
    await message(checkoutBlockedMessage(options), {
      title: checkoutBlockedTitle(options.errorType),
      kind: "warning",
      buttons: { ok: "OK" },
    });
  }
}

export const CheckoutBlockedDialog = new CheckoutBlockedDialogManager();
export default CheckoutBlockedDialog;
