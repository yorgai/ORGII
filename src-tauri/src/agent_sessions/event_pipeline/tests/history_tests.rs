use crate::agent_sessions::event_pipeline::history::{
    get_recent_sessions, group_sessions, query_sessions, FileChangeStats, HistoryQuery,
    SessionRecord,
};

fn make_session(id: &str, name: &str, status: &str, stype: &str, updated: &str) -> SessionRecord {
    SessionRecord {
        session_id: id.to_string(),
        name: name.to_string(),
        status: status.to_string(),
        session_type: stype.to_string(),
        repo_id: "repo-1".to_string(),
        repo_name: "my-project".to_string(),
        created_at: "2025-01-15T10:00:00.000Z".to_string(),
        updated_at: updated.to_string(),
        model: "claude-4".to_string(),
        event_count: 50,
        file_changes: FileChangeStats::default(),
        workflow_id: None,
        assigned_agent: None,
    }
}

fn sample_sessions() -> Vec<SessionRecord> {
    vec![
        make_session(
            "s1",
            "Fix auth bug",
            "completed",
            "sde",
            "2025-01-15T12:00:00.000Z",
        ),
        make_session(
            "s2",
            "Add tests",
            "running",
            "sde",
            "2025-01-15T14:00:00.000Z",
        ),
        make_session(
            "s3",
            "Refactor utils",
            "failed",
            "cli",
            "2025-01-15T11:00:00.000Z",
        ),
        make_session(
            "s4",
            "Update docs",
            "completed",
            "sde",
            "2025-01-15T13:00:00.000Z",
        ),
        make_session(
            "s5",
            "Debug perf issue",
            "pending",
            "os",
            "2025-01-15T15:00:00.000Z",
        ),
    ]
}

#[test]
fn test_query_no_filter() {
    let sessions = sample_sessions();
    let query = HistoryQuery::default();
    let result = query_sessions(&sessions, &query);

    assert_eq!(result.total_count, 5);
    assert_eq!(result.ongoing_count, 2); // running + pending
    assert_eq!(result.completed_count, 2);
    assert_eq!(result.failed_count, 1);
    // Default sort by updated_at desc → s5 first
    assert_eq!(result.sessions[0].session_id, "s5");
}

#[test]
fn test_query_status_filter() {
    let sessions = sample_sessions();
    let query = HistoryQuery {
        status_filter: Some("completed".to_string()),
        ..Default::default()
    };
    let result = query_sessions(&sessions, &query);

    assert_eq!(result.total_count, 2);
    assert!(result.sessions.iter().all(|s| s.status == "completed"));
}

#[test]
fn test_query_multi_status_filter() {
    let sessions = sample_sessions();
    let query = HistoryQuery {
        status_filter: Some("running,pending".to_string()),
        ..Default::default()
    };
    let result = query_sessions(&sessions, &query);

    assert_eq!(result.total_count, 2);
}

#[test]
fn test_query_type_filter() {
    let sessions = sample_sessions();
    let query = HistoryQuery {
        type_filter: Some("cli".to_string()),
        ..Default::default()
    };
    let result = query_sessions(&sessions, &query);

    assert_eq!(result.total_count, 1);
    assert_eq!(result.sessions[0].session_id, "s3");
}

#[test]
fn test_query_search_text() {
    let sessions = sample_sessions();
    let query = HistoryQuery {
        search_text: Some("auth".to_string()),
        ..Default::default()
    };
    let result = query_sessions(&sessions, &query);

    assert_eq!(result.total_count, 1);
    assert_eq!(result.sessions[0].name, "Fix auth bug");
}

#[test]
fn test_query_search_case_insensitive() {
    let sessions = sample_sessions();
    let query = HistoryQuery {
        search_text: Some("DEBUG".to_string()),
        ..Default::default()
    };
    let result = query_sessions(&sessions, &query);

    assert_eq!(result.total_count, 1);
    assert_eq!(result.sessions[0].session_id, "s5");
}

#[test]
fn test_query_sort_by_name() {
    let sessions = sample_sessions();
    let query = HistoryQuery {
        sort_by: "name".to_string(),
        sort_dir: "asc".to_string(),
        ..Default::default()
    };
    let result = query_sessions(&sessions, &query);

    assert_eq!(result.sessions[0].name, "Add tests");
    assert_eq!(result.sessions[4].name, "Update docs");
}

#[test]
fn test_query_pagination() {
    let sessions = sample_sessions();
    let query = HistoryQuery {
        limit: 2,
        offset: 0,
        ..Default::default()
    };
    let result = query_sessions(&sessions, &query);

    assert_eq!(result.sessions.len(), 2);
    assert_eq!(result.total_count, 5);

    // Page 2
    let query2 = HistoryQuery {
        limit: 2,
        offset: 2,
        ..Default::default()
    };
    let result2 = query_sessions(&sessions, &query2);
    assert_eq!(result2.sessions.len(), 2);
}

#[test]
fn test_get_recent() {
    let sessions = sample_sessions();
    let recent = get_recent_sessions(&sessions, 3);

    assert_eq!(recent.len(), 3);
    // Most recently updated first
    assert_eq!(recent[0].session_id, "s5");
    assert_eq!(recent[1].session_id, "s2");
    assert_eq!(recent[2].session_id, "s4");
}

#[test]
fn test_group_by_status() {
    let sessions = sample_sessions();
    let groups = group_sessions(&sessions, "status");

    assert!(groups.len() >= 3); // at least running, completed, failed
    let completed_group = groups.iter().find(|g| g.group_key == "completed").unwrap();
    assert_eq!(completed_group.count, 2);
    assert_eq!(completed_group.label, "Completed");
}

#[test]
fn test_group_by_type() {
    let sessions = sample_sessions();
    let groups = group_sessions(&sessions, "type");

    let coding_group = groups.iter().find(|g| g.group_key == "sde").unwrap();
    assert_eq!(coding_group.count, 3);
    assert_eq!(coding_group.label, "SDE Agent");
}

#[test]
fn test_group_by_date() {
    let sessions = sample_sessions();
    let groups = group_sessions(&sessions, "date");

    assert_eq!(groups.len(), 1); // all same date
    assert_eq!(groups[0].group_key, "2025-01-15");
}
