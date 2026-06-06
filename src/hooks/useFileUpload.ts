/**
 * useFileUpload Hook
 *
 * Handles non-image file attachments for the SessionCreator surface:
 *   - Click-to-upload (file picker): non-image selections are stored as
 *     `uploadedFiles` pills; image selections are forwarded to
 *     `useImageAttachment.handleImagePaste` so they land in
 *     `chatImageAttachmentsAtom` (rendered as thumbnails by `EditorArea`).
 *   - Drag-drop (from OS / file tree, via `droppedFilesAtom`): same split —
 *     images go to `useImageAttachment.handleImagePath` (Tauri-path aware),
 *     non-images are inserted as ComposerInput pills.
 *
 * All image state lives in `chatImageAttachmentsAtom`. Non-image state lives
 * in local `uploadedFiles` because it's tied to the SessionCreator draft
 * cache and launch payload.
 */
import { useAtomValue, useSetAtom } from "jotai";
import {
  type ChangeEvent,
  type RefObject,
  useCallback,
  useEffect,
  useState,
} from "react";

import type { ComposerInputRef } from "@src/components/ComposerInput";
import { isImageName } from "@src/engines/ChatPanel/hooks/useInputArea/imageExtensions";
import { useImageAttachment } from "@src/engines/ChatPanel/hooks/useInputArea/useImageAttachment";
import type { UploadedFile } from "@src/features/SessionCreator/types";
import {
  clearDroppedFilesAtom,
  droppedFilesAtom,
} from "@src/store/ui/dragDropAtom";

export interface UseFileUploadOptions {
  fileInputRef: RefObject<HTMLInputElement>;
  composerInputRef: RefObject<ComposerInputRef>;
  /**
   * Whether this hook should consume global drag-drop payloads.
   *
   * SessionCreator relies on this hook for dropped files. The ChatPanel input
   * already consumes drops in useInputAreaEffects, so its upload helper disables
   * this to avoid adding the same dropped image twice.
   */
  consumeDroppedFiles?: boolean;
  imageOwnerId?: string;
}

export function useFileUpload(options: UseFileUploadOptions) {
  const {
    fileInputRef,
    composerInputRef,
    consumeDroppedFiles = true,
    imageOwnerId,
  } = options;

  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);

  const droppedFiles = useAtomValue(droppedFilesAtom);
  const clearDroppedFiles = useSetAtom(clearDroppedFilesAtom);

  const { handleImagePaste, handleImagePath } =
    useImageAttachment(imageOwnerId);

  /**
   * Handle file picker selection: images → unified image atom, everything
   * else → `uploadedFiles` (non-image pills) + ComposerInput insertion.
   */
  const handleFileUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      const fileArray = Array.from(files);

      const imageFiles = fileArray.filter((file) =>
        file.type.startsWith("image/")
      );
      const otherFiles = fileArray.filter(
        (file) => !file.type.startsWith("image/")
      );

      if (imageFiles.length > 0) {
        await handleImagePaste(imageFiles);
      }

      if (otherFiles.length > 0 && composerInputRef.current) {
        otherFiles.forEach((file) => {
          composerInputRef.current?.insertFilePill(file.name, false, "file");
        });
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [fileInputRef, composerInputRef, handleImagePaste]
  );

  const handleRemoveFile = useCallback((fileId: string) => {
    setUploadedFiles((prev) => prev.filter((file) => file.id !== fileId));
  }, []);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, [fileInputRef]);

  /**
   * Consume `droppedFilesAtom` — images to the unified atom, non-images as
   * ComposerInput pills.  We no longer populate the local `uploadedFiles` from drag
   * drops; that surface is for explicit file-picker selections that outlive
   * a message edit cycle (which drag-drop inputs don't need).
   */
  useEffect(() => {
    if (!consumeDroppedFiles || droppedFiles.length === 0) return;

    const imageFiles = droppedFiles.filter(
      (file) =>
        file.type !== "folder" &&
        (file.browserFile?.type.startsWith("image/") || isImageName(file.name))
    );
    const otherFiles = droppedFiles.filter(
      (file) => file.type === "folder" || !imageFiles.includes(file)
    );

    const browserImageFiles = imageFiles
      .map((file) => file.browserFile)
      .filter((file): file is File => Boolean(file));
    const pathImageFiles = imageFiles.filter((file) => !file.browserFile);

    if (browserImageFiles.length > 0) {
      void handleImagePaste(browserImageFiles);
    }

    if (pathImageFiles.length > 0) {
      void Promise.all(
        pathImageFiles.map((file) => handleImagePath(file.path, file.name))
      );
    }

    if (otherFiles.length > 0) {
      const insertPills = () => {
        if (composerInputRef.current) {
          otherFiles.forEach((file) => {
            const isFolder = file.type === "folder";
            composerInputRef.current?.insertFilePill(
              file.path,
              isFolder,
              isFolder ? "folder" : "file"
            );
          });
        } else {
          setTimeout(insertPills, 100);
        }
      };
      insertPills();
    }

    clearDroppedFiles();
  }, [
    consumeDroppedFiles,
    droppedFiles,
    clearDroppedFiles,
    composerInputRef,
    handleImagePath,
    handleImagePaste,
  ]);

  return {
    uploadedFiles,
    setUploadedFiles,
    handleFileUpload,
    handleRemoveFile,
    handleUploadClick,
  };
}
