import type { CliAgentType } from "@src/api/tauri/rpc/schemas/validation";
import type { DispatchCategory } from "@src/api/tauri/session";
import type { SessionTargetKind } from "@src/store/session/creatorStateAtom";

import type { BasePaletteProps } from "../../shared";

export interface AgentSelection {
  category: DispatchCategory;
  targetKind: SessionTargetKind;
  agentDefinitionId?: string;
  agentOrgId?: string;
  cliAgentType?: CliAgentType;
  agentName: string;
  agentIconId?: string;
}

export interface DispatchCategoryPaletteProps extends BasePaletteProps {
  onSelect: (selection: AgentSelection) => void;
  currentCategory?: DispatchCategory;
  currentAgentDefinitionId?: string;
  currentAgentOrgId?: string;
  currentCliAgentType?: CliAgentType;
  /**
   * When true the Agent Orgs group is omitted entirely. Used by member-row
   * pickers inside an org panel where selecting another org makes no sense.
   */
  hideOrgs?: boolean;
  /**
   * Optional context pill rendered above the input — used by callers that
   * pre-select a target (e.g. an org member row clicking its agent pill)
   * so the palette title reflects what is being chosen for.
   */
  titleLabel?: string;
  /** Icon paired with `titleLabel`. Defaults to no icon when omitted. */
  titleIcon?: React.ComponentType<Record<string, unknown>>;
  /** Optional placeholder override for contextual picker copy. */
  placeholderLabel?: string;
}
