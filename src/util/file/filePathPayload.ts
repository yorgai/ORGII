export const FILE_PATH_PAYLOAD_KEYS = [
  "file_path",
  "filePath",
  "path",
  "target_file",
  "targetFile",
] as const;

export const FILE_NAME_PAYLOAD_KEYS = ["file_name", "fileName"] as const;

export type PayloadRecord = Record<string, unknown> | null | undefined;

export function readPayloadString(
  payload: PayloadRecord,
  keys: readonly string[]
): string | undefined {
  if (!payload) return undefined;

  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
  }

  return undefined;
}

export function extractFilePathFromPayloads(
  payloads: readonly PayloadRecord[],
  fallbackKeys: readonly string[] = []
): string {
  for (const payload of payloads) {
    const path = readPayloadString(payload, FILE_PATH_PAYLOAD_KEYS);
    if (path) return path;
  }

  for (const payload of payloads) {
    const fallback = readPayloadString(payload, fallbackKeys);
    if (fallback) return fallback;
  }

  return "";
}
