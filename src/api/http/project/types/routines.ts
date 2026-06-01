export interface WorkItemSchedule {
  /** One-time trigger: ISO 8601 timestamp */
  at?: string;
  /** Recurring trigger: cron expression (e.g. "0 18 * * 3" = every Wed 6pm) */
  cron?: string;
  enabled: boolean;
  /** Last time a cron schedule fired (ISO 8601), used for dedup */
  last_run?: string;
}

export type RoutineTrigger =
  | { kind: "one_time"; at: string }
  | { kind: "cron"; cron: string };

export type RoutineFireStatus = "pending" | "started" | "failed";
export type RoutineRunTarget =
  | { kind: "agent_definition"; agentDefinitionId?: string }
  | { kind: "agent_org"; agentOrgId: string };

export interface RoutineResourceSelection {
  keySource?: string;
  accountId?: string;
  model?: string;
  nativeHarnessType?: string;
}

export type RoutineWorkspaceTarget =
  | { kind: "none" }
  | {
      kind: "local_workspace";
      workspacePath: string;
      additionalDirectories: string[];
    }
  | {
      kind: "worktree";
      workspacePath: string;
      worktreePath?: string;
      branch?: string;
      createIsolated: boolean;
      additionalDirectories: string[];
    };

export interface RoutineRunTemplate {
  prompt: string;
  target: RoutineRunTarget;
  resources: RoutineResourceSelection;
  workspace: RoutineWorkspaceTarget;
  mode?: string;
  name?: string;
}

export interface RoutineDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: RoutineTrigger;
  runTemplate: RoutineRunTemplate;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineFire {
  id: string;
  routineId: string;
  firedAt: string;
  status: RoutineFireStatus;
  sessionId?: string;
  agentOrgRunId?: string;
  error?: string;
}

export interface WorkItemRoutineSource {
  routineId: string;
  routineFireId: string;
  routineName: string;
  firedAt: string;
}

export interface RoutineFireResult {
  fire: RoutineFire;
  sessionId: string;
  agentOrgRunId?: string;
}
