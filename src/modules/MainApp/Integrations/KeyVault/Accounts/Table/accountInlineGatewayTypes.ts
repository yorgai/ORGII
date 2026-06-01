export const GATEWAY_AGENT_TYPES: ReadonlySet<string> = new Set<string>([
  "azure_openai_api",
  "azure_anthropic_api",
  "vllm_api",
]);

export function isGatewayWithNoModels(account: {
  modelType: string;
  status: string;
  availableModels?: readonly string[] | null;
}): boolean {
  return (
    GATEWAY_AGENT_TYPES.has(account.modelType) &&
    account.status === "ready" &&
    (account.availableModels?.length ?? 0) === 0
  );
}
