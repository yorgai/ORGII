//! Security policy for command and path validation.
//!
//! Provides defense-in-depth for tool execution using a blacklist + confirmation model:
//! - `blocked_commands`: Always denied (blacklist)
//! - `confirmation_commands`: Require user approval via PermissionCard
//! - Risk classification for additional safety checks
//! - Rate limiting and path traversal prevention

mod paths;
mod risk;

pub use risk::{
    default_high_risk_patterns, default_medium_risk_patterns, requires_user_confirmation,
    CommandRiskRules,
};

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

use self::risk::{classify_command_with_rules, command_pattern_matches};
use super::tracker::ActionTracker;

/// Normalize shell pipeline/chain separators to \x00 for segment splitting.
///
/// Replaces `&&`, `||`, newlines, `;`, and `|` so callers can `.split('\x00')`
/// to iterate individual sub-commands.
pub(crate) fn normalize_command_pipeline(command: &str) -> String {
    command
        .replace("&&", "\x00")
        .replace("||", "\x00")
        .replace(['\n', ';', '|'], "\x00")
}

// ============================================
// Enums
// ============================================

/// Agent autonomy level — controls what the agent can do without approval.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AutonomyLevel {
    /// Can observe but not mutate files or run shell commands.
    ReadOnly,
    /// Can read, write, and run commands within command-policy bounds.
    #[default]
    Full,
}

impl AutonomyLevel {
    pub fn ask_tools(&self) -> Vec<String> {
        Vec::new()
    }

    /// Tool names blocked by the selected access mode.
    pub fn deny_tools(&self) -> Vec<String> {
        use crate::tools::names as tn;
        match self {
            Self::ReadOnly => vec![
                tn::RUN_SHELL.to_string(),
                tn::AWAIT_OUTPUT.to_string(),
                tn::EDIT_FILE.to_string(),
                tn::DELETE_FILE.to_string(),
                tn::APPLY_PATCH.to_string(),
            ],
            Self::Full => Vec::new(),
        }
    }
}

/// Risk classification for a shell command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandRiskLevel {
    Low,
    Medium,
    High,
}

/// Result of command validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidationResult {
    /// Command is allowed to execute.
    Allowed(CommandRiskLevel),
    /// Command requires user approval before execution.
    NeedsApproval(CommandRiskLevel, String),
    /// Command is denied.
    Denied(String),
}

// ============================================
// Security Policy
// ============================================

/// Execution-time security policy for agent tools.
///
/// Uses a blacklist + confirmation model:
/// - `blocked_commands`: Always denied
/// - `confirmation_commands`: Require user approval
/// - Always-ask commands: Require approval
/// - Everything else: Allowed within the selected access mode
pub struct SecurityPolicy {
    pub autonomy: AutonomyLevel,
    pub workspace_dir: PathBuf,
    pub workspace_only: bool,
    /// Commands that are always blocked (blacklist). Matches base command name.
    pub blocked_commands: Vec<String>,
    /// Commands requiring user confirmation. Format: "cmd", "cmd subcmd", or
    /// longer token pattern such as "git push --force".
    pub confirmation_commands: Vec<String>,
    pub forbidden_paths: Vec<String>,
    pub max_actions_per_hour: u32,
    pub block_high_risk_commands: bool,
    pub risk_rules: CommandRiskRules,
    tracker: ActionTracker,
    /// Additional directories that are allowed when `workspace_only` is true.
    /// Used to whitelist the IDE's active repo path alongside the agent workspace.
    extra_allowed_dirs: Mutex<Vec<PathBuf>>,
}

impl SecurityPolicy {
    /// Create a new security policy with the given configuration.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        autonomy: AutonomyLevel,
        workspace_dir: PathBuf,
        workspace_only: bool,
        blocked_commands: Vec<String>,
        confirmation_commands: Vec<String>,
        forbidden_paths: Vec<String>,
        max_actions_per_hour: u32,
        block_high_risk_commands: bool,
        risk_rules: CommandRiskRules,
    ) -> Self {
        Self {
            autonomy,
            workspace_dir,
            workspace_only,
            blocked_commands,
            confirmation_commands,
            forbidden_paths,
            max_actions_per_hour,
            block_high_risk_commands,
            risk_rules,
            tracker: ActionTracker::new(),
            extra_allowed_dirs: Mutex::new(Vec::new()),
        }
    }

    /// Create a permissive policy (for testing or full-autonomy mode).
    pub fn permissive(workspace_dir: PathBuf) -> Self {
        Self {
            autonomy: AutonomyLevel::Full,
            workspace_dir,
            workspace_only: false,
            blocked_commands: Vec::new(),
            confirmation_commands: Vec::new(),
            forbidden_paths: Vec::new(),
            max_actions_per_hour: u32::MAX,
            block_high_risk_commands: false,
            risk_rules: CommandRiskRules::default(),
            tracker: ActionTracker::new(),
            extra_allowed_dirs: Mutex::new(Vec::new()),
        }
    }

    // ── Command validation ──

    /// Check if a command is blocked by the blacklist.
    ///
    /// Returns `Err` if the command matches any entry in `blocked_commands`.
    /// Also blocks dangerous shell injection operators.
    pub fn is_command_blocked(&self, command: &str) -> Result<(), String> {
        // ReadOnly blocks everything
        if self.autonomy == AutonomyLevel::ReadOnly {
            return Err("Agent is in read-only mode — command execution is disabled.".into());
        }

        // Block subshell injection operators
        if command.contains('`') {
            return Err("Backtick subshell operators are not allowed.".into());
        }
        if command.contains("$(") {
            return Err("$() subshell operators are not allowed.".into());
        }
        if command.contains("${") {
            return Err("${} parameter expansion is not allowed.".into());
        }

        // If no blocked commands configured, allow all
        if self.blocked_commands.is_empty() {
            return Ok(());
        }

        let normalized = normalize_command_pipeline(command);

        for segment in normalized.split('\x00') {
            let trimmed = segment.trim();
            if trimmed.is_empty() {
                continue;
            }

            // Strip leading env-var assignments (FOO=bar CMD ...)
            let cmd_part = skip_env_assignments(trimmed);
            if cmd_part.is_empty() {
                continue;
            }

            // Extract the base command name (after last /)
            let base_cmd = cmd_part
                .split_whitespace()
                .next()
                .unwrap_or("")
                .rsplit('/')
                .next()
                .unwrap_or("");

            if base_cmd.is_empty() {
                continue;
            }

            // Check if base command is in the blocklist
            if self
                .blocked_commands
                .iter()
                .any(|blocked| blocked == base_cmd)
            {
                return Err(format!(
                    "Command '{}' is blocked by security policy.",
                    base_cmd
                ));
            }
        }

        Ok(())
    }

    /// Check if a command requires user confirmation.
    ///
    /// Returns `Some(reason)` if the command matches any entry in `confirmation_commands`.
    /// Matches "cmd" (any subcommand), "cmd subcmd" (specific subcommand), and
    /// longer token patterns such as "git push --force".
    pub fn requires_confirmation(&self, command: &str) -> Option<String> {
        if self.confirmation_commands.is_empty() {
            return None;
        }

        let normalized = normalize_command_pipeline(command);

        for segment in normalized.split('\x00') {
            let trimmed = segment.trim();
            if trimmed.is_empty() {
                continue;
            }

            let cmd_part = skip_env_assignments(trimmed);
            let parts: Vec<&str> = cmd_part.split_whitespace().collect();
            if parts.is_empty() {
                continue;
            }

            let base_cmd = parts[0].rsplit('/').next().unwrap_or("");

            for confirm_pattern in &self.confirmation_commands {
                if command_pattern_matches(confirm_pattern, base_cmd, &parts) {
                    return Some(format!(
                        "\"{}\" requires confirmation before execution.",
                        trimmed.chars().take(120).collect::<String>()
                    ));
                }
            }
        }

        None
    }

    /// Classify the risk level of a command.
    ///
    /// Returns the highest risk level found across all pipeline segments.
    pub fn command_risk_level(&self, command: &str) -> CommandRiskLevel {
        let normalized = normalize_command_pipeline(command);

        let mut highest = CommandRiskLevel::Low;

        for segment in normalized.split('\x00') {
            let trimmed = segment.trim();
            if trimmed.is_empty() {
                continue;
            }

            let cmd_part = skip_env_assignments(trimmed);
            let base_cmd = cmd_part
                .split_whitespace()
                .next()
                .unwrap_or("")
                .rsplit('/')
                .next()
                .unwrap_or("");

            let risk = classify_command_with_rules(base_cmd, cmd_part, &self.risk_rules);
            if risk == CommandRiskLevel::High {
                return CommandRiskLevel::High; // short-circuit
            }
            if risk == CommandRiskLevel::Medium {
                highest = CommandRiskLevel::Medium;
            }
        }

        highest
    }

    /// Full validation: blocklist + confirmation + risk + autonomy + rate limit.
    ///
    /// Call this before executing any shell command. The `approved` flag
    /// indicates whether the user has already approved this specific command
    /// (for always-ask command policy flows).
    pub fn validate_command_execution(&self, command: &str, approved: bool) -> ValidationResult {
        // Step 1: Check blocklist first — blocked commands are always denied
        if let Err(reason) = self.is_command_blocked(command) {
            return ValidationResult::Denied(reason);
        }

        // Step 2: Check confirmation list — these commands always require approval.
        if !approved {
            if let Some(reason) = self.requires_confirmation(command) {
                let risk = self.command_risk_level(command);
                return ValidationResult::NeedsApproval(risk, reason);
            }
        }

        // Step 3: Classify risk for command-policy checks.
        let risk = self.command_risk_level(command);

        match risk {
            CommandRiskLevel::High => {
                if self.block_high_risk_commands {
                    return ValidationResult::Denied(format!(
                        "Command blocked by security policy: {}",
                        command
                    ));
                }
            }
            CommandRiskLevel::Medium => {
                if !approved {
                    return ValidationResult::NeedsApproval(
                        risk,
                        format!("Command requires approval: {}", command),
                    );
                }
            }
            CommandRiskLevel::Low => {}
        }

        // Step 4: Rate limit check
        match self.tracker.try_record(self.max_actions_per_hour as usize) {
            Ok(_) => ValidationResult::Allowed(risk),
            Err(count) => ValidationResult::Denied(format!(
                "Rate limit exceeded: {} actions in the last hour (max {}).",
                count, self.max_actions_per_hour
            )),
        }
    }

    /// Get a reference to the action tracker.
    ///
    /// Path validation methods (`is_path_allowed`, `is_resolved_path_allowed`,
    /// `add_allowed_dir`) are split into [`policy::paths`].
    pub fn tracker(&self) -> &ActionTracker {
        &self.tracker
    }
}

impl std::fmt::Debug for SecurityPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let extra_count = self
            .extra_allowed_dirs
            .lock()
            .map(|dirs| dirs.len())
            .unwrap_or(0);
        f.debug_struct("SecurityPolicy")
            .field("autonomy", &self.autonomy)
            .field("workspace_dir", &self.workspace_dir)
            .field("workspace_only", &self.workspace_only)
            .field("blocked_commands_count", &self.blocked_commands.len())
            .field(
                "confirmation_commands_count",
                &self.confirmation_commands.len(),
            )
            .field("forbidden_paths_count", &self.forbidden_paths.len())
            .field("max_actions_per_hour", &self.max_actions_per_hour)
            .field("block_high_risk_commands", &self.block_high_risk_commands)
            .field("medium_risk_rules_count", &self.risk_rules.medium.len())
            .field("high_risk_rules_count", &self.risk_rules.high.len())
            .field("extra_allowed_dirs_count", &extra_count)
            .finish()
    }
}

// ============================================
// Helpers
// ============================================

/// Skip leading environment variable assignments in a command segment.
///
/// `FOO=bar BAZ=qux git commit` → `git commit`
pub(crate) fn skip_env_assignments(segment: &str) -> &str {
    let mut rest = segment;
    loop {
        let trimmed = rest.trim_start();
        // Check if the next token looks like VAR=value
        if let Some(eq_pos) = trimmed.find('=') {
            let before_eq = &trimmed[..eq_pos];
            // Must be a valid identifier (alphanumeric + underscore, not starting with digit)
            if !before_eq.is_empty()
                && before_eq
                    .chars()
                    .all(|ch| ch.is_alphanumeric() || ch == '_')
                && !before_eq.starts_with(|ch: char| ch.is_ascii_digit())
            {
                // Skip past the value (next whitespace-delimited token)
                let after_eq = &trimmed[eq_pos + 1..];
                // Value might be quoted
                if let Some(after_dq) = after_eq.strip_prefix('"') {
                    if let Some(end_quote) = after_dq.find('"') {
                        rest = &after_dq[end_quote + 1..];
                        continue;
                    }
                } else if let Some(after_sq) = after_eq.strip_prefix('\'') {
                    if let Some(end_quote) = after_sq.find('\'') {
                        rest = &after_sq[end_quote + 1..];
                        continue;
                    }
                }
                // Unquoted value: skip to next whitespace
                match after_eq.find(char::is_whitespace) {
                    Some(ws_pos) => {
                        rest = &after_eq[ws_pos..];
                        continue;
                    }
                    None => return "", // entire segment is env assignments
                }
            }
        }
        return trimmed;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readonly_denies_write_tools() {
        let tools = AutonomyLevel::ReadOnly.deny_tools();
        assert!(tools.contains(&"run_shell".to_string()));
        assert!(tools.contains(&"edit_file".to_string()));
        assert!(tools.contains(&"apply_patch".to_string()));
    }

    #[test]
    fn read_write_ask_and_deny_tools_empty() {
        assert!(AutonomyLevel::Full.ask_tools().is_empty());
        assert!(AutonomyLevel::Full.deny_tools().is_empty());
    }

    #[test]
    fn default_autonomy_is_full() {
        assert_eq!(AutonomyLevel::default(), AutonomyLevel::Full);
    }

    #[test]
    fn full_autonomy_still_requires_confirmation_list_approval() {
        let policy = SecurityPolicy::new(
            AutonomyLevel::Full,
            std::env::temp_dir(),
            false,
            Vec::new(),
            vec!["git push".to_string()],
            Vec::new(),
            100,
            false,
            CommandRiskRules::default(),
        );

        assert!(matches!(
            policy.validate_command_execution("git push origin main", false),
            ValidationResult::NeedsApproval(_, _)
        ));
    }

    #[test]
    fn custom_risk_rules_classify_always_ask_command() {
        let policy = SecurityPolicy::new(
            AutonomyLevel::Full,
            std::env::temp_dir(),
            false,
            Vec::new(),
            Vec::new(),
            Vec::new(),
            100,
            false,
            CommandRiskRules {
                medium: vec!["git status".to_string()],
                high: Vec::new(),
            },
        );

        assert!(matches!(
            policy.validate_command_execution("git status", false),
            ValidationResult::NeedsApproval(CommandRiskLevel::Medium, _)
        ));
    }

    #[test]
    fn confirmation_patterns_match_flags_after_arguments() {
        let policy = SecurityPolicy::new(
            AutonomyLevel::Full,
            std::env::temp_dir(),
            false,
            Vec::new(),
            vec!["git push --force".to_string()],
            Vec::new(),
            100,
            false,
            CommandRiskRules {
                medium: Vec::new(),
                high: Vec::new(),
            },
        );

        assert!(matches!(
            policy.validate_command_execution("git push origin main --force", false),
            ValidationResult::NeedsApproval(_, _)
        ));
        assert!(matches!(
            policy.validate_command_execution("git push origin main", false),
            ValidationResult::Allowed(CommandRiskLevel::Low)
        ));
    }

    #[test]
    fn custom_risk_rules_classify_high_command() {
        let policy = SecurityPolicy::new(
            AutonomyLevel::Full,
            std::env::temp_dir(),
            false,
            Vec::new(),
            Vec::new(),
            Vec::new(),
            100,
            true,
            CommandRiskRules {
                medium: Vec::new(),
                high: vec!["git status".to_string()],
            },
        );

        assert!(matches!(
            policy.validate_command_execution("git status", false),
            ValidationResult::Denied(_)
        ));
    }
}
