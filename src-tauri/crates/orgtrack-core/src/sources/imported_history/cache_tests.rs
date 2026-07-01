use rusqlite::Connection;

use super::*;
use crate::sources::imported_history::metadata::{
    ImportedHistoryCacheInput, ImportedHistoryImpactStats, ImportedHistoryRecordSignature,
    SOURCE_CURSOR_IDE,
};

const TEST_OTHER_SOURCE: &str = "test_other_source";

fn fixture_conn() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    crate::store::sqlite::SqliteRecordStore::init_tables(&conn).expect("init core tables");
    crate::store::sqlite::SqliteRecordStore::init_source_cache_tables(&conn)
        .expect("init source cache tables");
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
        impact: ImportedHistoryImpactStats::default(),
        listable: true,
        source_metadata_json: None,
    }
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
fn cache_pruning_is_source_scoped() {
    let mut conn = fixture_conn();
    upsert_imported_session_cache_from_conn(
        &mut conn,
        &[
            input(SOURCE_CURSOR_IDE, "keep", 300),
            input(SOURCE_CURSOR_IDE, "drop", 200),
            input(TEST_OTHER_SOURCE, "other", 100),
        ],
    )
    .expect("upsert");

    prune_missing_records_from_conn(&conn, SOURCE_CURSOR_IDE, &["keep".to_string()])
        .expect("prune");

    let cursor_sessions = query_cached_sessions_for_source_from_conn(&conn, SOURCE_CURSOR_IDE)
        .expect("cursor sessions");
    let other_sessions = query_cached_sessions_for_source_from_conn(&conn, TEST_OTHER_SOURCE)
        .expect("other sessions");

    assert_eq!(cursor_sessions.len(), 1);
    assert_eq!(cursor_sessions[0].source_session_id, "keep");
    assert_eq!(other_sessions.len(), 1);
    assert_eq!(other_sessions[0].source_session_id, "other");
}

#[test]
fn cache_single_session_lookup_returns_source_metadata() {
    let mut conn = fixture_conn();
    let mut cached = input(SOURCE_CURSOR_IDE, "with-metadata", 100);
    cached.source_metadata_json = Some(r#"{"status":"completed","mode":"agent"}"#.to_string());
    upsert_imported_session_cache_from_conn(&mut conn, &[cached]).expect("upsert");

    let session = query_cached_session_from_conn(&conn, SOURCE_CURSOR_IDE, "with-metadata")
        .expect("query")
        .expect("session");

    assert_eq!(session.source_session_id, "with-metadata");
    assert_eq!(
        session.source_metadata_json.as_deref(),
        Some(r#"{"status":"completed","mode":"agent"}"#)
    );
}

#[test]
fn cache_source_list_filters_unlistable_sessions() {
    let mut conn = fixture_conn();
    let listed = input(SOURCE_CURSOR_IDE, "listed", 300);
    let mut hidden = input(SOURCE_CURSOR_IDE, "hidden", 200);
    hidden.listable = false;
    upsert_imported_session_cache_from_conn(&mut conn, &[listed, hidden]).expect("upsert");

    let sessions = query_cached_sessions_for_source_from_conn(&conn, SOURCE_CURSOR_IDE)
        .expect("query source sessions");

    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].source_session_id, "listed");
}

#[test]
fn changed_records_uses_cached_signatures() {
    let mut conn = fixture_conn();
    upsert_imported_session_cache_from_conn(&mut conn, &[input(SOURCE_CURSOR_IDE, "same", 100)])
        .expect("upsert");

    let unchanged = ImportedHistoryRecordSignature {
        source_session_id: "same".to_string(),
        source_path: "/tmp/same.jsonl".to_string(),
        source_mtime_ms: 100,
        source_size_bytes: 100,
        source_fingerprint: "100".to_string(),
        parser_version: 1,
    };
    let changed = ImportedHistoryRecordSignature {
        source_session_id: "changed".to_string(),
        source_path: "/tmp/changed.jsonl".to_string(),
        source_mtime_ms: 200,
        source_size_bytes: 100,
        source_fingerprint: "200".to_string(),
        parser_version: 1,
    };
    let discovered = vec![unchanged, changed];

    let changed_records =
        changed_records_from_conn(&conn, SOURCE_CURSOR_IDE, &discovered, |record| {
            record.clone()
        })
        .expect("changed records");

    assert_eq!(changed_records.len(), 1);
    assert_eq!(changed_records[0].source_session_id, "changed");
}
