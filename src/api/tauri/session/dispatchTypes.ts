/**
 * Session dispatch type definitions.
 *
 * Zero-dependency module. Imported by both:
 * - api/tauri/session/index.ts (re-exports for public API)
 * - store/session/sessionAtom/types.ts (used in Session interface)
 *
 * Keeping these separate breaks the circular dependency between those two.
 */

/**
 * Dispatch routing category.
 *
 * - `"cli_agent"` — CLI agent session (external CLI process spawned by us)
 * - `"rust_agent"` — Rust-native agent session (OS Agent, SDE Agent, Custom)
 * - `"cursor_ide"` — Cursor IDE chat surfaced as a ORGII session. We don't
 *   own the data store (it lives in Cursor's `state.vscdb`) but we *do*
 *   support sending new prompts back into the live probe Cursor instance
 *   via `cursorIdeAdapter.sendMessage`. Read history; write follow-ups.
 */
export type DispatchCategory = "cli_agent" | "rust_agent" | "cursor_ide";

export const DISPATCH_CATEGORY = {
  CLI_AGENT: "cli_agent",
  RUST_AGENT: "rust_agent",
  CURSOR_IDE: "cursor_ide",
} as const;

/**
 * Key source: how the session is billed.
 *
 * - `"own_key"` — BYOK; user's own provider key from the local key store.
 * - `"hosted_key"` — hosted ORGII key. Routed through the ORGII proxy
 *   for credit-based billing; the per-session bearer token is stored
 *   alongside the session record (`hostedToken` / `hosted_token`).
 */
export type KeySource = "own_key" | "hosted_key";

export const KEY_SOURCE = {
  OWN: "own_key" as const,
  HOSTED: "hosted_key" as const,
} as const;

export function isHostedKey(ks: KeySource | string | undefined): boolean {
  return ks === KEY_SOURCE.HOSTED;
}

export function isOwnKey(ks: KeySource | string | undefined): boolean {
  return !isHostedKey(ks);
}
