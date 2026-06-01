/**
 * A2A Server
 *
 * Express-based A2A server using @a2a-js/sdk server components.
 * Dispatches incoming requests to registered skill handlers with
 * Zod schema validation and SSE streaming support.
 */
import type { AgentCard, Artifact, Message, Task } from "@a2a-js/sdk";
import {
  type AgentExecutor,
  DefaultRequestHandler,
  type ExecutionEventBus,
  InMemoryTaskStore,
  RequestContext,
} from "@a2a-js/sdk/server";
import {
  UserBuilder,
  agentCardHandler,
  jsonRpcHandler,
} from "@a2a-js/sdk/server/express";
import type { Express } from "express";
import { v4 as uuidv4 } from "uuid";

import type {
  HandlerContext,
  MarketplaceCard,
  SkillContract,
  SkillDefinition,
  SkillHandler,
  SkillHandlerResult,
  StreamingSkillHandler,
} from "./types.js";
import { validateInput, validateOutput } from "./validation.js";

interface RegisteredSkill {
  definition: SkillDefinition;
  contract: SkillContract;
}

/**
 * Builds an A2A AgentCard from our MarketplaceCard.
 * The AgentCard is the A2A-standard discovery format;
 * our MarketplaceCard extends it with pricing/trust/reputation.
 */
function buildAgentCard(
  card: MarketplaceCard,
  capabilities: { streaming: boolean }
): AgentCard {
  return {
    name: card.name,
    description: card.description,
    url: card.agentUrl,
    version: card.version,
    protocolVersion: "0.3",
    capabilities: {
      streaming: capabilities.streaming,
      pushNotifications: false,
    },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: card.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: skill.tags,
    })),
    provider: {
      organization: card.creatorName,
      url: card.agentUrl,
    },
    ...(card.iconUrl ? { iconUrl: card.iconUrl } : {}),
  };
}

/**
 * Extracts skill_id and input from an A2A user message.
 */
function extractSkillRequest(userMessage: Message): {
  skillId: string | undefined;
  input: Record<string, unknown>;
  constraints?: HandlerContext["constraints"];
} {
  for (const part of userMessage.parts ?? []) {
    if (part.kind === "data") {
      const data = (part as { kind: "data"; data: Record<string, unknown> })
        .data;
      return {
        skillId: data["skill_id"] as string | undefined,
        input: (data["input"] as Record<string, unknown>) ?? {},
        constraints: data["constraints"] as HandlerContext["constraints"],
      };
    }
  }
  return { skillId: undefined, input: {} };
}

/**
 * Creates the AgentExecutor that dispatches to registered skill handlers.
 */
function createSkillExecutor(
  skills: Map<string, RegisteredSkill>,
  pricePerCall: number
): AgentExecutor {
  return {
    async execute(
      requestContext: RequestContext,
      eventBus: ExecutionEventBus
    ): Promise<void> {
      const { skillId, input, constraints } = extractSkillRequest(
        requestContext.userMessage
      );

      const handlerContext: HandlerContext = {
        taskId: requestContext.taskId,
        contextId: requestContext.contextId,
        constraints,
      };

      if (!skillId) {
        const errorTask: Task = {
          kind: "task",
          id: requestContext.taskId,
          contextId: requestContext.contextId,
          status: {
            state: "failed",
            message: {
              kind: "message",
              messageId: uuidv4(),
              role: "agent",
              parts: [{ kind: "text", text: "Missing skill_id in request" }],
            },
          },
        };
        eventBus.publish(errorTask);
        eventBus.finished();
        return;
      }

      const registered = skills.get(skillId);
      if (!registered) {
        const errorTask: Task = {
          kind: "task",
          id: requestContext.taskId,
          contextId: requestContext.contextId,
          status: {
            state: "failed",
            message: {
              kind: "message",
              messageId: uuidv4(),
              role: "agent",
              parts: [{ kind: "text", text: `Unknown skill: ${skillId}` }],
            },
          },
        };
        eventBus.publish(errorTask);
        eventBus.finished();
        return;
      }

      const { definition } = registered;

      try {
        const validatedInput = validateInput(definition.inputSchema, input);

        // Publish "working" status
        eventBus.publish({
          kind: "status-update",
          taskId: requestContext.taskId,
          contextId: requestContext.contextId,
          status: { state: "working" },
          final: false,
        });

        // Check if we have a streaming handler
        if (definition.streamHandler) {
          await executeStreamingHandler(
            definition.streamHandler,
            definition,
            validatedInput as Record<string, unknown>,
            handlerContext,
            requestContext,
            eventBus,
            pricePerCall
          );
        } else {
          await executeSyncHandler(
            definition.handler,
            definition,
            validatedInput as Record<string, unknown>,
            handlerContext,
            requestContext,
            eventBus,
            pricePerCall
          );
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorTask: Task = {
          kind: "task",
          id: requestContext.taskId,
          contextId: requestContext.contextId,
          status: {
            state: "failed",
            message: {
              kind: "message",
              messageId: uuidv4(),
              role: "agent",
              parts: [{ kind: "text", text: errorMessage }],
            },
          },
        };
        eventBus.publish(errorTask);
        eventBus.finished();
      }
    },

    async cancelTask(
      taskId: string,
      eventBus: ExecutionEventBus
    ): Promise<void> {
      eventBus.publish({
        kind: "status-update",
        taskId,
        contextId: taskId,
        status: { state: "canceled" },
        final: true,
      });
      eventBus.finished();
    },
  };
}

async function executeSyncHandler(
  handler: SkillHandler,
  definition: SkillDefinition,
  input: Record<string, unknown>,
  handlerContext: HandlerContext,
  requestContext: RequestContext,
  eventBus: ExecutionEventBus,
  pricePerCall: number
): Promise<void> {
  const result = await handler(input, handlerContext);
  const validatedOutput = validateOutput(
    definition.outputSchema,
    result.output
  );

  const artifact: Artifact = {
    artifactId: uuidv4(),
    name: `${definition.id}-result`,
    parts: [{ kind: "data", data: validatedOutput as Record<string, unknown> }],
  };

  const completedTask: Task = {
    kind: "task",
    id: requestContext.taskId,
    contextId: requestContext.contextId,
    status: { state: "completed" },
    artifacts: [artifact],
    metadata: {
      confidence: result.confidence,
      cost_usd: pricePerCall,
    },
  };

  eventBus.publish(completedTask);
  eventBus.finished();
}

async function executeStreamingHandler(
  handler: StreamingSkillHandler,
  definition: SkillDefinition,
  input: Record<string, unknown>,
  handlerContext: HandlerContext,
  requestContext: RequestContext,
  eventBus: ExecutionEventBus,
  pricePerCall: number
): Promise<void> {
  const generator = handler(input, handlerContext);
  const artifactId = uuidv4();
  let finalResult: SkillHandlerResult | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const iteration = await generator.next();

    if (iteration.done) {
      finalResult = iteration.value;
      break;
    }

    const chunk = iteration.value;

    // Emit artifact-update for each chunk
    eventBus.publish({
      kind: "artifact-update",
      taskId: requestContext.taskId,
      contextId: requestContext.contextId,
      artifact: {
        artifactId,
        name: `${definition.id}-stream`,
        parts: [{ kind: "data", data: chunk.data }],
      },
      append: true,
      lastChunk: chunk.isFinal ?? false,
    });
  }

  // Validate and emit final result
  if (finalResult) {
    const validatedOutput = validateOutput(
      definition.outputSchema,
      finalResult.output
    );

    const finalArtifact: Artifact = {
      artifactId,
      name: `${definition.id}-result`,
      parts: [
        { kind: "data", data: validatedOutput as Record<string, unknown> },
      ],
    };

    const completedTask: Task = {
      kind: "task",
      id: requestContext.taskId,
      contextId: requestContext.contextId,
      status: { state: "completed" },
      artifacts: [finalArtifact],
      metadata: {
        confidence: finalResult.confidence,
        cost_usd: pricePerCall,
      },
    };

    eventBus.publish(completedTask);
  }

  eventBus.finished();
}

// ─── Public API ──────────────────────────────────────────────

export interface MarketplaceServer {
  /** The marketplace card for this agent app. */
  card: MarketplaceCard;
  /** The A2A agent card. */
  agentCard: AgentCard;
  /** The A2A request handler. */
  requestHandler: DefaultRequestHandler;
  /** Mount A2A routes on an Express app. */
  mountOn(app: Express, basePath?: string): void;
}

export function createMarketplaceServer(
  card: MarketplaceCard,
  skills: Map<string, RegisteredSkill>
): MarketplaceServer {
  const hasStreamHandlers = Array.from(skills.values()).some(
    (skill) => skill.definition.streamHandler != null
  );

  const a2aAgentCard = buildAgentCard(card, {
    streaming: hasStreamHandlers,
  });

  const taskStore = new InMemoryTaskStore();
  const executor = createSkillExecutor(skills, card.pricing.pricePerCall ?? 0);

  const requestHandler = new DefaultRequestHandler(
    a2aAgentCard,
    taskStore,
    executor
  );

  return {
    card,
    agentCard: a2aAgentCard,
    requestHandler,

    mountOn(app: Express, basePath = ""): void {
      const cardPath = basePath
        ? `${basePath}/.well-known/agent-card.json`
        : "/.well-known/agent-card.json";

      const healthPath = basePath ? `${basePath}/health` : "/health";
      const rpcPath = basePath || "/";

      app.get(healthPath, (_req, res) => {
        res.json({
          status: "ok",
          agent: card.name,
          version: card.version,
          skills: Array.from(skills.keys()),
          uptime: process.uptime(),
        });
      });

      app.get(
        cardPath,
        agentCardHandler({ agentCardProvider: requestHandler })
      );

      app.post(
        rpcPath,
        jsonRpcHandler({
          requestHandler,
          userBuilder: UserBuilder.noAuthentication,
        })
      );
    },
  };
}

export { type RegisteredSkill };
