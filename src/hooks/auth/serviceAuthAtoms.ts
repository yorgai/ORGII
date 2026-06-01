/**
 * Service Auth Atoms
 *
 * Jotai atoms for global service auth state sharing.
 * All atoms are initialized from localStorage on first load.
 * Use `useServiceAuthState` for read-only access; use `useServiceAuth` for actions.
 */
import { atom, getDefaultStore, useAtomValue } from "jotai";

import { secureClearTokens } from "@src/api/http/auth/secure";
import {
  clearHostedToken,
  getHostedToken,
  getTimeUntilExpiry,
  isServiceAuthenticated,
} from "@src/config/serviceAuth";

const initialAuth = isServiceAuthenticated();
const initialToken = getHostedToken();
const initialExpiry = getTimeUntilExpiry();

export const serviceAuthAtom = atom(initialAuth);
export const serviceLoadingAtom = atom(false);
export const hostedTokenAtom = atom<string | null>(initialToken);
export const serviceExpiryAtom = atom<number | null>(initialExpiry);
export const serviceErrorAtom = atom<string | null>(null);
export const serviceValidatedAtom = atom(false);
export const serviceRefreshingAtom = atom(false);

/**
 * Clear both localStorage AND Jotai atoms atomically.
 * Use when signing out before navigating to login.
 */
export function clearAuthStateCompletely(): void {
  clearHostedToken();
  secureClearTokens().catch(() => {});

  const store = getDefaultStore();
  store.set(serviceAuthAtom, false);
  store.set(hostedTokenAtom, null);
  store.set(serviceExpiryAtom, null);
  store.set(serviceErrorAtom, null);
  store.set(serviceValidatedAtom, false);
}

export interface UseServiceAuthStateReturn {
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  expiresIn: number | null;
  error: string | null;
  isRefreshing: boolean;
}

/**
 * Read-only hook — no side effects, no network calls.
 * Use for components that only need to observe auth state.
 */
export function useServiceAuthState(): UseServiceAuthStateReturn {
  const isAuthenticated = useAtomValue(serviceAuthAtom);
  const isLoading = useAtomValue(serviceLoadingAtom);
  const token = useAtomValue(hostedTokenAtom);
  const expiresIn = useAtomValue(serviceExpiryAtom);
  const error = useAtomValue(serviceErrorAtom);
  const isRefreshing = useAtomValue(serviceRefreshingAtom);
  return { isAuthenticated, isLoading, token, expiresIn, error, isRefreshing };
}
