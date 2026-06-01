use crate::automation::types::{AutomationAction, AutomationTrigger, GitEvent};

// -- trigger_summary (private) --

#[test]
fn trigger_summary_timer() {
    let trigger = AutomationTrigger::Timer { interval_secs: 60 };
    let out = super::trigger_summary(&trigger);
    assert!(out.contains("Timer"));
    assert!(out.contains("60"));
}

#[test]
fn trigger_summary_cron() {
    let trigger = AutomationTrigger::Cron {
        expression: "0 * * * *".to_string(),
    };
    let out = super::trigger_summary(&trigger);
    assert!(out.contains("Cron"));
    assert!(out.contains("0 * * * *"));
}

#[test]
fn trigger_summary_git_activity() {
    let trigger = AutomationTrigger::GitActivity {
        events: vec![GitEvent::Commit, GitEvent::Push],
        repo_filter: None,
    };
    let out = super::trigger_summary(&trigger);
    assert!(out.contains("Git"));
    assert!(out.contains("commit"));
    assert!(out.contains("push"));
}

#[test]
fn trigger_summary_git_activity_with_repo_filter() {
    let trigger = AutomationTrigger::GitActivity {
        events: vec![GitEvent::Commit],
        repo_filter: Some("/path/to/repo".to_string()),
    };
    let out = super::trigger_summary(&trigger);
    assert!(out.contains("repo:"));
}

#[test]
fn trigger_summary_channel_message() {
    let trigger = AutomationTrigger::ChannelMessage {
        channel: "alerts".to_string(),
        pattern: Some("error.*".to_string()),
    };
    let out = super::trigger_summary(&trigger);
    assert!(out.contains("alerts"));
    assert!(out.contains("error.*"));
}

#[test]
fn trigger_summary_channel_message_without_pattern() {
    let trigger = AutomationTrigger::ChannelMessage {
        channel: "alerts".to_string(),
        pattern: None,
    };
    let out = super::trigger_summary(&trigger);
    assert!(out.contains("alerts"));
    assert!(!out.contains("matching"));
}

#[test]
fn trigger_summary_file_watch() {
    let trigger = AutomationTrigger::FileWatch {
        paths: vec!["src/".to_string()],
        debounce_ms: 1000,
    };
    let out = super::trigger_summary(&trigger);
    assert!(out.contains("src/"));
    assert!(out.contains("1000"));
}

#[test]
fn trigger_summary_webhook() {
    let trigger = AutomationTrigger::Webhook {
        route: "/api/hook".to_string(),
    };
    let out = super::trigger_summary(&trigger);
    assert!(out.contains("/api/hook"));
}
// -- action_summary (private) --

#[test]
fn action_summary_inject_prompt_active_session() {
    let action = AutomationAction::InjectPrompt {
        prompt: "fix bug".to_string(),
        session_id: None,
    };
    let out = super::action_summary(&action);
    assert!(out.contains("active session"));
    assert!(out.contains("fix bug"));
}

#[test]
fn action_summary_inject_prompt_with_session_id() {
    let action = AutomationAction::InjectPrompt {
        prompt: "fix bug".to_string(),
        session_id: Some("sess-123".to_string()),
    };
    let out = super::action_summary(&action);
    assert!(out.contains("sess-123"));
}

#[test]
fn action_summary_inject_prompt_long_truncated() {
    let long_prompt = "a".repeat(150);
    let action = AutomationAction::InjectPrompt {
        prompt: long_prompt.clone(),
        session_id: None,
    };
    let out = super::action_summary(&action);
    assert!(out.len() < 150 + 50);
    assert!(out.contains("..."));
}

#[test]
fn action_summary_start_session() {
    let action = AutomationAction::StartSession {
        agent_type: "sde".to_string(),
        prompt: "do thing".to_string(),
        model: None,
        repo_path: None,
    };
    let out = super::action_summary(&action);
    assert!(out.contains("sde"));
    assert!(out.contains("default"));
    assert!(out.contains("do thing"));
}
