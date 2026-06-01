/**
 * Model Pool Categories
 *
 * The "pool" concept partitions models into price-based tiers (turbo / pro /
 * pro_max in the legacy ORGII branding). The taxonomy is consumed by the
 * KeyVault Models table, the unified model palette, and BYOK
 * pair-compatibility checks. In the OSS build the runtime config is served
 * by `@src/api/http/orgiiHosted/poolConfig.ts` (a static empty config); the
 * hosted ORGII build can swap in a real fetcher.
 *
 * The `ORGII*` prefix is retained for now and will be renamed in the
 * `Orgii → Orgii` brand pass.
 */

export interface CreditRange {
  min: number;
  max: number;
}

export interface ORGIIPoolCategory {
  id: string;
  label: string;
  models: string[];
  credit_range: CreditRange;
}

export interface ORGIIPoolConfig {
  categories: ORGIIPoolCategory[];
  /** Agent types treated as "direct" (not proxy) by the backend */
  direct_agent_types: string[];
  /** The most expensive category ID — proxy listings are restricted from this tier */
  highest_category_id: string;
  /** Minimum top-up amount in USD (from BillingDefaults) */
  min_topup_usd: number;
  /** Minimum balance in USD to start a session (from BillingDefaults) */
  min_balance_usd: number;
}
