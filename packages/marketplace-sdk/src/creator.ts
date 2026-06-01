/**
 * Agent App Creator
 *
 * Builder-pattern API for creating marketplace agent apps.
 * Wraps the A2A server with skill registration, Zod validation,
 * Express HTTP server, and optional registry auto-registration.
 */
import type { Server } from "node:http";
import type { infer as ZodInfer, ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  type MarketplaceServer,
  type RegisteredSkill,
  createMarketplaceServer,
} from "./server.js";
import type {
  AgentAppConfig,
  ListenOptions,
  MarketplaceCard,
  ReputationSummary,
  SkillContract,
  SkillDefinition,
  SkillHandler,
  SlaConfig,
  StreamingSkillHandler,
} from "./types.js";

/**
 * Typed skill registration — TInput is inferred from inputSchema.
 */
interface SkillRegistration<TInput = Record<string, unknown>> {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  inputSchema: ZodType<TInput>;
  outputSchema: ZodType;
  sla?: SlaConfig;
  handler: SkillHandler<TInput>;
  streamHandler?: StreamingSkillHandler<TInput>;
}

const EMPTY_REPUTATION: ReputationSummary = {
  score: 0,
  totalDelegations: 0,
  successRate: 0,
  averageLatencyMs: 0,
  lastUpdated: new Date().toISOString(),
};

export class AgentBuilder {
  private readonly config: AgentAppConfig;
  private readonly skills = new Map<string, RegisteredSkill>();
  private server: MarketplaceServer | null = null;
  private httpServer: Server | null = null;
  private registeredId: string | null = null;

  constructor(config: AgentAppConfig) {
    this.config = config;
  }

  /**
   * Register a skill with Zod schemas and handler(s).
   * The handler's `input` parameter is strongly typed from `inputSchema`.
   */
  skill<TInput>(registration: SkillRegistration<TInput>): this {
    const contract: SkillContract = {
      id: registration.id,
      name: registration.name,
      description: registration.description,
      inputSchema: zodToJsonSchema(
        registration.inputSchema,
        registration.id + "-input"
      ),
      outputSchema: zodToJsonSchema(
        registration.outputSchema,
        registration.id + "-output"
      ),
      tags: registration.tags ?? [],
    };

    const definition: SkillDefinition = {
      id: registration.id,
      name: registration.name,
      description: registration.description,
      tags: registration.tags,
      inputSchema: registration.inputSchema,
      outputSchema: registration.outputSchema,
      sla: registration.sla,
      handler: registration.handler as SkillHandler,
      streamHandler: registration.streamHandler as
        | StreamingSkillHandler
        | undefined,
    };

    this.skills.set(registration.id, { definition, contract });
    return this;
  }

  /**
   * Build the MarketplaceCard from config and registered skills.
   */
  private buildCard(agentUrl: string): MarketplaceCard {
    const now = new Date().toISOString();
    const contracts = Array.from(this.skills.values()).map(
      (skill) => skill.contract
    );

    return {
      id: this.registeredId ?? "",
      name: this.config.name,
      description: this.config.description,
      version: this.config.version,
      agentUrl,
      category: this.config.category,
      skills: contracts,
      pricing: this.config.pricing,
      trust: this.config.trust ?? { level: "unverified" },
      sla: this.config.sla,
      reputation: EMPTY_REPUTATION,
      creatorId: "",
      creatorName: this.config.creatorName,
      iconUrl: this.config.iconUrl,
      tags: this.config.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Start the A2A server and optionally register with the marketplace registry.
   */
  async listen(options: ListenOptions = {}): Promise<{
    card: MarketplaceCard;
    port: number;
    url: string;
  }> {
    const port = options.port ?? 8400;
    const agentUrl = `http://localhost:${port}`;
    const card = this.buildCard(agentUrl);

    this.server = createMarketplaceServer(card, this.skills);

    // Dynamic import of express (peer dependency)
    const expressModule = await import("express");
    const expressFn = (expressModule.default ?? expressModule) as {
      (): import("express").Express;
      json(): import("express").RequestHandler;
    };
    const app = expressFn();
    app.use(expressFn.json());

    this.server.mountOn(app);

    // Error-handling middleware for malformed requests (JSON parse errors, etc.)
    app.use(
      (
        err: unknown,
        _req: import("express").Request,
        res: import("express").Response,
        _next: import("express").NextFunction
      ) => {
        const isSyntaxError = err instanceof SyntaxError && "body" in err;
        const statusCode = isSyntaxError ? 400 : 500;
        const message =
          err instanceof Error ? err.message : "Internal server error";

        res.status(statusCode).json({
          jsonrpc: "2.0",
          error: {
            code: isSyntaxError ? -32700 : -32603,
            message: isSyntaxError ? "Parse error" : "Internal error",
            data: message,
          },
          id: null,
        });
      }
    );

    // Start HTTP server
    await new Promise<void>((resolve) => {
      this.httpServer = app.listen(port, () => resolve());
    });

    // Auto-register with registry if URL provided
    if (options.registry) {
      await this.registerWithRegistry(
        options.registry,
        options.authToken,
        card
      );
    }

    return { card: this.server.card, port, url: agentUrl };
  }

  private async registerWithRegistry(
    registryUrl: string,
    authToken: string | undefined,
    card: MarketplaceCard
  ): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${registryUrl}/v1/agent-apps`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: card.name,
        description: card.description,
        version: card.version,
        agentUrl: card.agentUrl,
        category: card.category,
        skills: card.skills,
        pricing: card.pricing,
        trust: card.trust,
        sla: card.sla,
        creatorName: card.creatorName,
        iconUrl: card.iconUrl,
        tags: card.tags,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Registry registration failed (${response.status}): ${body}`
      );
    }

    const registered = (await response.json()) as { id?: string };
    if (registered.id) {
      this.registeredId = registered.id;
    }
  }

  /**
   * Gracefully stop the server.
   */
  async stop(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => (err ? reject(err) : resolve()));
      });
      this.httpServer = null;
    }
    this.server = null;
  }

  /**
   * Get the current marketplace card (available after listen()).
   */
  getCard(): MarketplaceCard | null {
    return this.server?.card ?? null;
  }
}

/**
 * Create a marketplace agent app with the builder pattern.
 *
 * @example
 * ```ts
 * const agent = createMarketplaceAgent({
 *   name: "SQL Optimizer Pro",
 *   version: "2.1.0",
 *   category: "database",
 *   pricing: { model: "per_call", pricePerCall: 0.002, currency: "USD" },
 *   creatorName: "ORGII Labs",
 * });
 *
 * agent.skill({
 *   id: "optimize-query",
 *   name: "Query Optimization",
 *   description: "Rewrites SQL queries for better performance.",
 *   inputSchema: z.object({ query: z.string(), engine: z.string() }),
 *   outputSchema: z.object({ optimized_query: z.string(), explanation: z.string() }),
 *   handler: async (input, context) => ({
 *     // input is typed as { query: string; engine: string }
 *     // context has taskId, contextId, constraints
 *     output: { optimized_query: "...", explanation: "..." },
 *     confidence: 0.95,
 *   }),
 * });
 *
 * const { url, port } = await agent.listen({ port: 8400 });
 * ```
 */
export function createMarketplaceAgent(config: AgentAppConfig): AgentBuilder {
  return new AgentBuilder(config);
}
