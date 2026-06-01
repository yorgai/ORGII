/**
 * Git Branch Operations API
 *
 * Branch creation, deletion, and checkout functions.
 */
import { fetchRustApi, gitRepoUrl } from "./client";

/**
 * Create a new branch
 * Uses Rust HTTP server
 */
export const gitCreateBranch = async (params: {
  repo_id: string;
  repo_path?: string;
  name: string;
  start_point?: string | null;
  checkout?: boolean;
}): Promise<boolean> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    await fetchRustApi<void>(
      `${gitRepoUrl(params.repo_id)}/branch${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({
          name: params.name,
          start_point: params.start_point ?? null,
          checkout: params.checkout ?? true,
        }),
      }
    );
    return true;
  } catch (error) {
    console.error("[GitAPI] Failed to create branch:", error);
    return false;
  }
};

/**
 * Delete a branch
 * Uses Rust HTTP server
 */
export const gitDeleteBranch = async (params: {
  repo_id: string;
  repo_path?: string;
  branch_name: string;
  force?: boolean;
}): Promise<boolean> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    await fetchRustApi<void>(
      `${gitRepoUrl(params.repo_id)}/branch/${encodeURIComponent(params.branch_name)}${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      { method: "DELETE" }
    );
    return true;
  } catch (error) {
    console.error("[GitAPI] Failed to delete branch:", error);
    return false;
  }
};

/**
 * Types of checkout errors that can be handled specially
 */
export type CheckoutErrorType =
  | "uncommitted_changes" // Can be resolved with stash or force
  | "branch_not_found" // Branch doesn't exist
  | "merge_in_progress" // Need to complete/abort merge first
  | "rebase_in_progress" // Need to complete/abort rebase first
  | "other"; // Generic error

/**
 * Checkout result with success status and optional error message
 */
export interface GitCheckoutResult {
  success: boolean;
  error?: string;
  errorType?: CheckoutErrorType;
}

/**
 * Parse Git checkout error to user-friendly message and error type
 */
function parseCheckoutError(errorMessage: string): {
  message: string;
  type: CheckoutErrorType;
} {
  const msg = errorMessage.toLowerCase();

  // Uncommitted changes - can be resolved with stash or force
  if (
    msg.includes("your local changes") ||
    msg.includes("would be overwritten") ||
    msg.includes("uncommitted changes")
  ) {
    return {
      message:
        "You have uncommitted changes. Please commit or stash them first.",
      type: "uncommitted_changes",
    };
  }

  // Untracked files would be overwritten - also resolvable with force
  if (msg.includes("untracked") && msg.includes("overwritten")) {
    return {
      message:
        "Untracked files would be overwritten. Please move or remove them first.",
      type: "uncommitted_changes",
    };
  }

  // Branch doesn't exist
  if (
    msg.includes("did not match any") ||
    msg.includes("pathspec") ||
    msg.includes("not a valid ref")
  ) {
    return {
      message: "Branch not found. It may have been deleted or not yet fetched.",
      type: "branch_not_found",
    };
  }

  // Merge in progress
  if (msg.includes("merge") && msg.includes("in progress")) {
    return {
      message: "A merge is in progress. Please complete or abort it first.",
      type: "merge_in_progress",
    };
  }

  // Rebase in progress
  if (msg.includes("rebase") && msg.includes("in progress")) {
    return {
      message: "A rebase is in progress. Please complete or abort it first.",
      type: "rebase_in_progress",
    };
  }

  // Cherry-pick in progress
  if (msg.includes("cherry-pick")) {
    return {
      message:
        "A cherry-pick is in progress. Please complete or abort it first.",
      type: "other",
    };
  }

  // Default: return original message (first line only, cleaned up)
  const firstLine = errorMessage.split("\n")[0].trim();
  return {
    message: firstLine || "Failed to checkout branch",
    type: "other",
  };
}

/**
 * Rename a branch
 * Uses Rust HTTP server
 *
 * @param old_name - The branch to rename (if not provided, renames current branch)
 * @param new_name - The new name for the branch
 * @param force - If true, force rename even if new_name already exists
 */
export const gitRenameBranch = async (params: {
  repo_id: string;
  repo_path?: string;
  old_name?: string;
  new_name: string;
  force?: boolean;
}): Promise<{ success: boolean; error?: string }> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    await fetchRustApi<void>(
      `${gitRepoUrl(params.repo_id)}/branch/rename${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({
          old_name: params.old_name ?? null,
          new_name: params.new_name,
          force: params.force ?? false,
        }),
      }
    );
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[GitAPI] Failed to rename branch:", errorMessage);
    return { success: false, error: errorMessage };
  }
};

/**
 * Checkout a branch or ref
 * Uses Rust HTTP server
 * Returns detailed error message on failure
 */
export const gitCheckout = async (params: {
  repo_id: string;
  repo_path?: string;
  ref: string;
  create?: boolean;
  force?: boolean;
}): Promise<GitCheckoutResult> => {
  const queryParams = new URLSearchParams();
  if (params.repo_path) queryParams.append("path", params.repo_path);

  try {
    await fetchRustApi<void>(
      `${gitRepoUrl(params.repo_id)}/checkout${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({
          ref_name: params.ref,
          force: params.force ?? false,
        }),
      }
    );
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[GitAPI] Failed to checkout:", errorMessage);
    const parsed = parseCheckoutError(errorMessage);
    return {
      success: false,
      error: parsed.message,
      errorType: parsed.type,
    };
  }
};
