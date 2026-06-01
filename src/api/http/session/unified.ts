/**
 * Unified Session API
 *
 * All sessions now run locally via Tauri/Rust engine. The hosted ORGII
 * proxy (when configured) handles billing only (allocate/release tokens);
 * the session lifecycle still runs through the local Rust-backed API.
 *
 * The "source=market" URL flag is the hosted-key entry point.
 */
import { sessionApi } from "./local";

export type UnifiedSessionApi = typeof sessionApi;

export function isHostedFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get("source") === "market";
}

export function isHostedFromSearchParams(
  searchParams: URLSearchParams
): boolean {
  return searchParams.get("source") === "market";
}

/**
 * All sessions route to the local Rust-backed session API.
 * The isHosted flag is kept for backward compat but has no routing effect.
 */
export function createUnifiedSessionApi(
  _isHosted: boolean = false
): UnifiedSessionApi {
  return sessionApi;
}

export const unifiedSessionApi = {
  createUnifiedSessionApi,
  isHostedFromUrl,
  isHostedFromSearchParams,
};

export default unifiedSessionApi;
