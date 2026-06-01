import { z } from "zod/v4";

import { defineProcedure } from "../invoke";
import * as schemas from "../schemas";

export const mcp = {
  listServers: defineProcedure("mcp_list_servers")
    .input(schemas.mcp.McpListServersInput)
    .output(z.array(schemas.mcp.McpServerStatusSchema))
    .build(),

  updateServers: defineProcedure("mcp_update_servers")
    .input(schemas.mcp.McpUpdateServersInput)
    .build(),

  testServer: defineProcedure("mcp_test_server")
    .input(schemas.mcp.McpTestServerInput)
    .output(schemas.mcp.McpTestResultSchema)
    .build(),

  listServerTools: defineProcedure("mcp_list_server_tools")
    .input(schemas.mcp.McpServerNameInput)
    .output(z.array(schemas.mcp.McpToolDefSchema))
    .build(),

  reconnectServer: defineProcedure("mcp_reconnect_server")
    .input(schemas.mcp.McpServerNameInput)
    .build(),

  setServerDisabled: defineProcedure("mcp_set_server_disabled")
    .input(schemas.mcp.McpSetServerDisabledInput)
    .build(),

  bulkSetDisabled: defineProcedure("mcp_bulk_set_disabled")
    .input(schemas.mcp.McpBulkSetDisabledInput)
    .output(schemas.mcp.McpBulkResultSchema)
    .build(),

  bulkReconnect: defineProcedure("mcp_bulk_reconnect")
    .input(schemas.mcp.McpBulkServerNamesInput)
    .output(schemas.mcp.McpBulkResultSchema)
    .build(),

  getConfig: defineProcedure("mcp_get_config")
    .input(schemas.mcp.McpGetConfigInput)
    .output(schemas.mcp.McpConfigFileSchema)
    .build(),

  listResources: defineProcedure("mcp_list_resources")
    .input(schemas.mcp.McpServerNameInput)
    .output(z.array(schemas.mcp.McpResourceSchema))
    .build(),

  readResource: defineProcedure("mcp_read_resource")
    .input(schemas.mcp.McpReadResourceInput)
    .output(z.array(schemas.mcp.McpResourceContentSchema))
    .build(),

  listResourceTemplates: defineProcedure("mcp_list_resource_templates")
    .input(schemas.mcp.McpServerNameInput)
    .output(z.array(schemas.mcp.McpResourceTemplateSchema))
    .build(),

  listPrompts: defineProcedure("mcp_list_prompts")
    .input(schemas.mcp.McpServerNameInput)
    .output(z.array(schemas.mcp.McpPromptSchema))
    .build(),

  listAllPrompts: defineProcedure("mcp_list_all_prompts")
    .output(z.array(schemas.mcp.McpPromptEntrySchema))
    .build(),

  getPrompt: defineProcedure("mcp_get_prompt")
    .input(schemas.mcp.McpGetPromptInput)
    .output(schemas.mcp.McpPromptRenderedSchema)
    .build(),

  renderPrompt: defineProcedure("mcp_render_prompt")
    .input(schemas.mcp.McpRenderPromptInput)
    .output(z.string())
    .build(),
} as const;
