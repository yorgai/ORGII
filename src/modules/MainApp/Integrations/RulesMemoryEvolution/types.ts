/**
 * Automation rule & policy types.
 *
 * Mirrors the Rust types in src-tauri/src/agent_core/automation/types.rs.
 * Actions use the ActionInstance model from the visual workflow editor.
 */
// ── Detail panel state ──
import type { CursorRepo, PolicyInfo, PolicySource } from "@src/hooks/policies";
import type { ActionInstance } from "@src/modules/MainApp/AgentOrgs/data";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";

// ── Trigger types ──

export const TRIGGER_TYPES = [
  "timer",
  "scheduledTime",
  "cron",
  "gitActivity",
  "channelMessage",
  "fileWatch",
  "webhook",
] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const SCHEDULE_FREQUENCIES = ["daily", "weekly", "monthly"] as const;

export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export const SCHEDULE_MONTHLY_MODES = [
  "dayOfMonth",
  "weekdayOfMonth",
  "lastDay",
] as const;

export type ScheduleMonthlyMode = (typeof SCHEDULE_MONTHLY_MODES)[number];

export const WEEK_OF_MONTH_OPTIONS = [
  "first",
  "second",
  "third",
  "fourth",
  "last",
] as const;

export type WeekOfMonth = (typeof WEEK_OF_MONTH_OPTIONS)[number];

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export const SCHEDULE_FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export const SCHEDULE_MONTHLY_MODE_LABELS: Record<ScheduleMonthlyMode, string> =
  {
    dayOfMonth: "Day of month",
    weekdayOfMonth: "Weekday of month",
    lastDay: "Last day of month",
  };

export const WEEK_OF_MONTH_LABELS: Record<WeekOfMonth, string> = {
  first: "First",
  second: "Second",
  third: "Third",
  fourth: "Fourth",
  last: "Last",
};

export const DEFAULT_SCHEDULE_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export const GIT_EVENTS = [
  "commit",
  "push",
  "pull",
  "branchChange",
  "fileChange",
] as const;

export type GitEvent = (typeof GIT_EVENTS)[number];

/** English labels for git events (not localized). */
export const GIT_EVENT_LABELS: Record<GitEvent, string> = {
  commit: "Commit",
  push: "Push",
  pull: "Pull",
  branchChange: "Branch Change",
  fileChange: "File Change",
};

export interface TimerTrigger {
  type: "timer";
  intervalSecs: number;
}

export interface ScheduledTimeTrigger {
  type: "scheduledTime";
  frequency: ScheduleFrequency;
  time: string;
  timezone: string;
  daysOfWeek?: Weekday[];
  monthlyMode?: ScheduleMonthlyMode;
  dayOfMonth?: number;
  weekOfMonth?: WeekOfMonth;
  weekdayOfMonth?: Weekday;
}

export interface CronTrigger {
  type: "cron";
  expression: string;
}

export interface GitActivityTrigger {
  type: "gitActivity";
  events: GitEvent[];
  repoFilter?: string | null;
}

export interface ChannelMessageTrigger {
  type: "channelMessage";
  channel: string;
  pattern?: string;
}

export interface FileWatchTrigger {
  type: "fileWatch";
  paths: string[];
  debounceMs: number;
}

export interface WebhookTrigger {
  type: "webhook";
  route: string;
}
export type AutomationTrigger =
  | TimerTrigger
  | ScheduledTimeTrigger
  | CronTrigger
  | GitActivityTrigger
  | ChannelMessageTrigger
  | FileWatchTrigger
  | WebhookTrigger;

// ── Rule scope ──

export const RULE_SCOPE_MODES = ["all", "specific"] as const;

export type RuleScopeMode = (typeof RULE_SCOPE_MODES)[number];

export interface RuleScope {
  mode: RuleScopeMode;
  /** Repo IDs when mode is "specific" (include list) */
  repoIds: string[];
  /** Repo IDs to exclude from the rule (optional) */
  excludeRepoIds?: string[];
}

// ── Rule ──

/**
 * Note on `scope` and `agentId`:
 * The Rust executor in `agent_core/integrations/automation/scheduler.rs`
 * fires every enabled rule on its trigger; it does not filter triggers
 * by repo scope and does not route the dispatched action to a specific
 * `agentId`. Both fields are persisted (see Rust
 * `AutomationRule.extra` serde-flatten passthrough) so they survive
 * round-trips and the wizard remembers them, but enabling them as
 * runtime gates is a separate (larger) feature.
 */
export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  /** Multi-action chain built with the visual workflow editor. */
  actions: ActionInstance[];
  scope?: RuleScope;
  cooldownSecs?: number;
  maxFires?: number;
  fireCount: number;
  lastFired?: string;
  /** ID of the single assigned agent (built-in, custom, or CLI). null = any agent. */
  agentId?: string | null;
}

// ── Markdown rules (cursor-style .md rules) ──

export interface AgentMarkdownRule {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
}

// ── Rule kind ──

export const RULE_KINDS = ["rule", "automation"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

// ── Engine status ──

export interface AutomationStatus {
  running: boolean;
  activeRules: number;
  totalRules: number;
  totalFires: number;
  uptimeSecs: number;
  agentAlive: boolean;
  messagesProcessed: number;
  lastHealthCheck: string;
}

export interface RulesMemoryEvolutionDetailState {
  selectedMarkdownRule: PolicyInfo | undefined;
  selectedAutomationRule: AutomationRule | undefined;
  selectedRuleContent: string;
  wizardMode: boolean;
  editingRule: AutomationRule | undefined;
  editingMarkdownRule: PolicyInfo | undefined;
  editingMarkdownContent: string;
  agents: AgentDefinition[];
  onClose: () => void;
  onWizardSave: (rule: AutomationRule) => void;
  onSaveMarkdownRule: (data: {
    name: string;
    content: string;
    source: PolicySource;
    agents: string[];
    isNew: boolean;
    scopeMode?: RuleScopeMode;
    scopeRepoIds?: string[];
    repoPath?: string;
  }) => void;
  /** Editing rule's include scope as repo IDs (resolved from backend paths). */
  editingScopeRepoIds: string[];
  onWizardCancel: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDeleteMarkdownRule: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onToggleMarkdownRule: (enabled: boolean) => void;
  readRule: (
    name: string,
    source: PolicySource,
    overridePath?: string
  ) => Promise<string>;
  cursorRepos?: CursorRepo[];
  /**
   * Notifies the parent screen after the external-import wizard
   * successfully copies at least one item, so it can refresh its
   * policy list.
   */
  onAfterImport?: () => void | Promise<void>;
}
