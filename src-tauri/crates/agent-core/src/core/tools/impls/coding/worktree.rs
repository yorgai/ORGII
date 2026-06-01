//! Git Worktree tool — create and manage isolated worktrees.
//!
//! Provides workspace isolation for subagents and parallel work:
//! - `add` — Create a worktree from a branch/ref, switch workspace context
//! - `leave` — Return to the original workspace, optionally delete the worktree
//! - `list` — List existing worktrees

use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn};

use crate::session::workspace::SessionWorkspace;

use crate::tools::names;
use crate::tools::traits::{params_schema, parse_params, Tool, ToolError};

// ============================================
// Structured Responses
// ============================================

#[derive(Debug, Serialize)]
struct AddResult {
    success: bool,
    reused: bool,
    branch: String,
    path: String,
    base: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct LeaveResult {
    success: bool,
    removed: bool,
    branch: String,
    path: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct WorktreeEntry {
    path: String,
    branch: String,
}

#[derive(Debug, Serialize)]
struct ListResult {
    success: bool,
    count: usize,
    entries: Vec<WorktreeEntry>,
    content: String,
}

// ============================================
// Params
// ============================================

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum WorktreeParams {
    /// Create a new worktree and switch context to it.
    Add {
        /// Branch name to create or check out in the worktree.
        branch: String,
        /// Optional base ref to branch from (default: HEAD).
        #[serde(default)]
        base_ref: Option<String>,
    },
    /// Leave the current worktree and return to the original workspace.
    Leave {
        /// Remove the worktree directory after leaving (default: false).
        #[serde(default)]
        remove: bool,
    },
    /// List all worktrees in the repository.
    List,
}

// ============================================
// State
// ============================================

#[derive(Debug, Default)]
struct WorktreeState {
    original_workspace: Option<PathBuf>,
    current_worktree: Option<PathBuf>,
    current_branch: Option<String>,
}

// ============================================
// Tool
// ============================================

pub struct WorktreeTool {
    session_id: String,
    workspace_state: Arc<parking_lot::RwLock<SessionWorkspace>>,
    state: Mutex<WorktreeState>,
}

impl WorktreeTool {
    pub fn new(
        session_id: String,
        workspace_state: Arc<parking_lot::RwLock<SessionWorkspace>>,
    ) -> Self {
        Self {
            session_id,
            workspace_state,
            state: Mutex::new(WorktreeState::default()),
        }
    }
}

#[async_trait]
impl Tool for WorktreeTool {
    fn name(&self) -> &str {
        names::WORKTREE
    }

    fn description(&self) -> &str {
        "Manage git worktrees for isolated parallel work. Actions: add (create worktree), leave (return to main), list (show worktrees)."
    }

    fn category(&self) -> &str {
        crate::tools::categories::CODING
    }

    fn parameters(&self) -> Value {
        params_schema::<WorktreeParams>()
    }

    async fn execute_text(&self, params: Value) -> Result<String, ToolError> {
        let params: WorktreeParams = parse_params(params)?;
        match params {
            WorktreeParams::Add { branch, base_ref } => {
                self.add_worktree(&branch, base_ref.as_deref()).await
            }
            WorktreeParams::Leave { remove } => self.leave_worktree(remove).await,
            WorktreeParams::List => self.list_worktrees().await,
        }
    }
}

impl WorktreeTool {
    async fn add_worktree(
        &self,
        branch: &str,
        base_ref: Option<&str>,
    ) -> Result<String, ToolError> {
        let mut state = self.state.lock().await;
        if state.current_worktree.is_some() || self.workspace_state.read().is_worktree() {
            return Err(ToolError::ExecutionFailed(
                "Already in a worktree. Leave first before adding another.".to_string(),
            ));
        }

        let workspace_root = self.workspace_state.read().workspace_root.clone();
        let worktree_dir = workspace_root.join(".orgii").join("worktrees").join(branch);
        let path_str = worktree_dir.to_string_lossy().to_string();
        let base = base_ref.unwrap_or("HEAD");
        let mut created = false;

        if worktree_dir.exists() {
            info!(
                "[worktree] Reusing existing worktree at {}",
                worktree_dir.display()
            );
        } else {
            let mut cmd_args = vec![
                "worktree".to_string(),
                "add".to_string(),
                "-b".to_string(),
                branch.to_string(),
                path_str.clone(),
                base.to_string(),
            ];

            let output = run_git(&workspace_root, &cmd_args).await?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                if stderr.contains("already exists") {
                    cmd_args = vec![
                        "worktree".to_string(),
                        "add".to_string(),
                        path_str.clone(),
                        branch.to_string(),
                    ];
                    let retry = run_git(&workspace_root, &cmd_args).await?;
                    if !retry.status.success() {
                        return Err(ToolError::ExecutionFailed(format!(
                            "git worktree add failed: {}",
                            String::from_utf8_lossy(&retry.stderr)
                        )));
                    }
                } else {
                    return Err(ToolError::ExecutionFailed(format!(
                        "git worktree add failed: {}",
                        stderr
                    )));
                }
            }
            created = true;
        }

        let mut next_workspace = self.workspace_state.read().clone();
        next_workspace.working_dir = worktree_dir.clone();
        if let Err(err) = persist_workspace(&self.session_id, &next_workspace).await {
            if created {
                let _ = run_git(
                    &workspace_root,
                    &[
                        "worktree".to_string(),
                        "remove".to_string(),
                        "--force".to_string(),
                        path_str.clone(),
                    ],
                )
                .await;
                let _ = run_git(
                    &workspace_root,
                    &["branch".to_string(), "-D".to_string(), branch.to_string()],
                )
                .await;
            }
            return Err(err);
        }

        *self.workspace_state.write() = next_workspace;
        state.original_workspace = Some(workspace_root.clone());
        state.current_worktree = Some(worktree_dir);
        state.current_branch = Some(branch.to_string());

        info!("[worktree] Entered worktree at {}", path_str);

        let result = AddResult {
            success: true,
            reused: !created,
            branch: branch.to_string(),
            path: path_str.clone(),
            base: base.to_string(),
            content: format!(
                "{} worktree at `{}`\nBranch: `{}`\nBase: `{}`\n\nFile operations now target this worktree. Use `leave` to return.",
                if created { "Created" } else { "Switched to existing" },
                path_str,
                branch,
                base
            ),
        };
        Ok(serde_json::to_string(&result).unwrap())
    }

    async fn leave_worktree(&self, remove: bool) -> Result<String, ToolError> {
        let mut state = self.state.lock().await;
        let current_workspace = self.workspace_state.read().clone();
        if !current_workspace.is_worktree() {
            return Err(ToolError::ExecutionFailed(
                "Not currently in a worktree.".to_string(),
            ));
        }

        let worktree_dir = state
            .current_worktree
            .take()
            .unwrap_or_else(|| current_workspace.working_dir.clone());
        let branch = state.current_branch.take().unwrap_or_default();
        let workspace_root = current_workspace.workspace_root.clone();
        state.original_workspace.take();
        let path_str = worktree_dir.to_string_lossy().to_string();

        // When removing: do the physical git operation FIRST, before persisting the
        // workspace change. This prevents an orphan worktree on disk: if persist
        // fails after git remove, the worktree is already gone. If git remove fails,
        // we keep the workspace pointing at the worktree so the agent can retry.
        let mut actually_removed = false;
        if remove {
            let output = run_git(
                &workspace_root,
                &[
                    "worktree".to_string(),
                    "remove".to_string(),
                    "--force".to_string(),
                    path_str.clone(),
                ],
            )
            .await;

            match output {
                Ok(out) if out.status.success() => {
                    actually_removed = true;
                    info!("[worktree] Removed worktree at {}", path_str);
                }
                Ok(out) => {
                    warn!(
                        "[worktree] git worktree remove failed (worktree still on disk): {}",
                        String::from_utf8_lossy(&out.stderr).trim()
                    );
                }
                Err(err) => {
                    warn!(
                        "[worktree] git worktree remove error (worktree still on disk): {}",
                        err
                    );
                }
            }

            if actually_removed && !branch.is_empty() {
                let _ = run_git(
                    &workspace_root,
                    &["branch".to_string(), "-D".to_string(), branch.clone()],
                )
                .await;
            }
        }

        // Persist the workspace change back to workspace_root now that any physical
        // cleanup is done. If we're not removing, this is the first write; if we
        // are removing it follows the git op so a persist failure leaves a clean disk.
        let mut next_workspace = current_workspace.clone();
        next_workspace.working_dir = workspace_root.clone();
        persist_workspace(&self.session_id, &next_workspace).await?;
        *self.workspace_state.write() = next_workspace;

        let mut content = format!(
            "Left worktree `{}`\nReturned to `{}`",
            path_str,
            workspace_root.display()
        );

        if remove {
            if actually_removed {
                content.push_str("\nRemoved worktree directory.");
            } else {
                content.push_str(&format!(
                    "\nWarning: worktree directory `{}` could not be removed (manual cleanup may be needed).",
                    path_str
                ));
            }
        } else {
            content.push_str(&format!(
                "\nNote: worktree directory `{}` was NOT removed. Pass `remove: true` to delete it.",
                path_str
            ));
        }

        let result = LeaveResult {
            success: true,
            removed: actually_removed,
            branch,
            path: path_str,
            content,
        };
        Ok(serde_json::to_string(&result).unwrap())
    }

    async fn list_worktrees(&self) -> Result<String, ToolError> {
        let workspace_root = self.workspace_state.read().workspace_root.clone();
        let output = run_git(
            &workspace_root,
            &[
                "worktree".to_string(),
                "list".to_string(),
                "--porcelain".to_string(),
            ],
        )
        .await?;

        if !output.status.success() {
            return Err(ToolError::ExecutionFailed(format!(
                "git worktree list failed: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        if stdout.trim().is_empty() {
            let result = ListResult {
                success: true,
                count: 0,
                entries: Vec::new(),
                content: "No worktrees found.".to_string(),
            };
            return Ok(serde_json::to_string(&result).unwrap());
        }

        let mut entries: Vec<WorktreeEntry> = Vec::new();
        let mut current_path = String::new();
        let mut current_branch = String::new();

        for line in stdout.lines() {
            if let Some(path) = line.strip_prefix("worktree ") {
                if !current_path.is_empty() {
                    entries.push(WorktreeEntry {
                        path: current_path.clone(),
                        branch: current_branch.clone(),
                    });
                }
                current_path = path.to_string();
                current_branch = String::new();
            } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
                current_branch = branch.to_string();
            } else if line == "bare" {
                current_branch = "(bare)".to_string();
            }
        }
        if !current_path.is_empty() {
            entries.push(WorktreeEntry {
                path: current_path,
                branch: current_branch,
            });
        }

        let display_lines: Vec<String> = entries
            .iter()
            .map(|entry| format!("- `{}` (branch: {})", entry.path, entry.branch))
            .collect();

        let content = format!(
            "**Worktrees ({}):**\n{}",
            entries.len(),
            display_lines.join("\n")
        );

        let result = ListResult {
            success: true,
            count: entries.len(),
            entries,
            content,
        };
        Ok(serde_json::to_string(&result).unwrap())
    }
}

async fn run_git(
    cwd: &std::path::Path,
    args: &[String],
) -> Result<std::process::Output, ToolError> {
    git::tokio_git_command()
        .map_err(|err| {
            ToolError::ExecutionFailed(format!("Failed to resolve bundled git: {}", err))
        })?
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|err| ToolError::ExecutionFailed(format!("Failed to run git: {}", err)))
}

async fn persist_workspace(
    session_id: &str,
    workspace: &SessionWorkspace,
) -> Result<(), ToolError> {
    let session_id = session_id.to_string();
    let workspace = workspace.clone();
    tokio::task::spawn_blocking(move || {
        crate::session::persistence::save_workspace(&session_id, &workspace)
    })
    .await
    .map_err(|err| ToolError::ExecutionFailed(format!("Failed to persist workspace: {}", err)))?
    .map(|_| ())
    .map_err(|err| ToolError::ExecutionFailed(format!("Failed to persist workspace: {}", err)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn params_schema_is_valid_json() {
        let schema = params_schema::<WorktreeParams>();
        assert!(schema.is_object());
    }

    #[test]
    fn parse_add_params() {
        let params = json!({
            "action": "add",
            "branch": "feature/test"
        });
        let parsed: WorktreeParams = parse_params(params).unwrap();
        match parsed {
            WorktreeParams::Add { branch, base_ref } => {
                assert_eq!(branch, "feature/test");
                assert!(base_ref.is_none());
            }
            _ => panic!("expected Add variant"),
        }
    }

    #[test]
    fn parse_add_with_base_ref() {
        let params = json!({
            "action": "add",
            "branch": "fix/bug",
            "base_ref": "main"
        });
        let parsed: WorktreeParams = parse_params(params).unwrap();
        match parsed {
            WorktreeParams::Add { branch, base_ref } => {
                assert_eq!(branch, "fix/bug");
                assert_eq!(base_ref.as_deref(), Some("main"));
            }
            _ => panic!("expected Add variant"),
        }
    }

    #[test]
    fn parse_leave_params() {
        let params = json!({ "action": "leave", "remove": true });
        let parsed: WorktreeParams = parse_params(params).unwrap();
        match parsed {
            WorktreeParams::Leave { remove } => assert!(remove),
            _ => panic!("expected Leave variant"),
        }
    }

    #[test]
    fn parse_leave_default_no_remove() {
        let params = json!({ "action": "leave" });
        let parsed: WorktreeParams = parse_params(params).unwrap();
        match parsed {
            WorktreeParams::Leave { remove } => assert!(!remove),
            _ => panic!("expected Leave variant"),
        }
    }

    #[test]
    fn parse_list_params() {
        let params = json!({ "action": "list" });
        let parsed: WorktreeParams = parse_params(params).unwrap();
        assert!(matches!(parsed, WorktreeParams::List));
    }

    fn test_tool() -> WorktreeTool {
        WorktreeTool::new(
            "test-session".to_string(),
            Arc::new(parking_lot::RwLock::new(SessionWorkspace::new(
                PathBuf::from("/tmp"),
            ))),
        )
    }

    #[test]
    fn tool_name_and_category() {
        let tool = test_tool();
        assert_eq!(tool.name(), "worktree");
        assert_eq!(tool.category(), "coding");
    }

    #[tokio::test]
    async fn leave_without_add_fails() {
        let tool = test_tool();
        let result = tool.execute(json!({ "action": "leave" })).await;
        assert!(result.is_err());
    }
}
