import { z } from "zod/v4";

import { defineProcedure } from "../invoke";
import * as schemas from "../schemas";

export type {
  CursorPluginHook,
  CursorPluginInfo,
  CursorPluginSkill,
} from "../schemas/agentOrgs";

const cursor = {
  readConfig: defineProcedure("cursor_cli_config_read")
    .output(schemas.agentOrgs.ConfigRecordSchema)
    .build(),
  writeConfigPartial: defineProcedure("cursor_cli_config_write_partial")
    .input(schemas.agentOrgs.ConfigPartialInput)
    .build(),
  readSandbox: defineProcedure("cursor_sandbox_config_read")
    .output(schemas.agentOrgs.ConfigRecordSchema)
    .build(),
  writeSandboxPartial: defineProcedure("cursor_sandbox_config_write_partial")
    .input(schemas.agentOrgs.ConfigPartialInput)
    .build(),
  getPath: defineProcedure("cursor_cli_config_get_path")
    .output(z.string())
    .build(),
  readRaw: defineProcedure("cursor_cli_config_read_raw")
    .output(z.string())
    .build(),
  writeRaw: defineProcedure("cursor_cli_config_write_raw")
    .input(schemas.agentOrgs.RawConfigWriteInput)
    .build(),
  listPlugins: defineProcedure("cursor_plugins_list")
    .output(z.array(schemas.agentOrgs.CursorPluginInfoSchema))
    .build(),
} as const;

const codex = {
  readConfig: defineProcedure("codex_config_read")
    .output(schemas.agentOrgs.ConfigRecordSchema)
    .build(),
  writeConfigPartial: defineProcedure("codex_config_write_partial")
    .input(schemas.agentOrgs.ConfigPartialInput)
    .build(),
  getPath: defineProcedure("codex_config_get_path").output(z.string()).build(),
  readRaw: defineProcedure("codex_config_read_raw").output(z.string()).build(),
  writeRaw: defineProcedure("codex_config_write_raw")
    .input(schemas.agentOrgs.RawConfigWriteInput)
    .build(),
} as const;

const claudeCode = {
  readConfig: defineProcedure("claude_code_config_read")
    .output(schemas.agentOrgs.ConfigRecordSchema)
    .build(),
  writeConfigPartial: defineProcedure("claude_code_config_write_partial")
    .input(schemas.agentOrgs.ConfigPartialInput)
    .build(),
  getPath: defineProcedure("claude_code_config_get_path")
    .output(z.string())
    .build(),
  readRaw: defineProcedure("claude_code_config_read_raw")
    .output(z.string())
    .build(),
  writeRaw: defineProcedure("claude_code_config_write_raw")
    .input(schemas.agentOrgs.RawConfigWriteInput)
    .build(),
} as const;

const skills = {
  list: defineProcedure("skills_list")
    .input(schemas.agentOrgs.SkillsListInput)
    .output(schemas.agentOrgs.SkillsListSchema)
    .build(),
  read: defineProcedure("skills_read")
    .input(schemas.agentOrgs.SkillReadInput)
    .output(z.string())
    .build(),
  toggle: defineProcedure("skills_toggle")
    .input(schemas.agentOrgs.SkillToggleInput)
    .build(),
} as const;

const memory = {
  personalWorkspace: defineProcedure("project_personal_workspace")
    .output(z.string())
    .build(),
} as const;

const orgs = {
  list: defineProcedure("agent_orgs_list")
    .output(z.array(schemas.agentOrgs.OrgMemberSchema))
    .build(),
  add: defineProcedure("agent_orgs_add")
    .input(schemas.agentOrgs.OrgJsonInput)
    .build(),
  update: defineProcedure("agent_orgs_update")
    .input(schemas.agentOrgs.OrgJsonInput)
    .build(),
  remove: defineProcedure("agent_orgs_remove")
    .input(schemas.agentOrgs.OrgIdInput)
    .build(),
} as const;

export const agentOrgs = {
  availableCliAgents: defineProcedure("get_available_agents")
    .output(schemas.agentOrgs.AvailableCliAgentsSchema)
    .build(),
  cursor,
  codex,
  claudeCode,
  memory,
  orgs,
  skills,
} as const;
