/**
 * Example: Client consuming the SQL Optimizer agent
 *
 * Start the agent first (npm start), then run this client (npm run client).
 */
import { MarketplaceClient } from "@orgii/marketplace-sdk";

const AGENT_URL = "http://localhost:8400";

const client = new MarketplaceClient({
  registryUrl: "http://localhost:8001",
});

console.log("--- Blocking Delegation: optimize-query ---\n");

const result = await client.delegate(AGENT_URL, {
  agentAppId: "example-sql-optimizer",
  skillId: "optimize-query",
  input: {
    query:
      "SELECT * FROM orders WHERE 1=1 AND status = 'active' ORDER BY created_at DESC",
    engine: "postgres",
    explain: true,
  },
  constraints: { maxCostUsd: 0.01, timeoutMs: 5000 },
});

console.log("Status:", result.status);
console.log("Output:", JSON.stringify(result.output, null, 2));
console.log("Cost:", result.costUsd, "USD");
console.log("Latency:", result.latencyMs, "ms");
console.log("Confidence:", result.confidence);

console.log("\n--- Streaming Delegation: analyze-schema ---\n");

const stream = client.delegateStream(AGENT_URL, {
  agentAppId: "example-sql-optimizer",
  skillId: "analyze-schema",
  input: {
    tables: ["users", "orders", "products", "reviews"],
    engine: "postgres",
  },
  constraints: { maxCostUsd: 0.05, timeoutMs: 30000 },
});

for await (const event of stream) {
  switch (event.kind) {
    case "status":
      console.log(`  [status] ${event.status}`);
      break;
    case "artifact":
      console.log(`  [chunk]  ${JSON.stringify(event.data)}`);
      break;
    case "complete":
      console.log(`  [done]   ${JSON.stringify(event.result.output, null, 2)}`);
      break;
    case "error":
      console.error(`  [error]  ${event.error}`);
      break;
  }
}

console.log("\nDone.");
