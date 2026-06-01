import type { Err } from "./types";

export function asError(err: unknown): Err {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[E2EBootstrap] error:", msg);
  return { ok: false, error: msg };
}
