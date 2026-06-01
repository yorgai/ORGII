/**
 * useDraftNumber — edit-friendly number input hook
 *
 * Lets the user type freely (including emptying the field).
 * Validates + clamps only on blur. If the field is empty or
 * invalid on blur, the previous value is silently restored.
 *
 * @example
 * ```tsx
 * const price = useDraftNumber({
 *   value: priceUsd,
 *   min: 0,
 *   onChange: (v) => setPriceUsd(v),
 * });
 *
 * <Input
 *   value={price.displayValue}
 *   onChange={price.onInputChange}
 *   onBlur={price.onInputBlur}
 * />
 * ```
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface UseDraftNumberOptions {
  /** Current committed value */
  value: number;
  /** Minimum (clamped on blur only) */
  min?: number;
  /** Maximum (clamped on blur only) */
  max?: number;
  /** Called with the validated number on blur */
  onChange: (value: number) => void;
  /** If provided, called when the field is cleared instead of restoring.
   *  Useful for optional numbers where empty = "no limit". */
  onEmpty?: () => void;
}

interface UseDraftNumberReturn {
  /** Bind to Input `value` */
  displayValue: string;
  /** Bind to Input `onChange` */
  onInputChange: (val: string) => void;
  /** Bind to Input `onBlur` */
  onInputBlur: () => void;
}

export function useDraftNumber({
  value,
  min,
  max,
  onChange,
  onEmpty,
}: UseDraftNumberOptions): UseDraftNumberReturn {
  const [draft, setDraft] = useState<string | null>(null);
  // Keep stable refs so the blur callback doesn't re-create on identity changes.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const onEmptyRef = useRef(onEmpty);
  useEffect(() => {
    onEmptyRef.current = onEmpty;
  }, [onEmpty]);

  // Comma-formatted when idle, raw number when editing
  const displayValue = draft !== null ? draft : value.toLocaleString("en-US");

  const onInputChange = useCallback((val: string) => {
    setDraft(val);
  }, []);

  const onInputBlur = useCallback(() => {
    if (draft === null) return;
    const trimmed = draft.trim().replace(/,/g, "");
    if (trimmed !== "") {
      const parsed = parseFloat(trimmed);
      if (!isNaN(parsed)) {
        let clamped = parsed;
        if (min !== undefined) clamped = Math.max(min, clamped);
        if (max !== undefined) clamped = Math.min(max, clamped);
        onChangeRef.current(clamped);
      }
      // NaN → restore (no-op)
    } else if (onEmptyRef.current) {
      onEmptyRef.current();
    }
    // empty without onEmpty → restore (no-op)
    setDraft(null);
  }, [draft, min, max]);

  return { displayValue, onInputChange, onInputBlur };
}
