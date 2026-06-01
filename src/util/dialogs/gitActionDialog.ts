export type GitActionDialogKind = "info" | "warning" | "error";

export async function showGitActionDialog(
  dialogMessage: string,
  kind: GitActionDialogKind = "info"
): Promise<void> {
  const { message } = await import("@tauri-apps/plugin-dialog");
  await message(dialogMessage, {
    title: "Git",
    kind,
    buttons: { ok: "OK" },
  });
}

export function showGitActionDialogSafely(
  dialogMessage: string,
  kind: GitActionDialogKind = "info"
): void {
  void showGitActionDialog(dialogMessage, kind).catch((error) => {
    console.error("[GitActionDialog] Failed to show dialog:", error);
  });
}
