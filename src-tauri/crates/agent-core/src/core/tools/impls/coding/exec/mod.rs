//! Shell execution tool: subprocess by default, PTY for interactive commands.
//!
//! Regular commands (ls, git, grep, etc.) run via `std::process::Command` —
//! fast, reliable, clean stdout/stderr capture with no marker games.
//!
//! When `interactive: true` is set, the command runs in a persistent PTY
//! session (shared with the frontend terminal UI) for password prompts,
//! sudo, SSH, and other interactive use cases. The user can see the
//! terminal and take over at any time.
//!
//! Background processes are logged to files under `{app_data}/agent-terminal-logs/`
//! (Cursor-style). The agent can follow up using `await_output` subcommands
//! (wait/status/tail/list) to monitor progress, or `run_shell(kill_handle=...)`
//! to terminate.

pub mod await_tool;
mod pty;
pub mod registry;
mod subprocess;

use async_trait::async_trait;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::async_runtime::Mutex as AsyncMutex;
use tauri::AppHandle;
use tracing::{info, warn};

use tokio::sync::Mutex as TokioMutex;

use super::action_router::ActionRouter;
use crate::security::{self, SecurityPolicy, ValidationResult};
use crate::session::workspace::SessionWorkspace;
use crate::tools::names as tool_names;
use crate::tools::traits::{optional_string, required_string, Tool, ToolError};
use crate::turn_executor::{PermissionProvider, PermissionVerdict};
use ::terminal::pty_commands::pty::PtySession;

use self::pty::PtyResources;

/// Hard-coded fallback denylist of always-dangerous shell patterns.
///
/// Used **only** when this `ExecTool` instance has no
/// `SecurityPolicy` wired in (e.g. unit tests). When a policy is
/// present, `SecurityPolicy::validate_command_execution()` is the
/// single source of truth — this list is intentionally not consulted.
const DENY_PATTERNS: &[&str] = &[
    "rm -rf /",
    "rm -rf /*",
    "mkfs",
    "dd if=",
    ":(){ :|:", // fork bomb
    "> /dev/sda",
    "shutdown",
    "reboot",
    "halt",
    "poweroff",
];

/// Shell execution tool: subprocess default, PTY for interactive.
///
/// - **Default** (`interactive` omitted or `false`): runs command via
///   `std::process::Command` → fast, reliable, clean stdout/stderr.
/// - **Interactive** (`interactive: true`): runs in persistent PTY →
///   supports password prompts, sudo, SSH, interactive TUIs.
///   The terminal is visible in the frontend for user takeover.
pub struct ExecTool {
    working_dir: PathBuf,
    workspace_state: Option<Arc<parking_lot::RwLock<SessionWorkspace>>>,
    timeout_secs: u64,
    restrict_to_workspace: bool,
    pty: Option<PtyResources>,
    active_repo: TokioMutex<Option<PathBuf>>,
    router: Option<ActionRouter>,
    session_key: TokioMutex<Option<String>>,
    security_policy: Option<Arc<SecurityPolicy>>,
    permission_provider: TokioMutex<Option<Arc<dyn PermissionProvider>>>,
    terminal_logs_root: Option<PathBuf>,
}

impl ExecTool {
    /// Create an ExecTool without PTY capability (subprocess only).
    pub fn new(working_dir: PathBuf, timeout_secs: u64, restrict_to_workspace: bool) -> Self {
        Self {
            working_dir,
            workspace_state: None,
            timeout_secs,
            restrict_to_workspace,
            pty: None,
            active_repo: TokioMutex::new(None),
            router: None,
            session_key: TokioMutex::new(None),
            security_policy: None,
            permission_provider: TokioMutex::new(None),
            terminal_logs_root: None,
        }
    }

    /// Create an ExecTool with PTY capability (for interactive commands).
    pub fn new_with_pty(
        working_dir: PathBuf,
        timeout_secs: u64,
        restrict_to_workspace: bool,
        pty_sessions: Arc<AsyncMutex<HashMap<String, PtySession>>>,
        app_handle: AppHandle,
    ) -> Self {
        Self {
            working_dir,
            workspace_state: None,
            timeout_secs,
            restrict_to_workspace,
            router: None,
            session_key: TokioMutex::new(None),
            pty: Some(PtyResources::new(pty_sessions, app_handle)),
            active_repo: TokioMutex::new(None),
            security_policy: None,
            permission_provider: TokioMutex::new(None),
            terminal_logs_root: None,
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

    pub fn with_security_policy(mut self, policy: Arc<SecurityPolicy>) -> Self {
        self.security_policy = Some(policy);
        self
    }

    pub fn with_terminal_logs_root(mut self, path: PathBuf) -> Self {
        self.terminal_logs_root = Some(path);
        self
    }

    async fn request_command_confirmation(
        &self,
        command: &str,
        reason: &str,
    ) -> Result<(), ToolError> {
        let provider = self.permission_provider.lock().await.clone();
        let Some(provider) = provider else {
            return Err(ToolError::PermissionDenied(reason.to_string()));
        };

        if provider.is_always_allowed(tool_names::RUN_SHELL).await {
            return Ok(());
        }

        let Some(session_id) = self.session_key.lock().await.clone() else {
            return Err(ToolError::PermissionDenied(
                "Permission request cannot be shown because the session key is not configured."
                    .into(),
            ));
        };
        let tool_call_id = format!("{}-confirm-{}", tool_names::RUN_SHELL, uuid::Uuid::new_v4());
        let confirm_args = serde_json::json!({
            "command": command,
            "reason": reason,
        });

        info!("[ExecTool] Command requires user confirmation: {}", command);
        match provider
            .request_permission(
                &session_id,
                tool_names::RUN_SHELL,
                &tool_call_id,
                &confirm_args,
            )
            .await
        {
            Ok(PermissionVerdict::Allow | PermissionVerdict::AlwaysAllow) => {
                info!("[ExecTool] User approved command: {}", command);
                Ok(())
            }
            Ok(PermissionVerdict::Deny) => Err(ToolError::PermissionDenied(format!(
                "User denied execution of: {}",
                command
            ))),
            Err(_) => Err(ToolError::PermissionDenied(
                "Permission request was cancelled or timed out.".into(),
            )),
        }
    }

    fn is_denied(command: &str) -> bool {
        let lower = command.to_lowercase();
        DENY_PATTERNS.iter().any(|pattern| lower.contains(pattern))
    }
}

#[async_trait]
impl Tool for ExecTool {
    fn name(&self) -> &str {
        tool_names::RUN_SHELL
    }

    fn category(&self) -> &str {
        crate::tools::categories::CODING
    }

    fn output_budget(&self) -> usize {
        30_000
    }

    fn description(&self) -> &str {
        "Execute a shell command or kill a backgrounded process.\n\
        Execute: runs as a fast subprocess with clean stdout/stderr capture. \
        Set interactive: true ONLY for commands that require user input (passwords, sudo, SSH key passphrases). \
        Set mode: \"background\" up-front for long-running processes (dev servers, watchers, builds \
        you want to spawn then poll). Background mode returns {pid, logPath} as soon as the process \
        is spawned; use await_output(command=\"wait_for\", handles=[pid]) to monitor.\n\
        In the default blocking mode, commands that exceed the timeout are automatically backgrounded \
        (never killed) as a safety net — you get partial output plus a PID handle.\n\
        Kill: set kill_handle to the PID of a backgrounded process to terminate it (SIGTERM → 2s grace → SIGKILL).\n\
        For long-running commands (builds, installs, tests), prefer mode=\"background\" from the start, \
        or set 'wait' to a short duration (e.g. 10-30s) for early feedback in blocking mode. \
        IMPORTANT: Always limit output — use | head, --short, --oneline -N, -maxdepth, etc."
    }

    fn llm_description(&self) -> Option<String> {
        let cwd = self
            .active_repo
            .try_lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|path| path.display().to_string()))
            .unwrap_or_else(|| self.working_dir.display().to_string());
        Some(format!(
            "Execute a shell command in {cwd} or kill a backgrounded process.\n\
            Execute: runs as a fast subprocess with clean stdout/stderr capture. \
            Set interactive: true ONLY for commands that require user input (passwords, sudo, SSH key passphrases). \
            Set mode: \"background\" up-front for long-running processes (dev servers, watchers, builds \
            you want to spawn then poll). Background mode returns {{pid, logPath}} immediately after spawn; \
            use await_output(command=\"wait_for\", handles=[pid]) to monitor.\n\
            In the default blocking mode, commands that exceed the timeout ({timeout}s) are automatically \
            backgrounded (never killed) as a safety net. You get partial output, a PID handle, and a log file path.\n\
            Kill: set kill_handle to the PID of a backgrounded process to terminate it \
            (SIGTERM → 2s grace → SIGKILL).\n\
            For long-running commands (builds, installs, tests), prefer mode=\"background\" from the start, \
            or set 'wait' to a short duration (e.g. 10-30s) for early feedback in blocking mode. \
            IMPORTANT: Always limit output — use | head, --short, --oneline -N, -maxdepth, etc.",
            cwd = cwd, timeout = self.timeout_secs
        ))
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Shell command to execute. Use absolute paths when possible."
                },
                "description": {
                    "type": "string",
                    "description": "A short human-readable description of what this command does (5-10 words). Shown to the user as the title."
                },
                "working_dir": {
                    "type": "string",
                    "description": "Working directory for the command."
                },
                "interactive": {
                    "type": "boolean",
                    "description": "Set true ONLY for commands needing user input (password prompts, sudo, ssh). Default: false."
                },
                "mode": {
                    "type": "string",
                    "enum": ["blocking", "background"],
                    "description": "Execution mode. 'blocking' (default): wait for completion up to `wait` seconds, then auto-background on timeout. 'background': spawn and return immediately with {pid, logPath}; intended for dev servers, watchers, and other long-running processes you want to poll with await_output."
                },
                "wait": {
                    "type": "integer",
                    "description": "Blocking mode only. Seconds to wait before auto-backgrounding. Default: uses the configured exec timeout (~120s). Set lower (e.g. 10-30) for commands you expect to be long-running so you get partial output and a PID sooner. Set to 0 to auto-background immediately. Ignored when mode='background'. The process is never killed on timeout — use kill_handle to terminate."
                },
                "kill_handle": {
                    "type": "string",
                    "description": "Instead of running a command, kill a backgrounded shell process by its handle (PID). Sends SIGTERM, waits 2s grace, then SIGKILL. When this is set, 'command' is not required."
                }
            },
            "required": []
        })
    }

    async fn set_active_repo(&self, repo_path: &str) {
        let path = PathBuf::from(repo_path);
        if path.exists() {
            if let Some(ref policy) = self.security_policy {
                policy.add_allowed_dir(path.clone());
            }
            *self.active_repo.lock().await = Some(path);
        }
    }

    async fn set_session_key(&self, session_key: &str) {
        *self.session_key.lock().await = Some(session_key.to_string());
    }

    async fn set_permission_provider(&self, provider: Arc<dyn PermissionProvider>) {
        *self.permission_provider.lock().await = Some(provider);
    }

    async fn execute_text(&self, params: Value) -> Result<String, ToolError> {
        // Kill shortcut: run_shell(kill_handle="<pid>") to terminate a backgrounded process
        if let Some(handle) = params.get("kill_handle").and_then(|v| v.as_str()) {
            return match registry::kill_shell(handle).await {
                Ok(()) => Ok(format!("Process {handle} killed.")),
                Err(msg) => Err(ToolError::ExecutionFailed(msg)),
            };
        }

        let command = required_string(&params, "command")?;
        let custom_dir = optional_string(&params, "working_dir");
        let requested_interactive = params
            .get("interactive")
            .and_then(|val| val.as_bool())
            .unwrap_or(false);
        let interactive = requested_interactive;
        let wait_secs = params.get("wait").and_then(|val| val.as_u64());
        let mode = match params.get("mode").and_then(|v| v.as_str()) {
            None | Some("blocking") => subprocess::ExecMode::Blocking,
            Some("background") => subprocess::ExecMode::Background,
            Some(other) => {
                return Err(ToolError::InvalidParams(format!(
                    "Unknown mode \"{}\". Valid values: blocking, background.",
                    other
                )));
            }
        };

        if let Some(ref policy) = self.security_policy {
            match policy.validate_command_execution(&command, false) {
                ValidationResult::Allowed(_risk) => {}
                ValidationResult::NeedsApproval(_risk, reason) => {
                    self.request_command_confirmation(&command, &reason).await?;
                }
                ValidationResult::Denied(reason) => {
                    return Err(ToolError::PermissionDenied(reason));
                }
            }
        } else {
            if Self::is_denied(&command) {
                return Err(ToolError::PermissionDenied(format!(
                    "Command denied for safety: {}",
                    command
                )));
            }
            if let Some(reason) = security::requires_user_confirmation(&command) {
                self.request_command_confirmation(&command, &reason).await?;
            }
        }

        let current_workspace_dir = self
            .workspace_state
            .as_ref()
            .map(|workspace| workspace.read().working_dir().to_path_buf())
            .unwrap_or_else(|| self.working_dir.clone());
        let base_dir = {
            let active = self.active_repo.lock().await;
            active
                .clone()
                .unwrap_or_else(|| current_workspace_dir.clone())
        };

        let work_dir = if let Some(ref dir) = custom_dir {
            let path = PathBuf::from(dir);
            if let Some(ref policy) = self.security_policy {
                policy
                    .is_path_allowed(dir)
                    .map_err(ToolError::PermissionDenied)?;
                if let Ok(resolved) = path.canonicalize() {
                    policy
                        .is_resolved_path_allowed(&resolved)
                        .map_err(ToolError::PermissionDenied)?;
                }
            } else if self.restrict_to_workspace && !path.starts_with(&current_workspace_dir) {
                return Err(ToolError::PermissionDenied(
                    "Working directory is outside workspace".to_string(),
                ));
            }
            Some(path)
        } else {
            None
        };

        // Resolve the cwd we want to spawn under. If the agent passed a custom
        // dir, honour it strictly (error if missing). Otherwise we may fall
        // back to the workspace root when the previously cached active_repo /
        // worktree has been deleted out from under us (e.g. an E2E scenario
        // tmpdir was cleaned, or `git worktree prune` removed a stale entry).
        // Without this fallback `tokio::process::Command::current_dir(...)`
        // returns ENOENT and the agent surfaces an opaque "Failed to spawn
        // command: No such file or directory" for every subsequent shell call.
        let mut effective_dir = work_dir.clone().unwrap_or(base_dir.clone());
        if !effective_dir.exists() {
            if work_dir.is_some() {
                return Err(ToolError::InvalidParams(format!(
                    "Working directory does not exist: {}",
                    effective_dir.display()
                )));
            }
            if effective_dir != current_workspace_dir && current_workspace_dir.exists() {
                warn!(
                    "[ExecTool] cached cwd '{}' no longer exists; falling back to workspace '{}'",
                    effective_dir.display(),
                    current_workspace_dir.display(),
                );
                effective_dir = current_workspace_dir.clone();
            } else {
                return Err(ToolError::ExecutionFailed(format!(
                    "Working directory does not exist: {}",
                    effective_dir.display()
                )));
            }
        }

        info!(
            "exec: {} (cwd: {}, interactive: {})",
            command,
            effective_dir.display(),
            interactive,
        );

        if !interactive {
            if let Some(ref router) = self.router {
                if router.should_route() {
                    let exec_params = serde_json::json!({
                        "command": command,
                        "cwd": effective_dir.to_string_lossy(),
                    });
                    if let Some(result) = router.try_execute("terminal.exec", exec_params).await? {
                        return Ok(result);
                    }
                }
            }
        }

        if interactive {
            if matches!(mode, subprocess::ExecMode::Background) {
                return Err(ToolError::InvalidParams(
                    "mode=\"background\" is incompatible with interactive=true. \
                     Interactive sessions cannot be detached; drop one of the two options."
                        .into(),
                ));
            }
            if let Some(ref pty_res) = self.pty {
                let Some(session_key) = self.session_key.lock().await.clone() else {
                    return Err(ToolError::ExecutionFailed(
                        "PTY execution requires an agent session key.".to_string(),
                    ));
                };
                return pty::execute_via_pty(
                    pty_res,
                    &command,
                    work_dir.as_ref(),
                    self.timeout_secs,
                    wait_secs,
                    &current_workspace_dir,
                    &session_key,
                )
                .await;
            }
            info!("[ExecTool] interactive=true requested but PTY not available, using subprocess");
        }

        let session_key = self.session_key.lock().await.clone();
        subprocess::execute_via_command(
            &command,
            effective_dir,
            self.timeout_secs,
            wait_secs,
            mode,
            session_key.as_deref(),
            self.terminal_logs_root.as_ref(),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::Path;

    fn fresh_tool(workspace: &Path) -> ExecTool {
        ExecTool::new(workspace.to_path_buf(), 5, false)
    }

    #[tokio::test]
    async fn execute_falls_back_to_workspace_when_cached_repo_was_deleted() {
        let workspace = tempfile::tempdir().expect("workspace tmpdir");
        let stale_repo = workspace.path().join("worktree-deleted");
        std::fs::create_dir_all(&stale_repo).unwrap();

        let tool = fresh_tool(workspace.path());
        *tool.active_repo.lock().await = Some(stale_repo.clone());

        std::fs::remove_dir_all(&stale_repo).unwrap();
        assert!(!stale_repo.exists());

        let result = tool
            .execute_text(json!({"command": "/bin/echo hello"}))
            .await
            .expect("run_shell should succeed after fallback");

        assert!(
            result.contains("hello"),
            "expected 'hello' in fallback result: {result}"
        );
    }

    #[tokio::test]
    async fn execute_errors_when_explicit_working_directory_is_missing() {
        let workspace = tempfile::tempdir().expect("workspace tmpdir");
        let tool = fresh_tool(workspace.path());
        let bogus = workspace.path().join("does-not-exist");

        let result = tool
            .execute_text(json!({
                "command": "/bin/echo nope",
                "working_dir": bogus.to_string_lossy(),
            }))
            .await;

        match result {
            Err(ToolError::InvalidParams(msg)) => {
                assert!(
                    msg.contains("Working directory does not exist"),
                    "unexpected error: {msg}"
                );
            }
            other => panic!("expected InvalidParams, got {other:?}"),
        }
    }
}
