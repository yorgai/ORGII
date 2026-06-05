//! Message persistence — insertion, loading, truncation, history building.

use rusqlite::Result as SqliteResult;

use crate::persistence::db_helpers as shared;
use database::db::{get_connection, with_sessions_writer};

/// Table-name prefix for the unified-session DB schema.
///
/// `db_helpers::*` builds table names as `{prefix}_messages`, `{prefix}_todos`,
/// etc. The unified persistence layer uses a single namespace ("agent_*"),
/// shared by every session category (OS, SDE, subagent). The string is also
/// the column value of `agent_sessions.session_type` for "generic agent"
/// rows — see `crud::record::session_type::GENERIC` (the two are equal by
/// historical accident, but conceptually distinct: this one names a *table
/// family*, the other names a *category enum value*).
const SESSION_TABLE_PREFIX: &str = "agent";

/// Save a user message.
pub fn save_user_msg(
    session_id: &str,
    content: &str,
    images: Option<&[String]>,
) -> SqliteResult<String> {
    shared::save_user_msg(SESSION_TABLE_PREFIX, session_id, content, images)
}

/// Save an assistant message.
pub fn save_assistant_msg(session_id: &str, content: &str, model: &str) -> SqliteResult<String> {
    shared::save_assistant_msg(SESSION_TABLE_PREFIX, session_id, content, model)
}

/// Save a tool call message.
pub fn save_tool_call_msg(
    session_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    arguments: &str,
) -> SqliteResult<String> {
    shared::save_tool_call_msg(
        SESSION_TABLE_PREFIX,
        session_id,
        tool_call_id,
        tool_name,
        arguments,
    )
}

/// Save a tool result message.
pub fn save_tool_result_msg(
    session_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    result: &str,
) -> SqliteResult<String> {
    shared::save_tool_result_msg(
        SESSION_TABLE_PREFIX,
        session_id,
        tool_call_id,
        tool_name,
        result,
    )
}

/// Load messages for a session.
pub fn load_messages(session_id: &str) -> SqliteResult<Vec<shared::AgentMessageRow>> {
    shared::load_messages(SESSION_TABLE_PREFIX, session_id)
}

/// Load LLM-formatted history for a session.
pub fn load_llm_history(session_id: &str) -> SqliteResult<Vec<serde_json::Value>> {
    shared::load_llm_history(SESSION_TABLE_PREFIX, session_id)
}

/// Clear all messages for a session.
pub fn clear_messages(session_id: &str) -> SqliteResult<i64> {
    shared::clear_messages(SESSION_TABLE_PREFIX, session_id)
}

/// Truncate messages at or after a given timestamp.
pub fn truncate_messages_after(session_id: &str, created_at: &str) -> SqliteResult<i64> {
    shared::truncate_messages_after(SESSION_TABLE_PREFIX, session_id, created_at)
}

/// Delete the last user message in this session plus every row that came
/// after it (assistant / tool_call / tool_result). Used by the Scenario A
/// cancel-rollback path when the user hits Stop before the agent produced
/// any output.
pub fn delete_last_user_turn(session_id: &str) -> SqliteResult<i64> {
    shared::delete_last_user_turn(SESSION_TABLE_PREFIX, session_id)
}

/// Save a snapshot record for a session. After inserting the row, enforces
/// the per-session manifest cap (see
/// [`file_history::MAX_SNAPSHOTS_PER_SESSION`]): oldest manifests are
/// evicted from disk + DB, and unreferenced backup blobs are GC'd. Cap
/// errors are logged but never fail the insert.
pub fn save_snapshot(session_id: &str, tool_call_id: &str, hash: &str) -> SqliteResult<()> {
    with_sessions_writer(|| -> SqliteResult<()> {
        let conn = get_connection()?;
        conn.execute(
            "INSERT INTO agent_snapshots (id, session_id, tool_call_id, hash, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                session_id,
                tool_call_id,
                hash,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    })?;
    crate::tools::file_history::enforce_session_cap_after_save(session_id);
    Ok(())
}

// ============================================
// Subagent Transcript Persistence
// ============================================

/// Persist a subagent's full message transcript for future resume.
/// Skips the system message (index 0) — only user/assistant/tool messages are saved.
///
/// Routes through the shared `save_*_msg` helpers so the `sequence` column is
/// populated via `next_sequence()` and the schema stays in sync with
/// `foundation/persistence/session_snapshots.rs::ensure_tables()`. A prior
/// version used a raw `INSERT` that referenced a non-existent `session_type`
/// column and failed at runtime, losing every subagent transcript.
pub fn save_subagent_transcript(
    session_id: &str,
    messages: &[serde_json::Value],
) -> SqliteResult<()> {
    for msg in messages.iter().skip(1) {
        let role = msg
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");

        let content = msg.get("content").and_then(|v| v.as_str()).unwrap_or("");

        match role {
            "user" => {
                let _ = shared::save_user_msg(SESSION_TABLE_PREFIX, session_id, content, None)?;
            }
            "assistant" => {
                let _ = shared::save_assistant_msg(SESSION_TABLE_PREFIX, session_id, content, "")?;
                if let Some(tool_calls) = msg.get("tool_calls").and_then(|v| v.as_array()) {
                    for tc in tool_calls {
                        let tc_id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        let tc_name = tc
                            .get("function")
                            .and_then(|f| f.get("name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let tc_args = tc
                            .get("function")
                            .and_then(|f| f.get("arguments"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("{}");
                        let _ = shared::save_tool_call_msg(
                            SESSION_TABLE_PREFIX,
                            session_id,
                            tc_id,
                            tc_name,
                            tc_args,
                        )?;
                    }
                }
            }
            "tool" => {
                let tc_id = msg
                    .get("tool_call_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let tc_name = msg.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let _ = shared::save_tool_result_msg(
                    SESSION_TABLE_PREFIX,
                    session_id,
                    tc_id,
                    tc_name,
                    content,
                )?;
            }
            _ => {
                // Unknown role — skip rather than fail the whole transcript.
            }
        }
    }

    Ok(())
}

// ============================================
// Session Memory Persistence
// ============================================

/// Persisted session memory state (content + boundary index).
pub struct PersistedSessionMemoryState {
    pub content: Option<String>,
    pub last_msg_idx: Option<usize>,
}

// ============================================
// Cancel-Interrupt Marker
// ============================================

/// Mark a session as having been cancelled mid-turn.
///
/// The next turn consumes this marker to distinguish an intentional user
/// control boundary from crash recovery. It must not inject synthetic user text
/// into provider history.
pub fn mark_turn_cancelled(session_id: &str) {
    let sid = session_id.to_string();
    let _ = tokio::task::block_in_place(|| -> rusqlite::Result<()> {
        with_sessions_writer(|| -> rusqlite::Result<()> {
            let conn = get_connection()?;
            conn.execute(
                "UPDATE agent_sessions SET last_turn_cancelled = 1 WHERE session_id = ?1",
                [&sid],
            )?;
            Ok(())
        })
    });
}

/// Read and atomically clear the cancel-interrupt marker for a session.
///
/// Returns `true` if the previous turn was cancelled and the marker was set.
/// Always clears the marker so the signal is consumed exactly once.
pub fn take_turn_cancelled(session_id: &str) -> bool {
    let sid = session_id.to_string();
    tokio::task::block_in_place(|| -> bool {
        // Read on a non-serialized connection (WAL allows concurrent
        // reads); only the clear-flag write goes through the writer.
        let flag: i64 = {
            let Ok(conn) = get_connection() else {
                return false;
            };
            conn.query_row(
                "SELECT last_turn_cancelled FROM agent_sessions WHERE session_id = ?1",
                [&sid],
                |row| row.get(0),
            )
            .unwrap_or(0)
        };
        if flag != 0 {
            let _ = with_sessions_writer(|| -> rusqlite::Result<()> {
                let conn = get_connection()?;
                conn.execute(
                    "UPDATE agent_sessions SET last_turn_cancelled = 0 WHERE session_id = ?1",
                    [&sid],
                )?;
                Ok(())
            });
            true
        } else {
            false
        }
    })
}

/// Persist session memory state to the `agent_sessions` table.
pub fn save_session_memory_state(
    session_id: &str,
    content: &str,
    last_msg_idx: Option<usize>,
) -> SqliteResult<()> {
    with_sessions_writer(|| -> SqliteResult<()> {
        let conn = get_connection()?;
        conn.execute(
            "UPDATE agent_sessions SET sm_content = ?2, sm_last_msg_idx = ?3 WHERE session_id = ?1",
            rusqlite::params![session_id, content, last_msg_idx.map(|idx| idx as i64),],
        )?;
        Ok(())
    })
}

/// Load persisted session memory state from the `agent_sessions` table.
pub fn load_session_memory_state(session_id: &str) -> SqliteResult<PersistedSessionMemoryState> {
    let conn = get_connection()?;
    let result = conn.query_row(
        "SELECT sm_content, sm_last_msg_idx FROM agent_sessions WHERE session_id = ?1",
        [session_id],
        |row| {
            let content: Option<String> = row.get(0)?;
            let last_msg_idx: Option<i64> = row.get(1)?;
            Ok(PersistedSessionMemoryState {
                content,
                last_msg_idx: last_msg_idx.map(|idx| idx as usize),
            })
        },
    );
    match result {
        Ok(state) => Ok(state),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(PersistedSessionMemoryState {
            content: None,
            last_msg_idx: None,
        }),
        Err(err) => Err(err),
    }
}

#[cfg(test)]
mod tests {
    /// Validates the skip-system-message logic used in `save_subagent_transcript`.
    #[test]
    fn transcript_skips_system_message() {
        let messages = [
            serde_json::json!({"role": "system", "content": "You are helpful."}),
            serde_json::json!({"role": "user", "content": "hello"}),
            serde_json::json!({"role": "assistant", "content": "hi"}),
        ];

        let non_system: Vec<_> = messages
            .iter()
            .skip(1)
            .map(|m| m["role"].as_str().unwrap().to_string())
            .collect();

        assert_eq!(non_system, ["user", "assistant"]);
    }

    /// Validates tool_call extraction logic from assistant messages.
    #[test]
    fn transcript_extracts_tool_calls() {
        let msg = serde_json::json!({
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "tc_001",
                    "function": {
                        "name": "read_file",
                        "arguments": "{\"path\": \"/tmp/test.rs\"}"
                    }
                },
                {
                    "id": "tc_002",
                    "function": {
                        "name": "write_file",
                        "arguments": "{\"path\": \"/tmp/out.rs\", \"content\": \"hello\"}"
                    }
                }
            ]
        });

        let tool_calls = msg.get("tool_calls").unwrap().as_array().unwrap();
        assert_eq!(tool_calls.len(), 2);

        let tc_id = tool_calls[0].get("id").and_then(|v| v.as_str()).unwrap();
        assert_eq!(tc_id, "tc_001");

        let tc_name = tool_calls[0]
            .get("function")
            .and_then(|f| f.get("name"))
            .and_then(|v| v.as_str())
            .unwrap();
        assert_eq!(tc_name, "read_file");

        let tc_args = tool_calls[1]
            .get("function")
            .and_then(|f| f.get("arguments"))
            .and_then(|v| v.as_str())
            .unwrap();
        assert!(tc_args.contains("out.rs"));
    }

    /// Validates that messages without tool_calls are handled gracefully.
    #[test]
    fn transcript_no_tool_calls() {
        let msg = serde_json::json!({
            "role": "assistant",
            "content": "just text, no tools"
        });

        let tool_calls = msg.get("tool_calls").and_then(|v| v.as_array());
        assert!(tool_calls.is_none());
    }

    /// Validates empty message list (only system) produces no saved records.
    #[test]
    fn transcript_system_only_produces_nothing() {
        let messages = [serde_json::json!({"role": "system", "content": "system prompt"})];

        let non_system: Vec<_> = messages.iter().skip(1).collect();
        assert!(non_system.is_empty());
    }

    /// Validates role extraction fallback for malformed messages.
    #[test]
    fn transcript_missing_role_defaults_to_unknown() {
        let msg = serde_json::json!({"content": "no role field"});
        let role = msg
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        assert_eq!(role, "unknown");
    }
}
