/**
 * Module-Level Singleton Tracking for useRepoSelection
 *
 * These globals prevent race conditions across multiple hook instances.
 */

// Track if repos have been loaded globally (prevents duplicate init logs and race conditions)
export let globalReposLoaded = false;
export let globalLoadInProgress = false;

export function setGlobalReposLoaded(value: boolean) {
  globalReposLoaded = value;
}

export function setGlobalLoadInProgress(value: boolean) {
  globalLoadInProgress = value;
}

// Module-level flag to track when a checkout is in progress
// This prevents any hook instance from reverting the optimistic branch update
export let isCheckingOut = false;

export function setIsCheckingOut(value: boolean) {
  isCheckingOut = value;
}

// Module-level callbacks to notify all hook instances of checkout state changes
const checkoutStateListeners = new Set<(loading: boolean) => void>();

export function addCheckoutStateListener(listener: (loading: boolean) => void) {
  checkoutStateListeners.add(listener);
  return () => {
    checkoutStateListeners.delete(listener);
  };
}

export function notifyCheckoutState(loading: boolean) {
  checkoutStateListeners.forEach((listener) => listener(loading));
}
