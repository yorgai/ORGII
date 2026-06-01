/**
 * Destructive action confirmation dialog.
 *
 * Uses Tauri native dialog when available, falls back to window.confirm().
 * Replaces the duplicated `import("@tauri-apps/plugin-dialog") → ask()` pattern
 * found across 10+ files.
 */

export interface ConfirmDestructiveActionOptions {
  title: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
}

export async function confirmDestructiveAction(
  options: ConfirmDestructiveActionOptions
): Promise<boolean> {
  const {
    title,
    message,
    okLabel = "Discard",
    cancelLabel = "Cancel",
  } = options;

  const e2eAutoConfirm =
    typeof window !== "undefined" &&
    (window as unknown as { __orgiiE2EAutoConfirmDestructive?: boolean })
      .__orgiiE2EAutoConfirmDestructive === true;
  if (e2eAutoConfirm) return true;

  try {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return await ask(message, {
      title,
      kind: "warning",
      okLabel,
      cancelLabel,
    });
  } catch {
    return window.confirm(`${title}\n\n${message}`);
  }
}
