use crate::agent_sessions::event_pipeline::history::{FileChangeStats, SessionRecord};
use crate::agent_sessions::event_pipeline::statistics::*;

#[allow(clippy::too_many_arguments)]
fn make_session(
    id: &str,
    name: &str,
    status: &str,
    stype: &str,
    model: &str,
    events: usize,
    insertions: usize,
    deletions: usize,
) -> SessionRecord {
    SessionRecord {
        session_id: id.to_string(),
        name: name.to_string(),
        status: status.to_string(),
        session_type: stype.to_string(),
        repo_id: "repo-1".to_string(),
        repo_name: "my-project".to_string(),
        created_at: "2025-01-15T10:00:00.000Z".to_string(),
        updated_at: "2025-01-15T12:00:00.000Z".to_string(),
        model: model.to_string(),
        event_count: events,
        file_changes: FileChangeStats {
            added: 2,
            deleted: 1,
            modified: 3,
            insertion: insertions,
            deletion: deletions,
        },
        workflow_id: None,
        assigned_agent: None,
    }
}

fn sample_sessions() -> Vec<SessionRecord> {
    vec![
        make_session("s1", "Fix bug", "completed", "sde", "claude-4", 100, 50, 20),
        make_session(
            "s2",
            "Add feature",
            "completed",
            "sde",
            "claude-4",
            200,
            150,
            30,
        ),
        make_session("s3", "Refactor", "failed", "cli", "gpt-4", 50, 10, 5),
        make_session("s4", "Debug", "running", "sde", "claude-4", 75, 25, 10),
        make_session("s5", "Tests", "completed", "os", "claude-4", 120, 80, 15),
    ]
}

#[test]
fn test_compute_statistics() {
    let sessions = sample_sessions();
    let stats = compute_session_statistics(&sessions);

    assert_eq!(stats.total_sessions, 5);
    assert_eq!(stats.total_events, 545); // 100+200+50+75+120
    assert!((stats.avg_events_per_session - 109.0).abs() < 0.1);
}

#[test]
fn test_status_counts() {
    let sessions = sample_sessions();
    let stats = compute_session_statistics(&sessions);

    let completed = stats
        .by_status
        .iter()
        .find(|s| s.status == "completed")
        .unwrap();
    assert_eq!(completed.count, 3);
    assert!((completed.percentage - 60.0).abs() < 0.1);

    let failed = stats
        .by_status
        .iter()
        .find(|s| s.status == "failed")
        .unwrap();
    assert_eq!(failed.count, 1);
}

#[test]
fn test_type_counts() {
    let sessions = sample_sessions();
    let stats = compute_session_statistics(&sessions);

    let coding = stats
        .by_type
        .iter()
        .find(|t| t.session_type == "sde")
        .unwrap();
    assert_eq!(coding.count, 3);

    let cli = stats
        .by_type
        .iter()
        .find(|t| t.session_type == "cli")
        .unwrap();
    assert_eq!(cli.count, 1);
}

#[test]
fn test_file_changes_aggregate() {
    let sessions = sample_sessions();
    let stats = compute_session_statistics(&sessions);

    assert_eq!(stats.total_file_changes.insertion, 315); // 50+150+10+25+80
    assert_eq!(stats.total_file_changes.deletion, 80); // 20+30+5+10+15
}

#[test]
fn test_model_usage() {
    let sessions = sample_sessions();
    let stats = compute_session_statistics(&sessions);

    let claude = stats
        .top_models
        .iter()
        .find(|m| m.model == "claude-4")
        .unwrap();
    assert_eq!(claude.session_count, 4);

    let gpt = stats
        .top_models
        .iter()
        .find(|m| m.model == "gpt-4")
        .unwrap();
    assert_eq!(gpt.session_count, 1);
}

#[test]
fn test_most_impactful() {
    let sessions = sample_sessions();
    let stats = compute_session_statistics(&sessions);

    assert!(!stats.most_impactful.is_empty());
    // s2 has most changes (150+30=180)
    assert_eq!(stats.most_impactful[0].session_id, "s2");
    assert_eq!(stats.most_impactful[0].total_changes, 180);
}

#[test]
fn test_daily_activity() {
    let sessions = sample_sessions();
    let stats = compute_session_statistics(&sessions);

    assert_eq!(stats.daily_activity.len(), 1); // all same day
    assert_eq!(stats.daily_activity[0].date, "2025-01-15");
    assert_eq!(stats.daily_activity[0].session_count, 5);
}

#[test]
fn test_empty_sessions() {
    let stats = compute_session_statistics(&[]);
    assert_eq!(stats.total_sessions, 0);
    assert_eq!(stats.total_events, 0);
    assert_eq!(stats.avg_events_per_session, 0.0);
}

#[test]
fn test_repo_activity() {
    let sessions = sample_sessions();
    let stats = compute_session_statistics(&sessions);

    assert_eq!(stats.top_repos.len(), 1); // all same repo
    assert_eq!(stats.top_repos[0].session_count, 5);
    assert_eq!(stats.top_repos[0].total_insertions, 315);
}
