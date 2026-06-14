use rusqlite::Connection;

use super::*;
use crate::imported_history::metadata::{
    ImportedHistoryCacheInput, ImportedHistoryRecordSignature, SOURCE_CODEX_APP, SOURCE_OPENCODE,
};

fn fixture_conn() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch(
        "
        CREATE TABLE imported_history_session_cache (
            source              TEXT NOT NULL,
            source_session_id   TEXT NOT NULL,
            session_id          TEXT NOT NULL,
            source_path         TEXT NOT NULL DEFAULT '',
            source_record_key   TEXT NOT NULL DEFAULT '',
            source_mtime_ms     INTEGER NOT NULL DEFAULT 0,
            source_size_bytes   INTEGER NOT NULL DEFAULT 0,
            source_fingerprint  TEXT NOT NULL DEFAULT '',
            parser_version      INTEGER NOT NULL DEFAULT 0,
            name                TEXT NOT NULL DEFAULT '',
            created_at_ms       INTEGER NOT NULL DEFAULT 0,
            updated_at_ms       INTEGER NOT NULL DEFAULT 0,
            model               TEXT NOT NULL DEFAULT '',
            input_tokens        INTEGER NOT NULL DEFAULT 0,
            output_tokens       INTEGER NOT NULL DEFAULT 0,
            repo_path           TEXT NOT NULL DEFAULT '',
            branch              TEXT NOT NULL DEFAULT '',
            listable            INTEGER NOT NULL DEFAULT 1,
            updated_at          TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (source, source_session_id)
        );
        CREATE INDEX idx_imported_history_source_updated
            ON imported_history_session_cache(source, updated_at_ms DESC);
        CREATE INDEX idx_imported_history_source_repo
            ON imported_history_session_cache(source, repo_path);
        CREATE INDEX idx_imported_history_source_path
            ON imported_history_session_cache(source, source_path);
        ",
    )
    .expect("create cache table");
    conn
}

fn input(
    source: &'static str,
    source_session_id: &str,
    updated_at_ms: i64,
) -> ImportedHistoryCacheInput {
    ImportedHistoryCacheInput {
        source,
        source_session_id: source_session_id.to_string(),
        session_id: format!("{source}-{source_session_id}"),
        source_path: format!("/tmp/{source_session_id}.jsonl"),
        source_record_key: source_session_id.to_string(),
        source_mtime_ms: updated_at_ms,
        source_size_bytes: 100,
        source_fingerprint: updated_at_ms.to_string(),
        parser_version: 1,
        name: format!("Session {source_session_id}"),
        created_at_ms: updated_at_ms - 10,
        updated_at_ms,
        model: Some("model-a".to_string()),
        input_tokens: 3,
        output_tokens: 4,
        repo_path: Some(format!("/tmp/repo-{source_session_id}")),
        branch: Some("main".to_string()),
        listable: true,
    }
}

#[test]
fn cache_query_paginates_newest_first() {
    let mut conn = fixture_conn();
    upsert_imported_session_cache_from_conn(
        &mut conn,
        &[
            input(SOURCE_CODEX_APP, "old", 100),
            input(SOURCE_CODEX_APP, "new", 300),
            input(SOURCE_CODEX_APP, "mid", 200),
        ],
    )
    .expect("upsert");

    let page = query_imported_session_page_from_conn(&conn, SOURCE_CODEX_APP, 2, 0).expect("page");

    assert!(page.has_more);
    assert_eq!(page.sessions.len(), 2);
    assert_eq!(page.sessions[0].session_id, "codex_app-new");
    assert_eq!(page.sessions[1].session_id, "codex_app-mid");
}

#[test]
fn cache_pruning_is_source_scoped() {
    let mut conn = fixture_conn();
    upsert_imported_session_cache_from_conn(
        &mut conn,
        &[
            input(SOURCE_CODEX_APP, "keep", 300),
            input(SOURCE_CODEX_APP, "drop", 200),
            input(SOURCE_OPENCODE, "other", 100),
        ],
    )
    .expect("upsert");

    prune_missing_records_from_conn(&conn, SOURCE_CODEX_APP, &["keep".to_string()]).expect("prune");

    let codex =
        query_imported_session_page_from_conn(&conn, SOURCE_CODEX_APP, 10, 0).expect("codex");
    let opencode =
        query_imported_session_page_from_conn(&conn, SOURCE_OPENCODE, 10, 0).expect("opencode");

    assert_eq!(codex.sessions.len(), 1);
    assert_eq!(codex.sessions[0].session_id, "codex_app-keep");
    assert_eq!(opencode.sessions.len(), 1);
    assert_eq!(opencode.sessions[0].session_id, "opencode-other");
}

#[test]
fn cache_signature_comparison_detects_changed_records() {
    let cached = ImportedHistoryRecordSignature {
        source_session_id: "a".to_string(),
        source_path: "/tmp/a.jsonl".to_string(),
        source_mtime_ms: 1,
        source_size_bytes: 2,
        source_fingerprint: "fp".to_string(),
        parser_version: 1,
    };
    let mut changed = cached.clone();
    changed.source_mtime_ms = 2;

    assert!(record_matches_cached_signature(&cached, &cached));
    assert!(!record_matches_cached_signature(&cached, &changed));
}

#[test]
fn cache_recent_paths_are_deduped_and_limited() {
    let mut conn = fixture_conn();
    let mut older = input(SOURCE_CODEX_APP, "older", 100);
    older.repo_path = Some("/tmp/shared".to_string());
    let mut newer = input(SOURCE_CODEX_APP, "newer", 300);
    newer.repo_path = Some("/tmp/shared".to_string());
    upsert_imported_session_cache_from_conn(&mut conn, &[older, newer]).expect("upsert");

    let paths = query_imported_recent_paths_from_conn(&conn, SOURCE_CODEX_APP, 1).expect("paths");

    assert_eq!(paths.len(), 1);
    assert_eq!(paths[0].path, "/tmp/shared");
    assert_eq!(paths[0].session_count, 2);
}
