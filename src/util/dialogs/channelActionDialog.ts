import { createLogger } from "@src/hooks/logger";

const log = createLogger("ChannelActionDialog");

export type ChannelActionDialogKind = "info" | "warning" | "error";

export async function showChannelActionDialog(
  dialogMessage: string,
  kind: ChannelActionDialogKind = "info"
): Promise<void> {
  const { message } = await import("@tauri-apps/plugin-dialog");
  await message(dialogMessage, {
    title: "Channel",
    kind,
    buttons: { ok: "OK" },
  });
}

export function showChannelActionDialogSafely(
  dialogMessage: string,
  kind: ChannelActionDialogKind = "info"
): void {
  void showChannelActionDialog(dialogMessage, kind).catch((error) => {
    log.error("[ChannelActionDialog] Failed to show dialog:", error);
  });
}
