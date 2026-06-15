//! Risk classification constants and command classifier.

use serde::{Deserialize, Serialize};

use super::{normalize_command_pipeline, skip_env_assignments, CommandRiskLevel};

/// User-configurable command risk patterns.
///
/// Entries match either a base command (`wget`), a base command plus first
/// subcommand (`git clean`), or a longer token pattern (`git push --force`).
/// The command token must match the executed base command; the first additional
/// pattern token must match the first command argument, while later tokens may
/// appear in order after it. This allows flag-focused patterns to match commands
/// such as `git push origin main --force` without making `git status --force push`
/// look like a dangerous push.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRiskRules {
    #[serde(default = "default_medium_risk_patterns")]
    pub medium: Vec<String>,
    #[serde(default = "default_high_risk_patterns")]
    pub high: Vec<String>,
}

impl Default for CommandRiskRules {
    fn default() -> Self {
        Self {
            medium: default_medium_risk_patterns(),
            high: default_high_risk_patterns(),
        }
    }
}

pub fn default_medium_risk_patterns() -> Vec<String> {
    [
        "rm -rf",
        "rm -fr",
        "rm -Rf",
        "rm -r -f",
        "dd",
        "reboot",
        "halt",
        "poweroff",
        "su",
        "wget",
        "nc",
        "ncat",
        "ssh",
        "scp",
        "ftp",
        "telnet",
        "git clean",
        "git reset --hard",
        "git push --force",
        "git push --force-with-lease",
        "git push --delete",
        "git branch -D",
        "git stash drop",
        "git stash clear",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

pub fn default_high_risk_patterns() -> Vec<String> {
    ["sudo", "shutdown"].into_iter().map(String::from).collect()
}

/// Commands with irreversible external side effects that require explicit user
/// confirmation when no full `SecurityPolicy` is wired.
const CONFIRMATION_REQUIRED: &[(&str, &[&str])] = &[
    ("git", &["push"]),
    ("gh", &["pr", "issue", "release"]),
    ("npm", &["publish"]),
    ("yarn", &["publish"]),
    ("pnpm", &["publish"]),
    ("cargo", &["publish"]),
    ("twine", &["upload"]),
    ("pip", &["upload"]),
];

/// Check if a command string contains a subcommand that requires user
/// confirmation before execution. Returns a human-readable reason string.
pub fn requires_user_confirmation(command: &str) -> Option<String> {
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

        for &(cmd, subcommands) in CONFIRMATION_REQUIRED {
            if base_cmd == cmd && parts.len() >= 2 {
                let sub = parts[1];
                if subcommands.contains(&sub) {
                    return Some(format!(
                        "\"{}\" has external side effects and requires your approval.",
                        crate::utils::safe_truncate_chars(trimmed, 120).to_string()
                    ));
                }
            }
        }
    }
    None
}

/// Classify a single command segment by risk level.
pub fn classify_command_with_rules(
    base_cmd: &str,
    full_segment: &str,
    rules: &CommandRiskRules,
) -> CommandRiskLevel {
    if full_segment.contains(":(){ :|:") || full_segment.contains(":(){:|:") {
        return CommandRiskLevel::High;
    }

    let lower = full_segment.to_lowercase();
    if lower.contains("rm -rf /") || lower.contains("rm -rf /*") {
        return CommandRiskLevel::High;
    }

    let parts: Vec<&str> = full_segment.split_whitespace().collect();
    if risk_patterns_match(&rules.high, base_cmd, &parts) {
        return CommandRiskLevel::High;
    }
    if risk_patterns_match(&rules.medium, base_cmd, &parts) {
        return CommandRiskLevel::Medium;
    }

    CommandRiskLevel::Low
}

fn risk_patterns_match(patterns: &[String], base_cmd: &str, command_parts: &[&str]) -> bool {
    patterns
        .iter()
        .any(|pattern| command_pattern_matches(pattern, base_cmd, command_parts))
}

pub(crate) fn command_pattern_matches(
    pattern: &str,
    base_cmd: &str,
    command_parts: &[&str],
) -> bool {
    let pattern_parts: Vec<&str> = pattern.split_whitespace().collect();
    let Some(pattern_cmd) = pattern_parts.first() else {
        return false;
    };
    if *pattern_cmd != base_cmd {
        return false;
    }
    if pattern_parts.len() == 1 {
        return true;
    }

    if command_parts.get(1) != pattern_parts.get(1) {
        return false;
    }

    let mut search_from = 2;
    for pattern_token in &pattern_parts[2..] {
        let Some(relative_pos) = command_parts[search_from..]
            .iter()
            .position(|command_token| command_token == pattern_token)
        else {
            return false;
        };
        search_from += relative_pos + 1;
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_medium_pattern_matches_subcommand() {
        let rules = CommandRiskRules {
            medium: vec!["git push".to_string()],
            high: Vec::new(),
        };

        assert_eq!(
            classify_command_with_rules("git", "git push origin main", &rules),
            CommandRiskLevel::Medium
        );
        assert_eq!(
            classify_command_with_rules("git", "git status", &rules),
            CommandRiskLevel::Low
        );
    }

    #[test]
    fn configured_medium_pattern_matches_flag_after_arguments() {
        let rules = CommandRiskRules {
            medium: vec!["git push --force".to_string()],
            high: Vec::new(),
        };

        assert_eq!(
            classify_command_with_rules("git", "git push origin main --force", &rules),
            CommandRiskLevel::Medium
        );
    }

    #[test]
    fn configured_medium_pattern_does_not_match_subcommand_later() {
        let rules = CommandRiskRules {
            medium: vec!["git push --force".to_string()],
            high: Vec::new(),
        };

        assert_eq!(
            classify_command_with_rules("git", "git status --force push", &rules),
            CommandRiskLevel::Low
        );
    }

    #[test]
    fn rm_without_force_recursive_is_low_risk_by_default() {
        assert_eq!(
            classify_command_with_rules("rm", "rm README.md", &CommandRiskRules::default()),
            CommandRiskLevel::Low
        );
    }

    #[test]
    fn rm_force_recursive_is_medium_risk_by_default() {
        assert_eq!(
            classify_command_with_rules("rm", "rm -r dist -f", &CommandRiskRules::default()),
            CommandRiskLevel::Medium
        );
    }

    #[test]
    fn configured_high_pattern_overrides_medium_pattern() {
        let rules = CommandRiskRules {
            medium: vec!["git push".to_string()],
            high: vec!["git push".to_string()],
        };

        assert_eq!(
            classify_command_with_rules("git", "git push origin main", &rules),
            CommandRiskLevel::High
        );
    }

    #[test]
    fn base_command_pattern_matches_any_subcommand() {
        let rules = CommandRiskRules {
            medium: Vec::new(),
            high: vec!["curl".to_string()],
        };

        assert_eq!(
            classify_command_with_rules("curl", "curl https://example.com", &rules),
            CommandRiskLevel::High
        );
    }
}
