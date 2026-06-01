//! PTY execution path: persistent terminal for interactive commands.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::async_runtime::Mutex as AsyncMutex;
use tauri::AppHandle;
use tokio::sync::broadcast;
use tracing::info;

use crate::tools::traits::ToolError;
use ::terminal::pty_commands::pty::PtySession;

/// PTY session ID for the OS agent's persistent terminal.
pub const AGENT_PTY_SESSION_ID: &str = "agent-pty-main";

/// Broadcast channel capacity for PTY output capture.
const OUTPUT_CHANNEL_CAPACITY: usize = 8192;

/// PTY resources (optional — only needed when interactive mode is used).
pub struct PtyResources {
    pub sessions: Arc<AsyncMutex<HashMap<String, PtySession>>>,
    pub app_handle: AppHandle,
    pub output_tx: broadcast::Sender<String>,
    pub initialized: Arc<AtomicBool>,
}

impl PtyResources {
    pub fn new(
        sessions: Arc<AsyncMutex<HashMap<String, PtySession>>>,
        app_handle: AppHandle,
    ) -> Self {
        let (output_tx, _) = broadcast::channel(OUTPUT_CHANNEL_CAPACITY);
        Self {
            sessions,
            app_handle,
            output_tx,
            initialized: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Initialize the PTY session (lazy, on first interactive command).
pub async fn ensure_pty_initialized(pty: &PtyResources, working_dir: &Path) -> Result<(), String> {
    if pty.initialized.load(Ordering::Relaxed) {
        let sessions = pty.sessions.lock().await;
        if sessions.contains_key(AGENT_PTY_SESSION_ID) {
            return Ok(());
        }
        drop(sessions);
        pty.initialized.store(false, Ordering::Relaxed);
    }

    info!(
        "[ExecTool] Initializing PTY session: {}",
        AGENT_PTY_SESSION_ID
    );

    crate::tool_infra::terminal::create_agent_session(
        AGENT_PTY_SESSION_ID.to_string(),
        Some(working_dir.to_string_lossy().to_string()),
        pty.app_handle.clone(),
        pty.sessions.clone(),
        pty.output_tx.clone(),
    )
    .await?;

    pty.initialized.store(true, Ordering::Relaxed);

    crate::bus::broadcast_event(
        "agent:terminal_created",
        serde_json::json!({
            "sessionId": AGENT_PTY_SESSION_ID,
            "ptySessionId": AGENT_PTY_SESSION_ID,
        }),
    );

    tokio::time::sleep(Duration::from_millis(500)).await;

    Ok(())
}

/// Execute a command in the persistent PTY session.
///
/// When `wait_secs` is `Some(N)`, spawns `exec_in_pty` as a background task
/// and collects partial output via a parallel broadcast subscriber.
pub async fn execute_via_pty(
    pty: &PtyResources,
    command: &str,
    work_dir: Option<&PathBuf>,
    timeout_secs: u64,
    wait_secs: Option<u64>,
    working_dir: &Path,
) -> Result<String, ToolError> {
    ensure_pty_initialized(pty, working_dir)
        .await
        .map_err(|err| ToolError::ExecutionFailed(format!("PTY init failed: {}", err)))?;

    if wait_secs.is_none() {
        let mut output_rx = pty.output_tx.subscribe();
        let timeout = Duration::from_secs(timeout_secs);

        match crate::tool_infra::terminal::exec_in_pty(
            command,
            work_dir,
            AGENT_PTY_SESSION_ID,
            pty.sessions.clone(),
            &mut output_rx,
            timeout,
        )
        .await
        {
            Ok((output, exit_code)) => {
                if exit_code != 0 {
                    Ok(format!("{}\n[exit code: {}]", output, exit_code))
                } else if output.is_empty() {
                    Ok("(no output)".to_string())
                } else {
                    Ok(output)
                }
            }
            Err(_) => Ok(format!(
                "[command still running in terminal after {}s]\n\
                    The command continues in the interactive terminal (visible to user).\n\
                    Call run_shell again later to run a follow-up command.",
                timeout_secs,
            )),
        }
    } else {
        let effective_wait = wait_secs.unwrap_or(timeout_secs);

        let mut partial_rx = pty.output_tx.subscribe();

        let output_tx_clone = pty.output_tx.clone();
        let sessions = pty.sessions.clone();
        let cmd = command.to_string();
        let wd = work_dir.cloned();
        let full_timeout = Duration::from_secs(timeout_secs);

        let exec_handle = tokio::spawn(async move {
            let mut rx = output_tx_clone.subscribe();
            crate::tool_infra::terminal::exec_in_pty(
                &cmd,
                wd.as_ref(),
                AGENT_PTY_SESSION_ID,
                sessions,
                &mut rx,
                full_timeout,
            )
            .await
        });

        let mut partial_output = String::new();
        let wait_deadline = tokio::time::Instant::now() + Duration::from_secs(effective_wait);

        loop {
            if exec_handle.is_finished() {
                let result = exec_handle
                    .await
                    .map_err(|err| {
                        ToolError::ExecutionFailed(format!("PTY task panicked: {}", err))
                    })?
                    .map_err(ToolError::ExecutionFailed)?;
                let (output, exit_code) = result;

                if exit_code != 0 {
                    return Ok(format!("{}\n[exit code: {}]", output, exit_code));
                } else if output.is_empty() {
                    return Ok("(no output)".to_string());
                } else {
                    return Ok(output);
                }
            }

            let remaining = wait_deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                exec_handle.abort();

                let cleaned = crate::tool_infra::terminal::clean_pty_output(&partial_output);
                let truncated = crate::tool_infra::terminal::truncate_output(&cleaned);

                return Ok(format!(
                    "{}\n\n\
                    [command still running in terminal after {}s]\n\
                    The command continues in the interactive terminal (visible to user).\n\
                    Call run_shell again later to run a follow-up command.",
                    if truncated.is_empty() {
                        "(no output yet)".to_string()
                    } else {
                        truncated
                    },
                    effective_wait,
                ));
            }

            match tokio::time::timeout(remaining.min(Duration::from_millis(500)), partial_rx.recv())
                .await
            {
                Ok(Ok(chunk)) => partial_output.push_str(&chunk),
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => {
                    partial_output.push_str("[...some output lost...]\n");
                }
                Ok(Err(broadcast::error::RecvError::Closed)) => break,
                Err(_) => {}
            }
        }

        Err(ToolError::ExecutionFailed(
            "PTY broadcast channel closed unexpectedly".to_string(),
        ))
    }
}
