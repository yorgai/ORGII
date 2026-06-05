/**
 * useImageAttachment
 *
 * Single entry point for adding images to the chat input area, regardless of
 * source (paste, drag-drop from OS / file tree, image file picker).  All paths
 * converge on `optimizeImage()` and `chatImageAttachmentsAtom`, so the preview
 * strip (`ImageAttachmentPreview`) renders uniformly.
 *
 *  - `handleImagePaste(files)`    — browser `File[]` (paste event, input element)
 *  - `handleImagePath(path, name?)` — absolute filesystem path (Tauri drag-drop)
 */
import { readFile } from "@tauri-apps/plugin-fs";
import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";

import Message from "@src/components/Message";
import {
  type ChatImageAttachment,
  MAX_CHAT_IMAGES,
  chatImageAttachmentsAtom,
} from "@src/store/ui/chatImageAtom";
import { optimizeImage } from "@src/util/optimization/imageOptimizer";

/** Accepted image MIME types */
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

/** Map file extension → MIME type for Tauri-dropped paths (no File.type). */
const EXTENSION_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function mimeFromPath(path: string): string | undefined {
  const match = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) return undefined;
  return EXTENSION_MIME[match[1]];
}

export function useImageAttachment(ownerId?: string) {
  const [images, setImages] = useAtom(chatImageAttachmentsAtom);

  const ownerImages = useMemo(
    () =>
      ownerId ? images.filter((image) => image.ownerId === ownerId) : images,
    [images, ownerId]
  );

  // Keep a ref in sync with the current image count so ingestFiles can read
  // the latest value without being recreated on every images.length change.
  const imagesLengthRef = useRef(ownerImages.length);
  useEffect(() => {
    imagesLengthRef.current = ownerImages.length;
  }, [ownerImages.length]);

  /**
   * Shared tail: run each File through `optimizeImage` and push the results
   * into `chatImageAttachmentsAtom`.  Enforces the per-chat image cap (and
   * warns the user if the incoming batch would exceed it).
   */
  const ingestFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const remaining = MAX_CHAT_IMAGES - imagesLengthRef.current;
      if (remaining <= 0) {
        Message.warning(`Maximum ${MAX_CHAT_IMAGES} images allowed`);
        return;
      }

      const filesToProcess = files.slice(0, remaining);
      if (files.length > remaining) {
        Message.warning(
          `Only ${remaining} more image(s) can be added (max ${MAX_CHAT_IMAGES})`
        );
      }

      const newAttachments: ChatImageAttachment[] = [];

      for (const file of filesToProcess) {
        try {
          const result = await optimizeImage(file, {
            maxWidth: 1920,
            maxHeight: 1080,
            quality: 0.85,
            maxFileSizeBytes: 500 * 1024,
          });

          newAttachments.push({
            id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            dataUrl: result.dataUrl,
            fileName: file.name || "pasted-image.png",
            size: result.optimizedSize,
            width: result.finalDimensions.width,
            height: result.finalDimensions.height,
            ownerId,
          });
        } catch (error) {
          console.error("[ImageAttachment] Failed to optimize image:", error);
          Message.error("Failed to process image");
        }
      }

      if (newAttachments.length > 0) {
        setImages((prev) => [...prev, ...newAttachments]);
      }
    },
    [setImages, ownerId]
  );

  const handleImagePaste = useCallback(
    async (files: File[]) => {
      const validFiles = files.filter((file) =>
        ACCEPTED_IMAGE_TYPES.has(file.type)
      );
      await ingestFiles(validFiles);
    },
    [ingestFiles]
  );

  /**
   * Add an image by absolute filesystem path.  Used by the Tauri drag-drop
   * path, where we only have a path string (no browser `File`).  Reads bytes
   * via the fs plugin (home-scoped capability) and wraps them in a `File` so
   * the same optimize pipeline runs.
   */
  const handleImagePath = useCallback(
    async (path: string, fileName?: string) => {
      const mime = mimeFromPath(path);
      if (!mime || !ACCEPTED_IMAGE_TYPES.has(mime)) {
        // Silently ignore unsupported image types (e.g. .svg) — matches the
        // paste path, which also filters by ACCEPTED_IMAGE_TYPES.
        return;
      }

      try {
        const bytes = await readFile(path);
        const name = fileName || basename(path);
        const file = new File([bytes as BlobPart], name, { type: mime });
        await ingestFiles([file]);
      } catch (error) {
        console.error(
          "[ImageAttachment] Failed to read image from path:",
          path,
          error
        );
        Message.error(`Failed to load image: ${basename(path)}`);
      }
    },
    [ingestFiles]
  );

  const clearImages = useCallback(() => {
    setImages([]);
  }, [setImages]);

  const removeImage = useCallback(
    (id: string) => {
      setImages((prev) => prev.filter((img) => img.id !== id));
    },
    [setImages]
  );

  /**
   * Restore a previously-captured list of attachments. Used by the
   * composer's submit path to roll back the optimistic clear when the
   * outgoing request fails — without this, the user's images would be
   * silently destroyed on send failure (P1 data loss).
   *
   * The image cap is intentionally NOT re-enforced on restore: the
   * snapshot was already accepted under the cap, and clamping it now
   * would silently drop user content on the failure path.
   */
  const restoreImages = useCallback(
    (snapshot: ChatImageAttachment[]) => {
      setImages(snapshot);
    },
    [setImages]
  );

  return {
    images: ownerImages,
    handleImagePaste,
    handleImagePath,
    clearImages,
    removeImage,
    restoreImages,
    hasImages: ownerImages.length > 0,
  };
}
