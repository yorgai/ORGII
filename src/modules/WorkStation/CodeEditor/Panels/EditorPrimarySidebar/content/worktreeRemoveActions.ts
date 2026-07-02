import { removeGitWorktree } from "@src/api/http/git";
import type { GitWorktreeEntry } from "@src/api/http/git/types";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";
import { showGitActionDialogSafely } from "@src/util/dialogs/gitActionDialog";

export async function confirmAndRemoveWorktree({
  repoId,
  repoPath,
  worktree,
  folderName,
  onRemoved,
  t,
}: {
  repoId: string;
  repoPath: string;
  worktree: GitWorktreeEntry;
  folderName: string;
  onRemoved?: () => Promise<void>;
  t: (key: string, options?: Record<string, unknown>) => string;
}): Promise<boolean> {
  const confirmed = await confirmDestructiveAction({
    title: t("sourceControl.removeWorktreeTitle", { name: folderName }),
    message: t("sourceControl.removeWorktreeMessage"),
    okLabel: t("sourceControl.removeWorktree"),
  });
  if (!confirmed) return false;

  try {
    await removeGitWorktree({
      repo_id: repoId,
      repo_path: repoPath,
      worktree_path: worktree.path,
      force: true,
    });
    await onRemoved?.();
    showGitActionDialogSafely(t("sourceControl.removeWorktreeSuccess"), "info");
    return true;
  } catch (error) {
    showGitActionDialogSafely(
      error instanceof Error
        ? error.message
        : t("sourceControl.removeWorktreeFailed"),
      "error"
    );
    return false;
  }
}
