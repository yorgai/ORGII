import { createLogger } from "@src/hooks/logger";

const log = createLogger("GitActionDialog");

export type GitActionDialogKind = "info" | "warning" | "error";

const TRANSPORT_ERROR_MESSAGES = new Set([
  "load failed",
  "failed to fetch",
  "networkerror when attempting to fetch resource.",
]);

export function normalizeGitActionDialogMessage(dialogMessage: string): string {
  const normalizedMessage = dialogMessage.trim().toLowerCase();
  if (TRANSPORT_ERROR_MESSAGES.has(normalizedMessage)) {
    return "Unable to reach the local Git service. Please try again after the app finishes starting, or restart ORGII if this keeps happening.";
  }
  return dialogMessage;
}

export async function showGitActionDialog(
  dialogMessage: string,
  kind: GitActionDialogKind = "info"
): Promise<void> {
  const { message } = await import("@tauri-apps/plugin-dialog");
  await message(normalizeGitActionDialogMessage(dialogMessage), {
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
    log.error("[GitActionDialog] Failed to show dialog:", error);
  });
}
