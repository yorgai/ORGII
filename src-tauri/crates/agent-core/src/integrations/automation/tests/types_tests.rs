use crate::automation::types::{
    AutomationAction, AutomationRule, AutomationTrigger, GitEvent, ScheduleFrequency,
    ScheduleMonthlyMode, ScheduleWeekday, WeekOfMonth, WorkflowActionInstance,
};
use chrono::Utc;
use serde_json::Map;

fn make_rule(enabled: bool, cooldown: Option<u64>, max_fires: Option<u32>) -> AutomationRule {
    AutomationRule {
        id: "test-rule".to_string(),
        name: "Test Rule".to_string(),
        enabled,
        trigger: AutomationTrigger::Timer { interval_secs: 60 },
        action: AutomationAction::InjectPrompt {
            prompt: "test".to_string(),
            session_id: None,
        },
        cooldown_secs: cooldown,
        max_fires,
        fire_count: 0,
        last_fired: None,
        extra: Map::new(),
    }
}

// -- can_fire --

#[test]
fn can_fire_enabled_no_limits() {
    let rule = make_rule(true, None, None);
    assert!(rule.can_fire());
}

#[test]
fn can_fire_disabled() {
    let rule = make_rule(false, None, None);
    assert!(!rule.can_fire());
}

#[test]
fn can_fire_max_fires_not_reached() {
    let mut rule = make_rule(true, None, Some(5));
    rule.fire_count = 3;
    assert!(rule.can_fire());
}

#[test]
fn can_fire_max_fires_reached() {
    let mut rule = make_rule(true, None, Some(5));
    rule.fire_count = 5;
    assert!(!rule.can_fire());
}

#[test]
fn can_fire_max_fires_exceeded() {
    let mut rule = make_rule(true, None, Some(5));
    rule.fire_count = 10;
    assert!(!rule.can_fire());
}

#[test]
fn can_fire_cooldown_expired() {
    let mut rule = make_rule(true, Some(1), None);
    rule.last_fired = Some(Utc::now() - chrono::Duration::seconds(10));
    assert!(rule.can_fire());
}

#[test]
fn can_fire_cooldown_not_expired() {
    let mut rule = make_rule(true, Some(3600), None);
    rule.last_fired = Some(Utc::now());
    assert!(!rule.can_fire());
}

#[test]
fn can_fire_cooldown_no_last_fired() {
    let rule = make_rule(true, Some(60), None);
    assert!(
        rule.can_fire(),
        "no last_fired means cooldown is not blocking"
    );
}

// -- record_fire --

#[test]
fn record_fire_increments_count() {
    let mut rule = make_rule(true, None, None);
    assert_eq!(rule.fire_count, 0);
    assert!(rule.last_fired.is_none());

    rule.record_fire();

    assert_eq!(rule.fire_count, 1);
    assert!(rule.last_fired.is_some());
}

#[test]
fn record_fire_updates_last_fired() {
    let mut rule = make_rule(true, None, None);
    let old_time = Utc::now() - chrono::Duration::hours(1);
    rule.last_fired = Some(old_time);
    rule.fire_count = 5;

    rule.record_fire();

    assert_eq!(rule.fire_count, 6);
    assert!(rule.last_fired.unwrap() > old_time);
}

// -- serde --

#[test]
fn trigger_serde_timer() {
    let trigger = AutomationTrigger::Timer { interval_secs: 300 };
    insta::assert_yaml_snapshot!("trigger_timer", trigger);

    let json = serde_json::to_string(&trigger).unwrap();
    let parsed: AutomationTrigger = serde_json::from_str(&json).unwrap();
    match parsed {
        AutomationTrigger::Timer { interval_secs } => assert_eq!(interval_secs, 300),
        _ => panic!("expected Timer"),
    }
}

#[test]
fn trigger_serde_scheduled_time() {
    let trigger = AutomationTrigger::ScheduledTime {
        frequency: ScheduleFrequency::Weekly,
        time: "20:00".to_string(),
        timezone: "Asia/Shanghai".to_string(),
        days_of_week: vec![ScheduleWeekday::Monday],
        monthly_mode: Some(ScheduleMonthlyMode::WeekdayOfMonth),
        day_of_month: None,
        week_of_month: Some(WeekOfMonth::First),
        weekday_of_month: Some(ScheduleWeekday::Monday),
    };

    let json = serde_json::to_string(&trigger).unwrap();
    let parsed: AutomationTrigger = serde_json::from_str(&json).unwrap();
    match parsed {
        AutomationTrigger::ScheduledTime {
            frequency,
            time,
            timezone,
            days_of_week,
            monthly_mode,
            day_of_month,
            week_of_month,
            weekday_of_month,
        } => {
            assert_eq!(frequency, ScheduleFrequency::Weekly);
            assert_eq!(time, "20:00");
            assert_eq!(timezone, "Asia/Shanghai");
            assert_eq!(days_of_week, vec![ScheduleWeekday::Monday]);
            assert_eq!(monthly_mode, Some(ScheduleMonthlyMode::WeekdayOfMonth));
            assert!(day_of_month.is_none());
            assert_eq!(week_of_month, Some(WeekOfMonth::First));
            assert_eq!(weekday_of_month, Some(ScheduleWeekday::Monday));
        }
        _ => panic!("expected ScheduledTime"),
    }
}

#[test]
fn action_serde_inject_prompt() {
    let action = AutomationAction::InjectPrompt {
        prompt: "do something".to_string(),
        session_id: Some("sess-1".to_string()),
    };
    insta::assert_yaml_snapshot!("action_inject_prompt", action);

    let json = serde_json::to_string(&action).unwrap();
    let parsed: AutomationAction = serde_json::from_str(&json).unwrap();
    match parsed {
        AutomationAction::InjectPrompt { prompt, session_id } => {
            assert_eq!(prompt, "do something");
            assert_eq!(session_id.as_deref(), Some("sess-1"));
        }
        _ => panic!("expected InjectPrompt"),
    }
}

#[test]
fn git_activity_trigger_accepts_missing_repo_filter() {
    let parsed: AutomationTrigger =
        serde_json::from_str(r#"{"type":"gitActivity","events":["commit"]}"#).unwrap();

    match parsed {
        AutomationTrigger::GitActivity {
            events,
            repo_filter,
        } => {
            assert_eq!(events, vec![GitEvent::Commit]);
            assert!(repo_filter.is_none());
        }
        _ => panic!("expected GitActivity"),
    }
}

#[test]
fn action_serde_workflow() {
    let action = AutomationAction::Workflow {
        actions: vec![WorkflowActionInstance {
            id: "step-1".to_string(),
            definition_id: "inject-prompt".to_string(),
            data: Map::new(),
            extra: Map::new(),
        }],
    };

    let json = serde_json::to_string(&action).unwrap();
    let parsed: AutomationAction = serde_json::from_str(&json).unwrap();
    match parsed {
        AutomationAction::Workflow { actions } => {
            assert_eq!(actions.len(), 1);
            assert_eq!(actions[0].definition_id, "inject-prompt");
        }
        _ => panic!("expected Workflow"),
    }
}

/// Frontend-only routine metadata (`scope`, `agentId`) must round-trip
/// through Rust's typed serde even though the scheduler never inspects
/// it. This locks in the same passthrough contract documented on
/// `AutomationRule.extra` and on the TS `AutomationRule` interface.
#[test]
fn automation_rule_preserves_unknown_frontend_fields() {
    let raw = serde_json::json!({
        "id": "rule-1",
        "name": "Test Rule",
        "enabled": true,
        "trigger": { "type": "timer", "intervalSecs": 60 },
        "action": { "type": "injectPrompt", "prompt": "hi", "sessionId": null },
        "cooldownSecs": null,
        "maxFires": null,
        "fireCount": 0,
        "lastFired": null,
        "scope": { "mode": "specific", "repoIds": ["repo-1"] },
        "agentId": "agent-xyz",
        "someFutureField": 42
    });
    let rule: AutomationRule = serde_json::from_value(raw.clone()).unwrap();
    let round_tripped = serde_json::to_value(&rule).unwrap();
    assert_eq!(round_tripped, raw);
}

/// Frontend-only render metadata (branch/loop layout, nesting depth,
/// etc.) must round-trip through Rust's typed serde even though the
/// runtime never inspects it. This guards against accidental schema
/// regressions that would silently drop the visual editor's state.
#[test]
fn workflow_action_instance_preserves_unknown_frontend_fields() {
    let raw = serde_json::json!({
        "id": "step-1",
        "definitionId": "inject-prompt",
        "data": { "0": "hi" },
        "branchType": "if-true",
        "parentIfId": "if-block-1",
        "parentLoopId": null,
        "nestingLevel": 2,
        "someFutureFrontendField": { "nested": true }
    });
    let action: WorkflowActionInstance = serde_json::from_value(raw.clone()).unwrap();
    let round_tripped = serde_json::to_value(&action).unwrap();
    assert_eq!(round_tripped, raw);
}

#[test]
fn git_event_variants() {
    let events = vec![
        GitEvent::Commit,
        GitEvent::Push,
        GitEvent::Pull,
        GitEvent::BranchChange,
        GitEvent::FileChange,
    ];
    for event in &events {
        let json = serde_json::to_string(event).unwrap();
        let parsed: GitEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(&parsed, event);
    }
}
