use super::*;
use rusqlite::Connection;
use serde_json::Value;

fn fixture_conn() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute(
        "CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        [],
    )
    .expect("create cursorDiskKV");

    let composer = r#"{
        "composerId":"composer-1",
        "name":"Build Windsurf import",
        "createdAt":1770000000000,
        "lastUpdatedAt":1770000005000,
        "status":"completed",
        "modelConfig":{"modelName":"windsurf-model"},
        "contextTokensUsed":123,
        "trackedGitRepos":[{"repoPath":"/tmp/windsurf-repo","branches":[{"branchName":"main"}]}],
        "fullConversationHeadersOnly":[
            {"bubbleId":"u1","type":1},
            {"bubbleId":"t1","type":2},
            {"bubbleId":"a1","type":2}
        ]
    }"#;
    let user_bubble = r#"{
        "type":1,
        "bubbleId":"u1",
        "createdAt":"2026-02-01T00:00:00Z",
        "text":"hello windsurf"
    }"#;
    let tool_bubble = r#"{
        "type":2,
        "bubbleId":"t1",
        "createdAt":"2026-02-01T00:00:01Z",
        "text":"",
        "toolFormerData":{
            "name":"terminal_command",
            "toolCallId":"call-1",
            "status":"completed",
            "params":"{\"command\":\"pwd\"}",
            "result":"{\"output\":\"/tmp/windsurf-repo\"}",
            "additionalData":{}
        }
    }"#;
    let assistant_bubble = r#"{
        "type":2,
        "bubbleId":"a1",
        "createdAt":"2026-02-01T00:00:02Z",
        "text":"done"
    }"#;

    conn.execute(
        "INSERT INTO cursorDiskKV (key, value) VALUES (?1, ?2)",
        ["composerData:composer-1", composer],
    )
    .expect("insert composer");
    conn.execute(
        "INSERT INTO cursorDiskKV (key, value) VALUES (?1, ?2)",
        ["bubbleId:composer-1:u1", user_bubble],
    )
    .expect("insert user bubble");
    conn.execute(
        "INSERT INTO cursorDiskKV (key, value) VALUES (?1, ?2)",
        ["bubbleId:composer-1:t1", tool_bubble],
    )
    .expect("insert tool bubble");
    conn.execute(
        "INSERT INTO cursorDiskKV (key, value) VALUES (?1, ?2)",
        ["bubbleId:composer-1:a1", assistant_bubble],
    )
    .expect("insert assistant bubble");

    conn
}

#[test]
fn includes_windsurf_candidate_db_paths() {
    let paths = windsurf_db_candidate_paths();
    let rendered = paths
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();

    assert!(rendered.iter().any(|path| path.contains("Windsurf")));
    assert!(rendered.iter().any(|path| path.contains(".windsurf")));
    assert!(!rendered.iter().any(|path| path.contains("Devin")));
    assert!(!rendered.iter().any(|path| path.contains(".devin")));
}

#[test]
fn lists_windsurf_sessions_from_state_db() {
    let conn = fixture_conn();

    let page = list_windsurf_history_sessions_from_conn(&conn, 10, 0).expect("list sessions");

    assert_eq!(page.sessions.len(), 1);
    let row = &page.sessions[0];
    assert_eq!(row.session_id, "windsurfapp-composer-1");
    assert_eq!(row.name, "Build Windsurf import");
    assert_eq!(row.category, imported_history::IMPORTED_HISTORY_CATEGORY);
    assert!(row.read_only);
    assert_eq!(row.model.as_deref(), Some("windsurf-model"));
    assert_eq!(row.total_tokens, 123);
    assert_eq!(row.repo_path.as_deref(), Some("/tmp/windsurf-repo"));
    assert_eq!(row.repo_name.as_deref(), Some("windsurf-repo"));
    assert_eq!(row.branch.as_deref(), Some("main"));
}

#[test]
fn parses_windsurf_bubbles_into_replay_chunks() {
    let conn = fixture_conn();

    let chunks = load_windsurf_history_from_conn(&conn, "windsurfapp-composer-1", "composer-1")
        .expect("load chunks");

    assert_eq!(chunks.len(), 3);
    assert_eq!(chunks[0].action_type, imported_history::ACTION_TYPE_RAW);
    assert_eq!(chunks[0].function, imported_history::FUNCTION_USER_MESSAGE);
    assert_eq!(
        chunks[1].action_type,
        imported_history::ACTION_TYPE_TOOL_CALL
    );
    assert_eq!(
        chunks[1].function,
        imported_history::FUNCTION_RUN_COMMAND_LINE
    );
    assert_eq!(
        chunks[1].args.get("command").and_then(Value::as_str),
        Some("pwd")
    );
    assert_eq!(
        chunks[1].result.get("output").and_then(Value::as_str),
        Some("/tmp/windsurf-repo")
    );
    assert_eq!(
        chunks[2].action_type,
        imported_history::ACTION_TYPE_ASSISTANT
    );
    assert_eq!(chunks[2].function, imported_history::FUNCTION_ASSISTANT);
}
