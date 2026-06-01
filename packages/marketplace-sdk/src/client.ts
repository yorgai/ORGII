/**
 * MarketplaceClient
 *
 * Consumer client for discovering and delegating to agent apps.
 * Uses @a2a-js/sdk ClientFactory for A2A protocol delegation.
 * Uses raw fetch for registry API calls (not A2A protocol).
 */
import type { MessageSendParams } from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import { v4 as uuidv4 } from "uuid";

import {
  buildResultFromTask,
  mapA2AStreamToDelegationEvents,
} from "./streaming.js";
import type {
  AgentAppSearchParams,
  AgentAppSearchResponse,
  DelegationRequest,
  DelegationResult,
  DelegationStreamEvent,
  MarketplaceCard,
  MarketplaceClientOptions,
  OutcomeReport,
  Subscription,
  UsageSummary,
} from "./types.js";

const DEFAULT_REGISTRY_URL = "http://localhost:8001";

export class MarketplaceClient {
  private readonly registryUrl: string;
  private readonly authToken?: string;
  private readonly clientFactory: ClientFactory;

  constructor(options: MarketplaceClientOptions = {}) {
    this.registryUrl = options.registryUrl ?? DEFAULT_REGISTRY_URL;
    this.authToken = options.authToken;
    this.clientFactory = new ClientFactory();
  }

  // ─── Registry helpers ──────────────────────────────────────

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  private async registryGet<T>(path: string): Promise<T> {
    const response = await fetch(`${this.registryUrl}${path}`, {
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw new Error(
        `Registry GET ${path} failed: ${response.status} ${response.statusText}`
      );
    }
    return response.json() as Promise<T>;
  }

  private async registryPost<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.registryUrl}${path}`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `Registry POST ${path} failed: ${response.status} ${response.statusText}`
      );
    }
    return response.json() as Promise<T>;
  }

  private async registryDelete(path: string): Promise<void> {
    const response = await fetch(`${this.registryUrl}${path}`, {
      method: "DELETE",
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw new Error(
        `Registry DELETE ${path} failed: ${response.status} ${response.statusText}`
      );
    }
  }

  // ─── Discovery (registry REST API) ────────────────────────

  async search(
    params: AgentAppSearchParams = {}
  ): Promise<AgentAppSearchResponse> {
    const searchParams = new URLSearchParams();
    if (params.query) searchParams.set("query", params.query);
    if (params.category) searchParams.set("category", params.category);
    if (params.pricingModel)
      searchParams.set("pricing_model", params.pricingModel);
    if (params.trustLevel) searchParams.set("trust_level", params.trustLevel);
    if (params.minReputation != null)
      searchParams.set("min_reputation", String(params.minReputation));
    if (params.sortBy) searchParams.set("sort_by", params.sortBy);
    if (params.sortOrder) searchParams.set("sort_order", params.sortOrder);
    if (params.limit != null) searchParams.set("limit", String(params.limit));
    if (params.offset != null)
      searchParams.set("offset", String(params.offset));

    const qs = searchParams.toString();
    const path = `/v1/agent-apps${qs ? `?${qs}` : ""}`;
    return this.registryGet<AgentAppSearchResponse>(path);
  }

  async getAgent(agentId: string): Promise<MarketplaceCard> {
    return this.registryGet<MarketplaceCard>(`/v1/agent-apps/${agentId}`);
  }

  // ─── Delegation (A2A protocol via @a2a-js/sdk) ────────────

  private buildA2AParams(request: DelegationRequest): MessageSendParams {
    return {
      message: {
        kind: "message",
        messageId: uuidv4(),
        role: "user",
        parts: [
          {
            kind: "data",
            data: {
              skill_id: request.skillId,
              input: request.input,
              constraints: request.constraints,
            },
          },
        ],
      },
    };
  }

  /**
   * Blocking delegation via A2A message/send.
   * Creates an A2A client for the agent URL, sends the request,
   * and maps the response to a DelegationResult.
   */
  async delegate(
    agentUrl: string,
    request: DelegationRequest
  ): Promise<DelegationResult> {
    const startTime = Date.now();
    const params = this.buildA2AParams(request);
    const timeoutMs = request.constraints?.timeoutMs ?? 30_000;

    const client = await this.clientFactory.createFromUrl(agentUrl);
    const result = await client.sendMessage(params, {
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (result.kind === "task") {
      return buildResultFromTask(
        result,
        request.agentAppId,
        request.skillId,
        startTime
      );
    }

    if (result.kind !== "message") {
      throw new Error(
        `Unexpected A2A response kind: ${(result as { kind: string }).kind}`
      );
    }

    // Direct message response without task lifecycle
    const textPart = result.parts?.find(
      (
        part
      ): part is {
        kind: "text";
        text: string;
        metadata?: Record<string, unknown>;
      } => part.kind === "text"
    );
    const dataPart = result.parts?.find(
      (
        part
      ): part is {
        kind: "data";
        data: Record<string, unknown>;
        metadata?: Record<string, unknown>;
      } => part.kind === "data"
    );

    return {
      taskId: result.messageId,
      agentAppId: request.agentAppId,
      skillId: request.skillId,
      status: "completed",
      output:
        dataPart?.data ?? (textPart ? { text: textPart.text } : undefined),
      costUsd: (result.metadata?.["cost_usd"] as number) ?? 0,
      latencyMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  /**
   * Streaming delegation via A2A message/stream.
   * Returns an async generator yielding DelegationStreamEvent objects.
   */
  async *delegateStream(
    agentUrl: string,
    request: DelegationRequest
  ): AsyncGenerator<DelegationStreamEvent, void, undefined> {
    const startTime = Date.now();
    const params = this.buildA2AParams(request);

    const client = await this.clientFactory.createFromUrl(agentUrl);
    const stream = client.sendMessageStream(params);

    yield* mapA2AStreamToDelegationEvents(
      stream,
      request.agentAppId,
      request.skillId,
      startTime
    );
  }

  // ─── Outcome Reporting (registry REST API) ────────────────

  async reportOutcome(report: OutcomeReport): Promise<void> {
    await this.registryPost(
      `/v1/agent-apps/${report.agentAppId}/report`,
      report
    );
  }

  // ─── Subscriptions (registry REST API) ─────────────────────

  async subscribe(agentAppId: string, planId: string): Promise<Subscription> {
    return this.registryPost<Subscription>("/v1/agent-apps/subscriptions", {
      agentAppId,
      planId,
    });
  }

  async listSubscriptions(): Promise<Subscription[]> {
    return this.registryGet<Subscription[]>("/v1/agent-apps/subscriptions");
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.registryDelete(`/v1/agent-apps/subscriptions/${subscriptionId}`);
  }

  // ─── Usage & Billing (registry REST API) ───────────────────

  async getUsage(): Promise<UsageSummary> {
    return this.registryGet<UsageSummary>("/v1/agent-apps/billing/usage");
  }

  // ─── Delegation History (registry REST API) ────────────────

  async getDelegationHistory(limit = 50): Promise<DelegationResult[]> {
    return this.registryGet<DelegationResult[]>(
      `/v1/agent-apps/delegations?limit=${limit}`
    );
  }
}
