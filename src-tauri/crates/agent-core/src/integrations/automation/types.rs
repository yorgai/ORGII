//! Automation data types.
//!
//! Defines the rule, trigger, and action types for the automation engine.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// A single automation rule: one trigger → one action, with optional cooldown/max-fires.
///
/// The `extra` catch-all preserves frontend-only fields (`scope`,
/// `agentId`) that the routine wizard sets but the scheduler does
/// not currently consume. Capturing them via `serde(flatten)` makes
/// every rule round-trip through Rust persistence verbatim, so the
/// wizard's reload reads back exactly what the user saved.
/// Wiring those fields into the executor is a separate feature.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRule {
    /// Unique rule ID.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Whether this rule is active.
    pub enabled: bool,
    /// What fires this rule.
    pub trigger: AutomationTrigger,
    /// What happens when the rule fires.
    pub action: AutomationAction,
    /// Minimum seconds between firings (None = no cooldown).
    #[serde(default)]
    pub cooldown_secs: Option<u64>,
    /// Maximum total firings (None = unlimited).
    #[serde(default)]
    pub max_fires: Option<u32>,
    /// Runtime counter: how many times this rule has fired.
    #[serde(default)]
    pub fire_count: u64,
    /// When this rule last fired.
    #[serde(default)]
    pub last_fired: Option<DateTime<Utc>>,
    /// Frontend-only fields (`scope`, `agentId`) round-tripped
    /// untouched. Never inspected by the scheduler.
    #[serde(flatten, default)]
    pub extra: Map<String, Value>,
}

impl AutomationRule {
    /// Check if the rule can fire (cooldown + max_fires guards).
    pub fn can_fire(&self) -> bool {
        if !self.enabled {
            return false;
        }
        if let Some(max) = self.max_fires {
            if self.fire_count >= max as u64 {
                return false;
            }
        }
        if let Some(cooldown) = self.cooldown_secs {
            if let Some(last) = self.last_fired {
                let elapsed = (Utc::now() - last).num_seconds().max(0) as u64;
                if elapsed < cooldown {
                    return false;
                }
            }
        }
        true
    }

    /// Record a firing.
    pub fn record_fire(&mut self) {
        self.fire_count += 1;
        self.last_fired = Some(Utc::now());
    }
}

/// Trigger types that can fire an automation rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AutomationTrigger {
    /// Periodic interval timer.
    #[serde(rename_all = "camelCase")]
    Timer { interval_secs: u64 },
    /// Wall-clock scheduled time in a named timezone.
    #[serde(rename_all = "camelCase")]
    ScheduledTime {
        frequency: ScheduleFrequency,
        time: String,
        timezone: String,
        #[serde(default)]
        days_of_week: Vec<ScheduleWeekday>,
        #[serde(default)]
        monthly_mode: Option<ScheduleMonthlyMode>,
        #[serde(default)]
        day_of_month: Option<u8>,
        #[serde(default)]
        week_of_month: Option<WeekOfMonth>,
        #[serde(default)]
        weekday_of_month: Option<ScheduleWeekday>,
    },
    /// Cron expression (replaces cron service).
    #[serde(rename_all = "camelCase")]
    Cron { expression: String },
    /// Git repository activity.
    #[serde(rename_all = "camelCase")]
    GitActivity {
        events: Vec<GitEvent>,
        #[serde(default)]
        repo_filter: Option<String>,
    },
    /// Message on a specific channel matching an optional pattern.
    #[serde(rename_all = "camelCase")]
    ChannelMessage {
        channel: String,
        pattern: Option<String>,
    },
    /// File system changes (debounced).
    #[serde(rename_all = "camelCase")]
    FileWatch {
        paths: Vec<String>,
        debounce_ms: u64,
    },
    /// Inbound webhook.
    #[serde(rename_all = "camelCase")]
    Webhook { route: String },
}

/// Scheduled wall-clock recurrence frequency.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScheduleFrequency {
    Daily,
    Weekly,
    Monthly,
}

/// Monthly recurrence mode for scheduled triggers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScheduleMonthlyMode {
    DayOfMonth,
    WeekdayOfMonth,
    LastDay,
}

/// Week ordinal inside a month for scheduled triggers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WeekOfMonth {
    First,
    Second,
    Third,
    Fourth,
    Last,
}

/// Days that can be selected for weekly scheduled triggers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScheduleWeekday {
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday,
}

/// Git events that can trigger a rule.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitEvent {
    Commit,
    Push,
    Pull,
    BranchChange,
    FileChange,
}

/// Actions that an automation rule can execute.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AutomationAction {
    /// Inject a prompt into the agent bus.
    #[serde(rename_all = "camelCase")]
    InjectPrompt {
        prompt: String,
        session_id: Option<String>,
    },
    /// Start a new coding agent session.
    #[serde(rename_all = "camelCase")]
    StartSession {
        agent_type: String,
        prompt: String,
        model: Option<String>,
        repo_path: Option<String>,
    },
    /// Kill an existing session.
    #[serde(rename_all = "camelCase")]
    KillSession { session_id: String },
    /// Send a message to a channel.
    #[serde(rename_all = "camelCase")]
    SendMessage { channel: String, content: String },
    /// Inject a message into a specific session.
    #[serde(rename_all = "camelCase")]
    InjectToSession { session_id: String, message: String },
    /// Execute a visual workflow action chain.
    #[serde(rename_all = "camelCase")]
    Workflow {
        actions: Vec<WorkflowActionInstance>,
    },
}

/// A visual workflow action instance persisted by the routine editor.
///
/// The Rust executor (`execute_workflow_action` in `actions.rs`) only
/// reads `id`, `definition_id`, and `data` — it iterates the workflow
/// linearly. Any additional fields the frontend visual editor writes
/// (e.g. `branchType`, `parentIfId`, `parentLoopId`, `nestingLevel` for
/// the if/loop layout) are captured by the `extra` catch-all so they
/// round-trip through persistence unchanged without Rust having to know
/// about them. This keeps render-only metadata strictly frontend-owned
/// while preserving editor reload fidelity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowActionInstance {
    pub id: String,
    pub definition_id: String,
    #[serde(default)]
    pub data: Map<String, Value>,
    /// Frontend-only render metadata (branch/loop layout, nesting,
    /// etc.). Captured verbatim so saves preserve the visual editor's
    /// state; never inspected by the Rust runtime.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[cfg(test)]
#[path = "tests/types_tests.rs"]
mod tests;

/// Runtime status of the automation engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationStatus {
    /// Whether the automation engine is running.
    pub running: bool,
    /// Number of active (enabled) rules.
    pub active_rules: usize,
    /// Total rules (enabled + disabled).
    pub total_rules: usize,
    /// Total firings across all rules.
    pub total_fires: u64,
    /// Seconds since the engine started.
    pub uptime_secs: u64,
    /// Whether the agent loop is alive.
    pub agent_alive: bool,
    /// Total messages processed by the agent.
    pub messages_processed: u64,
    /// ISO 8601 timestamp of the last health check.
    pub last_health_check: String,
}
