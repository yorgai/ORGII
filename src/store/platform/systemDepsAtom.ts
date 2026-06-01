/**
 * System Dependencies Atom
 *
 * Lazy-loading Jotai atom that fetches the cached dependency scan
 * from the Rust backend, then exposes a Map<binary, installed>
 * lookup for prerequisite checks.
 *
 * Strategy:
 *  1. Try `get_cached_dependencies` (fast, reads ~/.orgii/dependencies.json).
 *  2. If cache is empty/expired, fall back to `detect_system_dependencies`
 *     (full scan, slower but always produces results).
 *  3. After any install action completes, call `invalidateDepsAtom`
 *     so the next render re-fetches fresh data.
 */
import { invoke } from "@tauri-apps/api/core";
import { atom } from "jotai";

interface DepEntry {
  binary: string;
  installed: boolean;
}

interface CachedResult {
  dependencies: DepEntry[];
}

const rawDepsAtom = atom<DepEntry[]>([]);
rawDepsAtom.debugLabel = "systemDeps/raw";

const depsLoadedAtom = atom(false);
depsLoadedAtom.debugLabel = "systemDeps/loaded";

const depsLoadingAtom = atom(false);
depsLoadingAtom.debugLabel = "systemDeps/loading";

/**
 * Write-only atom: populates the dependency cache on first call.
 * Tries the fast disk cache first; falls back to a full scan if
 * the cache is empty or expired. Subsequent calls are no-ops
 * unless `invalidateDepsAtom` has been dispatched.
 */
export const ensureDepsLoadedAtom = atom(null, async (get, set) => {
  if (get(depsLoadedAtom) || get(depsLoadingAtom)) return;
  set(depsLoadingAtom, true);
  try {
    const cached = await invoke<CachedResult>("get_cached_dependencies");
    if (cached.dependencies.length > 0) {
      set(rawDepsAtom, cached.dependencies);
      set(depsLoadedAtom, true);
      set(depsLoadingAtom, false);
      return;
    }
  } catch {
    // Cache miss or expired — fall through to full scan
  }

  try {
    const scanned = await invoke<CachedResult>("detect_system_dependencies");
    set(rawDepsAtom, scanned.dependencies);
    set(depsLoadedAtom, true);
  } catch {
    // Both failed — leave empty, will retry on next invalidation
  } finally {
    set(depsLoadingAtom, false);
  }
});
ensureDepsLoadedAtom.debugLabel = "systemDeps/ensureLoaded";

/**
 * Write-only atom: resets the loaded flag so the next
 * `ensureDepsLoadedAtom` dispatch triggers a fresh fetch.
 * Call after any install/uninstall action completes.
 */
export const invalidateDepsAtom = atom(null, (_get, set) => {
  set(depsLoadedAtom, false);
});
invalidateDepsAtom.debugLabel = "systemDeps/invalidate";

/**
 * Derived atom: O(1) lookup map from binary name → installed boolean.
 */
export const depLookupAtom = atom((get) => {
  const deps = get(rawDepsAtom);
  return new Map(deps.map((dep) => [dep.binary, dep.installed]));
});
depLookupAtom.debugLabel = "systemDeps/lookup";
