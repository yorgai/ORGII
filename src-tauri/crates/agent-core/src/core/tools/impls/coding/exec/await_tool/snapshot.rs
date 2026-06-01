//! Per-handle snapshot types and status resolution helpers.
//!
//! `HandleSnapshot` is the canonical representation of one handle at a point
//! in time, used by both `wait_for` and `monitor` to render the response body
//! and feed `awaitMeta::items`.

use serde_json::Value;

use super::super::registry;

pub(super) const AWAIT_STATUS_RUNNING: &str = "running";
pub(super) const AWAIT_STATUS_SUCCEEDED: &str = "succeeded";
pub(super) const AWAIT_STATUS_FAILED: &str = "failed";

pub(super) fn job_kind_label(kind: &registry::JobKind) -> &'static str {
    match kind {
        registry::JobKind::Shell { .. } => "shell",
        registry::JobKind::Subagent { .. } => "subagent",
    }
}

pub(super) struct ResolvedStatus {
    pub status: &'static str,
    pub exit_code: Option<i32>,
    pub killed: bool,
}

pub(super) fn resolve_status(job_status: &registry::JobStatus) -> ResolvedStatus {
    match job_status {
        registry::JobStatus::Running => ResolvedStatus {
            status: AWAIT_STATUS_RUNNING,
            exit_code: None,
            killed: false,
        },
        registry::JobStatus::Exited(code) => {
            if *code == 0 {
                ResolvedStatus {
                    status: AWAIT_STATUS_SUCCEEDED,
                    exit_code: Some(0),
                    killed: false,
                }
            } else {
                ResolvedStatus {
                    status: AWAIT_STATUS_FAILED,
                    exit_code: Some(*code),
                    killed: false,
                }
            }
        }
        registry::JobStatus::Killed => ResolvedStatus {
            status: AWAIT_STATUS_FAILED,
            exit_code: None,
            killed: true,
        },
        registry::JobStatus::Completed => ResolvedStatus {
            status: AWAIT_STATUS_SUCCEEDED,
            exit_code: None,
            killed: false,
        },
        registry::JobStatus::Failed => ResolvedStatus {
            status: AWAIT_STATUS_FAILED,
            exit_code: None,
            killed: false,
        },
    }
}

/// Result of probing a single handle at a point in time — aggregated into
/// `awaitMeta::items` and used to render the response body.
pub(super) struct HandleSnapshot {
    pub handle: String,
    pub kind: registry::JobKind,
    /// `running` / `succeeded` / `failed`.
    pub status: &'static str,
    pub exit_code: Option<i32>,
    pub killed: bool,
    /// Only meaningful for `wait_for` running items. `0` for `monitor`.
    pub waited_ms: u64,
    /// Set when the caller supplied a regex and we matched against this body.
    pub pattern_matched: Option<bool>,
    pub match_line: Option<String>,
    pub body: String,
}

impl HandleSnapshot {
    pub(super) fn header_label(&self) -> &'static str {
        match (self.status, self.pattern_matched) {
            ("running", Some(true)) => "running (pattern matched)",
            ("running", _) => "running",
            ("succeeded", _) => "succeeded",
            ("failed", _) => "failed",
            _ => self.status,
        }
    }

    pub(super) fn to_meta_item(&self) -> Value {
        let mut item = serde_json::json!({
            "handle": self.handle,
            "jobKind": job_kind_label(&self.kind),
            "status": self.status,
        });
        if self.status == "running" {
            item["waitedMs"] = Value::Number(self.waited_ms.into());
            if let Some(matched) = self.pattern_matched {
                item["patternMatched"] = Value::Bool(matched);
                if let Some(line) = &self.match_line {
                    item["matchLine"] = Value::String(line.clone());
                }
            }
        }
        if let Some(code) = self.exit_code {
            item["exitCode"] = Value::Number(code.into());
        }
        if self.killed {
            item["killed"] = Value::Bool(true);
        }
        item
    }
}

pub(super) fn running_snapshot(
    handle: &str,
    kind: &registry::JobKind,
    waited_ms: u64,
    pattern_matched: Option<bool>,
    match_line: Option<String>,
    body: String,
) -> HandleSnapshot {
    HandleSnapshot {
        handle: handle.to_string(),
        kind: kind.clone(),
        status: AWAIT_STATUS_RUNNING,
        exit_code: None,
        killed: false,
        waited_ms,
        pattern_matched,
        match_line,
        body,
    }
}

pub(super) fn terminal_snapshot(
    handle: &str,
    kind: &registry::JobKind,
    job_status: &registry::JobStatus,
    body: String,
) -> HandleSnapshot {
    let resolved = resolve_status(job_status);
    HandleSnapshot {
        handle: handle.to_string(),
        kind: kind.clone(),
        status: resolved.status,
        exit_code: resolved.exit_code,
        killed: resolved.killed,
        waited_ms: 0,
        pattern_matched: None,
        match_line: None,
        body,
    }
}
