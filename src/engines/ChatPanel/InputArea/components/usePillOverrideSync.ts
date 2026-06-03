/**
 * usePillOverrideSync
 *
 * Shared hook for the "mirror picked value into an atom, clear on unmount"
 * pattern used by CursorModelPill, CursorModePill and their Creator
 * counterparts.
 *
 * Instead of:
 *   useEffect(() => { setOverride(pickedValue); }, [pickedValue, setOverride]);
 *   useEffect(() => { return () => { setOverride(null); }; }, [setOverride]);
 *
 * Callers write:
 *   usePillOverrideSync(pickedValue, setOverride);
 */
import { useEffect } from "react";

type OverrideSetter<T> = (value: T | null) => void;

export function usePillOverrideSync<T>(
  pickedValue: T | null,
  setOverride: OverrideSetter<T>
): void {
  useEffect(() => {
    setOverride(pickedValue);
  }, [pickedValue, setOverride]);

  useEffect(() => {
    return () => {
      setOverride(null);
    };
  }, [setOverride]);
}
