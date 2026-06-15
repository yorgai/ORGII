use database::db::get_connection;
use orgtrack_core::canonical::{
    AgentMetadata, SessionRecord, SOURCE_ORGII_CLI_SESSIONS, SOURCE_ORGII_RUST_AGENTS,
};
use orgtrack_core::privacy::ORGTRACK_SCHEMA_VERSION;
use orgtrack_core::store::{sqlite::SqliteRecordStore, RecordStore};

use super::types::{SessionAggregateRecord, SessionCategory};

pub fn upsert_aggregate_sessions(records: &[SessionAggregateRecord]) -> Result<(), String> {
    if records.is_empty() {
        return Ok(());
    }
    let conn = get_connection().map_err(|err| err.to_string())?;
    let store = SqliteRecordStore::new(&conn);
    for record in records {
        store.upsert_session(&aggregate_to_core_session(record))?;
    }
    Ok(())
}

fn aggregate_to_core_session(record: &SessionAggregateRecord) -> SessionRecord {
    let source = match record.category {
        SessionCategory::Cli | SessionCategory::RemoteShared => SOURCE_ORGII_CLI_SESSIONS,
        SessionCategory::Agent | SessionCategory::Os => SOURCE_ORGII_RUST_AGENTS,
    };
    SessionRecord {
        schema_version: ORGTRACK_SCHEMA_VERSION,
        source: source.to_string(),
        source_session_id: record
            .source_session_id
            .clone()
            .unwrap_or_else(|| record.session_id.clone()),
        session_id: record.session_id.clone(),
        title: record.name.clone(),
        status: Some(record.status.clone()),
        created_at: Some(record.created_at.clone()),
        updated_at: Some(record.updated_at.clone()),
        completed_at: record.ended_at.clone(),
        workspace_path: record
            .repo_path
            .clone()
            .or_else(|| record.worktree_path.clone()),
        branch: record
            .branch
            .clone()
            .or_else(|| record.worktree_branch.clone()),
        parent_session_id: record.parent_session_id.clone(),
        org_member_id: record.org_member_id.clone(),
        metadata: AgentMetadata {
            dispatch_category: Some(dispatch_category_for(record.category).to_string()),
            rust_agent_type: rust_agent_type_for(record),
            cli_agent_type: record.cli_agent_type.clone(),
            agent_exec_mode: record.agent_exec_mode.clone(),
            provider_model_type: None,
            model: record.model.clone(),
            key_source: Some(record.key_source.to_string()),
            origin: Some(source.to_string()),
            display_name: record
                .agent_display_name
                .clone()
                .or_else(|| record.display_label.clone())
                .or_else(|| Some(record.name.clone())),
            parsed_categories: Default::default(),
        },
    }
}

fn dispatch_category_for(category: SessionCategory) -> &'static str {
    match category {
        SessionCategory::Cli | SessionCategory::RemoteShared => "cli_agent",
        SessionCategory::Agent | SessionCategory::Os => "rust_agent",
    }
}

fn rust_agent_type_for(record: &SessionAggregateRecord) -> Option<String> {
    match record.category {
        SessionCategory::Os => Some("os".to_string()),
        SessionCategory::Agent => {
            if record.session_id.starts_with("sdeagent-") {
                Some("sde".to_string())
            } else if record.session_id.starts_with("gateway-") {
                Some("gateway".to_string())
            } else {
                Some("custom".to_string())
            }
        }
        SessionCategory::Cli | SessionCategory::RemoteShared => None,
    }
}
