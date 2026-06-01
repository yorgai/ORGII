//! Wire-side adapter for `agent_core::foundation::db_bridge` and the
//! token-usage / event-rollback slots on `session_bridge`.
//!
//! Registers concrete implementations from this crate into agent_core's
//! IoC slots so agent_core's memory, consolidation, reflection, learnings,
//! turn processor, and rollback paths can persist state without depending
//! back on `session_persistence`.
//!
//! Called once at startup via [`register`].

use agent_core::foundation::{db_bridge, session_bridge};

/// Adapter that maps a `TokenUsageRow` projection into the live
/// `insert_token_usage_record` call.
fn record_token_usage_adapter(row: session_bridge::TokenUsageRow<'_>) -> rusqlite::Result<i64> {
    super::token_usage::insert_token_usage_record(
        row.session_id,
        row.session_type,
        row.model,
        row.account_id,
        row.input_tokens,
        row.output_tokens,
        row.cache_read_tokens,
        row.cache_write_tokens,
        row.total_tokens,
        row.context_tokens,
    )
}

/// Register all `agent_sessions`-backed slots on agent_core's bridges.
pub fn register() {
    db_bridge::register(super::get_connection);
    session_bridge::register_record_token_usage(record_token_usage_adapter);
    session_bridge::register_delete_last_user_event(super::delete_last_user_event_and_after);
}
