//! `list_dir` tool — list files and directories under a given path.

use async_trait::async_trait;
use serde_json::Value;
use std::path::PathBuf;

use super::{map_err, merge_additional_dirs, ActiveAllowedDir, WorkspaceStateHandle};
use crate::tools::impls::coding::action_router::ActionRouter;
use crate::tools::names as tool_names;
use crate::tools::traits::{required_string, Tool, ToolError};

pub struct ListDirTool {
    allowed_dir: ActiveAllowedDir,
    additional_allowed_dirs: Vec<PathBuf>,
    workspace_state: Option<WorkspaceStateHandle>,
    router: Option<ActionRouter>,
}

impl ListDirTool {
    pub fn new(allowed_dir: Option<PathBuf>) -> Self {
        Self {
            allowed_dir: ActiveAllowedDir::new(allowed_dir),
            additional_allowed_dirs: Vec::new(),
            workspace_state: None,
            router: None,
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

    /// See [`super::ReadFileTool::with_workspace_state`].
    pub fn with_workspace_state(mut self, state: WorkspaceStateHandle) -> Self {
        self.workspace_state = Some(state);
        self
    }
}

#[async_trait]
impl Tool for ListDirTool {
    fn name(&self) -> &str {
        tool_names::LIST_DIR
    }

    fn category(&self) -> &str {
        crate::tools::categories::CODING
    }

    fn is_read_only(&self) -> bool {
        true
    }

    fn description(&self) -> &str {
        "List files and directories in a given path."
    }

    fn llm_description(&self) -> Option<String> {
        let workspace = self
            .allowed_dir
            .snapshot()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "(unrestricted)".to_string());
        Some(format!(
            "List files and directories. Working directory: {workspace}"
        ))
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Directory path to list"
                }
            },
            "required": ["path"]
        })
    }

    async fn execute_text(
        &self,
        params: Value,
        _ctx: &crate::tools::traits::CallContext,
    ) -> Result<String, ToolError> {
        let raw_path = required_string(&params, "path")?;

        if let Some(ref router) = self.router {
            if router.should_route() {
                if let Some(result) = router
                    .try_execute(
                        "file.listDir",
                        serde_json::json!({
                            "path": raw_path,
                        }),
                    )
                    .await?
                {
                    return Ok(result);
                }
            }
        }

        let allowed = self.allowed_dir.snapshot();
        let extras =
            merge_additional_dirs(&self.additional_allowed_dirs, self.workspace_state.as_ref());
        let entries =
            crate::tool_infra::file::list_dir_with_extras(&raw_path, allowed.as_deref(), &extras)
                .await
                .map_err(map_err)?;

        let formatted: Vec<String> = entries
            .iter()
            .map(|(name, is_dir)| {
                let prefix = if *is_dir { "dir" } else { "file" };
                format!("[{}] {}", prefix, name)
            })
            .collect();

        Ok(formatted.join("\n"))
    }

    async fn set_active_repo(&self, repo_path: &str) {
        let path = PathBuf::from(repo_path);
        if path.is_dir() {
            self.allowed_dir.update_if_restricted(path);
        }
    }
}
