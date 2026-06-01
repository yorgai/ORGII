/**
 * useRefreshSpin — one-shot 2-round spin on every click, plus continuous spin while loading.
 *
 * Ensures the refresh icon always spins at least 2 rounds when clicked,
 * even if the refresh completes immediately.
 *
 * @param onRefresh - Callback to run on click (e.g. fetch, revalidate)
 * @param loading - Whether the refresh is in progress
 * @param persistenceKey - Optional key to preserve one-shot spin across remounts
 * @returns { spinClass, handleClick } - Apply spinClass to RefreshCw, use handleClick for onClick
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { REFRESH_ICON_TOKENS } from "@src/components/RefreshIcon/tokens";

const SPIN_DURATION_MS = 1200;
const MAX_PERSISTED_SPIN_KEYS = 200;
const persistedOneShotUntilMap = new Map<string, number>();

function setPersistedOneShotUntil(key: string, oneShotUntil: number): void {
  if (oneShotUntil <= Date.now()) {
    persistedOneShotUntilMap.delete(key);
    return;
  }

  if (persistedOneShotUntilMap.has(key)) {
    persistedOneShotUntilMap.delete(key);
  } else if (persistedOneShotUntilMap.size >= MAX_PERSISTED_SPIN_KEYS) {
    const oldestKey = persistedOneShotUntilMap.keys().next().value;
    if (oldestKey) persistedOneShotUntilMap.delete(oldestKey);
  }

  persistedOneShotUntilMap.set(key, oneShotUntil);
}

export function useRefreshSpin(
  onRefresh: () => void,
  loading: boolean,
  persistenceKey?: string
): { spinClass: string | undefined; handleClick: () => void } {
  const [localOneShotUntil, setLocalOneShotUntil] = useState(0);
  const [, setRenderVersion] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  const setOneShotUntil = useCallback(
    (oneShotUntil: number): void => {
      if (!persistenceKey) {
        setLocalOneShotUntil(oneShotUntil);
        return;
      }
      setPersistedOneShotUntil(persistenceKey, oneShotUntil);
    },
    [persistenceKey]
  );

  const forceRerender = useCallback(() => {
    setRenderVersion((previousVersion) => previousVersion + 1);
  }, []);

  const handleClick = useCallback(() => {
    if (loading) return;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Remove class first so rapid clicks retrigger CSS animation reliably.
    setOneShotUntil(0);
    if (persistenceKey) forceRerender();

    rafRef.current = requestAnimationFrame(() => {
      setOneShotUntil(Date.now() + SPIN_DURATION_MS);
      if (persistenceKey) forceRerender();
      onRefresh();
      rafRef.current = null;
    });
  }, [loading, onRefresh, persistenceKey, setOneShotUntil, forceRerender]);

  const oneShotUntil = persistenceKey
    ? (persistedOneShotUntilMap.get(persistenceKey) ?? 0)
    : localOneShotUntil;

  useEffect(() => {
    if (oneShotUntil <= 0) return;

    const remainingMs = oneShotUntil - Date.now();

    timeoutRef.current = setTimeout(
      () => {
        setOneShotUntil(0);
        if (persistenceKey) forceRerender();
        timeoutRef.current = null;
      },
      Math.max(remainingMs, 0)
    );

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [oneShotUntil, persistenceKey, setOneShotUntil, forceRerender]);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  const spinClass =
    oneShotUntil > 0
      ? REFRESH_ICON_TOKENS.oneShot
      : loading
        ? REFRESH_ICON_TOKENS.spin
        : undefined;

  return { spinClass, handleClick };
}
