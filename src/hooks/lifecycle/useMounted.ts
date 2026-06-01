/**
 * useMountedCleanup
 *
 * Registers a cleanup effect that sets the caller-owned `mountedRef` to
 * `false` when the component unmounts.
 *
 * Keeps the `useRef(true)` declaration in the consuming hook so that the
 * React Compiler can statically see it is a ref (avoiding false
 * "preserve-manual-memoization" errors when the ref is used inside
 * `useCallback`).
 *
 * Usage — replace the two-line boilerplate:
 *
 *   // Before:
 *   const mountedRef = useRef(true);
 *   useEffect(() => { return () => { mountedRef.current = false; }; }, []);
 *
 *   // After:
 *   const mountedRef = useRef(true);
 *   useMountedCleanup(mountedRef);
 */
import { type MutableRefObject, type RefObject, useEffect } from "react";
/**
 * useMounted
 *
 * Convenience wrapper — creates the ref AND registers the cleanup.
 * Use this when the ref is NOT passed to any `useCallback` dep array
 * (i.e. the React Compiler won't complain).
 *
 * If ESLint/React Compiler reports "preserve-manual-memoization" on a
 * `useCallback` that uses this ref, switch to the two-line pattern:
 *   const mountedRef = useRef(true);
 *   useMountedCleanup(mountedRef);
 */
import { useRef } from "react";

export function useMountedCleanup(mountedRef: RefObject<boolean>): void {
  useEffect(() => {
    return () => {
      (mountedRef as MutableRefObject<boolean>).current = false;
    };
  }, [mountedRef]);
}

export function useMounted(): RefObject<boolean> {
  const mountedRef = useRef(true);
  useMountedCleanup(mountedRef);
  return mountedRef;
}
