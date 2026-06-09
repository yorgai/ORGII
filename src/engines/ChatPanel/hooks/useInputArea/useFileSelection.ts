/**
 * useFileSelection
 *
 * Handles file and context selection for the InputArea
 */
import { useAtom } from "jotai";
import { type MutableRefObject, type RefObject, useCallback } from "react";

import type { ComposerInputRef } from "@src/components/ComposerInput";
import { contextItemsAtom } from "@src/store/session";

import type { FileSelectionHandlers } from "./types";

interface UseFileSelectionOptions {
  composerInputRef: RefObject<ComposerInputRef | null>;
  hasContentRef: MutableRefObject<boolean>;
}

interface UseFileSelectionReturn extends FileSelectionHandlers {
  contextItemsAtChat: string[];
  setContextItemsAtChat: (items: string[]) => void;
}

export function useFileSelection(
  options: UseFileSelectionOptions
): UseFileSelectionReturn {
  const { composerInputRef, hasContentRef } = options;

  const [contextItemsAtChat, setContextItemsAtChat] = useAtom(contextItemsAtom);

  const handleSelectFile = useCallback(
    (file: string) => {
      if (!composerInputRef.current) {
        console.warn("composerInputRef.current is null");
        return;
      }

      const fileName = file.split("/").pop() || file;
      const isFolder = !fileName.includes(".");
      composerInputRef.current.insertFilePill(file, isFolder);
      hasContentRef.current = true;
    },
    [composerInputRef, hasContentRef]
  );

  return {
    handleSelectFile,
    contextItemsAtChat,
    setContextItemsAtChat,
  };
}
