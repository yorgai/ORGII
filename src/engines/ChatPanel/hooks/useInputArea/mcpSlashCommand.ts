/**
 * MCP slash-command resolver.
 *
 * Detects `/mcp__<server>__<prompt> [arg1 arg2 ...]` at the start of a
 * user message and resolves it to the server-rendered prompt text via
 * `mcp_render_prompt`. Mirrors Claude Code's
 * `getPromptForCommand({ name, arguments })` pipeline where the slash
 * command is replaced inline before the message is dispatched to the
 * agent.
 *
 * Positional argument parsing: CC splits the tail on whitespace and
 * zip-objects it against the prompt's declared `argNames`. We do the
 * same here — fetch the declared argument list via
 * `mcp_list_all_prompts` so we can map positional tokens to names.
 * Missing positional arguments are simply omitted (CC's behavior:
 * `zipObject(argNames, argsArray)` drops names whose index is past
 * `argsArray.length`).
 */
import { rpc } from "@src/api/tauri/rpc";

const MCP_PREFIX = "mcp__";

export interface McpSlashMatch {
  serverName: string;
  promptName: string;
  args: string[];
  trailing: string;
}

/**
 * Parse `/mcp__<server>__<prompt> [tail]` out of a message.
 * Returns `null` when the input doesn't start with a well-formed MCP
 * slash command — so plain text, non-MCP slash commands, and malformed
 * input all pass through untouched.
 */
export function parseMcpSlashCommand(text: string): McpSlashMatch | null {
  if (!text.startsWith("/")) return null;
  const firstSpace = text.indexOf(" ");
  const nameToken =
    firstSpace === -1 ? text.slice(1) : text.slice(1, firstSpace);
  if (!nameToken.startsWith(MCP_PREFIX)) return null;

  // `mcp__server__promptname` — server and prompt names must both exist.
  // A prompt whose own name contains `__` is allowed (we split on the
  // FIRST `__` after `mcp__`, and keep the rest as the prompt name).
  const body = nameToken.slice(MCP_PREFIX.length);
  const sep = body.indexOf("__");
  if (sep <= 0 || sep >= body.length - 2) return null;

  const serverName = body.slice(0, sep);
  const promptName = body.slice(sep + 2);

  const tail = firstSpace === -1 ? "" : text.slice(firstSpace + 1).trim();
  const args = tail.length > 0 ? tail.split(/\s+/) : [];

  return { serverName, promptName, args, trailing: tail };
}

/**
 * Resolve an MCP slash command to the rendered prompt body.
 *
 * Returns `null` when `text` isn't an MCP slash command; otherwise
 * returns the rendered prompt string ready to send as a message.
 *
 * Throws when the server/prompt is known but the round-trip fails, so
 * callers can surface the error to the user instead of silently
 * sending `/mcp__...` to the agent as if it were plain text.
 */
export async function resolveMcpSlashCommand(
  text: string
): Promise<string | null> {
  const match = parseMcpSlashCommand(text);
  if (!match) return null;

  const declaredArgNames = await fetchDeclaredArgNames(
    match.serverName,
    match.promptName
  );

  const argObject: Record<string, string> = {};
  for (
    let i = 0;
    i < declaredArgNames.length && i < match.args.length;
    i += 1
  ) {
    argObject[declaredArgNames[i]] = match.args[i];
  }

  return rpc.mcp.renderPrompt({
    serverName: match.serverName,
    promptName: match.promptName,
    arguments: Object.keys(argObject).length > 0 ? argObject : undefined,
  });
}

async function fetchDeclaredArgNames(
  serverName: string,
  promptName: string
): Promise<string[]> {
  const prompts = await rpc.mcp.listPrompts({ serverName });
  const entry = prompts.find((p) => p.name === promptName);
  return entry?.arguments.map((a) => a.name) ?? [];
}
