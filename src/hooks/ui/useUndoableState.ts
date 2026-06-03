import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_MAX_STACK = 50;

// ============================================
// Shared keyboard shortcut listener (ref-stable)
// ============================================

function useUndoKeyboard(
  enabled: boolean,
  onUndo: () => void,
  onRedo: () => void
) {
  const undoRef = useRef(onUndo);
  const redoRef = useRef(onRedo);
  useEffect(() => {
    undoRef.current = onUndo;
  }, [onUndo]);
  useEffect(() => {
    redoRef.current = onRedo;
  }, [onRedo]);

  useEffect(() => {
    if (!enabled) return;

    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.key.toLowerCase() !== "z") return;

      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (target.isContentEditable) return;
      }

      event.preventDefault();
      if (event.shiftKey) {
        redoRef.current();
      } else {
        undoRef.current();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enabled]);
}

// ============================================
// useUndoStack — low-level primitive for external state
// ============================================

interface UseUndoStackOptions {
  maxStack?: number;
}

interface UseUndoStackReturn<T> {
  /** Save current value before mutating. Clears redo stack. */
  snapshot: (currentValue: T) => void;
  /** Pop from undo stack. Returns undefined if empty. Does NOT touch redo. */
  undo: () => T | undefined;
  /** Pop from redo stack. Returns undefined if empty. Does NOT touch undo. */
  redo: () => T | undefined;
  /** Push a value to the redo stack (used during undo to preserve current). */
  pushRedo: (value: T) => void;
  /** Push a value to the undo stack (used during redo to preserve current). */
  pushUndo: (value: T) => void;
  canUndo: boolean;
  canRedo: boolean;
  clear: () => void;
}

export function useUndoStack<T>(
  options: UseUndoStackOptions = {}
): UseUndoStackReturn<T> {
  const { maxStack = DEFAULT_MAX_STACK } = options;

  const undoRef = useRef<T[]>([]);
  const redoRef = useRef<T[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncFlags = useCallback(() => {
    setCanUndo(undoRef.current.length > 0);
    setCanRedo(redoRef.current.length > 0);
  }, []);

  const snapshot = useCallback(
    (currentValue: T) => {
      const stack = undoRef.current;
      if (stack.length >= maxStack) stack.shift();
      stack.push(currentValue);
      redoRef.current = [];
      syncFlags();
    },
    [maxStack, syncFlags]
  );

  const undo = useCallback((): T | undefined => {
    if (undoRef.current.length === 0) return undefined;
    const val = undoRef.current.pop()!;
    syncFlags();
    return val;
  }, [syncFlags]);

  const redo = useCallback((): T | undefined => {
    if (redoRef.current.length === 0) return undefined;
    const val = redoRef.current.pop()!;
    syncFlags();
    return val;
  }, [syncFlags]);

  const pushRedo = useCallback(
    (value: T) => {
      redoRef.current.push(value);
      syncFlags();
    },
    [syncFlags]
  );

  const pushUndo = useCallback(
    (value: T) => {
      const stack = undoRef.current;
      if (stack.length >= maxStack) stack.shift();
      stack.push(value);
      syncFlags();
    },
    [maxStack, syncFlags]
  );

  const clear = useCallback(() => {
    undoRef.current = [];
    redoRef.current = [];
    syncFlags();
  }, [syncFlags]);

  return {
    snapshot,
    undo,
    redo,
    pushRedo,
    pushUndo,
    canUndo,
    canRedo,
    clear,
  };
}

// ============================================
// useUndoStackWithRestore — undo stack + keyboard + auto-apply
// ============================================

interface UseUndoStackWithRestoreOptions<T> {
  maxStack?: number;
  keyboardShortcut?: boolean;
  onRestore: (value: T) => void;
  currentValue: T;
}

interface UseUndoStackWithRestoreReturn<T> {
  snapshot: (currentValue: T) => void;
  canUndo: boolean;
  canRedo: boolean;
  clear: () => void;
  undo: () => void;
  redo: () => void;
}

export function useUndoStackWithRestore<T>(
  options: UseUndoStackWithRestoreOptions<T>
): UseUndoStackWithRestoreReturn<T> {
  const { maxStack = DEFAULT_MAX_STACK, keyboardShortcut = false } = options;

  const stack = useUndoStack<T>({ maxStack });

  const currentRef = useRef(options.currentValue);
  const restoreRef = useRef(options.onRestore);
  useEffect(() => {
    currentRef.current = options.currentValue;
  }, [options.currentValue]);
  useEffect(() => {
    restoreRef.current = options.onRestore;
  }, [options.onRestore]);

  const handleUndo = useCallback(() => {
    const prev = stack.undo();
    if (prev === undefined) return;
    stack.pushRedo(currentRef.current);
    restoreRef.current(prev);
  }, [stack]);

  const handleRedo = useCallback(() => {
    const next = stack.redo();
    if (next === undefined) return;
    stack.pushUndo(currentRef.current);
    restoreRef.current(next);
  }, [stack]);

  useUndoKeyboard(keyboardShortcut, handleUndo, handleRedo);

  return {
    snapshot: stack.snapshot,
    canUndo: stack.canUndo,
    canRedo: stack.canRedo,
    clear: stack.clear,
    undo: handleUndo,
    redo: handleRedo,
  };
}

// ============================================
// useUndoableState — high-level useState replacement
// ============================================

interface UseUndoableStateOptions<T> {
  maxStack?: number;
  keyboardShortcut?: boolean;
  isEqual?: (a: T, b: T) => boolean;
}

interface UseUndoableStateReturn<T> {
  state: T;
  setState: (next: T | ((prev: T) => T)) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reset: (value: T) => void;
}

export function useUndoableState<T>(
  initialValue: T | (() => T),
  options: UseUndoableStateOptions<T> = {}
): UseUndoableStateReturn<T> {
  const {
    maxStack = DEFAULT_MAX_STACK,
    keyboardShortcut = false,
    isEqual,
  } = options;

  const [value, setValueRaw] = useState<T>(initialValue);
  const undoRef = useRef<T[]>([]);
  const redoRef = useRef<T[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncFlags = useCallback(() => {
    setCanUndo(undoRef.current.length > 0);
    setCanRedo(redoRef.current.length > 0);
  }, []);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValueRaw((prev) => {
        const resolved =
          typeof next === "function" ? (next as (prev: T) => T)(prev) : next;

        if (isEqual ? isEqual(prev, resolved) : prev === resolved) {
          return prev;
        }

        const stack = undoRef.current;
        if (stack.length >= maxStack) stack.shift();
        stack.push(prev);
        redoRef.current = [];
        return resolved;
      });
      syncFlags();
    },
    [maxStack, isEqual, syncFlags]
  );

  const undo = useCallback(() => {
    const stack = undoRef.current;
    if (stack.length === 0) return;
    const prev = stack.pop()!;
    setValueRaw((current) => {
      redoRef.current.push(current);
      return prev;
    });
    syncFlags();
  }, [syncFlags]);

  const redo = useCallback(() => {
    const stack = redoRef.current;
    if (stack.length === 0) return;
    const next = stack.pop()!;
    setValueRaw((current) => {
      undoRef.current.push(current);
      return next;
    });
    syncFlags();
  }, [syncFlags]);

  const reset = useCallback(
    (resetValue: T) => {
      undoRef.current = [];
      redoRef.current = [];
      setValueRaw(resetValue);
      syncFlags();
    },
    [syncFlags]
  );

  useUndoKeyboard(keyboardShortcut, undo, redo);

  return {
    state: value,
    setState: setValue,
    undo,
    redo,
    canUndo,
    canRedo,
    reset,
  };
}
