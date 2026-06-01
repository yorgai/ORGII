import { z } from "zod/v4";

import { defineProcedure } from "../invoke";
import * as schemas from "../schemas";

export const tools = {
  toggleChannel: defineProcedure("agent_toggle_channel")
    .input(schemas.tools.AgentToggleChannelInput)
    .build(),

  setGatewayModel: defineProcedure("agent_set_gateway_model")
    .input(schemas.tools.AgentSetGatewayModelInput)
    .build(),

  checkKeys: defineProcedure("agent_check_keys")
    .input(schemas.tools.AgentCheckKeysInput)
    .output(schemas.tools.CheckKeysResultSchema)
    .build(),

  listAllTools: defineProcedure("list_all_tools")
    .output(z.array(schemas.tools.ToolInfoSchema))
    .build(),

  listAgentTools: defineProcedure("agent_list_tools")
    .output(z.array(schemas.tools.ToolInfoSchema))
    .build(),

  listEffectiveToolsForSession: defineProcedure(
    "agent_list_effective_tools_for_session"
  )
    .input(schemas.tools.EffectiveToolsRequestSchema)
    .output(schemas.tools.EffectiveToolsResponseSchema)
    .build(),

  initToolRegistry: defineProcedure("init_tool_registry")
    .output(schemas.tools.ToolRegistryDataSchema)
    .build(),

  probeChannel: defineProcedure("agent_probe_channel")
    .input(schemas.tools.AgentProbeChannelInput)
    .output(z.unknown())
    .build(),
} as const;
