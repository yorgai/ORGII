//! Subprocess execution: fast `tokio::process::Command` path with real-time streaming.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use tracing::{info, warn};

use crate::core::tools::impls::coding::terminal_log::{LogProcessStatus, TerminalLogWriter};
use crate::tools::traits::ToolError;

use std::process::Stdio;

use super::registry;

/// Broadcast a single `agent:exec_output` event to the frontend.
pub fn broadcast_exec_output(session_id: &str, chunk: &str, stream: &str) {
    crate::bus::broadcast_event(
        "agent:exec_output",
        serde_json::json!({
            "sessionId": session_id,
            "chunk": chunk,
            "stream": stream,
        }),
    );
}

/// Broadcast shell process started event (for frontend Stop button / status).
pub fn broadcast_process_started(
    session_id: &str,
    pid: u32,
    command: &str,
    log_path: Option<&str>,
) {
    crate::bus::broadcast_event(
        "agent:shell_process_started",
        serde_json::json!({
            "sessionId": session_id,
            "pid": pid,
            "command": command,
            "logPath": log_path,
        }),
    );
}

/// Broadcast shell process exited event.
pub fn broadcast_process_exited(session_id: &str, pid: u32, exit_code: Option<i32>, killed: bool) {
    crate::bus::broadcast_event(
        "agent:shell_process_exited",
        serde_json::json!({
            "sessionId": session_id,
            "pid": pid,
            "exitCode": exit_code,
            "killed": killed,
        }),
    );
}

/// Reason a shell process entered backgrounded state.
#[derive(Clone, Copy, Debug)]
pub enum BackgroundReason {
    /// Agent requested `mode: "background"` up-front; process never blocked.
    Explicit,
    /// Blocking run hit `wait_secs` without completing; auto-backgrounded as a safety net.
    Timeout,
}

impl BackgroundReason {
    fn as_wire_str(&self) -> &'static str {
        match self {
            Self::Explicit => "explicit",
            Self::Timeout => "timeout",
        }
    }
}

/// Broadcast shell process backgrounded event.
///
/// Emitted exactly once per backgrounded process — either immediately after spawn
/// (explicit `mode="background"`) or when a blocking run's `wait_secs` elapses
/// (timeout auto-background). The frontend uses this to keep the chat's terminal
/// block expanded with a "backgrounded · PID N" chip while the process continues
/// running detached.
pub fn broadcast_process_backgrounded(
    session_id: &str,
    pid: u32,
    log_path: Option<&str>,
    reason: BackgroundReason,
) {
    crate::bus::broadcast_event(
        "agent:shell_process_backgrounded",
        serde_json::json!({
            "sessionId": session_id,
            "pid": pid,
            "logPath": log_path,
            "reason": reason.as_wire_str(),
        }),
    );
}

/// Execution mode for `execute_via_command`. Maps 1:1 to the `run_shell` tool's
/// `mode` parameter — see `ExecTool::parameters()` in `mod.rs`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExecMode {
    /// Default: wait up to `wait_secs` for completion, auto-background on timeout.
    Blocking,
    /// Spawn-and-return: emit `shell_process_backgrounded` immediately, let the
    /// detached monitor task deliver `shell_process_exited` when it eventually ends.
    Background,
}

/// Format stdout + stderr + exit code into the standard tool result string.
pub fn format_command_result(
    stdout: &str,
    stderr: &str,
    exit_code: i32,
) -> Result<String, ToolError> {
    let mut result_parts = Vec::new();
    if !stdout.is_empty() {
        result_parts.push(crate::tool_infra::terminal::truncate_output(stdout));
    }
    if !stderr.is_empty() {
        result_parts.push(format!(
            "[stderr]\n{}",
            crate::tool_infra::terminal::truncate_output(stderr),
        ));
    }
    let combined = if result_parts.is_empty() {
        "(no output)".to_string()
    } else {
        result_parts.join("\n")
    };

    if exit_code != 0 {
        Ok(format!("{}\n[exit code: {}]", combined, exit_code))
    } else {
        Ok(combined)
    }
}

#[cfg(unix)]
fn signal_process_group(pid: u32, signal: libc::c_int) -> std::io::Result<()> {
    let process_group = -(pid as libc::pid_t);
    let group_result = unsafe { libc::kill(process_group, signal) };
    if group_result == 0 {
        return Ok(());
    }

    let group_error = std::io::Error::last_os_error();
    let process_result = unsafe { libc::kill(pid as libc::pid_t, signal) };
    if process_result == 0 {
        return Ok(());
    }

    let process_error = std::io::Error::last_os_error();
    if group_error.raw_os_error() == Some(libc::ESRCH) {
        Err(process_error)
    } else {
        Err(group_error)
    }
}

#[cfg(unix)]
async fn terminate_child_tree(pid: u32, child: &mut tokio::process::Child) {
    if pid != 0 {
        if let Err(err) = signal_process_group(pid, libc::SIGTERM) {
            if err.raw_os_error() != Some(libc::ESRCH) {
                warn!(
                    "[subprocess] Failed to SIGTERM process group {}: {}",
                    pid, err
                );
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(err) => {
                warn!(
                    "[subprocess] Failed to inspect child after SIGTERM: {}",
                    err
                );
            }
        }
        if let Err(err) = signal_process_group(pid, libc::SIGKILL) {
            if err.raw_os_error() != Some(libc::ESRCH) {
                warn!(
                    "[subprocess] Failed to SIGKILL process group {}: {}",
                    pid, err
                );
            }
        }
    }
    if let Err(err) = child.kill().await {
        warn!("[subprocess] Failed to kill child process: {}", err);
    }
}

#[cfg(windows)]
async fn terminate_child_tree(_pid: u32, child: &mut tokio::process::Child) {
    if let Err(err) = child.kill().await {
        warn!("[subprocess] Failed to kill child process: {}", err);
    }
}

async fn join_reader_task(task: tokio::task::JoinHandle<()>, stream: &str) {
    if tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .is_err()
    {
        warn!("[subprocess] {} reader did not finish within 5s", stream);
    }
}

fn finish_cancelled_process(
    pid: u32,
    session_key: Option<&str>,
    log_writer: Option<&Arc<StdMutex<TerminalLogWriter>>>,
) -> Result<String, ToolError> {
    if let Some(ref log) = log_writer {
        if let Ok(mut writer) = log.lock() {
            let _ = writer.finalize(LogProcessStatus::Killed, None);
        }
    }

    if let Some(session_id) = session_key {
        broadcast_exec_output(
            session_id,
            &format!("[process {} cancelled by user]", pid),
            "system",
        );
        broadcast_process_exited(session_id, pid, None, true);
    }

    Err(ToolError::ExecutionFailed(
        "Command cancelled by user".to_string(),
    ))
}

/// Execute a command via `tokio::process::Command` with real-time streaming.
///
/// Streams stdout/stderr line-by-line via `agent:exec_output` events
/// (delivered to the frontend over the Tauri IPC Channel) so the UI can
/// display output in real-time. Still collects and returns the full output
/// string for the LLM.
///
/// The `mode` parameter decides whether this call blocks for completion:
/// - `ExecMode::Blocking` — wait up to `wait_secs` for the process to exit. If
///   it does not, auto-background as a safety net (emits
///   `agent:shell_process_backgrounded` with `reason: "timeout"`) and return
///   partial output + PID handle so the agent can poll via `await_output`.
/// - `ExecMode::Background` — return immediately after spawn with the PID and
///   log path (emits `agent:shell_process_backgrounded` with
///   `reason: "explicit"`). `wait_secs` is ignored. Intended for dev servers,
///   watchers, and other long-running processes.
pub async fn execute_via_command(
    command: &str,
    work_dir: PathBuf,
    timeout_secs: u64,
    wait_secs: Option<u64>,
    mode: ExecMode,
    session_key: Option<&str>,
    terminal_logs_root: Option<&PathBuf>,
    cancel_flag: Option<&AtomicBool>,
) -> Result<String, ToolError> {
    if let Some(session_id) = session_key {
        let header = format!("$ {}", command);
        broadcast_exec_output(session_id, &header, "system");
    }

    #[cfg(unix)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("sh");
        c.arg("-c");
        c
    };

    #[cfg(windows)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        c.arg("/C");
        c
    };

    cmd.arg(command)
        .current_dir(&work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(unix)]
    {
        cmd.process_group(0);
    }

    let mut child = cmd
        .spawn()
        .map_err(|err| ToolError::ExecutionFailed(format!("Failed to spawn command: {}", err)))?;

    let pid = child.id().unwrap_or(0);
    if pid == 0 {
        warn!("[subprocess] child.id() returned None — PID tracking disabled for this command");
    }
    let effective_wait = wait_secs.unwrap_or(timeout_secs);

    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();

    let session_for_stdout = session_key.map(|s| s.to_string());
    let session_for_stderr = session_key.map(|s| s.to_string());

    let stdout_buf = Arc::new(StdMutex::new(String::new()));
    let stderr_buf = Arc::new(StdMutex::new(String::new()));

    let log_writer: Option<Arc<StdMutex<TerminalLogWriter>>> =
        if let Some(logs_root) = terminal_logs_root {
            match TerminalLogWriter::create(logs_root, pid, &work_dir.to_string_lossy(), command) {
                Ok(writer) => {
                    if let Some(session_id) = session_key {
                        broadcast_process_started(
                            session_id,
                            pid,
                            command,
                            Some(writer.path.to_string_lossy().as_ref()),
                        );
                    }
                    Some(Arc::new(StdMutex::new(writer)))
                }
                Err(err) => {
                    info!("[ExecTool] Failed to create terminal log: {}", err);
                    if let Some(session_id) = session_key {
                        broadcast_process_started(session_id, pid, command, None);
                    }
                    None
                }
            }
        } else {
            if let Some(session_id) = session_key {
                broadcast_process_started(session_id, pid, command, None);
            }
            None
        };

    let stdout_buf_w = stdout_buf.clone();
    let log_for_stdout = log_writer.clone();
    let stdout_task = tokio::spawn(async move {
        if let Some(stdout) = stdout_handle {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break,
                    Ok(_) => {
                        if let Some(ref session_id) = session_for_stdout {
                            broadcast_exec_output(session_id, &line, "stdout");
                        }
                        if let Ok(mut buf) = stdout_buf_w.lock() {
                            buf.push_str(&line);
                        }
                        if let Some(ref log) = log_for_stdout {
                            if let Ok(mut writer) = log.lock() {
                                let _ = writer.append(&line);
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    });

    let stderr_buf_w = stderr_buf.clone();
    let log_for_stderr = log_writer.clone();
    let stderr_task = tokio::spawn(async move {
        if let Some(stderr) = stderr_handle {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break,
                    Ok(_) => {
                        if let Some(ref session_id) = session_for_stderr {
                            broadcast_exec_output(session_id, &line, "stderr");
                        }
                        if let Ok(mut buf) = stderr_buf_w.lock() {
                            buf.push_str(&line);
                        }
                        if let Some(ref log) = log_for_stderr {
                            if let Ok(mut writer) = log.lock() {
                                let _ = writer.append(&format!("[stderr] {}", line));
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    });

    let log_path: Option<PathBuf> = log_writer
        .as_ref()
        .and_then(|w: &Arc<StdMutex<TerminalLogWriter>>| w.lock().ok().map(|w| w.path.clone()));

    // Explicit-background mode: spawn the detached monitor immediately and
    // return a lightweight ack. `wait_secs` is intentionally ignored here —
    // the agent asked to run detached from the start. The monitor will emit
    // `shell_process_exited` when the process eventually terminates.
    if matches!(mode, ExecMode::Background) {
        return handle_backgrounded(
            command,
            pid,
            effective_wait,
            BackgroundReason::Explicit,
            child,
            log_writer.clone(),
            log_path.clone(),
            stdout_task,
            stderr_task,
            stdout_buf.clone(),
            stderr_buf.clone(),
            session_key,
        );
    }

    let wait_started_at = Instant::now();
    loop {
        if cancel_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            terminate_child_tree(pid, &mut child).await;
            join_reader_task(stdout_task, "stdout").await;
            join_reader_task(stderr_task, "stderr").await;
            return finish_cancelled_process(pid, session_key, log_writer.as_ref());
        }

        match child.try_wait() {
            Ok(Some(exit_status)) => {
                let was_signaled = exit_status.code().is_none();
                let exit_code = exit_status.code().unwrap_or(-1);

                join_reader_task(stdout_task, "stdout").await;
                join_reader_task(stderr_task, "stderr").await;

                if let Some(ref log) = log_writer {
                    if let Ok(mut writer) = log.lock() {
                        let log_status = if was_signaled {
                            LogProcessStatus::Killed
                        } else {
                            LogProcessStatus::Exited(exit_code)
                        };
                        let log_exit = if was_signaled { None } else { Some(exit_code) };
                        let _ = writer.finalize(log_status, log_exit);
                    }
                }

                let stdout = stdout_buf.lock().map(|b| b.clone()).unwrap_or_default();
                let stderr = stderr_buf.lock().map(|b| b.clone()).unwrap_or_default();

                if let Some(session_id) = session_key {
                    if was_signaled {
                        broadcast_exec_output(
                            session_id,
                            &format!("[process {} killed by signal]", pid),
                            "system",
                        );
                    } else {
                        broadcast_exec_output(
                            session_id,
                            &format!("[exit code: {}]", exit_code),
                            "system",
                        );
                    }
                    broadcast_process_exited(session_id, pid, Some(exit_code), was_signaled);
                }

                return format_command_result(&stdout, &stderr, exit_code);
            }
            Ok(None) => {}
            Err(err) => {
                return Err(ToolError::ExecutionFailed(format!(
                    "Failed to wait for process: {}",
                    err
                )));
            }
        }

        if wait_started_at.elapsed() >= Duration::from_secs(effective_wait) {
            return handle_backgrounded(
                command,
                pid,
                effective_wait,
                BackgroundReason::Timeout,
                child,
                log_writer.clone(),
                log_path.clone(),
                stdout_task,
                stderr_task,
                stdout_buf.clone(),
                stderr_buf.clone(),
                session_key,
            );
        }

        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Finalize a backgrounded process: emit the lifecycle event, register with
/// the `BackgroundTaskRegistry` so `await_output` can subscribe, spawn the
/// detached monitor task (same body for both explicit and timeout paths),
/// and return the string result the tool surfaces to the agent.
///
/// Called from two places:
/// - `ExecMode::Background` early-return (right after spawn, zero partial output).
/// - Blocking path's `Err(_)` timeout branch (may carry partial stdout/stderr).
#[allow(clippy::too_many_arguments)]
fn handle_backgrounded(
    command: &str,
    pid: u32,
    effective_wait: u64,
    reason: BackgroundReason,
    mut child: tokio::process::Child,
    log_writer: Option<Arc<StdMutex<TerminalLogWriter>>>,
    log_path: Option<PathBuf>,
    stdout_task: tokio::task::JoinHandle<()>,
    stderr_task: tokio::task::JoinHandle<()>,
    stdout_buf: Arc<StdMutex<String>>,
    stderr_buf: Arc<StdMutex<String>>,
    session_key: Option<&str>,
) -> Result<String, ToolError> {
    let stdout_partial = stdout_buf.lock().map(|b| b.clone()).unwrap_or_default();
    let stderr_partial = stderr_buf.lock().map(|b| b.clone()).unwrap_or_default();

    if let Some(session_id) = session_key {
        let human_line = match reason {
            BackgroundReason::Explicit => {
                format!("[process {} running in background]", pid)
            }
            BackgroundReason::Timeout => {
                format!("[process {} backgrounded after {}s]", pid, effective_wait)
            }
        };
        broadcast_exec_output(session_id, &human_line, "system");
        broadcast_process_backgrounded(
            session_id,
            pid,
            log_path.as_ref().map(|p| p.to_string_lossy()).as_deref(),
            reason,
        );
    }

    // Register in BackgroundTaskRegistry so AwaitTool can subscribe
    if pid != 0 {
        let reg_log = log_path.clone().unwrap_or_default();
        let reg_session = session_key.unwrap_or("").to_string();
        let _reg_tx = registry::register_shell(pid, command.to_string(), reg_log, reg_session);
    }

    let session_key_bg = session_key.map(|s| s.to_string());
    let log_writer_bg = log_writer.clone();
    let bg_safety_timeout = 3600u64;
    let bg_pid = pid;
    tokio::spawn(async move {
        let result =
            tokio::time::timeout(Duration::from_secs(bg_safety_timeout), child.wait()).await;

        match result {
            Ok(Ok(status)) => {
                let was_signaled = status.code().is_none();
                let code = status.code().unwrap_or(-1);
                if let Some(ref log) = log_writer_bg {
                    if let Ok(mut writer) = log.lock() {
                        let log_status = if was_signaled {
                            LogProcessStatus::Killed
                        } else {
                            LogProcessStatus::Exited(code)
                        };
                        let exit_code = if was_signaled { None } else { Some(code) };
                        let _ = writer.finalize(log_status, exit_code);
                    }
                }
                if bg_pid != 0 {
                    let job_status = if was_signaled {
                        registry::JobStatus::Killed
                    } else {
                        registry::JobStatus::Exited(code)
                    };
                    registry::mark_exited(&bg_pid.to_string(), job_status);
                }
                if let Some(ref sid) = session_key_bg {
                    if was_signaled {
                        broadcast_exec_output(
                            sid,
                            &format!("[background process {} killed by signal]", pid),
                            "system",
                        );
                    } else {
                        broadcast_exec_output(
                            sid,
                            &format!("[background process {} exited with code {}]", pid, code),
                            "system",
                        );
                    }
                    broadcast_process_exited(sid, pid, Some(code), was_signaled);
                }
            }
            _ => {
                if let Err(err) = child.kill().await {
                    warn!(
                        "[subprocess] Failed to kill background child process: {}",
                        err
                    );
                }
                if let Some(ref log) = log_writer_bg {
                    if let Ok(mut writer) = log.lock() {
                        let _ = writer.finalize(LogProcessStatus::Killed, None);
                    }
                }
                if bg_pid != 0 {
                    registry::mark_exited(&bg_pid.to_string(), registry::JobStatus::Killed);
                }
                if let Some(ref sid) = session_key_bg {
                    broadcast_exec_output(
                        sid,
                        &format!("[background process {} killed after safety timeout]", pid),
                        "system",
                    );
                    broadcast_process_exited(sid, pid, None, true);
                }
            }
        }

        if let Err(err) = stdout_task.await {
            warn!("[subprocess] Background stdout reader panicked: {}", err);
        }
        if let Err(err) = stderr_task.await {
            warn!("[subprocess] Background stderr reader panicked: {}", err);
        }

        if bg_pid != 0 {
            tokio::time::sleep(Duration::from_secs(60)).await;
            registry::remove(&bg_pid.to_string());
        }
    });

    let mut result_parts = Vec::new();
    if !stdout_partial.is_empty() {
        result_parts.push(crate::tool_infra::terminal::truncate_output(
            &stdout_partial,
        ));
    }
    if !stderr_partial.is_empty() {
        result_parts.push(format!(
            "[stderr]\n{}",
            crate::tool_infra::terminal::truncate_output(&stderr_partial),
        ));
    }

    let partial = if result_parts.is_empty() {
        match reason {
            BackgroundReason::Explicit => "(running in background)".to_string(),
            BackgroundReason::Timeout => "(no output yet)".to_string(),
        }
    } else {
        result_parts.join("\n")
    };

    let log_info = if let Some(ref path) = log_path {
        let path_str = path.to_string_lossy();
        format!(
            "\nLog file: {path_str}\n\n\
            To wait for output: await_output(command=\"wait_for\", handles=[\"{pid}\"], pattern=\"your_regex\", block_until_ms=30000)\n\
            To check status:    await_output(command=\"monitor\", handles=[\"{pid}\"])\n\
            To read tail:       await_output(command=\"monitor\", handles=[\"{pid}\"], tail_lines=100)\n\
            To kill:            run_shell(kill_handle=\"{pid}\")"
        )
    } else {
        format!("\nTo kill: run_shell(kill_handle=\"{pid}\")")
    };

    let header = match reason {
        BackgroundReason::Explicit => {
            format!("[process started in background as PID {}]", pid)
        }
        BackgroundReason::Timeout => {
            format!(
                "[process still running after {}s — backgrounded as PID {}]",
                effective_wait, pid
            )
        }
    };

    Ok(format!("{}\n\n{}{}", partial, header, log_info))
}
