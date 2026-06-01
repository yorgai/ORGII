/**
 * Pool Config — OSS Stub
 *
 * The OSS build has no marketplace pool taxonomy, so this module ships an
 * empty static config: every consumer that asks for the pool gets
 * `categories: []`, every classification call returns the empty-string
 * fallback id, and UIs that grouped models by pool tier collapse to the
 * "no tiers" rendering path. The hosted ORGII build can swap in a real
 * fetcher behind the same surface.
 */
import type { ORGIIPoolConfig } from "@src/types/model/pool";

/** Empty static config. Mutating this object is meaningless — every
 *  getter returns the same instance. */
const EMPTY_POOL_CONFIG: ORGIIPoolConfig = {
  categories: [],
  direct_agent_types: [],
  highest_category_id: "",
  min_topup_usd: 0,
  min_balance_usd: 0,
};

/** Synchronous read. Always returns the same empty config (never `null`). */
export function getORGIIPoolConfigCached(): ORGIIPoolConfig | null {
  return EMPTY_POOL_CONFIG;
}

/** Async read. Resolves immediately with the empty config. */
export async function getORGIIPoolConfig(): Promise<ORGIIPoolConfig> {
  return EMPTY_POOL_CONFIG;
}
