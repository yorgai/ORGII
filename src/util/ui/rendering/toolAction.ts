const BROWSER_CLI_TOOLS = new Set([
  "control_browser_with_agent_browser",
  "control_browser_with_playwright",
]);

export function isBrowserCliTool(toolName: string): boolean {
  return BROWSER_CLI_TOOLS.has(toolName);
}

function firstCommandToken(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/^([^\s"']+|"[^"]+"|'[^']+')/);
  const token = match?.[0]?.replace(/^['"]|['"]$/g, "");
  return token && token.length > 0 ? token : undefined;
}

export function formatBrowserCliCommandTarget(
  action: string,
  command: string
): string {
  const trimmed = command.trim();
  if (!trimmed) return "";
  const remainder = trimmed.slice(action.length).trim();
  if (remainder.length === 0) return action;
  return remainder.length > 60 ? `${remainder.substring(0, 60)}...` : remainder;
}

export function deriveToolAction(
  toolName: string,
  args: Record<string, unknown> | undefined
): string | undefined {
  if (!args) return undefined;

  const explicitAction = args.action;
  if (typeof explicitAction === "string" && explicitAction.trim().length > 0) {
    return explicitAction.trim();
  }

  const actionType = args.action_type;
  if (typeof actionType === "string" && actionType.trim().length > 0) {
    return actionType.trim();
  }

  if (isBrowserCliTool(toolName)) {
    const command = args.command;
    if (typeof command === "string") return firstCommandToken(command);
  }

  return undefined;
}
