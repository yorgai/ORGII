//! Raw private structs used for deserializing Cursor's SQLite database rows.
//!
//! All types here are `pub(super)` — they are internal to `cursor_db_history`
//! and its sibling submodules.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A composer bubble in Cursor's DB ordering.
///
/// Held briefly during a single read; not persisted in this shape.
#[derive(Debug, Clone)]
pub(super) struct OrderedBubble {
    pub(super) bubble_id: String,
    /// Cursor's bubble type discriminator: 1 = user, 2 = assistant.
    pub(super) bubble_type: i64,
    pub(super) raw: RawBubble,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct RawBubble {
    #[serde(rename = "type")]
    pub(super) bubble_type: i64,
    pub(super) bubble_id: String,
    pub(super) created_at: String,
    pub(super) text: String,
    /// Present only on assistant tool turns.
    pub(super) tool_former_data: Option<RawToolFormerData>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct RawToolFormerData {
    /// Cursor's stable tool string id (e.g. `"edit_file_v2"`). Preferred over
    /// the numeric `tool` id, which shifts between Cursor versions.
    pub(super) name: String,
    pub(super) tool_call_id: String,
    pub(super) status: String,
    /// JSON-encoded as a string. Parse with `parse_inner_json`.
    pub(super) params: String,
    /// JSON-encoded as a string. Parse with `parse_inner_json`.
    pub(super) result: String,
    /// Cursor stores pruned search summaries here when `result` is empty.
    pub(super) additional_data: Value,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct RawComposerHeader {
    pub(super) bubble_id: String,
    #[serde(rename = "type")]
    pub(super) bubble_type: i64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct RawComposerForOrder {
    pub(super) created_at: i64,
    pub(super) last_updated_at: i64,
    pub(super) full_conversation_headers_only: Vec<RawComposerHeader>,
    pub(super) original_file_states: BTreeMap<String, RawCursorOriginalFileState>,
    pub(super) tracked_git_repos: Vec<RawTrackedGitRepo>,
    pub(super) workspace_identifier: Option<RawWorkspaceIdentifier>,
    pub(super) subagent_info: Option<RawCursorSubagentInfo>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct RawCursorOriginalFileState {
    pub(super) is_newly_created: bool,
    pub(super) content_key: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct RawCursorSubagentInfo {
    pub(super) subagent_type_name: String,
    pub(super) parent_composer_id: String,
    pub(super) tool_call_id: String,
}

#[derive(Debug, Clone, Default)]
pub(super) struct CursorComposerContext {
    pub(super) subagent_info: Option<RawCursorSubagentInfo>,
}

impl CursorComposerContext {
    pub(super) fn from_composer(composer: &RawComposerForOrder) -> Self {
        Self {
            subagent_info: composer.subagent_info.clone(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct RawTrackedGitRepo {
    pub(super) repo_path: String,
    pub(super) branches: Vec<RawTrackedGitBranch>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct RawTrackedGitBranch {
    pub(super) branch_name: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct RawWorkspaceIdentifier {
    pub(super) uri: Option<RawWorkspaceUri>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct RawWorkspaceUri {
    pub(super) fs_path: String,
    pub(super) path: String,
}

#[derive(Debug, Clone, Default)]
pub(super) struct CursorWorkspaceMetadata {
    pub(super) repo_path: Option<String>,
    pub(super) branch: Option<String>,
}

/// Public turn summary surfaced to the API layer.
///
/// Defined here so both `cursor_db_summaries` and the public API in
/// `cursor_db_history` can reference it without an extra import hop.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorIdeTurnSummary {
    pub turn_id: String,
    pub next_turn_id: Option<String>,
    pub turn_index: usize,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub user_preview: String,
    pub event_count: usize,
    pub body_event_count: usize,
}

/// FNV-1a–style deterministic hash used for summary cache fingerprinting.
pub(super) struct StableFingerprint {
    value: u64,
}

impl StableFingerprint {
    pub(super) fn new() -> Self {
        Self {
            value: 0xcbf29ce484222325,
        }
    }

    pub(super) fn write_str(&mut self, value: &str) {
        self.write_bytes(value.len().to_string().as_bytes());
        self.write_bytes(b":");
        self.write_bytes(value.as_bytes());
        self.write_bytes(b";");
    }

    pub(super) fn write_i64(&mut self, value: i64) {
        self.write_str(&value.to_string());
    }

    pub(super) fn write_usize(&mut self, value: usize) {
        self.write_str(&value.to_string());
    }

    fn write_bytes(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.value ^= u64::from(*byte);
            self.value = self.value.wrapping_mul(0x100000001b3);
        }
    }

    pub(super) fn finish_hex(self) -> String {
        format!("{:016x}", self.value)
    }
}
