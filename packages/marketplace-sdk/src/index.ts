/**
 * @orgii/marketplace-sdk
 *
 * SDK for building and consuming agent apps on the ORGII Marketplace.
 * Built on Google A2A protocol via @a2a-js/sdk.
 */

// ─── Consumer client ─────────────────────────────────────────
export { MarketplaceClient } from "./client.js";

// ─── Creator builder ─────────────────────────────────────────
export { createMarketplaceAgent, AgentBuilder } from "./creator.js";

// ─── Server (advanced usage) ─────────────────────────────────
export { createMarketplaceServer } from "./server.js";
export type { MarketplaceServer, RegisteredSkill } from "./server.js";

// ─── Validation ──────────────────────────────────────────────
export {
  validateInput,
  validateOutput,
  SkillValidationError,
} from "./validation.js";

// ─── Streaming utilities ─────────────────────────────────────
export { mapA2AStreamToDelegationEvents } from "./streaming.js";

// ─── Types ───────────────────────────────────────────────────
export type {
  // Enums & constants
  AgentAppCategory,
  DelegationStatus,
  PricingModel,
  TrustLevel,
  SubscriptionStatus,
  SearchSortField,
  SortOrder,

  // Core entities
  AgentAppConfig,
  ListenOptions,
  MarketplaceCard,
  MarketplaceClientOptions,
  SkillContract,

  // Pricing, SLA, Trust
  PricingConfig,
  SlaConfig,
  TrustConfig,

  // Reputation
  ReputationSummary,
  ReputationDetail,

  // Delegation
  DelegationRequest,
  DelegationResult,
  DelegationOutcome,

  // Subscriptions
  SubscriptionPlan,
  Subscription,

  // Search
  AgentAppSearchParams,
  AgentAppSearchResponse,

  // Usage & Billing
  UsageSummary,
  OutcomeReport,

  // Streaming events
  DelegationStreamEvent,
  DelegationStatusEvent,
  DelegationArtifactEvent,
  DelegationCompleteEvent,
  DelegationErrorEvent,

  // Creator types
  HandlerContext,
  SkillDefinition,
  SkillHandler,
  SkillHandlerResult,
  StreamingSkillHandler,
  SkillStreamChunk,
} from "./types.js";

// Re-export constants
export {
  AGENT_APP_CATEGORIES,
  DELEGATION_STATUSES,
  PRICING_MODELS,
  TRUST_LEVELS,
  SUBSCRIPTION_STATUSES,
  SEARCH_SORT_FIELDS,
  SORT_ORDERS,
} from "./types.js";
