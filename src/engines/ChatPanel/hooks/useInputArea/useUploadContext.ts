/**
 * useUploadContext
 *
 * File upload for the ChatPanel InputArea — uses the same shared
 * `useFileUpload` hook as SessionCreator: a hidden native <input type="file">
 * triggered by `handleUploadClick`. No modal, no intermediate picker.
 */
import { type ChangeEvent, type RefObject, useRef } from "react";

import type { ComposerInputRef } from "@src/components/ComposerInput";
import { useFileUpload } from "@src/hooks/useFileUpload";

export interface UseUploadContextReturn {
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleUploadClick: () => void;
  handleFileUpload: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
}

interface UseUploadContextOptions {
  composerInputRef: RefObject<ComposerInputRef | null>;
  imageOwnerId?: string;
}

export function useUploadContext(
  options: UseUploadContextOptions
): UseUploadContextReturn {
  const { composerInputRef, imageOwnerId } = options;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { handleUploadClick, handleFileUpload } = useFileUpload({
    fileInputRef,
    composerInputRef,
    consumeDroppedFiles: false,
    imageOwnerId,
  });

  return {
    fileInputRef,
    handleUploadClick,
    handleFileUpload,
  };
}
