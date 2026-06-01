/**
 * useFileSelection
 *
 * Handles file and context selection for the InputArea
 */
import { useAtom } from "jotai";
import { type MutableRefObject, type RefObject, useCallback } from "react";

import type { ComposerInputRef as TiptapInputRef } from "@src/components/ComposerInput";
import { contextItemsAtom } from "@src/store/session";

import type { FileSelectionHandlers } from "./types";

interface UseFileSelectionOptions {
  tiptapRef: RefObject<TiptapInputRef>;
  hasContentRef: MutableRefObject<boolean>;
}

interface UseFileSelectionReturn extends FileSelectionHandlers {
  contextItemsAtChat: string[];
  setContextItemsAtChat: (items: string[]) => void;
}

export function useFileSelection(
  options: UseFileSelectionOptions
): UseFileSelectionReturn {
  const { tiptapRef, hasContentRef } = options;

  const [contextItemsAtChat, setContextItemsAtChat] = useAtom(contextItemsAtom);

  const handleSelectFile = useCallback(
    (file: string) => {
      if (!tiptapRef.current) {
        console.warn("tiptapRef.current is null");
        return;
      }

      const fileName = file.split("/").pop() || file;
      const isFolder = !fileName.includes(".");
      tiptapRef.current.insertFilePill(file, isFolder);
      hasContentRef.current = true;
    },
    [tiptapRef, hasContentRef]
  );

  return {
    handleSelectFile,
    contextItemsAtChat,
    setContextItemsAtChat,
  };
}
