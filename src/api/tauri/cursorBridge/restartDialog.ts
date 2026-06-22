import Message from "@src/components/Message";
import i18n from "@src/i18n";
import { askNativeDialogSafely } from "@src/util/dialogs/nativeDialog";

import { cursorBridgeRestartRealCursorWithDebugPort } from ".";

const CURSOR_RUNNING_WITHOUT_DEBUG_PORT =
  "Cursor is already running without --remote-debugging-port=";

export function isCursorRunningWithoutDebugPortError(error: unknown): boolean {
  return getErrorMessage(error).includes(CURSOR_RUNNING_WITHOUT_DEBUG_PORT);
}

export async function promptRestartCursorWithDebugPort(
  error: unknown
): Promise<boolean> {
  if (!isCursorRunningWithoutDebugPortError(error)) return false;

  const confirmed = await askRestartCursor();
  if (!confirmed) return false;

  try {
    await cursorBridgeRestartRealCursorWithDebugPort();
    Message.success(i18n.t("sessions:cursorIde.restart.success"));
    return true;
  } catch (restartError) {
    Message.error(
      i18n.t("sessions:cursorIde.restart.failed", {
        reason: getErrorMessage(restartError),
      })
    );
    return false;
  }
}

async function askRestartCursor(): Promise<boolean> {
  const title = i18n.t("sessions:cursorIde.restart.title");
  const message = i18n.t("sessions:cursorIde.restart.message");

  try {
    return await askNativeDialogSafely(message, {
      title,
      kind: "warning",
      okLabel: i18n.t("sessions:cursorIde.restart.okLabel"),
      cancelLabel: i18n.t("common:actions.cancel"),
    });
  } catch {
    return window.confirm(`${title}\n\n${message}`);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "An unexpected error occurred";
}
