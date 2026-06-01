/**
 * Shared image-extension classifier used by every chat-input image entry point
 * (paste, file-picker, drag-drop) so they agree on what counts as an image.
 *
 * Kept next to `useImageAttachment` since that hook is the canonical consumer.
 * Intentionally a small data-only module — no React deps — so other hooks
 * (e.g. `useFileUpload` on the SessionCreator surface) can import it too.
 */

export const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
] as const;

/**
 * Return true if `name` ends with one of the recognized image extensions.
 * Case-insensitive.
 */
export function isImageName(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
