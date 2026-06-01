/**
 * Marketplace SDK Types
 *
 * Canonical type definitions for the ORGII Agent App Marketplace.
 * Aligned with frontend agentAppsTypes.ts.
 */
import type { ZodType } from "zod";

// ============================================
// Enums & Constants
// ============================================

export const AGENT_APP_CATEGORIES = [
  "code-review",
  "testing",
  "database",
  "security",
  "documentation",
  "devops",
  "design",
  "analytics",
  "general",
] as const;

export type AgentAppCategory = (typeof AGENT_APP_CATEGORIES)[number];

export const DELEGATION_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
] as const;

export type DelegationStatus = (typeof DELEGATION_STATUSES)[number];

export const PRICING_MODELS = ["per_call", "subscription", "free"] as const;

export type PricingModel = (typeof PRICING_MODELS)[number];

export const TRUST_LEVELS = [
  "unverified",
  "community",
  "verified",
  "official",
] as const;

export type TrustLevel = (typeof TRUST_LEVELS)[number];

// ============================================
// Skill Contract
// ============================================

export interface SkillContract {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  tags: string[];
}

// ============================================
// Pricing & SLA & Trust
// ============================================

export interface PricingConfig {
  model: PricingModel;
  pricePerCall?: number;
  subscriptionPlans?: SubscriptionPlan[];
  currency: string;
}

export interface SlaConfig {
  maxLatencyMs: number;
  uptimePercent: number;
  maxRetries: number;
}

export interface TrustConfig {
  level: TrustLevel;
  verifiedAt?: string;
  signaturePublicKey?: string;
}

// ============================================
// Reputation
// ============================================

export interface ReputationSummary {
  score: number;
  totalDelegations: number;
  successRate: number;
  averageLatencyMs: number;
  lastUpdated: string;
}

export interface ReputationDetail extends ReputationSummary {
  recentOutcomes: DelegationOutcome[];
  scoreHistory: Array<{ date: string; score: number }>;
}

// ============================================
// MarketplaceCard (A2A Agent Card + extensions)
// ============================================

export interface MarketplaceCard {
  id: string;
  name: string;
  description: string;
  version: string;
  agentUrl: string;
  category: AgentAppCategory;
  skills: SkillContract[];
  pricing: PricingConfig;
  trust: TrustConfig;
  sla?: SlaConfig;
  reputation: ReputationSummary;
  creatorId: string;
  creatorName: string;
  iconUrl?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Delegation
// ============================================

export interface DelegationRequest {
  agentAppId: string;
  skillId: string;
  input: Record<string, unknown>;
  constraints?: {
    maxLatencyMs?: number;
    maxCostUsd?: number;
    timeoutMs?: number;
  };
  workItemId?: string;
}

export interface DelegationResult {
  taskId: string;
  agentAppId: string;
  agentAppName?: string;
  skillId: string;
  status: DelegationStatus;
  output?: Record<string, unknown>;
  error?: string;
  costUsd: number;
  latencyMs: number;
  startedAt: string;
  completedAt?: string;
  confidence?: number;
}

export interface DelegationOutcome {
  taskId: string;
  agentAppId: string;
  status: DelegationStatus;
  accepted: boolean;
  costUsd: number;
  latencyMs: number;
  completedAt: string;
}

// ============================================
// Subscriptions
// ============================================

export const SUBSCRIPTION_STATUSES = [
  "active",
  "cancelled",
  "expired",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface SubscriptionPlan {
  id: string;
  name: string;
  pricePerMonth: number;
  callsPerMonth: number;
  currency: string;
}

export interface Subscription {
  id: string;
  agentAppId: string;
  agentAppName: string;
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  callsUsed: number;
  callsLimit: number;
  createdAt: string;
}

// ============================================
// Search & Filter
// ============================================

export const SEARCH_SORT_FIELDS = [
  "reputation",
  "price",
  "delegations",
  "created",
] as const;

export type SearchSortField = (typeof SEARCH_SORT_FIELDS)[number];

export const SORT_ORDERS = ["asc", "desc"] as const;

export type SortOrder = (typeof SORT_ORDERS)[number];

export interface AgentAppSearchParams {
  query?: string;
  category?: AgentAppCategory;
  pricingModel?: PricingModel;
  trustLevel?: TrustLevel;
  minReputation?: number;
  sortBy?: SearchSortField;
  sortOrder?: SortOrder;
  limit?: number;
  offset?: number;
}

export interface AgentAppSearchResponse {
  apps: MarketplaceCard[];
  total: number;
}

// ============================================
// Usage & Billing
// ============================================

export interface UsageSummary {
  totalSpentUsd: number;
  totalDelegations: number;
  periodStart: string;
  periodEnd: string;
  byAgentApp: Array<{
    agentAppId: string;
    agentAppName: string;
    delegations: number;
    spentUsd: number;
  }>;
}

// ============================================
// Outcome Report (for reputation)
// ============================================

export interface OutcomeReport {
  taskId: string;
  agentAppId: string;
  accepted: boolean;
  qualityRating?: number;
  feedback?: string;
}

// ============================================
// Streaming Events
// ============================================

export interface DelegationStreamEventBase {
  taskId: string;
  timestamp: string;
}

export interface DelegationStatusEvent extends DelegationStreamEventBase {
  kind: "status";
  status: DelegationStatus;
  message?: string;
}

export interface DelegationArtifactEvent extends DelegationStreamEventBase {
  kind: "artifact";
  artifactId: string;
  data: Record<string, unknown>;
  isFinal: boolean;
}

export interface DelegationCompleteEvent extends DelegationStreamEventBase {
  kind: "complete";
  result: DelegationResult;
}

export interface DelegationErrorEvent extends DelegationStreamEventBase {
  kind: "error";
  error: string;
}

export type DelegationStreamEvent =
  | DelegationStatusEvent
  | DelegationArtifactEvent
  | DelegationCompleteEvent
  | DelegationErrorEvent;

// ============================================
// Creator Types
// ============================================

export interface AgentAppConfig {
  name: string;
  description: string;
  version: string;
  category: AgentAppCategory;
  pricing: PricingConfig;
  trust?: TrustConfig;
  sla?: SlaConfig;
  creatorName: string;
  tags?: string[];
  iconUrl?: string;
}

/** Context passed to skill handlers alongside the validated input. */
export interface HandlerContext {
  /** The A2A task ID for this delegation. */
  taskId: string;
  /** The A2A context ID (groups related interactions). */
  contextId: string;
  /** Constraints from the consumer (budget, latency, timeout). */
  constraints?: {
    maxLatencyMs?: number;
    maxCostUsd?: number;
    timeoutMs?: number;
  };
}

/** Result returned by a synchronous skill handler. */
export interface SkillHandlerResult {
  output: Record<string, unknown>;
  confidence?: number;
}

/** A chunk yielded by a streaming skill handler. */
export interface SkillStreamChunk {
  /** Partial output data for this chunk. */
  data: Record<string, unknown>;
  /** If true, this is the final chunk. */
  isFinal?: boolean;
}

/** Synchronous handler: receives validated input and context, returns result. */
export type SkillHandler<TInput = Record<string, unknown>> = (
  input: TInput,
  context: HandlerContext
) => Promise<SkillHandlerResult>;

/** Streaming handler: receives validated input and context, yields chunks. */
export type StreamingSkillHandler<TInput = Record<string, unknown>> = (
  input: TInput,
  context: HandlerContext
) => AsyncGenerator<SkillStreamChunk, SkillHandlerResult, undefined>;

/** Skill definition used with the builder API. */
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  inputSchema: ZodType;
  outputSchema: ZodType;
  sla?: SlaConfig;
  handler: SkillHandler;
  streamHandler?: StreamingSkillHandler;
}

// ============================================
// Client Options
// ============================================

export interface MarketplaceClientOptions {
  registryUrl?: string;
  authToken?: string;
}

// ============================================
// Listen Options (creator)
// ============================================

export interface ListenOptions {
  port?: number;
  registry?: string;
  authToken?: string;
}
