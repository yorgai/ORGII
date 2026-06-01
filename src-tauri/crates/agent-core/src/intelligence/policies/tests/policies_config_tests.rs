use std::collections::HashMap;

use crate::intelligence::policies::config::{PoliciesConfig, PolicyConfig};

fn config_with(entries: Vec<(&str, bool, Vec<&str>)>) -> PoliciesConfig {
    let mut policies = HashMap::new();
    for (name, disabled, agents) in entries {
        policies.insert(
            name.to_string(),
            PolicyConfig {
                disabled,
                agents: agents.into_iter().map(|s| s.to_string()).collect(),
                ..PolicyConfig::default()
            },
        );
    }
    PoliciesConfig { policies }
}

fn config_with_scope(
    name: &str,
    include: Option<Vec<&str>>,
    exclude: Option<Vec<&str>>,
) -> PoliciesConfig {
    let mut policies = HashMap::new();
    policies.insert(
        name.to_string(),
        PolicyConfig {
            disabled: false,
            agents: vec![],
            scope_repo_paths: include.map(|v| v.into_iter().map(String::from).collect()),
            scope_exclude_repo_paths: exclude.map(|v| v.into_iter().map(String::from).collect()),
        },
    );
    PoliciesConfig { policies }
}

// -- is_disabled --

#[test]
fn is_disabled_unknown_policy() {
    let config = PoliciesConfig::default();
    assert!(!config.is_disabled("nonexistent"));
}

#[test]
fn is_disabled_enabled_policy() {
    let config = config_with(vec![("my-rule", false, vec![])]);
    assert!(!config.is_disabled("my-rule"));
}

#[test]
fn is_disabled_disabled_policy() {
    let config = config_with(vec![("my-rule", true, vec![])]);
    assert!(config.is_disabled("my-rule"));
}

// -- agents_for --

#[test]
fn agents_for_unknown_policy() {
    let config = PoliciesConfig::default();
    assert!(config.agents_for("nonexistent").is_empty());
}

#[test]
fn agents_for_empty_agents() {
    let config = config_with(vec![("rule", false, vec![])]);
    assert!(config.agents_for("rule").is_empty());
}

#[test]
fn agents_for_specific_agents() {
    let config = config_with(vec![("rule", false, vec!["sde-agent", "os-agent"])]);
    let agents = config.agents_for("rule");
    assert_eq!(agents.len(), 2);
    assert!(agents.contains(&"sde-agent".to_string()));
}

// -- applies_to_agent --

#[test]
fn applies_to_agent_unknown_policy() {
    let config = PoliciesConfig::default();
    assert!(config.applies_to_agent("nonexistent", "any-agent"));
}

#[test]
fn applies_to_agent_empty_agents_means_all() {
    let config = config_with(vec![("rule", false, vec![])]);
    assert!(config.applies_to_agent("rule", "sde-agent"));
    assert!(config.applies_to_agent("rule", "os-agent"));
}

#[test]
fn applies_to_agent_specific_match() {
    let config = config_with(vec![("rule", false, vec!["sde-agent"])]);
    assert!(config.applies_to_agent("rule", "sde-agent"));
    assert!(!config.applies_to_agent("rule", "os-agent"));
}

// -- serde --

#[test]
fn serde_round_trip() {
    let config = config_with(vec![("test-rule", true, vec!["agent-1"])]);
    let json = serde_json::to_string(&config).unwrap();
    let parsed: PoliciesConfig = serde_json::from_str(&json).unwrap();
    assert!(parsed.is_disabled("test-rule"));
    assert_eq!(parsed.agents_for("test-rule"), &["agent-1".to_string()]);
}

#[test]
fn deserialize_empty_defaults() {
    let parsed: PoliciesConfig = serde_json::from_str("{}").unwrap();
    assert!(parsed.policies.is_empty());
}

#[test]
fn load_from_missing_file_returns_empty_ok() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rules-config.json");

    let config = PoliciesConfig::load_from_path(&path).expect("missing file is empty config");
    assert!(config.policies.is_empty());
}

#[test]
fn load_from_invalid_json_returns_err_and_preserves_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rules-config.json");
    std::fs::write(&path, "{ invalid json").unwrap();

    let err = PoliciesConfig::load_from_path(&path).expect_err("invalid json must surface");
    assert!(
        err.contains("Failed to parse policies config"),
        "got: {}",
        err
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ invalid json");
}

// -- applies_to_repo --

#[test]
fn applies_to_repo_unknown_policy_applies_everywhere() {
    let config = PoliciesConfig::default();
    assert!(config.applies_to_repo("nonexistent", Some("/repo/a")));
    assert!(config.applies_to_repo("nonexistent", None));
}

#[test]
fn applies_to_repo_no_scope_applies_everywhere() {
    let config = config_with(vec![("rule", false, vec![])]);
    assert!(config.applies_to_repo("rule", Some("/repo/a")));
    assert!(config.applies_to_repo("rule", None));
}

#[test]
fn applies_to_repo_include_only_matches_listed_paths() {
    let config = config_with_scope("rule", Some(vec!["/repo/a", "/repo/b"]), None);
    assert!(config.applies_to_repo("rule", Some("/repo/a")));
    assert!(config.applies_to_repo("rule", Some("/repo/b")));
    assert!(!config.applies_to_repo("rule", Some("/repo/c")));
}

#[test]
fn applies_to_repo_exclude_only_blocks_listed_paths() {
    let config = config_with_scope("rule", None, Some(vec!["/repo/c"]));
    assert!(config.applies_to_repo("rule", Some("/repo/a")));
    assert!(!config.applies_to_repo("rule", Some("/repo/c")));
}

#[test]
fn applies_to_repo_exclude_takes_precedence_over_include() {
    let config = config_with_scope(
        "rule",
        Some(vec!["/repo/a", "/repo/b"]),
        Some(vec!["/repo/b"]),
    );
    assert!(config.applies_to_repo("rule", Some("/repo/a")));
    assert!(!config.applies_to_repo("rule", Some("/repo/b")));
}

#[test]
fn applies_to_repo_scoped_policy_drops_without_repo_context() {
    // A repo-scoped policy must not leak into personal/sovereign sessions
    // (where repo_path = None).
    let config = config_with_scope("rule", Some(vec!["/repo/a"]), None);
    assert!(!config.applies_to_repo("rule", None));
}

#[test]
fn applies_to_repo_unscoped_policy_applies_without_repo_context() {
    let config = config_with_scope("rule", None, None);
    assert!(config.applies_to_repo("rule", None));
}

#[test]
fn applies_to_repo_empty_lists_treated_as_no_scope() {
    // Defensive: an empty Vec means "no scope" (same as None) — saved
    // configs sometimes carry empty arrays after the user clears them.
    let config = config_with_scope("rule", Some(vec![]), Some(vec![]));
    assert!(config.applies_to_repo("rule", Some("/repo/a")));
    assert!(config.applies_to_repo("rule", None));
}

#[test]
fn load_from_valid_json_reads_policies() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rules-config.json");
    std::fs::write(
        &path,
        r#"{"policies":{"rule-a":{"agents":["agent-1"],"disabled":true}}}"#,
    )
    .unwrap();

    let config = PoliciesConfig::load_from_path(&path).expect("valid config");
    assert!(config.is_disabled("rule-a"));
    assert_eq!(config.agents_for("rule-a"), &["agent-1".to_string()]);
}
