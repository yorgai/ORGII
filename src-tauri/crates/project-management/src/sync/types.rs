//! Wire types for the outbox + sync layer.
//!
//! Every domain string lives behind a typed enum here; the SQL layer
//! never sees a raw `"pending"` or `"create"` literal. Conversions go
//! through [`OutboxStatus::as_db_str`] / [`OutboxStatus::from_db_str`]
//! and the matching `OutboxOp` helpers.

use serde::{Deserialize, Serialize};
use std::fmt;

/// One row in the `outbox_entries` table.
///
/// `id` is `None` until the row has been persisted; [`super::io::append`]
/// fills it from the `last_insert_rowid` after the INSERT.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboxEntry {
    pub id: Option<i64>,
    pub project_slug: String,
    pub entity_type: EntityType,
    pub entity_id: String,
    pub op: OutboxOp,
    pub field_path: Option<String>,
    /// Adapter-specific JSON payload (new field value, full entity, …).
    pub payload_json: String,
    /// Unix-epoch milliseconds.
    pub created_at: i64,
    pub retry_count: u32,
    /// Unix-epoch milliseconds of the most recent attempt; `None` when
    /// the row has never been claimed by the worker.
    pub last_attempted_at: Option<i64>,
    pub last_error: Option<String>,
    pub status: OutboxStatus,
}

/// Outcome returned by [`super::adapter::SyncAdapter::push`].
pub type SyncResult = Result<crate::sync::adapter::SyncOutcome, SyncError>;

/// Error emitted by adapter operations.
///
/// Carries enough context for the worker to choose the right backoff
/// (`Transient` retries; `Permanent` abandons immediately; `RateLimited`
/// honors the adapter-supplied retry-after).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncError {
    /// Network blip, 5xx, …; retry per backoff.
    Transient(String),
    /// 4xx (other than auth/rate-limit), invalid payload, …; abandon now.
    Permanent(String),
    /// Adapter signaled rate limit; retry after `retry_after_secs`.
    RateLimited {
        message: String,
        retry_after_secs: u64,
    },
    /// Auth token missing / invalid; treat as permanent until the user
    /// re-attaches.
    AuthFailed(String),
}

impl fmt::Display for SyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SyncError::Transient(msg) => write!(f, "transient: {}", msg),
            SyncError::Permanent(msg) => write!(f, "permanent: {}", msg),
            SyncError::RateLimited {
                message,
                retry_after_secs,
            } => {
                write!(
                    f,
                    "rate-limited (retry in {}s): {}",
                    retry_after_secs, message
                )
            }
            SyncError::AuthFailed(msg) => write!(f, "auth failed: {}", msg),
        }
    }
}

impl std::error::Error for SyncError {}

impl SyncError {
    /// Whether this error class should retry per the worker backoff
    /// curve (true) or be abandoned immediately (false).
    pub fn is_retryable(&self) -> bool {
        match self {
            SyncError::Transient(_) | SyncError::RateLimited { .. } => true,
            SyncError::Permanent(_) | SyncError::AuthFailed(_) => false,
        }
    }
}

/// Outbox op classifier. Stored as a TEXT column; conversions go
/// through [`OutboxOp::as_db_str`] / [`OutboxOp::from_db_str`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutboxOp {
    Create,
    Update,
    Delete,
    /// External change observed during a pull cycle; payload describes
    /// the merged result so a follow-up push (if needed) is well-formed.
    MergeExternal,
}

impl OutboxOp {
    pub fn as_db_str(self) -> &'static str {
        match self {
            OutboxOp::Create => "create",
            OutboxOp::Update => "update",
            OutboxOp::Delete => "delete",
            OutboxOp::MergeExternal => "merge_external",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self, String> {
        match value {
            "create" => Ok(OutboxOp::Create),
            "update" => Ok(OutboxOp::Update),
            "delete" => Ok(OutboxOp::Delete),
            "merge_external" => Ok(OutboxOp::MergeExternal),
            other => Err(format!("unknown OutboxOp: {}", other)),
        }
    }
}

/// Outbox row lifecycle. See `Documentation/Shared/pluggable-sync-framework-plan--0430.md`
/// §"Outbox Schema" for the full state machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutboxStatus {
    Pending,
    InFlight,
    Succeeded,
    Failed,
    Abandoned,
}

impl OutboxStatus {
    pub fn as_db_str(self) -> &'static str {
        match self {
            OutboxStatus::Pending => "pending",
            OutboxStatus::InFlight => "in_flight",
            OutboxStatus::Succeeded => "succeeded",
            OutboxStatus::Failed => "failed",
            OutboxStatus::Abandoned => "abandoned",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self, String> {
        match value {
            "pending" => Ok(OutboxStatus::Pending),
            "in_flight" => Ok(OutboxStatus::InFlight),
            "succeeded" => Ok(OutboxStatus::Succeeded),
            "failed" => Ok(OutboxStatus::Failed),
            "abandoned" => Ok(OutboxStatus::Abandoned),
            other => Err(format!("unknown OutboxStatus: {}", other)),
        }
    }
}

/// Bulk historical import lifecycle. One row per
/// `(project_slug, adapter_id)` lives in `import_progress` and walks
/// the state machine:
///
/// ```text
///   Pending ──► Running ──► Completed
///                  │
///                  ├──► Cancelled  (user clicked cancel)
///                  └──► Failed     (SyncError::Permanent)
/// ```
///
/// `Pending` is "row created at attach time, no page applied yet" —
/// the worker promotes it to `Running` after the first successful
/// page. Terminal states (`Completed` / `Cancelled` / `Failed`) keep
/// the row around so a detach + re-attach doesn't re-import; the UI
/// uses the terminal state to decide whether to show a "retry" /
/// "view summary" affordance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportState {
    Pending,
    Running,
    Completed,
    Cancelled,
    Failed,
}

impl ImportState {
    pub fn as_db_str(self) -> &'static str {
        match self {
            ImportState::Pending => "pending",
            ImportState::Running => "running",
            ImportState::Completed => "completed",
            ImportState::Cancelled => "cancelled",
            ImportState::Failed => "failed",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self, String> {
        match value {
            "pending" => Ok(ImportState::Pending),
            "running" => Ok(ImportState::Running),
            "completed" => Ok(ImportState::Completed),
            "cancelled" => Ok(ImportState::Cancelled),
            "failed" => Ok(ImportState::Failed),
            other => Err(format!("unknown ImportState: {}", other)),
        }
    }

    /// Whether the state is terminal — no more pages will be fetched
    /// without a manual "retry" action from the user.
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            ImportState::Completed | ImportState::Cancelled | ImportState::Failed
        )
    }
}

/// Entity type referenced by an outbox row. Mirrors the project-store
/// table layout 1:1 — anything outside this enum has no sync mapping.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityType {
    WorkItem,
    Project,
    Label,
    Milestone,
    Member,
}

impl EntityType {
    pub fn as_db_str(self) -> &'static str {
        match self {
            EntityType::WorkItem => "work_item",
            EntityType::Project => "project",
            EntityType::Label => "label",
            EntityType::Milestone => "milestone",
            EntityType::Member => "member",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self, String> {
        match value {
            "work_item" => Ok(EntityType::WorkItem),
            "project" => Ok(EntityType::Project),
            "label" => Ok(EntityType::Label),
            "milestone" => Ok(EntityType::Milestone),
            "member" => Ok(EntityType::Member),
            other => Err(format!("unknown EntityType: {}", other)),
        }
    }
}

/// Wire shape returned by `project_sync_list_problems`.
///
/// Mirror of [`OutboxEntry`] tightened for the "Failed entries" UI in
/// `SyncSection`: only `Failed` / `Abandoned` rows show up here, and
/// `id` is non-optional because every row reaching this surface has
/// already been persisted (`OutboxEntry::id` is `None` only between
/// constructor and `append`).
///
/// Status / op / entity_type all serialize as `snake_case` strings
/// per the existing serde rename on the underlying enums, so the
/// TypeScript wrapper can reuse the string-union types it already
/// understands.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboxProblemRow {
    pub id: i64,
    pub entity_type: EntityType,
    pub entity_id: String,
    pub op: OutboxOp,
    pub field_path: Option<String>,
    pub created_at: i64,
    pub last_attempted_at: Option<i64>,
    pub retry_count: u32,
    pub last_error: Option<String>,
    pub status: OutboxStatus,
    pub payload_json: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outbox_op_roundtrip() {
        for op in [
            OutboxOp::Create,
            OutboxOp::Update,
            OutboxOp::Delete,
            OutboxOp::MergeExternal,
        ] {
            assert_eq!(OutboxOp::from_db_str(op.as_db_str()).unwrap(), op);
        }
    }

    #[test]
    fn outbox_status_roundtrip() {
        for status in [
            OutboxStatus::Pending,
            OutboxStatus::InFlight,
            OutboxStatus::Succeeded,
            OutboxStatus::Failed,
            OutboxStatus::Abandoned,
        ] {
            assert_eq!(
                OutboxStatus::from_db_str(status.as_db_str()).unwrap(),
                status
            );
        }
    }

    #[test]
    fn entity_type_roundtrip() {
        for kind in [
            EntityType::WorkItem,
            EntityType::Project,
            EntityType::Label,
            EntityType::Milestone,
            EntityType::Member,
        ] {
            assert_eq!(EntityType::from_db_str(kind.as_db_str()).unwrap(), kind);
        }
    }

    #[test]
    fn unknown_op_errors() {
        assert!(OutboxOp::from_db_str("bogus").is_err());
    }

    #[test]
    fn sync_error_retryable_classification() {
        assert!(SyncError::Transient("net".into()).is_retryable());
        assert!(SyncError::RateLimited {
            message: "too fast".into(),
            retry_after_secs: 60
        }
        .is_retryable());
        assert!(!SyncError::Permanent("bad".into()).is_retryable());
        assert!(!SyncError::AuthFailed("token".into()).is_retryable());
    }
}
