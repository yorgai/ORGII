import React, { useCallback, useEffect, useRef, useState } from "react";

export interface InlineRenameInputProps {
  initialName: string;
  isDirectory: boolean;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
  onValueChange?: (value: string) => void;
}

type SelectionMode = "basename" | "full" | "extension";

function getExtensionIndex(filename: string): number {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return -1;
  return lastDot;
}

function applySelection(
  input: HTMLInputElement,
  filename: string,
  mode: SelectionMode
): void {
  const extensionIndex = getExtensionIndex(filename);

  switch (mode) {
    case "basename":
      if (extensionIndex > 0) {
        input.setSelectionRange(0, extensionIndex);
      } else {
        input.setSelectionRange(0, filename.length);
      }
      break;
    case "full":
      input.setSelectionRange(0, filename.length);
      break;
    case "extension":
      if (extensionIndex > 0) {
        input.setSelectionRange(extensionIndex, filename.length);
      } else {
        input.setSelectionRange(0, filename.length);
      }
      break;
  }
}

function getNextSelectionMode(
  current: SelectionMode,
  hasExtension: boolean
): SelectionMode {
  if (!hasExtension) return "full";

  switch (current) {
    case "basename":
      return "full";
    case "full":
      return "extension";
    case "extension":
      return "basename";
  }
}

export function InlineRenameInput({
  initialName,
  isDirectory,
  onConfirm,
  onCancel,
  onValueChange,
}: InlineRenameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialName);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("basename");
  const hasSubmittedRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    input.focus();
    if (isDirectory) {
      input.setSelectionRange(0, initialName.length);
    } else {
      applySelection(input, initialName, "basename");
    }
  }, [initialName, isDirectory]);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = event.target.value;
      setValue(newValue);
      onValueChange?.(newValue);
    },
    [onValueChange]
  );

  const handleConfirm = useCallback(() => {
    if (hasSubmittedRef.current) return;
    hasSubmittedRef.current = true;

    const trimmedValue = value.trim();
    if (trimmedValue && trimmedValue !== initialName) {
      onConfirm(trimmedValue);
    } else {
      onCancel();
    }
  }, [value, initialName, onConfirm, onCancel]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      switch (event.key) {
        case "Enter":
          event.preventDefault();
          event.stopPropagation();
          handleConfirm();
          break;
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          onCancel();
          break;
        case "F2":
          event.preventDefault();
          event.stopPropagation();
          if (!isDirectory) {
            const input = inputRef.current;
            if (!input) return;

            const hasExtension = getExtensionIndex(value) > 0;
            const nextMode = getNextSelectionMode(selectionMode, hasExtension);
            setSelectionMode(nextMode);
            applySelection(input, value, nextMode);
          }
          break;
      }
    },
    [handleConfirm, onCancel, isDirectory, value, selectionMode]
  );

  const handleBlur = useCallback(() => {
    setTimeout(() => {
      handleConfirm();
    }, 0);
  }, [handleConfirm]);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      className="h-[22px] w-full min-w-0 rounded border border-primary-6 bg-pane-input px-1 text-[13px] text-text-1 outline-none ring-1 ring-primary-6/30"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
    />
  );
}

export default InlineRenameInput;
