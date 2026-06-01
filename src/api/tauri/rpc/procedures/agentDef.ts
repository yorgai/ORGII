import { defineProcedure } from "../invoke";
import * as schemas from "../schemas";

export const agentDef = {
  listAll: defineProcedure("agent_definitions_list_all")
    .output(schemas.agentDef.AgentDefinitionsListSchema)
    .build(),

  get: defineProcedure("agent_def_get")
    .input(schemas.agentDef.AgentDefGetInput)
    .output(schemas.agentDef.AgentDefinitionSchema)
    .build(),

  commandRiskRulesDefault: defineProcedure("agent_command_risk_rules_default")
    .output(schemas.agentDef.CommandRiskRulesSchema)
    .build(),

  updatePatch: defineProcedure("agent_def_update_patch")
    .input(schemas.agentDef.AgentDefUpdatePatchInput)
    .output(schemas.agentDef.AgentDefinitionSchema)
    .build(),

  resetBuiltin: defineProcedure("agent_def_reset_builtin")
    .input(schemas.agentDef.AgentDefGetInput)
    .output(schemas.agentDef.AgentDefinitionSchema)
    .build(),

  /** Add a new custom agent definition. Returns the newly-assigned id. */
  add: defineProcedure("agent_definitions_add")
    .input(schemas.agentDef.AgentDefAddInput)
    .output(schemas.agentDef.AgentDefAddOutput)
    .build(),

  /** Wholesale-replace an existing agent definition (custom or built-in). */
  update: defineProcedure("agent_definitions_update")
    .input(schemas.agentDef.AgentDefUpdateInput)
    .output(schemas.agentDef.AgentDefinitionSchema)
    .build(),

  /** Remove a custom agent definition by id. Returns true if deleted. */
  remove: defineProcedure("agent_definitions_remove")
    .input(schemas.agentDef.AgentDefRemoveInput)
    .output(schemas.agentDef.AgentDefRemoveOutput)
    .build(),
} as const;
