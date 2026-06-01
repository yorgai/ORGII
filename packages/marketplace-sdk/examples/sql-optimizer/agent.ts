/**
 * Example: SQL Optimizer Agent App
 *
 * Demonstrates how to create a marketplace agent app using the builder API.
 * Run with: npm start (or npx tsx agent.ts)
 */
import { createMarketplaceAgent } from "@orgii/marketplace-sdk";
import { z } from "zod";

const OptimizeInputSchema = z.object({
  query: z.string().describe("The SQL query to optimize"),
  engine: z
    .enum(["postgres", "mysql", "sqlite"])
    .describe("Target database engine"),
  explain: z.boolean().optional().describe("Whether to include EXPLAIN output"),
});

const OptimizeOutputSchema = z.object({
  optimized_query: z.string(),
  explanation: z.string(),
  estimated_speedup: z.number(),
  suggestions: z.array(z.string()),
});

const AnalyzeInputSchema = z.object({
  tables: z.array(z.string()).describe("Table names to analyze"),
  engine: z.enum(["postgres", "mysql", "sqlite"]),
});

const AnalyzeOutputSchema = z.object({
  report: z.string(),
  issues: z.number(),
  recommendations: z.array(z.string()),
});

const agent = createMarketplaceAgent({
  name: "SQL Optimizer Pro",
  description:
    "Analyzes and rewrites SQL queries for better performance. Supports PostgreSQL, MySQL, and SQLite.",
  version: "2.1.0",
  category: "database",
  pricing: { model: "per_call", pricePerCall: 0.002, currency: "USD" },
  creatorName: "ORGII Labs",
  tags: ["sql", "optimization", "database", "performance"],
});

agent.skill({
  id: "optimize-query",
  name: "Query Optimization",
  description:
    "Analyzes a SQL query and returns an optimized version with explanations.",
  tags: ["sql", "rewrite", "performance"],
  inputSchema: OptimizeInputSchema,
  outputSchema: OptimizeOutputSchema,
  handler: async (input, context) => {
    console.log(
      `[${context.taskId}] Optimizing ${input.engine} query (${input.query.length} chars)`
    );

    const optimized = input.query
      .replace(/SELECT \*/g, "SELECT id, name")
      .replace(/WHERE 1=1 AND/g, "WHERE");

    return {
      output: {
        optimized_query: optimized,
        explanation: `Replaced SELECT * with specific columns, removed redundant WHERE clauses. Engine: ${input.engine}.`,
        estimated_speedup: 2.4,
        suggestions: [
          "Add index on frequently filtered columns",
          "Consider partitioning large tables",
          input.explain ? "Run EXPLAIN ANALYZE for actual timing" : "",
        ].filter(Boolean),
      },
      confidence: 0.87,
    };
  },
});

agent.skill({
  id: "analyze-schema",
  name: "Schema Analysis",
  description: "Deep analysis of database schema with recommendations.",
  tags: ["schema", "analysis"],
  inputSchema: AnalyzeInputSchema,
  outputSchema: AnalyzeOutputSchema,
  handler: async (input, context) => {
    console.log(
      `[${context.taskId}] Analyzing ${input.tables.length} tables on ${input.engine}`
    );

    return {
      output: {
        report: `Analyzed ${input.tables.length} tables: ${input.tables.join(", ")}. Found potential N+1 query patterns and missing indexes.`,
        issues: input.tables.length * 2,
        recommendations: input.tables.map(
          (table) => `Add composite index on ${table}(created_at, status)`
        ),
      },
      confidence: 0.91,
    };
  },
  streamHandler: async function* (input) {
    for (const table of input.tables) {
      yield {
        data: { status: "analyzing", table },
        isFinal: false,
      };
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return {
      output: {
        report: `Analyzed ${input.tables.length} tables. Found issues.`,
        issues: input.tables.length * 2,
        recommendations: input.tables.map(
          (table) => `Add index on ${table}(created_at)`
        ),
      },
      confidence: 0.91,
    };
  },
});

const { url, port } = await agent.listen({ port: 8400 });
console.log(`SQL Optimizer Pro running at ${url} (port ${port})`);
console.log(`  Health:     ${url}/health`);
console.log(`  Agent Card: ${url}/.well-known/agent-card.json`);
console.log(`  Skills:     optimize-query, analyze-schema`);
console.log(`\nPress Ctrl+C to stop.`);
