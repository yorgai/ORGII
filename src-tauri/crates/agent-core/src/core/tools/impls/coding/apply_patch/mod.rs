//! Apply-patch tool — parse and apply a structured patch format.
//!
//! Supports the `*** Begin Patch / *** End Patch` envelope format
//! with Add, Delete, and Update file hunks.
//!
//! Update hunks use a 4-pass fuzzy line matching strategy (seekSequence):
//! 1. Exact match
//! 2. Right-trimmed (trailing whitespace)
//! 3. Fully trimmed (both ends)
//! 4. Unicode-normalized (smart quotes → ASCII, etc.)

use async_trait::async_trait;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;

use crate::session::workspace::SessionWorkspace;
use crate::tools::names as tool_names;
use crate::tools::traits::{required_string, Tool, ToolError};

mod engine;
use engine::apply_hunks;
pub use engine::{derive_new_contents, parse_patch, seek_sequence, Hunk, UpdateChunk};

/// Apply-patch tool: parse and apply structured multi-file patches.
pub struct ApplyPatchTool {
    workspace_path: PathBuf,
    workspace_state: Option<Arc<parking_lot::RwLock<SessionWorkspace>>>,
}

impl ApplyPatchTool {
    pub fn new(workspace_path: PathBuf) -> Self {
        Self {
            workspace_path,
            workspace_state: None,
        }
    }

    pub fn with_workspace_state(
        mut self,
        workspace_state: Arc<parking_lot::RwLock<SessionWorkspace>>,
    ) -> Self {
        self.workspace_state = Some(workspace_state);
        self
    }

    fn current_workspace_path(&self) -> PathBuf {
        self.workspace_state
            .as_ref()
            .map(|workspace| workspace.read().working_dir().to_path_buf())
            .unwrap_or_else(|| self.workspace_path.clone())
    }
}

#[async_trait]
impl Tool for ApplyPatchTool {
    fn name(&self) -> &str {
        tool_names::APPLY_PATCH
    }

    fn description(&self) -> &str {
        "Apply a structured patch to one or more files in a single operation.\n\n\
         Patch format:\n\
         *** Begin Patch\n\
         *** Add File: path        — create a new file (prefix every line with +)\n\
         *** Update File: path     — modify an existing file\n\
         *** Delete File: path     — remove a file\n\
         *** End Patch\n\n\
         Update hunks:\n\
         - @@ context_line         — anchor to find the right location in the file\n\
         - Lines prefixed with ' ' (space) are context (kept as-is)\n\
         - Lines prefixed with '-' are removed\n\
         - Lines prefixed with '+' are added\n\n\
         Usage:\n\
         - Prefer apply_patch for multi-file changes or large structural edits.\n\
         - For single small edits, prefer the edit tool instead.\n\
         - You MUST prefix new lines with + even when creating a new file.\n\
         - Uses 4-pass fuzzy line matching (exact, right-trimmed, fully trimmed, Unicode-normalized)."
    }

    fn llm_description(&self) -> Option<String> {
        let workspace_path = self.current_workspace_path();
        let root = workspace_path.display();
        Some(format!(
            "Apply a structured patch to files in {root}.\n\n\
             Format: *** Begin Patch / *** End Patch envelope.\n\
             Hunks: Add File, Update File, Delete File. Update hunks use @@ context anchors.\n\
             Prefix: ' ' context, '-' remove, '+' add.\n\
             Prefer apply_patch for multi-file changes. For single small edits, use edit_file.\n\
             4-pass fuzzy line matching (exact, trimmed, Unicode-normalized)."
        ))
    }

    fn category(&self) -> &str {
        crate::tools::categories::CODING
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "patch_text": {
                    "type": "string",
                    "description": "The full patch text with *** Begin Patch / *** End Patch markers"
                }
            },
            "required": ["patch_text"]
        })
    }

    async fn execute_text(&self, params: Value) -> Result<String, ToolError> {
        let patch_text = required_string(&params, "patch_text")?;

        let hunks = parse_patch(&patch_text)
            .map_err(|err| ToolError::InvalidParams(format!("Patch parse error: {}", err)))?;

        if hunks.is_empty() {
            return Err(ToolError::InvalidParams(
                "Empty patch — no hunks found".to_string(),
            ));
        }

        let workspace_path = self.current_workspace_path();
        let result = apply_hunks(&workspace_path, &hunks)
            .await
            .map_err(ToolError::ExecutionFailed)?;

        Ok(result)
    }
}

#[cfg(test)]
mod tests;
