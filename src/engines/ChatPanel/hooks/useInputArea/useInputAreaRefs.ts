/**
 * useInputAreaRefs
 *
 * Manages all refs for the InputArea component
 */
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useRef,
} from "react";

import type { ComposerInputRef as TiptapInputRef } from "@src/components/ComposerInput";

import type { InputAreaRefs } from "./types";

export function useInputAreaRefs(): InputAreaRefs {
  const tiptapRef = useRef<TiptapInputRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const atDropdownRef = useRef<HTMLDivElement>(null);
  const hasContentRef = useRef(false);
  const contextMenuKeyboardHandlerRef = useRef<
    ((event: ReactKeyboardEvent) => boolean) | null
  >(null);
  const slashCommandKeyboardHandlerRef = useRef<
    ((event: globalThis.KeyboardEvent) => boolean) | null
  >(null);
  const plusSlashCommandKeyboardHandlerRef = useRef<
    ((event: globalThis.KeyboardEvent) => boolean) | null
  >(null);

  // Setter function to update hasContentRef (avoids React Compiler immutability issues)
  const setHasContent = useCallback((value: boolean) => {
    hasContentRef.current = value;
  }, []);

  return {
    tiptapRef,
    containerRef,
    atDropdownRef,
    contextMenuKeyboardHandlerRef,
    slashCommandKeyboardHandlerRef,
    plusSlashCommandKeyboardHandlerRef,
    hasContentRef,
    setHasContent,
  };
}
