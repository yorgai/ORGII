import { createLogger } from "@src/hooks/logger";

import type { Err } from "./types";

const log = createLogger("E2EBootstrap");

export function asError(err: unknown): Err {
  const msg = err instanceof Error ? err.message : String(err);
  log.error("[E2EBootstrap] error:", msg);
  return { ok: false, error: msg };
}
