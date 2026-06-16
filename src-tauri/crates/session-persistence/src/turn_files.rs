//! Per-round modified-file extraction.
//!
//! The turn indexer scans the file-modifying events inside each round's
//! `[start_sequence, end_sequence]` window and materializes a deduplicated
//! file list onto the `session_turns.modified_files_json` column. This keeps
//! the frontend from re-deriving "files touched this round" on every render
//! ("不要前端算，写 db").
//!
//! Only canonical write/patch/delete tools contribute; read-only tools are
//! intentionally ignored so the list mirrors the old composer file-change
//! card. Malformed JSON in a single event is skipped rather than failing the
//! whole rebuild.

use agent_core::tools::names as tool_names;
use serde::{Deserialize, Serialize};

const STATUS_CREATED: &str = "created";
const STATUS_DELETED: &str = "deleted";
const STATUS_MODIFIED: &str = "modified";

/// One file the round wrote to, with summed line stats. Serialized as the
/// camelCase shape the frontend `FileChangeInfo` expects.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TurnModifiedFile {
    pub path: String,
    pub file_name: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}

/// Mutable, order-preserving accumulator for a single round. New file paths
/// append in first-seen order; repeated paths merge (sum line stats, latest
/// status wins).
#[derive(Debug, Default, Clone)]
pub struct TurnFileAccumulator {
    files: Vec<TurnModifiedFile>,
}

impl TurnFileAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Fold one event into the accumulator. `args_json` / `result_json` are
    /// the raw event columns; non-file tools and error results are ignored.
    pub fn add_event(
        &mut self,
        function_name: Option<&str>,
        args_json: &str,
        result_json: &str,
    ) {
        let Some(function_name) = function_name else {
            return;
        };
        if !is_file_modify_function(function_name) {
            return;
        }
        if result_is_error(result_json) {
            return;
        }
        for change in extract_event_files(function_name, args_json, result_json) {
            self.merge(change);
        }
    }

    fn merge(&mut self, change: TurnModifiedFile) {
        if change.path.is_empty() {
            return;
        }
        if let Some(existing) = self.files.iter_mut().find(|file| file.path == change.path) {
            existing.additions = existing.additions.saturating_add(change.additions);
            existing.deletions = existing.deletions.saturating_add(change.deletions);
            // Latest event wins for status: a create-then-edit shows the net
            // "created"/"modified" as it last appeared chronologically.
            existing.status = change.status;
            if existing.file_name.is_empty() {
                existing.file_name = change.file_name;
            }
        } else {
            self.files.push(change);
        }
    }

    /// Borrow the accumulated files (first-seen order preserved).
    pub fn files(&self) -> &[TurnModifiedFile] {
        &self.files
    }

    /// Drain into the final list (first-seen order preserved).
    pub fn into_files(self) -> Vec<TurnModifiedFile> {
        self.files
    }
}

/// Tools that modify files on disk and therefore contribute to a round's
/// file list. Mirrors `SESSION_FILE_MODIFY_TOOLS` plus `delete_file`.
pub fn is_file_modify_function(name: &str) -> bool {
    matches!(
        name,
        tool_names::EDIT_FILE
            | tool_names::DELETE_FILE
            | tool_names::APPLY_PATCH
            | tool_names::STORAGE_WRITE_FILE
            | tool_names::STORAGE_CREATE_FILE
            | tool_names::STORAGE_EDIT_FILE_BY_REPLACE
            | tool_names::STORAGE_APPEND_FILE
            | tool_names::STORAGE_FILE_RANGE_EDIT
            | tool_names::STORAGE_INSERT_CONTENT_AT_LINE
            | tool_names::CLI_DISPLAY_EDIT
            | tool_names::CLI_DISPLAY_WRITE
            | tool_names::CLI_DISPLAY_CREATE
            | tool_names::CLI_DISPLAY_PATCH
    )
}

fn status_for_function(name: &str) -> &'static str {
    match name {
        tool_names::DELETE_FILE => STATUS_DELETED,
        tool_names::STORAGE_CREATE_FILE | tool_names::CLI_DISPLAY_CREATE => STATUS_CREATED,
        _ => STATUS_MODIFIED,
    }
}

fn result_is_error(result_json: &str) -> bool {
    // Cheap textual guard mirrors `accumulate_session_file_change`: tool
    // outputs that begin with "Error" never produced a real file change.
    serde_json::from_str::<serde_json::Value>(result_json)
        .ok()
        .and_then(|value| {
            value
                .get("output")
                .or_else(|| value.get("content"))
                .and_then(|inner| inner.as_str())
                .map(|text| text.starts_with("Error"))
        })
        .unwrap_or(false)
}

fn file_name_for(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

/// Read a non-negative line count from `result_json`, checking top-level and
/// the nested `success` object the file extractors write to.
fn read_lines(result: &serde_json::Value, key: &str) -> u32 {
    let direct = result.get(key).and_then(serde_json::Value::as_u64);
    let nested = result
        .get("success")
        .and_then(|success| success.get(key))
        .and_then(serde_json::Value::as_u64);
    direct.or(nested).unwrap_or(0) as u32
}

fn extract_event_files(
    function_name: &str,
    args_json: &str,
    result_json: &str,
) -> Vec<TurnModifiedFile> {
    let args: serde_json::Value = serde_json::from_str(args_json).unwrap_or(serde_json::Value::Null);
    let result: serde_json::Value =
        serde_json::from_str(result_json).unwrap_or(serde_json::Value::Null);

    if matches!(
        function_name,
        tool_names::APPLY_PATCH | tool_names::CLI_DISPLAY_PATCH
    ) {
        return extract_patch_files(&args, &result);
    }

    let path = args
        .get("file_path")
        .or_else(|| args.get("file_name"))
        .or_else(|| args.get("path"))
        .or_else(|| args.get("target_file"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .unwrap_or_default();

    if path.is_empty() {
        return Vec::new();
    }

    vec![TurnModifiedFile {
        file_name: file_name_for(&path),
        status: status_for_function(function_name).to_string(),
        additions: read_lines(&result, "linesAdded"),
        deletions: read_lines(&result, "linesRemoved"),
        path,
    }]
}

/// apply_patch can touch multiple files. Prefer the structured `segments`
/// result (carries per-file line stats); fall back to `filePaths`, then to
/// parsing the patch header lines in the args.
fn extract_patch_files(
    args: &serde_json::Value,
    result: &serde_json::Value,
) -> Vec<TurnModifiedFile> {
    if let Some(segments) = result.get("segments").and_then(serde_json::Value::as_array) {
        let mut files = Vec::new();
        for segment in segments {
            let path = segment
                .get("filePath")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_string();
            if path.is_empty() {
                continue;
            }
            let is_deleted = segment
                .get("isDeleted")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            files.push(TurnModifiedFile {
                file_name: file_name_for(&path),
                status: if is_deleted { STATUS_DELETED } else { STATUS_MODIFIED }.to_string(),
                additions: read_lines(segment, "linesAdded"),
                deletions: read_lines(segment, "linesRemoved"),
                path,
            });
        }
        if !files.is_empty() {
            return files;
        }
    }

    if let Some(paths) = result.get("filePaths").and_then(serde_json::Value::as_array) {
        let collected: Vec<TurnModifiedFile> = paths
            .iter()
            .filter_map(serde_json::Value::as_str)
            .filter(|path| !path.is_empty())
            .map(|path| TurnModifiedFile {
                file_name: file_name_for(path),
                status: STATUS_MODIFIED.to_string(),
                additions: 0,
                deletions: 0,
                path: path.to_string(),
            })
            .collect();
        if !collected.is_empty() {
            return collected;
        }
    }

    let patch_text = args
        .get("patch_text")
        .or_else(|| args.get("patch"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    extract_paths_from_patch_text(patch_text)
        .into_iter()
        .map(|path| TurnModifiedFile {
            file_name: file_name_for(&path),
            status: STATUS_MODIFIED.to_string(),
            additions: 0,
            deletions: 0,
            path,
        })
        .collect()
}

fn extract_paths_from_patch_text(patch_text: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for line in patch_text.lines() {
        let trimmed = line.trim();
        let path = trimmed
            .strip_prefix("*** Add File:")
            .or_else(|| trimmed.strip_prefix("*** Update File:"))
            .or_else(|| trimmed.strip_prefix("*** Delete File:"))
            .or_else(|| trimmed.strip_prefix("+++ b/"))
            .or_else(|| trimmed.strip_prefix("--- a/"));
        if let Some(path) = path.map(str::trim).filter(|path| !path.is_empty()) {
            if path != "/dev/null" && !paths.iter().any(|seen| seen == path) {
                paths.push(path.to_string());
            }
        }
    }
    paths
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_read_only_and_unknown_tools() {
        let mut acc = TurnFileAccumulator::new();
        acc.add_event(Some("read_file"), r#"{"file_path":"a.rs"}"#, "{}");
        acc.add_event(None, "{}", "{}");
        assert!(acc.into_files().is_empty());
    }

    #[test]
    fn edit_file_extracts_path_and_line_stats() {
        let mut acc = TurnFileAccumulator::new();
        acc.add_event(
            Some("edit_file"),
            r#"{"file_path":"src/foo.rs"}"#,
            r#"{"success":{"linesAdded":3,"linesRemoved":1}}"#,
        );
        let files = acc.into_files();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "src/foo.rs");
        assert_eq!(files[0].file_name, "foo.rs");
        assert_eq!(files[0].status, "modified");
        assert_eq!(files[0].additions, 3);
        assert_eq!(files[0].deletions, 1);
    }

    #[test]
    fn create_and_delete_status_mapping() {
        let mut acc = TurnFileAccumulator::new();
        acc.add_event(Some("create_file"), r#"{"file_path":"new.ts"}"#, "{}");
        acc.add_event(Some("delete_file"), r#"{"file_path":"old.ts"}"#, "{}");
        let files = acc.into_files();
        assert_eq!(files[0].status, "created");
        assert_eq!(files[1].status, "deleted");
    }

    #[test]
    fn duplicate_path_merges_and_sums() {
        let mut acc = TurnFileAccumulator::new();
        acc.add_event(
            Some("edit_file"),
            r#"{"file_path":"a.rs"}"#,
            r#"{"linesAdded":2,"linesRemoved":0}"#,
        );
        acc.add_event(
            Some("edit_file"),
            r#"{"file_path":"a.rs"}"#,
            r#"{"linesAdded":5,"linesRemoved":3}"#,
        );
        let files = acc.into_files();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].additions, 7);
        assert_eq!(files[0].deletions, 3);
    }

    #[test]
    fn error_result_is_skipped() {
        let mut acc = TurnFileAccumulator::new();
        acc.add_event(
            Some("edit_file"),
            r#"{"file_path":"a.rs"}"#,
            r#"{"content":"Error: permission denied"}"#,
        );
        assert!(acc.into_files().is_empty());
    }

    #[test]
    fn apply_patch_uses_segments() {
        let mut acc = TurnFileAccumulator::new();
        acc.add_event(
            Some("apply_patch"),
            r#"{"patch_text":"*** Update File: a.rs\n"}"#,
            r#"{"segments":[
                {"filePath":"a.rs","linesAdded":4,"linesRemoved":1},
                {"filePath":"b.rs","isDeleted":true}
            ]}"#,
        );
        let files = acc.into_files();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "a.rs");
        assert_eq!(files[0].additions, 4);
        assert_eq!(files[1].path, "b.rs");
        assert_eq!(files[1].status, "deleted");
    }

    #[test]
    fn apply_patch_falls_back_to_patch_text() {
        let mut acc = TurnFileAccumulator::new();
        acc.add_event(
            Some("apply_patch"),
            r#"{"patch_text":"*** Add File: x.rs\n*** Update File: y.rs\n"}"#,
            "{}",
        );
        let files = acc.into_files();
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["x.rs", "y.rs"]);
    }

    #[test]
    fn malformed_json_is_tolerated() {
        let mut acc = TurnFileAccumulator::new();
        acc.add_event(Some("edit_file"), "{not json", "{also not json");
        assert!(acc.into_files().is_empty());
    }
}
