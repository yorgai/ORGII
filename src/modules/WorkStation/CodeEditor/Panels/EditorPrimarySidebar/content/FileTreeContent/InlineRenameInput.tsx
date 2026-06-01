/**
 * InlineRenameInput Component
 *
 * Inline text input for renaming files/folders in the file tree.
 * Features:
 * - Auto-focus and select filename (without extension for files)
 * - F2 cycles selection: basename → full → extension → repeat
 * - Enter to confirm, Escape to cancel
 * - Click outside to confirm
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

// ============================================
// Types
// ============================================

export interface InlineRenameInputProps {
  /** Current name of the file/folder */
  initialName: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** Callback when rename is confirmed */
  onConfirm: (newName: string) => void;
  /** Callback when rename is cancelled */
  onCancel: () => void;
  /** Optional callback when value changes (for dynamic icon updates) */
  onValueChange?: (value: string) => void;
}

// Selection cycle states
type SelectionMode = "basename" | "full" | "extension";

// ============================================
// Helper Functions
// ============================================

/**
 * Get the extension position in a filename
 * Returns -1 if no extension or if it's a hidden file (starts with .)
 */
function getExtensionIndex(filename: string): number {
  const lastDot = filename.lastIndexOf(".");
  // No extension or hidden file (like .gitignore)
  if (lastDot <= 0) return -1;
  return lastDot;
}

/**
 * Apply selection based on mode
 */
function applySelection(
  input: HTMLInputElement,
  filename: string,
  mode: SelectionMode
): void {
  const extIndex = getExtensionIndex(filename);

  switch (mode) {
    case "basename":
      // Select filename without extension
      if (extIndex > 0) {
        input.setSelectionRange(0, extIndex);
      } else {
        input.setSelectionRange(0, filename.length);
      }
      break;
    case "full":
      // Select everything
      input.setSelectionRange(0, filename.length);
      break;
    case "extension":
      // Select only extension (including dot)
      if (extIndex > 0) {
        input.setSelectionRange(extIndex, filename.length);
      } else {
        // No extension, select all
        input.setSelectionRange(0, filename.length);
      }
      break;
  }
}

/**
 * Get next selection mode in cycle
 */
function getNextSelectionMode(
  current: SelectionMode,
  hasExtension: boolean
): SelectionMode {
  if (!hasExtension) {
    // No extension, just toggle between basename and full (same in this case)
    return "full";
  }

  switch (current) {
    case "basename":
      return "full";
    case "full":
      return "extension";
    case "extension":
      return "basename";
  }
}

// ============================================
// Main Component
// ============================================

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

  // Auto-focus and select on mount only
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    input.focus();

    // For directories, select all; for files, select basename
    if (isDirectory) {
      input.setSelectionRange(0, initialName.length);
    } else {
      applySelection(input, initialName, "basename");
    }
    // Only run on mount - use initialName for initial selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle input change
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = event.target.value;
      setValue(newValue);
      onValueChange?.(newValue);
    },
    [onValueChange]
  );

  // Handle confirm
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

  // Handle keydown
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      switch (event.key) {
        case "Enter":
          event.preventDefault();
          event.stopPropagation(); // Prevent bubbling to parent
          handleConfirm();
          break;
        case "Escape":
          event.preventDefault();
          event.stopPropagation(); // Prevent bubbling to parent
          onCancel();
          break;
        case "F2":
          event.preventDefault();
          event.stopPropagation(); // Prevent bubbling to parent
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

  // Handle blur (click outside) - confirm the rename
  const handleBlur = useCallback(() => {
    // Small delay to allow other handlers to run first
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
