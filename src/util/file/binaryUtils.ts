/**
 * Binary File Utilities
 *
 * Shared helpers for working with binary file data in the preview system.
 */

/**
 * Convert a Uint8Array to a base64 data URL.
 *
 * Used by ImagePreview and ImageDiffView to turn raw file bytes into
 * an src string that the browser can display.
 */
export function uint8ArrayToDataUrl(
  data: Uint8Array,
  mimeType: string
): string {
  let binary = "";
  const len = data.byteLength;
  for (let idx = 0; idx < len; idx++) {
    binary += String.fromCharCode(data[idx]);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}
