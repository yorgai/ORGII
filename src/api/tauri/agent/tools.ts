/**
 * Agent Tools API
 *
 * Tool registry, channel control, and key checking.
 */
import { rpc } from "@src/api/tauri/rpc";

export async function toggleChannel(
  channelType: string,
  accountId: string,
  enabled: boolean
): Promise<void> {
  return rpc.tools.toggleChannel({
    channelType,
    accountId,
    enabled,
  });
}

export async function setGatewayModel(
  accountId: string | null,
  model: string | null
): Promise<void> {
  return rpc.tools.setGatewayModel({ accountId, model });
}

export async function listAllTools(): Promise<
  Array<{ name: string; description: string; category: string }>
> {
  const tools = await rpc.tools.listAllTools();
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    category: tool.category,
  }));
}

export async function listAgentTools<T = unknown>(): Promise<T[]> {
  return rpc.tools.listAgentTools() as Promise<T[]>;
}

export async function initToolRegistry(): Promise<void> {
  await rpc.tools.initToolRegistry();
}

export async function checkKeys(model: string): Promise<{
  found: boolean;
  provider?: string | null;
  providerName?: string | null;
  error?: string;
}> {
  return rpc.tools.checkKeys({ model });
}

export async function probeChannel<T = unknown>(
  channelType: string,
  credentials: Record<string, unknown>
): Promise<T> {
  return rpc.tools.probeChannel({
    channelType,
    credentials,
  }) as Promise<T>;
}
