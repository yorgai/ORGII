import type { AvailableAgent } from "@src/config/cliAgents";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";
import type {
  AutomationTrigger,
  RuleScopeMode,
} from "@src/modules/MainApp/Integrations/RulesMemoryEvolution/types";

export interface TriggerConfigState {
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger | null;
  cooldownSecs?: number;
  maxFires?: number;
  /** ID of the single assigned agent, or null for "any agent" */
  agentId: string | null;
  scopeMode: RuleScopeMode;
  scopeRepoIds: string[];
  scopeExcludeRepoIds?: string[];
}

export interface AutomationTriggerConfigProps {
  state: TriggerConfigState;
  onChange: (state: TriggerConfigState) => void;
  /** Available built-in + custom agents */
  agents?: AgentDefinition[];
  /** Installed CLI agents (Cursor, Claude Code, etc.) */
  cliAgents?: AvailableAgent[];
}

export interface PathRow {
  idx: number;
  path: string;
}
