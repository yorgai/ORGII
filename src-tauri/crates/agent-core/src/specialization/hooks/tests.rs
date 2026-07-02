//! Unit tests for the hook system.

use super::config::{HookEntry, HooksConfig, HttpMethod};
use super::events::{HookContext, HookEvent};
use super::executor::HookExecutor;

use std::collections::HashMap;

// ============================================
// HookEvent
// ============================================

#[test]
fn hook_event_as_str_round_trips() {
    for event in HookEvent::all() {
        let serialized = serde_json::to_string(event).unwrap();
        let deserialized: HookEvent = serde_json::from_str(&serialized).unwrap();
        assert_eq!(*event, deserialized);
    }
}

#[test]
fn hook_event_all_returns_ten_events() {
    assert_eq!(HookEvent::all().len(), 10);
}

#[test]
fn hook_event_display_matches_as_str() {
    for event in HookEvent::all() {
        assert_eq!(format!("{}", event), event.as_str());
    }
}

#[test]
fn hook_event_snake_case_serialization() {
    let json = serde_json::to_string(&HookEvent::PreToolUse).unwrap();
    assert_eq!(json, "\"pre_tool_use\"");

    let json = serde_json::to_string(&HookEvent::SessionStart).unwrap();
    assert_eq!(json, "\"session_start\"");
}

// ============================================
// HookContext
// ============================================

#[test]
fn hook_context_builder_pattern() {
    let ctx = HookContext::new()
        .with_var("KEY1", "val1")
        .with_var("KEY2", "val2");
    assert_eq!(ctx.env_vars.get("KEY1").unwrap(), "val1");
    assert_eq!(ctx.env_vars.get("KEY2").unwrap(), "val2");
}

#[test]
fn hook_context_for_tool() {
    let ctx = HookContext::for_tool("sess-1", "read_file", "tc-42");
    assert_eq!(ctx.env_vars.get("ORGII_SESSION_ID").unwrap(), "sess-1");
    assert_eq!(ctx.env_vars.get("ORGII_TOOL_NAME").unwrap(), "read_file");
    assert_eq!(ctx.env_vars.get("ORGII_TOOL_CALL_ID").unwrap(), "tc-42");
}

#[test]
fn hook_context_for_session() {
    let ctx = HookContext::for_session("sess-99");
    assert_eq!(ctx.env_vars.get("ORGII_SESSION_ID").unwrap(), "sess-99");
}

// ============================================
// HooksConfig
// ============================================

#[test]
fn config_default_is_empty() {
    let config = HooksConfig::default();
    assert!(config.is_empty());
    assert_eq!(config.total_hooks(), 0);
}

#[test]
fn config_parse_valid_json() {
    let json = r#"{
        "hooks": {
            "pre_tool_use": [
                { "type": "command", "command": "echo hello", "timeout_ms": 3000 }
            ],
            "session_start": [
                { "type": "command", "command": "./start.sh" }
            ]
        }
    }"#;
    let config: HooksConfig = serde_json::from_str(json).unwrap();
    assert_eq!(config.total_hooks(), 2);
    assert_eq!(config.hooks_for(HookEvent::PreToolUse).len(), 1);
    assert_eq!(config.hooks_for(HookEvent::SessionStart).len(), 1);
    assert_eq!(config.hooks_for(HookEvent::PostToolUse).len(), 0);
}

#[test]
fn config_parse_empty_hooks() {
    let json = r#"{ "hooks": {} }"#;
    let config: HooksConfig = serde_json::from_str(json).unwrap();
    assert!(config.is_empty());
}

#[test]
fn config_load_nonexistent_returns_empty() {
    let config = HooksConfig::load(std::path::Path::new("/nonexistent/path"));
    assert!(config.is_empty());
}

#[test]
fn config_hooks_for_missing_event_returns_empty() {
    let config = HooksConfig::default();
    assert!(config.hooks_for(HookEvent::Stop).is_empty());
}

#[test]
fn config_merge_concatenates_same_event() {
    let global: HooksConfig = serde_json::from_str(
        r#"{
        "hooks": {
            "pre_tool_use": [
                { "type": "command", "command": "echo global" }
            ]
        }
    }"#,
    )
    .unwrap();

    let project: HooksConfig = serde_json::from_str(
        r#"{
        "hooks": {
            "pre_tool_use": [
                { "type": "command", "command": "echo project" }
            ]
        }
    }"#,
    )
    .unwrap();

    let merged = global.merge(project);
    let hooks = merged.hooks_for(HookEvent::PreToolUse);
    assert_eq!(hooks.len(), 2);
    match &hooks[0] {
        HookEntry::Command { command, .. } => assert_eq!(command, "echo global"),
        _ => panic!("Expected command hook"),
    }
    match &hooks[1] {
        HookEntry::Command { command, .. } => assert_eq!(command, "echo project"),
        _ => panic!("Expected command hook"),
    }
}

#[test]
fn config_merge_combines_different_events() {
    let global: HooksConfig = serde_json::from_str(
        r#"{
        "hooks": {
            "session_start": [
                { "type": "command", "command": "echo start" }
            ]
        }
    }"#,
    )
    .unwrap();

    let project: HooksConfig = serde_json::from_str(
        r#"{
        "hooks": {
            "post_tool_use": [
                { "type": "command", "command": "echo post" }
            ]
        }
    }"#,
    )
    .unwrap();

    let merged = global.merge(project);
    assert_eq!(merged.total_hooks(), 2);
    assert_eq!(merged.hooks_for(HookEvent::SessionStart).len(), 1);
    assert_eq!(merged.hooks_for(HookEvent::PostToolUse).len(), 1);
}

#[test]
fn config_merge_empty_global_returns_project() {
    let global = HooksConfig::default();
    let project: HooksConfig = serde_json::from_str(
        r#"{
        "hooks": {
            "pre_tool_use": [
                { "type": "command", "command": "echo proj" }
            ]
        }
    }"#,
    )
    .unwrap();

    let merged = global.merge(project);
    assert_eq!(merged.total_hooks(), 1);
}

#[test]
fn config_merge_empty_project_returns_global() {
    let global: HooksConfig = serde_json::from_str(
        r#"{
        "hooks": {
            "stop": [
                { "type": "command", "command": "echo stop" }
            ]
        }
    }"#,
    )
    .unwrap();

    let project = HooksConfig::default();
    let merged = global.merge(project);
    assert_eq!(merged.total_hooks(), 1);
    assert_eq!(merged.hooks_for(HookEvent::Stop).len(), 1);
}

// ============================================
// HookEntry
// ============================================

#[test]
fn hook_entry_default_timeout() {
    let json = r#"{ "type": "command", "command": "echo hi" }"#;
    let entry: HookEntry = serde_json::from_str(json).unwrap();
    assert_eq!(entry.effective_timeout_ms(), 5000);
}

#[test]
fn hook_entry_custom_timeout() {
    let json = r#"{ "type": "command", "command": "echo hi", "timeout_ms": 2000 }"#;
    let entry: HookEntry = serde_json::from_str(json).unwrap();
    assert_eq!(entry.effective_timeout_ms(), 2000);
}

#[test]
fn hook_entry_timeout_capped_at_max() {
    let json = r#"{ "type": "command", "command": "echo hi", "timeout_ms": 999999 }"#;
    let entry: HookEntry = serde_json::from_str(json).unwrap();
    assert_eq!(entry.effective_timeout_ms(), 30_000);
}

// ============================================
// HookExecutor
// ============================================

#[test]
fn executor_empty_config_has_no_hooks() {
    let executor =
        HookExecutor::with_config(HooksConfig::default(), std::path::PathBuf::from("/tmp"));
    assert!(executor.is_empty());
    assert!(!executor.has_hooks_for(HookEvent::PreToolUse));
}

#[test]
fn executor_detects_registered_hooks() {
    let mut hooks = HashMap::new();
    hooks.insert(
        HookEvent::PreToolUse,
        vec![HookEntry::Command {
            command: "echo test".to_string(),
            timeout_ms: 5000,
            matcher: None,
        }],
    );
    let config = HooksConfig { hooks };
    let executor = HookExecutor::with_config(config, std::path::PathBuf::from("/tmp"));
    assert!(executor.has_hooks_for(HookEvent::PreToolUse));
    assert!(!executor.has_hooks_for(HookEvent::PostToolUse));
}

#[tokio::test]
async fn executor_run_no_hooks_returns_empty() {
    let executor =
        HookExecutor::with_config(HooksConfig::default(), std::path::PathBuf::from("/tmp"));
    let results = executor
        .run(HookEvent::SessionStart, &HookContext::new())
        .await;
    assert!(results.is_empty());
}

#[tokio::test]
async fn executor_run_echo_command() {
    let mut hooks = HashMap::new();
    hooks.insert(
        HookEvent::SessionStart,
        vec![HookEntry::Command {
            command: "echo hello_from_hook".to_string(),
            timeout_ms: 5000,
            matcher: None,
        }],
    );
    let config = HooksConfig { hooks };
    let executor = HookExecutor::with_config(config, std::path::PathBuf::from("/tmp"));
    let ctx = HookContext::for_session("test-session");

    let results = executor.run(HookEvent::SessionStart, &ctx).await;
    assert_eq!(results.len(), 1);
    assert!(results[0].success);
    assert!(results[0].stdout.contains("hello_from_hook"));
}

#[tokio::test]
async fn executor_passes_env_vars_to_command() {
    let mut hooks = HashMap::new();
    hooks.insert(
        HookEvent::PreToolUse,
        vec![HookEntry::Command {
            command: "echo $ORGII_TOOL_NAME".to_string(),
            timeout_ms: 5000,
            matcher: None,
        }],
    );
    let config = HooksConfig { hooks };
    let executor = HookExecutor::with_config(config, std::path::PathBuf::from("/tmp"));
    let ctx = HookContext::for_tool("sess-1", "read_file", "tc-1");

    let results = executor.run(HookEvent::PreToolUse, &ctx).await;
    assert_eq!(results.len(), 1);
    assert!(results[0].success);
    assert!(results[0].stdout.contains("read_file"));
}

#[tokio::test]
async fn executor_injects_hook_event_env() {
    let mut hooks = HashMap::new();
    hooks.insert(
        HookEvent::Stop,
        vec![HookEntry::Command {
            command: "echo $ORGII_HOOK_EVENT".to_string(),
            timeout_ms: 5000,
            matcher: None,
        }],
    );
    let config = HooksConfig { hooks };
    let executor = HookExecutor::with_config(config, std::path::PathBuf::from("/tmp"));

    let results = executor.run(HookEvent::Stop, &HookContext::new()).await;
    assert!(results[0].success);
    assert!(results[0].stdout.contains("stop"));
}

#[tokio::test]
async fn executor_handles_failing_command() {
    let mut hooks = HashMap::new();
    hooks.insert(
        HookEvent::PostToolUse,
        vec![HookEntry::Command {
            command: "exit 1".to_string(),
            timeout_ms: 5000,
            matcher: None,
        }],
    );
    let config = HooksConfig { hooks };
    let executor = HookExecutor::with_config(config, std::path::PathBuf::from("/tmp"));

    let results = executor
        .run(HookEvent::PostToolUse, &HookContext::new())
        .await;
    assert_eq!(results.len(), 1);
    assert!(!results[0].success);
}

#[tokio::test]
async fn executor_timeout_reports_failure() {
    let mut hooks = HashMap::new();
    hooks.insert(
        HookEvent::SessionStop,
        vec![HookEntry::Command {
            command: "sleep 60".to_string(),
            timeout_ms: 100, // very short timeout
            matcher: None,
        }],
    );
    let config = HooksConfig { hooks };
    let executor = HookExecutor::with_config(config, std::path::PathBuf::from("/tmp"));

    let results = executor
        .run(HookEvent::SessionStop, &HookContext::new())
        .await;
    assert_eq!(results.len(), 1);
    assert!(!results[0].success);
    assert!(results[0].stderr.contains("timed out"));
}

#[tokio::test]
async fn executor_runs_multiple_hooks_sequentially() {
    let mut hooks = HashMap::new();
    hooks.insert(
        HookEvent::SessionStart,
        vec![
            HookEntry::Command {
                command: "echo first".to_string(),
                timeout_ms: 5000,
                matcher: None,
            },
            HookEntry::Command {
                command: "echo second".to_string(),
                timeout_ms: 5000,
                matcher: None,
            },
            HookEntry::Command {
                command: "echo third".to_string(),
                timeout_ms: 5000,
                matcher: None,
            },
        ],
    );
    let config = HooksConfig { hooks };
    let executor = HookExecutor::with_config(config, std::path::PathBuf::from("/tmp"));

    let results = executor
        .run(HookEvent::SessionStart, &HookContext::new())
        .await;
    assert_eq!(results.len(), 3);
    assert!(results[0].stdout.contains("first"));
    assert!(results[1].stdout.contains("second"));
    assert!(results[2].stdout.contains("third"));
}

#[tokio::test]
async fn executor_failing_hook_does_not_block_subsequent() {
    let mut hooks = HashMap::new();
    hooks.insert(
        HookEvent::PreToolUse,
        vec![
            HookEntry::Command {
                command: "exit 1".to_string(),
                timeout_ms: 5000,
                matcher: None,
            },
            HookEntry::Command {
                command: "echo survived".to_string(),
                timeout_ms: 5000,
                matcher: None,
            },
        ],
    );
    let config = HooksConfig { hooks };
    let executor = HookExecutor::with_config(config, std::path::PathBuf::from("/tmp"));

    let results = executor
        .run(HookEvent::PreToolUse, &HookContext::new())
        .await;
    assert_eq!(results.len(), 2);
    assert!(!results[0].success);
    assert!(results[1].success);
    assert!(results[1].stdout.contains("survived"));
}

// ============================================
// Phase C: Stop / SessionStop event wiring
// ============================================

#[tokio::test]
async fn stop_hook_receives_turn_metadata_env_vars() {
    let mut hooks = HashMap::new();
    hooks.insert(
        HookEvent::Stop,
        vec![HookEntry::Command {
            command: "echo turn=$ORGII_TURN_ID tools=$ORGII_TOOL_CALLS tokens=$ORGII_TOTAL_TOKENS"
                .to_string(),
            timeout_ms: 5000,
            matcher: None,
        }],
    );
    let config = HooksConfig { hooks };
    let executor = HookExecutor::with_config(config, std::path::PathBuf::from("/tmp"));

    let ctx = HookContext::for_session("sess-stop-1")
        .with_var("ORGII_TURN_ID", "turn-abc")
        .with_var("ORGII_TOOL_CALLS", "7")
        .with_var("ORGII_TOTAL_TOKENS", "12345");

    let results = executor.run(HookEvent::Stop, &ctx).await;
    assert_eq!(results.len(), 1);
    assert!(results[0].success);
    assert!(results[0].stdout.contains("turn=turn-abc"));
    assert!(results[0].stdout.contains("tools=7"));
    assert!(results[0].stdout.contains("tokens=12345"));
}

#[tokio::test]
async fn session_stop_hook_receives_status_env_var() {
    let mut hooks = HashMap::new();
    hooks.insert(
        HookEvent::SessionStop,
        vec![HookEntry::Command {
            command: "echo status=$ORGII_SESSION_STATUS session=$ORGII_SESSION_ID".to_string(),
            timeout_ms: 5000,
            matcher: None,
        }],
    );
    let config = HooksConfig { hooks };
    let executor = HookExecutor::with_config(config, std::path::PathBuf::from("/tmp"));

    let ctx =
        HookContext::for_session("sess-final-1").with_var("ORGII_SESSION_STATUS", "Completed");

    let results = executor.run(HookEvent::SessionStop, &ctx).await;
    assert_eq!(results.len(), 1);
    assert!(results[0].success);
    assert!(results[0].stdout.contains("status=Completed"));
    assert!(results[0].stdout.contains("session=sess-final-1"));
}

#[tokio::test]
async fn stop_hook_does_not_fire_when_no_hooks_registered() {
    let executor =
        HookExecutor::with_config(HooksConfig::default(), std::path::PathBuf::from("/tmp"));
    assert!(!executor.has_hooks_for(HookEvent::Stop));
    let results = executor.run(HookEvent::Stop, &HookContext::new()).await;
    assert!(results.is_empty());
}

#[tokio::test]
async fn session_stop_hook_does_not_fire_when_no_hooks_registered() {
    let executor =
        HookExecutor::with_config(HooksConfig::default(), std::path::PathBuf::from("/tmp"));
    assert!(!executor.has_hooks_for(HookEvent::SessionStop));
    let results = executor
        .run(HookEvent::SessionStop, &HookContext::new())
        .await;
    assert!(results.is_empty());
}

// ============================================
// Phase B: Prompt hooks
// ============================================

#[test]
fn config_parse_prompt_hook() {
    let json = r#"{
        "hooks": {
            "pre_prompt_build": [
                { "type": "prompt", "content": "Always reply in formal English." }
            ]
        }
    }"#;
    let config: HooksConfig = serde_json::from_str(json).unwrap();
    assert_eq!(config.total_hooks(), 1);
    assert_eq!(config.hooks_for(HookEvent::PrePromptBuild).len(), 1);
}

#[test]
fn prompt_hook_has_zero_timeout() {
    let entry = HookEntry::Prompt {
        content: "test".to_string(),
    };
    assert_eq!(entry.effective_timeout_ms(), 0);
}

#[test]
fn collect_prompt_hooks_returns_none_when_empty() {
    let executor =
        HookExecutor::with_config(HooksConfig::default(), std::path::PathBuf::from("/tmp"));
    assert!(executor
        .collect_prompt_hooks(HookEvent::PrePromptBuild)
        .is_none());
}

#[test]
fn collect_prompt_hooks_concatenates_content() {
    let mut hooks = HashMap::new();
    hooks.insert(
        HookEvent::PrePromptBuild,
        vec![
            HookEntry::Prompt {
                content: "Rule 1: Be concise.".to_string(),
            },
            HookEntry::Command {
                command: "echo ignored".to_string(),
                timeout_ms: 5000,
                matcher: None,
            },
            HookEntry::Prompt {
                content: "Rule 2: Use markdown.".to_string(),
            },
        ],
    );
    let config = HooksConfig { hooks };
    let executor = HookExecutor::with_config(config, std::path::PathBuf::from("/tmp"));

    let result = executor.collect_prompt_hooks(HookEvent::PrePromptBuild);
    assert!(result.is_some());
    let text = result.unwrap();
    assert!(text.contains("Rule 1: Be concise."));
    assert!(text.contains("Rule 2: Use markdown."));
    assert!(!text.contains("ignored"));
}

#[tokio::test]
async fn prompt_hook_run_returns_success_noop() {
    let mut hooks = HashMap::new();
    hooks.insert(
        HookEvent::PrePromptBuild,
        vec![HookEntry::Prompt {
            content: "test content".to_string(),
        }],
    );
    let config = HooksConfig { hooks };
    let executor = HookExecutor::with_config(config, std::path::PathBuf::from("/tmp"));

    let results = executor
        .run(HookEvent::PrePromptBuild, &HookContext::new())
        .await;
    assert_eq!(results.len(), 1);
    assert!(results[0].success);
    assert_eq!(results[0].duration_ms, 0);
}

// ============================================
// Phase B: HTTP hooks
// ============================================

#[test]
fn config_parse_http_hook() {
    let json = r#"{
        "hooks": {
            "post_tool_use": [
                {
                    "type": "http",
                    "url": "https://example.com/webhook",
                    "method": "POST",
                    "timeout_ms": 3000,
                    "headers": { "Authorization": "Bearer test123" }
                }
            ]
        }
    }"#;
    let config: HooksConfig = serde_json::from_str(json).unwrap();
    assert_eq!(config.total_hooks(), 1);

    let hook = &config.hooks_for(HookEvent::PostToolUse)[0];
    assert_eq!(hook.effective_timeout_ms(), 3000);
}

#[test]
fn http_method_default_is_post() {
    let json = r#"{ "type": "http", "url": "https://example.com" }"#;
    let entry: HookEntry = serde_json::from_str(json).unwrap();
    match entry {
        HookEntry::Http { method, .. } => {
            assert!(matches!(method, HttpMethod::POST));
        }
        _ => panic!("expected Http variant"),
    }
}

#[test]
fn config_parse_mixed_hook_types() {
    let json = r#"{
        "hooks": {
            "session_start": [
                { "type": "command", "command": "echo start" },
                { "type": "prompt", "content": "Be helpful." },
                { "type": "http", "url": "https://example.com/start" }
            ]
        }
    }"#;
    let config: HooksConfig = serde_json::from_str(json).unwrap();
    assert_eq!(config.total_hooks(), 3);
}

// ============================================
// Phase B: New events
// ============================================

#[test]
fn new_events_serialize_correctly() {
    let events = [
        (HookEvent::PostToolUseFailure, "\"post_tool_use_failure\""),
        (HookEvent::PrePromptBuild, "\"pre_prompt_build\""),
        (HookEvent::PreCompaction, "\"pre_compaction\""),
        (HookEvent::PostCompaction, "\"post_compaction\""),
    ];
    for (event, expected) in &events {
        assert_eq!(serde_json::to_string(event).unwrap(), *expected);
    }
}

#[test]
fn new_events_round_trip() {
    for event in [
        HookEvent::PostToolUseFailure,
        HookEvent::PrePromptBuild,
        HookEvent::PreCompaction,
        HookEvent::PostCompaction,
    ] {
        let json = serde_json::to_string(&event).unwrap();
        let parsed: HookEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, event);
    }
}

// ============================================
// Phase D: Hook Output Effects — parse_hook_decision
// ============================================

#[test]
fn parse_hook_decision_deny_blocks_tool() {
    use crate::core::session::turn::event_handler::parse_hook_decision;
    let stdout = r#"{"decision":"deny","message":"rm is not allowed"}"#;
    let result = parse_hook_decision(stdout);
    assert!(result.is_some());
    let intervention = result.unwrap();
    assert!(intervention.block);
    assert_eq!(
        intervention.block_reason.as_deref(),
        Some("rm is not allowed")
    );
    assert!(intervention.modified_params.is_none());
}

#[test]
fn parse_hook_decision_deny_default_message() {
    use crate::core::session::turn::event_handler::parse_hook_decision;
    let stdout = r#"{"decision":"deny"}"#;
    let result = parse_hook_decision(stdout);
    assert!(result.is_some());
    let intervention = result.unwrap();
    assert!(intervention.block);
    assert_eq!(
        intervention.block_reason.as_deref(),
        Some("Blocked by hook")
    );
}

#[test]
fn parse_hook_decision_allow_no_modification_returns_none() {
    use crate::core::session::turn::event_handler::parse_hook_decision;
    let stdout = r#"{"decision":"allow"}"#;
    let result = parse_hook_decision(stdout);
    assert!(result.is_none());
}

#[test]
fn parse_hook_decision_allow_with_updated_input() {
    use crate::core::session::turn::event_handler::parse_hook_decision;
    let stdout = r#"{"decision":"allow","updated_input":{"command":"echo safe"}}"#;
    let result = parse_hook_decision(stdout);
    assert!(result.is_some());
    let intervention = result.unwrap();
    assert!(!intervention.block);
    assert!(intervention.modified_params.is_some());
    assert_eq!(
        intervention.modified_params.unwrap()["command"],
        "echo safe"
    );
}

#[test]
fn parse_hook_decision_non_json_returns_none() {
    use crate::core::session::turn::event_handler::parse_hook_decision;
    assert!(parse_hook_decision("just some text").is_none());
    assert!(parse_hook_decision("").is_none());
    assert!(parse_hook_decision("   ").is_none());
}

#[test]
fn parse_hook_decision_unknown_decision_with_updated_input() {
    use crate::core::session::turn::event_handler::parse_hook_decision;
    let stdout = r#"{"updated_input":{"file_path":"/tmp/safe.txt"}}"#;
    let result = parse_hook_decision(stdout);
    assert!(result.is_some());
    let intervention = result.unwrap();
    assert!(!intervention.block);
    assert!(intervention.modified_params.is_some());
}
