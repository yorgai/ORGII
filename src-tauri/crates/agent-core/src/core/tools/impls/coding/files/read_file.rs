//! `read_file` tool — read a file's contents with optional line-range
//! selection.

use async_trait::async_trait;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use tokio::sync::Mutex;

use super::{map_err, merge_additional_dirs, ActiveAllowedDir, WorkspaceStateHandle};
use crate::tools::impls::coding::action_router::ActionRouter;
use crate::tools::names as tool_names;
use crate::tools::traits::{optional_int, required_string, Tool, ToolError};

const READ_CACHE_MAX_ENTRIES: usize = 128;
const READ_CACHE_MAX_BYTES: usize = 512 * 1024;
const READ_ACTION_FILE_UNCHANGED: &str = "file_unchanged";

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct ReadCacheKey {
    resolved_path: PathBuf,
    offset: Option<i64>,
    limit: Option<usize>,
}

#[derive(Clone, Debug)]
struct ReadCacheEntry {
    modified_millis: u128,
    total_bytes: u64,
    output_bytes: usize,
    start_line: usize,
    end_line: usize,
    total_lines: usize,
}

#[derive(Debug, Default)]
struct ReadFileCache {
    entries: HashMap<ReadCacheKey, ReadCacheEntry>,
    order: VecDeque<ReadCacheKey>,
    bytes: usize,
}

impl ReadFileCache {
    fn get(&mut self, key: &ReadCacheKey) -> Option<ReadCacheEntry> {
        let entry = self.entries.get(key).cloned()?;
        self.touch(key);
        Some(entry)
    }

    fn insert(&mut self, key: ReadCacheKey, entry: ReadCacheEntry) {
        if let Some(previous) = self.entries.remove(&key) {
            self.bytes = self.bytes.saturating_sub(previous.output_bytes);
            self.order.retain(|candidate| candidate != &key);
        }

        self.bytes = self.bytes.saturating_add(entry.output_bytes);
        self.order.push_back(key.clone());
        self.entries.insert(key, entry);
        self.evict_over_budget();
    }

    fn touch(&mut self, key: &ReadCacheKey) {
        self.order.retain(|candidate| candidate != key);
        self.order.push_back(key.clone());
    }

    fn evict_over_budget(&mut self) {
        while self.entries.len() > READ_CACHE_MAX_ENTRIES || self.bytes > READ_CACHE_MAX_BYTES {
            let Some(oldest_key) = self.order.pop_front() else {
                break;
            };
            if let Some(oldest) = self.entries.remove(&oldest_key) {
                self.bytes = self.bytes.saturating_sub(oldest.output_bytes);
            }
        }
    }
}

pub struct ReadFileTool {
    allowed_dir: ActiveAllowedDir,
    /// Static extra dirs granted at construction time — currently just the
    /// scratchpad. Persistent "additional workspace directories" (added via
    /// `/add-dir`) live on `workspace_state` and are merged in at call time so
    /// mutations are visible without a registry rebuild.
    additional_allowed_dirs: Vec<PathBuf>,
    workspace_state: Option<WorkspaceStateHandle>,
    router: Option<ActionRouter>,
    read_cache: Mutex<ReadFileCache>,
}

impl ReadFileTool {
    pub fn new(allowed_dir: Option<PathBuf>) -> Self {
        Self {
            allowed_dir: ActiveAllowedDir::new(allowed_dir),
            additional_allowed_dirs: Vec::new(),
            workspace_state: None,
            router: None,
            read_cache: Mutex::new(ReadFileCache::default()),
        }
    }

    pub fn with_router(mut self, router: ActionRouter) -> Self {
        self.router = Some(router);
        self
    }

    pub fn with_scratchpad(mut self, scratchpad_dir: PathBuf) -> Self {
        self.additional_allowed_dirs.push(scratchpad_dir);
        self
    }

    pub fn with_readonly_extra_dir(mut self, directory: PathBuf) -> Self {
        self.additional_allowed_dirs.push(directory);
        self
    }

    /// Attach the session's live `SessionWorkspace` so that directories added
    /// via `/add-dir` mutator commands become authorised for this tool without
    /// rebuilding the tool registry.
    pub fn with_workspace_state(mut self, state: WorkspaceStateHandle) -> Self {
        self.workspace_state = Some(state);
        self
    }
}

#[async_trait]
impl Tool for ReadFileTool {
    fn name(&self) -> &str {
        tool_names::READ_FILE
    }

    fn category(&self) -> &str {
        crate::tools::categories::CODING
    }

    fn is_read_only(&self) -> bool {
        true
    }

    fn output_budget(&self) -> usize {
        100_000
    }

    fn persist_threshold(&self) -> usize {
        usize::MAX
    }

    fn description(&self) -> &str {
        "Read a file's contents with optional line-range selection. \
         Supports text files, PDFs (extracts text), images (JPEG/PNG/GIF/WebP — returns inline for vision), \
         and Jupyter notebooks (.ipynb — renders cells as text). \
         By default reads up to 2000 lines from the start. \
         For large files, use `offset` and `limit` to read specific sections. \
         Files over 256 KB require offset/limit."
    }

    fn llm_description(&self) -> Option<String> {
        let workspace = self
            .allowed_dir
            .snapshot()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "(unrestricted)".to_string());
        Some(format!(
            "Read a file in {workspace}. Supports text, PDF (text extraction), \
             images (JPEG/PNG/GIF/WebP — inline for vision models), \
             and Jupyter notebooks (.ipynb). \
             Optional line-range with offset/limit. Default: up to 2000 lines. \
             Files over 256 KB require offset/limit.\n\
             Output format: each line is prefixed with a right-aligned line number and │ separator, \
             e.g. \"     1│first line\". This prefix is metadata — never include it in old_string \
             when editing."
        ))
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to the file to read"
                },
                "offset": {
                    "type": "integer",
                    "description": "Line number to start reading from (1-indexed). Negative values count from end (e.g. -20 = last 20 lines). Only provide if the file is too large to read at once."
                },
                "limit": {
                    "type": "integer",
                    "description": "Number of lines to read. Only provide if the file is too large to read at once."
                }
            },
            "required": ["path"]
        })
    }

    async fn execute_text(&self, params: Value) -> Result<String, ToolError> {
        let raw_path = required_string(&params, "path")?;
        let offset = optional_int(&params, "offset");
        let limit = optional_int(&params, "limit").map(|v| v.max(1) as usize);

        if let Some(ref router) = self.router {
            if router.should_route() {
                if let Some(result) = router
                    .try_execute("file.read", serde_json::json!({ "path": raw_path }))
                    .await?
                {
                    let action = classify_read_action(&raw_path, &result);
                    return Ok(format!("[action: {}]\n{}", action, result));
                }
            }
        }

        let allowed = self.allowed_dir.snapshot();
        let extras =
            merge_additional_dirs(&self.additional_allowed_dirs, self.workspace_state.as_ref());
        let stat =
            crate::tool_infra::file::stat_file_with_extras(&raw_path, allowed.as_deref(), &extras)
                .await
                .map_err(map_err)?;
        let cache_key = ReadCacheKey {
            resolved_path: stat.resolved_path.clone(),
            offset,
            limit,
        };

        if let Some(entry) = self.read_cache.lock().await.get(&cache_key) {
            if entry.modified_millis == stat.modified_millis
                && entry.total_bytes == stat.total_bytes
            {
                return Ok(format_file_unchanged_stub(&raw_path, &entry));
            }
        }

        let result = crate::tool_infra::file::read_file_in_range_with_extras(
            &raw_path,
            allowed.as_deref(),
            &extras,
            offset,
            limit,
        )
        .await
        .map_err(map_err)?;

        let start_line = result.start_line;
        let end_line = result.start_line + result.lines_read.saturating_sub(1);
        let total_lines = result.total_lines;
        let total_bytes = result.total_bytes;
        let modified_millis = result.modified_millis;
        let resolved_path = result.resolved_path.clone();
        let mut output = result.content;

        if result.truncated || result.lines_read < result.total_lines {
            output.push_str(&format!(
                "\n\n[Showing lines {}-{} of {} total ({:.1} KB). \
                 Use offset and limit to read other sections.]",
                start_line,
                end_line,
                total_lines,
                total_bytes as f64 / 1024.0,
            ));
        }

        let action = classify_read_action(&raw_path, &output);
        let output = format!("[action: {}]\n{}", action, output);
        self.read_cache.lock().await.insert(
            ReadCacheKey {
                resolved_path,
                offset,
                limit,
            },
            ReadCacheEntry {
                modified_millis,
                total_bytes,
                output_bytes: output.len(),
                start_line,
                end_line,
                total_lines,
            },
        );
        Ok(output)
    }

    async fn set_active_repo(&self, repo_path: &str) {
        let path = PathBuf::from(repo_path);
        if path.is_dir() {
            self.allowed_dir.update_if_restricted(path);
        }
    }
}

fn format_file_unchanged_stub(path: &str, entry: &ReadCacheEntry) -> String {
    format!(
        "[action: {}]\n[{}: {}]\nPrevious read is still current; file bytes and modification time are unchanged.\nLines {}-{} of {} remain available from the previous read result.",
        READ_ACTION_FILE_UNCHANGED,
        READ_ACTION_FILE_UNCHANGED,
        path,
        entry.start_line,
        entry.end_line,
        entry.total_lines,
    )
}

/// Classify a `read_file` result into a concrete action so the frontend can
/// pick the right renderer without filename pattern matching.
///
/// The classification is emitted as a leading `[action: X]` marker line
/// prepended to the tool output.
fn classify_read_action(path: &str, output: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".bmp")
        || lower.ends_with(".svg")
        || output.trim_start().starts_with("Image:")
    {
        return "read_image";
    }
    if lower.ends_with(".pdf") {
        return "read_pdf";
    }
    "read_text"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::traits::Tool;
    use tempfile::TempDir;

    #[test]
    fn classify_read_action_detects_image() {
        assert_eq!(classify_read_action("/tmp/foo.png", ""), "read_image");
        assert_eq!(classify_read_action("bar.JPEG", ""), "read_image");
        assert_eq!(
            classify_read_action("notes.txt", "Image: foo.png (image/png, 12kb)\n..."),
            "read_image"
        );
    }

    #[test]
    fn classify_read_action_detects_pdf() {
        assert_eq!(classify_read_action("/doc.PDF", "abc"), "read_pdf");
    }

    #[test]
    fn classify_read_action_defaults_to_text() {
        assert_eq!(classify_read_action("README.md", "hello"), "read_text");
        assert_eq!(classify_read_action("noext", ""), "read_text");
    }

    #[tokio::test]
    async fn repeated_unchanged_read_returns_stub() {
        let repo = TempDir::new().unwrap();
        std::fs::write(repo.path().join("marker.txt"), "hello\nworld").unwrap();

        let tool = ReadFileTool::new(Some(repo.path().to_path_buf()));
        let first = tool
            .execute(serde_json::json!({ "path": "marker.txt" }))
            .await
            .unwrap();
        assert!(first.contains("hello"), "output was: {}", first);

        let second = tool
            .execute(serde_json::json!({ "path": "marker.txt" }))
            .await
            .unwrap();
        assert!(
            second.contains("[action: file_unchanged]"),
            "output was: {}",
            second
        );
        assert!(
            !second.contains("hello"),
            "unchanged stub should not repeat content: {}",
            second
        );
    }

    #[tokio::test]
    async fn changed_file_refreshes_cache() {
        let repo = TempDir::new().unwrap();
        let path = repo.path().join("marker.txt");
        std::fs::write(&path, "hello").unwrap();

        let tool = ReadFileTool::new(Some(repo.path().to_path_buf()));
        let first = tool
            .execute(serde_json::json!({ "path": "marker.txt" }))
            .await
            .unwrap();
        assert!(first.contains("hello"), "output was: {}", first);

        std::thread::sleep(std::time::Duration::from_millis(2));
        std::fs::write(&path, "updated").unwrap();

        let second = tool
            .execute(serde_json::json!({ "path": "marker.txt" }))
            .await
            .unwrap();
        assert!(second.contains("updated"), "output was: {}", second);
        assert!(
            !second.contains("[action: file_unchanged]"),
            "output was: {}",
            second
        );
    }

    #[tokio::test]
    async fn set_active_repo_updates_restricted_sandbox() {
        let repo_a = TempDir::new().unwrap();
        let repo_b = TempDir::new().unwrap();
        std::fs::write(repo_b.path().join("marker.txt"), "hello").unwrap();

        let tool = ReadFileTool::new(Some(repo_a.path().to_path_buf()));
        let err = tool
            .execute(serde_json::json!({ "path": "marker.txt" }))
            .await
            .unwrap_err();
        assert!(
            matches!(err, ToolError::ExecutionFailed(_)),
            "unexpected error variant: {:?}",
            err
        );

        tool.set_active_repo(&repo_b.path().to_string_lossy()).await;
        let output = tool
            .execute(serde_json::json!({ "path": "marker.txt" }))
            .await
            .unwrap();
        assert!(output.contains("hello"), "output was: {}", output);
    }

    #[tokio::test]
    async fn set_active_repo_is_noop_for_unrestricted_tool() {
        let repo = TempDir::new().unwrap();
        std::fs::write(repo.path().join("x.txt"), "y").unwrap();

        // Start with no sandbox — set_active_repo must not retroactively
        // install one.
        let tool = ReadFileTool::new(None);
        tool.set_active_repo(&repo.path().to_string_lossy()).await;
        assert!(tool.allowed_dir.snapshot().is_none());
    }
}
