import { invoke } from "@tauri-apps/api/core";

import { asError } from "../result";
import type { Err, Json, Result } from "../types";

export function createMcpHelpers() {
  const mcpListServers = async (
    workspacePath?: string | null
  ): Promise<Result<{ servers: Json[] }>> => {
    try {
      const servers = (await invoke("mcp_list_servers", {
        workspacePath: workspacePath ?? null,
      })) as Json[];
      return { ok: true, servers };
    } catch (err) {
      return asError(err);
    }
  };

  const mcpGetConfig = async (
    scope?: "global" | "workspace" | null,
    workspacePath?: string | null
  ): Promise<Result<{ config: Json }>> => {
    try {
      const config = (await invoke("mcp_get_config", {
        workspacePath: workspacePath ?? null,
        scope: scope ?? null,
      })) as Json;
      return { ok: true, config };
    } catch (err) {
      return asError(err);
    }
  };

  const mcpUpdateServers = async (
    config: Json,
    scope?: "global" | "workspace" | null,
    workspacePath?: string | null
  ): Promise<{ ok: true } | Err> => {
    try {
      await invoke("mcp_update_servers", {
        workspacePath: workspacePath ?? null,
        config,
        scope: scope ?? null,
      });
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  const mcpTestServer = async (
    serverName: string,
    config: Json
  ): Promise<Result<{ result: Json }>> => {
    try {
      const result = (await invoke("mcp_test_server", {
        serverName,
        config,
      })) as Json;
      return { ok: true, result };
    } catch (err) {
      return asError(err);
    }
  };

  const mcpListServerTools = async (
    serverName: string
  ): Promise<Result<{ tools: Json[] }>> => {
    try {
      const tools = (await invoke("mcp_list_server_tools", {
        serverName,
      })) as Json[];
      return { ok: true, tools };
    } catch (err) {
      return asError(err);
    }
  };

  const mcpReconnectServer = async (
    serverName: string
  ): Promise<{ ok: true } | Err> => {
    try {
      await invoke("mcp_reconnect_server", { serverName });
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  const mcpSetServerDisabled = async (
    serverName: string,
    disabled: boolean,
    workspacePath?: string | null
  ): Promise<{ ok: true } | Err> => {
    try {
      await invoke("mcp_set_server_disabled", {
        serverName,
        disabled,
        workspacePath: workspacePath ?? null,
      });
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  return {
    mcpListServers,
    mcpGetConfig,
    mcpUpdateServers,
    mcpTestServer,
    mcpListServerTools,
    mcpReconnectServer,
    mcpSetServerDisabled,
  };
}
