//! Code, file, and symbol search tool.
//!
//! Thin wrapper over `tool_service::search` — the shared implementation
//! used by both this agent tool and Tauri search commands.
//!
//! When `ActionRouter` is present and in "work_station" mode, `code`
//! searches are routed through the frontend ActionSystem (`search.codebase`).

use async_trait::async_trait;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use super::action_router::ActionRouter;
use crate::session::workspace::SessionWorkspace;
use crate::tools::names as tool_names;
use crate::tools::traits::{optional_int, optional_string, required_string, Tool, ToolError};

/// Code and file search tool.
pub struct SearchTool {
    /// Default repo path to search in (config workspace).
    default_repo: PathBuf,
    /// Active IDE repo path — overrides default_repo when set.
    active_repo: TokioMutex<Option<PathBuf>>,
    workspace_state: Option<Arc<parking_lot::RwLock<SessionWorkspace>>>,
    /// Optional router for Workstation mode.
    router: Option<ActionRouter>,
}

impl SearchTool {
    pub fn new(default_repo: PathBuf) -> Self {
        Self {
            default_repo,
            active_repo: TokioMutex::new(None),
            workspace_state: None,
            router: None,
        }
    }

    pub fn with_router(mut self, router: ActionRouter) -> Self {
        self.router = Some(router);
        self
    }

    pub fn with_workspace_state(
        mut self,
        workspace_state: Arc<parking_lot::RwLock<SessionWorkspace>>,
    ) -> Self {
        self.workspace_state = Some(workspace_state);
        self
    }

    /// Resolve the repo path: explicit param > active IDE repo > current workspace.
    ///
    /// An explicit `repo_path` is validated against the live session
    /// workspace (single path-authorization source) — plus the active
    /// IDE repo — when `workspace_state` is attached. Without a
    /// workspace handle (tests, standalone construction) the explicit
    /// path is used as-is, matching the other workspace-less tools.
    async fn resolve_repo(&self, params: &Value) -> Result<PathBuf, ToolError> {
        if let Some(explicit) = optional_string(params, "repo_path") {
            let path = PathBuf::from(explicit);
            if let Some(ref workspace) = self.workspace_state {
                let extra: Vec<PathBuf> = self
                    .active_repo
                    .lock()
                    .await
                    .clone()
                    .into_iter()
                    .collect();
                workspace
                    .read()
                    .is_path_allowed(&path, &extra)
                    .map_err(ToolError::PermissionDenied)?;
            }
            return Ok(path);
        }
        let active = self.active_repo.lock().await;
        Ok(active.clone().unwrap_or_else(|| {
            self.workspace_state
                .as_ref()
                .map(|workspace| workspace.read().working_dir().to_path_buf())
                .unwrap_or_else(|| self.default_repo.clone())
        }))
    }
}

#[async_trait]
impl Tool for SearchTool {
    fn name(&self) -> &str {
        tool_names::CODE_SEARCH
    }

    fn category(&self) -> &str {
        crate::tools::categories::CODING
    }

    fn is_read_only(&self) -> bool {
        true
    }

    fn output_budget(&self) -> usize {
        20_000
    }

    fn description(&self) -> &str {
        "Search code, files, and symbols in a repository.\n\
         Actions:\n\
         - grep: regex search in file contents (ripgrep)\n\
         - find_files: find files by name pattern (fuzzy)\n\
         - glob: find files by glob pattern (e.g. src/**/*.ts, *.{rs,toml})\n\
         - symbols: find functions/classes/types by name (tree-sitter)\n\
         - check_status: check search status\n\
         Always set max_results. For 'find_files', use specific name patterns. For 'glob', use standard glob syntax."
    }

    fn llm_description(&self) -> Option<String> {
        let repo = self
            .active_repo
            .try_lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|p| p.display().to_string()))
            .unwrap_or_else(|| {
                self.workspace_state
                    .as_ref()
                    .map(|workspace| workspace.read().working_dir().display().to_string())
                    .unwrap_or_else(|| self.default_repo.display().to_string())
            });

        Some(format!(
            "Search code, files, and symbols in {repo}.\n\
             Actions:\n\
             - grep: regex search in file contents (ripgrep)\n\
             - find_files: find files by name pattern (fuzzy)\n\
             - glob: find files by glob pattern (e.g. src/**/*.ts, *.{{rs,toml}})\n\
             - symbols: find functions/classes/types by name (tree-sitter)\n\
             - check_status: check search status\n\
             Always set max_results. For 'find_files', use specific name patterns. For 'glob', use standard glob syntax."
        ))
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "Search action",
                    "enum": ["grep", "find_files", "glob", "symbols", "check_status"]
                },
                "pattern": {
                    "type": "string",
                    "description": "Search pattern (regex for code, glob for files, name for symbols)"
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum results to return (default 20)",
                    "minimum": 1,
                    "maximum": 100
                },
                "repo_path": {
                    "type": "string",
                    "description": "Repository path to search in (defaults to workspace)"
                },
                "context_lines": {
                    "type": "integer",
                    "description": "Number of context lines before and after each match (for 'grep' action only, like grep -C)",
                    "minimum": 0,
                    "maximum": 10
                }
            },
            "required": ["action"]
        })
    }

    async fn set_active_repo(&self, repo_path: &str) {
        let path = PathBuf::from(repo_path);
        if path.exists() {
            *self.active_repo.lock().await = Some(path);
        }
    }

    async fn execute_text(
        &self,
        params: Value,
        _ctx: &crate::tools::traits::CallContext,
    ) -> Result<String, ToolError> {
        let action = required_string(&params, "action")?;
        let max_results = optional_int(&params, "max_results")
            .map(|val| val as usize)
            .unwrap_or(20)
            .clamp(1, 100);
        let repo_path = self.resolve_repo(&params).await?;

        // Workstation routing: route "grep" searches through ActionSystem.
        // Falls back to direct search on timeout (e.g. after hot reload).
        if action == "grep" {
            if let Some(ref router) = self.router {
                if router.should_route() {
                    let pattern = required_string(&params, "pattern")?;
                    if let Some(result) = router
                        .try_execute(
                            "search.codebase",
                            serde_json::json!({
                                "query": pattern,
                                "caseSensitive": false,
                            }),
                        )
                        .await?
                    {
                        return Ok(result);
                    }
                    // Timeout — fall through to direct search
                }
            }
        }

        match action.as_str() {
            "check_status" => crate::tool_infra::search::index_status_formatted()
                .await
                .map_err(ToolError::ExecutionFailed),
            _ => {
                // All other actions require a pattern
                let pattern = required_string(&params, "pattern")?;

                if !repo_path.exists() {
                    return Err(ToolError::ExecutionFailed(format!(
                        "Path does not exist: {}",
                        repo_path.display()
                    )));
                }

                match action.as_str() {
                    "grep" => {
                        let context_lines = optional_int(&params, "context_lines")
                            .map(|v| (v as usize).clamp(0, 10));
                        crate::tool_infra::search::code_search_formatted(
                            &pattern,
                            &repo_path,
                            max_results,
                            context_lines,
                        )
                        .await
                        .map_err(ToolError::ExecutionFailed)
                    }
                    "find_files" => crate::tool_infra::search::file_search_formatted(
                        &pattern,
                        &repo_path,
                        max_results,
                    )
                    .await
                    .map_err(ToolError::ExecutionFailed),
                    "glob" => crate::tool_infra::search::glob_search_formatted(
                        &pattern,
                        &repo_path,
                        max_results,
                    )
                    .await
                    .map_err(ToolError::ExecutionFailed),
                    "symbols" => crate::tool_infra::search::symbol_search_formatted(
                        &pattern,
                        vec![repo_path.to_string_lossy().to_string()],
                        max_results,
                    )
                    .await
                    .map_err(ToolError::ExecutionFailed),
                    _ => Err(ToolError::InvalidParams(format!(
                        "Unknown action: '{}'. Use: grep, find_files, glob, symbols, check_status.",
                        action
                    ))),
                }
            }
        }
    }
}
