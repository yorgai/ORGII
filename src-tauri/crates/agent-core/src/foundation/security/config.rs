//! Security policy configuration (shared across all agent sessions).

use serde::{Deserialize, Serialize};

use super::policy::CommandRiskRules;

/// Security policy configuration for agent tool execution.
///
/// Uses blocked base commands plus risk classification for approval/denial.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityConfig {
    /// Agent access mode: "readonly" or "full".
    #[serde(default)]
    pub autonomy: super::AutonomyLevel,
    /// If true, restrict file/shell access to workspace directory only.
    #[serde(default = "app_utils::default_true")]
    pub workspace_only: bool,
    /// Commands that are always blocked (blacklist). Matches base command name.
    #[serde(default = "default_blocked_commands")]
    pub blocked_commands: Vec<String>,
    /// Additional explicit confirmation patterns; built-in approvals come from risk rules.
    #[serde(default)]
    pub confirmation_commands: Vec<String>,
    /// Forbidden filesystem paths (absolute or ~/relative).
    #[serde(default = "default_forbidden_paths")]
    pub forbidden_paths: Vec<String>,
    /// Whether to block high-risk commands entirely.
    #[serde(default = "app_utils::default_true")]
    pub block_high_risk_commands: bool,
    /// User-configurable medium/high risk command classification rules.
    #[serde(default)]
    pub risk_rules: CommandRiskRules,
}

fn default_blocked_commands() -> Vec<String> {
    vec!["sudo", "shutdown"]
        .into_iter()
        .map(String::from)
        .collect()
}

fn default_forbidden_paths() -> Vec<String> {
    Vec::new()
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            autonomy: super::AutonomyLevel::Full,
            workspace_only: true,
            blocked_commands: default_blocked_commands(),
            confirmation_commands: Vec::new(),
            forbidden_paths: default_forbidden_paths(),
            block_high_risk_commands: true,
            risk_rules: CommandRiskRules::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_autonomy_defaults_to_full() {
        let config: SecurityConfig = serde_json::from_value(serde_json::json!({})).unwrap();

        assert_eq!(config.autonomy, super::super::AutonomyLevel::Full);
    }

    #[test]
    fn missing_risk_rules_use_builtin_defaults() {
        let config: SecurityConfig = serde_json::from_value(serde_json::json!({})).unwrap();

        assert!(config
            .risk_rules
            .medium
            .contains(&"git reset --hard".to_string()));
        assert!(config.risk_rules.high.contains(&"sudo".to_string()));
    }
}
