//! Workspace management tool.
//!
//! Unified tool for managing orgii workspaces (git repositories and work folders)
//! tracked by the IDE. Consolidates list / add / clone / create / remove into a
//! single `manage_workspace` tool with an `action` parameter.
//!
//! Actions:
//! - `list`   — Enumerate all workspaces currently tracked.
//! - `add`    — Register an existing local directory (auto-detects git vs folder).
//! - `clone`  — Clone a remote git URL into a target directory and register it.
//! - `create` — Create a new empty workspace (git repo or plain folder).
//! - `remove` — Unregister a workspace (files on disk are untouched).
//!
//! All actions delegate to `git::repos::repo_service`, the same layer
//! the Tauri commands use, so human UI and agent share one implementation.

use std::sync::Arc;
use std::sync::Mutex as StdMutex;

use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::Mutex as TokioMutex;

use crate::tools::names as tool_names;
use crate::tools::traits::{params_schema, parse_params, Tool, ToolError};
use git::repos::repo_db::RepoRecord;
use git::repos::repo_service::{self, CloneProgress, CloneProgressCallback};

// ============================================
// Params
// ============================================

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ManageWorkspaceParams {
    /// List all workspaces (git repos and work folders) currently tracked.
    List,
    /// Register an existing local directory as a workspace. The kind
    /// (git / folder) is inferred from whether a `.git` directory is present.
    /// If the directory is not a git repo, `git init` is run so git tools
    /// work immediately.
    Add {
        /// Absolute path to the directory to register.
        path: String,
        /// Optional display name (defaults to the directory basename).
        #[serde(default)]
        name: Option<String>,
    },
    /// Clone a remote git repository into `target_dir/<name>` and register it
    /// as a workspace.
    Clone {
        /// Remote repository URL (HTTPS or SSH). Public URLs work without
        /// extra configuration; private URLs require the user's local git
        /// credential helper or SSH agent to be configured.
        url: String,
        /// Directory under which the cloned repo will be placed. The new
        /// repo ends up at `<target_dir>/<name>`.
        target_dir: String,
        /// Optional display / folder name. Defaults to the URL's last path
        /// segment with `.git` stripped.
        #[serde(default)]
        name: Option<String>,
    },
    /// Create a brand-new empty workspace at `path`.
    Create {
        /// Absolute path where the new workspace should live. The parent
        /// directory must already exist; the final component will be created.
        path: String,
        /// Optional display name (defaults to the final path component).
        #[serde(default)]
        name: Option<String>,
        /// When true (default) the new workspace is initialised as a git
        /// repo. Set to false for a plain work folder.
        #[serde(default = "app_utils::default_true")]
        git: bool,
    },
    /// Remove a workspace from the tracked list. Files on disk are not deleted.
    Remove {
        /// Absolute path of the workspace to remove. Either `path` or
        /// `repo_id` must be provided; `path` is preferred for readability.
        #[serde(default)]
        path: Option<String>,
        /// Repo identifier (usually the canonical path). Alternative to `path`.
        #[serde(default)]
        repo_id: Option<String>,
    },
}

// ============================================
// Tool
// ============================================

/// Unified workspace management tool.
#[derive(Default)]
pub struct ManageWorkspaceTool {
    /// Set per-turn by the processor via [`Tool::set_session_key`]; used as
    /// the `sessionId` on `agent:workspace_clone_progress` events so the
    /// frontend can route progress to the right tool-call card.
    session_key: TokioMutex<Option<String>>,
}

impl ManageWorkspaceTool {
    pub fn new() -> Self {
        Self {
            session_key: TokioMutex::new(None),
        }
    }
}

/// Throttle progress events to at most ~10 Hz per phase so we don't flood
/// the frontend with hundreds of intermediate `Receiving objects` updates.
/// We always send the first and last (100%) update for each phase, plus
/// any update that bumps the percent by ≥1.
struct ProgressThrottle {
    last_phase: Option<String>,
    last_percent: Option<u8>,
    last_emit: std::time::Instant,
}

impl ProgressThrottle {
    fn new() -> Self {
        Self {
            last_phase: None,
            last_percent: None,
            last_emit: std::time::Instant::now()
                .checked_sub(std::time::Duration::from_secs(1))
                .unwrap_or_else(std::time::Instant::now),
        }
    }

    fn should_emit(&mut self, update: &CloneProgress) -> bool {
        let phase_changed = self.last_phase.as_deref() != Some(update.phase.as_str());
        let is_terminal = update.percent == Some(100);
        let percent_changed = update.percent != self.last_percent;
        let throttled = self.last_emit.elapsed() >= std::time::Duration::from_millis(100);

        let emit = phase_changed || is_terminal || (percent_changed && throttled);
        if emit {
            self.last_phase = Some(update.phase.clone());
            self.last_percent = update.percent;
            self.last_emit = std::time::Instant::now();
        }
        emit
    }
}

fn extract_call_id(params: &Value) -> Option<String> {
    params
        .as_object()?
        .get(crate::core::turn_executor::tool_execution::TOOL_CALL_ID_KEY)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn build_progress_callback(session_id: String, tool_call_id: String) -> CloneProgressCallback {
    let throttle = Arc::new(StdMutex::new(ProgressThrottle::new()));
    Arc::new(move |update: CloneProgress| {
        let pass = match throttle.lock() {
            Ok(mut guard) => guard.should_emit(&update),
            Err(_) => true,
        };
        if !pass {
            return;
        }
        crate::bus::broadcast_event(
            "agent:workspace_clone_progress",
            serde_json::json!({
                "sessionId": session_id,
                "toolCallId": tool_call_id,
                "phase": update.phase,
                "percent": update.percent,
                "raw": update.raw,
            }),
        );
    })
}

#[async_trait]
impl Tool for ManageWorkspaceTool {
    fn name(&self) -> &str {
        tool_names::MANAGE_WORKSPACE
    }

    fn category(&self) -> &str {
        crate::tools::categories::CODING
    }

    fn description(&self) -> &str {
        "Manage orgii workspaces (git repositories and work folders) tracked by the IDE.\n\n\
         ## Required: `action` field\n\
         Every call MUST include an `action` field as the first key of the arguments object. There is no default. Calling without `action` fails with `missing field 'action'`.\n\n\
         ## Actions\n\
         - **list**   — List all currently tracked workspaces with names, absolute paths, and kinds (git/folder). Use this FIRST when the user mentions a project by name — it's instant and avoids slow filesystem searches.\n\
         - **add**    — Register an existing local directory as a workspace. Kind (git / folder) is auto-detected from the presence of `.git`; non-git directories get `git init` run automatically.\n\
         - **clone**  — Clone a remote git URL into `target_dir/<name>` and register it. Uses the user's configured git credentials.\n\
         - **create** — Create a new empty workspace. Defaults to `git=true` (runs `git init`); set `git=false` for a plain work folder.\n\
         - **remove** — Unregister a workspace. Files on disk are NOT deleted — only the tracked entry.\n\n\
         ## Examples\n\
         - `{\"action\": \"list\"}`\n\
         - `{\"action\": \"add\", \"path\": \"/Users/me/code/my-app\"}`\n\
         - `{\"action\": \"clone\", \"url\": \"https://github.com/foo/bar\", \"target_dir\": \"/Users/me/code\"}`\n\
         - `{\"action\": \"create\", \"path\": \"/Users/me/code/new-thing\", \"git\": true}`\n\
         - `{\"action\": \"remove\", \"path\": \"/Users/me/code/old-thing\"}`"
    }

    fn parameters(&self) -> Value {
        params_schema::<ManageWorkspaceParams>()
    }

    async fn set_session_key(&self, session_key: &str) {
        *self.session_key.lock().await = Some(session_key.to_string());
    }

    async fn execute_text(&self, params: Value) -> Result<String, ToolError> {
        // Read `__call_id` + the captured session key BEFORE handing the
        // params to serde — those are framework-internal metadata keys
        // that the typed `ManageWorkspaceParams` enum doesn't model.
        let tool_call_id = extract_call_id(&params);
        let session_id = self.session_key.lock().await.clone();

        let params: ManageWorkspaceParams = parse_params(params)?;
        match params {
            ManageWorkspaceParams::List => exec_list().await,
            ManageWorkspaceParams::Add { path, name } => exec_add(path, name).await,
            ManageWorkspaceParams::Clone {
                url,
                target_dir,
                name,
            } => {
                let progress = match (session_id, tool_call_id) {
                    (Some(sid), Some(cid)) => Some(build_progress_callback(sid, cid)),
                    _ => None,
                };
                exec_clone(url, target_dir, name, progress).await
            }
            ManageWorkspaceParams::Create { path, name, git } => exec_create(path, name, git).await,
            ManageWorkspaceParams::Remove { path, repo_id } => {
                exec_remove(path.as_deref(), repo_id.as_deref()).await
            }
        }
    }
}

// ============================================
// Action implementations
// ============================================

/// Format a single repo record as `[kind] name → path`.
fn format_entry(repo: &RepoRecord) -> String {
    format!("[{}] {} → {}", repo.kind.as_str(), repo.name, repo.path)
}

fn into_tool_err(err: String) -> ToolError {
    ToolError::ExecutionFailed(err)
}

async fn exec_list() -> Result<String, ToolError> {
    let repos = repo_service::list().await.map_err(into_tool_err)?;

    if repos.is_empty() {
        return Ok("No workspaces are currently tracked.".to_string());
    }

    let mut lines: Vec<String> = repos.iter().map(format_entry).collect();
    lines.sort();

    Ok(format!(
        "Workspaces ({}):\n{}",
        lines.len(),
        lines.join("\n")
    ))
}

async fn exec_add(path: String, name: Option<String>) -> Result<String, ToolError> {
    let record = repo_service::import_auto(path, name)
        .await
        .map_err(into_tool_err)?;
    Ok(format!("Added workspace (1):\n{}", format_entry(&record)))
}

async fn exec_clone(
    url: String,
    target_dir: String,
    name: Option<String>,
    on_progress: Option<CloneProgressCallback>,
) -> Result<String, ToolError> {
    let record = repo_service::clone_github_with_progress(url, target_dir, name, on_progress)
        .await
        .map_err(into_tool_err)?;
    Ok(format!("Cloned workspace (1):\n{}", format_entry(&record)))
}

async fn exec_create(path: String, name: Option<String>, git: bool) -> Result<String, ToolError> {
    let record = if git {
        repo_service::create_empty_repo(path, name)
            .await
            .map_err(into_tool_err)?
    } else {
        repo_service::create_folder(path, name)
            .await
            .map_err(into_tool_err)?
    };
    Ok(format!("Created workspace (1):\n{}", format_entry(&record)))
}

async fn exec_remove(path: Option<&str>, repo_id: Option<&str>) -> Result<String, ToolError> {
    let target_id = match (repo_id, path) {
        (Some(id), _) if !id.trim().is_empty() => id.to_string(),
        (_, Some(p)) if !p.trim().is_empty() => std::path::Path::new(p)
            .canonicalize()
            .map(|c| c.to_string_lossy().to_string())
            .unwrap_or_else(|_| p.to_string()),
        _ => {
            return Err(ToolError::InvalidParams(
                "Provide either `path` or `repo_id` to remove.".to_string(),
            ));
        }
    };

    let removed = repo_service::remove(target_id.clone())
        .await
        .map_err(into_tool_err)?;

    match removed {
        Some(record) => Ok(format!("Removed workspace (1):\n{}", format_entry(&record))),
        None => Err(ToolError::InvalidParams(format!(
            "No workspace tracked for '{}'. Use the `list` action to see tracked workspaces.",
            target_id
        ))),
    }
}
