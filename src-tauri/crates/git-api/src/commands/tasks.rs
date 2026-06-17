/**
 * Task Runner with Server-Sent Events (SSE)
 *
 * Provides real-time output streaming for task execution (npm, yarn, pnpm, cargo, etc.)
 * Uses Server-Sent Events (SSE) for efficient one-way server→client streaming.
 */
use axum::{
    extract::{Path, Query},
    response::sse::{Event, KeepAlive},
    response::{IntoResponse, Sse},
};
use futures::stream::Stream;
use serde::Deserialize;
use std::path::PathBuf;
use std::pin::Pin;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

// ============================================
// Query Parameters
// ============================================

#[derive(Deserialize)]
pub struct TaskRunQuery {
    /// The command to execute (e.g., "npm run dev")
    pub command: String,
    /// Working directory for the command
    pub cwd: String,
    /// Optional shell to use (defaults to system shell)
    #[serde(default)]
    pub shell: Option<String>,
}

// ============================================
// SSE Stream Handler
// ============================================

/// Stream task execution output via Server-Sent Events
pub async fn run_task_stream(
    Path(_task_id): Path<String>,
    Query(query): Query<TaskRunQuery>,
) -> impl IntoResponse {
    let cwd = PathBuf::from(&query.cwd);
    let command_str = query.command.clone();

    let stream = async_stream::stream! {
        yield Ok(Event::default()
            .event("start")
            .data(format!("{{\"command\":\"{}\"}}", command_str.replace("\"", "\\\""))));

        // Determine shell based on platform
        let (shell_cmd, shell_arg) = if cfg!(target_os = "windows") {
            ("cmd", "/C")
        } else {
            // macOS/Linux
            (query.shell.as_deref().unwrap_or("sh"), "-c")
        };

        // Spawn process with shell
        let mut task_cmd = Command::new(shell_cmd);
        task_cmd
            .arg(shell_arg)
            .arg(&command_str)
            .current_dir(&cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // Suppress console window on Windows.
        #[cfg(windows)]
        task_cmd.creation_flags(app_platform::CREATE_NO_WINDOW);
        let mut child = match task_cmd.spawn()
        {
            Ok(child) => child,
            Err(e) => {
                let error_msg = e.to_string().replace("\"", "\\\"");
                yield Ok(Event::default()
                    .event("error")
                    .data(format!("{{\"error\":\"{}\"}}", error_msg)));
                return;
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Create tasks to read stdout and stderr concurrently
        let stdout_task = tokio::spawn(async move {
            let mut lines = Vec::new();
            if let Some(stdout) = stdout {
                let reader = BufReader::new(stdout);
                let mut lines_reader = reader.lines();
                while let Ok(Some(line)) = lines_reader.next_line().await {
                    lines.push(("stdout".to_string(), line));
                }
            }
            lines
        });

        let stderr_task = tokio::spawn(async move {
            let mut lines = Vec::new();
            if let Some(stderr) = stderr {
                let reader = BufReader::new(stderr);
                let mut lines_reader = reader.lines();
                while let Ok(Some(line)) = lines_reader.next_line().await {
                    lines.push(("stderr".to_string(), line));
                }
            }
            lines
        });

        // Wait for both tasks to complete
        let mut all_lines = Vec::new();

        if let Ok(lines) = stdout_task.await {
            all_lines.extend(lines);
        }

        if let Ok(lines) = stderr_task.await {
            all_lines.extend(lines);
        }

        // Stream all output lines
        for (stream, line) in all_lines {
            let escaped_line = line.replace("\"", "\\\"").replace("\n", "\\n");
            yield Ok(Event::default()
                .event("output")
                .data(format!("{{\"stream\":\"{}\",\"line\":\"{}\"}}", stream, escaped_line)));
        }

        // Wait for process to complete and get exit code
        match child.wait().await {
            Ok(status) => {
                let exit_code = status.code().unwrap_or(-1);
                let success = status.success();
                yield Ok(Event::default()
                    .event("end")
                    .data(format!("{{\"success\":{},\"exitCode\":{}}}", success, exit_code)));
            }
            Err(e) => {
                let error_msg = e.to_string().replace("\"", "\\\"");
                yield Ok(Event::default()
                    .event("error")
                    .data(format!("{{\"error\":\"{}\"}}", error_msg)));
            }
        }
    };

    Sse::new(Box::pin(stream)
        as Pin<
            Box<dyn Stream<Item = Result<Event, std::convert::Infallible>> + Send>,
        >)
    .keep_alive(KeepAlive::default())
}
