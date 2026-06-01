/**
 * Tool Alias Resolution
 *
 * Unified entry point for resolving tool/function names to canonical registry keys.
 * Delegates to the unified tool registry (initToolRegistry.ts):
 *
 * - **CLI agents** (Cursor, Claude Code, Codex, Gemini, Kiro, Copilot):
 *   Use CLI alias map from Rust's `cli_agents/alias_map.rs`.
 *   Returns ui_canonical for component lookup.
 *
 * - **Rust agents** (OS, SDE):
 *   Use canonical tool names directly (identity mapping). No aliasing needed.
 *
 * NOTE: No static fallback in production. Tests inject fixtures via vitest.setup.ts.
 */
import { getBuiltinSimulatorApp, getCliUiCanonical } from "./initToolRegistry";

/**
 * Resolve any tool/function/action name to its canonical registry key (UI component lookup).
 *
 * Resolution order:
 * 1. Check if it's a Rust agent canonical name (pass through)
 * 2. Look up in CLI alias map for ui_canonical
 * 3. Fallback to the name itself
 */
export function resolveToolName(name: string): string {
  // Rust agent canonical names pass through directly
  // (getBuiltinSimulatorApp returns non-null for known built-in tools)
  if (getBuiltinSimulatorApp(name)) {
    return name;
  }

  // CLI aliases resolve to ui_canonical
  return getCliUiCanonical(name);
}
