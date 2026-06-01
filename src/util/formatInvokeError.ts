/**
 * Best-effort message extraction for Tauri `invoke` and other unknown rejects.
 * Tauri often rejects with a non-Error payload, so `instanceof Error` loses the real message.
 */
export function formatInvokeError(error: unknown): string {
  if (error instanceof Error) {
    const text = error.message.trim();
    return text !== "" ? text : error.name;
  }
  if (typeof error === "string") {
    return error.trim();
  }
  if (error !== null && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = record.message;
    if (typeof message === "string" && message.trim() !== "") {
      return message.trim();
    }
    const nestedError = record.error;
    if (typeof nestedError === "string" && nestedError.trim() !== "") {
      return nestedError.trim();
    }
  }
  return "";
}
